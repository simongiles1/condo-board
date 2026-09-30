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

/** Settings written when a meeting is created from the V3 strip. */
export type MeetingsV3PackageSettings = {
  workspace: true;
  stage: MeetingsV3PackageStage;
  error: string | null;
  updatedAt: string;
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
 * The stored package error, when the last run failed.
 */
export function meetingsV3PackageError(
  settings: { v3Package?: { error?: string | null } | null } | null | undefined,
): string | null {
  const error = settings?.v3Package?.error;
  return typeof error === "string" && error.trim() ? error : null;
}
