import {
  CONTACT_HIGHLIGHT_LABELS,
  toHighlightSpans,
  type ContactHighlightExtraction,
} from "@/lib/email-analysis/contact-highlight-shared";
import {
  EVENT_HIGHLIGHT_LABELS,
  type EventHighlightType,
} from "@/lib/email-analysis/event-highlight-shared";
import {
  HARVEST_GROUP_PRIORITY,
  primaryHarvestGroup,
  type HarvestGroupId,
} from "@/lib/email-analysis/harvest-highlight-theme";
import {
  ORG_HIGHLIGHT_LABELS,
  toOrgHighlightSpans,
  type OrgHighlightExtraction,
} from "@/lib/email-analysis/org-highlight-shared";
import {
  PROJECT_HIGHLIGHT_LABELS,
  toProjectHighlightSpans,
  type ProjectHighlightExtraction,
} from "@/lib/email-analysis/project-highlight-shared";

export type HarvestEventHighlight = {
  type: EventHighlightType;
  title: string;
  sourceQuote: string | null;
};

export type HarvestTodoHighlight = {
  title: string;
  sourceQuote: string | null;
};

export type HarvestSpan = {
  group: HarvestGroupId;
  type: string;
  start: number;
  end: number;
  title: string;
  focus?: boolean;
  unresolved?: boolean;
  mentionId?: string;
  resolvedId?: string | null;
  candidates?: Array<{ id: string; name: string }>;
};

export type HarvestMarkNode = {
  start: number;
  end: number;
  layers: HarvestSpan[];
  children: HarvestMarkNode[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Paint budget for a to-do / event source quote — one ask, not the whole email. */
export const MAX_QUOTE_HIGHLIGHT_CHARS = 280;
const MAX_FLEXIBLE_QUOTE_WORDS = 48;
const MIN_QUOTE_WORD_WINDOW = 6;
const MIN_ASK_SENTENCE_CHARS = 40;

const GREETING_SENTENCE =
  /^(hi|hello|hey|dear|good\s+(morning|afternoon|evening))\b/i;
const TRAILING_ABBREV =
  /\b(?:mr|mrs|ms|dr|st|vs|etc|inc|ltd|tscc|no|nos)\.$/i;

export type QuoteRange = { start: number; end: number };

/** First match of a verbatim or whitespace-flexible quote. */
export function findFlexibleQuoteRange(
  text: string,
  quote: string,
): QuoteRange | null {
  const needle = quote.trim();
  if (!needle) return null;

  const direct = text.toLowerCase().indexOf(needle.toLowerCase());
  if (direct >= 0) return { start: direct, end: direct + needle.length };

  const words = needle.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_FLEXIBLE_QUOTE_WORDS) {
    return null;
  }
  const pattern = words.map(escapeRegExp).join("\\s+");
  const match = text.match(new RegExp(pattern, "i"));
  if (!match || match.index == null) return null;
  return { start: match.index, end: match.index + match[0].length };
}

function isGreetingSentence(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length >= MIN_ASK_SENTENCE_CHARS) return false;
  return GREETING_SENTENCE.test(trimmed);
}

function trimRange(text: string, range: QuoteRange): QuoteRange {
  let { start, end } = range;
  while (start < end && /\s/.test(text[start]!)) start += 1;
  while (end > start && /\s/.test(text[end - 1]!)) end -= 1;
  return { start, end };
}

function hardCapRange(text: string, start: number, limit: number): QuoteRange {
  const maxEnd = Math.min(text.length, start + MAX_QUOTE_HIGHLIGHT_CHARS);
  let end = Math.min(limit, maxEnd);
  if (end < text.length) {
    const sliced = text.slice(start, end);
    const lastSpace = sliced.search(/\s+\S*$/);
    if (lastSpace >= MIN_ASK_SENTENCE_CHARS) {
      end = start + lastSpace;
    }
  }
  return trimRange(text, { start, end });
}

function sentenceRanges(text: string): QuoteRange[] {
  const ranges: QuoteRange[] = [];
  let start = 0;

  const push = (end: number) => {
    const range = trimRange(text, { start, end });
    if (range.end > range.start) ranges.push(range);
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\n" && text[i + 1] === "\n") {
      push(i);
      while (i < text.length && text[i] === "\n") i += 1;
      start = i;
      i -= 1;
      continue;
    }
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    const next = text[i + 1];
    if (next && /\d/.test(next)) continue;
    if (next && !/\s/.test(next)) continue;
    if (TRAILING_ABBREV.test(text.slice(start, i + 1).trimEnd())) continue;
    push(i + 1);
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j]!)) j += 1;
    start = j;
    i = j - 1;
  }

  if (start < text.length) push(text.length);
  return ranges;
}

/**
 * Existing harvests often stored a paragraph or the whole unique body as
 * source_quote. Paint the extracting sentence instead of that whole span.
 */
function clipQuoteRangeToSentence(text: string, range: QuoteRange): QuoteRange {
  const covering = sentenceRanges(text).filter(
    (sentence) => sentence.end > range.start && sentence.start < range.end,
  );

  for (const sentence of covering) {
    const slice = text.slice(sentence.start, sentence.end).trim();
    if (isGreetingSentence(slice)) continue;
    if (slice.length < 20 && covering.length > 1) continue;
    if (sentence.end - sentence.start > MAX_QUOTE_HIGHLIGHT_CHARS) {
      return hardCapRange(text, sentence.start, sentence.end);
    }
    return trimRange(text, sentence);
  }

  return hardCapRange(text, range.start, range.end);
}

/**
 * Locate a sentence-sized highlight for a stored source quote.
 * Works on already-harvested rows — no re-extract required.
 */
export function locateSentenceQuoteRange(
  text: string,
  quote: string,
): QuoteRange | null {
  const needle = quote.trim();
  if (!needle || !text) return null;

  const tryClip = (candidate: string): QuoteRange | null => {
    const trimmed = candidate.trim();
    if (!trimmed) return null;
    const range = findFlexibleQuoteRange(text, trimmed);
    return range ? clipQuoteRangeToSentence(text, range) : null;
  };

  if (needle.length <= MAX_QUOTE_HIGHLIGHT_CHARS) {
    const hit = tryClip(needle);
    if (hit) return hit;
  } else {
    const direct = findFlexibleQuoteRange(text, needle);
    if (direct) return clipQuoteRangeToSentence(text, direct);
  }

  for (const sentence of sentenceRanges(needle)) {
    const piece = needle.slice(sentence.start, sentence.end).trim();
    if (piece.length < 20 || isGreetingSentence(piece)) continue;
    const hit = tryClip(piece);
    if (hit) return hit;
  }

  const words = needle.split(/\s+/).filter(Boolean);
  const maxWin = Math.min(words.length, 24);
  for (let len = maxWin; len >= MIN_QUOTE_WORD_WINDOW; len--) {
    const hit = tryClip(words.slice(0, len).join(" "));
    if (hit) return hit;
  }

  const windowSize = 8;
  if (words.length > windowSize) {
    for (let i = 1; i + windowSize <= words.length; i++) {
      const hit = tryClip(words.slice(i, i + windowSize).join(" "));
      if (hit) return hit;
    }
  }

  return null;
}

function findAllSubstringRanges(
  text: string,
  needle: string,
): Array<{ start: number; end: number }> {
  const trimmed = needle.trim();
  if (!trimmed) return [];
  const lower = text.toLowerCase();
  const needleLower = trimmed.toLowerCase();
  const out: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from < lower.length) {
    const idx = lower.indexOf(needleLower, from);
    if (idx < 0) break;
    out.push({ start: idx, end: idx + trimmed.length });
    from = idx + Math.max(1, trimmed.length);
  }
  return out;
}

function isTokenBoundary(ch: string | undefined): boolean {
  return !ch || /[^\p{L}\p{N}]/u.test(ch);
}

/** Substring hits that sit on name-token boundaries — "Trace" not "Traceroute". */
function findNameTokenRanges(
  text: string,
  needle: string,
): Array<{ start: number; end: number }> {
  return findAllSubstringRanges(text, needle).filter((range) => {
    const before = range.start > 0 ? text[range.start - 1] : undefined;
    const after = range.end < text.length ? text[range.end] : undefined;
    return isTokenBoundary(before) && isTokenBoundary(after);
  });
}

function surfaceKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Exact or first-token prefix: "trace" ↔ "trace consulting group". */
function surfacesCollide(a: string, b: string): boolean {
  const left = surfaceKey(a);
  const right = surfaceKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return right.startsWith(`${left} `) || left.startsWith(`${right} `);
}

function collectOrgSurfaces(
  org: OrgHighlightExtraction | null | undefined,
  mentions: HarvestMentionPaint[],
): string[] {
  const out: string[] = [];
  for (const name of org?.organization_names ?? []) {
    if (name.trim()) out.push(name);
  }
  for (const mention of mentions) {
    if (mention.group === "organization" && mention.surface.trim()) {
      out.push(mention.surface);
    }
  }
  return out;
}

function surfaceMatchesAny(surface: string, candidates: string[]): boolean {
  return candidates.some((candidate) => surfacesCollide(surface, candidate));
}

function orgSpanCoversRange(
  spans: HarvestSpan[],
  range: { start: number; end: number },
): boolean {
  return spans.some(
    (span) =>
      span.group === "organization" &&
      span.start <= range.start &&
      span.end >= range.end,
  );
}

/**
 * Body: unique token hit only (avoid painting the verb "trace").
 * Subject (`locateNeedlesInText`): every token-boundary hit.
 */
function locateNameTokenPaintRanges(
  text: string,
  needle: string,
  locateNeedlesInText: boolean,
): Array<{ start: number; end: number }> {
  const ranges = findNameTokenRanges(text, needle);
  if (locateNeedlesInText) return ranges;
  return ranges.length === 1 ? ranges : [];
}

function pushOrganizationNameSpan(
  spans: HarvestSpan[],
  text: string,
  range: { start: number; end: number },
  extra?: Partial<HarvestSpan>,
): void {
  if (orgSpanCoversRange(spans, range)) return;
  spans.push({
    group: "organization",
    type: "organization_name",
    start: range.start,
    end: range.end,
    title: `Organization: ${text.slice(range.start, range.end)}`,
    ...extra,
  });
}

function locateExtractionRanges(
  text: string,
  span: { text: string; start?: number; end?: number },
  locateNeedlesInText: boolean,
  tokenMatch: boolean,
): Array<{ start: number; end: number }> {
  if (!locateNeedlesInText && span.start != null && span.end != null) {
    return [{ start: span.start, end: span.end }];
  }
  return tokenMatch
    ? findNameTokenRanges(text, span.text)
    : findAllSubstringRanges(text, span.text);
}

function mentionCoversSurface(
  mentions: HarvestMentionPaint[],
  surface: string,
): boolean {
  const key = surface.trim().toLowerCase();
  if (!key) return false;
  return mentions.some((row) => row.surface.trim().toLowerCase() === key);
}

function layerKey(span: HarvestSpan): string {
  return `${span.group}|${span.type}|${span.title}`;
}

function coalesceIdentical(spans: HarvestSpan[]): HarvestMarkNode[] {
  const buckets = new Map<string, HarvestSpan[]>();
  for (const span of spans) {
    if (span.end <= span.start) continue;
    const key = `${span.start}:${span.end}`;
    const list = buckets.get(key) ?? [];
    list.push(span);
    buckets.set(key, list);
  }

  const nodes: HarvestMarkNode[] = [];
  for (const [, layers] of buckets) {
    const seen = new Set<string>();
    const unique: HarvestSpan[] = [];
    for (const layer of layers) {
      const key = layerKey(layer);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(layer);
    }
    unique.sort(
      (a, b) => HARVEST_GROUP_PRIORITY[a.group] - HARVEST_GROUP_PRIORITY[b.group],
    );
    const first = unique[0]!;
    nodes.push({
      start: first.start,
      end: first.end,
      layers: unique,
      children: [],
    });
  }
  return nodes;
}

function nodePriority(node: HarvestMarkNode): number {
  return HARVEST_GROUP_PRIORITY[primaryHarvestGroup(node.layers.map((l) => l.group))];
}

function nodeLength(node: HarvestMarkNode): number {
  return node.end - node.start;
}

function cloneNode(
  node: HarvestMarkNode,
  start: number,
  end: number,
): HarvestMarkNode | null {
  if (end <= start) return null;
  return {
    start,
    end,
    layers: node.layers.map((layer) => ({ ...layer, start, end })),
    children: [],
  };
}

function isPartialOverlap(a: HarvestMarkNode, b: HarvestMarkNode): boolean {
  const overlapStart = Math.max(a.start, b.start);
  const overlapEnd = Math.min(a.end, b.end);
  if (overlapEnd <= overlapStart) return false;
  const aContained = a.start >= b.start && a.end <= b.end;
  const bContained = b.start >= a.start && b.end <= a.end;
  return !aContained && !bContained;
}

function findPartialPair(
  nodes: HarvestMarkNode[],
): { keep: HarvestMarkNode; split: HarvestMarkNode } | null {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (!isPartialOverlap(a, b)) continue;
      const aShorter =
        nodeLength(a) < nodeLength(b) ||
        (nodeLength(a) === nodeLength(b) && nodePriority(a) <= nodePriority(b));
      return aShorter ? { keep: a, split: b } : { keep: b, split: a };
    }
  }
  return null;
}

/** Split partial overlaps so remaining pairs are disjoint or nested. */
export function splitPartialOverlaps(nodes: HarvestMarkNode[]): HarvestMarkNode[] {
  let current = coalesceIdentical(nodes.flatMap((node) => node.layers));
  let guard = 0;
  while (guard < 200) {
    guard += 1;
    const pair = findPartialPair(current);
    if (!pair) break;
    const without = current.filter((node) => node !== pair.split);
    const before = cloneNode(pair.split, pair.split.start, pair.keep.start);
    const after = cloneNode(pair.split, pair.keep.end, pair.split.end);
    current = coalesceIdentical([
      ...without.flatMap((node) => node.layers),
      ...(before ? before.layers : []),
      ...(after ? after.layers : []),
    ]);
  }
  return current;
}

function insertContained(roots: HarvestMarkNode[], node: HarvestMarkNode): void {
  for (const root of roots) {
    if (node.start >= root.start && node.end <= root.end) {
      insertContained(root.children, node);
      return;
    }
  }
  roots.push(node);
}

export function nestHarvestNodes(nodes: HarvestMarkNode[]): HarvestMarkNode[] {
  const sorted = [...nodes].sort(
    (a, b) => a.start - b.start || nodeLength(b) - nodeLength(a),
  );
  const roots: HarvestMarkNode[] = [];
  for (const node of sorted) {
    insertContained(roots, {
      start: node.start,
      end: node.end,
      layers: node.layers,
      children: [],
    });
  }
  roots.sort((a, b) => a.start - b.start);
  for (const root of roots) {
    root.children.sort((a, b) => a.start - b.start);
  }
  return roots;
}

export function buildHarvestMarkTree(spans: HarvestSpan[]): HarvestMarkNode[] {
  const coalesced = coalesceIdentical(spans);
  const split = splitPartialOverlaps(coalesced);
  return nestHarvestNodes(split);
}

export type HarvestMentionPaint = {
  group: "organization" | "contact";
  type: string;
  start: number;
  end: number;
  title: string;
  surface: string;
  unresolved: boolean;
  mentionId: string;
  resolvedId: string | null;
  candidates: Array<{ id: string; name: string }>;
};

export function resolveHarvestSpans(input: {
  text: string;
  contact?: ContactHighlightExtraction | null;
  org?: OrgHighlightExtraction | null;
  project?: ProjectHighlightExtraction | null;
  events?: HarvestEventHighlight[];
  todos?: HarvestTodoHighlight[];
  focusQuote?: string | null;
  mentionPaints?: HarvestMentionPaint[];
  /**
   * Locate extraction needles in `text` instead of applying stored body
   * offsets. Used for subject lines, where pass-3 cards often exist but
   * unique-body spans do not.
   */
  locateNeedlesInText?: boolean;
}): HarvestSpan[] {
  const spans: HarvestSpan[] = [];
  const { text } = input;
  if (!text) return spans;

  const locateNeedlesInText = Boolean(input.locateNeedlesInText);
  const mentionPaints = input.mentionPaints ?? [];
  const orgMentions = mentionPaints.filter((row) => row.group === "organization");
  const contactMentions = mentionPaints.filter((row) => row.group === "contact");

  if (input.contact) {
    for (const span of toHighlightSpans(input.contact)) {
      const label = CONTACT_HIGHLIGHT_LABELS[span.type] ?? span.type;
      if (span.type === "contact_name") {
        if (!locateNeedlesInText && contactMentions.length > 0) continue;
        if (locateNeedlesInText && mentionCoversSurface(contactMentions, span.text)) {
          continue;
        }
      }
      const tokenMatch = locateNeedlesInText && span.type === "contact_name";
      for (const range of locateExtractionRanges(
        text,
        span,
        locateNeedlesInText,
        tokenMatch,
      )) {
        spans.push({
          group: "contact",
          type: span.type,
          start: range.start,
          end: range.end,
          title: `${label}: ${text.slice(range.start, range.end)}`,
        });
      }
    }
  }

  if (input.org) {
    for (const span of toOrgHighlightSpans(input.org)) {
      const label = ORG_HIGHLIGHT_LABELS[span.type] ?? span.type;
      if (span.type === "organization_name") {
        if (!locateNeedlesInText && orgMentions.length > 0) continue;
        if (locateNeedlesInText && mentionCoversSurface(orgMentions, span.text)) {
          continue;
        }
      }
      // Token-paint heuristic for short extraction strings without offsets
      // (word match, not substring). Not the retired 12-char alias gate.
      const shortName =
        span.type === "organization_name" && span.text.trim().length < 12;
      if (
        shortName &&
        !locateNeedlesInText &&
        (span.start == null || span.end == null)
      ) {
        for (const range of locateNameTokenPaintRanges(text, span.text, false)) {
          pushOrganizationNameSpan(spans, text, range);
        }
        continue;
      }
      const tokenMatch = locateNeedlesInText && span.type === "organization_name";
      for (const range of locateExtractionRanges(
        text,
        span,
        locateNeedlesInText,
        tokenMatch,
      )) {
        spans.push({
          group: "organization",
          type: span.type,
          start: range.start,
          end: range.end,
          title: `${label}: ${text.slice(range.start, range.end)}`,
        });
      }
    }
  }

  for (const mention of mentionPaints) {
    if (mention.start == null || mention.end == null) continue;
    if (mention.end <= mention.start) continue;
    spans.push({
      group: mention.group,
      type: mention.type,
      start: mention.start,
      end: mention.end,
      title: mention.title,
      unresolved: mention.unresolved,
      mentionId: mention.mentionId,
      resolvedId: mention.resolvedId,
      candidates: mention.candidates,
    });
  }

  if (input.project) {
    const orgSurfaces = collectOrgSurfaces(input.org, mentionPaints);
    const contractorKeys = new Set(
      input.project.contractors.map((value) => surfaceKey(value)).filter(Boolean),
    );

    for (const span of toProjectHighlightSpans(input.project)) {
      // Firm names belong to the organization group. Painting them as
      // project/contractor gives an orange PROJECT header with a Contractor
      // chip (e.g. bare "trace" in vendor mail).
      const asOrg =
        span.type === "contractor" ||
        (span.type === "project_name" &&
          (contractorKeys.has(surfaceKey(span.text)) ||
            surfaceMatchesAny(span.text, orgSurfaces)));

      if (asOrg) {
        if (mentionCoversSurface(orgMentions, span.text)) continue;
        for (const range of locateNameTokenPaintRanges(
          text,
          span.text,
          locateNeedlesInText,
        )) {
          pushOrganizationNameSpan(spans, text, range);
        }
        continue;
      }

      const label = PROJECT_HIGHLIGHT_LABELS[span.type] ?? span.type;
      const tokenMatch = span.type === "project_name";
      for (const range of locateExtractionRanges(
        text,
        span,
        locateNeedlesInText,
        tokenMatch,
      )) {
        spans.push({
          group: "project",
          type: span.type,
          start: range.start,
          end: range.end,
          title: `${label}: ${text.slice(range.start, range.end)}`,
        });
      }
    }
  }

  const focusQuote = input.focusQuote?.trim() ?? "";
  for (const event of input.events ?? []) {
    const quote = event.sourceQuote?.trim();
    if (!quote) continue;
    const range = locateSentenceQuoteRange(text, quote);
    if (!range) continue;
    const label = EVENT_HIGHLIGHT_LABELS[event.type] ?? event.type;
    spans.push({
      group: "event",
      type: event.type,
      start: range.start,
      end: range.end,
      title: `${label}: ${event.title}`,
      focus: Boolean(focusQuote) && quote.toLowerCase() === focusQuote.toLowerCase(),
    });
  }

  for (const todo of input.todos ?? []) {
    const quote = todo.sourceQuote?.trim();
    if (!quote) continue;
    const range = locateSentenceQuoteRange(text, quote);
    if (!range) continue;
    spans.push({
      group: "todo",
      type: "action_item",
      start: range.start,
      end: range.end,
      title: `To-do: ${todo.title}`,
      focus: Boolean(focusQuote) && quote.toLowerCase() === focusQuote.toLowerCase(),
    });
  }

  return spans.filter((span) => span.end > span.start);
}

export type HarvestMentionPayload = {
  org?: Array<{
    id: string;
    rawName: string;
    start: number | null;
    end: number | null;
    status: string;
    resolvedOrganizationId: string | null;
    candidates: Array<{ id: string; name: string }>;
  }>;
  contact?: Array<{
    id: string;
    rawName: string;
    start: number | null;
    end: number | null;
    status: string;
    resolvedPersonId: string | null;
    candidates: Array<{ id: string; name: string }>;
  }>;
};

export function harvestMentionPaintsFromPayload(
  payload?: HarvestMentionPayload | null,
  text?: string,
): HarvestMentionPaint[] {
  if (!payload) return [];
  const paints: HarvestMentionPaint[] = [];

  const locatedRanges = (
    start: number | null,
    end: number | null,
    surface: string,
  ): Array<{ start: number; end: number }> => {
    if (start != null && end != null && end > start) {
      return [{ start, end }];
    }
    if (!text) return [];
    const hits = findNameTokenRanges(text, surface);
    return hits.length === 1 ? hits : [];
  };

  for (const row of payload.org ?? []) {
    for (const range of locatedRanges(row.start, row.end, row.rawName)) {
      paints.push({
        group: "organization",
        type: "organization_name",
        start: range.start,
        end: range.end,
        title: `Organization: ${row.rawName}`,
        surface: row.rawName,
        unresolved: row.status === "unresolved",
        mentionId: row.id,
        resolvedId: row.resolvedOrganizationId,
        candidates: row.candidates,
      });
    }
  }
  for (const row of payload.contact ?? []) {
    for (const range of locatedRanges(row.start, row.end, row.rawName)) {
      paints.push({
        group: "contact",
        type: "contact_name",
        start: range.start,
        end: range.end,
        title: `Contact: ${row.rawName}`,
        surface: row.rawName,
        unresolved: row.status === "unresolved",
        mentionId: row.id,
        resolvedId: row.resolvedPersonId,
        candidates: row.candidates,
      });
    }
  }
  return paints;
}

/**
 * Locate mention surfaces in an arbitrary field (subject, not unique body).
 * Ignores stored body offsets — those are invalid outside the authored body.
 */
export function harvestMentionPaintsInText(
  payload: HarvestMentionPayload | null | undefined,
  text: string,
): HarvestMentionPaint[] {
  if (!payload || !text) return [];
  const paints: HarvestMentionPaint[] = [];
  for (const row of payload.org ?? []) {
    for (const range of findNameTokenRanges(text, row.rawName)) {
      paints.push({
        group: "organization",
        type: "organization_name",
        start: range.start,
        end: range.end,
        title: `Organization: ${row.rawName}`,
        surface: row.rawName,
        unresolved: row.status === "unresolved",
        mentionId: row.id,
        resolvedId: row.resolvedOrganizationId,
        candidates: row.candidates,
      });
    }
  }
  for (const row of payload.contact ?? []) {
    for (const range of findNameTokenRanges(text, row.rawName)) {
      paints.push({
        group: "contact",
        type: "contact_name",
        start: range.start,
        end: range.end,
        title: `Contact: ${row.rawName}`,
        surface: row.rawName,
        unresolved: row.status === "unresolved",
        mentionId: row.id,
        resolvedId: row.resolvedPersonId,
        candidates: row.candidates,
      });
    }
  }
  return paints;
}

/** Subject-line harvest marks: extraction needles + mentions, no body offsets. */
export function resolveSubjectHarvestSpans(input: {
  text: string;
  contact?: ContactHighlightExtraction | null;
  org?: OrgHighlightExtraction | null;
  project?: ProjectHighlightExtraction | null;
  mentions?: HarvestMentionPayload | null;
}): HarvestSpan[] {
  return resolveHarvestSpans({
    text: input.text,
    contact: input.contact,
    org: input.org,
    project: input.project,
    mentionPaints: harvestMentionPaintsInText(input.mentions, input.text),
    locateNeedlesInText: true,
  });
}
