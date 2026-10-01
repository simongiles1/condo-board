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
 * The stored package error, when the last run failed.
 */
export function meetingsV3PackageError(
  settings: { v3Package?: { error?: string | null } | null } | null | undefined,
): string | null {
  const error = settings?.v3Package?.error;
  return typeof error === "string" && error.trim() ? error : null;
}
