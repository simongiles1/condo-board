/**
 * Client-safe helpers for tagging projects mentioned in monthly management
 * reports / board packages. No DB or LLM imports.
 */

import { buildProjectHighlightDomainContext } from "@/lib/email-analysis/project-highlight-shared";
import {
  canonicalizeProjectWorkName,
  compactProjectWorkName,
} from "@/lib/projects/identity-match";
import { parseJsonObjectText } from "@/lib/projects/identity-review-shared";
import { splitProjectMultiValue } from "@/lib/projects/project-multi-values";
import {
  parseProjectYearRange,
  projectYearRangesOverlap,
} from "@/lib/projects/project-year-range";

export const BOARD_REPORT_KINDS = ["management_report", "board_package"] as const;
export type BoardReportKind = (typeof BOARD_REPORT_KINDS)[number];

export const BOARD_REPORT_SECTIONS = [
  "capital",
  "approval",
  "discussion",
  "information",
  "ratification",
  "other",
] as const;
export type BoardReportSection = (typeof BOARD_REPORT_SECTIONS)[number];

export const BOARD_REPORT_RUN_STATUSES = [
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type BoardReportRunStatus = (typeof BOARD_REPORT_RUN_STATUSES)[number];

export const BOARD_REPORT_MATCH_CONFIDENCE = ["high", "medium"] as const;
export type BoardReportMatchConfidence =
  (typeof BOARD_REPORT_MATCH_CONFIDENCE)[number];

export type BoardReportTopic = {
  name: string;
  section: BoardReportSection;
  contractor: string | null;
  location: string | null;
  yearHint: string | null;
  notes: string | null;
};

export type BoardReportMatchableProject = {
  id: string;
  name: string | null;
  aliases: string[];
  yearHint?: string | null;
  phase?: string | null;
  contractor?: string | null;
  location?: string | null;
  equipmentMentions?: string | null;
  scope?: string | null;
};

export type BoardReportTopicMatch = {
  projectId: string;
  score: number;
  confidence: BoardReportMatchConfidence;
};

export type BoardReportAiMatchRow = {
  topicId: string;
  topicName: string;
  projectIds: string[];
  confidence: BoardReportMatchConfidence;
};

export type BoardReportCatalogRow = {
  id: string;
  name: string | null;
  aliases: string[];
  yearHint: string | null;
  phase: string | null;
  contractor: string | null;
  location: string | null;
  equipment: string | null;
  scope: string | null;
};

export type BoardReportStoredTopic = BoardReportTopic & {
  matchedProjectIds: string[];
};

export type BoardReportDocumentReview = {
  id: string;
  filename: string;
  kind: BoardReportKind;
  reportDate: string | null;
  receivedAt: string | null;
  pageCount: number | null;
  parseStatus: string | null;
  error: string | null;
  emailId: string | null;
  topics: BoardReportStoredTopic[];
};

export type BoardReportUnmatchedTopic = {
  name: string;
  canonical: string;
  section: BoardReportSection;
  yearHint: string | null;
  contractor: string | null;
  mentionCount: number;
  reportCount: number;
  reports: Array<{
    filename: string;
    reportDate: string | null;
    kind: BoardReportKind;
  }>;
};

export type BoardReportWaitingDocument = {
  id: string;
  filename: string;
  kind: BoardReportKind;
  reportDate: string | null;
  receivedAt: string | null;
  pageCount: number | null;
  parseStatus: string | null;
  error: string | null;
  emailId: string | null;
};

export type BoardReportScanReview = {
  unmatchedTopics: BoardReportUnmatchedTopic[];
  waitingOnMarkdown: BoardReportWaitingDocument[];
};

export type BoardReportRunRecord = {
  id: string;
  modelId: string;
  status: BoardReportRunStatus;
  reportTotal: number;
  reportCompleted: number;
  skippedUnparsed: number;
  matchedProjectCount: number;
  unmatchedTopicCount: number;
  totalCostUsd: number;
  lastError: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export const BOARD_REPORT_MATCHING_STATUS =
  "Matching topics to the project registry…";
export const BOARD_REPORT_SCAN_MAX_CHARS = 40_000;
export const BOARD_REPORT_SCAN_MAX_OUTPUT_TOKENS = 8192;
export const BOARD_REPORT_MATCH_MAX_OUTPUT_TOKENS = 8192;
export const BOARD_REPORT_MATCH_TOPICS_PER_CALL = 80;
export const BOARD_REPORT_STANDALONE_MAX_PAGES = 40;
export const BOARD_REPORT_TOPIC_MIN_CANONICAL = 6;
export const BOARD_REPORT_MATCH_MAX = 3;
export const BOARD_REPORT_EXACT_SCORE = 1;
export const BOARD_REPORT_AI_HIGH_SCORE = 0.94;
export const BOARD_REPORT_AI_MEDIUM_SCORE = 0.8;

const MONTH_NUMBER: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

const DOT_DATE_RE = /(?:^|[_\s-])((?:19|20)\d{2})\.(\d{1,2})\.(\d{1,2})(?:\b|[_\s-])/;
const MONTH_DATE_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})[.,]?\s+(\d{4})\b/i;

const SECTION_START_RE =
  /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:\d+[.)]\s*)?management\s+reports?\b[^\n]*/i;
const SECTION_END_RE =
  /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:\d+[.)]\s*)?(?:financial statements?|appendix|appendices|correspondence|minutes of previous|in-?camera)\b/i;

function pad2(value: string): string {
  return value.padStart(2, "0");
}

function isoDate(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}-${pad2(String(m))}-${pad2(String(d))}`;
}

/** Report date stamped in the filename when the PM dated the PDF. */
export function parseReportDateFromFilename(
  filename: string,
): string | null {
  const dotted = filename.match(DOT_DATE_RE);
  if (dotted) {
    return isoDate(dotted[1]!, dotted[2]!, dotted[3]!);
  }
  const named = filename.match(MONTH_DATE_RE);
  if (named) {
    const month = MONTH_NUMBER[named[1]!.toLowerCase().replace(/\./g, "")];
    if (!month) return null;
    return isoDate(named[3]!, month, named[2]!);
  }
  return null;
}

function normalizeDocumentLabel(value: string): string {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Filename classifier for the monthly PM report vs a full board package.
 * Rejects management-company contracts, office-hour notices, and TSCC 2573-only packages.
 */
export function classifyBoardDocumentName(
  filename: string,
): BoardReportKind | null {
  const trimmed = filename.trim();
  if (!trimmed) return null;
  if (/\b2573\b/.test(trimmed) && !/\b2517\b/.test(trimmed)) return null;

  const label = normalizeDocumentLabel(trimmed);
  if (/\bmanagement\s+reports?\b/i.test(label)) {
    return "management_report";
  }
  if (
    /\bboard\s+meeting\s+package\b/i.test(label) ||
    (/\bboard\b/i.test(label) && /\bmeeting\s+package\b/i.test(label))
  ) {
    return "board_package";
  }
  return null;
}

export function classifyBoardDocumentSubject(
  subject: string,
): BoardReportKind | null {
  return classifyBoardDocumentName(subject);
}

/**
 * Keep the management-report narrative when the PDF is a 100+ page package.
 * Short standalone reports are used whole.
 */
export function sliceManagementReportMarkdown(
  markdown: string,
  options?: {
    pageCount?: number | null;
    kind?: BoardReportKind | null;
    maxChars?: number;
  },
): string {
  const maxChars = options?.maxChars ?? BOARD_REPORT_SCAN_MAX_CHARS;
  const trimmed = markdown.replace(/\u0000/g, "").trim();
  if (!trimmed) return "";

  const pageCount = options?.pageCount ?? null;
  const kind = options?.kind ?? "management_report";
  const standalone =
    kind === "management_report" &&
    (pageCount == null || pageCount <= BOARD_REPORT_STANDALONE_MAX_PAGES);

  let body = trimmed;
  if (!standalone) {
    const startMatch = trimmed.match(SECTION_START_RE);
    if (startMatch?.index != null) {
      const from = startMatch.index;
      const rest = trimmed.slice(from);
      const endMatch = rest.slice(startMatch[0].length).match(SECTION_END_RE);
      body = endMatch?.index != null
        ? rest.slice(0, startMatch[0].length + endMatch.index)
        : rest;
    }
  }

  const compact = body.replace(/[ \t]+\n/g, "\n").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars).trimEnd()}\n…`;
}

function asString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function parseSection(raw: unknown): BoardReportSection {
  if (typeof raw !== "string") return "other";
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "capital" || key === "capital_projects") return "capital";
  if (key === "approval" || key === "items_for_approval") return "approval";
  if (key === "discussion" || key === "items_for_discussion") return "discussion";
  if (key === "information" || key === "items_for_information") {
    return "information";
  }
  if (key === "ratification" || key === "items_for_ratification") {
    return "ratification";
  }
  return "other";
}

export function parseBoardReportTopics(raw: unknown): BoardReportTopic[] {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const rows = Array.isArray(obj?.topics)
    ? obj.topics
    : Array.isArray(raw)
      ? raw
      : [];
  const seen = new Set<string>();
  const topics: BoardReportTopic[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const name = asString(record.name ?? record.project ?? record.topic);
    if (!name) continue;
    const canonical = canonicalizeProjectWorkName(name);
    if (canonical.length < BOARD_REPORT_TOPIC_MIN_CANONICAL) continue;
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push({
      name,
      section: parseSection(record.section),
      contractor: asString(record.contractor),
      location: asString(record.location),
      yearHint: asString(record.yearHint ?? record.year_hint),
      notes: asString(record.notes),
    });
  }
  return topics;
}

export function parseBoardReportTopicsFromModelText(
  text: string,
): BoardReportTopic[] {
  return parseBoardReportTopics(parseJsonObjectText(text));
}

export function boardReportTopicMatchKey(
  name: string,
  yearHint: string | null | undefined,
): string {
  const year = yearHint?.trim() ?? "";
  return `${canonicalizeProjectWorkName(name)}\0${year}`;
}

function namesAreExactWorkMatch(left: string, right: string): boolean {
  const leftCanon = canonicalizeProjectWorkName(left);
  const rightCanon = canonicalizeProjectWorkName(right);
  if (!leftCanon || !rightCanon) return false;
  if (leftCanon === rightCanon) return true;
  const leftCompact = compactProjectWorkName(left);
  const rightCompact = compactProjectWorkName(right);
  return (
    leftCompact.length >= BOARD_REPORT_TOPIC_MIN_CANONICAL &&
    rightCompact.length >= BOARD_REPORT_TOPIC_MIN_CANONICAL &&
    leftCompact === rightCompact
  );
}

function projectNamesForMatch(project: BoardReportMatchableProject): string[] {
  return [
    project.name,
    ...(project.aliases ?? []),
    ...splitProjectMultiValue(project.equipmentMentions),
  ].filter((value): value is string => Boolean(value?.trim()));
}

function topicYearOverlapsProject(
  topicYearHint: string | null | undefined,
  projectYearHint: string | null | undefined,
): boolean {
  const topicRange = parseProjectYearRange(topicYearHint);
  const projectRange = parseProjectYearRange(projectYearHint);
  if (!topicRange || !projectRange) return true;
  return projectYearRangesOverlap(topicRange, projectRange);
}

/**
 * Exact work-name match only (canonical tokens or compact equality).
 * No fuzzy / prefix scoring — Maglock vs "electromagnetic locking devices"
 * is an AI-match problem, not a string-distance one.
 */
export function matchBoardReportTopic(
  topic: Pick<BoardReportTopic, "name" | "yearHint"> | string,
  projects: readonly BoardReportMatchableProject[],
): BoardReportTopicMatch[] {
  const topicName = typeof topic === "string" ? topic : topic.name;
  const yearHint = typeof topic === "string" ? null : topic.yearHint;
  const canonical = canonicalizeProjectWorkName(topicName);
  if (canonical.length < BOARD_REPORT_TOPIC_MIN_CANONICAL) return [];

  const hits: BoardReportTopicMatch[] = [];
  for (const project of projects) {
    const names = projectNamesForMatch(project);
    if (!names.some((name) => namesAreExactWorkMatch(topicName, name))) {
      continue;
    }
    if (!topicYearOverlapsProject(yearHint, project.yearHint)) continue;
    hits.push({
      projectId: project.id,
      score: BOARD_REPORT_EXACT_SCORE,
      confidence: "high",
    });
  }
  hits.sort((a, b) => a.projectId.localeCompare(b.projectId));
  return hits.slice(0, BOARD_REPORT_MATCH_MAX);
}

function truncateCatalogField(
  value: string | null | undefined,
  max = 80,
): string | null {
  const trimmed = value?.trim() || null;
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

export function toBoardReportCatalogRow(
  project: BoardReportMatchableProject,
): BoardReportCatalogRow {
  return {
    id: project.id,
    name: project.name,
    aliases: (project.aliases ?? []).slice(0, 8),
    yearHint: project.yearHint?.trim() || null,
    phase: project.phase?.trim() || null,
    contractor: truncateCatalogField(project.contractor),
    location: truncateCatalogField(project.location),
    equipment: truncateCatalogField(project.equipmentMentions),
    scope: project.scope?.trim() || null,
  };
}

export function buildBoardReportMatchSystemPrompt(): string {
  return `You match named jobs from a condominium management report onto existing project registry cards.

${buildProjectHighlightDomainContext()}

Each topic is a heading the property manager briefed the Board on. Each card has a work name, aliases, years, phase, contractor, location, and equipment. Match by real-world identity — synonyms, abbreviations, and equipment — NOT spelling similarity.

Return ONLY valid JSON:
{
  "matches": [
    {
      "topicId": string,
      "projectIds": string[],
      "confidence": "high" | "medium"
    }
  ]
}

Rules:
- topicId must copy a topic id from the input. projectIds must be card ids from the input. Never invent ids.
- Omit a topic when no card is the same job. Empty matches array is fine.
- Maglock / mag locks / magnet / electromagnetic locking devices / electromagnetic locks are the SAME work when the card name, aliases, or equipment say so.
- Kitchen-stack cleaning is not window cleaning. "Repair" or "replacement" alone is not a match.
- If the topic states a year, prefer cards whose year overlaps. A spanning capital job (2025–2026) may still match a topic that only says Maglock.
- Recurring yearly campaigns: match the overlapping year card, not every year.
- One topic may map to at most ${BOARD_REPORT_MATCH_MAX} cards (yearly variants of the same work).
- confidence high only when identity is clear from name, alias, or equipment. Use medium when plausible but thin.
- Output compact JSON. No markdown fences.`;
}

export function buildBoardReportMatchUserPrompt(params: {
  topics: Array<{
    id: string;
    name: string;
    section: BoardReportSection;
    contractor: string | null;
    location: string | null;
    yearHint: string | null;
  }>;
  projects: BoardReportCatalogRow[];
}): string {
  return `REPORT TOPICS
${JSON.stringify(params.topics)}

PROJECT CARDS
${JSON.stringify(params.projects)}

Return matches JSON only.`;
}

export function parseBoardReportAiMatches(
  raw: unknown,
  knownIds: ReadonlySet<string>,
  topics: ReadonlyArray<{ id: string; name: string }>,
): BoardReportAiMatchRow[] {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const rows = Array.isArray(obj?.matches)
    ? obj.matches
    : Array.isArray(raw)
      ? raw
      : [];
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const seen = new Set<string>();
  const out: BoardReportAiMatchRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const topicId = asString(record.topicId ?? record.id);
    const topic = topicId ? topicById.get(topicId) : undefined;
    if (!topic) continue;
    const confidenceRaw = asString(record.confidence)?.toLowerCase();
    const confidence: BoardReportMatchConfidence | null =
      confidenceRaw === "high" || confidenceRaw === "medium"
        ? confidenceRaw
        : null;
    if (!confidence) continue;
    const idRaw = Array.isArray(record.projectIds)
      ? record.projectIds
      : typeof record.projectId === "string"
        ? [record.projectId]
        : [];
    const projectIds: string[] = [];
    for (const id of idRaw) {
      if (typeof id !== "string") continue;
      const trimmed = id.trim();
      if (!knownIds.has(trimmed) || projectIds.includes(trimmed)) continue;
      projectIds.push(trimmed);
      if (projectIds.length >= BOARD_REPORT_MATCH_MAX) break;
    }
    if (projectIds.length === 0) continue;
    if (seen.has(topic.id)) continue;
    seen.add(topic.id);
    out.push({
      topicId: topic.id,
      topicName: topic.name,
      projectIds,
      confidence,
    });
  }
  return out;
}

export function parseBoardReportAiMatchesFromModelText(
  text: string,
  knownIds: ReadonlySet<string>,
  topics: ReadonlyArray<{ id: string; name: string }>,
): BoardReportAiMatchRow[] {
  return parseBoardReportAiMatches(
    parseJsonObjectText(text),
    knownIds,
    topics,
  );
}

export function parseStoredBoardReportTopics(
  raw: unknown,
): BoardReportStoredTopic[] {
  const topics = parseBoardReportTopics(raw);
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const rows = Array.isArray(obj?.topics)
    ? obj.topics
    : Array.isArray(raw)
      ? raw
      : [];
  const idsByCanon = new Map<string, string[]>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const name = asString(record.name ?? record.project ?? record.topic);
    if (!name) continue;
    const ids = Array.isArray(record.matchedProjectIds)
      ? record.matchedProjectIds.filter(
          (id): id is string => typeof id === "string" && Boolean(id.trim()),
        )
      : [];
    idsByCanon.set(canonicalizeProjectWorkName(name), ids);
  }
  return topics.map((topic) => ({
    ...topic,
    matchedProjectIds:
      idsByCanon.get(canonicalizeProjectWorkName(topic.name)) ?? [],
  }));
}

export function isWaitingOnMarkdownDocument(params: {
  parseStatus: string | null | undefined;
  error: string | null | undefined;
}): boolean {
  if (params.parseStatus !== "parsed") return true;
  const error = params.error?.toLowerCase() ?? "";
  return (
    error.includes("markdown") ||
    error.includes("not been converted") ||
    error.includes("empty or missing")
  );
}

/**
 * Group unmatched extracted topics and skipped PDFs for the scan review UI.
 * A topic is unmatched when it has no matchedProjectIds and no mention
 * recorded for that report (legacy scans before ids were stored).
 */
export function buildBoardReportScanReview(params: {
  documents: BoardReportDocumentReview[];
  mentionedByReportId?: ReadonlyMap<string, ReadonlySet<string>>;
}): BoardReportScanReview {
  const unmatchedMap = new Map<
    string,
    BoardReportUnmatchedTopic & { names: Map<string, number> }
  >();
  const waitingOnMarkdown: BoardReportWaitingDocument[] = [];

  for (const doc of params.documents) {
    if (isWaitingOnMarkdownDocument(doc)) {
      waitingOnMarkdown.push({
        id: doc.id,
        filename: doc.filename,
        kind: doc.kind,
        reportDate: doc.reportDate,
        receivedAt: doc.receivedAt,
        pageCount: doc.pageCount,
        parseStatus: doc.parseStatus,
        error: doc.error,
        emailId: doc.emailId,
      });
      continue;
    }
    const mentioned =
      params.mentionedByReportId?.get(doc.id) ?? new Set<string>();
    for (const topic of doc.topics) {
      const canon = canonicalizeProjectWorkName(topic.name);
      const storedMatch = topic.matchedProjectIds.length > 0;
      const inferredMatch = mentioned.has(canon);
      if (storedMatch || inferredMatch) continue;
      const reportRef = {
        filename: doc.filename,
        reportDate: doc.reportDate,
        kind: doc.kind,
      };
      const existing = unmatchedMap.get(canon);
      if (!existing) {
        unmatchedMap.set(canon, {
          name: topic.name,
          canonical: canon,
          section: topic.section,
          yearHint: topic.yearHint,
          contractor: topic.contractor,
          mentionCount: 1,
          reportCount: 1,
          reports: [reportRef],
          names: new Map([[topic.name, 1]]),
        });
        continue;
      }
      existing.mentionCount += 1;
      existing.names.set(topic.name, (existing.names.get(topic.name) ?? 0) + 1);
      if (
        !existing.reports.some(
          (row) =>
            row.filename === reportRef.filename &&
            row.reportDate === reportRef.reportDate,
        )
      ) {
        existing.reportCount += 1;
        if (existing.reports.length < 8) existing.reports.push(reportRef);
      }
      if (!existing.yearHint && topic.yearHint) {
        existing.yearHint = topic.yearHint;
      }
      if (!existing.contractor && topic.contractor) {
        existing.contractor = topic.contractor;
      }
    }
  }

  const unmatchedTopics = [...unmatchedMap.values()]
    .map((row) => {
      let bestName = row.name;
      let bestCount = 0;
      for (const [name, count] of row.names) {
        if (count > bestCount) {
          bestName = name;
          bestCount = count;
        }
      }
      return {
        name: bestName,
        canonical: row.canonical,
        section: row.section,
        yearHint: row.yearHint,
        contractor: row.contractor,
        mentionCount: row.mentionCount,
        reportCount: row.reportCount,
        reports: row.reports,
      };
    })
    .sort(
      (a, b) =>
        b.mentionCount - a.mentionCount || a.name.localeCompare(b.name),
    );

  waitingOnMarkdown.sort((a, b) => {
    const aDate = a.reportDate ?? a.receivedAt ?? "";
    const bDate = b.reportDate ?? b.receivedAt ?? "";
    return bDate.localeCompare(aDate) || a.filename.localeCompare(b.filename);
  });

  return { unmatchedTopics, waitingOnMarkdown };
}

export function buildBoardReportScanSystemPrompt(): string {
  return `You extract the named building projects a condominium property manager listed in a monthly management report (or the management-report section of a board package).

${buildProjectHighlightDomainContext()}

This document is the PM's curated briefing for the Board. Extract only work the Board would put on a project tracker.

INCLUDE:
- Capital / improvement jobs, tenders, awards, and construction in progress
- Building-wide or multi-unit remediation that is being managed as a job
- Recurring campaigns the report tracks as a named program (window cleaning, kitchen-stack cleaning, reserve fund study)
- Items for approval / discussion / ratification that name a body of work (not a one-line invoice)

EXCLUDE:
- Routine monthly operations (fire-alarm test, generator exercise, office hours, holiday closures)
- One-off unit work orders that did not escalate into a named building job
- Vendor / contractor companies as if they were projects
- Financial-statement period labels, insurance certificates, and correspondence lists
- Vague "we should look at X someday" with no named job

Return ONLY valid JSON:
{
  "topics": [
    {
      "name": string,
      "section": "capital" | "approval" | "discussion" | "information" | "ratification" | "other",
      "contractor": string | null,
      "location": string | null,
      "yearHint": string | null,
      "notes": string | null
    }
  ]
}

Rules:
- name is the work (elevator modernization, maglock installation), never the contractor
- Prefer the report's own heading or first formal name
- Deduplicate near-identical names
- yearHint is a calendar year or inclusive range when stated (2024 or 2024-2026)
- Empty topics array is fine when the report has no projects`;
}

export function buildBoardReportScanUserPrompt(params: {
  filename: string;
  reportDate: string | null;
  kind: BoardReportKind;
  markdown: string;
}): string {
  const dateLine = params.reportDate
    ? `Report date: ${params.reportDate}`
    : "Report date: unknown";
  const kindLine =
    params.kind === "board_package"
      ? "Document kind: board package (use the management report section; ignore appendices when possible)."
      : "Document kind: standalone management report.";
  return `${kindLine}
Filename: ${params.filename}
${dateLine}

--- management report text ---
${params.markdown}`;
}

export function parseBoardReportRunStatus(
  value: string,
): BoardReportRunStatus {
  if (
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "failed";
}
