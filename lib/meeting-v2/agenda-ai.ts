import { randomUUID } from "node:crypto";
import { canonicalDiscussionTiming } from "./canonical-timing";
import { MINUTES_PIPELINE_VERSION, stableAgendaId } from "./evidence-contract";

import { and, asc, eq } from "drizzle-orm";

import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { upcomingAgendaSplit } from "@/lib/meeting-v2/upcoming-meeting";
import type { SegmentationJsonFn } from "@/lib/meeting-v2/segment-json";
import { getDb } from "@/lib/db";
import {
  meetingsV2,
  meetingsV2AgendaChunkSnapshots,
  meetingsV2AgendaItems,
  meetingsV2DocumentChunks,
  meetingsV2DocumentSections,
  meetingsV2SourceArtifacts,
  meetingsV2TranscriptSegments,
} from "@/lib/db/schema";
import type {
  AgendaItemDiscussionStatus,
  MeetingV2Settings,
  TranscriptDiscrepancy,
} from "@/lib/meeting-v2/extraction-diagnostics";
import { filterRedundantAddToAgendaDiscrepancies } from "@/lib/meeting-v2/transcript-discrepancies";
import {
  extractBoardPackageAgendaJson,
  flattenBoardPackageAgenda,
} from "@/lib/meeting-v2/board-package-agenda";
import {
  applyAgendaHierarchyCorrections,
  compareAgendaItemCodes,
  formatDiscussionTimestampRanges,
  inferPropertyManagementReportNumber,
  mergeClosedIntervals,
  parentAgendaItemCode,
  parseDiscussionTimestampRanges,
  partitionAdHocOccupants,
  planAdHocPlacement,
} from "@/lib/meeting-v2/agenda-outline";
import {
  reviewTranscriptTopicSpans,
  transcriptSegmentsToReviewCues,
} from "@/lib/meeting-v2/span-edge-review";
import {
  assignRemainingHolesToAgenda,
  assignUnmatchedLeavesInHoles,
  extendFloorThroughLifecycleHoles,
} from "@/lib/meeting-v2/gap-leaf-assignment";
import { PACKAGE_SYSTEM_PROMPT, TRANSCRIPT_SYSTEM_PROMPT } from "./agenda-ai-prompts";
export { TRANSCRIPT_SYSTEM_PROMPT } from "./agenda-ai-prompts";

export type WorkflowTopic = {
  title: string;
  sectionLabel: string;
  itemType: string;
  itemNumber?: string;
  visibility: "PUBLIC" | "RESTRICTED" | "UNKNOWN";
  sourcePages: number[];
  sourceChunkIds: string[];
  sourceTranscriptRanges: Array<[number, number]>;
  discussionStatus?: "discussed" | "not_discussed" | "ad_hoc";
  discussionTimestampRange?: string | null;
  consolidationReason?: string | null;
  sourceText: string | null;
  aliases: string[];
  notes: string[];
  confidence: number;
  confidenceReason: string | null;
  evidenceStrength: "DIRECT" | "STRONG_INFERENCE" | "WEAK_INFERENCE" | "UNCERTAIN";
  openQuestions: string[];
  needsHumanReview: boolean;
  humanReviewReason: string | null;
};

type WorkflowDiscrepancy = {
  id: string;
  transcriptRange: [number, number];
  timestamp: string;
  speaker?: string | null;
  snippet: string;
  suggestedTitle: string;
  suggestedSection?: string | null;
  clarificationQuestion: string;
};

export type WorkflowState = {
  documentTopics: WorkflowTopic[];
  extraTopics: WorkflowTopic[];
  uncertainties: string[];
  discrepancies?: WorkflowDiscrepancy[];
  /** Official package outline codes frozen before the transcript walk. */
  packageItemNumbers?: string[];
};

type WorkflowChanges = {
  summary?: string[];
};

type WorkflowResponse = WorkflowState & {
  changes?: WorkflowChanges;
};


function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalize(value: string): string {
  return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function safeParseObject<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeJsonParse(text: string): unknown {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  const extracted =
    firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed;
  return JSON.parse(
    extracted
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/:\s*(-?\d+)\.(?:0{20,})/g, ": $1"),
  );
}

export function tryBalanceTruncatedJson(text: string): unknown | null {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace < 0) return null;
  let candidate = trimmed.slice(firstBrace);

  const lastQuote = candidate.lastIndexOf('"');
  const hasDanglingQuote = lastQuote >= 0 && candidate.slice(lastQuote - 1, lastQuote) !== "\\";
  if (hasDanglingQuote && candidate.split('"').length % 2 === 0) {
    candidate = candidate.slice(0, lastQuote);
  }

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastSafeIndex = -1;

  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === "}" || char === "]") {
      if (stack.at(-1) === char) stack.pop();
      else return null;
    }

    if (stack.length > 0) lastSafeIndex = index;
  }

  if (inString) candidate += '"';
  while (candidate.endsWith(",")) candidate = candidate.slice(0, -1);
  candidate += stack.reverse().join("");

  try {
    return safeJsonParse(candidate);
  } catch {
    if (lastSafeIndex > 0) {
      let truncated = candidate.slice(0, lastSafeIndex + 1).replace(/,\s*$/, "");
      const repairStack: string[] = [];
      let repairInString = false;
      let repairEscaped = false;
      for (const char of truncated) {
        if (repairInString) {
          if (repairEscaped) repairEscaped = false;
          else if (char === "\\") repairEscaped = true;
          else if (char === '"') repairInString = false;
          continue;
        }
        if (char === '"') repairInString = true;
        else if (char === "{") repairStack.push("}");
        else if (char === "[") repairStack.push("]");
        else if ((char === "}" || char === "]") && repairStack.at(-1) === char) repairStack.pop();
      }
      if (repairInString) truncated += '"';
      truncated += repairStack.reverse().join("");
      try {
        return safeJsonParse(truncated);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function isNoChangeResponse(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    "status" in (value as Record<string, unknown>) &&
    (value as Record<string, unknown>).status === "no_change"
  );
}

const AGENDA_CHUNK_MAX_OUTPUT_TOKENS = 12288;
const AGENDA_CHUNK_TRUNCATION_RETRY =
  'Your previous response hit the output token limit. Return a PATCH only: topics this chunk created or updated. Do not echo unchanged topics. If nothing changed, return {"status":"no_change"}.';

const defaultAgendaChunkJson: SegmentationJsonFn = async (options) => {
  const result = await generateDeepSeekJson({
    systemInstruction: options.systemInstruction,
    userText: options.userText,
    modelName: "deepseek-v4-flash",
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
    thinking: false,
    allowTruncated: options.allowTruncated,
  });
  return {
    text: result.text,
    modelName: result.modelName,
    usage: result.usage,
    finishReason: result.finishReason,
  };
};

/** One chunk update. Retry once on length so a full-state echo cannot abort the walk. */
export async function completeAgendaChunk(options: {
  systemInstruction: string;
  userText: string;
  generate?: SegmentationJsonFn;
}) {
  const generate = options.generate ?? defaultAgendaChunkJson;
  const request = {
    systemInstruction: options.systemInstruction,
    maxOutputTokens: AGENDA_CHUNK_MAX_OUTPUT_TOKENS,
    temperature: 0,
    allowTruncated: true as const,
  };
  const first = await generate({
    ...request,
    userText: options.userText,
  });
  if (first.finishReason !== "length") return first;
  return generate({
    ...request,
    userText: `${options.userText}

${AGENDA_CHUNK_TRUNCATION_RETRY}`,
  });
}

export async function parseWithRepair(
  text: string,
  generate: SegmentationJsonFn = defaultAgendaChunkJson,
): Promise<unknown> {
  try {
    return safeJsonParse(text);
  } catch {
    const balanced = tryBalanceTruncatedJson(text);
    if (balanced) return balanced;
    const repaired = await generate({
      systemInstruction: "Repair invalid JSON into one valid JSON object.",
      userText: `Repair the following invalid JSON-like response into one valid JSON object.

Rules:
- Return JSON only.
- Preserve meaning as closely as possible.
- Fix only syntax or malformed JSON structure.

INVALID RESPONSE
${text}`,
      maxOutputTokens: AGENDA_CHUNK_MAX_OUTPUT_TOKENS,
      temperature: 0,
      allowTruncated: true,
    });
    try {
      return safeJsonParse(repaired.text);
    } catch {
      const repairedBalanced = tryBalanceTruncatedJson(repaired.text);
      if (repairedBalanced) return repairedBalanced;
      throw new Error("Could not repair malformed JSON response.");
    }
  }
}

export function normalizeTopic(raw: Partial<WorkflowTopic>): WorkflowTopic | null {
  const title = normalizeWhitespace(raw.title ?? "");
  if (!title) return null;
  return {
    title,
    sectionLabel: normalizeWhitespace(raw.sectionLabel ?? "") || "Unknown",
    itemType: normalizeWhitespace(raw.itemType ?? "") || "other",
    itemNumber:
      typeof raw.itemNumber === "string" && raw.itemNumber.trim()
        ? raw.itemNumber.trim()
        : undefined,
    visibility:
      raw.visibility === "PUBLIC" || raw.visibility === "RESTRICTED" || raw.visibility === "UNKNOWN"
        ? raw.visibility
        : "UNKNOWN",
    sourcePages: unique(
      (Array.isArray(raw.sourcePages) ? raw.sourcePages : [])
        .flatMap((page) => (typeof page === "number" && Number.isFinite(page) ? [Math.trunc(page)] : []))
        .filter((page) => page > 0),
    ).sort((a, b) => a - b),
    sourceChunkIds: unique(
      (Array.isArray(raw.sourceChunkIds) ? raw.sourceChunkIds : [])
        .flatMap((chunkId) => (typeof chunkId === "string" ? [normalizeWhitespace(chunkId)] : []))
        .filter(Boolean),
    ),
    sourceTranscriptRanges: unique(
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
      const [start, end] = range.split(":").map((value) => Number.parseInt(value, 10));
      return [start, end] as [number, number];
    }),
    sourceText:
      typeof raw.sourceText === "string" ? truncateText(normalizeWhitespace(raw.sourceText), 220) : null,
    aliases: unique(
      (Array.isArray(raw.aliases) ? raw.aliases : [])
        .flatMap((alias) => (typeof alias === "string" ? [normalizeWhitespace(alias)] : []))
        .filter(Boolean),
    ),
    notes: unique(
      (Array.isArray(raw.notes) ? raw.notes : [])
        .flatMap((note) => (typeof note === "string" ? [normalizeWhitespace(note)] : []))
        .filter(Boolean),
    ),
    confidence:
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Math.max(0, Math.min(1, raw.confidence))
        : 0.5,
    confidenceReason:
      typeof raw.confidenceReason === "string"
        ? truncateText(normalizeWhitespace(raw.confidenceReason), 220)
        : null,
    evidenceStrength:
      raw.evidenceStrength === "DIRECT" ||
      raw.evidenceStrength === "STRONG_INFERENCE" ||
      raw.evidenceStrength === "WEAK_INFERENCE" ||
      raw.evidenceStrength === "UNCERTAIN"
        ? raw.evidenceStrength
        : "UNCERTAIN",
    openQuestions: unique(
      (Array.isArray(raw.openQuestions) ? raw.openQuestions : [])
        .flatMap((question) => (typeof question === "string" ? [normalizeWhitespace(question)] : []))
        .filter(Boolean),
    ),
    needsHumanReview: raw.needsHumanReview === true,
    humanReviewReason:
      typeof raw.humanReviewReason === "string"
        ? truncateText(normalizeWhitespace(raw.humanReviewReason), 220)
        : null,
    discussionStatus:
      raw.discussionStatus === "discussed" ||
      raw.discussionStatus === "not_discussed" ||
      raw.discussionStatus === "ad_hoc"
        ? raw.discussionStatus
        : undefined,
    discussionTimestampRange:
      typeof raw.discussionTimestampRange === "string"
        ? normalizeWhitespace(raw.discussionTimestampRange)
        : null,
    consolidationReason:
      typeof raw.consolidationReason === "string"
        ? truncateText(normalizeWhitespace(raw.consolidationReason), 220)
        : null,
  };
}

type PageReferenceHint = {
  title: string;
  normalizedTitle: string;
  pages: number[];
  lineText: string;
};

function expandPageReferenceList(value: string): number[] {
  const pages: number[] = [];
  for (const part of value.split(",")) {
    const trimmed = normalizeWhitespace(part);
    if (!trimmed) continue;
    const rangeMatch = trimmed.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
        for (let page = start; page <= end; page += 1) {
          pages.push(page);
        }
      }
      continue;
    }
    const page = Number.parseInt(trimmed, 10);
    if (Number.isFinite(page) && page > 0) {
      pages.push(page);
    }
  }
  return unique(pages).sort((left, right) => left - right);
}

function cleanHintTitle(value: string): string {
  return normalizeWhitespace(value).replace(/\.+$/g, "").trim();
}

function extractPageReferenceHints(chunkText: string): PageReferenceHint[] {
  const hints: PageReferenceHint[] = [];

  for (const rawLine of chunkText.split("\n")) {
    const line = normalizeWhitespace(rawLine);
    if (!line) continue;
    const match = line.match(
      /^\s*(?:[a-z]\.|[0-9]+\.)\s+(.+?)\s*\((?:please\s+refer\s+to\s+[^)]*?)pages?\s+([^)]+)\)\s*$/i,
    );
    if (!match) continue;
    const title = cleanHintTitle(match[1] ?? "");
    const pages = expandPageReferenceList(match[2] ?? "");
    if (!title || pages.length === 0) continue;
    hints.push({
      title,
      normalizedTitle: normalize(title),
      pages,
      lineText: line,
    });
  }

  return hints;
}

function topicTokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function scoreHintMatch(topic: WorkflowTopic, hint: PageReferenceHint): number {
  const titleNorm = normalize(topic.title);
  if (!titleNorm || !hint.normalizedTitle) return 0;
  if (titleNorm === hint.normalizedTitle) return 100;
  if (titleNorm.includes(hint.normalizedTitle) || hint.normalizedTitle.includes(titleNorm)) {
    return 80;
  }

  const topicTerms = new Set([
    ...topicTokens(topic.title),
    ...topic.aliases.flatMap((alias) => topicTokens(alias)),
  ]);
  const hintTerms = topicTokens(hint.title);
  if (topicTerms.size === 0 || hintTerms.length === 0) return 0;

  let overlap = 0;
  for (const term of hintTerms) {
    if (topicTerms.has(term)) overlap += 1;
  }
  if (overlap === hintTerms.length && hintTerms.length > 0) {
    return 70 + hintTerms.length;
  }
  return overlap * 10;
}

function attachPageReferenceHintsToTopics(options: {
  topics: WorkflowTopic[];
  chunkId: string;
  hints: PageReferenceHint[];
}): WorkflowTopic[] {
  if (options.hints.length === 0) return options.topics;

  return options.topics.map((topic) => {
    if (!topic.sourceChunkIds.includes(options.chunkId)) return topic;

    let bestHint: PageReferenceHint | null = null;
    let bestScore = 0;
    for (const hint of options.hints) {
      const score = scoreHintMatch(topic, hint);
      if (score > bestScore) {
        bestScore = score;
        bestHint = hint;
      }
    }

    if (!bestHint || bestScore < 30) return topic;

    const note = `Package line references support pages ${bestHint.pages[0]}-${bestHint.pages.at(-1)}.`;
    return {
      ...topic,
      sourcePages: unique([...topic.sourcePages, ...bestHint.pages]).sort((left, right) => left - right),
      notes: unique([...topic.notes, note]),
    };
  });
}

function attachPageReferenceHintsToState(options: {
  state: WorkflowState;
  chunkId: string;
  chunkText: string;
}): WorkflowState {
  const hints = extractPageReferenceHints(options.chunkText);
  if (hints.length === 0) return options.state;

  return {
    ...options.state,
    documentTopics: attachPageReferenceHintsToTopics({
      topics: options.state.documentTopics,
      chunkId: options.chunkId,
      hints,
    }),
    extraTopics: attachPageReferenceHintsToTopics({
      topics: options.state.extraTopics,
      chunkId: options.chunkId,
      hints,
    }),
  };
}

function formatCompactPageList(pages: number[]): string {
  if (pages.length === 0) return "";
  if (pages.length === 1) return String(pages[0]);

  const ranges: string[] = [];
  let start = pages[0];
  let end = pages[0];

  for (let index = 1; index < pages.length; index += 1) {
    const page = pages[index];
    if (page === end + 1) {
      end = page;
      continue;
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    start = page;
    end = page;
  }

  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return ranges.join(", ");
}

function findTopicsRelevantToPackageChunk(options: {
  state: WorkflowState;
  pageNumbers: number[];
  chunkId: string;
}): WorkflowTopic[] {
  const pageSet = new Set(options.pageNumbers);

  return [...options.state.documentTopics, ...options.state.extraTopics]
    .filter(
      (topic) =>
        topic.sourceChunkIds.includes(options.chunkId) ||
        topic.sourcePages.some((page) => pageSet.has(page)),
    )
    .sort((left, right) => {
      const leftOverlap = left.sourcePages.filter((page) => pageSet.has(page)).length;
      const rightOverlap = right.sourcePages.filter((page) => pageSet.has(page)).length;
      if (leftOverlap !== rightOverlap) return rightOverlap - leftOverlap;
      return left.title.localeCompare(right.title);
    })
    .slice(0, 8);
}

function dedupeTopics(topics: WorkflowTopic[]): WorkflowTopic[] {
  const byKey = new Map<string, WorkflowTopic>();
  for (const topic of topics) {
    const key = topic.itemNumber?.trim().toLowerCase() || `${normalize(topic.title)}::${normalize(topic.sectionLabel)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, topic);
      continue;
    }
    byKey.set(key, {
      ...existing,
      title: topic.title.length > existing.title.length ? topic.title : existing.title,
      sourcePages: unique([...existing.sourcePages, ...topic.sourcePages]).sort((a, b) => a - b),
      sourceChunkIds: unique([...existing.sourceChunkIds, ...topic.sourceChunkIds]),
      sourceTranscriptRanges: mergeClosedIntervals([
        ...existing.sourceTranscriptRanges,
        ...topic.sourceTranscriptRanges,
      ]),
      discussionTimestampRange: mergeDiscussionTimestampRange(
        existing.discussionTimestampRange,
        topic.discussionTimestampRange,
      ),
      discussionStatus: existing.discussionStatus === "discussed" || topic.discussionStatus === "discussed"
        ? "discussed"
        : topic.discussionStatus ?? existing.discussionStatus,
      aliases: unique([...existing.aliases, ...topic.aliases]),
      notes: unique([...existing.notes, ...topic.notes]),
      openQuestions: unique([...existing.openQuestions, ...topic.openQuestions]),
      needsHumanReview: existing.needsHumanReview || topic.needsHumanReview,
      humanReviewReason:
        unique([existing.humanReviewReason, topic.humanReviewReason].filter(Boolean) as string[]).join(
          " | ",
        ) || null,
      confidence: Math.max(existing.confidence, topic.confidence),
      visibility:
        existing.visibility === "RESTRICTED" || topic.visibility === "RESTRICTED"
          ? "RESTRICTED"
          : existing.visibility === "PUBLIC" || topic.visibility === "PUBLIC"
            ? "PUBLIC"
            : "UNKNOWN",
    });
  }
  return [...byKey.values()];
}

function normalizeChanges(raw: unknown): WorkflowChanges | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const summary = unique(
    (Array.isArray(record.summary) ? record.summary : [])
      .flatMap((entry) => (typeof entry === "string" ? [normalizeWhitespace(entry)] : []))
      .filter(Boolean),
  )
    .map((entry) => truncateText(entry, 220))
    .slice(0, 24);

  return summary.length > 0 ? { summary } : undefined;
}

function dedupeDiscrepancies(discrepancies: WorkflowDiscrepancy[]): WorkflowDiscrepancy[] {
  const byId = new Map<string, WorkflowDiscrepancy>();
  for (const disc of discrepancies) {
    if (!byId.has(disc.id)) {
      byId.set(disc.id, disc);
    }
  }
  return [...byId.values()];
}

export function normalizeDiscrepancies(raw: unknown): WorkflowDiscrepancy[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item, idx) => {
      if (!item || typeof item !== "object") return [];
      const rec = item as Record<string, unknown>;
      const snippet = typeof rec.snippet === "string" ? normalizeWhitespace(rec.snippet) : "";
      const suggestedTitle =
        typeof rec.suggestedTitle === "string" ? normalizeWhitespace(rec.suggestedTitle) : "";
      if (!snippet && !suggestedTitle) return [];
      const range =
        Array.isArray(rec.transcriptRange) && rec.transcriptRange.length === 2
          ? ([Number(rec.transcriptRange[0]), Number(rec.transcriptRange[1])] as [number, number])
          : ([0, 0] as [number, number]);
      return [
        {
          id: typeof rec.id === "string" ? rec.id : `disc-${idx + 1}-${randomUUID().slice(0, 8)}`,
          transcriptRange: range,
          timestamp: typeof rec.timestamp === "string" ? rec.timestamp : "Unknown time",
          speaker: typeof rec.speaker === "string" ? rec.speaker : null,
          snippet: truncateText(snippet, 300),
          suggestedTitle: truncateText(suggestedTitle || "Ad-hoc Discussion", 100),
          suggestedSection: typeof rec.suggestedSection === "string" ? rec.suggestedSection : null,
          clarificationQuestion:
            typeof rec.clarificationQuestion === "string"
              ? rec.clarificationQuestion
              : `It looks like ${suggestedTitle || "this topic"} was discussed at ${rec.timestamp || "this time"}, but does not appear on the official agenda. Should this be included as an agenda item?`,
        },
      ];
    });
}

export function normalizeWorkflowState(value: unknown, fallback: WorkflowState): WorkflowResponse {
  const record = (value && typeof value === "object" ? value : {}) as Partial<WorkflowResponse & { discrepancies?: unknown }>;
  const documentTopics = dedupeTopics(
    (Array.isArray(record.documentTopics) ? record.documentTopics : [])
      .map((topic) => normalizeTopic(topic as Partial<WorkflowTopic>))
      .filter((topic): topic is WorkflowTopic => Boolean(topic)),
  );
  const extraTopics = dedupeTopics(
    (Array.isArray(record.extraTopics) ? record.extraTopics : [])
      .map((topic) => normalizeTopic(topic as Partial<WorkflowTopic>))
      .filter((topic): topic is WorkflowTopic => Boolean(topic)),
  );
  return rehomeOverflowDiscussionTopics({
    documentTopics: preserveTranscriptProvenance(
      preserveItemNumbers(
        mergeTopicUpdates(documentTopics, fallback.documentTopics),
        fallback.documentTopics,
      ),
      fallback.documentTopics,
    ),
    extraTopics: preserveTranscriptProvenance(
      preserveItemNumbers(
        mergeTopicUpdates(extraTopics, fallback.extraTopics),
        fallback.extraTopics,
      ),
      fallback.extraTopics,
    ),
    uncertainties: unique([
      ...fallback.uncertainties,
      ...(Array.isArray(record.uncertainties) ? record.uncertainties : [])
        .flatMap((entry) => (typeof entry === "string" ? [normalizeWhitespace(entry)] : []))
        .filter(Boolean),
    ]),
    discrepancies: dedupeDiscrepancies([
      ...(fallback.discrepancies || []),
      ...normalizeDiscrepancies(record.discrepancies),
    ]),
    packageItemNumbers: unique(fallback.packageItemNumbers ?? []),
    changes: normalizeChanges(record.changes),
  });
}

function mergeDiscussionTimestampRange(
  left?: string | null,
  right?: string | null,
): string | null {
  return formatDiscussionTimestampRanges([
    ...parseDiscussionTimestampRanges(left),
    ...parseDiscussionTimestampRanges(right),
  ]);
}

function findPriorTopic(topic: WorkflowTopic, previous: WorkflowTopic[]): WorkflowTopic | undefined {
  if (topic.itemNumber) {
    const code = topic.itemNumber.trim().toLowerCase();
    const byNumber = previous.find((entry) => (entry.itemNumber || "").trim().toLowerCase() === code);
    if (byNumber) return byNumber;
  }
  const titleMatches = previous.filter(entry => normalize(entry.title) === normalize(topic.title) && normalize(entry.sectionLabel) === normalize(topic.sectionLabel));
  return titleMatches.length === 1 ? titleMatches[0] : undefined;
}

function preserveItemNumbers(next: WorkflowTopic[], previous: WorkflowTopic[]): WorkflowTopic[] {
  if (previous.length === 0) return next;
  return next.map((topic) => {
    const prior = findPriorTopic(topic, previous);
    return prior?.itemNumber ? { ...topic, itemNumber: prior.itemNumber } : topic;
  });
}

/** Incremental responses are patches. Omission never deletes an established topic. */
function mergeTopicUpdates(next: WorkflowTopic[], previous: WorkflowTopic[]): WorkflowTopic[] {
  const merged = previous.map(prior => {
    const update = next.find(topic => findPriorTopic(topic, previous) === prior);
    return update ? { ...prior, ...update, itemNumber: prior.itemNumber || update.itemNumber,
      notes: unique([...prior.notes, ...update.notes]), aliases: unique([...prior.aliases, ...update.aliases]) } : prior;
  });
  return [...merged, ...next.filter(topic => !findPriorTopic(topic, previous))];
}

function preserveTranscriptProvenance(next: WorkflowTopic[], previous: WorkflowTopic[]): WorkflowTopic[] {
  if (previous.length === 0) return next;
  return next.map((topic) => {
    const prior = findPriorTopic(topic, previous);
    if (!prior) return topic;
    return {
      ...topic,
      sourceChunkIds: unique([...prior.sourceChunkIds, ...topic.sourceChunkIds]),
      sourceTranscriptRanges: mergeClosedIntervals([
        ...prior.sourceTranscriptRanges,
        ...topic.sourceTranscriptRanges,
      ]),
      discussionTimestampRange: mergeDiscussionTimestampRange(
        prior.discussionTimestampRange,
        topic.discussionTimestampRange,
      ),
      discussionStatus:
        prior.discussionStatus === "discussed" || topic.discussionStatus === "discussed"
          ? "discussed"
          : topic.discussionStatus ?? prior.discussionStatus,
    };
  });
}

export function sortTopics(topics: WorkflowTopic[]): WorkflowTopic[] {
  return topics
    .map((topic, originalIndex) => ({ topic, originalIndex }))
    .sort((left, right) => {
      const compared = compareAgendaItemCodes(left.topic.itemNumber, right.topic.itemNumber);
      if (compared !== 0) return compared;
      return left.originalIndex - right.originalIndex;
    })
    .map(({ topic }) => topic);
}

function discussionSectionCodes(topics: WorkflowTopic[]): string[] {
  const named = unique(
    topics
      .filter((topic) => /items for discussion/i.test(topic.title || ""))
      .map((topic) => (topic.itemNumber || "").trim())
      .filter((code) => /^\d+\.D$/i.test(code)),
  );
  if (named.length > 0) return named;
  const pm = inferPropertyManagementReportNumber(topics);
  return pm ? [`${pm}.D`] : [];
}

function occupiesDiscussionLeaf(
  itemNumber: string | null | undefined,
  sectionCodes: string[],
): boolean {
  const code = (itemNumber || "").trim().toLowerCase();
  if (!code) return false;
  return sectionCodes.some((section) => code.startsWith(`${section.trim().toLowerCase()}.`));
}

function hasPackageGrounding(topic: WorkflowTopic): boolean {
  if (topic.sourcePages.length > 0) return true;
  if (topic.sourceChunkIds.some((id) => /document/i.test(id))) return true;
  return /board package/i.test(topic.confidenceReason || "");
}

function lockedDiscussionCodes(state: WorkflowState): Set<string> {
  const sections = discussionSectionCodes(state.documentTopics);
  const lock = new Set<string>();
  for (const raw of state.packageItemNumbers ?? []) {
    const code = raw.trim().toLowerCase();
    if (!code) continue;
    if (
      sections.some((section) => section.toLowerCase() === code) ||
      occupiesDiscussionLeaf(code, sections)
    ) {
      lock.add(code);
    }
  }
  if (lock.size > 0) return lock;
  for (const topic of state.documentTopics) {
    const code = (topic.itemNumber || "").trim().toLowerCase();
    if (!code) continue;
    if (sections.some((section) => section.toLowerCase() === code)) {
      lock.add(code);
      continue;
    }
    if (occupiesDiscussionLeaf(code, sections) && hasPackageGrounding(topic)) {
      lock.add(code);
    }
  }
  return lock;
}

function demoteOverflowDiscussionTopic(topic: WorkflowTopic): WorkflowTopic {
  const itemType =
    topic.itemType === "discussion_topic" || topic.itemType === "other" || !topic.itemType
      ? "extra_topic"
      : topic.itemType;
  return {
    ...topic,
    itemNumber: undefined,
    itemType,
    discussionStatus: "ad_hoc",
  };
}

/**
 * Moves transcript-only items numbered past the official items-for-discussion list into extraTopics.
 */
export function rehomeOverflowDiscussionTopics(state: WorkflowState): WorkflowState {
  const lock = lockedDiscussionCodes(state);
  if (lock.size === 0) return state;
  const sections = discussionSectionCodes(state.documentTopics);
  const overflow: WorkflowTopic[] = [];
  const documentTopics: WorkflowTopic[] = [];
  for (const topic of state.documentTopics) {
    const code = (topic.itemNumber || "").trim().toLowerCase();
    if (occupiesDiscussionLeaf(code, sections) && !lock.has(code)) {
      overflow.push(topic);
    } else {
      documentTopics.push(topic);
    }
  }
  if (overflow.length === 0) return state;

  const extraTopics = [...state.extraTopics];
  for (const topic of overflow) {
    const demoted = demoteOverflowDiscussionTopic(topic);
    const existingIndex = extraTopics.findIndex(
      (entry) => normalize(entry.title) === normalize(demoted.title),
    );
    if (existingIndex === -1) {
      extraTopics.push(demoted);
      continue;
    }
    const existing = extraTopics[existingIndex];
    extraTopics[existingIndex] = {
      ...existing,
      sourceChunkIds: unique([...existing.sourceChunkIds, ...demoted.sourceChunkIds]),
      sourceTranscriptRanges: mergeClosedIntervals([
        ...existing.sourceTranscriptRanges,
        ...demoted.sourceTranscriptRanges,
      ]),
      discussionTimestampRange: mergeDiscussionTimestampRange(
        existing.discussionTimestampRange,
        demoted.discussionTimestampRange,
      ),
      aliases: unique([...existing.aliases, ...demoted.aliases]),
      notes: unique([...existing.notes, ...demoted.notes]),
      discussionStatus: "ad_hoc",
      itemNumber: undefined,
    };
  }

  return {
    ...state,
    documentTopics,
    extraTopics,
  };
}

function emptyAdHocSectionTopic(itemNumber: string): WorkflowTopic {
  return {
    title: "Ad-hoc items",
    sectionLabel: "Property Management Report",
    itemType: "ad_hoc_discussion",
    itemNumber,
    visibility: "PUBLIC",
    sourcePages: [],
    sourceChunkIds: [],
    sourceTranscriptRanges: [],
    discussionStatus: "ad_hoc",
    discussionTimestampRange: null,
    consolidationReason:
      "Synthesized section for transcript-only matters that are not on the official agenda.",
    sourceText: null,
    aliases: [],
    notes: [],
    confidence: 1,
    confidenceReason: "Ad-hoc bucket created so extra items nest under the Property Management Report",
    evidenceStrength: "DIRECT",
    openQuestions: [],
    needsHumanReview: false,
    humanReviewReason: null,
  };
}

export function applyAdHocOutlinePlacement(state: WorkflowState): WorkflowState {
  const rehomed = rehomeOverflowDiscussionTopics(state);
  const extraTopics = rehomed.extraTopics.filter((topic) => topic.title.trim());
  const pmReportNumber =
    inferPropertyManagementReportNumber(rehomed.documentTopics) || "4";
  const sectionCode = `${pmReportNumber}.E`;
  const { heading, leaves: occupying, rest } = partitionAdHocOccupants(
    rehomed.documentTopics,
    sectionCode,
  );
  const leaves = [...occupying, ...extraTopics];
  if (leaves.length === 0) return rehomed;

  const placement = planAdHocPlacement(
    [...rest, ...(heading ? [heading] : [])],
    leaves.length,
    pmReportNumber,
  );
  if (!placement) return rehomed;

  const numberedExtra = leaves.map((topic, index) => ({
    ...topic,
    itemNumber: placement.nextItemCodes[index],
    sectionLabel:
      topic.sectionLabel && topic.sectionLabel !== "Unknown"
        ? topic.sectionLabel
        : "Property Management Report: Ad-hoc items",
    discussionStatus: topic.discussionStatus ?? "ad_hoc",
    itemType:
      topic.itemType === "other" || !topic.itemType ? "ad_hoc_discussion" : topic.itemType,
  }));

  const documentTopics = heading
    ? [...rest, { ...heading, itemNumber: placement.sectionCode }]
    : [...rest, emptyAdHocSectionTopic(placement.sectionCode)];

  return {
    ...rehomed,
    documentTopics,
    extraTopics: numberedExtra,
  };
}

async function getAgendaResumeCheckpoint(meetingId: string): Promise<{
  state: WorkflowState;
  processedPackageChunks: number;
  processedTranscriptChunks: number;
  lastProcessedPackageSortOrder: number;
  lastProcessedTranscriptSortOrder: number;
} | null> {
  const db = getDb();
  const snapshots = await db
    .select()
    .from(meetingsV2AgendaChunkSnapshots)
    .where(eq(meetingsV2AgendaChunkSnapshots.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV2AgendaChunkSnapshots.createdAt));

  if (snapshots.length === 0) return null;

  let bestCheckpoint: {
    state: WorkflowState;
    processedPackageChunks: number;
    processedTranscriptChunks: number;
    lastProcessedPackageSortOrder: number;
    lastProcessedTranscriptSortOrder: number;
  } | null = null;

  const processedPackageSortOrders = new Set<number>();
  const processedTranscriptSortOrders = new Set<number>();
  let lastProcessedPackageSortOrder = -1;
  let lastProcessedTranscriptSortOrder = -1;
  let state: WorkflowState = {
    documentTopics: [],
    extraTopics: [],
    uncertainties: [],
  };

  for (const snapshot of snapshots) {
    const parsedState = safeParseObject<WorkflowState>(snapshot.afterStateJson);
    if (!parsedState) continue;
    state = parsedState;
    if (snapshot.chunkKind === "document") {
      processedPackageSortOrders.add(snapshot.sortOrder);
      lastProcessedPackageSortOrder = Math.max(lastProcessedPackageSortOrder, snapshot.sortOrder);
    } else {
      processedTranscriptSortOrders.add(snapshot.sortOrder);
      lastProcessedTranscriptSortOrder = Math.max(lastProcessedTranscriptSortOrder, snapshot.sortOrder);
    }
    bestCheckpoint = {
      state,
      processedPackageChunks: processedPackageSortOrders.size,
      processedTranscriptChunks: processedTranscriptSortOrders.size,
      lastProcessedPackageSortOrder,
      lastProcessedTranscriptSortOrder,
    };
  }

  return bestCheckpoint;
}

function buildStateText(state: WorkflowState, options?: { compact?: boolean }): string {
  if (!options?.compact) {
    return JSON.stringify(state, null, 2);
  }

  return JSON.stringify(
    {
      documentTopics: state.documentTopics.map((topic) => ({
        itemNumber: topic.itemNumber,
        title: topic.title,
        sectionLabel: topic.sectionLabel,
        itemType: topic.itemType,
        visibility: topic.visibility,
        sourcePages: topic.sourcePages,
        sourceChunkIds: topic.sourceChunkIds,
        sourceTranscriptRanges: topic.sourceTranscriptRanges,
        discussionStatus: topic.discussionStatus,
        discussionTimestampRange: topic.discussionTimestampRange,
        consolidationReason: topic.consolidationReason,
        sourceText: topic.sourceText,
        aliases: topic.aliases,
        notes: topic.notes,
      })),
      extraTopics: state.extraTopics.map((topic) => ({
        itemNumber: topic.itemNumber,
        title: topic.title,
        sectionLabel: topic.sectionLabel,
        itemType: topic.itemType,
        visibility: topic.visibility,
        sourcePages: topic.sourcePages,
        sourceChunkIds: topic.sourceChunkIds,
        sourceTranscriptRanges: topic.sourceTranscriptRanges,
        discussionStatus: topic.discussionStatus,
        discussionTimestampRange: topic.discussionTimestampRange,
        consolidationReason: topic.consolidationReason,
        sourceText: topic.sourceText,
        aliases: topic.aliases,
        notes: topic.notes,
      })),
      uncertainties: state.uncertainties,
      discrepancies: state.discrepancies,
    },
    null,
    2,
  );
}

function buildPackageUserText(options: {
  meetingId: string;
  state: WorkflowState;
  chunkIndex: number;
  chunkTotal: number;
  chunkId: string;
  pageNumbers: number[];
  chunkText: string;
}): string {
  const pageReferenceHints = extractPageReferenceHints(options.chunkText);
  const relevantExistingTopics = findTopicsRelevantToPackageChunk({
    state: options.state,
    pageNumbers: options.pageNumbers,
    chunkId: options.chunkId,
  });
  return `Meeting ID: ${options.meetingId}

CURRENT STATE
${buildStateText(options.state, { compact: true })}

PACKAGE CHUNK ${options.chunkIndex + 1} OF ${options.chunkTotal}
Chunk ID: ${options.chunkId}
Pages: ${options.pageNumbers.join(", ")}

${pageReferenceHints.length > 0
    ? `PAGE REFERENCE HINTS
${pageReferenceHints
  .map((hint) => `- ${hint.title}: support pages ${hint.pages.join(", ")}`)
  .join("\n")}

When you update or create one of these agenda matters, include both the agenda page and the referenced support pages in sourcePages.

`
    : ""}${relevantExistingTopics.length > 0
    ? `TOPICS ALREADY LINKED TO THIS CHUNK
${relevantExistingTopics
  .map(
    (topic) =>
      `- ${topic.title} | pages ${formatCompactPageList(topic.sourcePages)} | chunk refs ${topic.sourceChunkIds.join(", ")}`,
  )
  .join("\n")}

If this package chunk is one of the support-page references for a topic above, enrich that existing topic instead of treating this chunk as unrelated boilerplate.

`
    : ""}${options.chunkText}`;
}

export type TranscriptFloorPointer = {
  itemNumber: string | null;
  title: string;
  lastSequenceEnd: number;
  discussionTimestampRange: string | null;
  upcomingLeaves: Array<{ itemNumber: string | null; title: string }>;
};

function lastTranscriptSequenceEnd(topic: Pick<WorkflowTopic, "sourceTranscriptRanges">): number | null {
  if (!topic.sourceTranscriptRanges.length) return null;
  return topic.sourceTranscriptRanges.reduce(
    (max, range) => Math.max(max, range[0], range[1]),
    Number.NEGATIVE_INFINITY,
  );
}

function isOutlineLeafTopic(topic: WorkflowTopic, all: WorkflowTopic[]): boolean {
  const code = topic.itemNumber?.trim();
  if (!code) return true;
  const normalized = code.toLowerCase();
  return !all.some((other) => parentAgendaItemCode(other.itemNumber)?.toLowerCase() === normalized);
}

function topicHasDiscussionTiming(topic: WorkflowTopic): boolean {
  return parseDiscussionTimestampRanges(topic.discussionTimestampRange).length > 0;
}

export function listUpcomingUndiscussedLeaves(
  state: {
    documentTopics: WorkflowTopic[];
    extraTopics: WorkflowTopic[];
  },
  currentItemNumber: string | null,
): Array<{ itemNumber: string | null; title: string }> {
  const all = [...state.documentTopics, ...state.extraTopics];
  return all
    .filter((topic) => isOutlineLeafTopic(topic, all))
    .filter((topic) => !topicHasDiscussionTiming(topic))
    .filter((topic) => {
      if (!currentItemNumber) return true;
      return compareAgendaItemCodes(currentItemNumber, topic.itemNumber) < 0;
    })
    .slice(0, 8)
    .map((topic) => ({
      itemNumber: topic.itemNumber?.trim() || null,
      title: topic.title,
    }));
}

export function inferTranscriptFloorPointer(state: {
  documentTopics: WorkflowTopic[];
  extraTopics: WorkflowTopic[];
}): TranscriptFloorPointer | null {
  const all = [...state.documentTopics, ...state.extraTopics];
  const withRanges = all.filter((topic) => {
    if (topic.discussionStatus === "not_discussed") return false;
    return lastTranscriptSequenceEnd(topic) !== null;
  });
  if (withRanges.length === 0) return null;

  const leaves = withRanges.filter((topic) => isOutlineLeafTopic(topic, all));
  const pool = leaves.length > 0 ? leaves : withRanges;
  pool.sort((left, right) => {
    const leftEnd = lastTranscriptSequenceEnd(left) ?? -1;
    const rightEnd = lastTranscriptSequenceEnd(right) ?? -1;
    if (leftEnd !== rightEnd) return rightEnd - leftEnd;
    const leftDepth = (left.itemNumber || "").split(".").length;
    const rightDepth = (right.itemNumber || "").split(".").length;
    return rightDepth - leftDepth;
  });
  const winner = pool[0];
  const itemNumber = winner.itemNumber?.trim() || null;
  return {
    itemNumber,
    title: winner.title,
    lastSequenceEnd: lastTranscriptSequenceEnd(winner) ?? 0,
    discussionTimestampRange: winner.discussionTimestampRange ?? null,
    upcomingLeaves: listUpcomingUndiscussedLeaves(state, itemNumber),
  };
}

function formatTranscriptFloorPointer(pointer: TranscriptFloorPointer | null): string {
  if (!pointer) {
    return `FLOOR POINTER
No agenda item is on the floor yet. The first substantive matter in this chunk is operation 1 (OPEN).`;
  }

  const code = pointer.itemNumber ? pointer.itemNumber : "(no itemNumber)";
  const timing = pointer.discussionTimestampRange
    ? `Discussion timing so far: ${pointer.discussionTimestampRange}`
    : "Discussion timing so far: unknown";
  const upcoming =
    pointer.upcomingLeaves.length > 0
      ? `Upcoming package leaves not yet given a transcript range:
${pointer.upcomingLeaves
  .map((leaf) => `- ${leaf.itemNumber ?? "?"} — ${leaf.title}`)
  .join("\n")}
If speakers name one of these, OPEN that item (operation 1). A different unit number than the floor item is OPEN even while wrap-up of the floor continues (overlap is allowed). Do not skip them.`
      : "No later package leaves are waiting for a transcript range.";

  return `FLOOR POINTER (item on the table at the start of this chunk)
- ${code} — ${pointer.title}
- Last attached transcript segment: ${pointer.lastSequenceEnd}
- ${timing}

${upcoming}

Walk cues in order. Operations: (1) OPEN a new span / move the floor, (2) ENRICH the floor item, (3) CHANGE LIFECYCLE of the floor item. Assent does not open the next outline item.`;
}

export function buildTranscriptUserText(options: {
  meetingId: string;
  state: WorkflowState;
  chunkIndex: number;
  chunkTotal: number;
  chunkId: string;
  sequenceRange: [number, number];
  chunkText: string;
}): string {
  return `Meeting ID: ${options.meetingId}

CURRENT STATE
${buildStateText(options.state, { compact: true })}

${formatTranscriptFloorPointer(inferTranscriptFloorPointer(options.state))}

TRANSCRIPT CHUNK ${options.chunkIndex + 1} OF ${options.chunkTotal}
Chunk ID: ${options.chunkId}
Segments: ${options.sequenceRange[0]}-${options.sequenceRange[1]}

Transcript chunk ids are stable references. If you update or create a topic from this chunk, include this chunk id in sourceChunkIds.

${options.chunkText}`;
}

export async function extractAgendaItemsWithAi(
  meetingId: string,
  options?: {
    onProgress?: (progress: {
      current: number;
      total: number;
      label: string;
    }) => Promise<void> | void;
  },
): Promise<{
  meetingId: string;
  extractor: string;
  agendaItemCount: number;
}> {
  const db = getDb();
  const [meeting, boardPackage, sections, storedChunks] = await Promise.all([
    db.select().from(meetingsV2).where(eq(meetingsV2.id, meetingId)),
    db
      .select()
      .from(meetingsV2SourceArtifacts)
      .where(
        and(
          eq(meetingsV2SourceArtifacts.meetingV2Id, meetingId),
          eq(meetingsV2SourceArtifacts.type, "board_package"),
        ),
      ),
    db
      .select()
      .from(meetingsV2DocumentSections)
      .where(eq(meetingsV2DocumentSections.meetingV2Id, meetingId)),
    db
      .select()
      .from(meetingsV2DocumentChunks)
      .where(eq(meetingsV2DocumentChunks.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2DocumentChunks.sortOrder)),
  ]);

  if (!meeting[0]) {
    throw new Error(`V2 meeting ${meetingId} was not found.`);
  }
  if (!boardPackage[0]) {
    throw new Error("Board package artifact not found for meeting.");
  }

  const packageChunks = storedChunks
    .filter((chunk) => chunk.chunkKind === "document")
    .map((chunk) => {
      const metadata = safeParseObject<{ aiChunkId?: string; pageNumbers?: number[] }>(chunk.metadataJson);
      return {
        id: chunk.id,
        sourceArtifactId: chunk.sourceArtifactId,
        aiChunkId:
          metadata?.aiChunkId ?? `document_chunk_${String(chunk.sortOrder + 1).padStart(3, "0")}`,
        index: chunk.sortOrder,
        pageNumbers:
          metadata?.pageNumbers ??
          [chunk.pageStart, chunk.pageEnd].flatMap((entry) =>
            typeof entry === "number" && Number.isFinite(entry) ? [entry] : [],
          ),
        text: chunk.text,
      };
    });
  const transcriptChunks = storedChunks
    .filter((chunk) => chunk.chunkKind === "transcript")
    .map((chunk, transcriptIndex) => {
      const metadata = safeParseObject<{ aiChunkId?: string; sequenceRange?: [number, number] }>(
        chunk.metadataJson,
      );
      return {
        id: chunk.id,
        sourceArtifactId: chunk.sourceArtifactId,
        aiChunkId:
          metadata?.aiChunkId ??
          `transcript_chunk_${String(transcriptIndex + 1).padStart(3, "0")}`,
        index: chunk.sortOrder,
        transcriptIndex,
        sequenceRange:
          metadata?.sequenceRange ?? [chunk.sequenceStart ?? 0, chunk.sequenceEnd ?? 0],
        text: chunk.text,
      };
    });

  if (packageChunks.length === 0) {
    throw new Error("No stored document chunks found for this meeting.");
  }

  const totalChunks = packageChunks.length + transcriptChunks.length;
  const resumeCheckpoint = await getAgendaResumeCheckpoint(meetingId);
  let state: WorkflowState = resumeCheckpoint?.state ?? {
    documentTopics: [],
    extraTopics: [],
    uncertainties: [],
  };

  // If starting fresh, extract the authoritative Board Package Agenda JSON
  if (state.documentTopics.length === 0) {
    try {
      const agendaSplit = upcomingAgendaSplit(meeting[0].settings);
      const fullAgenda = await extractBoardPackageAgendaJson({
        meetingId,
        agendaContentEndsAtPage: agendaSplit ?? undefined,
        onProgress: async (p) => {
          await options?.onProgress?.({
            current: p.current,
            total: totalChunks + 15,
            label: p.label,
          });
        },
      });
      const flattened = flattenBoardPackageAgenda(fullAgenda);
      state.documentTopics = flattened.map((item) => {
        const matchedChunkIds = packageChunks
          .filter((pc) => pc.pageNumbers.some((p) => item.sourcePages.includes(p)))
          .map((pc) => pc.aiChunkId);

        return {
          title: item.title,
          sectionLabel: item.sectionLabel,
          itemType: item.itemType,
          itemNumber: item.itemNumber,
          visibility: "PUBLIC",
          sourcePages: item.sourcePages,
          sourceChunkIds: matchedChunkIds,
          sourceTranscriptRanges: [],
          discussionStatus: "not_discussed",
          discussionTimestampRange: null,
          consolidationReason: null,
          sourceText: item.summary ?? null,
          aliases: item.contractorsOrVendors ?? [],
          notes: [
            item.financials?.amount ? `Amount: ${item.financials.amount}` : null,
            item.managementRecommendation ? `Recommendation: ${item.managementRecommendation}` : null,
            item.attachmentReferences?.length ? `Attachments: ${item.attachmentReferences.join("; ")}` : null,
          ].filter(Boolean) as string[],
          confidence: 1,
          confidenceReason: "Extracted from board package core report",
          evidenceStrength: "DIRECT",
          openQuestions: [],
          needsHumanReview: false,
          humanReviewReason: null,
        };
      });
      state.packageItemNumbers = unique(
        flattened.map((item) => item.itemNumber).filter((code): code is string => Boolean(code?.trim())),
      );
    } catch (err) {
    throw new Error(`Board package agenda extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!state.packageItemNumbers?.length) {
    state.packageItemNumbers = unique(
      state.documentTopics
        .filter((topic) => {
          const code = (topic.itemNumber || "").trim();
          if (!code) return false;
          if (/items for discussion/i.test(topic.title) && /^\d+\.D$/i.test(code)) return true;
          return hasPackageGrounding(topic);
        })
        .map((topic) => (topic.itemNumber || "").trim()),
    );
  }

  const remainingPackageChunks =
    resumeCheckpoint && resumeCheckpoint.lastProcessedPackageSortOrder >= 0
      ? packageChunks.filter((chunk) => chunk.index > resumeCheckpoint.lastProcessedPackageSortOrder)
      : packageChunks;
  const remainingTranscriptChunks =
    resumeCheckpoint && resumeCheckpoint.lastProcessedTranscriptSortOrder >= 0
      ? transcriptChunks.filter((chunk) => chunk.index > resumeCheckpoint.lastProcessedTranscriptSortOrder)
      : transcriptChunks;

  // Only run package chunks loop if documentTopics was not already populated
  const shouldRunPackageChunks = state.documentTopics.length === 0;

  if (shouldRunPackageChunks) {
    for (const chunk of remainingPackageChunks) {
      await options?.onProgress?.({
        current: chunk.index + 1,
        total: totalChunks,
        label: `Extracting package chunk ${chunk.index + 1}/${packageChunks.length}`,
      });
      const response = await completeAgendaChunk({
        systemInstruction: PACKAGE_SYSTEM_PROMPT,
        userText: buildPackageUserText({
          meetingId,
          state,
          chunkIndex: chunk.index,
          chunkTotal: packageChunks.length,
          chunkId: chunk.aiChunkId,
          pageNumbers: chunk.pageNumbers,
          chunkText: chunk.text,
        }),
      });
      const parsed = await parseWithRepair(response.text);
      const beforeStateJson = JSON.stringify(state);
      const noChange = isNoChangeResponse(parsed);
      if (!noChange) {
        const nextState = normalizeWorkflowState(parsed, state);
        state = attachPageReferenceHintsToState({
          state: nextState,
          chunkId: chunk.aiChunkId,
          chunkText: chunk.text,
        });
      }
      await db.insert(meetingsV2AgendaChunkSnapshots).values({
        id: randomUUID(),
        meetingV2Id: meetingId,
        chunkId: chunk.id,
        chunkKind: "document",
        sortOrder: chunk.index,
        noChange,
        beforeStateJson,
        afterStateJson: JSON.stringify(state),
        requestJson: JSON.stringify({
          chunkId: chunk.aiChunkId,
          pageNumbers: chunk.pageNumbers,
        }),
        responseText: response.text,
        parsedJson: JSON.stringify(noChange ? { status: "no_change" } : parsed),
        usageJson: JSON.stringify(response.usage),
        estimatedCostUsd: null,
        createdAt: nowIso(),
      });
    }
  }

  for (const chunk of remainingTranscriptChunks) {
    const current = packageChunks.length + chunk.transcriptIndex + 1;
    await options?.onProgress?.({
      current,
      total: totalChunks,
      label: `Extracting transcript chunk ${chunk.transcriptIndex + 1}/${transcriptChunks.length}`,
    });
    const response = await completeAgendaChunk({
      systemInstruction: TRANSCRIPT_SYSTEM_PROMPT,
      userText: buildTranscriptUserText({
        meetingId,
        state,
        chunkIndex: chunk.transcriptIndex,
        chunkTotal: transcriptChunks.length,
        chunkId: chunk.aiChunkId,
        sequenceRange: chunk.sequenceRange,
        chunkText: chunk.text,
      }),
    });
    const parsed = await parseWithRepair(response.text);
    const beforeStateJson = JSON.stringify(state);
    const noChange = isNoChangeResponse(parsed);
    if (!noChange) {
      state = normalizeWorkflowState(parsed, state);
    } else {
      state = rehomeOverflowDiscussionTopics(state);
    }
    await db.insert(meetingsV2AgendaChunkSnapshots).values({
      id: randomUUID(),
      meetingV2Id: meetingId,
      chunkId: chunk.id,
      chunkKind: "transcript",
      sortOrder: chunk.index,
      noChange,
      beforeStateJson,
      afterStateJson: JSON.stringify(state),
      requestJson: JSON.stringify({
        chunkId: chunk.aiChunkId,
        sequenceRange: chunk.sequenceRange,
      }),
      responseText: response.text,
      parsedJson: JSON.stringify(noChange ? { status: "no_change" } : parsed),
      usageJson: JSON.stringify(response.usage),
      estimatedCostUsd: null,
      createdAt: nowIso(),
    });
  }

  const placed = applyAdHocOutlinePlacement(state);
  let finalTopics = applyAgendaHierarchyCorrections(
    sortTopics([...placed.documentTopics, ...placed.extraTopics]).map((topic, index) => ({
      ...topic,
      id: `topic-${index}`,
      itemNumber: topic.itemNumber || String(index + 1),
    })),
  );

  const transcriptSegments = await db
    .select({
      sequence: meetingsV2TranscriptSegments.sequence,
      startMs: meetingsV2TranscriptSegments.startMs,
      endMs: meetingsV2TranscriptSegments.endMs,
      startTimestamp: meetingsV2TranscriptSegments.startTimestamp,
      endTimestamp: meetingsV2TranscriptSegments.endTimestamp,
      speakerLabel: meetingsV2TranscriptSegments.speakerLabel,
      text: meetingsV2TranscriptSegments.text,
    })
    .from(meetingsV2TranscriptSegments)
    .where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV2TranscriptSegments.sequence));

  if (transcriptSegments.length > 0) {
    await options?.onProgress?.({
      current: totalChunks,
      total: totalChunks + 1,
      label: "Reviewing transcript span edges",
    });
    const reviewed = await reviewTranscriptTopicSpans({
      topics: finalTopics,
      cues: transcriptSegmentsToReviewCues(transcriptSegments),
      onProgress: async (label) => {
        await options?.onProgress?.({
          current: totalChunks,
          total: totalChunks + 1,
          label,
        });
      },
    });
    const gapped = await assignUnmatchedLeavesInHoles({
      topics: reviewed,
      cues: transcriptSegmentsToReviewCues(transcriptSegments),
      onProgress: async (label) => {
        await options?.onProgress?.({
          current: totalChunks,
          total: totalChunks + 1,
          label,
        });
      },
    });
    const leftover = await assignRemainingHolesToAgenda({
      topics: gapped,
      cues: transcriptSegmentsToReviewCues(transcriptSegments),
      onProgress: async (label) => {
        await options?.onProgress?.({
          current: totalChunks,
          total: totalChunks + 1,
          label,
        });
      },
    });
    const wrapped = extendFloorThroughLifecycleHoles({
      topics: leftover,
      cues: transcriptSegmentsToReviewCues(transcriptSegments),
    });
    finalTopics = finalTopics.map((topic, index) => ({
      ...topic,
      discussionTimestampRange:
        wrapped[index]?.discussionTimestampRange ?? topic.discussionTimestampRange,
      sourceTranscriptRanges:
        wrapped[index]?.sourceTranscriptRanges ?? topic.sourceTranscriptRanges,
      discussionStatus: wrapped[index]?.discussionStatus ?? topic.discussionStatus,
    }));
    finalTopics = applyAgendaHierarchyCorrections(finalTopics);
  }

  const rows = finalTopics.map((topic, sortOrder) => {
    const firstPage = topic.sourcePages[0] ?? null;
    const sourceSection =
      firstPage !== null
        ? sections.find((section) => section.startPage <= firstPage && section.endPage >= firstPage) ?? null
        : null;

    const statusLabel =
      topic.discussionStatus ??
      (topic.sourceTranscriptRanges && topic.sourceTranscriptRanges.length > 0
        ? "discussed"
        : "not_discussed");

    const isRedundantTitle =
      topic.sourceText &&
      normalize(topic.sourceText).slice(0, 40) === normalize(topic.title).slice(0, 40);

    const enrichedSourceText = [
      `Discussion status: ${statusLabel}`,
      topic.sourceTranscriptRanges.length ? `Discussion timing: ${canonicalDiscussionTiming(topic.sourceTranscriptRanges, transcriptSegments)}` : null,
      topic.consolidationReason ? `Consolidation: ${topic.consolidationReason}` : null,
      !isRedundantTitle ? topic.sourceText : null,
      topic.sourceChunkIds.length > 0 ? `Chunk IDs: ${topic.sourceChunkIds.join(", ")}` : null,
      topic.confidenceReason ? `Confidence reason: ${topic.confidenceReason}` : null,
      topic.evidenceStrength ? `Evidence strength: ${topic.evidenceStrength}` : null,
      topic.openQuestions.length > 0 ? `Open questions: ${topic.openQuestions.join("; ")}` : null,
      topic.needsHumanReview
        ? `Needs human review: ${topic.humanReviewReason ?? "Review requested by extractor"}`
        : null,
      topic.aliases.length > 0 ? `Aliases: ${topic.aliases.join("; ")}` : null,
      topic.notes.length > 0 ? `Notes: ${topic.notes.join("; ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      id: stableAgendaId(meetingId, topic.itemNumber ?? "", topic.title),
      meetingV2Id: meetingId,
      sourceArtifactId: boardPackage[0].id,
      sourceSectionId: sourceSection?.id ?? null,
      sectionLabel: topic.sectionLabel,
      title: topic.title,
      normalizedTitle: normalize(topic.title),
      itemNumber: topic.itemNumber || String(sortOrder + 1),
      itemType: topic.itemType,
      sourcePagesJson: JSON.stringify(topic.sourcePages),
      sourceText: enrichedSourceText,
      sortOrder,
      createdAt: new Date().toISOString(),
    } satisfies typeof meetingsV2AgendaItems.$inferInsert;
  });

  if (rows.length > 0) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Extraction produced duplicate agenda identifiers; review the printed item codes.");
    await db.transaction(async tx => {
      await tx.delete(meetingsV2AgendaItems).where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId));
      await tx.insert(meetingsV2AgendaItems).values(rows);
    });
  }

  // Persist initial agenda approval state & transcript discrepancies to meetingsV2.settings
  const currentMeeting = await db.query.meetingsV2.findFirst({
    where: eq(meetingsV2.id, meetingId),
  });
  const currentSettings = ((currentMeeting?.settings as MeetingV2Settings) || {});
  const initialItemStatuses: Record<string, AgendaItemDiscussionStatus> = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const topic = finalTopics[i];
    initialItemStatuses[row.id] =
      topic?.discussionStatus ??
          (topic && topic.sourceTranscriptRanges.length > 0 ? "discussed" : "not_discussed");
  }

  const discrepancies: TranscriptDiscrepancy[] = filterRedundantAddToAgendaDiscrepancies(
    dedupeDiscrepancies(state.discrepancies || []).map((d) => ({
      ...d,
      status: "pending" as const,
    })),
    finalTopics.map((topic) => topic.title),
  );

  await db
    .update(meetingsV2)
    .set({
      settings: {
        ...currentSettings,
        pipelineVersion: MINUTES_PIPELINE_VERSION,
        agendaEvidence: Object.fromEntries(rows.map((row, index) => [row.id, {
          itemNumber: row.itemNumber,
          sourceTranscriptRanges: finalTopics[index].sourceTranscriptRanges,
          sourceChunkIds: finalTopics[index].sourceChunkIds,
          aliases: finalTopics[index].aliases,
          notes: finalTopics[index].notes,
          visibility: finalTopics[index].visibility,
        }])),
        agendaApproval: {
          status: "pending_review",
          approvedAt: null,
          itemStatuses: initialItemStatuses,
          discrepancies,
        },
      },
    })
    .where(eq(meetingsV2.id, meetingId));

  return {
    meetingId,
    extractor: "deepseek_incremental",
    agendaItemCount: rows.length,
  };
}
