/** Client-safe org-registry field evidence types (no DB imports). */

import type {
  OrgEntityCard,
  OrgHighlightExtraction,
} from "@/lib/email-analysis/org-highlight-shared";
import {
  orgMultiValueContains,
  splitOrgMultiValue,
} from "@/lib/organizations/org-multi-values";

export const ORG_EVIDENCE_FIELDS = [
  "name",
  "name_alias",
  "organization_role",
  "email",
  "phone",
  "website",
] as const;

export type OrgEvidenceField = (typeof ORG_EVIDENCE_FIELDS)[number];

function normalizeEvidenceKey(
  field: OrgEvidenceField,
  value: string,
): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (field === "email" || field === "website") return trimmed.toLowerCase();
  if (field === "phone") {
    const digits = trimmed.replace(/\D/g, "");
    return digits || trimmed.toLowerCase();
  }
  return trimmed.toLowerCase();
}

export type OrgEvidenceMatchReason =
  | "fingerprint"
  | "highlight"
  | "email_from"
  | "email_to"
  | "email_cc"
  | "in_body";

export type OrgEvidenceEmailSummary = {
  id: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  preview: string;
  matchReasons: OrgEvidenceMatchReason[];
  /** Surface from stored mention offsets; empty when the span was not unique. */
  highlightNeedles?: string[];
};

export type OrgEvidencePayload = {
  field: OrgEvidenceField;
  value: string;
  organization: {
    id: string;
    displayName: string;
  };
  emails: OrgEvidenceEmailSummary[];
  matchedCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export const ORG_EVIDENCE_DEFAULT_PAGE_SIZE = 25;
export const ORG_EVIDENCE_MAX_PAGE_SIZE = 100;

export function isOrgEvidenceField(value: string): value is OrgEvidenceField {
  return (ORG_EVIDENCE_FIELDS as readonly string[]).includes(value);
}

export function orgEvidenceFieldLabel(field: OrgEvidenceField): string {
  if (field === "name_alias") return "Alias";
  if (field === "organization_role") return "Role";
  if (field === "email") return "Email";
  if (field === "phone") return "Phone";
  if (field === "website") return "Website";
  return "Name";
}

export function orgEvidenceMatchReasonLabel(
  reason: OrgEvidenceMatchReason,
): string {
  switch (reason) {
    case "fingerprint":
      return "Org card";
    case "highlight":
      return "Highlight";
    case "email_from":
      return "From";
    case "email_to":
      return "On To";
    case "email_cc":
      return "On Cc";
    case "in_body":
      return "In body";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/** Case-insensitive ranges of `value` in `text` (non-overlapping, left to right). */
export function findCaseInsensitiveRanges(
  text: string,
  value: string,
): Array<{ start: number; end: number }> {
  const needle = value.trim();
  if (!text || !needle) return [];
  const hay = text.toLowerCase();
  const find = needle.toLowerCase();
  const out: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from < hay.length) {
    const start = hay.indexOf(find, from);
    if (start < 0) break;
    out.push({ start, end: start + needle.length });
    from = start + Math.max(1, needle.length);
  }
  return out;
}

export type HighlightedTextPart = {
  text: string;
  hit: boolean;
  /** Needle that produced this hit (original casing from the needles list). */
  needle?: string;
};

/** Longest-first, non-overlapping case-insensitive highlights. */
export function highlightTextParts(
  text: string,
  needles: string[],
): HighlightedTextPart[] {
  const ranges: Array<{ start: number; end: number; needle: string }> = [];
  const sorted = [...needles]
    .map((needle) => needle.trim())
    .filter((needle) => needle.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const needle of sorted) {
    for (const range of findCaseInsensitiveRanges(text, needle)) {
      if (ranges.some((existing) => range.start < existing.end && range.end > existing.start)) {
        continue;
      }
      ranges.push({ ...range, needle });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  if (ranges.length === 0) return [{ text, hit: false }];
  const parts: HighlightedTextPart[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push({ text: text.slice(cursor, range.start), hit: false });
    }
    parts.push({
      text: text.slice(range.start, range.end),
      hit: true,
      needle: range.needle,
    });
    cursor = range.end;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), hit: false });
  }
  return parts;
}

export function orgCardMatchesEvidenceValue(
  card: OrgEntityCard,
  field: OrgEvidenceField,
  value: string,
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (field === "email") {
    return orgMultiValueContains("email", card.email, trimmed);
  }
  if (field === "phone") {
    return orgMultiValueContains("phone", card.phone, trimmed);
  }
  if (field === "website") {
    return orgMultiValueContains("website", card.website, trimmed);
  }
  const key = normalizeEvidenceKey(
    field === "name_alias" ? "name_alias" : field,
    trimmed,
  );
  if (!key) return false;
  if (field === "organization_role") {
    return normalizeEvidenceKey("organization_role", card.organization_role ?? "") ===
      key;
  }
  if (field === "name") {
    return normalizeEvidenceKey("name", card.name ?? "") === key;
  }
  // Alias click: this string was originally a card name, then folded on merge.
  if (normalizeEvidenceKey("name_alias", card.name ?? "") === key) return true;
  return (card.aliases ?? []).some(
    (alias) => normalizeEvidenceKey("name_alias", alias) === key,
  );
}

export function orgHighlightMatchesEvidenceValue(
  extraction: OrgHighlightExtraction,
  field: OrgEvidenceField,
  value: string,
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (field === "email") return false;
  if (field === "phone") {
    return extraction.phones.some((phone) =>
      orgMultiValueContains("phone", phone, trimmed),
    );
  }
  if (field === "website") {
    return extraction.websites.some((website) =>
      orgMultiValueContains("website", website, trimmed),
    );
  }
  if (field === "organization_role") {
    const key = normalizeEvidenceKey("organization_role", trimmed);
    return extraction.organization_roles.some(
      (role) => normalizeEvidenceKey("organization_role", role) === key,
    );
  }
  const key = normalizeEvidenceKey("name_alias", trimmed);
  return extraction.organization_names.some(
    (name) => normalizeEvidenceKey("name_alias", name) === key,
  );
}

export function headerReasonsForOrgEmail(
  field: OrgEvidenceField,
  value: string,
  params: {
    fromAddress: string;
    toAddresses: string[];
    ccAddresses: string[];
  },
): OrgEvidenceMatchReason[] {
  if (field !== "email") return [];
  const needle = value.trim().toLowerCase();
  if (!needle) return [];
  const reasons: OrgEvidenceMatchReason[] = [];
  if (params.fromAddress.toLowerCase().includes(needle)) {
    reasons.push("email_from");
  }
  if (params.toAddresses.some((addr) => addr.toLowerCase().includes(needle))) {
    reasons.push("email_to");
  }
  if (params.ccAddresses.some((addr) => addr.toLowerCase().includes(needle))) {
    reasons.push("email_cc");
  }
  return reasons;
}

export function splitOrgEvidenceNeedles(
  field: OrgEvidenceField,
  value: string,
): string[] {
  if (field === "email" || field === "phone" || field === "website") {
    return splitOrgMultiValue(value);
  }
  const trimmed = value.trim();
  return trimmed ? [trimmed] : [];
}
