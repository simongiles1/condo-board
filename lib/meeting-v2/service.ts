import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { getDb } from "@/lib/db";
import {
  meetings,
  meetingsV2,
  meetingsV2AgendaChunkSnapshots,
  meetingsV2AgendaItemContexts,
  meetingsV2AgendaItemEvidence,
  meetingsV2AgendaItemInvestigations,
  meetingsV2AgendaItems,
  meetingsV2DocumentChunks,
  meetingsV2DocumentPages,
  meetingsV2DocumentSections,
  meetingsV2MinutesDrafts,
  meetingsV2SourceArtifacts,
  meetingsV2TranscriptSegments,
  meetingsV2ValidationResults,
} from "@/lib/db/schema";
import { AGENDA_ITEM_INVESTIGATION_PROMPT } from "@/lib/meeting-v2/investigation-prompts";
import { AGENDA_ITEM_VALIDATION_PROMPT } from "@/lib/meeting-v2/validation-prompts";
import { loadMeetingBoardPackageMeta } from "@/lib/meeting-v2/board-package";
import { extractAgendaItemsWithAi } from "@/lib/meeting-v2/agenda-ai";
import {
  analyzeExtractionQuality,
  buildMeetingV2Alerts,
  getMeetingV2AgendaChunkSnapshotCount,
  isDeepSeekKeyConfigured,
  readMeetingV2Settings,
  recordMeetingV2ExtractionRun,
  clearMeetingV2ValidationUsage,
  recordMeetingV2ValidationUsage,
  type MeetingV2Alert,
  type MeetingV2ExtractionQuality,
  type MeetingV2Settings,
} from "@/lib/meeting-v2/extraction-diagnostics";
import {
  buildMeetingV2DisplayProgress,
  buildMeetingV2WorkflowProgress,
  isMeetingV2PipelineActivelyRunning,
} from "@/lib/meeting-v2/workflow-progress";
import { buildMeetingV2DraftArtifact, buildMeetingFrame } from "@/lib/meeting-v2/draft-builder";
import { chunkDocumentPages, chunkTranscriptSegments } from "@/lib/meeting-v2/chunking";
import {
  loadInvestigationToolRuntime,
  runToolEnabledInvestigation,
} from "@/lib/meeting-v2/investigation-tools";
import { extractPdfPagesWithText, buildBasicDocumentSections } from "@/lib/meeting-v2/pdf";
import { parseVttCues } from "@/lib/parsers/vtt";

type LegacyMeetingRow = typeof meetings.$inferSelect;
type MeetingV2Row = typeof meetingsV2.$inferSelect;
type AgendaItemRow = typeof meetingsV2AgendaItems.$inferSelect;
type InvestigationRow = typeof meetingsV2AgendaItemInvestigations.$inferSelect;
type ValidationRow = typeof meetingsV2ValidationResults.$inferSelect;
type ChunkRow = typeof meetingsV2DocumentChunks.$inferSelect;

type StatusState = MeetingV2Row["pipelineState"];

export type MeetingV2Detail = {
  meeting: Pick<
    MeetingV2Row,
    | "id"
    | "title"
    | "meetingDate"
    | "pipelineState"
    | "currentStep"
    | "progressPercent"
    | "lastError"
    | "createdAt"
    | "updatedAt"
  > & {
    computedPipelineState: StatusState;
    computedCurrentStep: string;
    stages: Array<{
      key: "ingest" | "extract" | "evidence" | "investigate" | "validate";
      label: string;
      status: "complete" | "in_progress" | "incomplete";
      note: string;
      progressPercent: number;
    }>;
    counts: {
      sourceArtifacts: number;
      transcriptSegments: number;
      documentPages: number;
      documentSections: number;
      documentChunks: number;
      agendaItems: number;
      evidenceContexts: number;
      investigations: number;
      validations: number;
      drafts: number;
    };
    extractionQuality: MeetingV2ExtractionQuality;
    alerts: MeetingV2Alert[];
    integrity: {
      isConsistent: boolean;
      note: string;
    };
  };
  items: Array<{
    id: string;
    title: string;
    itemNumber: string | null;
    itemType: string;
    sourceSectionId: string | null;
    discussionSummary: string | null;
    confidence: string | null;
    outcome: string | null;
    openQuestions: string[];
    userAnswers: Record<string, string> | null;
    validation: Array<{
      severity: string;
      code: string;
      message: string;
    }>;
  }>;
  latestDraft: {
    id: string;
    title: string;
    contentMarkdown: string;
    json: string | null;
    format: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  sources: {
    transcript: {
      fileName: string;
      available: boolean;
    } | null;
    boardPackage: {
      fileName: string;
      available: boolean;
      pageCount: number | null;
    } | null;
  };
  documentSections: Array<{
    title: string;
    startPage: number;
    endPage: number;
  }>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function safeJsonObjectParse(value: string): unknown {
  const trimmed = value.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  const extracted =
    firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed;
  return JSON.parse(
    extracted
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/,\s*([}\]])/g, "$1"),
  );
}

function checksumFor(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function resolveStoredPath(storedPath: string | null | undefined): string | null {
  if (!storedPath) return null;
  return path.resolve(process.cwd(), storedPath);
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleKeywords(title: string): string[] {
  return [...new Set(
    normalizeWhitespace(title)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((part) => part.length >= 4),
  )];
}

function sectionRangeText(
  pages: Array<typeof meetingsV2DocumentPages.$inferSelect>,
  section: typeof meetingsV2DocumentSections.$inferSelect,
): string {
  return pages
    .filter((page) => page.pageNumber >= section.startPage && page.pageNumber <= section.endPage)
    .map((page) => page.extractedText)
    .join("\n\n");
}

type ExtractedAgendaTopic = {
  title: string;
  sectionLabel: string;
  itemType: string;
  sourcePages: number[];
  sourceChunkIds: string[];
  sourceTranscriptRanges: Array<[number, number]>;
  sourceText: string | null;
  aliases: string[];
  notes: string[];
};

type ChunkContext = {
  chunkId: string;
  chunkKind: "document" | "transcript";
  chunkKey: string;
  chunkLabel: string | null;
  sortOrder: number;
  pageRange: [number, number] | null;
  sequenceRange: [number, number] | null;
  startTimestamp: string | null;
  endTimestamp: string | null;
  text: string;
  neighbors: {
    previous: string | null;
    next: string | null;
  };
};

type AgendaItemContextDocument = {
  agendaItemId: string;
  title: string;
  sectionLabel: string | null;
  itemType: string;
  sourcePages: number[];
  sourceChunkIds: string[];
  sourceTranscriptRanges: Array<[number, number]>;
  aliases: string[];
  notes: string[];
  anchorChunkIds: string[];
  chunksById: Record<string, ChunkContext>;
  buildNotes: string[];
};

function vttTimestampToMs(value: string): number {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return 0;
  const [, hh, mm, ss, ms = "0"] = match;
  return (
    Number(hh) * 60 * 60 * 1000 +
    Number(mm) * 60 * 1000 +
    Number(ss) * 1000 +
    Number(ms.padEnd(3, "0"))
  );
}

function normalizeKey(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeExtractedTopic(raw: Record<string, unknown>): ExtractedAgendaTopic | null {
  const title = normalizeWhitespace(typeof raw.title === "string" ? raw.title : "");
  if (!title) return null;
  return {
    title,
    sectionLabel: normalizeWhitespace(typeof raw.sectionLabel === "string" ? raw.sectionLabel : "") || "Unknown",
    itemType: normalizeWhitespace(typeof raw.itemType === "string" ? raw.itemType : "") || "other",
    sourcePages: uniqueValues(
      (Array.isArray(raw.sourcePages) ? raw.sourcePages : [])
        .flatMap((page) => (typeof page === "number" && Number.isFinite(page) ? [Math.trunc(page)] : []))
        .filter((page) => page > 0),
    ).sort((a, b) => a - b),
    sourceChunkIds: uniqueValues(
      (Array.isArray(raw.sourceChunkIds) ? raw.sourceChunkIds : [])
        .flatMap((chunkId) => (typeof chunkId === "string" ? [normalizeWhitespace(chunkId)] : []))
        .filter(Boolean),
    ),
    sourceTranscriptRanges: uniqueValues(
      (Array.isArray(raw.sourceTranscriptRanges) ? raw.sourceTranscriptRanges : [])
        .flatMap((range) =>
          Array.isArray(range) &&
          range.length === 2 &&
          typeof range[0] === "number" &&
          typeof range[1] === "number"
            ? [`${Math.trunc(range[0])}:${Math.trunc(range[1])}`]
            : [],
        ),
    ).map((range) => {
      const [start, end] = range.split(":").map((entry) => Number.parseInt(entry, 10));
      return [start, end] as [number, number];
    }),
    sourceText: typeof raw.sourceText === "string" ? normalizeWhitespace(raw.sourceText) : null,
    aliases: uniqueValues(
      (Array.isArray(raw.aliases) ? raw.aliases : [])
        .flatMap((alias) => (typeof alias === "string" ? [normalizeWhitespace(alias)] : []))
        .filter(Boolean),
    ),
    notes: uniqueValues(
      (Array.isArray(raw.notes) ? raw.notes : [])
        .flatMap((note) => (typeof note === "string" ? [normalizeWhitespace(note)] : []))
        .filter(Boolean),
    ),
  };
}

function fallbackAiChunkId(chunk: ChunkRow): string {
  return `${chunk.chunkKind === "document" ? "document_chunk" : "transcript_chunk"}_${String(
    chunk.sortOrder + 1,
  ).padStart(3, "0")}`;
}

function toChunkContext(chunk: ChunkRow): ChunkContext {
  const metadata = safeJsonParse<Record<string, unknown> | null>(chunk.metadataJson, null);
  const pageNumbers =
    Array.isArray(metadata?.pageNumbers)
      ? metadata.pageNumbers.flatMap((page) =>
          typeof page === "number" && Number.isFinite(page) ? [Math.trunc(page)] : [],
        )
      : [chunk.pageStart, chunk.pageEnd].flatMap((entry) =>
          typeof entry === "number" && Number.isFinite(entry) ? [entry] : [],
        );
  const sequenceRange =
    Array.isArray(metadata?.sequenceRange) &&
    metadata.sequenceRange.length === 2 &&
    typeof metadata.sequenceRange[0] === "number" &&
    typeof metadata.sequenceRange[1] === "number"
      ? ([metadata.sequenceRange[0], metadata.sequenceRange[1]] as [number, number])
      : typeof chunk.sequenceStart === "number" && typeof chunk.sequenceEnd === "number"
        ? ([chunk.sequenceStart, chunk.sequenceEnd] as [number, number])
        : null;
  return {
    chunkId:
      typeof metadata?.aiChunkId === "string" && metadata.aiChunkId.trim()
        ? metadata.aiChunkId.trim()
        : fallbackAiChunkId(chunk),
    chunkKind: chunk.chunkKind,
    chunkKey: chunk.chunkKey,
    chunkLabel:
      typeof metadata?.chunkLabel === "string" && metadata.chunkLabel.trim()
        ? metadata.chunkLabel.trim()
        : null,
    sortOrder: chunk.sortOrder,
    pageRange:
      pageNumbers.length > 0
        ? [pageNumbers[0], pageNumbers[pageNumbers.length - 1]] as [number, number]
        : null,
    sequenceRange,
    startTimestamp: chunk.startTimestamp,
    endTimestamp: chunk.endTimestamp,
    text: chunk.text,
    neighbors: {
      previous:
        typeof metadata?.prevAiChunkId === "string" && metadata.prevAiChunkId.trim()
          ? metadata.prevAiChunkId.trim()
          : null,
      next:
        typeof metadata?.nextAiChunkId === "string" && metadata.nextAiChunkId.trim()
          ? metadata.nextAiChunkId.trim()
          : null,
    },
  };
}

function intersectsSourcePages(chunkPages: [number, number] | null, sourcePages: number[]): boolean {
  if (!chunkPages || sourcePages.length === 0) return false;
  return sourcePages.some((page) => page >= chunkPages[0] && page <= chunkPages[1]);
}

function overlapsTranscriptRange(
  chunkRange: [number, number] | null,
  targetRanges: Array<[number, number]>,
): boolean {
  if (!chunkRange || targetRanges.length === 0) return false;
  return targetRanges.some(([start, end]) => chunkRange[0] <= end && chunkRange[1] >= start);
}

function buildAssembledContextText(context: AgendaItemContextDocument): string {
  const parts: string[] = [
    `Agenda item: ${context.title}`,
    `Section: ${context.sectionLabel ?? "Unknown"}`,
    `Type: ${context.itemType}`,
    context.sourcePages.length > 0 ? `Source pages: ${context.sourcePages.join(", ")}` : "",
    context.aliases.length > 0 ? `Aliases: ${context.aliases.join("; ")}` : "",
    context.notes.length > 0 ? `Notes: ${context.notes.join("; ")}` : "",
    context.buildNotes.length > 0 ? `Context notes: ${context.buildNotes.join(" ")}` : "",
  ].filter(Boolean);

  for (const chunkId of context.anchorChunkIds) {
    const chunk = context.chunksById[chunkId];
    if (!chunk) continue;
    parts.push(
      [
        `${chunk.chunkLabel ?? chunk.chunkId}`,
        `Chunk ID: ${chunk.chunkId}`,
        `Kind: ${chunk.chunkKind}`,
        chunk.pageRange ? `Pages: ${chunk.pageRange[0]}-${chunk.pageRange[1]}` : "",
        chunk.sequenceRange ? `Segments: ${chunk.sequenceRange[0]}-${chunk.sequenceRange[1]}` : "",
        chunk.startTimestamp && chunk.endTimestamp ? `Time: ${chunk.startTimestamp} - ${chunk.endTimestamp}` : "",
        chunk.neighbors.previous ? `Previous neighbor: ${chunk.neighbors.previous}` : "",
        chunk.neighbors.next ? `Next neighbor: ${chunk.neighbors.next}` : "",
        "",
        chunk.text,
      ].filter(Boolean).join("\n"),
    );
  }

  return parts.join("\n\n");
}

function matchExtractedTopic(
  item: AgendaItemRow,
  extractedTopics: ExtractedAgendaTopic[],
): ExtractedAgendaTopic | null {
  const itemTitle = normalizeKey(item.title);
  const itemSection = normalizeKey(item.sectionLabel);
  const itemPages = safeJsonParse<number[]>(item.sourcePagesJson, []);
  let bestTopic: ExtractedAgendaTopic | null = null;
  let bestScore = -1;

  for (const topic of extractedTopics) {
    let score = 0;
    if (normalizeKey(topic.title) === itemTitle) score += 6;
    if (normalizeKey(topic.sectionLabel) === itemSection) score += 3;
    if (topic.sourcePages.some((page) => itemPages.includes(page))) score += 2;
    if (normalizeKey(topic.title).includes(itemTitle) || itemTitle.includes(normalizeKey(topic.title))) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return bestScore >= 3 ? bestTopic : null;
}

async function getLegacyMeeting(meetingId: string): Promise<LegacyMeetingRow> {
  const db = getDb();
  const [legacyMeeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!legacyMeeting) {
    throw new Error(`Legacy meeting ${meetingId} was not found.`);
  }
  return legacyMeeting;
}

export async function ensureMeetingV2Seed(meetingId: string): Promise<MeetingV2Row> {
  const db = getDb();
  const [existing] = await db.select().from(meetingsV2).where(eq(meetingsV2.id, meetingId));
  if (existing) return existing;

  const legacyMeeting = await getLegacyMeeting(meetingId);
  const createdAt = nowIso();
  await db.insert(meetingsV2).values({
    id: legacyMeeting.id,
    sourceKey: legacyMeeting.id,
    title: legacyMeeting.title,
    meetingDate: legacyMeeting.meetingDate,
    pipelineState: "created",
    currentStep: "Ready to start",
    progressPercent: 0,
    lastError: null,
    createdAt,
    updatedAt: createdAt,
  });

  const [seeded] = await db.select().from(meetingsV2).where(eq(meetingsV2.id, meetingId));
  if (!seeded) {
    throw new Error(`Failed to seed V2 meeting ${meetingId}.`);
  }
  return seeded;
}

export async function updateMeetingV2Status(
  meetingId: string,
  pipelineState: StatusState,
  currentStep: string,
  progressPercent: number,
  lastError: string | null = null,
): Promise<void> {
  const db = getDb();
  await db
    .update(meetingsV2)
    .set({
      pipelineState,
      currentStep,
      progressPercent,
      lastError,
      updatedAt: nowIso(),
    })
    .where(eq(meetingsV2.id, meetingId));
}

async function updatePhaseProgress(options: {
  meetingId: string;
  pipelineState: StatusState;
  basePercent: number;
  spanPercent: number;
  current: number;
  total: number;
  label: string;
}): Promise<void> {
  const { meetingId, pipelineState, basePercent, spanPercent, current, total, label } = options;
  const ratio = total <= 0 ? 1 : current / total;
  await updateMeetingV2Status(
    meetingId,
    pipelineState,
    label,
    clampProgress(basePercent + spanPercent * ratio),
    null,
  );
}

export async function getMeetingV2Counts(meetingId: string): Promise<{
  sourceArtifacts: number;
  transcriptSegments: number;
  documentPages: number;
  documentSections: number;
  documentChunks: number;
  agendaItems: number;
  evidenceContexts: number;
  investigations: number;
  validations: number;
  drafts: number;
}> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM "meetings_v2_source_artifacts" WHERE "meeting_v2_id" = ${meetingId}) AS "sourceArtifacts",
      (SELECT count(*)::int FROM "meetings_v2_transcript_segments" WHERE "meeting_v2_id" = ${meetingId}) AS "transcriptSegments",
      (SELECT count(*)::int FROM "meetings_v2_document_pages" WHERE "meeting_v2_id" = ${meetingId}) AS "documentPages",
      (SELECT count(*)::int FROM "meetings_v2_document_sections" WHERE "meeting_v2_id" = ${meetingId}) AS "documentSections",
      (SELECT count(*)::int FROM "meetings_v2_document_chunks" WHERE "meeting_v2_id" = ${meetingId}) AS "documentChunks",
      (SELECT count(*)::int FROM "meetings_v2_agenda_items" WHERE "meeting_v2_id" = ${meetingId}) AS "agendaItems",
      (SELECT count(*)::int FROM "meetings_v2_agenda_item_contexts" WHERE "meeting_v2_id" = ${meetingId}) AS "evidenceContexts",
      (SELECT count(*)::int FROM "meetings_v2_agenda_item_investigations" WHERE "meeting_v2_id" = ${meetingId}) AS "investigations",
      (SELECT count(*)::int FROM "meetings_v2_validation_results" WHERE "meeting_v2_id" = ${meetingId}) AS "validations",
      (SELECT count(*)::int FROM "meetings_v2_minutes_drafts" WHERE "meeting_v2_id" = ${meetingId}) AS "drafts"
  `);

  const row = (result.rows?.[0] ?? (result as unknown as Record<string, unknown>[])[0] ?? {}) as Record<string, unknown>;

  return {
    sourceArtifacts: Number(row.sourceArtifacts ?? 0),
    transcriptSegments: Number(row.transcriptSegments ?? 0),
    documentPages: Number(row.documentPages ?? 0),
    documentSections: Number(row.documentSections ?? 0),
    documentChunks: Number(row.documentChunks ?? 0),
    agendaItems: Number(row.agendaItems ?? 0),
    evidenceContexts: Number(row.evidenceContexts ?? 0),
    investigations: Number(row.investigations ?? 0),
    validations: Number(row.validations ?? 0),
    drafts: Number(row.drafts ?? 0),
  };
}

export function deriveMeetingV2ComputedStatus(counts: {
  sourceArtifacts: number;
  transcriptSegments: number;
  documentPages: number;
  documentSections: number;
  documentChunks: number;
  agendaItems: number;
  evidenceContexts: number;
  investigations: number;
  validations: number;
}): {
  pipelineState: StatusState;
  currentStep: string;
  progressPercent: number;
  isConsistent: boolean;
  note: string;
} {
  if (counts.documentChunks === 0 || counts.transcriptSegments === 0 || counts.documentPages === 0) {
    return {
      pipelineState: counts.sourceArtifacts > 0 ? "ingesting" : "created",
      currentStep: counts.sourceArtifacts > 0 ? "Source ingestion incomplete" : "Ready to start",
      progressPercent: counts.sourceArtifacts > 0 ? 10 : 0,
      isConsistent: false,
      note: "Base source ingest is incomplete.",
    };
  }

  if (counts.agendaItems === 0) {
    return {
      pipelineState: "extracting",
      currentStep: "Agenda extraction incomplete",
      progressPercent: 30,
      isConsistent: false,
      note: "Agenda items have not been extracted yet.",
    };
  }

  if (counts.evidenceContexts < counts.agendaItems) {
    return {
      pipelineState: "gathering_evidence",
      currentStep: "Evidence gathering incomplete",
      progressPercent: 55,
      isConsistent: false,
      note: "Evidence contexts are missing for one or more agenda items.",
    };
  }

  if (counts.investigations < counts.agendaItems) {
    return {
      pipelineState: "investigating",
      currentStep: "Agenda investigation incomplete",
      progressPercent: 75,
      isConsistent: false,
      note: "Investigations are missing for one or more agenda items.",
    };
  }

  if (counts.validations < counts.investigations) {
    return {
      pipelineState: "validating",
      currentStep: "Validation incomplete",
      progressPercent: 90,
      isConsistent: false,
      note: "Validation results are missing for one or more investigated agenda items.",
    };
  }

  return {
    pipelineState: "validated",
    currentStep: "Ready for review",
    progressPercent: 100,
    isConsistent: true,
    note: "Stored pipeline data is complete through validation.",
  };
}

export function isMeetingV2PipelineNotStarted(pipelineState: string): boolean {
  return pipelineState === "created";
}

export type MeetingV2DashboardCard = Pick<
  MeetingV2Row,
  "id" | "title" | "meetingDate" | "pipelineState"
> & {
  progressLabel: string;
  progressStepNumber: number;
  progressTotalSteps: number;
  progressNote: string;
  progressStatus: "complete" | "in_progress" | "incomplete";
};

export async function loadMeetingsV2DashboardCards(
  meetingRows: MeetingV2Row[],
): Promise<MeetingV2DashboardCard[]> {
  const db = getDb();

  return Promise.all(
    meetingRows.map(async (meeting) => {
      const [counts, investigations, validations, latestDraft] = await Promise.all([
        getMeetingV2Counts(meeting.id),
        db
          .select({
            openQuestionsJson: meetingsV2AgendaItemInvestigations.openQuestionsJson,
          })
          .from(meetingsV2AgendaItemInvestigations)
          .where(eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meeting.id)),
        db
          .select({
            agendaItemId: meetingsV2ValidationResults.agendaItemId,
            severity: meetingsV2ValidationResults.severity,
          })
          .from(meetingsV2ValidationResults)
          .where(eq(meetingsV2ValidationResults.meetingV2Id, meeting.id)),
        db
          .select({ id: meetingsV2MinutesDrafts.id })
          .from(meetingsV2MinutesDrafts)
          .where(eq(meetingsV2MinutesDrafts.meetingV2Id, meeting.id))
          .limit(1),
      ]);

      const pipelineNotStarted = isMeetingV2PipelineNotStarted(meeting.pipelineState);
      const pipelineActivelyRunning = isMeetingV2PipelineActivelyRunning({
        pipelineState: meeting.pipelineState,
        lastError: meeting.lastError,
      });
      const stages = buildMeetingV2Stages({
        counts,
        extractionQuality: {
          likelyIncomplete: false,
          note: "",
        } as MeetingV2ExtractionQuality,
        pipelineNotStarted,
      });
      const needsClarificationCount = investigations.filter((investigation) => {
        const openQuestions = safeJsonParse<string[]>(investigation.openQuestionsJson, []);
        return openQuestions.length > 0;
      }).length;
      const flaggedAgendaItemIds = new Set(
        validations
          .filter(
            (validation) => validation.severity === "error" || validation.severity === "warning",
          )
          .map((validation) => validation.agendaItemId),
      );
      const workflowProgress = buildMeetingV2WorkflowProgress({
        pipelineStages: stages.map((stage) => ({
          key: stage.key,
          label: stage.label,
          status: stage.status,
          note: stage.note,
        })),
        agendaItemCount: counts.agendaItems,
        needsClarificationCount,
        flaggedCount: flaggedAgendaItemIds.size,
        draftCount: counts.drafts,
        hasLatestDraft: latestDraft.length > 0,
      });
      const displayProgress = buildMeetingV2DisplayProgress({
        pipelineNotStarted,
        pipelineActivelyRunning,
        pipelineState: meeting.pipelineState,
        storedProgressPercent: meeting.progressPercent,
        storedCurrentStep: meeting.currentStep,
        workflowProgress,
      });
      const activeStep =
        workflowProgress.steps.find((step) => step.status === "in_progress") ??
        workflowProgress.steps.find((step) => step.status !== "complete") ??
        workflowProgress.steps[workflowProgress.steps.length - 1];
      const activeStepIndex = workflowProgress.steps.findIndex((step) => step.key === activeStep.key);

      return {
        id: meeting.id,
        title: meeting.title,
        meetingDate: meeting.meetingDate,
        pipelineState: meeting.pipelineState,
        progressLabel: displayProgress.currentLabel,
        progressStepNumber: activeStepIndex >= 0 ? activeStepIndex + 1 : workflowProgress.totalCount,
        progressTotalSteps: workflowProgress.totalCount,
        progressNote: displayProgress.currentStep,
        progressStatus: activeStep?.status ?? "incomplete",
      };
    }),
  );
}

function buildMeetingV2Stages(options: {
  counts: MeetingV2Detail["meeting"]["counts"];
  extractionQuality: MeetingV2ExtractionQuality;
  pipelineNotStarted?: boolean;
}): MeetingV2Detail["meeting"]["stages"] {
  const { counts, extractionQuality, pipelineNotStarted = false } = options;

  if (pipelineNotStarted) {
    return [
      {
        key: "ingest",
        label: "Ingest",
        status: "incomplete",
        note: "Transcript and board package will be processed when you start the pipeline.",
        progressPercent: 0,
      },
      {
        key: "extract",
        label: "Extract",
        status: "incomplete",
        note: "Agenda extraction has not run yet.",
        progressPercent: 0,
      },
      {
        key: "evidence",
        label: "Evidence",
        status: "incomplete",
        note: "Evidence gathering starts after agenda extraction.",
        progressPercent: 0,
      },
      {
        key: "investigate",
        label: "Investigate",
        status: "incomplete",
        note: "Investigation starts after evidence is gathered.",
        progressPercent: 0,
      },
      {
        key: "validate",
        label: "Validate",
        status: "incomplete",
        note: "Validation runs after investigation completes.",
        progressPercent: 0,
      },
    ];
  }
  const ingestComplete =
    counts.sourceArtifacts > 0 &&
    counts.transcriptSegments > 0 &&
    counts.documentPages > 0 &&
    counts.documentSections > 0 &&
    counts.documentChunks > 0;
  const extractComplete = counts.agendaItems > 0 && !extractionQuality.likelyIncomplete;
  const evidenceComplete = counts.agendaItems > 0 && counts.evidenceContexts >= counts.agendaItems;
  const investigateComplete = counts.agendaItems > 0 && counts.investigations >= counts.agendaItems;
  const validateComplete = counts.investigations > 0 && counts.validations >= counts.investigations;

  return [
    {
      key: "ingest",
      label: "Ingest",
      status: ingestComplete ? "complete" : counts.sourceArtifacts > 0 ? "in_progress" : "incomplete",
      note: ingestComplete ? "Transcript, pages, sections, and chunks are stored." : "Base source rows are still incomplete.",
      progressPercent: ingestComplete ? 100 : counts.sourceArtifacts > 0 ? 50 : 0,
    },
    {
      key: "extract",
      label: "Extract",
      status: extractComplete
        ? "complete"
        : extractionQuality.likelyIncomplete
          ? "incomplete"
          : counts.agendaItems > 0
            ? "in_progress"
            : "incomplete",
      note: extractionQuality.note,
      progressPercent: extractComplete ? 100 : counts.agendaItems > 0 ? 60 : 0,
    },
    {
      key: "evidence",
      label: "Evidence",
      status: evidenceComplete
        ? "complete"
        : counts.evidenceContexts > 0
          ? "in_progress"
          : "incomplete",
      note: `${counts.evidenceContexts}/${counts.agendaItems} agenda items have assembled evidence context.`,
      progressPercent: counts.agendaItems > 0 ? Math.min(100, Math.round((counts.evidenceContexts / counts.agendaItems) * 100)) : 0,
    },
    {
      key: "investigate",
      label: "Investigate",
      status: investigateComplete
        ? "complete"
        : counts.investigations > 0
          ? "in_progress"
          : "incomplete",
      note: `${counts.investigations}/${counts.agendaItems} agenda items have investigation output.`,
      progressPercent: counts.agendaItems > 0 ? Math.min(100, Math.round((counts.investigations / counts.agendaItems) * 100)) : 0,
    },
    {
      key: "validate",
      label: "Validate",
      status: validateComplete
        ? "complete"
        : counts.validations > 0
          ? "in_progress"
          : "incomplete",
      note: `${counts.validations}/${counts.investigations} investigations have validation results.`,
      progressPercent: counts.investigations > 0 ? Math.min(100, Math.round((counts.validations / counts.investigations) * 100)) : 0,
    },
  ];
}

export async function assessMeetingV2Extraction(
  meetingId: string,
  preloaded?: {
    meeting?: typeof meetingsV2.$inferSelect;
    agendaItems?: Array<{ title: string; sourceSectionId: string | null; itemType: string }>;
    documentSections?: Array<{ title: string }>;
    pipelineNotStarted?: boolean;
  },
): Promise<MeetingV2ExtractionQuality> {
  const db = getDb();
  const [meetingRows, agendaItems, documentSections, agendaChunkSnapshots] = await Promise.all([
    preloaded?.meeting
      ? [preloaded.meeting]
      : db.select().from(meetingsV2).where(eq(meetingsV2.id, meetingId)),
    preloaded?.agendaItems
      ? preloaded.agendaItems
      : db
          .select({
            title: meetingsV2AgendaItems.title,
            sourceSectionId: meetingsV2AgendaItems.sourceSectionId,
            itemType: meetingsV2AgendaItems.itemType,
          })
          .from(meetingsV2AgendaItems)
          .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId)),
    preloaded?.documentSections
      ? preloaded.documentSections
      : db
          .select({
            title: meetingsV2DocumentSections.title,
          })
          .from(meetingsV2DocumentSections)
          .where(eq(meetingsV2DocumentSections.meetingV2Id, meetingId)),
    getMeetingV2AgendaChunkSnapshotCount(meetingId),
  ]);

  const selectedMeeting = preloaded?.meeting ?? meetingRows[0];
  const settings = readMeetingV2Settings(
    selectedMeeting?.settings as MeetingV2Settings | null | undefined,
  );
  const pipelineNotStarted =
    preloaded?.pipelineNotStarted ??
    isMeetingV2PipelineNotStarted(selectedMeeting?.pipelineState ?? "created");

  return analyzeExtractionQuality({
    agendaItems,
    documentSectionCount: documentSections.length,
    documentSections: documentSections.map((s) => ({ title: s.title })),
    extractionRun: settings.extractionRun ?? null,
    agendaChunkSnapshots,
    deepSeekKeyConfigured: isDeepSeekKeyConfigured(),
    lastError: selectedMeeting?.lastError ?? null,
    pipelineNotStarted,
  });
}

async function ensureSourceArtifact(
  meetingId: string,
  type: "transcript" | "board_package" | "style_reference_minutes" | "gold_standard_minutes",
  storedPath: string,
  originalFilename: string,
  mimeType: string,
  pageCount: number | null,
): Promise<typeof meetingsV2SourceArtifacts.$inferSelect> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(meetingsV2SourceArtifacts)
    .where(
      and(
        eq(meetingsV2SourceArtifacts.meetingV2Id, meetingId),
        eq(meetingsV2SourceArtifacts.type, type),
      ),
    );
  if (existing) return existing;

  const absolutePath = resolveStoredPath(storedPath);
  if (!absolutePath) {
    throw new Error(`Missing storage path for ${type}.`);
  }
  const buffer = await readFile(absolutePath);
  const createdAt = nowIso();
  const row = {
    id: randomUUID(),
    meetingV2Id: meetingId,
    type,
    referenceClassification: type === "board_package" ? "input_only" : null,
    originalFilename,
    mimeType,
    storagePath: storedPath,
    checksum: checksumFor(buffer),
    sizeBytes: buffer.byteLength,
    pageCount,
    createdAt,
  } satisfies typeof meetingsV2SourceArtifacts.$inferInsert;
  await db.insert(meetingsV2SourceArtifacts).values(row);
  return row;
}

export async function ingestMeetingV2Sources(meetingId: string): Promise<{
  transcriptSegments: number;
  documentPages: number;
  documentSections: number;
  documentChunks: number;
}> {
  await ensureMeetingV2Seed(meetingId);
  const db = getDb();
  const legacyMeeting = await getLegacyMeeting(meetingId);

  const existingArtifacts = await db
    .select()
    .from(meetingsV2SourceArtifacts)
    .where(eq(meetingsV2SourceArtifacts.meetingV2Id, meetingId));

  const existingSegments = await db
    .select()
    .from(meetingsV2TranscriptSegments)
    .where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId));
  const existingPages = await db
    .select()
    .from(meetingsV2DocumentPages)
    .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId));
  const existingSections = await db
    .select()
    .from(meetingsV2DocumentSections)
    .where(eq(meetingsV2DocumentSections.meetingV2Id, meetingId));
  const existingChunks = await db
    .select()
    .from(meetingsV2DocumentChunks)
    .where(eq(meetingsV2DocumentChunks.meetingV2Id, meetingId));

  if (
    existingArtifacts.length > 0 &&
    existingSegments.length > 0 &&
    existingPages.length > 0 &&
    existingSections.length > 0 &&
    existingChunks.length > 0
  ) {
    return {
      transcriptSegments: existingSegments.length,
      documentPages: existingPages.length,
      documentSections: existingSections.length,
      documentChunks: existingChunks.length,
    };
  }

  const transcriptPath = resolveStoredPath(legacyMeeting.vttFilePath);
  const boardPackagePath = resolveStoredPath(
    legacyMeeting.boardPackageFilePath || legacyMeeting.pdfFilePath,
  );

  if (!transcriptPath) {
    throw new Error("Legacy meeting is missing the transcript path.");
  }
  if (!boardPackagePath) {
    throw new Error("Legacy meeting is missing the board package path.");
  }

  const transcriptBuffer = await readFile(transcriptPath);
  const boardPackageBuffer = await readFile(boardPackagePath);
  const transcriptText = transcriptBuffer.toString("utf8");
  const transcriptCues = parseVttCues(transcriptText);

  const transcriptArtifact = await ensureSourceArtifact(
    meetingId,
    "transcript",
    legacyMeeting.vttFilePath,
    path.basename(legacyMeeting.vttFilePath),
    "text/vtt",
    null,
  );
  const existingPageCount = existingPages.length;
  let extractedPageCount = existingPageCount;
  const boardPackageArtifact = await ensureSourceArtifact(
    meetingId,
    "board_package",
    legacyMeeting.boardPackageFilePath || legacyMeeting.pdfFilePath,
    path.basename(legacyMeeting.boardPackageFilePath || legacyMeeting.pdfFilePath),
    "application/pdf",
    null,
  );

  if (existingSegments.length < transcriptCues.length) {
    const segmentRows = transcriptCues.slice(existingSegments.length).map((cue, index) => ({
      id: randomUUID(),
      meetingV2Id: meetingId,
      sourceArtifactId: transcriptArtifact.id,
      sequence: existingSegments.length + index,
      startMs: vttTimestampToMs(cue.start),
      endMs: vttTimestampToMs(cue.end),
      startTimestamp: cue.start,
      endTimestamp: cue.end,
      speakerLabel: cue.speaker || null,
      text: cue.text,
      rawCueId: null,
    })) satisfies Array<typeof meetingsV2TranscriptSegments.$inferInsert>;
    if (segmentRows.length > 0) {
      await db.insert(meetingsV2TranscriptSegments).values(segmentRows);
    }
  }

  const pdfExtract = await extractPdfPagesWithText(boardPackageBuffer, {
    startPage: existingPageCount + 1,
    pdfPath: boardPackagePath,
    maxDoclingPages: 20,
    onPage: async (page, totalPages) => {
      await db.insert(meetingsV2DocumentPages).values({
        id: randomUUID(),
        meetingV2Id: meetingId,
        sourceArtifactId: boardPackageArtifact.id,
        pageNumber: page.pageNumber,
        pageHeading: page.heading?.replace(/\x00/g, ''),
        extractedText: page.text.replace(/\x00/g, ''),
        imagePath: null,
        createdAt: nowIso(),
      });
      extractedPageCount += 1;
      await updatePhaseProgress({
        meetingId,
        pipelineState: "ingesting",
        basePercent: 5,
        spanPercent: 15,
        current: extractedPageCount,
        total: totalPages,
        label: `Ingesting board package pages (${extractedPageCount}/${totalPages})`,
      });
    },
  });

  await db
    .update(meetingsV2SourceArtifacts)
    .set({ pageCount: pdfExtract.pageCount })
    .where(eq(meetingsV2SourceArtifacts.id, boardPackageArtifact.id));

  const pages = existingPages.length > 0
    ? await db
        .select()
        .from(meetingsV2DocumentPages)
        .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId))
    : await db
        .select()
        .from(meetingsV2DocumentPages)
        .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId));
  const segments = existingSegments.length > 0
    ? await db
        .select()
        .from(meetingsV2TranscriptSegments)
        .where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId))
    : await db
        .select()
        .from(meetingsV2TranscriptSegments)
        .where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId));

  if (existingSections.length < pages.length) {
    const existingSectionKeys = new Set(
      existingSections.map((section) => `${section.startPage}:${section.endPage}:${section.title}`),
    );
    const missingSectionRows = buildBasicDocumentSections(
      pages.map((page) => ({
        pageNumber: page.pageNumber,
        heading: page.pageHeading,
      })),
    )
      .filter(
        (section) =>
          !existingSectionKeys.has(`${section.startPage}:${section.endPage}:${section.title}`),
      )
      .map((section) => ({
        id: randomUUID(),
        meetingV2Id: meetingId,
        sourceArtifactId: boardPackageArtifact.id,
        title: section.title,
        startPage: section.startPage,
        endPage: section.endPage,
        summary: null,
        sortOrder: section.sortOrder,
        createdAt: nowIso(),
      })) satisfies Array<typeof meetingsV2DocumentSections.$inferInsert>;
    if (missingSectionRows.length > 0) {
      await db.insert(meetingsV2DocumentSections).values(missingSectionRows);
    }
  }

  if (existingChunks.length === 0) {
    const documentChunks = chunkDocumentPages(pages).map((chunk) => ({
      id: randomUUID(),
      meetingV2Id: meetingId,
      sourceArtifactId: boardPackageArtifact.id,
      chunkKey: chunk.chunkKey,
      chunkKind: "document" as const,
      sortOrder: chunk.sortOrder,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      sequenceStart: null,
      sequenceEnd: null,
      startTimestamp: null,
      endTimestamp: null,
      text: chunk.text,
      metadataJson: JSON.stringify(chunk.metadata),
      createdAt: nowIso(),
    })) satisfies Array<typeof meetingsV2DocumentChunks.$inferInsert>;
    const transcriptChunks = chunkTranscriptSegments(segments).map((chunk) => ({
      id: randomUUID(),
      meetingV2Id: meetingId,
      sourceArtifactId: transcriptArtifact.id,
      chunkKey: chunk.chunkKey,
      chunkKind: "transcript" as const,
      sortOrder: documentChunks.length + chunk.sortOrder,
      pageStart: null,
      pageEnd: null,
      sequenceStart: chunk.sequenceStart,
      sequenceEnd: chunk.sequenceEnd,
      startTimestamp: chunk.startTimestamp,
      endTimestamp: chunk.endTimestamp,
      text: chunk.text,
      metadataJson: JSON.stringify(chunk.metadata),
      createdAt: nowIso(),
    })) satisfies Array<typeof meetingsV2DocumentChunks.$inferInsert>;
    const allChunks = [...documentChunks, ...transcriptChunks];
    if (allChunks.length > 0) {
      await db.insert(meetingsV2DocumentChunks).values(allChunks);
    }
  }

  const refreshedSegments = await db
    .select()
    .from(meetingsV2TranscriptSegments)
    .where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId));
  const refreshedPages = await db
    .select()
    .from(meetingsV2DocumentPages)
    .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId));
  const refreshedSections = await db
    .select()
    .from(meetingsV2DocumentSections)
    .where(eq(meetingsV2DocumentSections.meetingV2Id, meetingId));
  const refreshedChunks = await db
    .select()
    .from(meetingsV2DocumentChunks)
    .where(eq(meetingsV2DocumentChunks.meetingV2Id, meetingId));

  return {
    transcriptSegments: refreshedSegments.length,
    documentPages: refreshedPages.length,
    documentSections: refreshedSections.length,
    documentChunks: refreshedChunks.length,
  };
}

async function clearAgendaDerivedData(meetingId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(meetingsV2AgendaChunkSnapshots)
    .where(eq(meetingsV2AgendaChunkSnapshots.meetingV2Id, meetingId));
  await db
    .delete(meetingsV2ValidationResults)
    .where(eq(meetingsV2ValidationResults.meetingV2Id, meetingId));
  await db
    .delete(meetingsV2AgendaItemInvestigations)
    .where(eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meetingId));
  await db
    .delete(meetingsV2AgendaItemContexts)
    .where(eq(meetingsV2AgendaItemContexts.meetingV2Id, meetingId));
  await db
    .delete(meetingsV2AgendaItemEvidence)
    .where(eq(meetingsV2AgendaItemEvidence.meetingV2Id, meetingId));
  await db
    .delete(meetingsV2MinutesDrafts)
    .where(eq(meetingsV2MinutesDrafts.meetingV2Id, meetingId));
  await db.delete(meetingsV2AgendaItems).where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId));
}

async function clearMeetingV2DownstreamData(meetingId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(meetingsV2ValidationResults)
    .where(eq(meetingsV2ValidationResults.meetingV2Id, meetingId));
  await db
    .delete(meetingsV2AgendaItemInvestigations)
    .where(eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meetingId));
  await db
    .delete(meetingsV2AgendaItemContexts)
    .where(eq(meetingsV2AgendaItemContexts.meetingV2Id, meetingId));
  await db
    .delete(meetingsV2AgendaItemEvidence)
    .where(eq(meetingsV2AgendaItemEvidence.meetingV2Id, meetingId));
  await db
    .delete(meetingsV2MinutesDrafts)
    .where(eq(meetingsV2MinutesDrafts.meetingV2Id, meetingId));
}

export async function extractMeetingV2Agenda(meetingId: string): Promise<{ count: number }> {
  const db = getDb();

  const [sections, pages, boardPackage] = await Promise.all([
    db
      .select()
      .from(meetingsV2DocumentSections)
      .where(eq(meetingsV2DocumentSections.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2DocumentSections.sortOrder)),
    db
      .select()
      .from(meetingsV2DocumentPages)
      .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2DocumentPages.pageNumber)),
    db
      .select()
      .from(meetingsV2SourceArtifacts)
      .where(
        and(
          eq(meetingsV2SourceArtifacts.meetingV2Id, meetingId),
          eq(meetingsV2SourceArtifacts.type, "board_package"),
        ),
      ),
  ]);

  const sourceArtifactId = boardPackage[0]?.id ?? null;
  const sectionRows = sections.length > 0
    ? sections
    : pages.map((page, index) => ({
        id: `synthetic-page-${page.id}`,
        meetingV2Id: meetingId,
        sourceArtifactId: page.sourceArtifactId,
        title: page.pageHeading ?? `Page ${page.pageNumber}`,
        startPage: page.pageNumber,
        endPage: page.pageNumber,
        summary: null,
        sortOrder: index,
        createdAt: page.createdAt,
      }));

  const existingAgendaItems = await db
    .select()
    .from(meetingsV2AgendaItems)
    .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId));
  const existingKeys = new Set(
    existingAgendaItems.map((item) => `${item.sourceSectionId ?? "no-section"}:${item.normalizedTitle}`),
  );

  if (isDeepSeekKeyConfigured()) {
    try {
      const result = await extractAgendaItemsWithAi(meetingId, {
        onProgress: async ({ current, total, label }) => {
          await updatePhaseProgress({
            meetingId,
            pipelineState: "extracting",
            basePercent: 25,
            spanPercent: 15,
            current,
            total,
            label,
          });
        },
      });
      await recordMeetingV2ExtractionRun(meetingId, {
        extractor: "deepseek_incremental",
        deepSeekKeyConfigured: true,
        agendaItemCount: result.agendaItemCount,
        apiError: null,
      });
      return { count: result.agendaItemCount };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "DeepSeek agenda extraction failed.";
      await recordMeetingV2ExtractionRun(meetingId, {
        extractor: "deepseek_incremental",
        deepSeekKeyConfigured: true,
        agendaItemCount: 0,
        apiError: message,
      });
      throw error;
    }
  }

  let processedCount = existingAgendaItems.length;
  const agendaRows: Array<typeof meetingsV2AgendaItems.$inferInsert> = [];
  const extractionSource = sectionRows.map((section, index) => ({
    title: section.title,
    sectionLabel: section.title,
    normalizedTitle: toSlug(section.title) || `item-${index + 1}`,
    itemType: "agenda_section",
    sourcePages: Array.from(
      { length: section.endPage - section.startPage + 1 },
      (_, pageIndex) => section.startPage + pageIndex,
    ),
    sourceText: sectionRangeText(pages, section),
    sortOrder: index,
  }));

  for (const [index, item] of extractionSource.entries()) {
    const sourceSection = sections.find((section) =>
      item.sourcePages.some(
        (pageNumber) => section.startPage <= pageNumber && section.endPage >= pageNumber,
      ),
    );
    const sourceSectionId = sourceSection?.id ?? null;
    const key = `${sourceSectionId ?? "no-section"}:${item.normalizedTitle}`;
    if (existingKeys.has(key)) continue;
    agendaRows.push({
      id: randomUUID(),
      meetingV2Id: meetingId,
      sourceArtifactId: sourceArtifactId ?? sourceSection?.sourceArtifactId ?? null,
      sourceSectionId,
      sectionLabel: item.sectionLabel,
      title: item.title,
      normalizedTitle: item.normalizedTitle,
      itemNumber: String(index + 1),
      itemType: item.itemType,
      sourcePagesJson: JSON.stringify(item.sourcePages),
      sourceText: item.sourceText,
      sortOrder: item.sortOrder,
      createdAt: nowIso(),
    });
    processedCount += 1;
    await updatePhaseProgress({
      meetingId,
      pipelineState: "extracting",
      basePercent: 25,
      spanPercent: 15,
      current: processedCount,
      total: extractionSource.length,
      label: `Extracting agenda items (${processedCount}/${extractionSource.length})`,
    });
  }

  if (agendaRows.length > 0) {
    await db.insert(meetingsV2AgendaItems).values(agendaRows);
  }

  const agendaItemCount = existingAgendaItems.length + agendaRows.length;
  await recordMeetingV2ExtractionRun(meetingId, {
    extractor: "section_fallback",
    deepSeekKeyConfigured: false,
    agendaItemCount,
    apiError: null,
  });

  return { count: agendaItemCount };
}

function scoreTextMatch(text: string, keywords: string[]): number {
  const normalized = normalizeWhitespace(text).toLowerCase();
  return keywords.reduce((score, keyword) => {
    if (!normalized.includes(keyword)) return score;
    const occurrences = normalized.split(keyword).length - 1;
    return score + occurrences * 10;
  }, 0);
}

function inferOutcome(text: string, answerText: string | null): string {
  const normalized = `${text}\n${answerText ?? ""}`.toLowerCase();
  if (normalized.includes("approved") || normalized.includes("carried")) return "approved";
  if (normalized.includes("defer")) return "deferred";
  if (normalized.includes("tabled")) return "tabled";
  if (normalized.includes("ratified")) return "ratified";
  if (normalized.includes("declined") || normalized.includes("rejected")) return "rejected";
  return answerText ? "clarified_by_user" : "discussion_logged";
}

function inferConfidence(
  evidenceCount: number,
  answerText: string | null,
  openQuestions: string[],
): string {
  if (answerText) return "high";
  if (evidenceCount >= 4 && openQuestions.length === 0) return "high";
  if (evidenceCount >= 2) return "medium";
  return "low";
}

function inferVisibility(title: string): string {
  const normalized = title.toLowerCase();
  if (
    normalized.includes("legal") ||
    normalized.includes("personnel") ||
    normalized.includes("litigation") ||
    normalized.includes("owner")
  ) {
    return "in_camera";
  }
  return "open";
}

function buildOpenQuestions(title: string, transcriptEvidenceCount: number, answerText: string | null): Array<{ question: string; recommended_answer: string; confidence: "high" | "medium" | "low" }> {
  if (answerText) return [];
  if (transcriptEvidenceCount > 0) return [];
  return [{ question: `Can you confirm the final outcome for "${title}" from the live discussion?`, recommended_answer: "Based on context, the item was discussed but may require confirmation.", confidence: "low" }];
}

type AiInvestigationDocument = {
  discussion_summary: string;
  outcome: "APPROVED" | "REJECTED" | "DEFERRED" | "NO_DECISION" | "INFORMATION_ONLY" | "UNCLEAR";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
  visibility: "PUBLIC" | "RESTRICTED" | "UNKNOWN";
  decisions: string[];
  motion: {
    moved_by: string | null;
    seconded_by: string | null;
    resolution_text: string | null;
    result: "CARRIED" | "DEFEATED" | "DEFERRED" | "UNKNOWN";
    is_candidate?: boolean;
      } | null;
  actions: Array<{
    owner: string | null;
    description: string;
    due_date: string | null;
  }>;
  open_questions: Array<{ question: string; recommended_answer: string; confidence: "high" | "medium" | "low" }>;
};

type AiValidationDocument = {
  verdict: "pass" | "review_required" | "fail";
  validator_confidence: "high" | "medium" | "low";
  summary: string;
  needs_human_review: boolean;
  issues: Array<{
    severity: "error" | "warning" | "info";
    code: string;
    message: string;
    evidence: string[];
    suggested_fix: string | null;
  }>;
  strengths: string[];
  suggested_actions: string[];
};

type ValidationSeverity = "error" | "warning" | "info";

function normalizeInvestigationDocument(value: unknown): AiInvestigationDocument {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const outcome = typeof record.outcome === "string" ? record.outcome.trim().toUpperCase() : "UNCLEAR";
  const confidence = typeof record.confidence === "string" ? record.confidence.trim().toUpperCase() : "LOW";
  const visibility = typeof record.visibility === "string" ? record.visibility.trim().toUpperCase() : "UNKNOWN";
  const motionRecord = record.motion && typeof record.motion === "object"
    ? (record.motion as Record<string, unknown>)
    : null;
  return {
    discussion_summary: normalizeWhitespace(typeof record.discussion_summary === "string" ? record.discussion_summary : ""),
    outcome:
      outcome === "APPROVED" || outcome === "REJECTED" || outcome === "DEFERRED" || outcome === "NO_DECISION" ||
      outcome === "INFORMATION_ONLY" || outcome === "UNCLEAR" || false
        ? (outcome as AiInvestigationDocument["outcome"])
        : "UNCLEAR",
    confidence:
      confidence === "HIGH" || confidence === "MEDIUM" || confidence === "LOW" || confidence === "INSUFFICIENT"
        ? (confidence as AiInvestigationDocument["confidence"])
        : "LOW",
    visibility:
      visibility === "PUBLIC" || visibility === "RESTRICTED" || visibility === "UNKNOWN"
        ? (visibility as AiInvestigationDocument["visibility"])
        : "UNKNOWN",
    decisions: Array.isArray(record.decisions)
      ? record.decisions.filter((entry): entry is string => typeof entry === "string").map(normalizeWhitespace).filter(Boolean)
      : [],
    motion: motionRecord
      ? {
          moved_by: typeof motionRecord.moved_by === "string" && motionRecord.moved_by.trim() ? motionRecord.moved_by.trim() : null,
          seconded_by: typeof motionRecord.seconded_by === "string" && motionRecord.seconded_by.trim() ? motionRecord.seconded_by.trim() : null,
          resolution_text:
            typeof motionRecord.resolution_text === "string" && motionRecord.resolution_text.trim()
              ? normalizeWhitespace(motionRecord.resolution_text)
              : null,
          result:
            motionRecord.result === "CARRIED" || motionRecord.result === "DEFEATED" || motionRecord.result === "DEFERRED" || motionRecord.result === "UNKNOWN"
              ? (motionRecord.result as NonNullable<AiInvestigationDocument["motion"]>["result"])
              : "UNKNOWN",
          is_candidate: motionRecord.is_candidate === true,
                  }
      : null,
    actions: Array.isArray(record.actions)
      ? record.actions.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const action = entry as Record<string, unknown>;
          const description = typeof action.description === "string" ? normalizeWhitespace(action.description) : "";
          if (!description) return [];
          return [{
            owner: typeof action.owner === "string" && action.owner.trim() ? action.owner.trim() : null,
            description,
            due_date: typeof action.due_date === "string" && action.due_date.trim() ? action.due_date.trim() : null,
          }];
        })
      : [],
    open_questions: Array.isArray(record.open_questions)
      ? record.open_questions.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null).map((entry: any) => ({
          question: typeof entry.question === "string" ? normalizeWhitespace(entry.question) : "",
          recommended_answer: typeof entry.recommended_answer === "string" ? normalizeWhitespace(entry.recommended_answer) : "",
          confidence: ["high", "medium", "low"].includes(entry.confidence?.toLowerCase()) ? entry.confidence.toLowerCase() : "medium",
        })).filter((q: any) => Boolean(q.question))
      : [],
  };
}

function normalizeValidationDocument(value: unknown): AiValidationDocument {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const verdict = typeof record.verdict === "string" ? record.verdict.trim().toLowerCase() : "review_required";
  const validatorConfidence =
    typeof record.validator_confidence === "string" ? record.validator_confidence.trim().toLowerCase() : "medium";
  return {
    verdict: verdict === "pass" || verdict === "review_required" || verdict === "fail"
      ? (verdict as AiValidationDocument["verdict"])
      : "review_required",
    validator_confidence:
      validatorConfidence === "high" || validatorConfidence === "medium" || validatorConfidence === "low"
        ? (validatorConfidence as AiValidationDocument["validator_confidence"])
        : "medium",
    summary: normalizeWhitespace(typeof record.summary === "string" ? record.summary : ""),
    needs_human_review: record.needs_human_review === true,
    issues: Array.isArray(record.issues)
      ? record.issues.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const issue = entry as Record<string, unknown>;
          const message = typeof issue.message === "string" ? normalizeWhitespace(issue.message) : "";
          if (!message) return [];
          const severity = typeof issue.severity === "string" ? issue.severity.trim().toLowerCase() : "warning";
          return [{
            severity: severity === "error" || severity === "warning" || severity === "info"
              ? (severity as AiValidationDocument["issues"][number]["severity"])
              : "warning",
            code:
              typeof issue.code === "string" && issue.code.trim()
                ? issue.code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
                : "review_issue",
            message,
            evidence: Array.isArray(issue.evidence)
              ? issue.evidence.filter((item): item is string => typeof item === "string").map(normalizeWhitespace).filter(Boolean)
              : [],
            suggested_fix:
              typeof issue.suggested_fix === "string" && issue.suggested_fix.trim()
                ? normalizeWhitespace(issue.suggested_fix)
                : null,
          }];
        })
      : [],
    strengths: Array.isArray(record.strengths)
      ? record.strengths.filter((entry): entry is string => typeof entry === "string").map(normalizeWhitespace).filter(Boolean)
      : [],
    suggested_actions: Array.isArray(record.suggested_actions)
      ? record.suggested_actions.filter((entry): entry is string => typeof entry === "string").map(normalizeWhitespace).filter(Boolean)
      : [],
  };
}

function getEvidenceText(
  contextDocument: AgendaItemContextDocument | null,
  chunkKind?: ChunkContext["chunkKind"],
): string {
  if (!contextDocument) return "";
  return contextDocument.anchorChunkIds
    .map((chunkId) => contextDocument.chunksById[chunkId] ?? null)
    .filter((entry): entry is ChunkContext => Boolean(entry))
    .filter((entry) => (chunkKind ? entry.chunkKind === chunkKind : true))
    .map((entry) => entry.text ?? "")
    .join("\n")
    .toLowerCase();
}

function hasCue(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

const APPROVAL_CUES = [
  /\bapproved?\b/i,
  /\bapproval\b/i,
  /\bcarried\b/i,
  /\bratified?\b/i,
  /\bmove ahead\b/i,
  /\bmoving ahead\b/i,
  /\bgo ahead\b/i,
  /\bproceed(?:ing)? with\b/i,
  /\bsuccessful contractor\b/i,
];

const REJECTION_CUES = [
  /\brejected?\b/i,
  /\bdefeated\b/i,
  /\bdeclined?\b/i,
  /\bnot approved\b/i,
  /\bwould not\b/i,
];

const DEFERRAL_CUES = [
  /\bdefer(?:red|ring)?\b/i,
  /\bopen items?\b/i,
  /\bbring (?:this )?back\b/i,
  /\bnext month\b/i,
  /\brevisit\b/i,
  /\bhold off\b/i,
  /\bnot cancelled\b/i,
  /\bno decision\b/i,
];

const NO_DECISION_CUES = [
  /\bno decision\b/i,
  /\bnot sure\b/i,
  /\bunclear\b/i,
  /\bdidn'?t really make a decision\b/i,
  /\bnot resolved\b/i,
];

function pushValidationRow(
  rows: Array<typeof meetingsV2ValidationResults.$inferInsert>,
  options: {
    meetingId: string;
    agendaItemId: string;
    validationType: string;
    severity: ValidationSeverity;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  },
) {
  rows.push({
    id: randomUUID(),
    meetingV2Id: options.meetingId,
    agendaItemId: options.agendaItemId,
    validationType: options.validationType,
    severity: options.severity,
    code: options.code,
    message: options.message,
    detailsJson: options.details ? JSON.stringify(options.details) : null,
    createdAt: nowIso(),
  });
}

function buildValidationInput(options: {
  agendaItem: typeof meetingsV2AgendaItems.$inferSelect;
  investigation: typeof meetingsV2AgendaItemInvestigations.$inferSelect;
  contextDocument: AgendaItemContextDocument | null;
  assembledContextText: string | null;
  transcriptEvidenceCount: number;
  documentEvidenceCount: number;
  investigationTrace: {
    toolCalls: Array<Record<string, unknown>>;
    requestTrace: Record<string, unknown> | null;
  };
}) {
  const decisions = safeJsonParse<string[]>(options.investigation.decisionsJson, []);
  const motion = safeJsonParse<Record<string, unknown> | null>(options.investigation.motionJson, null);
  const actions = safeJsonParse<Array<Record<string, unknown>>>(options.investigation.actionsJson, []);
  const openQuestions = safeJsonParse<string[]>(options.investigation.openQuestionsJson, []);
  const anchorChunks = options.contextDocument
    ? options.contextDocument.anchorChunkIds
        .map((chunkId) => options.contextDocument?.chunksById[chunkId] ?? null)
        .filter((entry): entry is ChunkContext => Boolean(entry))
        .map((chunk) => ({
          chunkId: chunk.chunkId,
          chunkKind: chunk.chunkKind,
          chunkLabel: chunk.chunkLabel ?? null,
          pageRange: chunk.pageRange ?? null,
          sequenceRange: chunk.sequenceRange ?? null,
          startTimestamp: chunk.startTimestamp ?? null,
          endTimestamp: chunk.endTimestamp ?? null,
          text: chunk.text ?? "",
        }))
    : [];

  return {
    agendaItem: {
      id: options.agendaItem.id,
      title: options.agendaItem.title,
      sectionLabel: options.agendaItem.sectionLabel,
      itemNumber: options.agendaItem.itemNumber,
      itemType: options.agendaItem.itemType,
      sourcePages: safeJsonParse<number[]>(options.agendaItem.sourcePagesJson, []),
      sourceText: options.agendaItem.sourceText,
    },
    investigation: {
      discussionSummary: options.investigation.discussionSummary,
      outcome: options.investigation.outcome,
      confidence: options.investigation.confidence,
      visibility: options.investigation.visibility,
      decisions,
      motion,
      actions,
      openQuestions,
      modelName: options.investigation.modelName,
    },
    evidence: {
      sourcePages: options.contextDocument?.sourcePages ?? [],
      sourceChunkIds: options.contextDocument?.sourceChunkIds ?? [],
      aliases: options.contextDocument?.aliases ?? [],
      notes: options.contextDocument?.notes ?? [],
      anchorChunkIds: options.contextDocument?.anchorChunkIds ?? [],
      transcriptEvidenceCount: options.transcriptEvidenceCount,
      documentEvidenceCount: options.documentEvidenceCount,
      assembledContextText: options.assembledContextText ?? "",
      anchorChunks,
      buildNotes: options.contextDocument?.buildNotes ?? [],
    },
    investigationTrace: options.investigationTrace,
  };
}

async function runAiValidationReview(options: {
  agendaItem: typeof meetingsV2AgendaItems.$inferSelect;
  investigation: typeof meetingsV2AgendaItemInvestigations.$inferSelect;
  contextDocument: AgendaItemContextDocument | null;
  assembledContextText: string | null;
  transcriptEvidenceCount: number;
  documentEvidenceCount: number;
  investigationTrace: {
    toolCalls: Array<Record<string, unknown>>;
    requestTrace: Record<string, unknown> | null;
  };
}) {
  const validationInput = buildValidationInput(options);
  const completion = await generateDeepSeekJson({
    systemInstruction: AGENDA_ITEM_VALIDATION_PROMPT,
    userText: JSON.stringify(validationInput, null, 2),
    modelName: "deepseek-v4-flash",
    maxOutputTokens: 8192,
    temperature: 0,
    thinking: false,
  });

  const parsed = normalizeValidationDocument(safeJsonObjectParse(completion.text));
  return {
    requestJson: {
      promptInput: validationInput,
    },
    responseText: completion.text,
    parsed,
    usage: completion.usage,
    modelName: completion.modelName,
  };
}

function addDeterministicValidationRows(options: {
  rows: Array<typeof meetingsV2ValidationResults.$inferInsert>;
  meetingId: string;
  agendaItem: typeof meetingsV2AgendaItems.$inferSelect;
  investigation: typeof meetingsV2AgendaItemInvestigations.$inferSelect | undefined;
  contextDocument: AgendaItemContextDocument | null;
}) {
  const { rows, meetingId, agendaItem, investigation, contextDocument } = options;

  if (!investigation) {
    pushValidationRow(rows, {
      meetingId,
      agendaItemId: agendaItem.id,
      validationType: "completeness",
      severity: "error",
      code: "missing_investigation",
      message: "Agenda item has not been investigated yet.",
      details: { title: agendaItem.title },
    });
    return { transcriptEvidenceCount: 0, documentEvidenceCount: 0 };
  }

  if (!contextDocument || contextDocument.anchorChunkIds.length === 0) {
    pushValidationRow(rows, {
      meetingId,
      agendaItemId: agendaItem.id,
      validationType: "evidence_support",
      severity: "error",
      code: "missing_evidence",
      message: "Investigation exists but no prepared evidence context is attached to this agenda item.",
      details: { title: agendaItem.title },
    });
  }

  const chunkContexts = contextDocument
    ? contextDocument.anchorChunkIds
        .map((chunkId) => contextDocument.chunksById[chunkId] ?? null)
        .filter((entry): entry is ChunkContext => Boolean(entry))
    : [];
  const transcriptEvidenceCount = chunkContexts.filter((entry) => entry.chunkKind === "transcript").length;
  const documentEvidenceCount = chunkContexts.filter((entry) => entry.chunkKind === "document").length;

  const decisions = safeJsonParse<string[]>(investigation.decisionsJson, []);
  const motion = safeJsonParse<AiInvestigationDocument["motion"]>(investigation.motionJson, null);
  const actions = safeJsonParse<Array<{ owner: string | null; description: string; due_date: string | null }>>(
    investigation.actionsJson,
    [],
  );
  const openQuestions = safeJsonParse<string[]>(investigation.openQuestionsJson, []);
  const transcriptEvidenceText = getEvidenceText(contextDocument, "transcript");

  if (investigation.confidence === "low" || investigation.confidence === "insufficient") {
    pushValidationRow(rows, {
      meetingId,
      agendaItemId: agendaItem.id,
      validationType: "confidence",
      severity: "warning",
      code: "low_confidence",
      message: `Investigation confidence is ${investigation.confidence}.`,
      details: { title: agendaItem.title, confidence: investigation.confidence },
    });
  }

  if (investigation.visibility === "unknown") {
    pushValidationRow(rows, {
      meetingId,
      agendaItemId: agendaItem.id,
      validationType: "business_rule",
      severity: "warning",
      code: "unknown_visibility",
      message: "Visibility/confidentiality is still unknown for this agenda item.",
      details: { title: agendaItem.title },
    });
  }

  if ((investigation.outcome === "approved" || investigation.outcome === "rejected") && decisions.length === 0 && !motion) {
    pushValidationRow(rows, {
      meetingId,
      agendaItemId: agendaItem.id,
      validationType: "completeness",
      severity: "warning",
      code: "missing_decision_detail",
      message: "Outcome is decisive, but no decision statement or motion details were captured.",
      details: { title: agendaItem.title, outcome: investigation.outcome },
    });
  }

  if (investigation.outcome === "approved" && !hasCue(transcriptEvidenceText, APPROVAL_CUES) && motion?.result !== "CARRIED") {
    pushValidationRow(rows, {
      meetingId,
      agendaItemId: agendaItem.id,
      validationType: "evidence_support",
      severity: "error",
      code: "unsupported_approval_outcome",
      message: "Outcome is APPROVED, but the prepared evidence does not clearly show approval language or a carried motion.",
      details: { title: agendaItem.title, outcome: investigation.outcome },
    });
  }

  if (investigation.outcome === "rejected" && !hasCue(transcriptEvidenceText, REJECTION_CUES) && motion?.result !== "DEFEATED") {
    pushValidationRow(rows, {
      meetingId,
      agendaItemId: agendaItem.id,
      validationType: "evidence_support",
      severity: "error",
      code: "unsupported_rejection_outcome",
      message: "Outcome is REJECTED, but the prepared evidence does not clearly show rejection language or a defeated motion.",
      details: { title: agendaItem.title, outcome: investigation.outcome },
    });
  }

  if (
    investigation.outcome === "deferred" &&
    !hasCue(transcriptEvidenceText, DEFERRAL_CUES) &&
    motion?.result !== "DEFERRED" &&
    actions.length === 0 &&
    openQuestions.length === 0
  ) {
    pushValidationRow(rows, {
      meetingId,
      agendaItemId: agendaItem.id,
      validationType: "evidence_support",
      severity: "warning",
      code: "unsupported_deferred_outcome",
      message: "Outcome is DEFERRED, but the prepared evidence does not clearly show deferral language.",
      details: { title: agendaItem.title, outcome: investigation.outcome },
    });
  }

  if ((investigation.outcome === "no_decision" || investigation.outcome === "unclear") && decisions.length > 0 && !hasCue(transcriptEvidenceText, NO_DECISION_CUES)) {
    pushValidationRow(rows, {
      meetingId,
      agendaItemId: agendaItem.id,
      validationType: "business_rule",
      severity: "warning",
      code: "decisions_present_with_non_decisive_outcome",
      message: "Outcome is non-decisive, but decision statements were still captured. Confirm they are not overstated.",
      details: { title: agendaItem.title, outcome: investigation.outcome, decisions },
    });
  }

  if (investigation.outcome === "information_only" && motion) {
    pushValidationRow(rows, {
      meetingId,
      agendaItemId: agendaItem.id,
      validationType: "business_rule",
      severity: "info",
      code: "information_only_contains_motion",
      message: "Outcome is INFORMATION_ONLY, but a motion was captured.",
      details: { title: agendaItem.title, hasMotion: true },
    });
  }

  if (motion) {
    const missingFields = [
      !motion.resolution_text ? "resolution_text" : null,
    ].filter(Boolean);
    if (missingFields.length > 0) {
      pushValidationRow(rows, {
        meetingId,
        agendaItemId: agendaItem.id,
        validationType: "schema",
        severity: "warning",
        code: "incomplete_motion",
        message: "Motion details were captured but are incomplete.",
        details: { title: agendaItem.title, missingFields },
      });
    }

    if (investigation.outcome === "approved" && (motion.result === "DEFEATED" || motion.result === "DEFERRED")) {
      pushValidationRow(rows, {
        meetingId,
        agendaItemId: agendaItem.id,
        validationType: "business_rule",
        severity: "error",
        code: "inconsistent_motion_result",
        message: "Outcome is APPROVED, but the recorded motion result is not consistent with approval.",
        details: { title: agendaItem.title, outcome: investigation.outcome, motionResult: motion.result },
      });
    }

    if ((investigation.outcome === "no_decision" || investigation.outcome === "unclear") && (motion.result === "CARRIED" || motion.result === "DEFEATED")) {
      pushValidationRow(rows, {
        meetingId,
        agendaItemId: agendaItem.id,
        validationType: "business_rule",
        severity: "warning",
        code: "non_decisive_outcome_with_decisive_motion",
        message: "Outcome is non-decisive, but the recorded motion result appears decisive. Confirm whether the outcome was understated.",
        details: { title: agendaItem.title, outcome: investigation.outcome, motionResult: motion.result },
      });
    }
  }



  if (transcriptEvidenceCount === 0 && documentEvidenceCount > 0) {
    pushValidationRow(rows, {
      meetingId,
      agendaItemId: agendaItem.id,
      validationType: "evidence_support",
      severity: "info",
      code: "document_only_support",
      message: "This agenda item is currently supported only by document evidence.",
      details: { title: agendaItem.title, documentEvidenceCount },
    });
  }

  if (documentEvidenceCount === 0 && transcriptEvidenceCount > 0) {
    pushValidationRow(rows, {
      meetingId,
      agendaItemId: agendaItem.id,
      validationType: "evidence_support",
      severity: "info",
      code: "transcript_only_support",
      message: "This agenda item is currently supported only by transcript evidence.",
      details: { title: agendaItem.title, transcriptEvidenceCount },
    });
  }

  if (openQuestions.length > 0) {
    pushValidationRow(rows, {
      meetingId,
      agendaItemId: agendaItem.id,
      validationType: "completeness",
      severity: "info",
      code: "open_questions_present",
      message: "The investigation surfaced unresolved questions for this agenda item.",
      details: { title: agendaItem.title, openQuestions },
    });
  }

  return { transcriptEvidenceCount, documentEvidenceCount };
}

function addAiValidationRows(options: {
  rows: Array<typeof meetingsV2ValidationResults.$inferInsert>;
  meetingId: string;
  agendaItemId: string;
  review: AiValidationDocument;
}) {
  const summarySeverity: ValidationSeverity =
    options.review.verdict === "fail"
      ? "error"
      : options.review.verdict === "review_required"
        ? "warning"
        : "info";

  pushValidationRow(options.rows, {
    meetingId: options.meetingId,
    agendaItemId: options.agendaItemId,
    validationType: "ai_review",
    severity: summarySeverity,
    code: "ai_verdict",
      message:
        options.review.summary ||
        `AI validator verdict: ${options.review.verdict.replace(/_/g, " ")}.`,
      details: {
        verdict: options.review.verdict,
        validatorConfidence: options.review.validator_confidence,
        needsHumanReview: options.review.needs_human_review,
        strengths: options.review.strengths,
        suggestedActions: options.review.suggested_actions,
      },
    });

  for (const issue of options.review.issues) {
    pushValidationRow(options.rows, {
      meetingId: options.meetingId,
      agendaItemId: options.agendaItemId,
      validationType: "ai_review",
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      details: {
        evidence: issue.evidence,
        suggestedFix: issue.suggested_fix,
        verdict: options.review.verdict,
        validatorConfidence: options.review.validator_confidence,
      },
    });
  }
}

export async function retrieveAgendaItemEvidence(
  meetingId: string,
  agendaItemId?: string,
): Promise<{ meetingId: string; evidenceCount: number }> {
  const db = getDb();
  const filters = agendaItemId
    ? and(
        eq(meetingsV2AgendaItems.meetingV2Id, meetingId),
        eq(meetingsV2AgendaItems.id, agendaItemId),
      )
    : eq(meetingsV2AgendaItems.meetingV2Id, meetingId);
  const agendaItems = await db.select().from(meetingsV2AgendaItems).where(filters).orderBy(asc(meetingsV2AgendaItems.sortOrder));

  const [sections, pages, transcriptSegments, chunks, latestSnapshots] = await Promise.all([
    db.select().from(meetingsV2DocumentSections).where(eq(meetingsV2DocumentSections.meetingV2Id, meetingId)),
    db.select().from(meetingsV2DocumentPages).where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId)),
    db.select().from(meetingsV2TranscriptSegments).where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId)),
    db
      .select()
      .from(meetingsV2DocumentChunks)
      .where(eq(meetingsV2DocumentChunks.meetingV2Id, meetingId)),
    db
      .select()
      .from(meetingsV2AgendaChunkSnapshots)
      .where(eq(meetingsV2AgendaChunkSnapshots.meetingV2Id, meetingId))
      .orderBy(desc(meetingsV2AgendaChunkSnapshots.createdAt)),
  ]);
  const latestSnapshot = latestSnapshots[0] ?? null;
  const finalState = safeJsonParse<Record<string, unknown> | null>(latestSnapshot?.afterStateJson, null);
  const extractedTopics = [
    ...((Array.isArray(finalState?.documentTopics) ? finalState?.documentTopics : []) as Array<Record<string, unknown>>),
    ...((Array.isArray(finalState?.extraTopics) ? finalState?.extraTopics : []) as Array<Record<string, unknown>>),
  ]
    .map(normalizeExtractedTopic)
    .filter((topic): topic is ExtractedAgendaTopic => Boolean(topic));
  const chunkContexts = chunks.map(toChunkContext);
  const chunkContextById = new Map(chunkContexts.map((chunk) => [chunk.chunkId, chunk] as const));

  const existingContextRows = await db.select().from(meetingsV2AgendaItemContexts).where(
    agendaItemId
      ? and(
          eq(meetingsV2AgendaItemContexts.meetingV2Id, meetingId),
          eq(meetingsV2AgendaItemContexts.agendaItemId, agendaItemId),
        )
      : eq(meetingsV2AgendaItemContexts.meetingV2Id, meetingId),
  );
  const existingContextIds = new Set(existingContextRows.map((row) => row.agendaItemId));

  if (agendaItemId) {
    await db
      .delete(meetingsV2AgendaItemEvidence)
      .where(
        and(
          eq(meetingsV2AgendaItemEvidence.meetingV2Id, meetingId),
          eq(meetingsV2AgendaItemEvidence.agendaItemId, agendaItemId),
        ),
      );
    await db
      .delete(meetingsV2AgendaItemContexts)
      .where(
        and(
          eq(meetingsV2AgendaItemContexts.meetingV2Id, meetingId),
          eq(meetingsV2AgendaItemContexts.agendaItemId, agendaItemId),
        ),
      );
  }

  const evidenceRows: Array<typeof meetingsV2AgendaItemEvidence.$inferInsert> = [];
  const contextRows: Array<typeof meetingsV2AgendaItemContexts.$inferInsert> = [];
  const pendingItems = agendaItemId
    ? agendaItems
    : agendaItems.filter((item) => !existingContextIds.has(item.id));
  let completedCount = agendaItems.length - pendingItems.length;

  for (const item of pendingItems) {
    const keywords = titleKeywords(item.title);
    const sourcePages = safeJsonParse<number[]>(item.sourcePagesJson, []);
    const section = sections.find((entry) => entry.id === item.sourceSectionId);
    const extractedTopic = matchExtractedTopic(item, extractedTopics);

    const matchedPages = pages
      .filter((page) => sourcePages.includes(page.pageNumber))
      .slice(0, 4);
    for (const page of matchedPages) {
      evidenceRows.push({
        id: randomUUID(),
        meetingV2Id: meetingId,
        agendaItemId: item.id,
        sourceType: "document_page",
        sourceId: page.id,
        rationale: "Source pages for the agenda section.",
        relevanceScore: 90,
        snippet: normalizeWhitespace(page.extractedText).slice(0, 400),
        createdAt: nowIso(),
      });
    }

    if (section) {
      evidenceRows.push({
        id: randomUUID(),
        meetingV2Id: meetingId,
        agendaItemId: item.id,
        sourceType: "document_section",
        sourceId: section.id,
        rationale: "Section heading and page range from the board package.",
        relevanceScore: 100,
        snippet: item.sourceText?.slice(0, 400) ?? section.title,
        createdAt: nowIso(),
      });
    }

    const matchedTranscriptSegments = transcriptSegments
      .map((segment) => ({
        segment,
        score: scoreTextMatch(segment.text, keywords),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.segment.sequence - b.segment.sequence)
      .slice(0, 6);

    const fallbackTranscriptRanges = matchedTranscriptSegments.map((entry) => [
      entry.segment.sequence,
      entry.segment.sequence,
    ] as [number, number]);
    const sourceTranscriptRanges =
      extractedTopic?.sourceTranscriptRanges.length
        ? extractedTopic.sourceTranscriptRanges
        : fallbackTranscriptRanges;
    const directAnchorChunkIds = (extractedTopic?.sourceChunkIds ?? []).filter((chunkId) =>
      chunkContextById.has(chunkId),
    );
    const pageAnchorChunkIds = chunkContexts
      .filter((chunk) => chunk.chunkKind === "document" && intersectsSourcePages(chunk.pageRange, sourcePages))
      .map((chunk) => chunk.chunkId);
    const transcriptAnchorChunkIds = chunkContexts
      .filter((chunk) => chunk.chunkKind === "transcript" && overlapsTranscriptRange(chunk.sequenceRange, sourceTranscriptRanges))
      .map((chunk) => chunk.chunkId);
    const anchorChunkIds = uniqueValues([
      ...directAnchorChunkIds,
      ...pageAnchorChunkIds,
      ...transcriptAnchorChunkIds,
    ]).sort((left, right) => {
      const leftChunk = chunkContextById.get(left);
      const rightChunk = chunkContextById.get(right);
      return (leftChunk?.sortOrder ?? 0) - (rightChunk?.sortOrder ?? 0);
    });
    const chunksById = Object.fromEntries(
      anchorChunkIds.flatMap((chunkId) => {
        const chunk = chunkContextById.get(chunkId);
        return chunk ? [[chunkId, chunk] as const] : [];
      }),
    );
    const buildNotes: string[] = [];
    if (directAnchorChunkIds.length > 0) {
      buildNotes.push("Attached anchor chunks from agenda extraction provenance.");
    }
    if (directAnchorChunkIds.length === 0 && sourcePages.length > 0) {
      buildNotes.push("Resolved anchor chunks from agenda source pages.");
    }
    if (sourceTranscriptRanges.length > 0) {
      buildNotes.push("Expanded transcript anchors from source transcript ranges.");
    }
    if (anchorChunkIds.length === 0) {
      buildNotes.push("No anchor chunks could be resolved for this agenda item.");
    }

    for (const entry of matchedTranscriptSegments) {
      evidenceRows.push({
        id: randomUUID(),
        meetingV2Id: meetingId,
        agendaItemId: item.id,
        sourceType: "transcript_segment",
        sourceId: entry.segment.id,
        rationale: "Transcript segment mentions the agenda topic.",
        relevanceScore: entry.score,
        snippet: normalizeWhitespace(entry.segment.text).slice(0, 400),
        createdAt: nowIso(),
      });
    }

    const contextJson: AgendaItemContextDocument = {
      agendaItemId: item.id,
      title: item.title,
      sectionLabel: item.sectionLabel,
      itemType: extractedTopic?.itemType ?? item.itemType,
      sourcePages,
      sourceChunkIds: extractedTopic?.sourceChunkIds ?? [],
      sourceTranscriptRanges,
      aliases: extractedTopic?.aliases ?? [],
      notes: extractedTopic?.notes ?? [],
      anchorChunkIds,
      chunksById,
      buildNotes,
    };
    const assembledContextText = buildAssembledContextText(contextJson);

    contextRows.push({
      id: randomUUID(),
      meetingV2Id: meetingId,
      agendaItemId: item.id,
      contextJson: JSON.stringify(contextJson),
      assembledContextText,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    completedCount += 1;
    await updatePhaseProgress({
      meetingId,
      pipelineState: "gathering_evidence",
      basePercent: 40,
      spanPercent: 20,
      current: completedCount,
      total: agendaItems.length,
      label: `Gathering evidence (${completedCount}/${agendaItems.length})`,
    });
  }

  if (evidenceRows.length > 0) {
    await db.insert(meetingsV2AgendaItemEvidence).values(evidenceRows);
  }
  if (contextRows.length > 0) {
    await db.insert(meetingsV2AgendaItemContexts).values(contextRows);
  }

  return { meetingId, evidenceCount: evidenceRows.length };
}

export async function investigateAgendaItems(
  meetingId: string,
  agendaItemId?: string,
): Promise<{ meetingId: string; investigatedCount: number }> {
  const db = getDb();
  const filters = agendaItemId
    ? and(
        eq(meetingsV2AgendaItems.meetingV2Id, meetingId),
        eq(meetingsV2AgendaItems.id, agendaItemId),
      )
    : eq(meetingsV2AgendaItems.meetingV2Id, meetingId);

    const [agendaItems, contexts, evidenceRows, existingInvestigations, meetingRec, pages, chunks] = await Promise.all([
    db.select().from(meetingsV2AgendaItems).where(filters).orderBy(asc(meetingsV2AgendaItems.sortOrder)),
    db.select().from(meetingsV2AgendaItemContexts).where(
      agendaItemId
        ? and(
            eq(meetingsV2AgendaItemContexts.meetingV2Id, meetingId),
            eq(meetingsV2AgendaItemContexts.agendaItemId, agendaItemId),
          )
        : eq(meetingsV2AgendaItemContexts.meetingV2Id, meetingId),
    ),
    db.select().from(meetingsV2AgendaItemEvidence).where(
      agendaItemId
        ? and(
            eq(meetingsV2AgendaItemEvidence.meetingV2Id, meetingId),
            eq(meetingsV2AgendaItemEvidence.agendaItemId, agendaItemId),
          )
        : eq(meetingsV2AgendaItemEvidence.meetingV2Id, meetingId),
    ),
    db.select().from(meetingsV2AgendaItemInvestigations).where(
      agendaItemId
        ? and(
            eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meetingId),
            eq(meetingsV2AgendaItemInvestigations.agendaItemId, agendaItemId),
          )
        : eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meetingId),
    ),
    db.query.meetingsV2.findFirst({ where: eq(meetingsV2.id, meetingId) }),
    db.select().from(meetingsV2DocumentPages).where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId)),
    db.select().from(meetingsV2DocumentChunks).where(eq(meetingsV2DocumentChunks.meetingV2Id, meetingId)),
  ]);

  if (agendaItemId) {
    await db
      .delete(meetingsV2AgendaItemInvestigations)
      .where(
        and(
          eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meetingId),
          eq(meetingsV2AgendaItemInvestigations.agendaItemId, agendaItemId),
        ),
      );
  }

  const pendingItems = agendaItemId
    ? agendaItems
    : agendaItems.filter(
        (item) => !existingInvestigations.some((entry) => entry.agendaItemId === item.id),
      );
  let completedCount = agendaItems.length - pendingItems.length;
  let investigatedThisRun = 0;
  const runtime = await loadInvestigationToolRuntime({ meetingId });

  let directorsPromptLines: string[] = [];
  if (meetingRec) {
    const frame = buildMeetingFrame(meetingRec, pages, chunks);
    const directors = frame.attendanceCandidates.present;
    if (directors.length > 0) {
      directorsPromptLines = directors.map(d => `- ${d.name} (${d.title_or_role})`);
    }
  }

  for (const item of pendingItems) {
    const context = contexts.find((entry) => entry.agendaItemId === item.id);
    const evidenceForItem = evidenceRows.filter((entry) => entry.agendaItemId === item.id);
    const existing = existingInvestigations.find((entry) => entry.agendaItemId === item.id);
    const userAnswers = safeJsonParse<Record<string, string>>(existing?.userAnswersJson, {});
    const answerText = Object.values(userAnswers).filter(Boolean).join("\n").trim() || null;
    const promptInput = [
      `Agenda item title: ${item.title}`,
      `Section label: ${item.sectionLabel ?? "Unknown"}`,
      `Board package source text: ${item.sourceText ?? "None"}`,
      "",
      "Attending Voting Directors:",
      ...directorsPromptLines,
      "",
      "Prepared context JSON",
      context?.contextJson ?? "{}",
      "",
      "Prepared context text",
      context?.assembledContextText ?? item.sourceText ?? item.title,
      "",
      "Additional user clarification",
      answerText ?? "None",
    ].join("\n");

    let normalized: AiInvestigationDocument;
    let modelName = "deepseek-v4-flash";
    let usageJson = JSON.stringify({
      evidenceCount: evidenceForItem.length,
      transcriptEvidenceCount: evidenceForItem.filter((entry) => entry.sourceType === "transcript_segment").length,
    });
    try {
      const aiResult = await runToolEnabledInvestigation({
        systemInstruction: AGENDA_ITEM_INVESTIGATION_PROMPT,
        userText: promptInput,
        runtime,
        maxOutputTokens: 4096,
      });
      normalized = normalizeInvestigationDocument(safeJsonObjectParse(aiResult.text));
      modelName = aiResult.modelName;
      usageJson = JSON.stringify({
        evidenceCount: evidenceForItem.length,
        transcriptEvidenceCount: evidenceForItem.filter((entry) => entry.sourceType === "transcript_segment").length,
        toolCalls: aiResult.toolCalls,
        usage: aiResult.usage,
        requestTrace: aiResult.requestTrace,
      });
    } catch {
      const transcriptEvidenceCount = evidenceForItem.filter(
        (entry) => entry.sourceType === "transcript_segment",
      ).length;
      const openQuestions = buildOpenQuestions(item.title, transcriptEvidenceCount, answerText);
      normalized = {
        discussion_summary: normalizeWhitespace(
          `${item.sourceText ?? context?.assembledContextText ?? item.title}\n${answerText ?? ""}`,
        ).slice(0, 900),
        outcome: inferOutcome(context?.assembledContextText ?? item.sourceText ?? "", answerText).toUpperCase() as AiInvestigationDocument["outcome"],
        confidence: inferConfidence(evidenceForItem.length, answerText, openQuestions).toUpperCase() as AiInvestigationDocument["confidence"],
        visibility: inferVisibility(item.title) === "in_camera" ? "RESTRICTED" : "PUBLIC",
        decisions: [],
        motion: null,
        actions: [],
        open_questions: openQuestions,
      };
    }

    
    const AUTONOMY_TEMPERATURE = (meetingRec?.settings as { autonomyTemperature?: number })?.autonomyTemperature ?? 0.8;
    if (AUTONOMY_TEMPERATURE >= 0.5 && normalized.open_questions && normalized.open_questions.length > 0) {
      const remainingQuestions = [];
      for (const q of normalized.open_questions) {
        if ((q.confidence === "high" || q.confidence === "medium") && q.recommended_answer) {
          // Silently accept the AI's recommended answer
          normalized.discussion_summary += `\n\n${q.recommended_answer}`;
        } else {
          remainingQuestions.push(q);
        }
      }
      normalized.open_questions = remainingQuestions;
    }

    const investigationRow: typeof meetingsV2AgendaItemInvestigations.$inferInsert = {
      id: randomUUID(),
      meetingV2Id: meetingId,
      agendaItemId: item.id,
      discussionSummary: normalized.discussion_summary || item.title,
      outcome: normalized.outcome.toLowerCase(),
      confidence: normalized.confidence.toLowerCase(),
      visibility: normalized.visibility.toLowerCase(),
      decisionsJson: JSON.stringify(normalized.decisions),
      motionJson: JSON.stringify(normalized.motion),
      actionsJson: JSON.stringify(normalized.actions),
      openQuestionsJson: JSON.stringify(normalized.open_questions.map(q => typeof q === "string" ? q : q.question)),
      userAnswersJson: answerText ? JSON.stringify(userAnswers) : null,
      modelName,
      usageJson,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await db.insert(meetingsV2AgendaItemInvestigations).values(investigationRow);

    completedCount += 1;
    investigatedThisRun += 1;
    await updatePhaseProgress({
      meetingId,
      pipelineState: "investigating",
      basePercent: 60,
      spanPercent: 20,
      current: completedCount,
      total: agendaItems.length,
      label: `Investigating items (${completedCount}/${agendaItems.length})`,
    });
  }

  return { meetingId, investigatedCount: investigatedThisRun };
}

export async function validateAgendaItemInvestigations(
  meetingId: string,
  agendaItemId?: string,
): Promise<{ meetingId: string; validationCount: number }> {
  const db = getDb();
  const filters = agendaItemId
    ? and(
        eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meetingId),
        eq(meetingsV2AgendaItemInvestigations.agendaItemId, agendaItemId),
      )
    : eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meetingId);

  const [investigations, existingValidations, contexts, agendaItems] = await Promise.all([
    db.select().from(meetingsV2AgendaItemInvestigations).where(filters),
    db.select().from(meetingsV2ValidationResults).where(
      agendaItemId
        ? and(
            eq(meetingsV2ValidationResults.meetingV2Id, meetingId),
            eq(meetingsV2ValidationResults.agendaItemId, agendaItemId),
          )
        : eq(meetingsV2ValidationResults.meetingV2Id, meetingId),
    ),
    db.select().from(meetingsV2AgendaItemContexts).where(
      agendaItemId
        ? and(
            eq(meetingsV2AgendaItemContexts.meetingV2Id, meetingId),
            eq(meetingsV2AgendaItemContexts.agendaItemId, agendaItemId),
          )
        : eq(meetingsV2AgendaItemContexts.meetingV2Id, meetingId),
    ),
    db.select().from(meetingsV2AgendaItems).where(
      agendaItemId
        ? and(eq(meetingsV2AgendaItems.meetingV2Id, meetingId), eq(meetingsV2AgendaItems.id, agendaItemId))
        : eq(meetingsV2AgendaItems.meetingV2Id, meetingId),
    ),
  ]);

  if (agendaItemId) {
    await db
      .delete(meetingsV2ValidationResults)
      .where(
        and(
          eq(meetingsV2ValidationResults.meetingV2Id, meetingId),
          eq(meetingsV2ValidationResults.agendaItemId, agendaItemId),
        ),
      );
  } else {
    await clearMeetingV2ValidationUsage(meetingId);
  }

  const pendingInvestigations = agendaItemId
    ? investigations
    : investigations.filter(
        (investigation) =>
          !existingValidations.some((row) => row.agendaItemId === investigation.agendaItemId),
      );
  const rows: Array<typeof meetingsV2ValidationResults.$inferInsert> = [];
  let completedCount = investigations.length - pendingInvestigations.length;
  const contextByAgendaItemId = new Map(contexts.map((row) => [row.agendaItemId, row] as const));
  const agendaById = new Map(agendaItems.map((row) => [row.id, row] as const));
  for (const investigation of pendingInvestigations) {
    const context = contextByAgendaItemId.get(investigation.agendaItemId) ?? null;
    const agendaItem = agendaById.get(investigation.agendaItemId);
    if (!agendaItem) continue;

    const contextDocument =
      safeJsonParse<AgendaItemContextDocument | null>(context?.contextJson, null) ?? null;
    const deterministic = addDeterministicValidationRows({
      rows,
      meetingId,
      agendaItem,
      investigation,
      contextDocument,
    });

    try {
      const investigationUsage = safeJsonParse<Record<string, unknown>>(investigation.usageJson, {});
      const toolCalls =
        Array.isArray(investigationUsage.toolCalls) &&
        investigationUsage.toolCalls.every((entry) => entry && typeof entry === "object")
          ? (investigationUsage.toolCalls as Array<Record<string, unknown>>)
          : [];
      const requestTrace =
        investigationUsage.requestTrace && typeof investigationUsage.requestTrace === "object"
          ? (investigationUsage.requestTrace as Record<string, unknown>)
          : null;

      const aiValidation = await runAiValidationReview({
        agendaItem,
        investigation,
        contextDocument,
        assembledContextText: context?.assembledContextText ?? null,
        transcriptEvidenceCount: deterministic.transcriptEvidenceCount,
        documentEvidenceCount: deterministic.documentEvidenceCount,
        investigationTrace: {
          toolCalls,
          requestTrace,
        },
      });
      addAiValidationRows({
        rows,
        meetingId,
        agendaItemId: agendaItem.id,
        review: aiValidation.parsed,
      });
      await recordMeetingV2ValidationUsage(
        meetingId,
        aiValidation.usage,
        aiValidation.modelName,
      );
    } catch (error) {
      pushValidationRow(rows, {
        meetingId,
        agendaItemId: agendaItem.id,
        validationType: "ai_review",
        severity: "error",
        code: "ai_validation_failed",
        message: "AI validation could not be completed for this agenda item.",
        details: {
          title: agendaItem.title,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
    completedCount += 1;
    await updatePhaseProgress({
      meetingId,
      pipelineState: "validating",
      basePercent: 80,
      spanPercent: 15,
      current: completedCount,
      total: investigations.length,
      label: `Validating items (${completedCount}/${investigations.length})`,
    });
  }

  if (rows.length > 0) {
    await db.insert(meetingsV2ValidationResults).values(rows);
  }

  return { meetingId, validationCount: rows.length };
}

export async function generateMeetingV2Draft(meetingId: string): Promise<{
  id: string;
  meetingId: string;
  title: string;
  contentMarkdown: string;
  format: string;
  createdAt: string;
  updatedAt: string;
}> {
  const db = getDb();
  const [meeting] = await db.select().from(meetingsV2).where(eq(meetingsV2.id, meetingId));
  if (!meeting) {
    throw new Error(`V2 meeting ${meetingId} was not found.`);
  }

  const [agendaItems, investigations, validationRows, contexts, chunks, pages] = await Promise.all([
    db
      .select()
      .from(meetingsV2AgendaItems)
      .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2AgendaItems.sortOrder)),
    db
      .select()
      .from(meetingsV2AgendaItemInvestigations)
      .where(eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meetingId)),
    db
      .select()
      .from(meetingsV2ValidationResults)
      .where(eq(meetingsV2ValidationResults.meetingV2Id, meetingId)),
    db
      .select()
      .from(meetingsV2AgendaItemContexts)
      .where(eq(meetingsV2AgendaItemContexts.meetingV2Id, meetingId)),
    db
      .select()
      .from(meetingsV2DocumentChunks)
      .where(eq(meetingsV2DocumentChunks.meetingV2Id, meetingId)),
    db
      .select()
      .from(meetingsV2DocumentPages)
      .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2DocumentPages.pageNumber)),
  ]);

  if (investigations.length === 0) {
    throw new Error("Investigations are required before generating a draft.");
  }
  const draftArtifact = buildMeetingV2DraftArtifact({
    meeting,
    agendaItems,
    investigations,
    validations: validationRows,
    contexts,
    chunks,
    pages,
  });
  const createdAt = nowIso();
  const draftRow = {
    id: randomUUID(),
    meetingV2Id: meetingId,
    format: "minutes_v2",
    title: draftArtifact.title,
    contentMarkdown: draftArtifact.contentMarkdown,
    summaryJson: draftArtifact.summaryJson,
    modelName: draftArtifact.modelName,
    usageJson: draftArtifact.usageJson,
    createdAt,
    updatedAt: createdAt,
  } satisfies typeof meetingsV2MinutesDrafts.$inferInsert;

  await db
    .delete(meetingsV2MinutesDrafts)
    .where(eq(meetingsV2MinutesDrafts.meetingV2Id, meetingId));
  await db.insert(meetingsV2MinutesDrafts).values(draftRow);

  return {
    id: draftRow.id,
    meetingId,
    title: draftRow.title,
    contentMarkdown: draftRow.contentMarkdown,
    format: draftRow.format,
    createdAt,
    updatedAt: createdAt,
  };
}

export async function loadMeetingV2Detail(meetingId: string): Promise<MeetingV2Detail> {
  const db = getDb();
  const [meeting, legacyMeeting, agendaItems, investigations, validationRows, drafts, counts, documentSections, sourceArtifacts, boardPackageMeta] = await Promise.all([
    db.select().from(meetingsV2).where(eq(meetingsV2.id, meetingId)),
    db
      .select({
        vttFilePath: meetings.vttFilePath,
        boardPackageFilePath: meetings.boardPackageFilePath,
        pdfFilePath: meetings.pdfFilePath,
      })
      .from(meetings)
      .where(eq(meetings.id, meetingId)),
    db
      .select({
        id: meetingsV2AgendaItems.id,
        title: meetingsV2AgendaItems.title,
        itemNumber: meetingsV2AgendaItems.itemNumber,
        itemType: meetingsV2AgendaItems.itemType,
        sourceSectionId: meetingsV2AgendaItems.sourceSectionId,
      })
      .from(meetingsV2AgendaItems)
      .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2AgendaItems.sortOrder)),
    db
      .select({
        agendaItemId: meetingsV2AgendaItemInvestigations.agendaItemId,
        discussionSummary: meetingsV2AgendaItemInvestigations.discussionSummary,
        confidence: meetingsV2AgendaItemInvestigations.confidence,
        outcome: meetingsV2AgendaItemInvestigations.outcome,
        openQuestionsJson: meetingsV2AgendaItemInvestigations.openQuestionsJson,
        userAnswersJson: meetingsV2AgendaItemInvestigations.userAnswersJson,
      })
      .from(meetingsV2AgendaItemInvestigations)
      .where(eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meetingId)),
    db
      .select({
        agendaItemId: meetingsV2ValidationResults.agendaItemId,
        severity: meetingsV2ValidationResults.severity,
        code: meetingsV2ValidationResults.code,
        message: meetingsV2ValidationResults.message,
      })
      .from(meetingsV2ValidationResults)
      .where(eq(meetingsV2ValidationResults.meetingV2Id, meetingId)),
    db
      .select({
        id: meetingsV2MinutesDrafts.id,
        title: meetingsV2MinutesDrafts.title,
        format: meetingsV2MinutesDrafts.format,
        createdAt: meetingsV2MinutesDrafts.createdAt,
        updatedAt: meetingsV2MinutesDrafts.updatedAt,
      })
      .from(meetingsV2MinutesDrafts)
      .where(eq(meetingsV2MinutesDrafts.meetingV2Id, meetingId))
      .orderBy(desc(meetingsV2MinutesDrafts.createdAt))
      .limit(1),
    getMeetingV2Counts(meetingId),
    db
      .select({
        title: meetingsV2DocumentSections.title,
        startPage: meetingsV2DocumentSections.startPage,
        endPage: meetingsV2DocumentSections.endPage,
      })
      .from(meetingsV2DocumentSections)
      .where(eq(meetingsV2DocumentSections.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2DocumentSections.sortOrder)),
    db
      .select({
        type: meetingsV2SourceArtifacts.type,
        originalFilename: meetingsV2SourceArtifacts.originalFilename,
      })
      .from(meetingsV2SourceArtifacts)
      .where(eq(meetingsV2SourceArtifacts.meetingV2Id, meetingId)),
    loadMeetingBoardPackageMeta(meetingId),
  ]);

  const selectedMeeting = meeting[0];
  if (!selectedMeeting) {
    throw new Error(`V2 meeting ${meetingId} was not found.`);
  }

  const latestDraft = drafts[0]
      ? {
        id: drafts[0].id,
        title: drafts[0].title,
        contentMarkdown: "",
        json: null,
        format: drafts[0].format,
        createdAt: drafts[0].createdAt,
        updatedAt: drafts[0].updatedAt,
      }
    : null;
  const computed = deriveMeetingV2ComputedStatus(counts);
  const pipelineNotStarted = isMeetingV2PipelineNotStarted(selectedMeeting.pipelineState);
  const extractionQuality = await assessMeetingV2Extraction(meetingId, {
    meeting: selectedMeeting,
    agendaItems,
    documentSections,
    pipelineNotStarted,
  });
  const stages = buildMeetingV2Stages({
    counts: {
      ...counts,
      drafts: counts.drafts,
    },
    extractionQuality,
    pipelineNotStarted,
  });
  let computedPipelineState = computed.pipelineState;
  let computedCurrentStep = computed.currentStep;
  let integrityNote = computed.note;
  let isConsistent =
    computed.isConsistent &&
    computedPipelineState === selectedMeeting.pipelineState &&
    computedCurrentStep === (selectedMeeting.currentStep ?? computedCurrentStep);

  if (pipelineNotStarted) {
    computedPipelineState = "created";
    computedCurrentStep = selectedMeeting.currentStep ?? "Ready to start";
    integrityNote = "";
    isConsistent = true;
  }

  const alerts = buildMeetingV2Alerts({
    extractionQuality,
    integrityNote,
    isConsistent,
    lastError: selectedMeeting.lastError,
    pipelineState: selectedMeeting.pipelineState,
    pipelineActivelyRunning: isMeetingV2PipelineActivelyRunning({
      pipelineState: selectedMeeting.pipelineState,
      lastError: selectedMeeting.lastError,
    }),
    updatedAt: selectedMeeting.updatedAt,
  });

  const transcriptArtifact = sourceArtifacts.find((artifact) => artifact.type === "transcript");
  const boardPackageArtifact = sourceArtifacts.find(
    (artifact) => artifact.type === "board_package",
  );
  const legacy = legacyMeeting[0];
  const uploadRoot = path.resolve(process.cwd(), "uploads", meetingId);
  const transcriptPath = legacy?.vttFilePath
    ? path.resolve(process.cwd(), legacy.vttFilePath)
    : null;

  return {
    meeting: {
      id: selectedMeeting.id,
      title: selectedMeeting.title,
      meetingDate: selectedMeeting.meetingDate,
      pipelineState: selectedMeeting.pipelineState,
      currentStep: selectedMeeting.currentStep,
      progressPercent: selectedMeeting.progressPercent,
      lastError: selectedMeeting.lastError,
      createdAt: selectedMeeting.createdAt,
      updatedAt: selectedMeeting.updatedAt,
      computedPipelineState,
      computedCurrentStep,
      stages,
      counts,
      extractionQuality,
      alerts,
      integrity: {
        isConsistent,
        note: integrityNote,
      },
      pipelineActivelyRunning: isMeetingV2PipelineActivelyRunning({
        pipelineState: selectedMeeting.pipelineState,
        lastError: selectedMeeting.lastError,
      }),
    },
    items: agendaItems.map((item) => {
      const investigation = investigations.find((entry) => entry.agendaItemId === item.id);
      const validations = validationRows
        .filter((entry) => entry.agendaItemId === item.id)
        .map((entry) => ({
          severity: entry.severity,
          code: entry.code,
          message: entry.message,
        }));
      return {
        id: item.id,
        title: item.title,
        itemNumber: item.itemNumber,
        itemType: item.itemType,
        sourceSectionId: item.sourceSectionId,
        discussionSummary: investigation?.discussionSummary ?? null,
        confidence: investigation?.confidence ?? null,
        outcome: investigation?.outcome ?? null,
        openQuestions: safeJsonParse<string[]>(investigation?.openQuestionsJson, []),
        userAnswers: safeJsonParse<Record<string, string> | null>(
          investigation?.userAnswersJson,
          null,
        ),
        validation: validations,
      };
    }),
    latestDraft,
    sources: {
      transcript: legacy?.vttFilePath
        ? {
            fileName:
              transcriptArtifact?.originalFilename?.trim() ||
              path.basename(legacy.vttFilePath) ||
              "transcript.vtt",
            available: Boolean(transcriptPath?.startsWith(uploadRoot)),
          }
        : null,
      boardPackage:
        boardPackageMeta.ok && (legacy?.boardPackageFilePath || legacy?.pdfFilePath || boardPackageArtifact)
          ? {
              fileName: boardPackageMeta.payload.fileName,
              available: boardPackageMeta.payload.available,
              pageCount: boardPackageMeta.payload.pageCount,
            }
          : null,
    },
    documentSections: documentSections.map((section) => ({
      title: section.title,
      startPage: section.startPage,
      endPage: section.endPage,
    })),
  };
}

export async function loadLatestMeetingV2Draft(meetingId: string): Promise<{
  id: string;
  title: string;
  contentMarkdown: string;
  json: string | null;
  format: string;
  createdAt: string;
  updatedAt: string;
} | null> {
  const db = getDb();
  const [draft] = await db
    .select({
      id: meetingsV2MinutesDrafts.id,
      title: meetingsV2MinutesDrafts.title,
      contentMarkdown: meetingsV2MinutesDrafts.contentMarkdown,
      json: meetingsV2MinutesDrafts.summaryJson,
      format: meetingsV2MinutesDrafts.format,
      createdAt: meetingsV2MinutesDrafts.createdAt,
      updatedAt: meetingsV2MinutesDrafts.updatedAt,
    })
    .from(meetingsV2MinutesDrafts)
    .where(eq(meetingsV2MinutesDrafts.meetingV2Id, meetingId))
    .orderBy(desc(meetingsV2MinutesDrafts.createdAt))
    .limit(1);
  return draft ?? null;
}

export async function rerunAgendaItem(meetingId: string, agendaItemId: string): Promise<void> {
  await retrieveAgendaItemEvidence(meetingId, agendaItemId);
  await investigateAgendaItems(meetingId, agendaItemId);
  await validateAgendaItemInvestigations(meetingId, agendaItemId);
}

export async function finalizeMeetingV2PipelineStatus(meetingId: string): Promise<void> {
  const counts = await getMeetingV2Counts(meetingId);
  const computed = deriveMeetingV2ComputedStatus(counts);
  const extractionQuality = await assessMeetingV2Extraction(meetingId);
  if (extractionQuality.likelyIncomplete) {
    await updateMeetingV2Status(
      meetingId,
      "extracting",
      "Agenda extraction looks incomplete",
      30,
      extractionQuality.note,
    );
    return;
  }
  if (!computed.isConsistent || computed.pipelineState !== "validated") {
    await updateMeetingV2Status(
      meetingId,
      computed.pipelineState,
      computed.currentStep,
      computed.progressPercent,
      computed.note,
    );
    return;
  }

  await updateMeetingV2Status(meetingId, "validated", "Ready for review", 100, null);
}

export async function resetMeetingV2DerivedData(meetingId: string): Promise<void> {
  await clearAgendaDerivedData(meetingId);
  await updateMeetingV2Status(meetingId, "ingested", "Derived V2 data cleared", 20, null);
}

export async function resetMeetingV2PostExtractData(meetingId: string): Promise<void> {
  await clearMeetingV2DownstreamData(meetingId);
  await updateMeetingV2Status(
    meetingId,
    "extracted",
    "Post-extraction V2 data cleared",
    40,
    null,
  );
}

export async function resetMeetingV2AllData(meetingId: string): Promise<void> {
  const db = getDb();
  await clearAgendaDerivedData(meetingId);
  await db
    .delete(meetingsV2DocumentChunks)
    .where(eq(meetingsV2DocumentChunks.meetingV2Id, meetingId));
  await db
    .delete(meetingsV2DocumentSections)
    .where(eq(meetingsV2DocumentSections.meetingV2Id, meetingId));
  await db
    .delete(meetingsV2DocumentPages)
    .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId));
  await db
    .delete(meetingsV2TranscriptSegments)
    .where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId));
  await db
    .delete(meetingsV2SourceArtifacts)
    .where(eq(meetingsV2SourceArtifacts.meetingV2Id, meetingId));
  await updateMeetingV2Status(meetingId, "created", "Ready to start", 0, null);
}

export async function listMeetingsV2(): Promise<MeetingV2Row[]> {
  const db = getDb();
  return db.select().from(meetingsV2).orderBy(desc(meetingsV2.meetingDate));
}

export async function getMeetingV2AgendaItems(meetingId: string): Promise<AgendaItemRow[]> {
  const db = getDb();
  return db
    .select()
    .from(meetingsV2AgendaItems)
    .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV2AgendaItems.sortOrder));
}

export async function getMeetingV2Investigations(meetingId: string): Promise<InvestigationRow[]> {
  const db = getDb();
  return db
    .select()
    .from(meetingsV2AgendaItemInvestigations)
    .where(eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meetingId));
}

export async function getMeetingV2Validations(meetingId: string): Promise<ValidationRow[]> {
  const db = getDb();
  return db
    .select()
    .from(meetingsV2ValidationResults)
    .where(eq(meetingsV2ValidationResults.meetingV2Id, meetingId));
}

export async function saveUserAnswers(
  meetingId: string,
  agendaItemId: string,
  userAnswers: Record<string, string>,
): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(meetingsV2AgendaItemInvestigations)
    .where(
      and(
        eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meetingId),
        eq(meetingsV2AgendaItemInvestigations.agendaItemId, agendaItemId),
      ),
    );
  if (existing) {
    await db
      .update(meetingsV2AgendaItemInvestigations)
      .set({
        userAnswersJson: JSON.stringify(userAnswers),
        updatedAt: nowIso(),
      })
      .where(eq(meetingsV2AgendaItemInvestigations.id, existing.id));
    return;
  }

  const [agendaItem] = await db
    .select()
    .from(meetingsV2AgendaItems)
    .where(
      and(
        eq(meetingsV2AgendaItems.meetingV2Id, meetingId),
        eq(meetingsV2AgendaItems.id, agendaItemId),
      ),
    );
  if (!agendaItem) {
    throw new Error(`Agenda item ${agendaItemId} was not found.`);
  }

  await db.insert(meetingsV2AgendaItemInvestigations).values({
    id: randomUUID(),
    meetingV2Id: meetingId,
    agendaItemId,
    discussionSummary: agendaItem.sourceText?.slice(0, 500) ?? agendaItem.title,
    outcome: "pending_user_clarification",
    confidence: "low",
    visibility: inferVisibility(agendaItem.title),
    decisionsJson: JSON.stringify([]),
    motionJson: null,
    actionsJson: JSON.stringify([]),
    openQuestionsJson: JSON.stringify([
      `Can you confirm the final outcome for "${agendaItem.title}" from the live discussion?`,
    ]),
    userAnswersJson: JSON.stringify(userAnswers),
    modelName: "heuristic-v2",
    usageJson: JSON.stringify({ seeded: true }),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}
