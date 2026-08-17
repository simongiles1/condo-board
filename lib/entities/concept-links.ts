/**
 * Client-safe Wikipedia-style linking: stored entity aliases → spans in free text.
 * Matching is longest-first, token-bounded, and case-insensitive.
 * Catalog kinds: person, organization, equipment, and dated calendar events.
 */

export const CONCEPT_ALIAS_MIN_LENGTH = 3;

const CONCEPT_ALIAS_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "by",
  "from",
  "with",
  "email",
]);

export type LinkedConceptKind = "person" | "organization" | "equipment" | "event";

export type LinkedConcept = {
  id: string;
  kind: LinkedConceptKind;
  displayName: string;
  aliases: string[];
  mentionWeight?: number;
  person?: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    title: string | null;
    organizationName: string | null;
  };
  organization?: {
    name: string | null;
    role: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
  };
  equipment?: {
    name: string;
    manufacturer: string | null;
    category: string | null;
    location: string | null;
    kind: string | null;
    notes: string | null;
  };
  event?: {
    title: string;
    eventType: string;
    startAt: string;
    description: string | null;
  };
};

export type ConceptLinkSpan = {
  start: number;
  end: number;
  conceptIds: string[];
  kind: LinkedConceptKind;
};

export type ConceptMatcher = {
  conceptsById: Map<string, LinkedConcept>;
  aliases: Array<{
    pattern: RegExp;
    conceptIds: string[];
    kind: LinkedConceptKind;
    length: number;
  }>;
};

const KIND_PRIORITY: Record<LinkedConceptKind, number> = {
  person: 0,
  organization: 1,
  equipment: 2,
  event: 3,
};

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function parseConceptEventDay(
  startAt: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(startAt.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function dayOrdinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function eventTitleVariants(title: string): string[] {
  const trimmed = title.replace(/\s+/g, " ").trim();
  if (!trimmed) return [];
  const withoutParens = trimmed
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [trimmed, withoutParens]) {
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Date-qualified aliases so "June 30 board meeting" links the June 30 row,
 * not every calendar event titled "Board meeting".
 */
export function calendarEventConceptAliases(
  title: string,
  startAt: string,
): string[] {
  const parsed = parseConceptEventDay(startAt);
  const titles = eventTitleVariants(title);
  if (!parsed || titles.length === 0) return [];

  const monthLong = MONTHS_LONG[parsed.month - 1]!;
  const monthShort = MONTHS_SHORT[parsed.month - 1]!;
  const ordinal = dayOrdinal(parsed.day);
  const datePhrases = [
    `${monthLong} ${parsed.day}`,
    `${monthLong} ${ordinal}`,
    `${monthLong} ${parsed.day}, ${parsed.year}`,
    `${monthLong} ${ordinal}, ${parsed.year}`,
    `${monthLong} ${parsed.day} ${parsed.year}`,
    `${monthLong} ${ordinal} ${parsed.year}`,
    `${monthShort} ${parsed.day}`,
    `${monthShort} ${ordinal}`,
    `${monthShort} ${parsed.day}, ${parsed.year}`,
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const eventTitle of titles) {
    for (const datePhrase of datePhrases) {
      for (const alias of [
        `${datePhrase} ${eventTitle}`,
        `${datePhrase}, ${eventTitle}`,
        `${eventTitle} on ${datePhrase}`,
        `${eventTitle} of ${datePhrase}`,
      ]) {
        const key = alias.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(alias);
      }
    }
  }
  return out;
}

export function formatConceptEventDate(startAt: string): string {
  const parsed = parseConceptEventDay(startAt);
  if (!parsed) return startAt;
  return `${MONTHS_LONG[parsed.month - 1]} ${parsed.day}, ${parsed.year}`;
}

function aliasContainsYear(alias: string): boolean {
  return /\b(?:19|20)\d{2}\b/.test(alias);
}

function eventDayUtcMs(startAt: string): number | null {
  const parsed = parseConceptEventDay(startAt);
  if (!parsed) return null;
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day);
}

function defaultTodayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Lower is better: most recent past (or today) first, then nearest future.
 * Yearless "June 30 board meeting" should resolve to last June's meeting, not
 * every year's row stacked in the popover.
 */
export function eventRecencyRank(startAt: string, todayKey: string): number {
  const eventMs = eventDayUtcMs(startAt);
  const todayMs = eventDayUtcMs(todayKey);
  if (eventMs == null || todayMs == null) return Number.POSITIVE_INFINITY;
  const deltaDays = Math.round((eventMs - todayMs) / 86_400_000);
  if (deltaDays <= 0) return -deltaDays;
  return 1_000_000 + deltaDays;
}

function eventDayKey(concept: LinkedConcept): string | null {
  const startAt = concept.event?.startAt;
  if (!startAt) return null;
  const parsed = parseConceptEventDay(startAt);
  if (!parsed) return null;
  return `${parsed.year}-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
}

/**
 * Yearless date aliases are shared across annual repeats. Keep the nearest
 * past occurrence (else nearest future). Same-day rows still stack so a true
 * duplicate on one date remains visible.
 */
function collapseYearlessEventConceptIds(
  alias: string,
  ids: string[],
  conceptsById: Map<string, LinkedConcept>,
  todayKey: string,
): string[] {
  if (aliasContainsYear(alias)) return ids;

  const events: LinkedConcept[] = [];
  const others: string[] = [];
  for (const id of ids) {
    const concept = conceptsById.get(id);
    if (concept?.kind === "event") events.push(concept);
    else others.push(id);
  }
  if (events.length <= 1) return ids;

  const uniqueDays = new Set(
    events.map((event) => eventDayKey(event)).filter((day): day is string => Boolean(day)),
  );
  if (uniqueDays.size <= 1) return ids;

  const ranked = [...events].sort((a, b) => {
    const rank =
      eventRecencyRank(a.event?.startAt ?? "", todayKey) -
      eventRecencyRank(b.event?.startAt ?? "", todayKey);
    if (rank !== 0) return rank;
    return a.id.localeCompare(b.id);
  });
  const winnerDay = eventDayKey(ranked[0]!);
  const kept = events
    .filter((event) => eventDayKey(event) === winnerDay)
    .map((event) => event.id);
  return [...others, ...kept];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAliasKey(alias: string): string {
  return alias.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isUsableConceptAlias(alias: string): boolean {
  const key = normalizeAliasKey(alias);
  if (key.length < CONCEPT_ALIAS_MIN_LENGTH) return false;
  if (CONCEPT_ALIAS_STOPWORDS.has(key)) return false;
  return true;
}

function primaryKind(kinds: Iterable<LinkedConceptKind>): LinkedConceptKind {
  return [...kinds].sort((a, b) => KIND_PRIORITY[a] - KIND_PRIORITY[b])[0]!;
}

export type ConceptMatcherOptions = {
  /** YYYY-MM-DD in America/Toronto; used to pick one year for yearless event aliases. */
  todayKey?: string;
};

export function buildConceptMatcher(
  concepts: LinkedConcept[],
  options?: ConceptMatcherOptions,
): ConceptMatcher {
  const todayKey = options?.todayKey ?? defaultTodayKey();
  const conceptsById = new Map(concepts.map((concept) => [concept.id, concept]));
  const byAlias = new Map<
    string,
    { conceptIds: string[]; kinds: Set<LinkedConceptKind> }
  >();

  for (const concept of concepts) {
    const seen = new Set<string>();
    for (const alias of concept.aliases) {
      if (!isUsableConceptAlias(alias)) continue;
      const key = normalizeAliasKey(alias);
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = byAlias.get(key) ?? {
        conceptIds: [],
        kinds: new Set<LinkedConceptKind>(),
      };
      if (!bucket.conceptIds.includes(concept.id)) {
        bucket.conceptIds.push(concept.id);
      }
      bucket.kinds.add(concept.kind);
      byAlias.set(key, bucket);
    }
  }

  const aliases = [...byAlias.entries()]
    .map(([alias, bucket]) => {
      const words = alias.split(" ").filter(Boolean);
      const body = words.map(escapeRegExp).join("\\s+");
      return {
        pattern: new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu"),
        conceptIds: rankConceptIds(
          collapseYearlessEventConceptIds(
            alias,
            bucket.conceptIds,
            conceptsById,
            todayKey,
          ),
          conceptsById,
        ),
        kind: primaryKind(bucket.kinds),
        length: alias.length,
      };
    })
    .sort((a, b) => b.length - a.length);

  return { conceptsById, aliases };
}

function rankConceptIds(
  ids: string[],
  conceptsById: Map<string, LinkedConcept>,
): string[] {
  return [...ids].sort((a, b) => {
    const weightA = conceptsById.get(a)?.mentionWeight ?? 0;
    const weightB = conceptsById.get(b)?.mentionWeight ?? 0;
    if (weightB !== weightA) return weightB - weightA;
    return a.localeCompare(b);
  });
}

export function findConceptLinkSpans(
  text: string,
  matcher: ConceptMatcher,
): ConceptLinkSpan[] {
  if (!text) return [];

  const taken = new Uint8Array(text.length);
  const spans: ConceptLinkSpan[] = [];

  for (const alias of matcher.aliases) {
    alias.pattern.lastIndex = 0;
    let match = alias.pattern.exec(text);
    while (match) {
      const start = match.index;
      const end = start + match[0].length;
      if (end <= start) {
        alias.pattern.lastIndex = start + 1;
        match = alias.pattern.exec(text);
        continue;
      }

      let free = true;
      for (let i = start; i < end; i++) {
        if (taken[i]) {
          free = false;
          break;
        }
      }
      if (free) {
        for (let i = start; i < end; i++) taken[i] = 1;
        spans.push({
          start,
          end,
          conceptIds: alias.conceptIds,
          kind: alias.kind,
        });
      }
      match = alias.pattern.exec(text);
    }
  }

  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  return spans;
}

export function getConceptsForSpan(
  span: ConceptLinkSpan,
  matcher: ConceptMatcher,
): LinkedConcept[] {
  return span.conceptIds
    .map((id) => matcher.conceptsById.get(id))
    .filter((concept): concept is LinkedConcept => Boolean(concept));
}

function conceptMightAppearInTexts(
  concept: LinkedConcept,
  normalizedHaystack: string,
): boolean {
  for (const alias of concept.aliases) {
    if (!isUsableConceptAlias(alias)) continue;
    const key = normalizeAliasKey(alias);
    if (normalizedHaystack.includes(key)) return true;
  }
  return false;
}

/** Keep only catalog cards that actually appear in the given strings. */
export function conceptsUsedInTexts(
  texts: string[],
  concepts: LinkedConcept[],
  options?: ConceptMatcherOptions,
): LinkedConcept[] {
  const normalizedHaystack = texts
    .join("\n")
    .toLowerCase()
    .replace(/\s+/g, " ");
  const candidates = concepts.filter((concept) =>
    conceptMightAppearInTexts(concept, normalizedHaystack),
  );
  if (candidates.length === 0) return [];

  const matcher = buildConceptMatcher(candidates, options);
  const used = new Set<string>();
  for (const text of texts) {
    for (const span of findConceptLinkSpans(text, matcher)) {
      for (const id of span.conceptIds) used.add(id);
    }
  }
  return candidates.filter((concept) => used.has(concept.id));
}
