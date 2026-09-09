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

function uniqueSectionsById(sections: TranscriptSectionOverlay[]): TranscriptSectionOverlay[] {
  const uniqueById = new Map<string, TranscriptSectionOverlay>();
  for (const section of sortCoveringSections(sections)) {
    if (!uniqueById.has(section.id)) uniqueById.set(section.id, section);
  }
  return [...uniqueById.values()];
}

function cueOverlapsSection(
  startSeconds: number,
  endSeconds: number,
  section: TranscriptSectionOverlay,
): boolean {
  return startSeconds <= section.endSeconds && endSeconds >= section.startSeconds;
}

export function pickSectionsForTime(
  timeSeconds: number,
  sections: TranscriptSectionOverlay[],
  endSeconds: number = timeSeconds,
): TranscriptSectionOverlay[] {
  const covering = sections.filter((section) => cueOverlapsSection(timeSeconds, endSeconds, section));
  if (covering.length === 0) return [];
  return uniqueSectionsById(covering);
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

function nearestAssignedGroup(
  groups: CueSectionGroup[],
  fromIndex: number,
  direction: -1 | 1,
): CueSectionGroup | null {
  for (let index = fromIndex + direction; index >= 0 && index < groups.length; index += direction) {
    if (groups[index].sections.length > 0) return groups[index];
  }
  return null;
}

function absorbUnassignedCueGroups(groups: CueSectionGroup[]): CueSectionGroup[] {
  if (groups.length === 0) return groups;
  return groups.map((group, index) => {
    if (group.sections.length > 0) return group;
    const previous = nearestAssignedGroup(groups, index, -1);
    const next = nearestAssignedGroup(groups, index, 1);
    if (!previous || !next) return group;
    if (sectionSetKey(previous.sections) === sectionSetKey(next.sections)) {
      return { ...group, sections: previous.sections };
    }
    const previousEnd = Math.max(...previous.sections.map((section) => section.endSeconds));
    const nextStart = Math.min(...next.sections.map((section) => section.startSeconds));
    // Whole-second stored ranges often leave a 1s uncovered fence at a handoff.
    if (nextStart - previousEnd <= 2) {
      return { ...group, sections: uniqueSectionsById([...previous.sections, ...next.sections]) };
    }
    return group;
  });
}

function mergeAdjacentCueGroups(groups: CueSectionGroup[]): CueSectionGroup[] {
  const merged: CueSectionGroup[] = [];
  for (const group of groups) {
    const last = merged[merged.length - 1];
    if (last && sectionSetKey(last.sections) === sectionSetKey(group.sections)) {
      last.cueIndexes.push(...group.cueIndexes);
    } else {
      merged.push({ sections: group.sections, cueIndexes: [...group.cueIndexes] });
    }
  }
  return merged;
}

export function groupCuesByTranscriptSections(
  cues: Array<{ start: string; end?: string }>,
  sections: TranscriptSectionOverlay[],
): CueSectionGroup[] {
  if (cues.length === 0) return [];
  if (sections.length === 0) {
    return [{ sections: [], cueIndexes: cues.map((_, index) => index) }];
  }

  const groups: CueSectionGroup[] = [];
  for (let index = 0; index < cues.length; index += 1) {
    const startSeconds = parseVttTimestampMs(cues[index].start) / 1000;
    const endSeconds =
      cues[index].end !== undefined ? parseVttTimestampMs(cues[index].end) / 1000 : startSeconds;
    const covering = pickSectionsForTime(startSeconds, sections, Math.max(startSeconds, endSeconds));
    const last = groups[groups.length - 1];
    if (last && sectionSetKey(last.sections) === sectionSetKey(covering)) {
      last.cueIndexes.push(index);
    } else {
      groups.push({ sections: covering, cueIndexes: [index] });
    }
  }
  return mergeAdjacentCueGroups(absorbUnassignedCueGroups(groups));
}
