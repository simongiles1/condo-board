/**
 * Marks a meeting row as a Meetings V3 workspace.
 * V3 reuses the V2 meeting record and stays off the minutes pipeline.
 */

/** Where a V3 package test sits. */
export const MEETINGS_V3_PACKAGE_STAGES = [
  "created",
  "extracting",
  "correcting",
  "ready",
  "failed",
] as const;

/** Package-extraction progress stored on the meeting. */
export type MeetingsV3PackageStage = (typeof MEETINGS_V3_PACKAGE_STAGES)[number];

/** A finished pass that stored quoted package facts on the V3 agenda. */
export type MeetingsV3FactResolution = {
  completedAt: string;
  factCount: number;
  unresolvedItemCount: number;
};

/** A finished pass that stored transcript spans on the V3 agenda. */
export type MeetingsV3TranscriptSegmentation = {
  completedAt: string;
  spanCount: number;
  overlapItemCount: number;
};

/** A finished pass that grouped quoted facts by the package quote that contains them. */
export type MeetingsV3FactGrouping = {
  completedAt: string;
  groupCount: number;
  ungroupedCount: number;
};

/** A finished pass that stored meeting conclusions from the transcript stretches. */
export type MeetingsV3MeetingReconciliation = {
  completedAt: string;
  itemCount: number;
  unclearCount: number;
};

/** One reason a V3 topic is not ready to print as settled minutes. */
export type MeetingsV3ValidationFinding = {
  agendaItemId: string;
  itemNumber: string;
  severity: "error" | "warning";
  code: "missing_conclusion" | "unclear_conclusion" | "open_reference" | "fact_review";
  message: string;
};

/** A finished pass that checked conclusions and fact reviews before a draft. */
export type MeetingsV3MinutesValidation = {
  completedAt: string;
  errorCount: number;
  warningCount: number;
  findings: MeetingsV3ValidationFinding[];
};

/** A finished pass that stored a deterministic minutes draft. */
export type MeetingsV3MinutesDraft = {
  completedAt: string;
  draftId: string;
  openPointCount: number;
};

/** A finished pass that linked attachment pages onto the V3 agenda. */
export type MeetingsV3AttachmentLink = {
  completedAt: string;
  assignedPageCount: number;
  unassignedPages: number[];
  pagesWithoutText: number[];
};

/** One V3 pipeline stage in the stored AI cost log. */
export type MeetingsV3AiUsageStageRecord = {
  id: string;
  label: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  notApplicable?: boolean;
  usageDetail?: string;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  billedAtMs?: number;
  inputCostUsd?: number;
  outputCostUsd?: number;
  totalCostUsd?: number;
  pricingTier?: "peak" | "off_peak" | "mixed";
  recordedAt: string;
};

/** AI token and cost totals grouped by V3 wizard stage. */
export type MeetingsV3AiUsageSettings = {
  stages: MeetingsV3AiUsageStageRecord[];
};

/** Settings written when a meeting is created from the V3 strip. */
export type MeetingsV3PackageSettings = {
  workspace: true;
  stage: MeetingsV3PackageStage;
  error: string | null;
  updatedAt: string;
  attachmentLink?: MeetingsV3AttachmentLink | null;
  factResolution?: MeetingsV3FactResolution | null;
  transcriptSegmentation?: MeetingsV3TranscriptSegmentation | null;
  factGrouping?: MeetingsV3FactGrouping | null;
  meetingReconciliation?: MeetingsV3MeetingReconciliation | null;
  minutesValidation?: MeetingsV3MinutesValidation | null;
  minutesDraft?: MeetingsV3MinutesDraft | null;
  aiUsage?: MeetingsV3AiUsageSettings | null;
};

/**
 * True when this meeting was created for the V3 package test.
 */
export function isMeetingsV3Workspace(
  settings: { v3Package?: { workspace?: boolean } | null } | null | undefined,
): boolean {
  return settings?.v3Package?.workspace === true;
}

/**
 * The stored package stage, or `created` when the flag is missing.
 */
export function meetingsV3PackageStage(
  settings: { v3Package?: { stage?: string } | null } | null | undefined,
): MeetingsV3PackageStage {
  const stage = settings?.v3Package?.stage;
  // Settings saved while the quote ledger was the second stage.
  if (stage === "reading_quotes") return "correcting";
  if (stage && (MEETINGS_V3_PACKAGE_STAGES as readonly string[]).includes(stage)) {
    return stage as MeetingsV3PackageStage;
  }
  return "created";
}

/**
 * The stored attachment link, when that stage has been run for the current agenda.
 * Returns null when the flag is missing or not a completed link.
 */
export function meetingsV3AttachmentLink(
  settings: { v3Package?: { attachmentLink?: unknown } | null } | null | undefined,
): MeetingsV3AttachmentLink | null {
  const link = settings?.v3Package?.attachmentLink;
  if (!link || typeof link !== "object") return null;
  const record = link as {
    completedAt?: unknown;
    assignedPageCount?: unknown;
    unassignedPages?: unknown;
    pagesWithoutText?: unknown;
  };
  if (typeof record.completedAt !== "string" || !record.completedAt.trim()) return null;
  if (typeof record.assignedPageCount !== "number" || !Number.isInteger(record.assignedPageCount)) {
    return null;
  }
  if (!Array.isArray(record.unassignedPages)) return null;
  const unassignedPages = record.unassignedPages.filter(
    (page): page is number => typeof page === "number" && Number.isInteger(page) && page > 0,
  );
  const pagesWithoutText = Array.isArray(record.pagesWithoutText)
    ? record.pagesWithoutText.filter(
        (page): page is number => typeof page === "number" && Number.isInteger(page) && page > 0,
      )
    : [];
  return {
    completedAt: record.completedAt,
    assignedPageCount: record.assignedPageCount,
    unassignedPages,
    pagesWithoutText,
  };
}

/**
 * The stored fact resolution, when that stage has been run for the current attachment link.
 * Returns null when the flag is missing or not a completed resolution.
 */
export function meetingsV3FactResolution(
  settings: { v3Package?: { factResolution?: unknown } | null } | null | undefined,
): MeetingsV3FactResolution | null {
  const resolution = settings?.v3Package?.factResolution;
  if (!resolution || typeof resolution !== "object") return null;
  const record = resolution as {
    completedAt?: unknown;
    factCount?: unknown;
    unresolvedItemCount?: unknown;
  };
  if (typeof record.completedAt !== "string" || !record.completedAt.trim()) return null;
  if (typeof record.factCount !== "number" || !Number.isInteger(record.factCount) || record.factCount < 0) {
    return null;
  }
  if (
    typeof record.unresolvedItemCount !== "number"
    || !Number.isInteger(record.unresolvedItemCount)
    || record.unresolvedItemCount < 0
  ) {
    return null;
  }
  return {
    completedAt: record.completedAt,
    factCount: record.factCount,
    unresolvedItemCount: record.unresolvedItemCount,
  };
}

/**
 * The stored transcript segmentation, when that stage has been run for the current facts.
 * Returns null when the flag is missing or not a completed segmentation.
 */
export function meetingsV3TranscriptSegmentation(
  settings: { v3Package?: { transcriptSegmentation?: unknown } | null } | null | undefined,
): MeetingsV3TranscriptSegmentation | null {
  const segmentation = settings?.v3Package?.transcriptSegmentation;
  if (!segmentation || typeof segmentation !== "object") return null;
  const record = segmentation as {
    completedAt?: unknown;
    spanCount?: unknown;
    overlapItemCount?: unknown;
  };
  if (typeof record.completedAt !== "string" || !record.completedAt.trim()) return null;
  if (typeof record.spanCount !== "number" || !Number.isInteger(record.spanCount) || record.spanCount < 0) {
    return null;
  }
  if (
    typeof record.overlapItemCount !== "number"
    || !Number.isInteger(record.overlapItemCount)
    || record.overlapItemCount < 0
  ) {
    return null;
  }
  return {
    completedAt: record.completedAt,
    spanCount: record.spanCount,
    overlapItemCount: record.overlapItemCount,
  };
}

/**
 * The stored fact grouping, when that stage has been run for the current transcript segmentation.
 * Returns null when the flag is missing or not a completed grouping.
 */
export function meetingsV3FactGrouping(
  settings: { v3Package?: { factGrouping?: unknown } | null } | null | undefined,
): MeetingsV3FactGrouping | null {
  const grouping = settings?.v3Package?.factGrouping;
  if (!grouping || typeof grouping !== "object") return null;
  const record = grouping as {
    completedAt?: unknown;
    groupCount?: unknown;
    ungroupedCount?: unknown;
  };
  if (typeof record.completedAt !== "string" || !record.completedAt.trim()) return null;
  if (typeof record.groupCount !== "number" || !Number.isInteger(record.groupCount) || record.groupCount < 0) {
    return null;
  }
  if (
    typeof record.ungroupedCount !== "number"
    || !Number.isInteger(record.ungroupedCount)
    || record.ungroupedCount < 0
  ) {
    return null;
  }
  return {
    completedAt: record.completedAt,
    groupCount: record.groupCount,
    ungroupedCount: record.ungroupedCount,
  };
}

/**
 * The stored meeting reconciliation, when that stage has been run for the current transcript.
 * Returns null when the flag is missing or not a completed reconciliation.
 */
export function meetingsV3MeetingReconciliation(
  settings: { v3Package?: { meetingReconciliation?: unknown } | null } | null | undefined,
): MeetingsV3MeetingReconciliation | null {
  const reconciliation = settings?.v3Package?.meetingReconciliation;
  if (!reconciliation || typeof reconciliation !== "object") return null;
  const record = reconciliation as {
    completedAt?: unknown;
    itemCount?: unknown;
    unclearCount?: unknown;
  };
  if (typeof record.completedAt !== "string" || !record.completedAt.trim()) return null;
  if (typeof record.itemCount !== "number" || !Number.isInteger(record.itemCount) || record.itemCount < 0) {
    return null;
  }
  if (
    typeof record.unclearCount !== "number"
    || !Number.isInteger(record.unclearCount)
    || record.unclearCount < 0
  ) {
    return null;
  }
  return {
    completedAt: record.completedAt,
    itemCount: record.itemCount,
    unclearCount: record.unclearCount,
  };
}

const VALIDATION_CODES = new Set([
  "missing_conclusion",
  "unclear_conclusion",
  "open_reference",
  "fact_review",
]);

function readValidationFinding(value: unknown): MeetingsV3ValidationFinding | null {
  if (!value || typeof value !== "object") return null;
  const record = value as {
    agendaItemId?: unknown;
    itemNumber?: unknown;
    severity?: unknown;
    code?: unknown;
    message?: unknown;
  };
  if (typeof record.agendaItemId !== "string" || !record.agendaItemId.trim()) return null;
  if (typeof record.itemNumber !== "string") return null;
  if (record.severity !== "error" && record.severity !== "warning") return null;
  if (typeof record.code !== "string" || !VALIDATION_CODES.has(record.code)) return null;
  if (typeof record.message !== "string" || !record.message.trim()) return null;
  return {
    agendaItemId: record.agendaItemId,
    itemNumber: record.itemNumber,
    severity: record.severity,
    code: record.code as MeetingsV3ValidationFinding["code"],
    message: record.message.trim(),
  };
}

/**
 * The stored minutes check, when that stage has been run for the current conclusions.
 * Returns null when the flag is missing or not a completed check.
 */
export function meetingsV3MinutesValidation(
  settings: { v3Package?: { minutesValidation?: unknown } | null } | null | undefined,
): MeetingsV3MinutesValidation | null {
  const validation = settings?.v3Package?.minutesValidation;
  if (!validation || typeof validation !== "object") return null;
  const record = validation as {
    completedAt?: unknown;
    errorCount?: unknown;
    warningCount?: unknown;
    findings?: unknown;
  };
  if (typeof record.completedAt !== "string" || !record.completedAt.trim()) return null;
  if (typeof record.errorCount !== "number" || !Number.isInteger(record.errorCount) || record.errorCount < 0) {
    return null;
  }
  if (
    typeof record.warningCount !== "number"
    || !Number.isInteger(record.warningCount)
    || record.warningCount < 0
  ) {
    return null;
  }
  if (!Array.isArray(record.findings)) return null;
  const findings = record.findings.map(readValidationFinding);
  if (findings.some((finding) => finding == null)) return null;
  return {
    completedAt: record.completedAt,
    errorCount: record.errorCount,
    warningCount: record.warningCount,
    findings: findings as MeetingsV3ValidationFinding[],
  };
}

/**
 * The stored minutes draft, when that stage has been run for the current check.
 * Returns null when the flag is missing or not a completed draft.
 */
export function meetingsV3MinutesDraft(
  settings: { v3Package?: { minutesDraft?: unknown } | null } | null | undefined,
): MeetingsV3MinutesDraft | null {
  const draft = settings?.v3Package?.minutesDraft;
  if (!draft || typeof draft !== "object") return null;
  const record = draft as {
    completedAt?: unknown;
    draftId?: unknown;
    openPointCount?: unknown;
  };
  if (typeof record.completedAt !== "string" || !record.completedAt.trim()) return null;
  if (typeof record.draftId !== "string" || !record.draftId.trim()) return null;
  if (
    typeof record.openPointCount !== "number"
    || !Number.isInteger(record.openPointCount)
    || record.openPointCount < 0
  ) {
    return null;
  }
  return {
    completedAt: record.completedAt,
    draftId: record.draftId,
    openPointCount: record.openPointCount,
  };
}

/**
 * The stored package error, when the last run failed.
 */
export function meetingsV3PackageError(
  settings: { v3Package?: { error?: string | null } | null } | null | undefined,
): string | null {
  const error = settings?.v3Package?.error;
  return typeof error === "string" && error.trim() ? error : null;
}
