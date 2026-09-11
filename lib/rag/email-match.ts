import {
  givenNameEditDistance,
  isAcceptableNameAlias,
  normalizeGivenNameToken,
} from "@/lib/contacts/person-name";

export const SUBJECT_MATCH_SIMILARITY = 0.91;
export const MAX_SUBJECT_EMAIL_HITS = 12;

const EMAIL_NEEDLE_STOPWORDS = new Set([
  "about",
  "and",
  "are",
  "chain",
  "chains",
  "condominium",
  "confusion",
  "correction",
  "correspondence",
  "did",
  "does",
  "email",
  "emails",
  "for",
  "from",
  "how",
  "immediate",
  "long",
  "manager",
  "originally",
  "oversight",
  "promotion",
  "promoted",
  "role",
  "switch",
  "takeover",
  "the",
  "there",
  "timeline",
  "transition",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
  "would",
]);

export type EmailNeedlePerson = {
  firstName: string | null;
  lastName: string | null;
  aliases?: string[];
};

/** Capitalized person-like tokens from the user's wording (Hyder, Bonnie). */
export function properNameNeedles(query: string): string[] {
  const matches = query.match(/\b[A-Z][A-Za-z]{2,}\b/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const cleaned = raw.replace(/['’]s$/i, "").trim();
    if (cleaned.length < 3) continue;
    if (EMAIL_NEEDLE_STOPWORDS.has(cleaned.toLowerCase())) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/**
 * True when two given names should retrieve the same person (Haider/Hyder).
 * Stricter than unsupervised registry merge: same first letter, similar length.
 */
export function namesAreRetrievalVariants(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = a ? normalizeGivenNameToken(a) : "";
  const right = b ? normalizeGivenNameToken(b) : "";
  if (!left || !right) return false;
  if (left === right) return true;
  if (isAcceptableNameAlias(left, right)) return true;
  if (left.length < 5 || right.length < 5) return false;
  if (left[0] !== right[0]) return false;
  if (Math.abs(left.length - right.length) > 2) return false;
  return givenNameEditDistance(left, right) <= 2;
}

function addNeedle(out: string[], seen: Set<string>, raw: string, minLen = 3) {
  const cleaned = raw.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < minLen || cleaned.length > 40) return;
  if (EMAIL_NEEDLE_STOPWORDS.has(cleaned.toLowerCase())) return;
  const key = cleaned.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(cleaned);
}

export function emailSubjectSearchNeedles(
  query: string,
  extraNeedles: string[] = [],
): string[] {
  const needles: string[] = [];
  const seen = new Set<string>();
  for (const name of properNameNeedles(query)) {
    addNeedle(needles, seen, name);
  }
  for (const extra of extraNeedles) {
    const token = extra.trim();
    if (token.length < 4) continue;
    if (EMAIL_NEEDLE_STOPWORDS.has(token.toLowerCase())) continue;
    addNeedle(needles, seen, token, 4);
  }
  return needles;
}

/** Add registry spellings (Haider Mukadam) for close query names (Hyder). */
export function expandEmailNeedlesFromPersonNames(
  needles: string[],
  people: EmailNeedlePerson[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const needle of needles) {
    addNeedle(out, seen, needle);
  }

  for (const person of people) {
    const first = person.firstName?.trim() || "";
    const last = person.lastName?.trim() || "";
    const aliases = person.aliases ?? [];
    const givenNames = [first, ...aliases].filter(Boolean);
    let matched = false;
    for (const needle of needles) {
      for (const given of givenNames) {
        if (namesAreRetrievalVariants(needle, given)) {
          matched = true;
          break;
        }
      }
      if (!matched && last && needle.toLowerCase() === last.toLowerCase()) {
        matched = true;
      }
      if (matched) break;
    }
    if (!matched) continue;
    if (first) addNeedle(out, seen, first);
    if (first && last) addNeedle(out, seen, `${first} ${last}`);
    for (const alias of aliases) addNeedle(out, seen, alias);
  }
  return out;
}

export function emailHaystackMatchesNeedles(
  haystack: string,
  needles: string[],
): number {
  const hay = haystack.toLowerCase();
  let hits = 0;
  const seen = new Set<string>();
  for (const needle of needles) {
    const key = needle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (key.length >= 3 && hay.includes(key)) hits += 1;
  }
  return hits;
}
