/**
 * Coverage of a reviewed transcript segmentation.
 * A heading with spanned children is not a missing item. A cue in two items is.
 */

import { formatDiscussionTimestampRanges } from "@/lib/meeting-v2/agenda-outline";
import {
  resolveGoldSpanCueIndices,
  type SegmentGoldSpan,
} from "@/lib/meeting-v2/segment-gold-standard";

/** One transcript row in the order used by the segment-compare cue index. */
export type MeetingsV4InventoryCue = {
  index: number;
  start: string;
  end: string;
  speaker: string;
  text: string;
};

/** An agenda row the inventory can classify as a leaf or a heading. */
export type MeetingsV4InventoryItem = {
  id: string;
  itemNumber: string;
  title: string;
};

/** One reviewed span as the segmentation stage shows it. */
export type MeetingsV4SpanPreview = {
  agendaItemId: string;
  itemNumber: string;
  title: string;
  startCueIndex: number;
  endCueIndex: number;
  cueCount: number;
  rangeLabel: string;
  speakers: string;
  opening: string;
};

/** Coverage of the reviewed spans against the agenda and the transcript. */
export type MeetingsV4Inventory = {
  spans: MeetingsV4SpanPreview[];
  items: Array<{
    id: string;
    itemNumber: string;
    title: string;
    spanCount: number;
    cueCount: number;
    returnCount: number;
    heading: boolean;
  }>;
  missingLeaves: Array<{ id: string; itemNumber: string; title: string }>;
  unassignedCues: Array<{ index: number; start: string; speaker: string; preview: string }>;
  overlappingCues: Array<{ index: number; start: string; itemNumbers: string[] }>;
};

/**
 * Builds the segmentation preview and the coverage check.
 * Cue indexes follow the transcript array. A later span on the same item is a return.
 */
export function inventoryMeetingsV4(input: {
  items: readonly MeetingsV4InventoryItem[];
  cues: readonly MeetingsV4InventoryCue[];
  spans: readonly SegmentGoldSpan[];
}): MeetingsV4Inventory {
  const itemsById = new Map(input.items.map((item) => [item.id, item]));
  const headingIds = headingItemIds(input.items);
  const ranges = input.spans.map((span) => ({
    span,
    range: resolveGoldSpanCueIndices(span, [...input.cues]),
  }));
  const spans = ranges
    .map(({ span, range }) => previewSpan(span, range, input.cues, itemsById))
    .sort((left, right) => left.startCueIndex - right.startCueIndex || left.itemNumber.localeCompare(right.itemNumber));

  const byItem = new Map<string, { spanCount: number; cues: Set<number> }>();
  for (const item of input.items) byItem.set(item.id, { spanCount: 0, cues: new Set() });
  for (const { span, range } of ranges) {
    const bucket = byItem.get(span.agendaItemId);
    if (!bucket) continue;
    bucket.spanCount += 1;
    for (let index = range.lo; index <= range.hi; index += 1) bucket.cues.add(index);
  }

  const owners = new Map<number, Set<string>>();
  for (const { span, range } of ranges) {
    if (!itemsById.has(span.agendaItemId)) continue;
    for (let index = range.lo; index <= range.hi; index += 1) {
      const set = owners.get(index) ?? new Set<string>();
      set.add(span.agendaItemId);
      owners.set(index, set);
    }
  }

  const items = input.items.map((item) => {
    const bucket = byItem.get(item.id)!;
    return {
      id: item.id,
      itemNumber: item.itemNumber,
      title: item.title,
      spanCount: bucket.spanCount,
      cueCount: bucket.cues.size,
      returnCount: Math.max(0, bucket.spanCount - 1),
      heading: headingIds.has(item.id),
    };
  });

  return {
    spans,
    items,
    missingLeaves: items
      .filter((item) => !item.heading && item.cueCount === 0)
      .map((item) => ({ id: item.id, itemNumber: item.itemNumber, title: item.title })),
    unassignedCues: input.cues
      .filter((cue) => !owners.has(cue.index))
      .map((cue) => ({
        index: cue.index,
        start: cue.start,
        speaker: cue.speaker,
        preview: cue.text.replace(/\s+/g, " ").trim().slice(0, 160),
      })),
    overlappingCues: input.cues.flatMap((cue) => {
      const ids = [...(owners.get(cue.index) ?? [])];
      if (ids.length < 2) return [];
      return [{
        index: cue.index,
        start: cue.start,
        itemNumbers: ids.map((id) => itemsById.get(id)?.itemNumber || id),
      }];
    }),
  };
}

/**
 * Transcript cues assigned to one agenda item, in cue order.
 * Later returns stay in the same list. Speakers and timestamps are kept.
 */
export function bundleCuesForItem(
  agendaItemId: string,
  cues: readonly MeetingsV4InventoryCue[],
  spans: readonly SegmentGoldSpan[],
): MeetingsV4InventoryCue[] {
  const indexes = new Set<number>();
  for (const span of spans) {
    if (span.agendaItemId !== agendaItemId) continue;
    const range = resolveGoldSpanCueIndices(span, [...cues]);
    for (let index = range.lo; index <= range.hi; index += 1) indexes.add(index);
  }
  return cues.filter((cue) => indexes.has(cue.index));
}

function headingItemIds(items: readonly MeetingsV4InventoryItem[]): Set<string> {
  const numbers = items.map((item) => item.itemNumber.trim()).filter(Boolean);
  const headings = new Set<string>();
  for (const item of items) {
    const number = item.itemNumber.trim();
    if (!number) continue;
    if (numbers.some((other) => other.startsWith(`${number}.`))) headings.add(item.id);
  }
  return headings;
}

function previewSpan(
  span: SegmentGoldSpan,
  range: { lo: number; hi: number },
  cues: readonly MeetingsV4InventoryCue[],
  itemsById: Map<string, MeetingsV4InventoryItem>,
): MeetingsV4SpanPreview {
  const item = itemsById.get(span.agendaItemId);
  const slice = cues.filter((cue) => cue.index >= range.lo && cue.index <= range.hi);
  const speakers = [...new Set(slice.map((cue) => cue.speaker.trim()).filter(Boolean))];
  const startSeconds = span.startSeconds;
  const endSeconds = span.endSeconds;
  return {
    agendaItemId: span.agendaItemId,
    itemNumber: item?.itemNumber ?? "",
    title: item?.title ?? "Unknown item",
    startCueIndex: range.lo,
    endCueIndex: range.hi,
    cueCount: slice.length,
    rangeLabel: formatDiscussionTimestampRanges([{ startSeconds, endSeconds }]) ?? "",
    speakers: speakers.slice(0, 4).join(", "),
    opening: (slice[0]?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
  };
}
