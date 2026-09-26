import { buildAgendaOutlineTree } from "@/lib/meeting-v2/agenda-outline";
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
