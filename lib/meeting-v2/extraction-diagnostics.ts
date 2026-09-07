import { count, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2AgendaChunkSnapshots } from "@/lib/db/schema";

export type MeetingV2StageTokenUsage = {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type MeetingV2Settings = {
  autonomyTemperature?: number;
  extractionRun?: MeetingV2ExtractionRun;
  /** Accumulated DeepSeek usage for the validate stage (per-item AI reviews). */
  validationUsage?: MeetingV2StageTokenUsage;
};

export type MeetingV2ExtractionRun = {
  extractor: "deepseek_incremental" | "section_fallback";
  deepSeekKeyConfigured: boolean;
  completedAt: string;
  agendaItemCount: number;
  apiError?: string | null;
};

export type ExtractionIssueCode =
  | "none"
  | "no_items"
  | "no_deepseek_key"
  | "deepseek_billing"
  | "deepseek_api_error"
  | "literal_section_fallback"
  | "section_shaped_output"
  | "noisy_titles";

export type MeetingV2Alert = {
  id: string;
  severity: "info" | "warning" | "error";
  title: string;
  summary: string;
  likelyCause?: string;
  recommendedAction?: string;
  occurredAt?: string;
  /** True when this issue halted the run (Resume/Restart required). */
  blocksPipeline?: boolean;
};

/** Typical semantic agenda shape — contrast with PDF page/section titles. */
export const EXPECTED_SEMANTIC_AGENDA_SHAPE: Array<{ title: string; why: string }> = [
  { title: "Call to Order", why: "Opening procedural item" },
  { title: "Approval of Previous Minutes — May 19, 2026", why: "Named prior meeting, not a PDF page" },
  { title: "Kitchen Stack Cleaning Presentation", why: "Named guest/vendor topic" },
  { title: "Financial Matters — unaudited statements", why: "Board business heading" },
  { title: "Ratification — insurance renewal", why: "One approval line item, not a page" },
  { title: "Management Report — BAS system approval", why: "Distinct decision topic" },
  { title: "In-camera — Unit 2005 chargeback dispute", why: "Named confidential item" },
  { title: "Date of Next Meeting", why: "Closing procedural item" },
];

export function shouldShowExtractionShapeComparison(
  issueCode: ExtractionIssueCode,
): boolean {
  return (
    issueCode === "section_shaped_output" ||
    issueCode === "literal_section_fallback" ||
    issueCode === "noisy_titles"
  );
}

export type MeetingV2ExtractionQuality = {
  mode: "semantic" | "section_fallback";
  likelyIncomplete: boolean;
  pageLikeTitleCount: number;
  suspiciousTitleCount: number;
  note: string;
  issueCode: ExtractionIssueCode;
  extractorUsed: MeetingV2ExtractionRun["extractor"] | "none" | "unknown";
  deepSeekKeyConfigured: boolean;
  agendaChunkSnapshots: number;
  extractionRun: MeetingV2ExtractionRun | null;
};

type AgendaItemForQuality = {
  title: string;
  sourceSectionId: string | null;
  itemType: string;
};

const BILLING_ERROR_RE =
  /insufficient|balance|billing|quota|credit|payment|out of funds|usage limit|exceeded your current/i;
const AUTH_ERROR_RE =
  /unauthorized|invalid api key|authentication|api key|permission denied|401|403/i;

export function isDeepSeekKeyConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
}

export function classifyDeepSeekError(message: string): {
  kind: "billing" | "auth" | "other";
  label: string;
} {
  const trimmed = message.trim();
  if (BILLING_ERROR_RE.test(trimmed)) {
    return {
      kind: "billing",
      label: "DeepSeek billing or quota issue",
    };
  }
  if (AUTH_ERROR_RE.test(trimmed)) {
    return {
      kind: "auth",
      label: "DeepSeek API key or authentication issue",
    };
  }
  return {
    kind: "other",
    label: "DeepSeek API error",
  };
}

export function readMeetingV2Settings(
  settings: MeetingV2Settings | null | undefined,
): MeetingV2Settings {
  if (!settings || typeof settings !== "object") {
    return {};
  }
  return settings;
}

export async function recordMeetingV2ValidationUsage(
  meetingId: string,
  usage: { inputTokens: number; outputTokens: number; totalTokens: number },
  modelName: string,
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));

  const settings = readMeetingV2Settings(row?.settings as MeetingV2Settings | null);
  const previous = settings.validationUsage;
  const nextSettings: MeetingV2Settings = {
    ...settings,
    validationUsage: {
      modelName,
      inputTokens: (previous?.inputTokens ?? 0) + usage.inputTokens,
      outputTokens: (previous?.outputTokens ?? 0) + usage.outputTokens,
      totalTokens: (previous?.totalTokens ?? 0) + usage.totalTokens,
    },
  };

  await db
    .update(meetingsV2)
    .set({
      settings: nextSettings,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(meetingsV2.id, meetingId));
}

export async function clearMeetingV2ValidationUsage(meetingId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));

  const settings = readMeetingV2Settings(row?.settings as MeetingV2Settings | null);
  if (!settings.validationUsage) return;

  const { validationUsage: _removed, ...rest } = settings;
  await db
    .update(meetingsV2)
    .set({
      settings: rest,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(meetingsV2.id, meetingId));
}

export async function recordMeetingV2ExtractionRun(
  meetingId: string,
  run: Omit<MeetingV2ExtractionRun, "completedAt"> & { completedAt?: string },
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));

  const settings = readMeetingV2Settings(row?.settings as MeetingV2Settings | null);
  const nextSettings: MeetingV2Settings = {
    ...settings,
    extractionRun: {
      ...run,
      completedAt: run.completedAt ?? new Date().toISOString(),
    },
  };

  await db
    .update(meetingsV2)
    .set({
      settings: nextSettings,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(meetingsV2.id, meetingId));
}

export async function getMeetingV2AgendaChunkSnapshotCount(
  meetingId: string,
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ value: count() })
    .from(meetingsV2AgendaChunkSnapshots)
    .where(eq(meetingsV2AgendaChunkSnapshots.meetingV2Id, meetingId));
  return rows[0]?.value ?? 0;
}

export function analyzeExtractionQuality(options: {
  agendaItems: AgendaItemForQuality[];
  documentSectionCount: number;
  documentSections?: Array<{ title: string }>;
  extractionRun: MeetingV2ExtractionRun | null;
  agendaChunkSnapshots: number;
  deepSeekKeyConfigured: boolean;
  lastError: string | null;
  /** Stored pipeline has never been started (`created`). */
  pipelineNotStarted?: boolean;
}): MeetingV2ExtractionQuality {
  const {
    agendaItems,
    documentSectionCount,
    documentSections,
    extractionRun,
    agendaChunkSnapshots,
    deepSeekKeyConfigured,
    lastError,
    pipelineNotStarted = false,
  } = options;

  if (pipelineNotStarted && !extractionRun) {
    return {
      mode: "semantic",
      likelyIncomplete: false,
      pageLikeTitleCount: 0,
      suspiciousTitleCount: 0,
      note: "Agenda extraction runs after you start the pipeline.",
      issueCode: "none",
      extractorUsed: "none",
      deepSeekKeyConfigured,
      agendaChunkSnapshots,
      extractionRun: null,
    };
  }

  const pageLikeTitleCount = agendaItems.filter((item) =>
    /^page\s+\d+$/i.test(item.title),
  ).length;
  const suspiciousTitleCount = agendaItems.filter((item) => {
    const title = item.title.trim();
    const normalized = title.toLowerCase();
    return (
      normalized.includes("outlook") ||
      normalized.includes("inbox") ||
      normalized.includes("@") ||
      normalized.startsWith("for reference") ||
      normalized.startsWith("please find a copy") ||
      /^page\s+\d+$/i.test(title) ||
      /^["“”']?[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(title)
    );
  }).length;
  const sectionFallbackItemCount = agendaItems.filter(
    (item) => item.itemType === "agenda_section",
  ).length;

  const normalizeTitleForComparison = (val: string) =>
    val.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  const matchingSectionTitleCount =
    documentSections && documentSections.length > 0
      ? agendaItems.filter((item) => {
          const itemNorm = normalizeTitleForComparison(item.title);
          if (!itemNorm) return false;
          return documentSections.some(
            (section) => normalizeTitleForComparison(section.title) === itemNorm,
          );
        }).length
      : 0;

  // A run is only section-fallback shaped if its items were tagged as agenda_section
  // or if the majority of extracted titles literally match document section page headings.
  // sourceSectionId presence alone is normal and desirable for grounded topics.
  const sectionFallbackLikely =
    agendaItems.length > 0 &&
    (sectionFallbackItemCount >= Math.max(1, Math.floor(agendaItems.length * 0.5)) ||
      (documentSections !== undefined &&
        documentSections.length > 0 &&
        matchingSectionTitleCount >= Math.max(3, Math.floor(agendaItems.length * 0.5))));

  const inferredExtractor: MeetingV2ExtractionQuality["extractorUsed"] =
    extractionRun?.extractor ??
    (sectionFallbackItemCount >= Math.max(1, Math.floor(agendaItems.length * 0.9))
      ? "section_fallback"
      : agendaChunkSnapshots > 0
        ? "deepseek_incremental"
        : agendaItems.length > 0
          ? "unknown"
          : "none");

  const apiError =
    extractionRun?.apiError?.trim() ||
    (lastError && classifyDeepSeekError(lastError).kind !== "other"
      ? lastError
      : null);

  let issueCode: ExtractionIssueCode = "none";
  let note = "Agenda extraction looks structurally complete.";
  let mode: MeetingV2ExtractionQuality["mode"] = "semantic";
  let likelyIncomplete = false;

  if (apiError) {
    const classified = classifyDeepSeekError(apiError);
    issueCode =
      classified.kind === "billing"
        ? "deepseek_billing"
        : classified.kind === "auth"
          ? "no_deepseek_key"
          : "deepseek_api_error";
    mode = "section_fallback";
    likelyIncomplete = true;
    note =
      classified.kind === "billing"
        ? "DeepSeek rejected extraction requests, likely due to billing or quota."
        : classified.kind === "auth"
          ? "DeepSeek rejected extraction requests due to API key/authentication."
          : "DeepSeek returned an error during agenda extraction.";
  } else if (agendaItems.length === 0) {
    issueCode = "no_items";
    mode = "section_fallback";
    likelyIncomplete = true;
    note = "No agenda items were extracted yet.";
  } else if (
    inferredExtractor === "section_fallback" ||
    (!deepSeekKeyConfigured && agendaChunkSnapshots === 0)
  ) {
    issueCode = "no_deepseek_key";
    mode = "section_fallback";
    likelyIncomplete = true;
    note =
      "Semantic extraction was skipped and PDF sections/pages were used as agenda items instead.";
  } else if (sectionFallbackLikely) {
    issueCode =
      inferredExtractor === "deepseek_incremental"
        ? "section_shaped_output"
        : "literal_section_fallback";
    mode = "section_fallback";
    likelyIncomplete = true;
    note =
      inferredExtractor === "deepseek_incremental"
        ? "DeepSeek ran, but the output still looks like one PDF section per agenda item instead of real meeting topics."
        : "Extraction used PDF sections/pages as agenda items instead of semantic meeting topics.";
  } else if (pageLikeTitleCount > 0 || suspiciousTitleCount > 0) {
    issueCode = "noisy_titles";
    mode = "section_fallback";
    likelyIncomplete = true;
    note =
      "Some extracted agenda titles look page-derived or noisy, so extraction likely needs another pass.";
  }

  return {
    mode,
    likelyIncomplete,
    pageLikeTitleCount,
    suspiciousTitleCount,
    note,
    issueCode,
    extractorUsed: inferredExtractor,
    deepSeekKeyConfigured,
    agendaChunkSnapshots,
    extractionRun,
  };
}

function lastErrorAlreadyCovered(
  lastError: string,
  extractionNote: string,
  alerts: MeetingV2Alert[],
): boolean {
  const errorText = lastError.trim();
  const note = extractionNote.trim();
  if (!errorText) return true;
  if (note && (errorText === note || errorText.includes(note) || note.includes(errorText))) {
    return true;
  }
  return alerts.some(
    (alert) =>
      alert.summary.includes(errorText) ||
      Boolean(alert.likelyCause?.includes(errorText)) ||
      errorText.includes(alert.summary),
  );
}

export function buildMeetingV2Alerts(options: {
  extractionQuality: MeetingV2ExtractionQuality;
  integrityNote: string;
  isConsistent: boolean;
  lastError: string | null;
  pipelineState: string;
  pipelineActivelyRunning?: boolean;
  updatedAt?: string;
}): MeetingV2Alert[] {
  if (options.pipelineState === "created") {
    return [];
  }

  const alerts: MeetingV2Alert[] = [];
  const {
    extractionQuality,
    integrityNote,
    isConsistent,
    lastError,
    pipelineState,
    pipelineActivelyRunning = false,
  } = options;
  const apiError =
    extractionQuality.extractionRun?.apiError?.trim() ||
    (lastError && /deepseek/i.test(lastError) ? lastError : null);
  const trulyHalted =
    pipelineState === "failed" ||
    Boolean(lastError?.trim()) ||
    (extractionQuality.likelyIncomplete && !pipelineActivelyRunning) ||
    (!isConsistent && !pipelineActivelyRunning);
  const blockingSeverity: MeetingV2Alert["severity"] = trulyHalted ? "error" : "warning";
  const haltOccurredAt =
    options.updatedAt ?? extractionQuality.extractionRun?.completedAt;

  if (!isConsistent && integrityNote.trim()) {
    if (pipelineActivelyRunning) {
      alerts.push({
        id: "pipeline-progress",
        severity: "warning",
        title: "Stage in progress",
        summary: integrityNote,
        recommendedAction:
          "The pipeline is still working through this stage. Refresh if the step text and percentage stay frozen for several minutes.",
        occurredAt: haltOccurredAt,
        blocksPipeline: false,
      });
    } else {
      alerts.push({
        id: "pipeline-progress",
        severity: blockingSeverity,
        title: "Pipeline stopped before this stage finished",
        summary: integrityNote,
        likelyCause:
          "The stored pipeline step does not match the data that has actually been written for this meeting.",
        recommendedAction:
          "Use Resume Pipeline to continue, or Restart from Beginning if the run looks stuck or partially written.",
        occurredAt: haltOccurredAt,
        blocksPipeline: trulyHalted,
      });
    }
  }

  if (extractionQuality.issueCode === "deepseek_billing") {
    alerts.push({
      id: "deepseek-billing",
      severity: "error",
      title: "DeepSeek billing or quota blocked agenda extraction",
      summary:
        "The pipeline could not complete semantic agenda extraction because DeepSeek rejected API requests.",
      likelyCause: apiError ?? lastError ?? "Insufficient balance, quota, or usage limits on the DeepSeek account.",
      recommendedAction:
        "Top up the DeepSeek account, wait a minute for billing to refresh, then click Restart from Beginning.",
      occurredAt: haltOccurredAt,
      blocksPipeline: true,
    });
  } else if (extractionQuality.issueCode === "deepseek_api_error") {
    alerts.push({
      id: "deepseek-api",
      severity: "error",
      title: "DeepSeek API error during agenda extraction",
      summary:
        "Semantic extraction did not finish cleanly. Any agenda items present may be incomplete or low quality.",
      likelyCause: apiError ?? lastError ?? "DeepSeek returned an error while reading the board package or transcript.",
      recommendedAction:
        "Check production logs for the DeepSeek error, fix the underlying issue, then Restart from Beginning.",
      occurredAt: haltOccurredAt,
      blocksPipeline: true,
    });
  } else if (extractionQuality.issueCode === "no_deepseek_key") {
    alerts.push({
      id: "no-deepseek-key",
      severity: "error",
      title: "Semantic extraction was skipped (no DeepSeek API key)",
      summary:
        "This server used a non-AI fallback that turns PDF sections or pages into pseudo agenda items. Those are not real meeting topics.",
      likelyCause:
        extractionQuality.extractionRun?.deepSeekKeyConfigured === false
          ? "DEEPSEEK_API_KEY was not configured when extraction ran."
          : "DEEPSEEK_API_KEY is not configured in this environment.",
      recommendedAction:
        "Add DEEPSEEK_API_KEY to the production environment, redeploy if needed, then Restart from Beginning.",
      occurredAt: haltOccurredAt,
      blocksPipeline: true,
    });
  } else if (extractionQuality.issueCode === "literal_section_fallback") {
    alerts.push({
      id: "literal-section-fallback",
      severity: blockingSeverity,
      title: "Non-AI section fallback was used",
      summary:
        "Agenda items were built from PDF section/page boundaries instead of from a real agenda topic map.",
      likelyCause:
        "Semantic extraction did not run, or the run was replaced by the section fallback path.",
      recommendedAction:
        "Compare the lists below, confirm DeepSeek is configured and funded, then Restart from Beginning so semantic extraction can run.",
      occurredAt: haltOccurredAt,
      blocksPipeline: trulyHalted,
    });
  } else if (extractionQuality.issueCode === "section_shaped_output") {
    alerts.push({
      id: "section-shaped-output",
      severity: blockingSeverity,
      title: "DeepSeek output still looks like PDF sections",
      summary:
        "DeepSeek did run, but the agenda list closely mirrors PDF page/section titles rather than distinct board topics. The comparison below shows this run next to the PDF splits and the topic shape a successful extraction should return.",
      likelyCause:
        extractionQuality.agendaChunkSnapshots > 0
          ? "The board package may not expose a clear numbered agenda, or the extraction run may have started while DeepSeek was unavailable and left section-shaped results behind."
          : "The board package may not expose a clear numbered agenda for the model to follow.",
      recommendedAction:
        "Use the got-vs-expected comparison below. If the left column matches PDF page titles, Restart from Beginning after confirming DeepSeek is funded and the board package has a real agenda outline.",
      occurredAt: haltOccurredAt,
      blocksPipeline: trulyHalted,
    });
  } else if (extractionQuality.issueCode === "noisy_titles") {
    alerts.push({
      id: "noisy-titles",
      severity: blockingSeverity,
      title: "Extracted agenda titles look noisy or page-derived",
      summary: extractionQuality.note,
      likelyCause:
        "The extractor picked up attachment pages, email boilerplate, or page labels instead of board business topics.",
      recommendedAction:
        "Compare the lists below, trim the board package if needed, then Restart from Beginning.",
      occurredAt: haltOccurredAt,
      blocksPipeline: trulyHalted,
    });
  } else if (
    extractionQuality.issueCode === "no_items" &&
    !(pipelineActivelyRunning && (pipelineState === "extracting" || pipelineState === "ingested"))
  ) {
    alerts.push({
      id: "no-items",
      severity: blockingSeverity,
      title: "No agenda items were extracted",
      summary: extractionQuality.note,
      recommendedAction:
        "Confirm source ingestion completed, then Resume Pipeline or Restart from Beginning.",
      occurredAt: haltOccurredAt,
      blocksPipeline: trulyHalted,
    });
  }

  const lastErrorText = lastError?.trim() ?? "";
  if (lastErrorText && !lastErrorAlreadyCovered(lastErrorText, extractionQuality.note, alerts)) {
    alerts.push({
      id: "last-error",
      severity: "error",
      title: "Latest pipeline error",
      summary: lastErrorText,
      recommendedAction:
        "Fix the underlying issue, then Resume Pipeline or Restart from Beginning.",
      occurredAt: haltOccurredAt,
      blocksPipeline: true,
    });
  }

  return sortAlertsNewestFirst(dedupeAlerts(alerts));
}

const ALERT_RECENCY_RANK: Record<string, number> = {
  "last-error": 0,
  "deepseek-billing": 1,
  "deepseek-api": 1,
  "no-deepseek-key": 1,
  "literal-section-fallback": 1,
  "section-shaped-output": 1,
  "noisy-titles": 1,
  "no-items": 1,
  "pipeline-progress": 2,
};

function sortAlertsNewestFirst(alerts: MeetingV2Alert[]): MeetingV2Alert[] {
  return [...alerts].sort((left, right) => {
    const rightTime = Date.parse(right.occurredAt ?? "") || 0;
    const leftTime = Date.parse(left.occurredAt ?? "") || 0;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return (ALERT_RECENCY_RANK[left.id] ?? 9) - (ALERT_RECENCY_RANK[right.id] ?? 9);
  });
}

function dedupeAlerts(alerts: MeetingV2Alert[]): MeetingV2Alert[] {
  const seen = new Set<string>();
  return alerts.filter((alert) => {
    const key = `${alert.title}:${alert.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
