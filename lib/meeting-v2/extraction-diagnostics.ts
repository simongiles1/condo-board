import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2AgendaChunkSnapshots } from "@/lib/db/schema";

export type MeetingV2Settings = {
  autonomyTemperature?: number;
  extractionRun?: MeetingV2ExtractionRun;
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
};

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
    .select({ id: meetingsV2AgendaChunkSnapshots.id })
    .from(meetingsV2AgendaChunkSnapshots)
    .where(eq(meetingsV2AgendaChunkSnapshots.meetingV2Id, meetingId));
  return rows.length;
}

export function analyzeExtractionQuality(options: {
  agendaItems: AgendaItemForQuality[];
  documentSectionCount: number;
  extractionRun: MeetingV2ExtractionRun | null;
  agendaChunkSnapshots: number;
  deepSeekKeyConfigured: boolean;
  lastError: string | null;
}): MeetingV2ExtractionQuality {
  const {
    agendaItems,
    documentSectionCount,
    extractionRun,
    agendaChunkSnapshots,
    deepSeekKeyConfigured,
    lastError,
  } = options;

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
  const sourcedFromSections = agendaItems.filter((item) => item.sourceSectionId).length;
  const sectionFallbackItemCount = agendaItems.filter(
    (item) => item.itemType === "agenda_section",
  ).length;
  const sectionFallbackLikely =
    documentSectionCount > 0 &&
    agendaItems.length > 0 &&
    agendaItems.length >= Math.max(3, Math.floor(documentSectionCount * 0.9)) &&
    sourcedFromSections >= Math.max(1, Math.floor(agendaItems.length * 0.9));

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

export function buildMeetingV2Alerts(options: {
  extractionQuality: MeetingV2ExtractionQuality;
  integrityNote: string;
  isConsistent: boolean;
  lastError: string | null;
  pipelineState: string;
}): MeetingV2Alert[] {
  const alerts: MeetingV2Alert[] = [];
  const { extractionQuality, integrityNote, isConsistent, lastError, pipelineState } =
    options;
  const apiError =
    extractionQuality.extractionRun?.apiError?.trim() ||
    (lastError && /deepseek/i.test(lastError) ? lastError : null);

  if (!isConsistent && integrityNote.trim()) {
    alerts.push({
      id: "pipeline-progress",
      severity: pipelineState === "failed" ? "error" : "warning",
      title: "Pipeline has not finished the current stage",
      summary: integrityNote,
      likelyCause:
        "The stored pipeline step does not match the data that has actually been written for this meeting.",
      recommendedAction:
        "Use Resume Pipeline to continue, or Restart from Beginning if the run looks stuck or partially written.",
    });
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
    });
  } else if (extractionQuality.issueCode === "literal_section_fallback") {
    alerts.push({
      id: "literal-section-fallback",
      severity: "warning",
      title: "Non-AI section fallback was used",
      summary:
        "Agenda items were built from PDF section/page boundaries instead of from a real agenda topic map.",
      likelyCause:
        "Semantic extraction did not run, or the run was replaced by the section fallback path.",
      recommendedAction:
        "Confirm DeepSeek is configured and funded, then Restart from Beginning so semantic extraction can run.",
    });
  } else if (extractionQuality.issueCode === "section_shaped_output") {
    alerts.push({
      id: "section-shaped-output",
      severity: "warning",
      title: "DeepSeek output still looks like PDF sections",
      summary:
        "DeepSeek did run, but the agenda list closely mirrors PDF sections rather than distinct board topics.",
      likelyCause:
        extractionQuality.agendaChunkSnapshots > 0
          ? "The board package may not expose a clear numbered agenda, or the extraction run may have started while DeepSeek was unavailable and left section-shaped results behind."
          : "The board package may not expose a clear numbered agenda for the model to follow.",
      recommendedAction:
        "Review the board package for a clear agenda outline. If DeepSeek balance was low during the run, top up and Restart from Beginning.",
    });
  } else if (extractionQuality.issueCode === "noisy_titles") {
    alerts.push({
      id: "noisy-titles",
      severity: "warning",
      title: "Extracted agenda titles look noisy or page-derived",
      summary: extractionQuality.note,
      likelyCause:
        "The extractor picked up attachment pages, email boilerplate, or page labels instead of board business topics.",
      recommendedAction:
        "Review the extracted items, trim the board package if needed, then Restart from Beginning.",
    });
  } else if (extractionQuality.issueCode === "no_items") {
    alerts.push({
      id: "no-items",
      severity: "warning",
      title: "No agenda items were extracted",
      summary: extractionQuality.note,
      recommendedAction:
        "Confirm source ingestion completed, then Resume Pipeline or Restart from Beginning.",
    });
  }

  if (
    lastError?.trim() &&
    !alerts.some((alert) => alert.likelyCause?.includes(lastError)) &&
    !alerts.some((alert) => alert.summary.includes(lastError))
  ) {
    alerts.push({
      id: "last-error",
      severity: pipelineState === "failed" ? "error" : "warning",
      title: "Latest pipeline error",
      summary: lastError,
      recommendedAction:
        "Fix the underlying issue, then Resume Pipeline or Restart from Beginning.",
    });
  }

  return dedupeAlerts(alerts);
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
