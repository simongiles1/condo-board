/** Client-safe contact-highlight types and helpers (no DB / Gemini imports). */

import {
  preferPersonGivenName,
  sanitizeGivenNameAgainstEmails,
} from "@/lib/contacts/person-name";

export const CONTACT_HIGHLIGHT_TYPES = [
  "contact_name",
  "phone",
  "job_title",
  "company_name",
] as const;

export type ContactHighlightType = (typeof CONTACT_HIGHLIGHT_TYPES)[number];

export type ContactHighlightExtraction = {
  contact_names: string[];
  phones: string[];
  job_titles: string[];
  company_names: string[];
};

export type ContactHighlightSpan = {
  type: ContactHighlightType;
  text: string;
  /** When set, only this character range is marked (person-anchored evidence). */
  start?: number;
  end?: number;
};

export type TextSegment = {
  text: string;
  type: ContactHighlightType | null;
};

/** Tailwind classes for each extraction type (nested inside the teal unique block). */
export const CONTACT_HIGHLIGHT_CLASS: Record<ContactHighlightType, string> = {
  contact_name: "rounded-sm bg-blue-200/90 text-blue-950 box-decoration-clone px-0.5",
  phone: "rounded-sm bg-red-200/90 text-red-950 box-decoration-clone px-0.5",
  job_title: "rounded-sm bg-amber-200/90 text-amber-950 box-decoration-clone px-0.5",
  company_name:
    "rounded-sm bg-emerald-200/90 text-emerald-950 box-decoration-clone px-0.5",
};

export const CONTACT_HIGHLIGHT_LABELS: Record<ContactHighlightType, string> = {
  contact_name: "Contact name",
  phone: "Phone",
  job_title: "Job title",
  company_name: "Company",
};

export function emptyContactHighlightExtraction(): ContactHighlightExtraction {
  return {
    contact_names: [],
    phones: [],
    job_titles: [],
    company_names: [],
  };
}

/**
 * Shared domain context for all contact-highlight models (passes 1–3).
 * Keep short — repeated on every chunked call.
 */
export function buildContactHighlightDomainContext(): string {
  return `Domain context: These emails concern Studio 1, a condominium corporation; unit owners and non-owner residents are people associated with that building, not companies. company_names means real organizations (property managers, law firms, vendors, insurers, banks, named condo corporations as legal entities) — not owner/resident groups, Facebook pages/groups, informal community labels, or phrases like "Studio 1 Owners/Residents".`;
}

export function buildContactHighlightSystemPrompt(): string {
  return `You extract contact identity fields from a single email excerpt.

${buildContactHighlightDomainContext()}

Return ONLY valid JSON with this exact shape:
{
  "contact_names": string[],
  "phones": string[],
  "job_titles": string[],
  "company_names": string[]
}

Rules:
- Extract only values that literally appear in the excerpt (copy exact substrings as written).
- contact_names: person names (people), not company names.
- phones: phone / fax / mobile numbers as written (keep punctuation/spaces).
- job_titles: roles/titles (e.g. "Property Manager", "Directeur").
- company_names: only organizations/firms as defined in the domain context above. Do not treat owners, residents, boards-as-people, social media pages, or owner/resident group names as companies.
- Do not invent values. If none for a field, use [].
- Deduplicate case-insensitively within each array.
- Ignore email addresses unless they are clearly presented as a person's display name.
- Ignore quoted reply history if somehow present; focus on the given excerpt only.`;
}

export function buildContactHighlightUserPrompt(highlightedText: string): string {
  return `EMAIL EXCERPT (unique / authored highlight for this message)

---
${highlightedText}
---

Extract contact_names, phones, job_titles, and company_names as JSON.`;
}

export function buildContactHighlightSecondPassSystemPrompt(): string {
  return `You are doing a SECOND PASS over a single email excerpt to find contact identity fields that were MISSED in the first pass.

${buildContactHighlightDomainContext()}

Return ONLY valid JSON with this exact shape:
{
  "contact_names": string[],
  "phones": string[],
  "job_titles": string[],
  "company_names": string[]
}

Rules:
- You are given the email excerpt AND the first-pass extractions.
- Return ONLY values that literally appear in the excerpt AND were not already found in the first pass.
- Copy exact substrings as written (do not normalize or invent).
- contact_names: person names (people), not company names.
- phones: phone / fax / mobile numbers as written (keep punctuation/spaces).
- job_titles: roles/titles (e.g. "Property Manager", "Directeur").
- company_names: only organizations/firms as defined in the domain context above. Do not treat owners, residents, boards-as-people, social media pages, or owner/resident group names as companies.
- Do not repeat anything already listed in the first-pass JSON (case-insensitive match).
- Do not invent values. If nothing was missed, return empty arrays for every field.
- Deduplicate case-insensitively within each array.
- Ignore email addresses unless they are clearly presented as a person's display name.
- Ignore quoted reply history if somehow present; focus on the given excerpt only.`;
}

export function buildContactHighlightSecondPassUserPrompt(
  highlightedText: string,
  priorExtraction: ContactHighlightExtraction,
): string {
  return `EMAIL EXCERPT (unique / authored highlight for this message)

---
${highlightedText}
---

FIRST-PASS EXTRACTIONS (already found — do not repeat these)
\`\`\`json
${JSON.stringify(priorExtraction, null, 2)}
\`\`\`

Find any missed contact_names, phones, job_titles, and company_names. Return ONLY newly found values as JSON.`;
}

/** Case-insensitive set of values already present in an extraction field. */
function lowerSet(values: string[]): Set<string> {
  return new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean));
}

/**
 * Keep only values from `candidate` that are not already in `prior`
 * (per field, case-insensitive).
 */
export function diffContactHighlightExtractions(
  prior: ContactHighlightExtraction,
  candidate: ContactHighlightExtraction,
): ContactHighlightExtraction {
  const priorNames = lowerSet(prior.contact_names);
  const priorPhones = lowerSet(prior.phones);
  const priorTitles = lowerSet(prior.job_titles);
  const priorCompanies = lowerSet(prior.company_names);

  return {
    contact_names: candidate.contact_names.filter(
      (v) => !priorNames.has(v.trim().toLowerCase()),
    ),
    phones: candidate.phones.filter(
      (v) => !priorPhones.has(v.trim().toLowerCase()),
    ),
    job_titles: candidate.job_titles.filter(
      (v) => !priorTitles.has(v.trim().toLowerCase()),
    ),
    company_names: candidate.company_names.filter(
      (v) => !priorCompanies.has(v.trim().toLowerCase()),
    ),
  };
}

export function mergeContactHighlightExtractions(
  parts: ContactHighlightExtraction[],
): ContactHighlightExtraction {
  return {
    contact_names: asStringArray(parts.flatMap((p) => p.contact_names)),
    phones: asStringArray(parts.flatMap((p) => p.phones)),
    job_titles: asStringArray(parts.flatMap((p) => p.job_titles)),
    company_names: asStringArray(parts.flatMap((p) => p.company_names)),
  };
}

/**
 * Split email excerpt into ~min–max character chunks.
 * Packs paragraphs first; oversized paragraphs split on sentence boundaries
 * (never mid-token by raw character count).
 */
export function chunkContactHighlightText(
  text: string,
  options?: { minChars?: number; maxChars?: number },
): string[] {
  const minChars = options?.minChars ?? 500;
  const maxChars = options?.maxChars ?? 1000;
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const units = expandToChunkUnits(trimmed, maxChars);
  return packChunkUnits(units, minChars, maxChars);
}

function expandToChunkUnits(text: string, maxChars: number): string[] {
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const units: string[] = [];
  for (const paragraph of paragraphs.length > 0 ? paragraphs : [text]) {
    if (paragraph.length <= maxChars) {
      units.push(paragraph);
      continue;
    }
    for (const sentence of splitIntoSentences(paragraph)) {
      if (sentence.length <= maxChars) {
        units.push(sentence);
        continue;
      }
      // Last resort: whitespace splits so names/words stay intact.
      units.push(...splitOnWhitespace(sentence, maxChars));
    }
  }
  return units;
}

function splitIntoSentences(paragraph: string): string[] {
  const parts = paragraph.split(/(?<=[.!?…])\s+/);
  const sentences: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) sentences.push(trimmed);
  }
  return sentences.length > 0 ? sentences : [paragraph.trim()].filter(Boolean);
}

/** Prefer breaking at whitespace near maxChars; never mid-word when possible. */
function splitOnWhitespace(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    let breakAt = window.lastIndexOf(" ");
    if (breakAt < Math.floor(maxChars * 0.5)) {
      // No good whitespace nearby — soft punctuation, then hard cut.
      const punct = Math.max(
        window.lastIndexOf(","),
        window.lastIndexOf(";"),
        window.lastIndexOf(":"),
        window.lastIndexOf("/"),
      );
      breakAt = punct >= Math.floor(maxChars * 0.5) ? punct + 1 : maxChars;
    }
    const piece = remaining.slice(0, breakAt).trim();
    if (piece) out.push(piece);
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) out.push(remaining);
  return out;
}

function packChunkUnits(
  units: string[],
  minChars: number,
  maxChars: number,
): string[] {
  if (units.length === 0) return [];

  const chunks: string[] = [];
  let current = "";

  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }
    const joined = `${current}\n\n${unit}`;
    if (joined.length <= maxChars) {
      current = joined;
      continue;
    }
    // Would exceed max: flush if we already have a reasonable chunk, else
    // still flush so we never paste past maxChars.
    chunks.push(current);
    current = unit;
  }
  if (current) chunks.push(current);

  // Merge a trailing undersized chunk into the previous one when possible.
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1]!;
    const prev = chunks[chunks.length - 2]!;
    if (last.length < minChars && `${prev}\n\n${last}`.length <= maxChars) {
      chunks[chunks.length - 2] = `${prev}\n\n${last}`;
      chunks.pop();
    }
  }

  return chunks;
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

export function parseContactHighlightExtraction(
  raw: unknown,
): ContactHighlightExtraction {
  if (!raw || typeof raw !== "object") {
    return emptyContactHighlightExtraction();
  }
  const obj = raw as Record<string, unknown>;
  return {
    contact_names: asStringArray(obj.contact_names),
    phones: asStringArray(obj.phones),
    job_titles: asStringArray(obj.job_titles),
    company_names: asStringArray(obj.company_names),
  };
}

export function parseContactHighlightJson(
  text: string,
): ContactHighlightExtraction {
  const trimmed = text.trim();
  if (!trimmed) return emptyContactHighlightExtraction();
  try {
    return parseContactHighlightExtraction(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return parseContactHighlightExtraction(
          JSON.parse(trimmed.slice(start, end + 1)),
        );
      } catch {
        return emptyContactHighlightExtraction();
      }
    }
    return emptyContactHighlightExtraction();
  }
}

export function toHighlightSpans(
  extraction: ContactHighlightExtraction,
): ContactHighlightSpan[] {
  const spans: ContactHighlightSpan[] = [];
  for (const text of extraction.contact_names) {
    spans.push({ type: "contact_name", text });
  }
  for (const text of extraction.phones) {
    spans.push({ type: "phone", text });
  }
  for (const text of extraction.job_titles) {
    spans.push({ type: "job_title", text });
  }
  for (const text of extraction.company_names) {
    spans.push({ type: "company_name", text });
  }
  // Longer matches first so "Jean Tremblay Inc." wins over "Jean Tremblay".
  spans.sort((a, b) => b.text.length - a.text.length);
  return spans;
}

export function extractionHasAny(extraction: ContactHighlightExtraction): boolean {
  return (
    extraction.contact_names.length > 0 ||
    extraction.phones.length > 0 ||
    extraction.job_titles.length > 0 ||
    extraction.company_names.length > 0
  );
}

/** Third-pass contact fingerprint (entity card) for one person. */
export type ContactEntityCard = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  /** Company / "Dan from XYZ" phrase as written. Not invented. */
  raw_company?: string | null;
};

export type ContactFingerprintResult = {
  entity_cards: ContactEntityCard[];
};

export function emptyContactFingerprintResult(): ContactFingerprintResult {
  return { entity_cards: [] };
}

export function emptyContactEntityCard(): ContactEntityCard {
  return {
    first_name: null,
    last_name: null,
    email: null,
    phone: null,
    job_title: null,
    raw_company: null,
  };
}

function nullableTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseContactEntityCard(raw: unknown): ContactEntityCard | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const card: ContactEntityCard = {
    first_name: nullableTrimmedString(obj.first_name),
    last_name: nullableTrimmedString(obj.last_name),
    email: nullableTrimmedString(obj.email),
    phone: nullableTrimmedString(obj.phone),
    job_title: nullableTrimmedString(obj.job_title),
    raw_company:
      nullableTrimmedString(obj.raw_company) ??
      nullableTrimmedString(obj.company_name),
  };
  if (
    !card.first_name &&
    !card.last_name &&
    !card.email &&
    !card.phone &&
    !card.job_title
  ) {
    return null;
  }
  return card;
}

export function parseContactFingerprintResult(
  raw: unknown,
): ContactFingerprintResult {
  if (!raw || typeof raw !== "object") {
    return emptyContactFingerprintResult();
  }
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.entity_cards) ? obj.entity_cards : [];
  const entity_cards: ContactEntityCard[] = [];
  for (const item of list) {
    const card = parseContactEntityCard(item);
    if (card) entity_cards.push(card);
  }
  return { entity_cards };
}

export function parseContactFingerprintJson(
  text: string,
): ContactFingerprintResult {
  const trimmed = text.trim();
  if (!trimmed) return emptyContactFingerprintResult();
  try {
    return parseContactFingerprintResult(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return parseContactFingerprintResult(
          JSON.parse(trimmed.slice(start, end + 1)),
        );
      } catch {
        return emptyContactFingerprintResult();
      }
    }
    return emptyContactFingerprintResult();
  }
}

export function entityCardDisplayName(card: ContactEntityCard): string {
  const parts = [card.first_name, card.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  if (card.email) return card.email;
  if (card.phone) return card.phone;
  if (card.job_title) return card.job_title;
  return "Unknown contact";
}

export function entityCardHasAny(card: ContactEntityCard): boolean {
  return Boolean(
    card.first_name ||
      card.last_name ||
      card.email ||
      card.phone ||
      card.job_title ||
      card.raw_company,
  );
}

export type ContactFingerprintEmailContext = {
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  /** Full authored body for this message only (not the thread). */
  bodyText: string;
};

export function buildContactFingerprintSystemPrompt(): string {
  return `You build contact fingerprints (entity cards) for people mentioned in ONE email message.

${buildContactHighlightDomainContext()}

Return ONLY valid JSON with this exact shape:
{
  "entity_cards": [
    {
      "first_name": string | null,
      "last_name": string | null,
      "email": string | null,
      "phone": string | null,
      "job_title": string | null,
      "raw_company": string | null
    }
  ]
}

You receive:
1) Header fields for this message (From, To, Cc, Subject)
2) The full body of this single message (not the whole thread)
3) Prior highlight extractions (contact names, phones, job titles, company names) from earlier passes

Rules:
- Create one entity card per distinct person you can identify from this message.
- Partial cards are expected and OK. Fill only fields supported by evidence; leave others null.
- Prefer splitting person names into first_name and last_name when both are clearly present. If only a first name (or only a last name) appears, put that in the matching field and leave the other null.
- raw_company: copy the organization / firm phrase tied to this person when it appears (e.g. "Dan from XYZ consulting group" → first_name "Dan", raw_company "XYZ consulting group"). Use prior company_names when they clearly belong to this person. Leave null when no org is stated. Do not invent a company.
- Populate cards from header participants (From / To / Cc display names and addresses) as well as the body and prior extractions.
- You MAY link evidence logically when it is strongly supported. Example: To includes studiopm@iccpropertymanagement.com and the body greets "Hi Haider" / "Hi Hyder" while extractions include "Haider Mukadam" — you may put that name on the StudioPM address card.
- Do NOT invent missing pieces. Example: if someone is addressed only as "Bonnie" and the Cc address is bkafi@…, do NOT invent last name "Kafi" from the local-part unless that last name also appears as evidence in this message (headers, body, or prior extractions).
- Do NOT use an email local-part (the text before @) as first_name or last_name. Example: for pgartenburg@gmail.com with last name evidence "Gartenburg", set first_name null (not "pgartenburg") and last_name "Gartenburg". If the only identity evidence is the address, leave names null and keep the email.
- Do not invent phone numbers, titles, or emails that are not supported by evidence in this message or the prior extractions.
- Email-only or name-only cards are fine when that is all the evidence supports.
- Deduplicate: one card per person identity (same person should not appear twice).
- Ignore quoted reply history if somehow present; focus on this message's headers + body + prior extractions.
- job_title is a role/title for a person (e.g. Property Manager), not a company name.`;
}

export function buildContactFingerprintUserPrompt(
  email: ContactFingerprintEmailContext,
  priorExtraction: ContactHighlightExtraction,
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

export type SourcedContactEntityCard = ContactEntityCard & {
  source_email_id: string;
  source_label: string;
};

export function buildContactFingerprintMergeSystemPrompt(): string {
  return `You merge contact fingerprint entity cards from multiple emails in the SAME thread into a unique set of people.

${buildContactHighlightDomainContext()}

Return ONLY valid JSON with this exact shape:
{
  "entity_cards": [
    {
      "first_name": string | null,
      "last_name": string | null,
      "email": string | null,
      "phone": string | null,
      "job_title": string | null,
      "raw_company": string | null
    }
  ]
}

You receive a list of entity cards produced per-email (pass 3). The same person often appears multiple times as sparse stubs (email-only) and richer cards (name + phone + title).

Rules:
- Output ONE card per distinct person.
- ALWAYS merge cards that share the same email address (case-insensitive). Example: an email-only card for studiopm@… and a "Haider Mukadam" card with that same email MUST become one card with the richest fields.
- Merge when strong identity evidence matches (same email, or same full name with no conflicting emails).
- When merging, keep non-null fields; prefer the most complete name (first+last over first-only), keep a phone/title/raw_company when any source has it. Do not invent values that appear nowhere in the input cards.
- If two cards have conflicting non-null values for the same field (rare), prefer the longer/more specific value; never invent a compromise.
- Do NOT merge different people who only share a first name.
- Do NOT invent last names from email local-parts.
- Do NOT use an email local-part as first_name or last_name. Prefer a real given name from another card over a local-part lookalike when merging.
- Drop empty cards. Partial cards are OK when that is all the evidence supports.
- Output cards only — no source_email_id / source_label fields.`;
}

export function buildContactFingerprintMergeUserPrompt(
  cards: SourcedContactEntityCard[],
): string {
  return `ENTITY CARDS FROM PASS 3 (per-email fingerprints; may contain duplicates across messages)

\`\`\`json
${JSON.stringify(cards, null, 2)}
\`\`\`

Merge into a unique entity_cards list as JSON.`;
}

/**
 * Guarantee at most one card per email address after the LLM merge.
 * Cards without email are left as-is.
 */
export function coalesceEntityCardsByEmail(
  cards: ContactEntityCard[],
): ContactEntityCard[] {
  const withoutEmail: ContactEntityCard[] = [];
  const byEmail = new Map<string, ContactEntityCard>();

  for (const card of cards) {
    const emailKey = card.email?.trim().toLowerCase() ?? "";
    if (!emailKey) {
      withoutEmail.push(card);
      continue;
    }
    const existing = byEmail.get(emailKey);
    if (!existing) {
      byEmail.set(emailKey, { ...card });
      continue;
    }
    byEmail.set(emailKey, preferRicherEntityCard(existing, card));
  }

  return [...byEmail.values(), ...withoutEmail];
}

function preferRicherEntityCard(
  a: ContactEntityCard,
  b: ContactEntityCard,
): ContactEntityCard {
  const emails = [a.email, b.email];
  const firstName = sanitizeGivenNameAgainstEmails(
    preferPersonGivenName(a.first_name, b.first_name, emails),
    emails,
  );
  return {
    first_name: firstName,
    last_name: preferString(a.last_name, b.last_name),
    email: preferString(a.email, b.email),
    phone: preferString(a.phone, b.phone),
    job_title: preferString(a.job_title, b.job_title),
    raw_company: preferString(a.raw_company ?? null, b.raw_company ?? null),
  };
}

function preferString(a: string | null, b: string | null): string | null {
  const left = a?.trim() || null;
  const right = b?.trim() || null;
  if (!left) return right;
  if (!right) return left;
  // Prefer the longer / more specific spelling when both present.
  return right.length > left.length ? right : left;
}

/**
 * Split `text` into segments with non-overlapping highlight types.
 * Matching is case-insensitive; output preserves original casing from `text`.
 * Spans with `start`/`end` mark only that range; others mark every substring hit.
 */
export function buildHighlightedSegments(
  text: string,
  spans: ContactHighlightSpan[],
): TextSegment[] {
  if (!text || spans.length === 0) {
    return [{ text, type: null }];
  }

  const lower = text.toLowerCase();
  const taken = new Array<ContactHighlightType | null>(text.length).fill(null);

  // Longer matches first so "Jean Tremblay Inc." wins over "Jean Tremblay".
  const ordered = [...spans].sort((a, b) => {
    const aLen =
      a.start != null && a.end != null
        ? a.end - a.start
        : a.text.trim().length;
    const bLen =
      b.start != null && b.end != null
        ? b.end - b.start
        : b.text.trim().length;
    return bLen - aLen;
  });

  for (const span of ordered) {
    if (
      typeof span.start === "number" &&
      typeof span.end === "number" &&
      Number.isFinite(span.start) &&
      Number.isFinite(span.end)
    ) {
      const start = Math.max(0, Math.min(text.length, Math.floor(span.start)));
      const end = Math.max(start, Math.min(text.length, Math.floor(span.end)));
      if (end <= start) continue;
      let overlaps = false;
      for (let i = start; i < end; i++) {
        if (taken[i] != null) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        for (let i = start; i < end; i++) {
          taken[i] = span.type;
        }
      }
      continue;
    }

    const needle = span.text.trim();
    if (!needle) continue;
    const needleLower = needle.toLowerCase();
    let from = 0;
    while (from < lower.length) {
      const idx = lower.indexOf(needleLower, from);
      if (idx < 0) break;
      const end = idx + needle.length;
      let overlaps = false;
      for (let i = idx; i < end; i++) {
        if (taken[i] != null) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        for (let i = idx; i < end; i++) {
          taken[i] = span.type;
        }
      }
      from = idx + 1;
    }
  }

  const segments: TextSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const type = taken[i];
    let j = i + 1;
    while (j < text.length && taken[j] === type) j++;
    segments.push({ text: text.slice(i, j), type });
    i = j;
  }
  return segments;
}
