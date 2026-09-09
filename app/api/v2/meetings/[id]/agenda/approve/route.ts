import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2AgendaItems } from "@/lib/db/schema-v2";
import { inngest } from "@/lib/inngest/client";
import { resolveMeetingV2SegmentMilestonePercent } from "@/lib/meeting-v2/pipeline-segment-timing";
import { updateMeetingV2Status } from "@/lib/meeting-v2/service";
import {
  inferPropertyManagementReportNumber,
  planAdHocPlacement,
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

    let nextSort = existingItems.length;
    const finalItemStatuses: Record<string, AgendaItemDiscussionStatus> = {
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
    const placement = planAdHocPlacement(
      existingItems.map((item) => item.itemNumber),
      pendingNewItems.length,
      inferPropertyManagementReportNumber(existingItems),
    );

    if (placement?.sectionMissing && pendingNewItems.length > 0) {
      await db.insert(meetingsV2AgendaItems).values({
        id: randomUUID(),
        meetingV2Id: meetingId,
        sourceArtifactId: existingItems[0]?.sourceArtifactId ?? null,
        sourceSectionId: null,
        sectionLabel: "Property Management Report",
        title: "Ad-hoc items",
        normalizedTitle: normalize("Ad-hoc items"),
        itemNumber: placement.sectionCode,
        itemType: "ad_hoc_discussion",
        sourcePagesJson: "[]",
        sourceText:
          "Discussion status: ad_hoc\nSynthesized section for transcript-only matters not on the official agenda.",
        sortOrder: nextSort++,
        createdAt: new Date().toISOString(),
      });
    }

    let adHocCodeIndex = 0;
    function nextAdHocItemNumber(): string {
      if (placement && adHocCodeIndex < placement.nextItemCodes.length) {
        return placement.nextItemCodes[adHocCodeIndex++];
      }
      return String(nextSort + 1);
    }

    for (const item of pendingNewItems) {
      const title = item.title?.trim();
      if (!title) continue;
      const newItemId = randomUUID();
      const status = item.discussionStatus || "ad_hoc";
      finalItemStatuses[newItemId] = status;

      await db.insert(meetingsV2AgendaItems).values({
        id: newItemId,
        meetingV2Id: meetingId,
        sourceArtifactId: existingItems[0]?.sourceArtifactId ?? null,
        sourceSectionId: null,
        sectionLabel: item.sectionLabel?.trim() || "Property Management Report: Ad-hoc items",
        title,
        normalizedTitle: normalize(title),
        itemNumber: nextAdHocItemNumber(),
        itemType: item.itemType?.trim() || "ad_hoc_discussion",
        sourcePagesJson: "[]",
        sourceText: `Discussion status: ${status}\nCreated during agenda review.`,
        sortOrder: nextSort++,
        createdAt: new Date().toISOString(),
      });
    }

    // 6. Update meeting settings with approved state
    const updatedSettings: MeetingV2Settings = {
      ...currentSettings,
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
