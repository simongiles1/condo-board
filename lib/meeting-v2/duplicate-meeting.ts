import { randomUUID } from "node:crypto";
import { cp, rm } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  meetings,
  meetingsV2,
  meetingsV2AgendaChunkSnapshots,
  meetingsV2AgendaItems,
  meetingsV2DocumentChunks,
  meetingsV2DocumentPages,
  meetingsV2DocumentSections,
  meetingsV2PipelineSegmentDurations,
  meetingsV2SourceArtifacts,
  meetingsV2TranscriptSegments,
} from "@/lib/db/schema";
import type { MeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import {
  buildDuplicatedAgendaApproval,
  meetingV2CanDuplicateToAgendaApproval,
  MEETING_V2_DUPLICATE_NOT_READY_MESSAGE,
  remapCopiedMeetingText,
  rewriteMeetingScopedPath,
} from "@/lib/meeting-v2/duplicate-meeting-shared";
import { resolveMeetingV2SegmentMilestonePercent } from "@/lib/meeting-v2/pipeline-segment-timing";

export {
  MEETING_V2_DUPLICATE_NOT_READY_MESSAGE,
  meetingV2CanDuplicateToAgendaApproval,
} from "@/lib/meeting-v2/duplicate-meeting-shared";

const INSERT_BATCH_SIZE = 200;
const PRE_APPROVAL_DURATION_SEGMENTS = ["ingest", "extract"] as const;

export type DuplicateMeetingV2Result = {
  id: string;
  title: string;
};

export class MeetingV2DuplicateError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MeetingV2DuplicateError";
    this.status = status;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function allocateId(oldId: string, map: Map<string, string>): string {
  const existing = map.get(oldId);
  if (existing) return existing;
  const next = randomUUID();
  map.set(oldId, next);
  return next;
}

function mappedOrNull(oldId: string | null | undefined, map: Map<string, string>): string | null {
  if (!oldId) return null;
  return map.get(oldId) ?? null;
}

async function insertBatches<T>(
  insertRows: (batch: T[]) => Promise<unknown>,
  rows: T[],
): Promise<void> {
  for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
    const batch = rows.slice(index, index + INSERT_BATCH_SIZE);
    if (batch.length === 0) continue;
    await insertRows(batch);
  }
}

function replacementPairs(map: Map<string, string>): Array<[string, string]> {
  return [...map.entries()].filter(([from, to]) => from && from !== to);
}

/**
 * Clone a V2 workspace through ingest/extract and park it at agenda approval.
 * Skips evidence, investigation, validation, and draft minutes so testers can
 * re-run post-approval work without regenerating the agenda.
 */
export async function duplicateMeetingV2ToAgendaApproval(options: {
  sourceMeetingId: string;
  title: string;
}): Promise<DuplicateMeetingV2Result> {
  const title = options.title.trim();
  if (!title) {
    throw new MeetingV2DuplicateError("A name is required.", 400);
  }

  const db = getDb();
  const sourceMeetingId = options.sourceMeetingId;
  const destMeetingId = randomUUID();
  const createdAt = nowIso();

  const [sourceV2] = await db
    .select()
    .from(meetingsV2)
    .where(eq(meetingsV2.id, sourceMeetingId));
  if (!sourceV2) {
    throw new MeetingV2DuplicateError("Meeting not found", 404);
  }

  const [legacy] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, sourceMeetingId));

  const agendaItems = await db
    .select()
    .from(meetingsV2AgendaItems)
    .where(eq(meetingsV2AgendaItems.meetingV2Id, sourceMeetingId));
  if (!meetingV2CanDuplicateToAgendaApproval(agendaItems.length)) {
    throw new MeetingV2DuplicateError(MEETING_V2_DUPLICATE_NOT_READY_MESSAGE, 409);
  }

  const [
    sourceArtifacts,
    transcriptSegments,
    documentPages,
    documentSections,
    documentChunks,
    chunkSnapshots,
    pipelineDurations,
  ] = await Promise.all([
    db
      .select()
      .from(meetingsV2SourceArtifacts)
      .where(eq(meetingsV2SourceArtifacts.meetingV2Id, sourceMeetingId)),
    db
      .select()
      .from(meetingsV2TranscriptSegments)
      .where(eq(meetingsV2TranscriptSegments.meetingV2Id, sourceMeetingId)),
    db
      .select()
      .from(meetingsV2DocumentPages)
      .where(eq(meetingsV2DocumentPages.meetingV2Id, sourceMeetingId)),
    db
      .select()
      .from(meetingsV2DocumentSections)
      .where(eq(meetingsV2DocumentSections.meetingV2Id, sourceMeetingId)),
    db
      .select()
      .from(meetingsV2DocumentChunks)
      .where(eq(meetingsV2DocumentChunks.meetingV2Id, sourceMeetingId)),
    db
      .select()
      .from(meetingsV2AgendaChunkSnapshots)
      .where(eq(meetingsV2AgendaChunkSnapshots.meetingV2Id, sourceMeetingId)),
    db
      .select()
      .from(meetingsV2PipelineSegmentDurations)
      .where(eq(meetingsV2PipelineSegmentDurations.meetingV2Id, sourceMeetingId)),
  ]);

  const idMap = new Map<string, string>([[sourceMeetingId, destMeetingId]]);
  for (const row of sourceArtifacts) allocateId(row.id, idMap);
  for (const row of transcriptSegments) allocateId(row.id, idMap);
  for (const row of documentPages) allocateId(row.id, idMap);
  for (const row of documentSections) allocateId(row.id, idMap);
  for (const row of documentChunks) allocateId(row.id, idMap);
  for (const row of agendaItems) allocateId(row.id, idMap);
  for (const row of chunkSnapshots) allocateId(row.id, idMap);
  const replacements = replacementPairs(idMap);

  const rewriteText = (value: string | null | undefined): string | null =>
    remapCopiedMeetingText(value, replacements);

  const rewritePath = (value: string | null | undefined): string | null =>
    rewriteMeetingScopedPath(value, sourceMeetingId, destMeetingId);

  const sourceSettings = (sourceV2.settings ?? {}) as MeetingV2Settings;
  const destSettings: MeetingV2Settings = {
    autonomyTemperature: sourceSettings.autonomyTemperature,
    extractionRun: sourceSettings.extractionRun,
    ingestUsage: sourceSettings.ingestUsage,
    goldStandardFilePath: rewritePath(sourceSettings.goldStandardFilePath ?? null),
    agendaApproval: buildDuplicatedAgendaApproval(sourceSettings.agendaApproval, idMap),
  };

  const extractEndPercent = await resolveMeetingV2SegmentMilestonePercent("extract", "end");
  const uploadSource = path.join(process.cwd(), "uploads", sourceMeetingId);
  const uploadDest = path.join(process.cwd(), "uploads", destMeetingId);
  let copiedUploads = false;

  try {
    await cp(uploadSource, uploadDest, { recursive: true, force: true });
    copiedUploads = true;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(meetings).values({
        id: destMeetingId,
        meetingDate: sourceV2.meetingDate,
        title,
        status: "draft",
        minutesContent: "",
        minutesJson: null,
        omissionsAnalysisJson: null,
        aiUsageJson: null,
        todosContent: "",
        vttFilePath:
          rewritePath(legacy?.vttFilePath) ??
          rewritePath(
            sourceArtifacts.find((artifact) => artifact.type === "transcript")?.storagePath,
          ) ??
          "",
        pdfFilePath: rewritePath(legacy?.pdfFilePath) ?? "",
        boardPackageFilePath:
          rewritePath(legacy?.boardPackageFilePath) ??
          rewritePath(
            sourceArtifacts.find((artifact) => artifact.type === "board_package")?.storagePath,
          ),
        goldStandardFilePath: rewritePath(
          sourceSettings.goldStandardFilePath ?? legacy?.goldStandardFilePath ?? null,
        ),
        goldStandardValidationJson: null,
        createdAt,
      });

      await tx.insert(meetingsV2).values({
        id: destMeetingId,
        sourceKey: destMeetingId,
        title,
        meetingDate: sourceV2.meetingDate,
        pipelineState: "extracted",
        currentStep: "Awaiting agenda review & approval",
        progressPercent: extractEndPercent,
        lastError: null,
        settings: destSettings,
        createdAt,
        updatedAt: createdAt,
      });

      await insertBatches(
        (batch) => tx.insert(meetingsV2SourceArtifacts).values(batch),
        sourceArtifacts.map((row) => ({
          ...row,
          id: idMap.get(row.id)!,
          meetingV2Id: destMeetingId,
          storagePath: rewritePath(row.storagePath) ?? row.storagePath,
        })),
      );

      await insertBatches(
        (batch) => tx.insert(meetingsV2TranscriptSegments).values(batch),
        transcriptSegments.map((row) => ({
          ...row,
          id: idMap.get(row.id)!,
          meetingV2Id: destMeetingId,
          sourceArtifactId: mappedOrNull(row.sourceArtifactId, idMap) ?? row.sourceArtifactId,
        })),
      );

      await insertBatches(
        (batch) => tx.insert(meetingsV2DocumentPages).values(batch),
        documentPages.map((row) => ({
          ...row,
          id: idMap.get(row.id)!,
          meetingV2Id: destMeetingId,
          sourceArtifactId: mappedOrNull(row.sourceArtifactId, idMap) ?? row.sourceArtifactId,
          imagePath: rewritePath(row.imagePath),
        })),
      );

      await insertBatches(
        (batch) => tx.insert(meetingsV2DocumentSections).values(batch),
        documentSections.map((row) => ({
          ...row,
          id: idMap.get(row.id)!,
          meetingV2Id: destMeetingId,
          sourceArtifactId: mappedOrNull(row.sourceArtifactId, idMap) ?? row.sourceArtifactId,
        })),
      );

      await insertBatches(
        (batch) => tx.insert(meetingsV2DocumentChunks).values(batch),
        documentChunks.map((row) => ({
          ...row,
          id: idMap.get(row.id)!,
          meetingV2Id: destMeetingId,
          sourceArtifactId: mappedOrNull(row.sourceArtifactId, idMap) ?? row.sourceArtifactId,
          metadataJson: rewriteText(row.metadataJson),
        })),
      );

      await insertBatches(
        (batch) => tx.insert(meetingsV2AgendaItems).values(batch),
        agendaItems.map((row) => ({
          ...row,
          id: idMap.get(row.id)!,
          meetingV2Id: destMeetingId,
          sourceArtifactId: mappedOrNull(row.sourceArtifactId, idMap),
          sourceSectionId: mappedOrNull(row.sourceSectionId, idMap),
          sourcePagesJson: rewriteText(row.sourcePagesJson) ?? row.sourcePagesJson,
          sourceText: rewriteText(row.sourceText),
        })),
      );

      const remappedSnapshots = chunkSnapshots.flatMap((row) => {
        const chunkId = mappedOrNull(row.chunkId, idMap);
        if (!chunkId) return [];
        return [
          {
            ...row,
            id: idMap.get(row.id)!,
            meetingV2Id: destMeetingId,
            chunkId,
            beforeStateJson: rewriteText(row.beforeStateJson) ?? row.beforeStateJson,
            afterStateJson: rewriteText(row.afterStateJson) ?? row.afterStateJson,
            requestJson: rewriteText(row.requestJson),
            responseText: rewriteText(row.responseText),
            parsedJson: rewriteText(row.parsedJson),
            usageJson: rewriteText(row.usageJson),
          },
        ];
      });
      await insertBatches(
        (batch) => tx.insert(meetingsV2AgendaChunkSnapshots).values(batch),
        remappedSnapshots,
      );

      const durationRows = pipelineDurations.filter((row) =>
        PRE_APPROVAL_DURATION_SEGMENTS.includes(
          row.segment as (typeof PRE_APPROVAL_DURATION_SEGMENTS)[number],
        ),
      );
      if (durationRows.length > 0) {
        await tx.insert(meetingsV2PipelineSegmentDurations).values(
          durationRows.map((row) => ({
            ...row,
            id: randomUUID(),
            meetingV2Id: destMeetingId,
          })),
        );
      }
    });
  } catch (error) {
    if (copiedUploads) {
      await rm(uploadDest, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }

  return { id: destMeetingId, title };
}
