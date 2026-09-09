import {
  buildAgendaOutlineTree,
  decorateAgendaOutlineTree,
  parseDiscussionTimestampRanges,
  type AgendaOutlineNode,
  type AgendaOutlineSourceItem,
} from "@/lib/meeting-v2/agenda-outline";
import { parseVttTimestampMs } from "@/lib/parsers/vtt";

export type TranscriptSectionOverlay = {
  id: string;
  code: string;
  title: string;
  startSeconds: number;
  endSeconds: number;
};

export type CueSectionGroup = {
  sections: TranscriptSectionOverlay[];
  cueIndexes: number[];
};

export function discussionTimingFromSourceText(
  sourceText: string | null | undefined,
): string | null {
  if (!sourceText) return null;
  const match = sourceText.match(/discussion timing:\s*([^\n]+)/i);
  const value = match?.[1]?.trim() ?? "";
  return value || null;
}

export function collectLeafTranscriptSections<T extends AgendaOutlineSourceItem>(
  nodes: Array<AgendaOutlineNode<T>>,
): TranscriptSectionOverlay[] {
  const overlays: TranscriptSectionOverlay[] = [];

  const walk = (node: AgendaOutlineNode<T>) => {
    if (node.children.length > 0) {
      for (const child of node.children) walk(child);
      return;
    }
    const ranges = parseDiscussionTimestampRanges(node.discussionTiming);
    for (const range of ranges) {
      overlays.push({
        id: node.item.id,
        code: (node.item.itemNumber || "").trim() || node.displayNumber,
        title: (node.item.title || "").trim(),
        startSeconds: range.startSeconds,
        endSeconds: range.endSeconds,
      });
    }
  };

  for (const node of nodes) walk(node);
  overlays.sort((left, right) => {
    if (left.startSeconds !== right.startSeconds) return left.startSeconds - right.startSeconds;
    return left.endSeconds - right.endSeconds;
  });
  return overlays;
}

export function buildTranscriptSectionOverlays<T extends AgendaOutlineSourceItem>(
  items: T[],
  getTiming: (item: T) => string | null | undefined,
): TranscriptSectionOverlay[] {
  if (items.length === 0) return [];
  const tree = buildAgendaOutlineTree(items);
  decorateAgendaOutlineTree(tree, { items, getTiming });
  return collectLeafTranscriptSections(tree);
}

function sectionSpecificity(section: TranscriptSectionOverlay): number {
  return section.code.split(".").filter(Boolean).length;
}

function sortCoveringSections(sections: TranscriptSectionOverlay[]): TranscriptSectionOverlay[] {
  return [...sections].sort((left, right) => {
    if (left.startSeconds !== right.startSeconds) return right.startSeconds - left.startSeconds;
    const spec = sectionSpecificity(right) - sectionSpecificity(left);
    if (spec !== 0) return spec;
    return left.endSeconds - left.startSeconds - (right.endSeconds - right.startSeconds);
  });
}

export function pickSectionsForTime(
  timeSeconds: number,
  sections: TranscriptSectionOverlay[],
): TranscriptSectionOverlay[] {
  const covering = sections.filter(
    (section) => timeSeconds >= section.startSeconds && timeSeconds <= section.endSeconds,
  );
  if (covering.length === 0) return [];
  const uniqueById = new Map<string, TranscriptSectionOverlay>();
  for (const section of sortCoveringSections(covering)) {
    if (!uniqueById.has(section.id)) uniqueById.set(section.id, section);
  }
  return [...uniqueById.values()];
}

export function pickSectionForTime(
  timeSeconds: number,
  sections: TranscriptSectionOverlay[],
): TranscriptSectionOverlay | null {
  return pickSectionsForTime(timeSeconds, sections)[0] ?? null;
}

function sectionSetKey(sections: TranscriptSectionOverlay[]): string {
  return sections
    .map((section) => section.id)
    .sort()
    .join("|");
}

export function groupCuesByTranscriptSections(
  cues: Array<{ start: string }>,
  sections: TranscriptSectionOverlay[],
): CueSectionGroup[] {
  if (cues.length === 0) return [];
  if (sections.length === 0) {
    return [{ sections: [], cueIndexes: cues.map((_, index) => index) }];
  }

  const groups: CueSectionGroup[] = [];
  for (let index = 0; index < cues.length; index += 1) {
    const timeSeconds = parseVttTimestampMs(cues[index].start) / 1000;
    const covering = pickSectionsForTime(timeSeconds, sections);
    const last = groups[groups.length - 1];
    if (last && sectionSetKey(last.sections) === sectionSetKey(covering)) {
      last.cueIndexes.push(index);
    } else {
      groups.push({ sections: covering, cueIndexes: [index] });
    }
  }
  return groups;
}
