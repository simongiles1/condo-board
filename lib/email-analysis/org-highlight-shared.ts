/** Client-safe org-highlight types and helpers (no DB / Gemini imports). */

import { chunkContactHighlightText } from "@/lib/email-analysis/contact-highlight-shared";
import {
  foldOrgNames,
  mergeOrgMultiValues,
  primaryOrgMultiValue,
} from "@/lib/organizations/org-multi-values";

export { chunkContactHighlightText as chunkOrgHighlightText };

export const ORG_HIGHLIGHT_TYPES = [
  "organization_name",
  "phone",
  "organization_role",
  "website",
] as const;

export type OrgHighlightType = (typeof ORG_HIGHLIGHT_TYPES)[number];

export type OrgHighlightExtraction = {
  organization_names: string[];
  phones: string[];
  organization_roles: string[];
  websites: string[];
};

export type OrgHighlightSpan = {
  type: OrgHighlightType;
  text: string;
  /** When set, only this character range is marked (org-anchored evidence). */
  start?: number;
  end?: number;
};

export type OrgTextSegment = {
  text: string;
  type: OrgHighlightType | null;
};

/** Tailwind classes for each extraction type. */
export const ORG_HIGHLIGHT_CLASS: Record<OrgHighlightType, string> = {
  organization_name:
    "rounded-sm bg-violet-200/90 text-violet-950 box-decoration-clone px-0.5",
  phone: "rounded-sm bg-red-200/90 text-red-950 box-decoration-clone px-0.5",
  organization_role:
    "rounded-sm bg-sky-200/90 text-sky-950 box-decoration-clone px-0.5",
  website:
    "rounded-sm bg-teal-200/90 text-teal-950 box-decoration-clone px-0.5",
};

export const ORG_HIGHLIGHT_LABELS: Record<OrgHighlightType, string> = {
  organization_name: "Organization",
  phone: "Phone",
  organization_role: "Organization role",
  website: "Website",
};

export function emptyOrgHighlightExtraction(): OrgHighlightExtraction {
  return {
    organization_names: [],
    phones: [],
    organization_roles: [],
    websites: [],
  };
}

/**
 * Shared domain context for all org-highlight models (passes 1–4).
 * Keep short — repeated on every chunked call.
 */
export function buildOrgHighlightDomainContext(): string {
  return `Domain context: These emails concern Studio 1, a condominium corporation. Organizations are property managers, law firms, vendors, insurers, banks, and named condo corporations as legal entities — NOT owner/resident groups, Facebook pages/groups, informal community labels, or phrases like "Studio 1 Owners/Residents".`;
}

export function buildOrgHighlightSystemPrompt(): string {
  return `You extract organization identity fields from a single email excerpt.

${buildOrgHighlightDomainContext()}

Return ONLY valid JSON with this exact shape:
{
  "organization_names": string[],
  "phones": string[],
  "organization_roles": string[],
  "websites": string[]
}

Rules:
- Extract only values that literally appear in the excerpt (copy exact substrings as written).
- organization_names: real organization / firm names only (as defined in the domain context). Not person names.
- phones: phone / fax / mobile numbers as written (keep punctuation/spaces) when clearly associated with an organization.
- organization_roles: roles of organizations (e.g. "Property Manager", "Law Firm", "Insurer"), not person job titles unless they name the org's role.
- websites: URLs or domain names as written.
- Do not invent values. If none for a field, use [].
- Deduplicate case-insensitively within each array.
- Ignore owner/resident groups, social media pages, and informal community labels.
- Ignore quoted reply history if somehow present; focus on the given excerpt only.`;
}

export function buildOrgHighlightUserPrompt(highlightedText: string): string {
  return `EMAIL EXCERPT (unique / authored highlight for this message)

---
${highlightedText}
---

Extract organization_names, phones, organization_roles, and websites as JSON.`;
}

export function buildOrgHighlightSecondPassSystemPrompt(): string {
  return `You are doing a SECOND PASS over a single email excerpt to find organization identity fields that were MISSED in the first pass.

${buildOrgHighlightDomainContext()}

Return ONLY valid JSON with this exact shape:
{
  "organization_names": string[],
  "phones": string[],
  "organization_roles": string[],
  "websites": string[]
}

Rules:
- You are given the email excerpt AND the first-pass extractions.
- Return ONLY values that literally appear in the excerpt AND were not already found in the first pass.
- Copy exact substrings as written (do not normalize or invent).
- organization_names: real organization / firm names only (as defined in the domain context). Not person names.
- phones: phone / fax / mobile numbers as written (keep punctuation/spaces) when clearly associated with an organization.
- organization_roles: roles of organizations (e.g. "Property Manager", "Law Firm", "Insurer").
- websites: URLs or domain names as written.
- Do not repeat anything already listed in the first-pass JSON (case-insensitive match).
- Do not invent values. If nothing was missed, return empty arrays for every field.
- Deduplicate case-insensitively within each array.
- Ignore owner/resident groups, social media pages, and informal community labels.
- Ignore quoted reply history if somehow present; focus on the given excerpt only.`;
}

export function buildOrgHighlightSecondPassUserPrompt(
  highlightedText: string,
  priorExtraction: OrgHighlightExtraction,
): string {
  return `EMAIL EXCERPT (unique / authored highlight for this message)

---
${highlightedText}
---

FIRST-PASS EXTRACTIONS (already found — do not repeat these)
\`\`\`json
${JSON.stringify(priorExtraction, null, 2)}
\`\`\`

Find any missed organization_names, phones, organization_roles, and websites. Return ONLY newly found values as JSON.`;
}

/** Case-insensitive set of values already present in an extraction field. */
function lowerSet(values: string[]): Set<string> {
  return new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean));
}

/**
 * Keep only values from `candidate` that are not already in `prior`
 * (per field, case-insensitive).
 */
export function diffOrgHighlightExtractions(
  prior: OrgHighlightExtraction,
  candidate: OrgHighlightExtraction,
): OrgHighlightExtraction {
  const priorNames = lowerSet(prior.organization_names);
  const priorPhones = lowerSet(prior.phones);
  const priorRoles = lowerSet(prior.organization_roles);
  const priorWebsites = lowerSet(prior.websites);

  return {
    organization_names: candidate.organization_names.filter(
      (v) => !priorNames.has(v.trim().toLowerCase()),
    ),
    phones: candidate.phones.filter(
      (v) => !priorPhones.has(v.trim().toLowerCase()),
    ),
    organization_roles: candidate.organization_roles.filter(
      (v) => !priorRoles.has(v.trim().toLowerCase()),
    ),
    websites: candidate.websites.filter(
      (v) => !priorWebsites.has(v.trim().toLowerCase()),
    ),
  };
}

export function mergeOrgHighlightExtractions(
  parts: OrgHighlightExtraction[],
): OrgHighlightExtraction {
  return {
    organization_names: asStringArray(parts.flatMap((p) => p.organization_names)),
    phones: asStringArray(parts.flatMap((p) => p.phones)),
    organization_roles: asStringArray(
      parts.flatMap((p) => p.organization_roles),
    ),
    websites: asStringArray(parts.flatMap((p) => p.websites)),
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function parseOrgHighlightExtraction(
  raw: unknown,
): OrgHighlightExtraction {
  if (!raw || typeof raw !== "object") {
    return emptyOrgHighlightExtraction();
  }
  const obj = raw as Record<string, unknown>;
  return {
    organization_names: asStringArray(obj.organization_names),
    phones: asStringArray(obj.phones),
    organization_roles: asStringArray(obj.organization_roles),
    websites: asStringArray(obj.websites),
  };
}

export function parseOrgHighlightJson(text: string): OrgHighlightExtraction {
  const trimmed = text.trim();
  if (!trimmed) return emptyOrgHighlightExtraction();
  try {
    return parseOrgHighlightExtraction(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return parseOrgHighlightExtraction(
          JSON.parse(trimmed.slice(start, end + 1)),
        );
      } catch {
        return emptyOrgHighlightExtraction();
      }
    }
    return emptyOrgHighlightExtraction();
  }
}

export function toOrgHighlightSpans(
  extraction: OrgHighlightExtraction,
): OrgHighlightSpan[] {
  const spans: OrgHighlightSpan[] = [];
  for (const text of extraction.organization_names) {
    spans.push({ type: "organization_name", text });
  }
  for (const text of extraction.phones) {
    spans.push({ type: "phone", text });
  }
  for (const text of extraction.organization_roles) {
    spans.push({ type: "organization_role", text });
  }
  for (const text of extraction.websites) {
    spans.push({ type: "website", text });
  }
  spans.sort((a, b) => b.text.length - a.text.length);
  return spans;
}

export function orgExtractionHasAny(extraction: OrgHighlightExtraction): boolean {
  return (
    extraction.organization_names.length > 0 ||
    extraction.phones.length > 0 ||
    extraction.organization_roles.length > 0 ||
    extraction.websites.length > 0
  );
}

/** Third-pass organization fingerprint (entity card) for one org. */
export type OrgEntityCard = {
  name: string | null;
  organization_role: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  /** Variant names folded in during coalesce / manual merge. */
  aliases?: string[];
};

export type OrgFingerprintResult = {
  entity_cards: OrgEntityCard[];
};

export function emptyOrgFingerprintResult(): OrgFingerprintResult {
  return { entity_cards: [] };
}

export function emptyOrgEntityCard(): OrgEntityCard {
  return {
    name: null,
    organization_role: null,
    email: null,
    phone: null,
    website: null,
    aliases: [],
  };
}

function nullableTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseOrgAliases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function parseOrgEntityCard(raw: unknown): OrgEntityCard | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const card: OrgEntityCard = {
    name: nullableTrimmedString(obj.name),
    organization_role: nullableTrimmedString(obj.organization_role),
    email: nullableTrimmedString(obj.email),
    phone: nullableTrimmedString(obj.phone),
    website: nullableTrimmedString(obj.website),
    aliases: parseOrgAliases(obj.aliases),
  };
  if (
    !card.name &&
    !card.organization_role &&
    !card.email &&
    !card.phone &&
    !card.website
  ) {
    return null;
  }
  return card;
}

export function parseOrgFingerprintResult(raw: unknown): OrgFingerprintResult {
  if (!raw || typeof raw !== "object") {
    return emptyOrgFingerprintResult();
  }
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.entity_cards) ? obj.entity_cards : [];
  const entity_cards: OrgEntityCard[] = [];
  for (const item of list) {
    const card = parseOrgEntityCard(item);
    if (card) entity_cards.push(card);
  }
  return { entity_cards };
}

export function parseOrgFingerprintJson(text: string): OrgFingerprintResult {
  const trimmed = text.trim();
  if (!trimmed) return emptyOrgFingerprintResult();
  try {
    return parseOrgFingerprintResult(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return parseOrgFingerprintResult(
          JSON.parse(trimmed.slice(start, end + 1)),
        );
      } catch {
        return emptyOrgFingerprintResult();
      }
    }
    return emptyOrgFingerprintResult();
  }
}

export function entityCardDisplayName(card: OrgEntityCard): string {
  if (card.name) return card.name;
  if (card.email) return card.email;
  if (card.website) return card.website;
  if (card.organization_role) return card.organization_role;
  return "Unknown organization";
}

export function orgEntityCardHasAny(card: OrgEntityCard): boolean {
  return Boolean(
    card.name ||
      card.organization_role ||
      card.email ||
      card.phone ||
      card.website,
  );
}

export type OrgFingerprintEmailContext = {
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  /** Full authored body for this message only (not the thread). */
  bodyText: string;
};

export function buildOrgFingerprintSystemPrompt(): string {
  return `You build organization fingerprints (entity cards) for organizations mentioned in ONE email message.

${buildOrgHighlightDomainContext()}

Return ONLY valid JSON with this exact shape:
{
  "entity_cards": [
    {
      "name": string | null,
      "organization_role": string | null,
      "email": string | null,
      "phone": string | null,
      "website": string | null
    }
  ]
}

You receive:
1) Header fields for this message (From, To, Cc, Subject)
2) The full body of this single message (not the whole thread)
3) Prior highlight extractions (organization names, phones, roles, websites) from earlier passes

Rules:
- Create one entity card per distinct organization you can identify from this message.
- Partial cards are expected and OK. Fill only fields supported by evidence; leave others null.
- Populate cards from header participants (org display names and addresses) as well as the body and prior extractions.
- You MAY link evidence logically when it is strongly supported (e.g. a property-management domain address with the firm name in the body).
- Do NOT invent missing pieces. Do not invent phone numbers, roles, websites, or emails unsupported by evidence.
- Organization-only or email-only cards are fine when that is all the evidence supports.
- Deduplicate: one card per organization identity (same org should not appear twice).
- Ignore owner/resident groups, Facebook pages, and informal community labels.
- Ignore quoted reply history if somehow present; focus on this message's headers + body + prior extractions.
- organization_role is the org's role (e.g. Property Manager, Law Firm, Insurer), not a person's job title.`;
}

export function buildOrgFingerprintUserPrompt(
  email: OrgFingerprintEmailContext,
  priorExtraction: OrgHighlightExtraction,
): string {
  const toLine =
    email.toAddresses.length > 0 ? email.toAddresses.join(", ") : "(none)";
  const ccLine =
    email.ccAddresses.length > 0 ? email.ccAddresses.join(", ") : "(none)";

  return `EMAIL HEADERS (this message only)
From: ${email.fromAddress || "(unknown)"}
To: ${toLine}
Cc: ${ccLine}
Subject: ${email.subject || "(none)"}

EMAIL BODY (this message only)
---
${email.bodyText.trim() || "(empty)"}
---

PRIOR HIGHLIGHT EXTRACTIONS (pass 1 + any pass 2 finds, merged)
\`\`\`json
${JSON.stringify(priorExtraction, null, 2)}
\`\`\`

Build entity_cards fingerprints as JSON.`;
}

export type SourcedOrgEntityCard = OrgEntityCard & {
  source_email_id: string;
  source_label: string;
};

export function buildOrgFingerprintMergeSystemPrompt(): string {
  return `You merge organization fingerprint entity cards from multiple emails in the SAME thread into a unique set of organizations.

${buildOrgHighlightDomainContext()}

Return ONLY valid JSON with this exact shape:
{
  "entity_cards": [
    {
      "name": string | null,
      "organization_role": string | null,
      "email": string | null,
      "phone": string | null,
      "website": string | null
    }
  ]
}

You receive a list of entity cards produced per-email (pass 3). The same organization often appears multiple times as sparse stubs (email-only) and richer cards (name + phone + role + website).

Rules:
- Output ONE card per distinct organization.
- ALWAYS merge cards that share the same email address (case-insensitive).
- Merge when strong identity evidence matches (same email, same website/domain, or same normalized organization name with no conflicting emails).
- When merging, keep non-null fields; prefer the most complete name; keep a phone/role/website when any source has it. Do not invent values that appear nowhere in the input cards.
- If two cards have conflicting non-null values for the same field (rare), prefer the longer/more specific value; never invent a compromise.
- Do NOT merge different organizations that only share a generic role (e.g. two different "Property Manager" firms).
- Drop empty cards. Partial cards are OK when that is all the evidence supports.
- Output cards only — no source_email_id / source_label fields.`;
}

export function buildOrgFingerprintMergeUserPrompt(
  cards: SourcedOrgEntityCard[],
): string {
  return `ENTITY CARDS FROM PASS 3 (per-email fingerprints; may contain duplicates across messages)

\`\`\`json
${JSON.stringify(cards, null, 2)}
\`\`\`

Merge into a unique entity_cards list as JSON.`;
}

function normalizeOrgNameKey(name: string | null | undefined): string {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function preferString(a: string | null, b: string | null): string | null {
  const left = a?.trim() || null;
  const right = b?.trim() || null;
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function preferRicherOrgEntityCard(a: OrgEntityCard, b: OrgEntityCard): OrgEntityCard {
  const aName = a.name?.trim() || null;
  const bName = b.name?.trim() || null;
  // Keep the longer name as primary; shorter distinct name becomes an alias.
  const preferB = Boolean(bName && (!aName || bName.length > aName.length));
  const folded = foldOrgNames({
    preferredName: preferB ? bName : aName,
    otherName: preferB ? aName : bName,
    preferredAliases: preferB ? b.aliases : a.aliases,
    otherAliases: preferB ? a.aliases : b.aliases,
  });
  return {
    name: folded.name,
    organization_role: preferString(a.organization_role, b.organization_role),
    email: mergeOrgMultiValues("email", a.email, b.email),
    phone: mergeOrgMultiValues("phone", a.phone, b.phone),
    website: mergeOrgMultiValues("website", a.website, b.website),
    aliases: folded.aliases,
  };
}

/**
 * Guarantee at most one card per email, then per normalized name.
 * Prefer merge by email first; remaining name-only cards coalesce by name.
 */
export function coalesceOrgEntityCards(cards: OrgEntityCard[]): OrgEntityCard[] {
  const byEmail = new Map<string, OrgEntityCard>();
  const withoutEmail: OrgEntityCard[] = [];

  for (const card of cards) {
    const emailKey = primaryOrgMultiValue(card.email)?.toLowerCase() ?? "";
    if (!emailKey) {
      withoutEmail.push(card);
      continue;
    }
    const existing = byEmail.get(emailKey);
    if (!existing) {
      byEmail.set(emailKey, { ...card, aliases: [...(card.aliases ?? [])] });
      continue;
    }
    byEmail.set(emailKey, preferRicherOrgEntityCard(existing, card));
  }

  const byName = new Map<string, OrgEntityCard>();
  const unnamed: OrgEntityCard[] = [];

  for (const card of withoutEmail) {
    const nameKey = normalizeOrgNameKey(card.name);
    if (!nameKey) {
      unnamed.push(card);
      continue;
    }
    // If an email-keyed card already has this name, fold into it.
    let foldedIntoEmail = false;
    for (const [emailKey, emailCard] of byEmail) {
      if (normalizeOrgNameKey(emailCard.name) === nameKey) {
        byEmail.set(emailKey, preferRicherOrgEntityCard(emailCard, card));
        foldedIntoEmail = true;
        break;
      }
    }
    if (foldedIntoEmail) continue;

    const existing = byName.get(nameKey);
    if (!existing) {
      byName.set(nameKey, { ...card, aliases: [...(card.aliases ?? [])] });
      continue;
    }
    byName.set(nameKey, preferRicherOrgEntityCard(existing, card));
  }

  return [...byEmail.values(), ...byName.values(), ...unnamed];
}
