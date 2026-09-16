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

export function sequenceRangesForTimeSpans(
  spans: Array<{ startSeconds: number; endSeconds: number }>,
  segments: Array<{ sequence: number; startTimestamp: string; endTimestamp: string }>,
): Array<[number, number]> {
  const hits: Array<[number, number]> = [];
  for (const span of spans) {
    const start = Math.min(span.startSeconds, span.endSeconds);
    const end = Math.max(span.startSeconds, span.endSeconds);
    const matched = segments
      .filter((segment) => {
        const segmentStart = cueSeconds(segment.startTimestamp);
        const segmentEnd = cueSeconds(segment.endTimestamp);
        return segmentStart <= end && segmentEnd >= start;
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
