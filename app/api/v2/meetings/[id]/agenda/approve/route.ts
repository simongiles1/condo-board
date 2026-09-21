import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2AgendaItems, meetingsV2TranscriptSegments } from "@/lib/db/schema-v2";
import { inngest } from "@/lib/inngest/client";
import { resolveMeetingV2SegmentMilestonePercent } from "@/lib/meeting-v2/pipeline-segment-timing";
import { updateMeetingV2Status, resetMeetingV2PostExtractData, markMeetingV2DraftStale } from "@/lib/meeting-v2/service";
import { canonicalDiscussionTiming, withCanonicalDiscussionTiming } from "@/lib/meeting-v2/canonical-timing";
import {
  ensureAdHocSectionOutline,
  insertItemsByDiscussionPosition,
  discussionPositionFromEvidence,
} from "@/lib/meeting-v2/agenda-outline";
import type {
  AgendaItemDiscussionStatus,
  MeetingV2Settings,
  TranscriptDiscrepancy,
} from "@/lib/meeting-v2/extraction-diagnostics";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type ApproveAgendaRequestBody = {
  itemStatuses?: Record<string, AgendaItemDiscussionStatus>;
  excludedItemIds?: string[];
  itemUpdates?: Array<{
    id: string;
    title?: string;
    sectionLabel?: string;
    itemType?: string;
  }>;
  newItems?: Array<{
    title: string;
    sectionLabel?: string;
    itemType?: string;
    discussionStatus?: AgendaItemDiscussionStatus;
    transcriptRange?: [number, number];
    timestamp?: string;
  }>;
  discrepancyActions?: Array<{
    id: string;
    action: "accept" | "dismiss";
    title?: string;
    section?: string;
  }>;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: meetingId } = await params;
    const body = (await req.json().catch(() => ({}))) as ApproveAgendaRequestBody;

    const db = getDb();
    const [meeting] = await db
      .select()
      .from(meetingsV2)
      .where(eq(meetingsV2.id, meetingId));

    if (!meeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    // 1. Exclude deleted items
    await markMeetingV2DraftStale(meetingId, "Agenda review is updating the evidence. Investigation and validation must finish before generation.");
    if (body.excludedItemIds && body.excludedItemIds.length > 0) {
      await db
        .delete(meetingsV2AgendaItems)
        .where(
          and(
            eq(meetingsV2AgendaItems.meetingV2Id, meetingId),
            inArray(meetingsV2AgendaItems.id, body.excludedItemIds),
          ),
        );
    }

    // 2. Apply title / section / itemType updates
    if (body.itemUpdates && body.itemUpdates.length > 0) {
      for (const update of body.itemUpdates) {
        if (!update.id) continue;
        await db
          .update(meetingsV2AgendaItems)
          .set({
            title: update.title?.trim() || undefined,
            normalizedTitle: update.title?.trim() ? normalize(update.title) : undefined,
            sectionLabel: update.sectionLabel?.trim() || undefined,
            itemType: update.itemType?.trim() || undefined,
          })
          .where(
            and(
              eq(meetingsV2AgendaItems.meetingV2Id, meetingId),
              eq(meetingsV2AgendaItems.id, update.id),
            ),
          );
      }
    }

    // 3. Query remaining items to determine sort orders
    const existingItems = await db
      .select()
      .from(meetingsV2AgendaItems)
      .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2AgendaItems.sortOrder));

    const existingById = new Map(existingItems.map((item) => [item.id, item]));
    const normalizedExisting = ensureAdHocSectionOutline(existingItems, (sectionCode) => ({
      id: randomUUID(),
      meetingV2Id: meetingId,
      sourceArtifactId: existingItems[0]?.sourceArtifactId ?? null,
      sourceSectionId: null,
      sectionLabel: "Property Management Report",
      title: "Ad-hoc items",
      normalizedTitle: normalize("Ad-hoc items"),
      itemNumber: sectionCode,
      itemType: "ad_hoc_discussion",
      sourcePagesJson: "[]",
      sourceText:
        "Discussion status: ad_hoc\nSynthesized section for transcript-only matters not on the official agenda.",
      sortOrder: existingItems.length,
      createdAt: new Date().toISOString(),
    }));
    for (const item of normalizedExisting) {
      const prior = existingById.get(item.id);
      if (!prior) {
        await db.insert(meetingsV2AgendaItems).values(item);
        continue;
      }
      if (prior.itemNumber !== item.itemNumber) {
        await db
          .update(meetingsV2AgendaItems)
          .set({ itemNumber: item.itemNumber })
          .where(
            and(eq(meetingsV2AgendaItems.meetingV2Id, meetingId), eq(meetingsV2AgendaItems.id, item.id)),
          );
      }
    }

    const finalItemStatuses: Record<string, AgendaItemDiscussionStatus> = {
      ...(meeting.settings?.agendaApproval?.itemStatuses || {}),
      ...(body.itemStatuses || {}),
    };

    // 4. Handle accepted discrepancies
    const currentSettings = (meeting.settings as MeetingV2Settings) || {};
    const discrepancies: TranscriptDiscrepancy[] =
      currentSettings.agendaApproval?.discrepancies || [];

    const discrepancyMap = new Map(body.discrepancyActions?.map((a) => [a.id, a]) || []);
    const updatedDiscrepancies: TranscriptDiscrepancy[] = discrepancies.map((d) => {
      const actionItem = discrepancyMap.get(d.id);
      if (actionItem) {
        return {
          ...d,
          status: actionItem.action === "accept" ? ("accepted" as const) : ("dismissed" as const),
        };
      }
      return d;
    });

    const pendingNewItems = (body.newItems || []).filter((item) => item.title?.trim());
    const evidenceByExistingId = currentSettings.agendaEvidence ?? {};

    type PlaceableAgendaItem = (typeof normalizedExisting)[number] & {
      isNew?: boolean;
      transcriptRange?: [number, number];
      timestamp?: string;
      discussionStatus?: AgendaItemDiscussionStatus;
    };

    const placeableExisting: PlaceableAgendaItem[] = normalizedExisting.map((item) => ({
      ...item,
      isNew: false,
      transcriptRange: evidenceByExistingId[item.id]?.sourceTranscriptRanges?.[0],
    }));

    function itemPosition(item: PlaceableAgendaItem) {
      return discussionPositionFromEvidence({
        sourceTranscriptRanges: evidenceByExistingId[item.id]?.sourceTranscriptRanges,
        transcriptRange: item.transcriptRange,
        sourceText: item.sourceText,
        timestamp: item.timestamp,
      });
    }

    const pendingPrepared: PlaceableAgendaItem[] = pendingNewItems.map((item) => {
      const range =
        Array.isArray(item.transcriptRange) && item.transcriptRange.length === 2
          ? ([Number(item.transcriptRange[0]), Number(item.transcriptRange[1])] as [number, number])
          : updatedDiscrepancies.find(
              (disc) =>
                disc.status === "accepted" &&
                normalize(discrepancyMap.get(disc.id)?.title || disc.suggestedTitle) ===
                  normalize(item.title || ""),
            )?.transcriptRange;
      return {
        id: randomUUID(),
        meetingV2Id: meetingId,
        sourceArtifactId: existingItems[0]?.sourceArtifactId ?? null,
        sourceSectionId: null,
        sectionLabel: item.sectionLabel?.trim() || "Property Management Report: Ad-hoc items",
        title: item.title.trim(),
        normalizedTitle: normalize(item.title),
        itemNumber: "",
        itemType: item.itemType?.trim() || "ad_hoc_discussion",
        sourcePagesJson: "[]",
        sourceText: `Discussion status: ${item.discussionStatus || "ad_hoc"}\nCreated during agenda review.`,
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        isNew: true,
        transcriptRange: range,
        timestamp: item.timestamp,
        discussionStatus: item.discussionStatus || "ad_hoc",
      };
    });

    const orderedItems = insertItemsByDiscussionPosition(
      placeableExisting,
      pendingPrepared,
      itemPosition,
      (sectionCode) => ({
        id: randomUUID(),
        meetingV2Id: meetingId,
        sourceArtifactId: existingItems[0]?.sourceArtifactId ?? null,
        sourceSectionId: null,
        sectionLabel: "Property Management Report",
        title: "Ad-hoc items",
        normalizedTitle: normalize("Ad-hoc items"),
        itemNumber: sectionCode,
        itemType: "ad_hoc_discussion",
        sourcePagesJson: "[]",
        sourceText:
          "Discussion status: ad_hoc\nSynthesized section for transcript-only matters not on the official agenda.",
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        isNew: true,
        discussionStatus: "ad_hoc",
      }),
    );

    const existingByOrderedId = new Map(normalizedExisting.map((item) => [item.id, item]));
    for (const [index, item] of orderedItems.entries()) {
      if (item.isNew) {
        const status = item.discussionStatus || "ad_hoc";
        finalItemStatuses[item.id] = status;
        await db.insert(meetingsV2AgendaItems).values({
          id: item.id,
          meetingV2Id: meetingId,
          sourceArtifactId: item.sourceArtifactId,
          sourceSectionId: item.sourceSectionId,
          sectionLabel: item.sectionLabel,
          title: item.title,
          normalizedTitle: item.normalizedTitle,
          itemNumber: item.itemNumber,
          itemType: item.itemType,
          sourcePagesJson: item.sourcePagesJson,
          sourceText: item.sourceText,
          sortOrder: index,
          createdAt: item.createdAt,
        });
        continue;
      }
      const prior = existingByOrderedId.get(item.id);
      if (!prior) continue;
      if (prior.sortOrder !== index || prior.itemNumber !== item.itemNumber) {
        await db
          .update(meetingsV2AgendaItems)
          .set({ sortOrder: index, itemNumber: item.itemNumber })
          .where(
            and(eq(meetingsV2AgendaItems.meetingV2Id, meetingId), eq(meetingsV2AgendaItems.id, item.id)),
          );
      }
    }

    const finalItems = await db.select().from(meetingsV2AgendaItems).where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId));
    const insertedRangeById = new Map(
      orderedItems
        .filter((item) => item.transcriptRange)
        .map((item) => [item.id, item.transcriptRange] as const),
    );
    const agendaEvidence = Object.fromEntries(finalItems.map(item => {
      const prior = currentSettings.agendaEvidence?.[item.id];
      const accepted = updatedDiscrepancies.find(d => d.status === "accepted" && normalize(discrepancyMap.get(d.id)?.title || d.suggestedTitle) === normalize(item.title));
      const insertedRange = insertedRangeById.get(item.id);
      return [item.id, prior ?? { itemNumber: item.itemNumber, sourceTranscriptRanges: accepted ? [accepted.transcriptRange] : insertedRange ? [insertedRange] : [],
        sourceChunkIds: [], aliases: [], notes: [] }];
    }));
    const segments = await db.select().from(meetingsV2TranscriptSegments).where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId));
    for (const item of finalItems) {
      const timing = canonicalDiscussionTiming(agendaEvidence[item.id].sourceTranscriptRanges, segments);
      await db.update(meetingsV2AgendaItems).set({ sourceText: withCanonicalDiscussionTiming(item.sourceText, timing) }).where(eq(meetingsV2AgendaItems.id, item.id));
    }
    // 6. Update meeting settings with approved state
    const updatedSettings: MeetingV2Settings = {
      ...currentSettings,
      agendaEvidence,
      draftReadiness: { ready: false, problems: ["The approved agenda needs investigation and validation."], checkedAt: new Date().toISOString() },
      agendaApproval: {
        status: "approved",
        approvedAt: new Date().toISOString(),
        itemStatuses: finalItemStatuses,
        excludedItemIds: body.excludedItemIds || [],
        discrepancies: updatedDiscrepancies,
      },
    };

    await db
      .update(meetingsV2)
      .set({ settings: updatedSettings })
      .where(eq(meetingsV2.id, meetingId));

    await resetMeetingV2PostExtractData(meetingId);

    const evidenceStartPercent = await resolveMeetingV2SegmentMilestonePercent(
      "evidence",
      "start",
    );
    await updateMeetingV2Status(
      meetingId,
      "gathering_evidence",
      "Agenda approved. Assembling evidence context...",
      evidenceStartPercent,
      null,
    );

    // 7. Trigger Inngest to resume evidence, investigation, and validation
    await inngest.send({
      name: "meeting-v2/pipeline.start",
      data: { meetingId },
    });

    return NextResponse.json({
      success: true,
      meetingId,
      approvedAt: updatedSettings.agendaApproval?.approvedAt,
    });
  } catch (error) {
    console.error("[api/v2/meetings/[id]/agenda/approve] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to approve agenda",
      },
      { status: 500 },
    );
  }
}
