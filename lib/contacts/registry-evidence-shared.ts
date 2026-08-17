/** Client-safe contact evidence types (no DB imports). */

import type { ContactHighlightType } from "@/lib/email-analysis/contact-highlight-shared";

export type ContactEvidenceKind = "title" | "email" | "phone" | "person";

/** Why a message appears in the evidence list. */
export type ContactEvidenceMatchReason =
  | "name_in_body"
  | "email_from"
  | "email_to"
  | "email_cc"
  | "email_in_body"
  | "phone_in_body"
  | "title_in_body";

/**
 * Person evidence filter:
 * - content = name / phone / title / address in authored body
 * - all = content + header participation (From/To/Cc)
 */
export type ContactEvidenceScope = "content" | "all";

export type ContactEvidenceEmailSummary = {
  id: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  preview: string;
  /** True when authored body has a name (or anchored attribute) hit. */
  hasAnchoredMention: boolean;
  matchReasons: ContactEvidenceMatchReason[];
};

export type ContactEvidencePayload = {
  kind: ContactEvidenceKind;
  attributeId: string;
  value: string;
  mentionType: ContactHighlightType;
  person: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string;
  };
  validFrom: string | null;
  validTo: string | null;
  emails: ContactEvidenceEmailSummary[];
  /** Evidence rows that lacked a loadable email, or failed the anchor filter. */
  omittedCount: number;
  /** Applied list filter (person default: content). */
  scope: ContactEvidenceScope;
  /** Rows matching the applied scope (before page slice). */
  matchedCount: number;
  /** Person name/attribute hits in authored body (scope-independent). */
  contentCount: number;
  /** Header-only participation rows with no body hit (scope-independent). */
  participationOnlyCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export const CONTACT_EVIDENCE_DEFAULT_PAGE_SIZE = 25;
export const CONTACT_EVIDENCE_MAX_PAGE_SIZE = 100;

export function isContentMatchReason(
  reason: ContactEvidenceMatchReason,
): boolean {
  return (
    reason === "name_in_body" ||
    reason === "email_in_body" ||
    reason === "phone_in_body" ||
    reason === "title_in_body"
  );
}

export function isParticipationMatchReason(
  reason: ContactEvidenceMatchReason,
): boolean {
  return (
    reason === "email_from" ||
    reason === "email_to" ||
    reason === "email_cc"
  );
}

export function hasContentMatch(
  reasons: ContactEvidenceMatchReason[],
): boolean {
  return reasons.some(isContentMatchReason);
}

export function matchReasonLabel(reason: ContactEvidenceMatchReason): string {
  switch (reason) {
    case "name_in_body":
      return "Name in body";
    case "email_from":
      return "From";
    case "email_to":
      return "On To";
    case "email_cc":
      return "On Cc";
    case "email_in_body":
      return "Address in body";
    case "phone_in_body":
      return "Phone in body";
    case "title_in_body":
      return "Title in body";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/** Chars of context on each side of the first mention in list previews. */
export const EVIDENCE_PREVIEW_CONTEXT_CHARS = 50;

/**
 * Collapse whitespace, then show ~context chars before/after the earliest
 * needle hit. Falls back to the start of the body when no needle matches.
 */
export function bodyPreviewAroundMention(params: {
  text: string;
  needles: string[];
  contextChars?: number;
}): string {
  const normalized = params.text.replace(/\s+/g, " ").trim();
  if (!normalized) return "(No plain-text body)";

  const context = params.contextChars ?? EVIDENCE_PREVIEW_CONTEXT_CHARS;
  const lower = normalized.toLowerCase();
  let bestStart = -1;
  let bestEnd = -1;

  for (const raw of params.needles) {
    const needle = raw.trim().toLowerCase();
    if (!needle) continue;
    const idx = lower.indexOf(needle);
    if (idx < 0) continue;
    const end = idx + needle.length;
    if (bestStart < 0 || idx < bestStart) {
      bestStart = idx;
      bestEnd = end;
    }
  }

  if (bestStart < 0) {
    const maxLen = context * 2 + 20;
    if (normalized.length <= maxLen) return normalized;
    return `${normalized.slice(0, maxLen).trimEnd()}…`;
  }

  const sliceStart = Math.max(0, bestStart - context);
  const sliceEnd = Math.min(normalized.length, bestEnd + context);
  let out = normalized.slice(sliceStart, sliceEnd).trim();
  if (sliceStart > 0) out = `…${out}`;
  if (sliceEnd < normalized.length) out = `${out}…`;
  return out;
}
