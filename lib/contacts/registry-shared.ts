/** Client-safe contact registry types and blocking / weight helpers. */

import {
  normalizePersonName,
  normalizePhone,
} from "@/lib/email/entity-dedup";
import { extractMailboxEmail } from "@/lib/email/address-display";
import type { ContactEntityCard } from "@/lib/email-analysis/contact-highlight-shared";

export {
  collectDiscardedNameAliases,
  emailLocalPart,
  finalizeNameAliases,
  givenNamesConflict,
  guessFirstNameFromDottedLocalPart,
  isAcceptableNameAlias,
  isGivenNameInitialExpansion,
  isGivenNameSpellingVariant,
  isNameMatchingEmailLocalPart,
  lastNamesCompatible,
  looksLikeMailboxLocalPart,
  mergeNameAliasLists,
  normalizeGivenNameToken,
  parseNameAliasesJson,
  personIdentitiesConflict,
  preferCompatibleLastName,
  preferPersonGivenName,
  sanitizeGivenNameAgainstEmails,
  serializeNameAliasesJson,
  titleCaseGivenName,
} from "@/lib/contacts/person-name";

/** Default page size for the Entities → People list. */
export const CONTACT_PERSONS_PAGE_SIZE = 100;

export type ContactPersonListSort =
  | "mentions-desc"
  | "mentions-asc"
  | "name-asc"
  | "name-desc";

const CONTACT_PERSON_LIST_SORTS = new Set<ContactPersonListSort>([
  "mentions-desc",
  "mentions-asc",
  "name-asc",
  "name-desc",
]);

export function parseContactPersonListSort(
  raw: string | null | undefined,
): ContactPersonListSort {
  if (raw && CONTACT_PERSON_LIST_SORTS.has(raw as ContactPersonListSort)) {
    return raw as ContactPersonListSort;
  }
  return "mentions-desc";
}

export type ContactRegistryEvidence = {
  emailId: string;
  receivedAt: string | null;
  mergeId?: string | null;
};

export type ContactRegistryIncomingCard = ContactEntityCard & {
  /** Stable id for this ingest batch (not a DB person id). */
  tempId: string;
  sourceEmailIds: string[];
  /** Earliest / latest receivedAt among source emails for this card set. */
  dateMin: string | null;
  dateMax: string | null;
  mentionWeight: number;
  blockingKeys: string[];
};

export type ContactRegistryPersonSummary = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  /** Former first names retained after merges / enrichment (not local-parts). */
  nameAliases: string[];
  mentionWeight: number;
  /**
   * Distinct emails that evidence this person (name in unique authored text
   * and/or email/phone/title attribute filters — same as the evidence panel).
   */
  sourceEmailCount: number;
  sparseStub: boolean;
  /** Denormalized current approved org (affiliations table is source of truth). */
  currentOrganizationId: string | null;
  currentOrganizationName: string | null;
  emails: Array<{
    id: string;
    email: string;
    validFrom: string | null;
    validTo: string | null;
  }>;
  phones: Array<{
    id: string;
    phone: string;
    phoneNormalized: string;
    validFrom: string | null;
    validTo: string | null;
  }>;
  titles: Array<{
    id: string;
    title: string;
    validFrom: string | null;
    validTo: string | null;
  }>;
};

export type ContactMergeAction =
  | "merge"
  | "link_email"
  | "keep_separate"
  | "enrich";

export type ContactAdjudicationDecision = {
  incomingTempId: string;
  action: ContactMergeAction;
  targetPersonId: string | null;
  /** For link_email / enrich when attaching an address. */
  email: string | null;
  validFrom: string | null;
  validTo: string | null;
  reason: string | null;
};

export function normalizeContactRegistryEmail(email: string): string {
  return (extractMailboxEmail(email) ?? email).trim().toLowerCase();
}

export function isSparseFirstNameOnly(card: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}): boolean {
  const first = card.first_name?.trim() || null;
  const last = card.last_name?.trim() || null;
  const email = card.email?.trim() || null;
  const phone = card.phone?.trim() || null;
  return Boolean(first && !last && !email && !phone);
}

export function hasStrongIdentity(card: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}): boolean {
  if (card.email?.trim()) return true;
  if (card.phone?.trim() && normalizePhone(card.phone).length >= 7) return true;
  if (card.first_name?.trim() && card.last_name?.trim()) return true;
  return false;
}

/** Blocking keys for shortlist buckets (not merge authority). */
export function buildBlockingKeys(card: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}): string[] {
  const keys: string[] = [];
  const email = card.email?.trim();
  if (email) keys.push(`email:${normalizeContactRegistryEmail(email)}`);

  const phone = card.phone?.trim();
  if (phone) {
    const digits = normalizePhone(phone);
    if (digits.length >= 7) keys.push(`phone:${digits}`);
  }

  const first = card.first_name?.trim();
  const last = card.last_name?.trim();
  if (first && last) {
    keys.push(
      `name:${normalizePersonName(last)}|${normalizePersonName(first)}`,
    );
  }

  return keys;
}

/**
 * Mention weight for a card: base source count + bonuses for strong ids.
 * Used for Pareto ordering (high-mention first).
 */
export function scoreMentionWeight(params: {
  sourceEmailCount: number;
  card: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    job_title?: string | null;
  };
}): number {
  let weight = Math.max(1, params.sourceEmailCount);
  if (params.card.email?.trim()) weight += 5;
  if (params.card.phone?.trim()) weight += 3;
  if (params.card.first_name?.trim() && params.card.last_name?.trim()) {
    weight += 2;
  }
  if (params.card.job_title?.trim()) weight += 1;
  return weight;
}

export function isNamelessPerson(person: {
  firstName?: string | null;
  lastName?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): boolean {
  const first =
    person.firstName?.trim() || person.first_name?.trim() || null;
  const last = person.lastName?.trim() || person.last_name?.trim() || null;
  return !first && !last;
}

/**
 * True when `weak` looks like a truncated form of `strong`
 * (e.g. "Haider M" / "Haider" vs "Haider Mukadam").
 */
export function isWeakNameVariantOf(
  weak: {
    firstName?: string | null;
    lastName?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  },
  strong: {
    firstName?: string | null;
    lastName?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  },
): boolean {
  const wf = normalizePersonName(
    weak.firstName?.trim() || weak.first_name?.trim() || "",
  );
  const sf = normalizePersonName(
    strong.firstName?.trim() || strong.first_name?.trim() || "",
  );
  if (!wf || !sf || wf !== sf) return false;

  const wlRaw = weak.lastName?.trim() || weak.last_name?.trim() || "";
  const slRaw = strong.lastName?.trim() || strong.last_name?.trim() || "";
  if (!slRaw) return false;
  if (!wlRaw) return true;

  const wl = wlRaw.replace(/\./g, "").toLowerCase();
  const sl = slRaw.toLowerCase();
  if (wl === sl) return false; // same completeness — not "weak"
  if (wl.length === 1 && sl.startsWith(wl)) return true;
  if (sl.startsWith(wl) && wl.length < sl.length) return true;
  return false;
}

/**
 * True when `sparse` is last-name-only and `full` has the same last name plus a
 * first name (e.g. "Wilson" vs "John Wilson" sharing a mailbox).
 */
export function isLastNameOnlyMatchingFuller(
  sparse: {
    firstName?: string | null;
    lastName?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  },
  full: {
    firstName?: string | null;
    lastName?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  },
): boolean {
  const sparseFirst =
    sparse.firstName?.trim() || sparse.first_name?.trim() || null;
  const fullFirst = full.firstName?.trim() || full.first_name?.trim() || null;
  const sparseLast =
    sparse.lastName?.trim() || sparse.last_name?.trim() || null;
  const fullLast = full.lastName?.trim() || full.last_name?.trim() || null;
  if (sparseFirst || !sparseLast || !fullFirst || !fullLast) return false;
  return (
    normalizePersonName(sparseLast) === normalizePersonName(fullLast)
  );
}

/** Same first+last (normalized) — duplicate people sharing a mailbox. */
export function isSamePersonFullName(
  a: {
    firstName?: string | null;
    lastName?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  },
  b: {
    firstName?: string | null;
    lastName?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  },
): boolean {
  const af = normalizePersonName(
    a.firstName?.trim() || a.first_name?.trim() || "",
  );
  const bf = normalizePersonName(
    b.firstName?.trim() || b.first_name?.trim() || "",
  );
  const al = normalizePersonName(
    a.lastName?.trim() || a.last_name?.trim() || "",
  );
  const bl = normalizePersonName(
    b.lastName?.trim() || b.last_name?.trim() || "",
  );
  return Boolean(af && bf && al && bl && af === bf && al === bl);
}

export function personDisplayName(person: {
  firstName?: string | null;
  lastName?: string | null;
  emails?: Array<{ email: string }>;
}): string {
  const parts = [person.firstName, person.lastName].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  const email = person.emails?.[0]?.email;
  if (email) return email;
  return "Unknown contact";
}

/** Source email ids stored on an ingested incoming card (merge proposal row). */
export function parseIncomingCardSourceEmailIds(
  incomingCardJson: string,
): string[] {
  try {
    const card = JSON.parse(incomingCardJson) as { sourceEmailIds?: unknown };
    if (!Array.isArray(card.sourceEmailIds)) return [];
    return card.sourceEmailIds.filter(
      (emailId): emailId is string =>
        typeof emailId === "string" && emailId.trim().length > 0,
    );
  } catch {
    return [];
  }
}

export function parseEvidenceJson(raw: string | null | undefined): ContactRegistryEvidence[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ContactRegistryEvidence[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.emailId !== "string" || !obj.emailId.trim()) continue;
      out.push({
        emailId: obj.emailId,
        receivedAt:
          typeof obj.receivedAt === "string" ? obj.receivedAt : null,
        mergeId:
          typeof obj.mergeId === "string" ? obj.mergeId : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function mergeEvidence(
  existing: ContactRegistryEvidence[],
  incoming: ContactRegistryEvidence[],
): ContactRegistryEvidence[] {
  const byId = new Map<string, ContactRegistryEvidence>();
  for (const row of [...existing, ...incoming]) {
    const prev = byId.get(row.emailId);
    if (!prev) {
      byId.set(row.emailId, row);
      continue;
    }
    byId.set(row.emailId, {
      emailId: row.emailId,
      receivedAt: row.receivedAt ?? prev.receivedAt,
      mergeId: row.mergeId ?? prev.mergeId,
    });
  }
  return [...byId.values()].sort((a, b) =>
    (a.receivedAt ?? "").localeCompare(b.receivedAt ?? ""),
  );
}

/** Whether occupancy interval covers timestamp `at` (ISO). Open-ended if validTo null. */
export function occupancyCoversAt(
  validFrom: string | null | undefined,
  validTo: string | null | undefined,
  at: string,
): boolean {
  const t = at.trim();
  if (!t) return false;
  if (validFrom && validFrom > t) return false;
  if (validTo && validTo < t) return false;
  return true;
}

/**
 * Merge email occupancy date windows.
 * Never reopen a closed range when the incoming update has validTo=null
 * (that is how role-mailbox ranges incorrectly stuck at "present").
 */
export function mergeEmailOccupancyDates(params: {
  existingFrom: string | null;
  existingTo: string | null;
  incomingFrom: string | null;
  incomingTo: string | null;
}): { validFrom: string | null; validTo: string | null } {
  const validFrom =
    [params.existingFrom, params.incomingFrom].filter(Boolean).sort()[0] ??
    null;

  let validTo = params.existingTo;
  if (params.incomingTo === null) {
    // Keep a previously closed end; only stay open if already open.
    validTo = params.existingTo;
  } else if (params.incomingTo) {
    if (params.existingTo) {
      validTo =
        params.incomingTo > params.existingTo
          ? params.incomingTo
          : params.existingTo;
    } else {
      // Closing (or bounding) a previously open-ended occupancy is allowed.
      validTo = params.incomingTo;
    }
  }

  return { validFrom, validTo };
}

/**
 * Pick current person for an email: prefer open-ended (validTo null) with
 * latest validFrom; else occupancy covering now; else latest validTo.
 */
export function pickCurrentOccupancyPersonId(
  rows: Array<{
    personId: string;
    validFrom: string | null;
    validTo: string | null;
  }>,
  nowIso: string = new Date().toISOString(),
): string | null {
  if (rows.length === 0) return null;

  const covering = rows.filter((r) =>
    occupancyCoversAt(r.validFrom, r.validTo, nowIso),
  );
  if (covering.length > 0) {
    const open = covering.filter((r) => !r.validTo);
    const pool = open.length > 0 ? open : covering;
    pool.sort((a, b) => (b.validFrom ?? "").localeCompare(a.validFrom ?? ""));
    return pool[0]?.personId ?? null;
  }

  const sorted = [...rows].sort((a, b) => {
    const aEnd = a.validTo ?? a.validFrom ?? "";
    const bEnd = b.validTo ?? b.validFrom ?? "";
    return bEnd.localeCompare(aEnd);
  });
  return sorted[0]?.personId ?? null;
}
