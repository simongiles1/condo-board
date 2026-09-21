/**
 * Hierarchical agenda outline codes (1, 1.A, 4.A.1, 4.D.a, 4.E).
 * Client-safe: no Node or database imports.
 */

export type AgendaListMarker = "decimal" | "upper-alpha" | "lower-alpha";

export type OutlineSegment = {
  raw: string;
  kind: "number" | "letter";
  rank: number;
};

export type ParsedAgendaItemCode = {
  segments: OutlineSegment[];
  raw: string;
};

export type AgendaOutlineSourceItem = {
  id: string;
  itemNumber: string | null;
  title?: string | null;
};

export type AgendaOutlineNode<T extends AgendaOutlineSourceItem> = {
  item: T;
  displayNumber: string;
  listMarker: AgendaListMarker;
  children: Array<AgendaOutlineNode<T>>;
  discussionTiming?: string | null;
};

const LETTERED_LEAF_SECTION = /\.[DE]$/i;

export function parseAgendaItemCode(value: string | null | undefined): ParsedAgendaItemCode {
  const raw = (value || "").trim();
  if (!raw) {
    return { segments: [], raw };
  }

  const segments: OutlineSegment[] = raw
    .split(/[.\s-]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (/^\d+$/.test(part)) {
        return { raw: part, kind: "number" as const, rank: Number.parseInt(part, 10) };
      }
      if (/^[A-Za-z]+$/.test(part)) {
        const upper = part.toUpperCase();
        let rank = 0;
        for (const ch of upper) {
          rank = rank * 26 + (ch.charCodeAt(0) - 64);
        }
        return { raw: part, kind: "letter" as const, rank };
      }
      const numeric = Number.parseFloat(part);
      if (!Number.isNaN(numeric)) {
        return { raw: part, kind: "number" as const, rank: Math.floor(numeric) };
      }
      return { raw: part, kind: "letter" as const, rank: Number.MAX_SAFE_INTEGER };
    });

  return { segments, raw };
}

export function compareAgendaItemCodes(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const a = parseAgendaItemCode(left);
  const b = parseAgendaItemCode(right);
  if (a.segments.length === 0 && b.segments.length === 0) return 0;
  if (a.segments.length === 0) return 1;
  if (b.segments.length === 0) return -1;

  const len = Math.max(a.segments.length, b.segments.length);
  for (let i = 0; i < len; i += 1) {
    const leftSeg = a.segments[i];
    const rightSeg = b.segments[i];
    if (!leftSeg) return -1;
    if (!rightSeg) return 1;
    if (leftSeg.kind !== rightSeg.kind) {
      return leftSeg.kind === "number" ? -1 : 1;
    }
    if (leftSeg.rank !== rightSeg.rank) return leftSeg.rank - rightSeg.rank;
  }
  return 0;
}

export function parentAgendaItemCode(value: string | null | undefined): string | null {
  const parsed = parseAgendaItemCode(value);
  if (parsed.segments.length < 2) return null;
  return parsed.segments
    .slice(0, -1)
    .map((segment) => segment.raw)
    .join(".");
}

export function alphaLabel(index: number, uppercase = false): string {
  if (index < 0) return uppercase ? "A" : "a";
  if (index < 26) {
    return String.fromCharCode((uppercase ? 65 : 97) + index);
  }
  return String(index + 1);
}

export function isLetteredLeafSection(sectionCode: string): boolean {
  return LETTERED_LEAF_SECTION.test(sectionCode.trim());
}

export function canonicalLeafItemCode(
  sectionCode: string,
  index: number,
  extractedCode?: string | null,
): string {
  const lettered = isLetteredLeafSection(sectionCode);
  const extracted = extractedCode?.trim();
  if (extracted) {
    const parsed = parseAgendaItemCode(extracted);
    const last = parsed.segments[parsed.segments.length - 1];
    if (lettered && last?.kind === "number") {
      return `${sectionCode}.${alphaLabel(Math.max(0, last.rank - 1))}`;
    }
    if (lettered && last?.kind === "letter") {
      return `${sectionCode}.${last.raw.toLowerCase()}`;
    }
    if (!lettered && last?.kind === "number") {
      return `${sectionCode}.${last.raw}`;
    }
    return extracted.startsWith(`${sectionCode}.`) || extracted === sectionCode
      ? extracted
      : `${sectionCode}.${extracted}`;
  }
  if (lettered) return `${sectionCode}.${alphaLabel(index)}`;
  return `${sectionCode}.${index + 1}`;
}

export function listMarkerForSegment(segment: OutlineSegment | undefined): AgendaListMarker {
  if (!segment) return "decimal";
  if (segment.kind === "number") return "decimal";
  return /[A-Z]/.test(segment.raw) && segment.raw === segment.raw.toUpperCase()
    ? "upper-alpha"
    : "lower-alpha";
}

export function displayAgendaSegment(value: string | null | undefined): string {
  const parsed = parseAgendaItemCode(value);
  const last = parsed.segments[parsed.segments.length - 1];
  return last?.raw || parsed.raw || "";
}

export function inferPropertyManagementReportNumber(
  items: Array<{ itemNumber?: string | null; title?: string | null }>,
): string | null {
  const titled = items.find(
    (item) =>
      /property management report/i.test(item.title || "") &&
      /^\d+$/.test((item.itemNumber || "").trim()),
  );
  if (titled?.itemNumber) return titled.itemNumber.trim();

  for (const item of items) {
    const match = (item.itemNumber || "").trim().match(/^(\d+)\.[A-D](?:\.|$)/i);
    if (match) return match[1];
  }

  return null;
}

export type AdHocPlacement = {
  sectionCode: string;
  nextItemCodes: string[];
  sectionMissing: boolean;
};

export const AD_HOC_SECTION_TITLE = "Ad-hoc items";

export function isAdHocSectionTitle(title: string | null | undefined): boolean {
  return (
    (title || "")
      .trim()
      .toLowerCase()
      .replace(/[-–—_]/g, " ")
      .replace(/\s+/g, " ") === "ad hoc items"
  );
}

export function occupiesAdHocSection(
  itemNumber: string | null | undefined,
  sectionCode: string,
): boolean {
  const code = (itemNumber || "").trim().toLowerCase();
  if (!code) return false;
  const section = sectionCode.trim().toLowerCase();
  return code === section || code.startsWith(`${section}.`);
}

type AdHocPlanItem = { itemNumber?: string | null; title?: string | null };

function asAdHocPlanItem(
  entry: string | null | undefined | AdHocPlanItem,
): { itemNumber: string; title: string } {
  if (typeof entry === "string" || entry == null) {
    return { itemNumber: (entry || "").trim(), title: "" };
  }
  return {
    itemNumber: (entry.itemNumber || "").trim(),
    title: entry.title || "",
  };
}

function hasAdHocSectionHeading(
  items: Array<{ itemNumber: string; title: string }>,
  sectionCode: string,
): boolean {
  const section = sectionCode.toLowerCase();
  return items.some((item) => {
    if (item.itemNumber.toLowerCase() !== section) return false;
    return isAdHocSectionTitle(item.title) || !item.title.trim();
  });
}

export function partitionAdHocOccupants<T extends { itemNumber?: string | null; title?: string | null }>(
  items: T[],
  sectionCode: string,
): { heading: T | undefined; leaves: T[]; rest: T[] } {
  let heading: T | undefined;
  const leaves: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    const code = (item.itemNumber || "").trim();
    if (isAdHocSectionTitle(item.title) && code.toLowerCase() === sectionCode.toLowerCase()) {
      heading = heading ?? item;
      continue;
    }
    if (occupiesAdHocSection(code, sectionCode)) {
      leaves.push(item);
      continue;
    }
    rest.push(item);
  }
  return { heading, leaves, rest };
}

export function ensureAdHocSectionOutline<T extends { itemNumber?: string | null; title?: string | null }>(
  items: T[],
  createHeading: (sectionCode: string) => T,
  extraLeaves: T[] = [],
): T[] {
  const pmReportNumber = inferPropertyManagementReportNumber(items) || "4";
  const sectionCode = `${pmReportNumber}.E`;
  const { heading, leaves: occupying, rest } = partitionAdHocOccupants(items, sectionCode);
  const leaves = [...occupying, ...extraLeaves.filter((topic) => (topic.title || "").trim())];
  if (leaves.length === 0) return items;

  const placement = planAdHocPlacement(
    [...rest, ...(heading ? [heading] : [])],
    leaves.length,
    pmReportNumber,
  );
  if (!placement) return items;

  const numberedLeaves = leaves.map((leaf, index) => ({
    ...leaf,
    itemNumber: placement.nextItemCodes[index],
  }));
  const section = heading ?? createHeading(placement.sectionCode);
  return [...rest, { ...section, itemNumber: placement.sectionCode }, ...numberedLeaves];
}

export function planAdHocPlacement(
  existingItems: Array<string | null | undefined | AdHocPlanItem>,
  newItemCount: number,
  pmReportNumber?: string | null,
): AdHocPlacement | null {
  const resolvedPm = pmReportNumber?.trim() || null;
  if (!resolvedPm) return null;

  const sectionCode = `${resolvedPm}.E`;
  const items = existingItems.map(asAdHocPlanItem);
  const existing = items.filter(
    (item) =>
      item.itemNumber === sectionCode ||
      item.itemNumber.toLowerCase().startsWith(`${sectionCode.toLowerCase()}.`),
  );

  const usedLetters = new Set(
    existing
      .filter((item) => item.itemNumber.toLowerCase() !== sectionCode.toLowerCase())
      .map((item) => parseAgendaItemCode(item.itemNumber).segments.at(-1))
      .filter((segment): segment is OutlineSegment => segment?.kind === "letter")
      .map((segment) => segment.raw.toLowerCase()),
  );

  let cursor = 0;
  const nextItemCodes: string[] = [];
  while (nextItemCodes.length < newItemCount) {
    const letter = alphaLabel(cursor);
    cursor += 1;
    if (usedLetters.has(letter)) continue;
    nextItemCodes.push(`${sectionCode}.${letter}`);
  }

  return {
    sectionCode,
    nextItemCodes,
    sectionMissing: !hasAdHocSectionHeading(items, sectionCode),
  };
}

/** Transcript or clock start used to place a HITL-added agenda leaf. */
export type DiscussionPosition = {
  startSequence?: number | null;
  startSeconds?: number | null;
};

/** Build a discussion start from transcript sequences, sourceText clocks, or a timestamp string. */
export function discussionPositionFromEvidence(options: {
  sourceTranscriptRanges?: Array<[number, number]> | null;
  transcriptRange?: [number, number] | null;
  sourceText?: string | null;
  timestamp?: string | null;
}): DiscussionPosition {
  const ranges =
    options.sourceTranscriptRanges && options.sourceTranscriptRanges.length > 0
      ? options.sourceTranscriptRanges
      : options.transcriptRange
        ? [options.transcriptRange]
        : [];
  const usable = ranges.find(
    (range) =>
      Number.isFinite(range[0]) &&
      Number.isFinite(range[1]) &&
      !(range[0] === 0 && range[1] === 0),
  );
  const startSequence = finiteOrNull(usable?.[0]);
  const startSeconds =
    parseDiscussionTimestampRanges(options.sourceText)[0]?.startSeconds ??
    parseClockToSeconds(options.timestamp);
  return { startSequence, startSeconds };
}

/**
 * Compare two discussion starts. Sequence wins when both sides have it; otherwise clocks.
 * Returns null when the starts cannot be compared.
 */
export function compareDiscussionPositions(
  left: DiscussionPosition | null | undefined,
  right: DiscussionPosition | null | undefined,
): number | null {
  const leftSeq = finiteOrNull(left?.startSequence);
  const rightSeq = finiteOrNull(right?.startSequence);
  if (leftSeq != null && rightSeq != null) return leftSeq - rightSeq;
  const leftSec = finiteOrNull(left?.startSeconds);
  const rightSec = finiteOrNull(right?.startSeconds);
  if (leftSec != null && rightSec != null) return leftSec - rightSec;
  return null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function outlineHasDescendants<T extends { itemNumber?: string | null }>(
  items: T[],
  item: T,
): boolean {
  const code = (item.itemNumber || "").trim().toLowerCase();
  if (!code) return false;
  return items.some((other) => {
    const otherCode = (other.itemNumber || "").trim().toLowerCase();
    return otherCode.startsWith(`${code}.`);
  });
}

function nextUnusedChildCode(parentCode: string, takenLower: Set<string>): string {
  let index = 0;
  while (index < 200) {
    const code = canonicalLeafItemCode(parentCode, index);
    if (!takenLower.has(code.toLowerCase())) return code;
    index += 1;
  }
  return `${parentCode}.${index + 1}`;
}

function firstLeafBeforeIndex<T extends { itemNumber?: string | null; title?: string | null }>(
  items: T[],
  index: number,
): T | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = items[i];
    if (isAdHocSectionTitle(candidate.title)) continue;
    if (outlineHasDescendants(items, candidate)) continue;
    return candidate;
  }
  return undefined;
}

function parentCodeForInsert<T extends { itemNumber?: string | null; title?: string | null }>(
  items: T[],
  insertAt: number,
): string | null {
  const predecessor = firstLeafBeforeIndex(items, insertAt);
  const successor = items[insertAt];
  return (
    parentAgendaItemCode(predecessor?.itemNumber) ||
    parentAgendaItemCode(successor?.itemNumber) ||
    null
  );
}

/**
 * Splice incoming leaves into outline order immediately before the first existing
 * leaf whose discussion starts later. Incoming items receive the next unused child
 * code under that neighbor's parent so they nest with the surrounding discussion.
 */
export function insertItemsByDiscussionPosition<T extends { itemNumber?: string | null; title?: string | null }>(
  existing: T[],
  incoming: T[],
  getPosition: (item: T) => DiscussionPosition,
): T[] {
  const positioned = incoming.filter((item) => {
    const position = getPosition(item);
    return finiteOrNull(position.startSequence) != null || finiteOrNull(position.startSeconds) != null;
  });
  if (positioned.length === 0) return existing;

  const orderedIncoming = [...positioned].sort((left, right) => {
    return compareDiscussionPositions(getPosition(left), getPosition(right)) ?? 0;
  });

  const result = [...existing];
  for (const extra of orderedIncoming) {
    const extraPos = getPosition(extra);
    let insertAt = result.length;
    for (let i = 0; i < result.length; i += 1) {
      const item = result[i];
      if (isAdHocSectionTitle(item.title) || outlineHasDescendants(result, item)) continue;
      const compared = compareDiscussionPositions(extraPos, getPosition(item));
      if (compared != null && compared < 0) {
        insertAt = i;
        break;
      }
    }
    result.splice(insertAt, 0, extra);
  }

  const incomingIds = new Set(orderedIncoming);
  const takenLower = new Set(
    result
      .map((item) => (item.itemNumber || "").trim().toLowerCase())
      .filter(Boolean),
  );

  return result.map((item, index) => {
    if (!incomingIds.has(item)) return item;
    const parentCode = parentCodeForInsert(result, index);
    if (!parentCode) return item;
    takenLower.delete((item.itemNumber || "").trim().toLowerCase());
    const code = nextUnusedChildCode(parentCode, takenLower);
    takenLower.add(code.toLowerCase());
    return { ...item, itemNumber: code };
  });
}

const RESERVED_TOP_LEVEL_TITLE = /next board meeting|adjournment/i;

export type TimestampRange = {
  startSeconds: number;
  endSeconds: number;
};

export function parseClockToSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!match) return null;
  return (
    Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(`0.${match[4] ?? "0"}`)
  );
}

export function formatClockFromSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

const CLOCK_SPAN_RE =
  /(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)\s*[-–]\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/g;

export function mergeClosedIntervals(ranges: Array<[number, number]>): Array<[number, number]> {
  const ordered = ranges
    .map(([start, end]) => [Math.min(start, end), Math.max(start, end)] as [number, number])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ordered) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  return merged;
}

export function parseDiscussionTimestampRanges(value: string | null | undefined): TimestampRange[] {
  if (!value) return [];
  CLOCK_SPAN_RE.lastIndex = 0;
  const spans: TimestampRange[] = [];
  for (const match of value.matchAll(CLOCK_SPAN_RE)) {
    const startSeconds = parseClockToSeconds(match[1]);
    const endSeconds = parseClockToSeconds(match[2]);
    if (startSeconds === null || endSeconds === null) continue;
    spans.push({
      startSeconds: Math.min(startSeconds, endSeconds),
      endSeconds: Math.max(startSeconds, endSeconds),
    });
  }
  return mergeTimestampRanges(spans);
}

export function parseDiscussionTimestampRange(value: string | null | undefined): TimestampRange | null {
  return unionTimestampRanges(parseDiscussionTimestampRanges(value));
}

export function formatDiscussionTimestampRange(range: TimestampRange): string {
  return `${formatClockFromSeconds(range.startSeconds)} - ${formatClockFromSeconds(range.endSeconds)}`;
}

export function formatDiscussionTimestampRanges(ranges: TimestampRange[]): string | null {
  const merged = mergeTimestampRanges(ranges);
  if (merged.length === 0) return null;
  return merged.map(formatDiscussionTimestampRange).join("; ");
}

export function mergeTimestampRanges(ranges: Array<TimestampRange | null | undefined>): TimestampRange[] {
  return mergeClosedIntervals(
    ranges
      .filter((range): range is TimestampRange => Boolean(range))
      .map((range) => [range.startSeconds, range.endSeconds]),
  ).map(([startSeconds, endSeconds]) => ({ startSeconds, endSeconds }));
}

export function unionTimestampRanges(ranges: Array<TimestampRange | null | undefined>): TimestampRange | null {
  const merged = mergeTimestampRanges(ranges);
  if (merged.length === 0) return null;
  return {
    startSeconds: merged[0].startSeconds,
    endSeconds: merged[merged.length - 1].endSeconds,
  };
}

export function reservedTopLevelItemNumbers(
  items: Array<{ itemNumber?: string | null; title?: string | null }>,
): Set<number> {
  const reserved = new Set<number>();
  for (const item of items) {
    const code = (item.itemNumber || "").trim();
    if (!/^\d+$/.test(code)) continue;
    if (!RESERVED_TOP_LEVEL_TITLE.test(item.title || "")) continue;
    reserved.add(Number.parseInt(code, 10));
  }
  return reserved;
}

function replaceLastSegment(code: string, lastRaw: string): string {
  const parsed = parseAgendaItemCode(code);
  if (parsed.segments.length === 0) return lastRaw;
  return [...parsed.segments.slice(0, -1).map((segment) => segment.raw), lastRaw].join(".");
}

function compactNumericChildren<T extends AgendaOutlineSourceItem>(
  nodes: Array<AgendaOutlineNode<T>>,
  reservedTopLevel: Set<number>,
  rewriteItemNumbers: boolean,
): void {
  for (const node of nodes) {
    compactNumericChildren(node.children, reservedTopLevel, rewriteItemNumbers);
    const numericChildren = node.children.filter(
      (child) => child.listMarker === "decimal" && /^\d+$/.test(child.displayNumber),
    );
    if (numericChildren.length === 0 || reservedTopLevel.size === 0) continue;

    const ranks = numericChildren.map((child) => Number.parseInt(child.displayNumber, 10));
    const max = Math.max(...ranks);
    const used = new Set(ranks);
    const missingReserved: number[] = [];
    for (let rank = 1; rank < max; rank += 1) {
      if (!used.has(rank) && reservedTopLevel.has(rank)) missingReserved.push(rank);
    }
    if (missingReserved.length === 0) continue;

    for (const child of numericChildren) {
      const rank = Number.parseInt(child.displayNumber, 10);
      const shift = missingReserved.filter((missing) => missing < rank).length;
      if (shift === 0) continue;
      const nextRank = String(rank - shift);
      child.displayNumber = nextRank;
      if (rewriteItemNumbers && child.item.itemNumber) {
        child.item.itemNumber = replaceLastSegment(child.item.itemNumber, nextRank);
      }
    }
  }
}

export function applyHierarchicalDiscussionTiming<T extends AgendaOutlineSourceItem>(
  nodes: Array<AgendaOutlineNode<T>>,
  getTiming: (item: T) => string | null | undefined,
): void {
  const walk = (node: AgendaOutlineNode<T>): TimestampRange[] => {
    const childRanges = node.children.flatMap((child) => walk(child));
    const ownRanges = parseDiscussionTimestampRanges(getTiming(node.item) ?? null);
    const merged = mergeTimestampRanges([...ownRanges, ...childRanges]);
    node.discussionTiming = formatDiscussionTimestampRanges(merged);
    return merged;
  };
  for (const node of nodes) walk(node);
}

export function decorateAgendaOutlineTree<T extends AgendaOutlineSourceItem>(
  nodes: Array<AgendaOutlineNode<T>>,
  options: {
    items: Array<{ itemNumber?: string | null; title?: string | null }>;
    getTiming: (item: T) => string | null | undefined;
    rewriteItemNumbers?: boolean;
  },
): Array<AgendaOutlineNode<T>> {
  // Printed agenda codes are source identifiers. Gaps are not evidence of an error.
  applyHierarchicalDiscussionTiming(nodes, options.getTiming);
  return nodes;
}

export function applyAgendaHierarchyCorrections<
  T extends AgendaOutlineSourceItem & { discussionTimestampRange?: string | null },
>(items: T[]): T[] {
  // Timing/number writeback is keyed by item.id. Duplicate or missing ids
  // would copy the last walked node (often item 6 Adjournment) onto every row.
  const copies = items.map((item, index) => ({
    ...item,
    id: item.id?.trim() || `outline-${index}`,
  }));
  const tree = buildAgendaOutlineTree(copies);
  decorateAgendaOutlineTree(tree, {
    items: copies,
    getTiming: (item) => item.discussionTimestampRange,
    rewriteItemNumbers: true,
  });

  const timingById = new Map<string, string | null>();
  const numberById = new Map<string, string | null>();
  const walk = (nodes: Array<AgendaOutlineNode<T>>) => {
    for (const node of nodes) {
      timingById.set(node.item.id, node.discussionTiming ?? null);
      numberById.set(node.item.id, node.item.itemNumber);
      walk(node.children);
    }
  };
  walk(tree);

  return copies.map((item) => ({
    ...item,
    itemNumber: numberById.get(item.id) ?? item.itemNumber,
    discussionTimestampRange: timingById.get(item.id) ?? item.discussionTimestampRange,
  }));
}

/**
 * Keep content items that pass `shouldKeepContent`, plus any ancestor needed so
 * nested codes still hang off their official parent (4.D stays when 4.D.a is kept).
 */
export function filterAgendaItemsPreservingAncestors<T extends AgendaOutlineSourceItem>(
  items: T[],
  shouldKeepContent: (item: T) => boolean,
): T[] {
  const tree = buildAgendaOutlineTree(items);
  const keepIds = new Set<string>();

  const walk = (node: AgendaOutlineNode<T>): boolean => {
    const descendantKept = node.children.map(walk).some(Boolean);
    const keep = shouldKeepContent(node.item) || descendantKept;
    if (keep) keepIds.add(node.item.id);
    return keep;
  };

  for (const node of tree) walk(node);

  return items.filter((item) => keepIds.has(item.id));
}

export function buildAgendaOutlineTree<T extends AgendaOutlineSourceItem>(
  items: T[],
  options?: { order?: "code" | "input" },
): Array<AgendaOutlineNode<T>> {
  const entries = items.map((item, itemIndex) => ({
    item,
    itemIndex,
    parsed: parseAgendaItemCode(item.itemNumber),
  }));
  const attachOrder =
    options?.order === "input"
      ? entries
      : [...entries].sort((left, right) => {
          const compared = compareAgendaItemCodes(left.item.itemNumber, right.item.itemNumber);
          if (compared !== 0) return compared;
          return left.itemIndex - right.itemIndex;
        });

  const nodes: Array<AgendaOutlineNode<T>> = entries.map((entry) => {
    const last = entry.parsed.segments[entry.parsed.segments.length - 1];
    return {
      item: entry.item,
      displayNumber: last?.raw || entry.parsed.raw || "",
      listMarker: listMarkerForSegment(last),
      children: [],
    };
  });
  const nodesByCode = new Map<string, AgendaOutlineNode<T>>();
  for (const entry of entries) {
    const code = entry.parsed.raw;
    if (code) nodesByCode.set(code.toLowerCase(), nodes[entry.itemIndex]);
  }

  const roots: Array<AgendaOutlineNode<T>> = [];
  for (const entry of attachOrder) {
    const node = nodes[entry.itemIndex];
    if (!node.displayNumber) {
      node.displayNumber = String(roots.length + 1);
    }
    const code = entry.parsed.raw;
    let parentCode = parentAgendaItemCode(code);
    let parent: AgendaOutlineNode<T> | undefined;
    while (parentCode && !parent) {
      parent = nodesByCode.get(parentCode.toLowerCase());
      if (!parent) parentCode = parentAgendaItemCode(parentCode);
    }

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
