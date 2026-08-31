/**
 * Contact mention staging helpers (client-safe).
 * Mentions are per-email observations; people are canonical records.
 */

import { normalizeGivenNameToken } from "@/lib/contacts/person-name";
import {
  normalizeContactRegistryEmail,
  type ContactRegistryIncomingCard,
} from "@/lib/contacts/registry-shared";
import { normalizePhone } from "@/lib/email/entity-dedup";
import type {
  ContactEntityCard,
  ContactHighlightExtraction,
} from "@/lib/email-analysis/contact-highlight-shared";

export const CONTACT_MENTION_STATUSES = [
  "unresolved",
  "provisional",
  "confirmed",
] as const;

export type ContactMentionResolutionStatus =
  (typeof CONTACT_MENTION_STATUSES)[number];

export const CONTACT_MENTION_KINDS = [
  "participant",
  "referred",
  "unknown",
] as const;

export type ContactMentionKind = (typeof CONTACT_MENTION_KINDS)[number];

/** Unique first+org attaches provisionally only when the person is well-known. */
export const CONTACT_MENTION_PROVISIONAL_MIN_SOURCE_EMAILS = 8;

/** Unique-body locator needle: first+last, else first. */
export function contactMentionSurfaceNeedle(card: {
  first_name?: string | null;
  last_name?: string | null;
}): string {
  return [card.first_name, card.last_name]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ")
    .trim();
}

export type ContactMentionCard = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  /** Canonical short role derived from job_title (solicitor, property manager). */
  role_phrase?: string | null;
  raw_company: string | null;
};

const ROLE_PHRASE_PATTERNS: Array<{ phrase: string; pattern: RegExp }> = [
  {
    phrase: "solicitor",
    pattern: /\b(solicitor|lawyer|attorney|legal counsel)\b/i,
  },
  {
    phrase: "property manager",
    pattern:
      /\b(property manager|condo(?:minium)? manager|assistant (?:property )?manager)\b/i,
  },
  {
    phrase: "engineer",
    pattern: /\b(engineer|engineering)\b/i,
  },
  {
    phrase: "auditor",
    pattern: /\b(auditor|accountant)\b/i,
  },
  {
    phrase: "insurance broker",
    pattern: /\b(insurance broker|broker)\b/i,
  },
];

/**
 * Map a free-text job title onto a short role phrase for mention accumulation.
 * Does not invent a role when the title is empty.
 */
export function inferRolePhrase(
  jobTitle: string | null | undefined,
): string | null {
  const raw = jobTitle?.replace(/\s+/g, " ").trim() || null;
  if (!raw) return null;
  for (const { phrase, pattern } of ROLE_PHRASE_PATTERNS) {
    if (pattern.test(raw)) return phrase;
  }
  const compact = raw.toLowerCase();
  return compact.length <= 48 ? compact : `${compact.slice(0, 48).trimEnd()}`;
}

export function normalizeCompanyKey(name: string | null | undefined): string {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mentionFirstNameKey(
  firstName: string | null | undefined,
): string | null {
  const key = firstName ? normalizeGivenNameToken(firstName) : "";
  return key || null;
}

/**
 * Drop trailing middle initials ("John P." / "John P") so matching and queue
 * grouping treat them as the same given name. Fingerprints still use
 * `mentionFirstNameKey` unchanged so stored rows do not duplicate.
 */
export function stripTrailingGivenNameInitials(
  firstName: string | null | undefined,
): string {
  const trimmed = firstName?.trim() ?? "";
  if (!trimmed) return "";
  const stripped = trimmed.replace(/(\s+[A-Za-z]\.?)+$/u, "").trim();
  return stripped || trimmed;
}

/** Given-name key for matching / grouping (not fingerprints). */
export function mentionMatchingFirstNameKey(
  firstName: string | null | undefined,
): string | null {
  return mentionFirstNameKey(stripTrailingGivenNameInitials(firstName));
}

export function mentionLastNameKey(
  lastName: string | null | undefined,
): string | null {
  const key = normalizeCompanyKey(lastName);
  return key || null;
}

export function mentionFirstLastKey(params: {
  firstName?: string | null;
  lastName?: string | null;
}): string | null {
  const first = mentionMatchingFirstNameKey(params.firstName);
  const last = mentionLastNameKey(params.lastName);
  if (!first || !last) return null;
  return `${first}|${last}`;
}

export function mentionHasFullName(params: {
  firstName?: string | null;
  lastName?: string | null;
}): boolean {
  return mentionFirstLastKey(params) != null;
}

export function mentionFirstOrgKey(params: {
  firstName?: string | null;
  rawCompany?: string | null;
}): string | null {
  const first = mentionFirstNameKey(params.firstName);
  const org = normalizeCompanyKey(params.rawCompany);
  if (!first || !org) return null;
  return `${first}|${org}`;
}

/**
 * Stable per-email identity for upsert. Does not include resolution fields.
 */
export function contactMentionFingerprint(card: ContactMentionCard): string {
  const first = mentionFirstNameKey(card.first_name) ?? "";
  const last = card.last_name?.trim().toLowerCase() ?? "";
  const email = card.email
    ? normalizeContactRegistryEmail(card.email)
    : "";
  const phone = card.phone ? normalizePhone(card.phone) : "";
  const company = normalizeCompanyKey(card.raw_company);
  return [first, last, email, phone, company].join("|");
}

export function buildMentionBlockingKeys(card: ContactMentionCard): string[] {
  const keys: string[] = [];
  const email = card.email?.trim();
  if (email) keys.push(`email:${normalizeContactRegistryEmail(email)}`);

  const phone = card.phone?.trim();
  if (phone) {
    const digits = normalizePhone(phone);
    if (digits.length >= 7) keys.push(`phone:${digits}`);
  }

  const first = mentionFirstNameKey(card.first_name);
  if (first) keys.push(`first:${first}`);

  const firstOrg = mentionFirstOrgKey({
    firstName: card.first_name,
    rawCompany: card.raw_company,
  });
  if (firstOrg) keys.push(`first_org:${firstOrg}`);

  return keys;
}

export function mentionMatchingFirstOrgKey(params: {
  firstName?: string | null;
  rawCompany?: string | null;
}): string | null {
  const first = mentionMatchingFirstNameKey(params.firstName);
  const org = normalizeCompanyKey(params.rawCompany);
  if (!first || !org) return null;
  return `${first}|${org}`;
}

/**
 * If the fingerprint card omitted company, copy it from pass 1–2 when there is
 * exactly one company name (do not guess among several).
 */
export function inferRawCompanyFromHighlights(
  card: Pick<ContactMentionCard, "raw_company">,
  extraction: ContactHighlightExtraction | null | undefined,
): string | null {
  const existing = card.raw_company?.trim() || null;
  if (existing) return existing;
  const companies = (extraction?.company_names ?? [])
    .map((name) => name.trim())
    .filter(Boolean);
  const unique = [...new Set(companies.map((name) => name.toLowerCase()))];
  if (unique.length !== 1) return null;
  return companies[0] ?? null;
}

export function cardToMentionCard(
  card: ContactEntityCard | ContactRegistryIncomingCard,
  extraction?: ContactHighlightExtraction | null,
): ContactMentionCard {
  const jobTitle = card.job_title?.trim() || null;
  return {
    first_name: card.first_name?.trim() || null,
    last_name: card.last_name?.trim() || null,
    email: card.email?.trim() || null,
    phone: card.phone?.trim() || null,
    job_title: jobTitle,
    role_phrase: inferRolePhrase(jobTitle),
    raw_company: inferRawCompanyFromHighlights(
      { raw_company: card.raw_company ?? null },
      extraction,
    ),
  };
}

export type StrongIdentityMentionBound = {
  firstOrgKeys: string[];
  emails: string[];
};

/** Typed keys a newly minted/enriched person can use to re-resolve sparse mentions. */
export function strongIdentityBoundFromCards(
  cards: Array<{
    first_name?: string | null;
    email?: string | null;
    raw_company?: string | null;
  }>,
): StrongIdentityMentionBound {
  const firstOrgKeys = new Set<string>();
  const emails = new Set<string>();
  for (const card of cards) {
    const orgKey = mentionFirstOrgKey({
      firstName: card.first_name,
      rawCompany: card.raw_company,
    });
    if (orgKey) firstOrgKeys.add(orgKey);
    const rawEmail = card.email?.trim() || "";
    if (rawEmail) {
      emails.add(rawEmail);
      emails.add(rawEmail.toLowerCase());
      const normalized = normalizeContactRegistryEmail(rawEmail);
      if (normalized) emails.add(normalized);
    }
  }
  return {
    firstOrgKeys: [...firstOrgKeys],
    emails: [...emails],
  };
}

export function mentionCardHasIdentity(card: ContactMentionCard): boolean {
  return Boolean(
    card.first_name ||
      card.last_name ||
      card.email ||
      card.phone ||
      card.job_title,
  );
}

export function personMeetsProvisionalPrior(person: {
  sourceEmailCount?: number;
  mentionWeight?: number;
}): boolean {
  const emails = person.sourceEmailCount ?? 0;
  const weight = person.mentionWeight ?? 0;
  return (
    emails >= CONTACT_MENTION_PROVISIONAL_MIN_SOURCE_EMAILS ||
    weight >= CONTACT_MENTION_PROVISIONAL_MIN_SOURCE_EMAILS
  );
}
