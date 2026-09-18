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

export function mergeGoldSpans(spans: SegmentGoldSpan[]): SegmentGoldSpan[] {
  const byItem = new Map<string, TimestampRange[]>();
  for (const span of spans) {
    if (!span.agendaItemId || !Number.isFinite(span.startSeconds) || !Number.isFinite(span.endSeconds)) {
      continue;
    }
    const start = Math.min(span.startSeconds, span.endSeconds);
    const end = Math.max(span.startSeconds, span.endSeconds);
    const list = byItem.get(span.agendaItemId) ?? [];
    list.push({ startSeconds: start, endSeconds: end });
    byItem.set(span.agendaItemId, list);
  }
  const merged: SegmentGoldSpan[] = [];
  for (const [agendaItemId, ranges] of byItem) {
    for (const range of mergeTimestampRanges(ranges)) {
      merged.push({
        agendaItemId,
        startSeconds: range.startSeconds,
        endSeconds: range.endSeconds,
      });
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

  const containing = indexed.filter(
    ({ top, bottom }) => clientY >= top && clientY <= bottom,
  );
  if (containing.length > 0) {
    const indexes = containing.map((entry) => entry.index);
    // Shared pixel on two stacked boxes: keep end on the upper cue, start on the lower.
    return edge === "end" ? Math.min(...indexes) : Math.max(...indexes);
  }

  const above = [...indexed].reverse().find((entry) => clientY > entry.bottom);
  const below = indexed.find((entry) => clientY < entry.top);
  // Padding between boxes is not a cue. End-drag stays on the cue above;
  // start-drag stays on the cue below so a few pixels off the handle cannot jump a row.
  if (edge === "end") return above?.index ?? below?.index ?? null;
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
  spans: Array<{ startSeconds: number; endSeconds: number }>,
  segments: Array<{ sequence: number; startTimestamp: string; endTimestamp: string }>,
): Array<[number, number]> {
  const hits: Array<[number, number]> = [];
  for (const span of spans) {
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
