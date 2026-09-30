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

/** A finished pass that linked attachment pages onto the V3 agenda. */
export type MeetingsV3AttachmentLink = {
  completedAt: string;
  assignedPageCount: number;
  unassignedPages: number[];
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
  };
  if (typeof record.completedAt !== "string" || !record.completedAt.trim()) return null;
  if (typeof record.assignedPageCount !== "number" || !Number.isInteger(record.assignedPageCount)) {
    return null;
  }
  if (!Array.isArray(record.unassignedPages)) return null;
  const unassignedPages = record.unassignedPages.filter(
    (page): page is number => typeof page === "number" && Number.isInteger(page) && page > 0,
  );
  return {
    completedAt: record.completedAt,
    assignedPageCount: record.assignedPageCount,
    unassignedPages,
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
