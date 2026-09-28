import {
  buildAgendaOutlineTree,
  parentAgendaItemCode,
  parseAgendaItemCode,
  type AgendaOutlineNode,
} from "@/lib/meeting-v2/agenda-outline";
import type {
  CaptureFileView,
  CaptureGapView,
  RecordingHealth,
} from "@/lib/meeting-v2/live-clock";

export type LiveAgendaSourceItem = {
  id: string;
  itemNumber: string | null;
  title: string;
  sourceText: string | null;
  sourcePagesJson: string;
};

export type LiveRoomLeaf = {
  id: string;
  itemNumber: string | null;
  title: string;
  sourceText: string | null;
  sourcePages: number[];
};

/** One agenda row in the live room sidebar: a navigable leaf or a non-interactive heading. */
export type LiveAgendaOutlineRow = {
  key: string;
  itemNumber: string;
  title: string;
  kind: "leaf" | "heading";
  agendaItemId: string | null;
  sourcePages: number[];
};

const SYNTHETIC_OUTLINE_ID_PREFIX = "outline-synthetic:";

const PROPERTY_MANAGEMENT_SUBSECTION_TITLES: Record<string, string> = {
  a: "Ratification of email decisions made since the last board meeting.",
  b: "Review and approval of the project",
  c: "Items completed.",
  d: "The items for discussion",
};

export type LiveNavigationEventView = {
  id: string;
  agendaItemId: string | null;
  unscheduled: boolean;
  mediaOffsetMs: number;
  actorIdentity: string;
  createdAt: string;
};

export type PageMapLeafGap = {
  id: string;
  itemNumber: string | null;
  title: string;
};

/** Whether someone has confirmed the leaf-to-page map, and which leaves still have no pages. */
export type PageMapCheckView = {
  checkedAt: string | null;
  checkedByIdentity: string | null;
  checkedByName: string | null;
  leavesWithoutPages: PageMapLeafGap[];
};

/** The shared view: one agenda leaf, or an unscheduled discussion that is not a leaf. */
export type LiveFocus =
  | { kind: "leaf"; agendaItemId: string }
  | { kind: "unscheduled" };

export type LiveNavigationTarget = {
  agendaItemId: string | null;
  unscheduled: boolean;
};

export type LiveRoomSnapshot = {
  configured: boolean;
  roomName: string | null;
  mediaStartedAt: string | null;
  activeAgendaItemId: string | null;
  activeUnscheduled: boolean;
  presenterIdentity: string | null;
  presenterDisplayName: string | null;
  presentedPage: number | null;
  pageMap: PageMapCheckView;
  leaves: LiveRoomLeaf[];
  outline: LiveAgendaOutlineRow[];
  navigation: LiveNavigationEventView[];
  recording: RecordingHealth;
  captureGaps: CaptureGapView[];
  captureFiles: CaptureFileView[];
  clockDeltaMs: number | null;
};

/**
 * Parses package page numbers stored on an agenda item.
 */
export function parseAgendaSourcePages(sourcePagesJson: string): number[] {
  try {
    const parsed = JSON.parse(sourcePagesJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (page): page is number =>
        typeof page === "number" && Number.isInteger(page) && page > 0,
    );
  } catch {
    return [];
  }
}

/**
 * Leaf agenda items in outline order. A parent with children is omitted.
 */
export function liveAgendaLeaves(items: LiveAgendaSourceItem[]): LiveRoomLeaf[] {
  const tree = buildAgendaOutlineTree(items);
  const byId = new Map(items.map((item) => [item.id, item]));
  const leaves: LiveRoomLeaf[] = [];

  const walk = (nodes: ReturnType<typeof buildAgendaOutlineTree<LiveAgendaSourceItem>>) => {
    for (const node of nodes) {
      if (node.children.length === 0) {
        const item = byId.get(node.item.id);
        if (!item) continue;
        leaves.push({
          id: item.id,
          itemNumber: item.itemNumber,
          title: item.title,
          sourceText: item.sourceText,
          sourcePages: parseAgendaSourcePages(item.sourcePagesJson),
        });
      } else {
        walk(node.children);
      }
    }
  };

  walk(tree);
  return leaves;
}

type LiveAgendaOutlineSourceItem = LiveAgendaSourceItem & {
  sectionLabel?: string | null;
};

function agendaItemsWithCodePrefix<T extends { itemNumber?: string | null }>(
  code: string,
  items: T[],
): T[] {
  const normalized = code.trim().toLowerCase();
  if (!normalized) return [];
  return items.filter((item) => {
    const raw = (item.itemNumber || "").trim().toLowerCase();
    return raw === normalized || raw.startsWith(`${normalized}.`);
  });
}

/**
 * Titles for outline rows that exist in the package hierarchy but were not stored as agenda items.
 */
function inferSyntheticOutlineTitle(
  code: string,
  items: LiveAgendaOutlineSourceItem[],
  byCode: Map<string, LiveAgendaOutlineSourceItem>,
): string {
  const existing = byCode.get(code.trim().toLowerCase());
  if (existing?.title?.trim()) return existing.title.trim();

  const depth = parseAgendaItemCode(code).segments.length;
  const descendants = agendaItemsWithCodePrefix(code, items);

  if (depth === 1) {
    for (const item of descendants) {
      const label = item.sectionLabel?.trim();
      if (!label) continue;
      const colon = label.indexOf(":");
      if (colon > 0) return label.slice(0, colon).trim();
      return label;
    }
    return code;
  }

  if (depth === 2) {
    for (const item of descendants) {
      const label = item.sectionLabel?.trim();
      if (!label) continue;
      const colon = label.indexOf(":");
      if (colon > 0) return label.slice(colon + 1).trim();
    }
    const letter = parseAgendaItemCode(code).segments.find((segment) => segment.kind === "letter");
    if (letter) {
      const known = PROPERTY_MANAGEMENT_SUBSECTION_TITLES[letter.raw.toLowerCase()];
      if (known) return known;
    }
  }

  return code;
}

function augmentAgendaItemsWithSyntheticAncestors(
  items: LiveAgendaOutlineSourceItem[],
): LiveAgendaSourceItem[] {
  const byCode = new Map<string, LiveAgendaOutlineSourceItem>();
  for (const item of items) {
    const code = (item.itemNumber || "").trim();
    if (code) byCode.set(code.toLowerCase(), item);
  }

  const extras: LiveAgendaSourceItem[] = [];
  for (const item of items) {
    let parentCode = parentAgendaItemCode(item.itemNumber);
    while (parentCode) {
      const key = parentCode.toLowerCase();
      if (!byCode.has(key)) {
        const synthetic: LiveAgendaSourceItem = {
          id: `${SYNTHETIC_OUTLINE_ID_PREFIX}${parentCode}`,
          itemNumber: parentCode,
          title: inferSyntheticOutlineTitle(parentCode, items, byCode),
          sourceText: null,
          sourcePagesJson: "[]",
        };
        extras.push(synthetic);
        byCode.set(key, synthetic);
      }
      parentCode = parentAgendaItemCode(parentCode);
    }
  }

  return [...items, ...extras];
}

function flattenLiveAgendaOutline(
  nodes: Array<AgendaOutlineNode<LiveAgendaSourceItem>>,
  leafIds: Set<string>,
  sourcePagesById: Map<string, number[]>,
): LiveAgendaOutlineRow[] {
  const rows: LiveAgendaOutlineRow[] = [];
  const walk = (outlineNodes: Array<AgendaOutlineNode<LiveAgendaSourceItem>>) => {
    for (const node of outlineNodes) {
      const itemNumber = (node.item.itemNumber || "").trim();
      const isLeaf = leafIds.has(node.item.id);
      rows.push({
        key: node.item.id,
        itemNumber,
        title: node.item.title,
        kind: isLeaf ? "leaf" : "heading",
        agendaItemId: isLeaf ? node.item.id : null,
        sourcePages: isLeaf ? (sourcePagesById.get(node.item.id) ?? []) : [],
      });
      walk(node.children);
    }
  };
  walk(nodes);
  return rows;
}

/**
 * Full printed agenda order for the live room, including package headings that have no leaf row.
 * Only rows with kind "leaf" are navigable.
 */
export function liveAgendaOutlineRows(items: LiveAgendaOutlineSourceItem[]): LiveAgendaOutlineRow[] {
  const leaves = liveAgendaLeaves(items);
  const leafIds = new Set(leaves.map((leaf) => leaf.id));
  const sourcePagesById = new Map(
    items.map((item) => [item.id, parseAgendaSourcePages(item.sourcePagesJson)]),
  );
  const tree = buildAgendaOutlineTree(augmentAgendaItemsWithSyntheticAncestors(items));
  return flattenLiveAgendaOutline(tree, leafIds, sourcePagesById);
}

/**
 * The next or previous leaf id, or null at either end.
 */
export function adjacentLeafId(
  leaves: Array<{ id: string }>,
  currentId: string | null,
  direction: -1 | 1,
): string | null {
  if (leaves.length === 0) return null;
  const index = currentId ? leaves.findIndex((leaf) => leaf.id === currentId) : -1;
  if (index === -1) {
    return direction > 0 ? leaves[0]?.id ?? null : leaves[leaves.length - 1]?.id ?? null;
  }
  const next = leaves[index + direction];
  return next?.id ?? null;
}

/**
 * Leaf to show: the latest navigation target when it is still a leaf, otherwise the first leaf.
 */
export function activeLeafId(
  leaves: Array<{ id: string }>,
  navigationAgendaItemIds: string[],
): string | null {
  for (let index = navigationAgendaItemIds.length - 1; index >= 0; index -= 1) {
    const agendaItemId = navigationAgendaItemIds[index];
    if (leaves.some((leaf) => leaf.id === agendaItemId)) return agendaItemId;
  }
  return leaves[0]?.id ?? null;
}

/**
 * True when this participant is the person currently holding the presenter claim.
 */
export function navigationAllowed(
  presenterIdentity: string | null,
  actorIdentity: string,
): boolean {
  return presenterIdentity !== null && presenterIdentity === actorIdentity;
}

/**
 * Shared focus from navigation history. The latest unscheduled mark wins over older leaves.
 * An empty history shows the first leaf. History entries are not removed.
 */
export function activeLiveFocus(
  leaves: Array<{ id: string }>,
  navigation: LiveNavigationTarget[],
): LiveFocus | null {
  for (let index = navigation.length - 1; index >= 0; index -= 1) {
    const event = navigation[index];
    if (!event) continue;
    if (event.unscheduled) return { kind: "unscheduled" };
    if (
      event.agendaItemId &&
      leaves.some((leaf) => leaf.id === event.agendaItemId)
    ) {
      return { kind: "leaf", agendaItemId: event.agendaItemId };
    }
  }
  const first = leaves[0]?.id;
  return first ? { kind: "leaf", agendaItemId: first } : null;
}

/**
 * Leaf id for Previous or Next. From an unscheduled discussion, Previous returns to the leaf that was left and Next moves past it.
 */
export function leafStepTarget(
  leaves: Array<{ id: string }>,
  navigation: LiveNavigationTarget[],
  direction: -1 | 1,
): string | null {
  const focus = activeLiveFocus(leaves, navigation);
  if (focus?.kind === "leaf") {
    return adjacentLeafId(leaves, focus.agendaItemId, direction);
  }
  if (!focus) {
    return direction > 0 ? (leaves[0]?.id ?? null) : null;
  }

  let anchor: string | null = null;
  for (let index = navigation.length - 1; index >= 0; index -= 1) {
    const event = navigation[index];
    if (!event || event.unscheduled) continue;
    if (event.agendaItemId && leaves.some((leaf) => leaf.id === event.agendaItemId)) {
      anchor = event.agendaItemId;
      break;
    }
  }
  if (!anchor) {
    return direction > 0 ? (leaves[0]?.id ?? null) : (leaves[leaves.length - 1]?.id ?? null);
  }
  if (direction < 0) return anchor;
  return adjacentLeafId(leaves, anchor, 1);
}

export type StageMove = { kind: "leaf"; agendaItemId: string; page: number | null };

/**
 * Package pages that stay on the shared stage, and later pages that open from a link.
 * The stage is the first page plus any pages that follow it with no gap.
 * A gap is an attachment (page 3, then page 13), not the next agenda item.
 */
export function stagePages(sourcePages: number[]): { shown: number[]; attached: number[] } {
  const sorted = [...new Set(sourcePages.filter((page) => Number.isInteger(page) && page > 0))].sort(
    (left, right) => left - right,
  );
  if (sorted.length === 0) return { shown: [], attached: [] };
  const shown: number[] = [sorted[0]];
  for (const page of sorted.slice(1)) {
    if (page !== shown[shown.length - 1] + 1) break;
    shown.push(page);
  }
  const onStage = new Set(shown);
  return { shown, attached: sorted.filter((page) => !onStage.has(page)) };
}

/**
 * Collapses page numbers into inclusive ranges, in ascending order.
 */
export function groupPageRanges(pages: number[]): Array<{ start: number; end: number }> {
  const sorted = [...new Set(pages.filter((page) => Number.isInteger(page) && page > 0))].sort(
    (left, right) => left - right,
  );
  const groups: Array<{ start: number; end: number }> = [];
  for (const page of sorted) {
    const last = groups[groups.length - 1];
    if (last && page === last.end + 1) last.end = page;
    else groups.push({ start: page, end: page });
  }
  return groups;
}

/**
 * First package page of the active leaf. Null during an unscheduled discussion.
 */
export function stagePackagePage(
  focus: LiveFocus | null,
  sourcePages: number[],
): number | null {
  if (focus?.kind !== "leaf") return null;
  return stagePages(sourcePages).shown[0] ?? null;
}

/**
 * One step of the shared stage. Previous and Next move to the neighboring agenda item.
 * The item opens on its first package page. Attached pages are not steps.
 */
export function stageMove(input: {
  leaves: Array<{ id: string; sourcePages: number[] }>;
  navigation: LiveNavigationTarget[];
  presentedPage: number | null;
  direction: -1 | 1;
}): StageMove | null {
  const focus = activeLiveFocus(input.leaves, input.navigation);
  if (!focus) return null;

  const leafId =
    focus.kind === "unscheduled"
      ? leafStepTarget(input.leaves, input.navigation, input.direction)
      : adjacentLeafId(input.leaves, focus.agendaItemId, input.direction);
  if (!leafId) return null;
  const leaf = input.leaves.find((item) => item.id === leafId);
  return {
    kind: "leaf",
    agendaItemId: leafId,
    page: leaf ? stagePackagePage({ kind: "leaf", agendaItemId: leafId }, leaf.sourcePages) : null,
  };
}

/**
 * Page the presenter sent to everyone, when it still belongs to the active leaf.
 * Returns null for an unscheduled discussion or a page that is not on that leaf.
 */
export function effectivePresentedPage(
  focus: LiveFocus | null,
  leaves: Array<{ id: string; sourcePages: number[] }>,
  presentedPage: number | null,
): number | null {
  if (presentedPage == null || focus?.kind !== "leaf") return null;
  const leaf = leaves.find((item) => item.id === focus.agendaItemId);
  if (!leaf?.sourcePages.includes(presentedPage)) return null;
  return presentedPage;
}

/**
 * Which package page to open. A personal open stays personal. Followers open the presented page until they dismiss it.
 * The presenter does not auto-open their own broadcast.
 */
export function packagePageToOpen(input: {
  personalPage: number | null;
  presentedPage: number | null;
  viewerIsPresenter: boolean;
  dismissedPresentedPage: number | null;
}): { page: number | null; source: "personal" | "presented" | null } {
  if (input.personalPage != null) {
    return { page: input.personalPage, source: "personal" };
  }
  if (
    !input.viewerIsPresenter &&
    input.presentedPage != null &&
    input.presentedPage !== input.dismissedPresentedPage
  ) {
    return { page: input.presentedPage, source: "presented" };
  }
  return { page: null, source: null };
}

/**
 * Map-check notice. An unchecked map does not remove leaves or block the room.
 */
export function pageMapCheckView(input: {
  checkedAt: string | null;
  checkedByIdentity: string | null;
  checkedByName: string | null;
  leaves: Array<Pick<LiveRoomLeaf, "id" | "itemNumber" | "title" | "sourcePages">>;
}): PageMapCheckView {
  return {
    checkedAt: input.checkedAt,
    checkedByIdentity: input.checkedByIdentity,
    checkedByName: input.checkedByName,
    leavesWithoutPages: input.leaves
      .filter((leaf) => leaf.sourcePages.length === 0)
      .map((leaf) => ({
        id: leaf.id,
        itemNumber: leaf.itemNumber,
        title: leaf.title,
      })),
  };
}
