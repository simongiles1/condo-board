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

/** First match of a verbatim or whitespace-flexible quote. */
export function findFlexibleQuoteRange(
  text: string,
  quote: string,
): { start: number; end: number } | null {
  const needle = quote.trim();
  if (!needle) return null;

  const direct = text.toLowerCase().indexOf(needle.toLowerCase());
  if (direct >= 0) return { start: direct, end: direct + needle.length };

  const words = needle.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const pattern = words.map(escapeRegExp).join("\\s+");
  const match = text.match(new RegExp(pattern, "i"));
  if (!match || match.index == null) return null;
  return { start: match.index, end: match.index + match[0].length };
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

export function resolveHarvestSpans(input: {
  text: string;
  contact?: ContactHighlightExtraction | null;
  org?: OrgHighlightExtraction | null;
  events?: HarvestEventHighlight[];
  todos?: HarvestTodoHighlight[];
  focusQuote?: string | null;
}): HarvestSpan[] {
  const spans: HarvestSpan[] = [];
  const { text } = input;
  if (!text) return spans;

  if (input.contact) {
    for (const span of toHighlightSpans(input.contact)) {
      const label = CONTACT_HIGHLIGHT_LABELS[span.type] ?? span.type;
      if (span.start != null && span.end != null) {
        spans.push({
          group: "contact",
          type: span.type,
          start: span.start,
          end: span.end,
          title: `${label}: ${text.slice(span.start, span.end)}`,
        });
        continue;
      }
      for (const range of findAllSubstringRanges(text, span.text)) {
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
      if (span.start != null && span.end != null) {
        spans.push({
          group: "organization",
          type: span.type,
          start: span.start,
          end: span.end,
          title: `${label}: ${text.slice(span.start, span.end)}`,
        });
        continue;
      }
      for (const range of findAllSubstringRanges(text, span.text)) {
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

  const focusQuote = input.focusQuote?.trim() ?? "";
  for (const event of input.events ?? []) {
    const quote = event.sourceQuote?.trim();
    if (!quote) continue;
    const range = findFlexibleQuoteRange(text, quote);
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
    const range = findFlexibleQuoteRange(text, quote);
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
