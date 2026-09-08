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
    return extracted;
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
