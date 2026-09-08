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

export function planAdHocPlacement(
  existingItemNumbers: Array<string | null | undefined>,
  newItemCount: number,
  pmReportNumber?: string | null,
): AdHocPlacement | null {
  const resolvedPm = pmReportNumber?.trim() || null;
  if (!resolvedPm) return null;

  const sectionCode = `${resolvedPm}.E`;
  const existing = existingItemNumbers
    .map((value) => (value || "").trim())
    .filter((value) => value === sectionCode || value.toLowerCase().startsWith(`${sectionCode.toLowerCase()}.`));

  const usedLetters = new Set(
    existing
      .filter((value) => value.toLowerCase() !== sectionCode.toLowerCase())
      .map((value) => parseAgendaItemCode(value).segments.at(-1))
      .filter((segment): segment is OutlineSegment => Boolean(segment) && segment.kind === "letter")
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
    sectionMissing: !existing.some((value) => value === sectionCode),
  };
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

export function parseDiscussionTimestampRange(value: string | null | undefined): TimestampRange | null {
  if (!value) return null;
  const clocks = [...value.matchAll(/(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/g)].map((match) => match[1]);
  if (clocks.length < 2) return null;
  const startSeconds = parseClockToSeconds(clocks[0]);
  const endSeconds = parseClockToSeconds(clocks[clocks.length - 1]);
  if (startSeconds === null || endSeconds === null) return null;
  return {
    startSeconds: Math.min(startSeconds, endSeconds),
    endSeconds: Math.max(startSeconds, endSeconds),
  };
}

export function formatDiscussionTimestampRange(range: TimestampRange): string {
  return `${formatClockFromSeconds(range.startSeconds)} - ${formatClockFromSeconds(range.endSeconds)}`;
}

export function unionTimestampRanges(ranges: Array<TimestampRange | null | undefined>): TimestampRange | null {
  const present = ranges.filter((range): range is TimestampRange => Boolean(range));
  if (present.length === 0) return null;
  return {
    startSeconds: Math.min(...present.map((range) => range.startSeconds)),
    endSeconds: Math.max(...present.map((range) => range.endSeconds)),
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
  const walk = (node: AgendaOutlineNode<T>): TimestampRange | null => {
    const childRanges = node.children.map((child) => walk(child));
    const ownRange = parseDiscussionTimestampRange(getTiming(node.item) ?? null);
    const union = unionTimestampRanges([ownRange, ...childRanges]);
    node.discussionTiming = union ? formatDiscussionTimestampRange(union) : null;
    return union;
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
  compactNumericChildren(
    nodes,
    reservedTopLevelItemNumbers(options.items),
    Boolean(options.rewriteItemNumbers),
  );
  applyHierarchicalDiscussionTiming(nodes, options.getTiming);
  return nodes;
}

export function applyAgendaHierarchyCorrections<
  T extends AgendaOutlineSourceItem & { discussionTimestampRange?: string | null },
>(items: T[]): T[] {
  const copies = items.map((item) => ({ ...item }));
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

export function buildAgendaOutlineTree<T extends AgendaOutlineSourceItem>(
  items: T[],
): Array<AgendaOutlineNode<T>> {
  const sorted = items
    .map((item, itemIndex) => ({ item, itemIndex, parsed: parseAgendaItemCode(item.itemNumber) }))
    .sort((left, right) => {
      const compared = compareAgendaItemCodes(left.item.itemNumber, right.item.itemNumber);
      if (compared !== 0) return compared;
      return left.itemIndex - right.itemIndex;
    });

  const nodesByCode = new Map<string, AgendaOutlineNode<T>>();
  const roots: Array<AgendaOutlineNode<T>> = [];

  for (const entry of sorted) {
    const last = entry.parsed.segments[entry.parsed.segments.length - 1];
    const node: AgendaOutlineNode<T> = {
      item: entry.item,
      displayNumber: last?.raw || entry.parsed.raw || String(roots.length + 1),
      listMarker: listMarkerForSegment(last),
      children: [],
    };

    const code = entry.parsed.raw;
    if (code) nodesByCode.set(code.toLowerCase(), node);

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
