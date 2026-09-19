import {
  buildAgendaOutlineTree,
  formatDiscussionTimestampRanges,
  mergeClosedIntervals,
  mergeTimestampRanges,
  type AgendaOutlineNode,
  type AgendaOutlineSourceItem,
  type TimestampRange,
} from "@/lib/meeting-v2/agenda-outline";
import { parseVttTimestampMs } from "@/lib/parsers/vtt";
import type { TranscriptSectionOverlay } from "@/lib/transcript/section-overlay";

export const GOLD_STANDARD_COMPARE_ID = "gold-standard";

export type SegmentGoldSpan = {
  agendaItemId: string;
  startSeconds: number;
  endSeconds: number;
  /** Inclusive cue row in segment-compare transcript; authoritative for labeling UI. */
  startCueIndex?: number;
  endCueIndex?: number;
};

export type GoldCueSegmentMeta = {
  sections: TranscriptSectionOverlay[];
  position: "solo" | "first" | "middle" | "last";
  showLabel: boolean;
  segmentStartsAtCue: boolean;
};

export type SegmentGoldStandard = {
  updatedAt: string;
  spans: SegmentGoldSpan[];
};

export type AgendaConceptRow = {
  id: string;
  code: string;
  title: string;
  isLeaf: boolean;
  depth: number;
};

export function overlayMatchKey(overlay: Pick<TranscriptSectionOverlay, "code" | "title" | "id">): string {
  const code = overlay.code.trim().toLowerCase();
  if (code) return `code:${code}`;
  const title = overlay.title.trim().toLowerCase();
  if (title) return `title:${title}`;
  return `id:${overlay.id}`;
}

function spanHasCueIndices(span: SegmentGoldSpan): boolean {
  return (
    typeof span.startCueIndex === "number" &&
    Number.isFinite(span.startCueIndex) &&
    typeof span.endCueIndex === "number" &&
    Number.isFinite(span.endCueIndex)
  );
}

export function resolveGoldSpanCueIndices(
  span: SegmentGoldSpan,
  cues: Array<{ start: string; end?: string }>,
): { lo: number; hi: number } {
  if (spanHasCueIndices(span)) {
    return {
      lo: Math.min(span.startCueIndex!, span.endCueIndex!),
      hi: Math.max(span.startCueIndex!, span.endCueIndex!),
    };
  }
  const start = Math.min(span.startSeconds, span.endSeconds);
  const end = Math.max(span.startSeconds, span.endSeconds);
  let lo = -1;
  let hi = -1;
  for (let index = 0; index < cues.length; index += 1) {
    const cueStart = cueSeconds(cues[index].start);
    const cueEnd = cueEndSeconds(cues[index]);
    const mid = (cueStart + cueEnd) / 2;
    if (mid >= start && mid <= end) {
      if (lo === -1) lo = index;
      hi = index;
    }
  }
  if (lo === -1) return { lo: 0, hi: 0 };
  return { lo, hi };
}

export function goldSpanFromCueIndexRange(
  agendaItemId: string,
  lo: number,
  hi: number,
  cues: Array<{ start: string; end?: string }>,
): SegmentGoldSpan {
  if (cues.length === 0) {
    return { agendaItemId, startCueIndex: 0, endCueIndex: 0, startSeconds: 0, endSeconds: 0 };
  }
  const startIndex = Math.max(0, Math.min(lo, hi, cues.length - 1));
  const endIndex = Math.max(0, Math.min(Math.max(lo, hi), cues.length - 1));
  const startCue = cues[startIndex];
  const endCue = cues[endIndex];
  return {
    agendaItemId,
    startCueIndex: startIndex,
    endCueIndex: endIndex,
    startSeconds: cueSeconds(startCue.start),
    endSeconds: cueEndSeconds(endCue),
  };
}

export function goldSpanCueRangesTouchOrOverlap(
  left: { lo: number; hi: number },
  right: { lo: number; hi: number },
): boolean {
  return !(left.hi + 1 < right.lo || right.hi + 1 < left.lo);
}

/** Which stored span owns a start/end resize handle on this cue row. */
export function findGoldSpanForEdge(
  spans: SegmentGoldSpan[],
  agendaItemId: string,
  cueIndex: number,
  edge: "start" | "end",
  cues: Array<{ start: string; end?: string }>,
): SegmentGoldSpan | undefined {
  return spans.find((span) => {
    if (span.agendaItemId !== agendaItemId) return false;
    const { lo, hi } = resolveGoldSpanCueIndices(span, cues);
    return edge === "start" ? cueIndex === lo : cueIndex === hi;
  });
}

/** Add a span; drop same-item spans that overlap or touch the new cue range, then normalize. */
export function addGoldSpanReplacingOverlaps(
  spans: SegmentGoldSpan[],
  newSpan: SegmentGoldSpan,
  cues: Array<{ start: string; end?: string }>,
): SegmentGoldSpan[] {
  const nextRange = resolveGoldSpanCueIndices(newSpan, cues);
  const kept = spans.filter((span) => {
    if (span.agendaItemId !== newSpan.agendaItemId) return true;
    const range = resolveGoldSpanCueIndices(span, cues);
    return !goldSpanCueRangesTouchOrOverlap(range, nextRange);
  });
  return mergeGoldSpans([...kept, newSpan]);
}

function spanCueIndexRange(span: SegmentGoldSpan): { lo: number; hi: number } {
  return {
    lo: Math.min(span.startCueIndex!, span.endCueIndex!),
    hi: Math.max(span.startCueIndex!, span.endCueIndex!),
  };
}

function spanFromCueIndexRangeWithoutCues(
  agendaItemId: string,
  lo: number,
  hi: number,
  secondsFrom: SegmentGoldSpan[],
): SegmentGoldSpan {
  const startSeconds = Math.min(
    ...secondsFrom.map((span) => Math.min(span.startSeconds, span.endSeconds)),
  );
  const endSeconds = Math.max(
    ...secondsFrom.map((span) => Math.max(span.startSeconds, span.endSeconds)),
  );
  return {
    agendaItemId,
    startCueIndex: lo,
    endCueIndex: hi,
    startSeconds,
    endSeconds,
  };
}

function mergeItemGoldSpansByCueIndex(
  agendaItemId: string,
  itemSpans: SegmentGoldSpan[],
): SegmentGoldSpan[] {
  const sorted = [...itemSpans].sort((left, right) => {
    const l = spanCueIndexRange(left);
    const r = spanCueIndexRange(right);
    return l.lo - r.lo || l.hi - r.hi;
  });
  const merged: SegmentGoldSpan[] = [];
  for (const span of sorted) {
    const range = spanCueIndexRange(span);
    const last = merged[merged.length - 1];
    if (last) {
      const lastRange = spanCueIndexRange(last);
      if (goldSpanCueRangesTouchOrOverlap(lastRange, range)) {
        const lo = Math.min(lastRange.lo, range.lo);
        const hi = Math.max(lastRange.hi, range.hi);
        const contributors = itemSpans.filter((entry) => {
          const entryRange = spanCueIndexRange(entry);
          return goldSpanCueRangesTouchOrOverlap(entryRange, { lo, hi });
        });
        merged[merged.length - 1] = spanFromCueIndexRangeWithoutCues(
          agendaItemId,
          lo,
          hi,
          contributors.length > 0 ? contributors : [last, span],
        );
        continue;
      }
    }
    merged.push(spanFromCueIndexRangeWithoutCues(agendaItemId, range.lo, range.hi, [span]));
  }
  return merged;
}

function mergeItemGoldSpansByTime(
  agendaItemId: string,
  itemSpans: SegmentGoldSpan[],
): SegmentGoldSpan[] {
  const ranges = itemSpans.map((span) => ({
    startSeconds: Math.min(span.startSeconds, span.endSeconds),
    endSeconds: Math.max(span.startSeconds, span.endSeconds),
  }));
  const mergedRanges = mergeTimestampRanges(ranges);
  const merged: SegmentGoldSpan[] = [];
  for (const range of mergedRanges) {
    const contributors = itemSpans.filter((span) => {
      const start = Math.min(span.startSeconds, span.endSeconds);
      const end = Math.max(span.startSeconds, span.endSeconds);
      return start <= range.endSeconds && end >= range.startSeconds;
    });
    const withIndices = contributors.filter(spanHasCueIndices);
    let startCueIndex: number | undefined;
    let endCueIndex: number | undefined;
    if (withIndices.length > 0) {
      startCueIndex = Math.min(...withIndices.map((span) => Math.min(span.startCueIndex!, span.endCueIndex!)));
      endCueIndex = Math.max(...withIndices.map((span) => Math.max(span.startCueIndex!, span.endCueIndex!)));
    } else if (contributors.length === 1 && spanHasCueIndices(contributors[0]!)) {
      startCueIndex = contributors[0]!.startCueIndex;
      endCueIndex = contributors[0]!.endCueIndex;
    }
    merged.push({
      agendaItemId,
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
      startCueIndex,
      endCueIndex,
    });
  }
  return merged;
}

function sectionSetKey(sections: TranscriptSectionOverlay[]): string {
  return sections
    .map((section) => section.id)
    .sort()
    .join("|");
}

/** Gold column segment meta from explicit cue-index spans (not time-overlap bleed). */
export function buildGoldLabelCueSegmentMeta(
  cues: Array<{ start: string; end?: string }>,
  concepts: AgendaConceptRow[],
  spans: SegmentGoldSpan[],
): GoldCueSegmentMeta[] {
  const cueCount = cues.length;
  const emptyMeta = (): GoldCueSegmentMeta => ({
    sections: [],
    position: "solo",
    showLabel: false,
    segmentStartsAtCue: false,
  });
  if (cueCount === 0) return [];

  const byConcept = new Map(concepts.map((concept) => [concept.id, concept]));
  const sectionsAt: TranscriptSectionOverlay[][] = Array.from({ length: cueCount }, () => []);

  for (const span of mergeGoldSpans(spans)) {
    const concept = byConcept.get(span.agendaItemId);
    if (!concept?.isLeaf) continue;
    const { lo, hi } = resolveGoldSpanCueIndices(span, cues);
    const overlay: TranscriptSectionOverlay = {
      id: concept.id,
      code: concept.code,
      title: concept.title,
      startSeconds: Math.min(span.startSeconds, span.endSeconds),
      endSeconds: Math.max(span.startSeconds, span.endSeconds),
    };
    for (let index = lo; index <= hi && index < cueCount; index += 1) {
      const existing = sectionsAt[index];
      if (existing.some((section) => section.id === overlay.id)) continue;
      sectionsAt[index] = [...existing, overlay];
    }
  }

  const meta = Array.from({ length: cueCount }, emptyMeta);
  let groupStart = 0;
  const finalizeGroup = (start: number, end: number) => {
    const count = end - start + 1;
    for (let offset = 0; offset < count; offset += 1) {
      const index = start + offset;
      const sections = sectionsAt[index];
      let position: GoldCueSegmentMeta["position"];
      if (count === 1) position = "solo";
      else if (offset === 0) position = "first";
      else if (offset === count - 1) position = "last";
      else position = "middle";
      meta[index] = {
        sections,
        position,
        showLabel: sections.length > 0 && offset === 0,
        segmentStartsAtCue: offset === 0,
      };
    }
  };

  for (let index = 1; index < cueCount; index += 1) {
    if (sectionSetKey(sectionsAt[index]) !== sectionSetKey(sectionsAt[index - 1])) {
      finalizeGroup(groupStart, index - 1);
      groupStart = index;
    }
  }
  finalizeGroup(groupStart, cueCount - 1);
  return meta;
}

export function goldCueCoverageForSpan(
  span: SegmentGoldSpan,
  cues: Array<{ start: string; end?: string }>,
  cueCount: number,
): boolean[] {
  const { lo, hi } = resolveGoldSpanCueIndices(span, cues);
  return Array.from({ length: cueCount }, (_, index) => index >= lo && index <= hi);
}

export function mergeGoldSpans(spans: SegmentGoldSpan[]): SegmentGoldSpan[] {
  const byItem = new Map<string, SegmentGoldSpan[]>();
  for (const span of spans) {
    if (!span.agendaItemId || !Number.isFinite(span.startSeconds) || !Number.isFinite(span.endSeconds)) {
      continue;
    }
    const list = byItem.get(span.agendaItemId) ?? [];
    list.push(span);
    byItem.set(span.agendaItemId, list);
  }
  const merged: SegmentGoldSpan[] = [];
  for (const [agendaItemId, itemSpans] of byItem) {
    if (itemSpans.every(spanHasCueIndices)) {
      merged.push(...mergeItemGoldSpansByCueIndex(agendaItemId, itemSpans));
    } else {
      merged.push(...mergeItemGoldSpansByTime(agendaItemId, itemSpans));
    }
  }
  merged.sort((left, right) => {
    if (left.startSeconds !== right.startSeconds) return left.startSeconds - right.startSeconds;
    return left.endSeconds - right.endSeconds;
  });
  return merged;
}

export function normalizeSegmentGoldStandard(
  value: SegmentGoldStandard | null | undefined,
  allowedItemIds?: Set<string>,
): SegmentGoldStandard | null {
  if (!value || !Array.isArray(value.spans)) return null;
  const filtered = mergeGoldSpans(
    allowedItemIds
      ? value.spans.filter((span) => allowedItemIds.has(span.agendaItemId))
      : value.spans,
  );
  if (filtered.length === 0 && (!value.spans || value.spans.length === 0)) {
    return {
      updatedAt: value.updatedAt || new Date().toISOString(),
      spans: [],
    };
  }
  return {
    updatedAt: value.updatedAt || new Date().toISOString(),
    spans: filtered,
  };
}

export function agendaConceptRows<T extends AgendaOutlineSourceItem & { title?: string | null }>(
  items: T[],
): AgendaConceptRow[] {
  const tree = buildAgendaOutlineTree(items);
  const rows: AgendaConceptRow[] = [];
  const walk = (nodes: Array<AgendaOutlineNode<T>>, depth: number) => {
    for (const node of nodes) {
      rows.push({
        id: node.item.id,
        code: (node.item.itemNumber || "").trim() || node.displayNumber,
        title: (node.item.title || "").trim(),
        isLeaf: node.children.length === 0,
        depth,
      });
      walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return rows;
}

export function overlaysFromGoldSpans(
  concepts: AgendaConceptRow[],
  spans: SegmentGoldSpan[],
): TranscriptSectionOverlay[] {
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  const overlays: TranscriptSectionOverlay[] = [];
  for (const span of mergeGoldSpans(spans)) {
    const concept = byId.get(span.agendaItemId);
    if (!concept || !concept.isLeaf) continue;
    overlays.push({
      id: concept.id,
      code: concept.code,
      title: concept.title,
      startSeconds: span.startSeconds,
      endSeconds: span.endSeconds,
    });
  }
  overlays.sort((left, right) => {
    if (left.startSeconds !== right.startSeconds) return left.startSeconds - right.startSeconds;
    return left.endSeconds - right.endSeconds;
  });
  return overlays;
}

function coveredSeconds(ranges: TimestampRange[]): number {
  return mergeTimestampRanges(ranges).reduce(
    (sum, range) => sum + Math.max(0, range.endSeconds - range.startSeconds),
    0,
  );
}

function intersectionSeconds(left: TimestampRange[], right: TimestampRange[]): number {
  const a = mergeTimestampRanges(left);
  const b = mergeTimestampRanges(right);
  let total = 0;
  for (const leftRange of a) {
    for (const rightRange of b) {
      const start = Math.max(leftRange.startSeconds, rightRange.startSeconds);
      const end = Math.min(leftRange.endSeconds, rightRange.endSeconds);
      total += Math.max(0, end - start);
    }
  }
  return total;
}

function groupOverlayRanges(
  overlays: TranscriptSectionOverlay[],
): Map<string, TimestampRange[]> {
  const grouped = new Map<string, TimestampRange[]>();
  for (const overlay of overlays) {
    const key = overlayMatchKey(overlay);
    const list = grouped.get(key) ?? [];
    list.push({ startSeconds: overlay.startSeconds, endSeconds: overlay.endSeconds });
    grouped.set(key, list);
  }
  return grouped;
}

export type GoldOverlayScore = {
  meanIou: number;
  itemCount: number;
  labeledGoldItems: number;
};

export function scoreOverlaysAgainstGold(
  predicted: TranscriptSectionOverlay[],
  gold: TranscriptSectionOverlay[],
): GoldOverlayScore | null {
  if (gold.length === 0) return null;
  const goldGroups = groupOverlayRanges(gold);
  const predictedGroups = groupOverlayRanges(predicted);
  const keys = new Set([...goldGroups.keys(), ...predictedGroups.keys()]);
  if (keys.size === 0) return null;
  let sum = 0;
  for (const key of keys) {
    const goldRanges = goldGroups.get(key) ?? [];
    const predictedRanges = predictedGroups.get(key) ?? [];
    const inter = intersectionSeconds(goldRanges, predictedRanges);
    const union = coveredSeconds(goldRanges) + coveredSeconds(predictedRanges) - inter;
    sum += union > 0 ? inter / union : goldRanges.length === 0 && predictedRanges.length === 0 ? 1 : 0;
  }
  return {
    meanIou: sum / keys.size,
    itemCount: keys.size,
    labeledGoldItems: goldGroups.size,
  };
}

export function formatGoldScorePercent(score: GoldOverlayScore | null): string | null {
  if (!score) return null;
  return `${Math.round(score.meanIou * 100)}%`;
}

export function cueSeconds(timestamp: string): number {
  return parseVttTimestampMs(timestamp) / 1000;
}

function cueEndSeconds(cue: { start: string; end?: string }): number {
  return cueSeconds(cue.end ?? cue.start);
}

/** Full grid-row bands so a tall row (long text) still maps to one cue while resizing. */
export function expandGoldCueHitBoxes(
  boxes: Array<{ index: number; top: number; bottom: number }>,
): Array<{ index: number; top: number; bottom: number }> {
  const sorted = boxes
    .filter((entry) => Number.isFinite(entry.index))
    .sort((left, right) => left.index - right.index);
  if (sorted.length === 0) return [];
  return sorted.map((box, offset) => {
    const previous = sorted[offset - 1];
    const next = sorted[offset + 1];
    const top = previous ? (previous.bottom + box.top) / 2 : box.top;
    const bottom = next ? (box.bottom + next.top) / 2 : box.bottom;
    return { index: box.index, top, bottom };
  });
}

/** Map a pointer Y to a cue when dragging a gold-span start or end handle. */
export function goldCueIndexFromBoxes(
  clientY: number,
  edge: "start" | "end",
  boxes: Array<{ index: number; top: number; bottom: number }>,
): number | null {
  const indexed = boxes
    .filter((entry) => Number.isFinite(entry.index))
    .sort((left, right) => left.index - right.index);
  if (indexed.length === 0) return null;

  const rawContaining = indexed.filter(
    ({ top, bottom }) => clientY >= top && clientY <= bottom,
  );
  if (rawContaining.length > 0) {
    const indexes = rawContaining.map((entry) => entry.index);
    return edge === "end" ? Math.min(...indexes) : Math.max(...indexes);
  }

  if (edge === "end") {
    const bands = expandGoldCueHitBoxes(indexed);
    const inBand = bands.find(({ top, bottom }) => clientY >= top && clientY <= bottom);
    if (inBand) return inBand.index;
    const above = [...bands].reverse().find((entry) => clientY > entry.bottom);
    const below = bands.find((entry) => clientY < entry.top);
    return above?.index ?? below?.index ?? null;
  }

  const below = indexed.find((entry) => clientY < entry.top);
  const above = [...indexed].reverse().find((entry) => clientY > entry.bottom);
  return below?.index ?? above?.index ?? null;
}

export type GoldSpanEdge = "start" | "end" | "both" | "none";
export type GoldSpanBorderRole = "none" | "solo" | "first" | "middle" | "last";

export type GoldResizeHandles = {
  startAgendaItemId: string | null;
  endAgendaItemId: string | null;
};

/** Per-item first/last cue, so nested or identical spans are not collapsed to the overlay group box. */
export function goldSpanEdgeAtIndex(index: number, covered: boolean[]): GoldSpanEdge {
  if (!covered[index]) return "none";
  const prev = index > 0 && covered[index - 1];
  const next = index < covered.length - 1 && covered[index + 1];
  if (!prev && !next) return "both";
  if (!prev) return "start";
  if (!next) return "end";
  return "none";
}

export function goldSpanBorderRoleAtIndex(index: number, covered: boolean[]): GoldSpanBorderRole {
  if (!covered[index]) return "none";
  const prev = index > 0 && covered[index - 1];
  const next = index < covered.length - 1 && covered[index + 1];
  if (!prev && !next) return "solo";
  if (!prev) return "first";
  if (!next) return "last";
  return "middle";
}

function pickResizeItemId(candidates: string[], preferredId: string | null): string | null {
  if (candidates.length === 0) return null;
  if (preferredId && candidates.includes(preferredId)) return preferredId;
  return candidates[0] ?? null;
}

/**
 * Resize hit targets for one cue. When the selected leaf has no span yet, suppress
 * every handle so a click can start an overlapping range inside an existing box.
 */
export function goldResizeHandlesAtCue(options: {
  cueIndex: number;
  coverageByItem: Map<string, boolean[]>;
  preferredAgendaItemId: string | null;
  suppressHandles: boolean;
}): GoldResizeHandles {
  if (options.suppressHandles) {
    return { startAgendaItemId: null, endAgendaItemId: null };
  }
  const startCandidates: string[] = [];
  const endCandidates: string[] = [];
  for (const [agendaItemId, covered] of options.coverageByItem) {
    const edge = goldSpanEdgeAtIndex(options.cueIndex, covered);
    if (edge === "start" || edge === "both") startCandidates.push(agendaItemId);
    if (edge === "end" || edge === "both") endCandidates.push(agendaItemId);
  }
  return {
    startAgendaItemId: pickResizeItemId(startCandidates, options.preferredAgendaItemId),
    endAgendaItemId: pickResizeItemId(endCandidates, options.preferredAgendaItemId),
  };
}

export function sequenceRangesForTimeSpans(
  spans: Array<{ startSeconds: number; endSeconds: number; startCueIndex?: number; endCueIndex?: number }>,
  segments: Array<{ sequence: number; startTimestamp: string; endTimestamp: string }>,
  cues?: Array<{ start: string; end?: string }>,
): Array<[number, number]> {
  const hits: Array<[number, number]> = [];
  for (const span of spans) {
    if (
      cues &&
      typeof span.startCueIndex === "number" &&
      typeof span.endCueIndex === "number"
    ) {
      const lo = Math.min(span.startCueIndex, span.endCueIndex);
      const hi = Math.max(span.startCueIndex, span.endCueIndex);
      const sequences = new Set<number>();
      for (let index = lo; index <= hi && index < cues.length; index += 1) {
        const cueStart = cueSeconds(cues[index]!.start);
        const cueEnd = cueEndSeconds(cues[index]!);
        for (const segment of segments) {
          const segmentStart = cueSeconds(segment.startTimestamp);
          const segmentEnd = cueSeconds(segment.endTimestamp);
          const segmentMid = (segmentStart + segmentEnd) / 2;
          if (segmentMid >= cueStart && segmentMid <= cueEnd) {
            sequences.add(segment.sequence);
          }
        }
      }
      if (sequences.size > 0) {
        hits.push([Math.min(...sequences), Math.max(...sequences)]);
        continue;
      }
    }
    const start = Math.min(span.startSeconds, span.endSeconds);
    const end = Math.max(span.startSeconds, span.endSeconds);
    const spanDur = end - start;
    const matched = segments
      .filter((segment) => {
        const segmentStart = cueSeconds(segment.startTimestamp);
        const segmentEnd = cueSeconds(segment.endTimestamp);
        const segDur = Math.max(0.001, segmentEnd - segmentStart);
        const interStart = Math.max(segmentStart, start);
        const interEnd = Math.min(segmentEnd, end);
        const inter = interEnd - interStart;
        if (inter <= 0) return false;
        const segMid = (segmentStart + segmentEnd) / 2;
        if (segMid >= start && segMid <= end) return true;
        return inter >= segDur * 0.5 || (spanDur > 0 && inter >= spanDur * 0.5);
      })
      .map((segment) => segment.sequence);
    if (matched.length === 0) continue;
    hits.push([Math.min(...matched), Math.max(...matched)]);
  }
  return mergeClosedIntervals(hits);
}

export function unionChildSequenceRanges<T extends AgendaOutlineSourceItem>(
  items: T[],
  rangesById: Map<string, Array<[number, number]>>,
): Map<string, Array<[number, number]>> {
  const tree = buildAgendaOutlineTree(items);
  const next = new Map(rangesById);
  const walk = (node: AgendaOutlineNode<T>): Array<[number, number]> => {
    const childUnion = node.children.flatMap((child) => walk(child));
    const own = next.get(node.item.id) ?? [];
    const merged = mergeClosedIntervals([...own, ...childUnion]);
    next.set(node.item.id, merged);
    return merged;
  };
  for (const node of tree) walk(node);
  return next;
}

export function discussionTimingFromSpans(
  spans: Array<{ startSeconds: number; endSeconds: number }>,
): string | null {
  return formatDiscussionTimestampRanges(
    spans.map((span) => ({
      startSeconds: Math.min(span.startSeconds, span.endSeconds),
      endSeconds: Math.max(span.startSeconds, span.endSeconds),
    })),
  );
}
