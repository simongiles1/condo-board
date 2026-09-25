import { buildAgendaOutlineTree } from "@/lib/meeting-v2/agenda-outline";
import type { RecordingHealth } from "@/lib/meeting-v2/live-clock";

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
  agendaItemId: string;
  mediaOffsetMs: number;
  actorIdentity: string;
  createdAt: string;
};

export type LiveRoomSnapshot = {
  configured: boolean;
  roomName: string | null;
  mediaStartedAt: string | null;
  activeAgendaItemId: string | null;
  leaves: LiveRoomLeaf[];
  navigation: LiveNavigationEventView[];
  recording: RecordingHealth;
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
