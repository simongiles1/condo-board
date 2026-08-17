/**
 * Client-safe types + classification for AI duplicate-merge proposals.
 * Server runner lives in duplicate-merge-propose.ts.
 */

import { personDisplayName } from "@/lib/contacts/registry-shared";

/** Keep small — large batches truncate JSON → parse_fallback unresolved. */
export const DUPLICATE_MERGE_PROPOSE_BATCH_SIZE = 6;
export const DUPLICATE_MERGE_PROPOSE_MAX_EMAILS = 5;
export const DUPLICATE_MERGE_PROPOSE_MAX_BODY_CHARS = 400;
/** Floor for model max output (pass-4 default is often 4096). */
export const DUPLICATE_MERGE_PROPOSE_MAX_OUTPUT_TOKENS = 8192;
/** Human-readable stand-in when the model reply could not be parsed. */
export const DUPLICATE_MERGE_PARSE_FALLBACK_REASON =
  "Model response could not be parsed; re-run AI suggest merges.";

export type DuplicateMergeProposeBucket = {
  targetPersonId: string;
  targetDisplayName: string;
  synopsis: string;
  sourcePersonIds: string[];
  confidence: "high" | "medium" | "low";
};

export type DuplicateMergeProposeUnresolved = {
  personId: string;
  reason: string;
};

export type DuplicateMergeProposeMeta = {
  modelName: string;
  costUsd: number;
  anchorCount: number;
  candidateCount: number;
  emailsSampled: number;
  batchCount: number;
};

export type DuplicateMergeProposeResult = {
  buckets: DuplicateMergeProposeBucket[];
  unresolved: DuplicateMergeProposeUnresolved[];
  meta: DuplicateMergeProposeMeta;
};

export type DuplicateMergeRole = "anchor" | "candidate";

/** Last name is an initial or ≤2 letters (e.g. "W", "W.", "Jr"). */
export function isWeakLastName(lastName: string | null | undefined): boolean {
  const raw = lastName?.trim() ?? "";
  if (!raw) return false;
  const compact = raw.replace(/[.\s]/g, "");
  if (!compact) return false;
  if (compact.length <= 2) return true;
  return /^[A-Za-z]\.?$/.test(raw);
}

export function classifyDuplicateMergeRole(person: {
  firstName: string | null;
  lastName: string | null;
}): DuplicateMergeRole {
  const first = Boolean(person.firstName?.trim());
  const last = Boolean(person.lastName?.trim());
  if (!first && !last) return "candidate";
  if (first && !last) return "candidate";
  if (isWeakLastName(person.lastName)) return "candidate";
  return "anchor";
}

export function duplicateMergeDisplayName(person: {
  firstName: string | null;
  lastName: string | null;
}): string {
  return personDisplayName(person);
}
