export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { GlobalTodosPageClient } from "./GlobalTodosPageClient";
import type { GlobalTodoItem } from "@/components/GlobalTodosList";
import { loadArchivedEmailTodos } from "@/lib/email-analysis/todo-working-list";
import { isWorkingListTodo } from "@/lib/email-analysis/todo-lifecycle";
import {
  conceptsUsedInTexts,
  type LinkedConcept,
} from "@/lib/entities/concept-links";
import { loadConceptIndex } from "@/lib/entities/load-concept-index";
import { fetchGlobalTodoRows } from "@/lib/todos/global-todos";

function toWorkingItem(
  row: Awaited<ReturnType<typeof fetchGlobalTodoRows>>[number],
): GlobalTodoItem {
  return {
    id: row.id,
    assignee: row.assignee,
    role: row.role,
    description: row.description,
    deadline: row.deadline,
    completed: row.completed,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    sourceKind: row.sourceKind,
    sourceMeetingTitle: row.sourceMeetingTitle,
    sourceMeetingDate: row.sourceMeetingDate,
    sourceEmailId: row.sourceEmailId,
    sourceEmailThreadId: row.sourceEmailThreadId,
    sourceEmailReceivedAt: row.sourceEmailReceivedAt,
    sourceQuote: row.sourceQuote,
  };
}

export default async function GlobalTodosPage() {
  const [rows, archiveRows] = await Promise.all([
    fetchGlobalTodoRows(),
    loadArchivedEmailTodos(),
  ]);

  const items: GlobalTodoItem[] = rows
    .filter((row) =>
      isWorkingListTodo(row.sourceKind, row.sourceEmailReceivedAt),
    )
    .map(toWorkingItem);

  const archiveItems: GlobalTodoItem[] = archiveRows.map((row) => ({
    id: row.id,
    assignee: row.assignee,
    role: row.role,
    description: row.description,
    deadline: row.deadline,
    completed: row.completed,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    sourceKind: row.sourceKind,
    sourceMeetingTitle: row.sourceMeetingTitle,
    sourceMeetingDate: row.sourceMeetingDate,
    sourceEmailId: row.sourceEmailId,
    sourceEmailThreadId: row.sourceEmailThreadId,
    sourceEmailReceivedAt: row.sourceEmailReceivedAt,
    sourceQuote: row.sourceQuote,
    completePath: `/api/action-items/email-${row.id}`,
  }));

  let concepts: LinkedConcept[] = [];
  try {
    concepts = conceptsUsedInTexts(
      [...items, ...archiveItems].flatMap((item) => [
        item.assignee,
        item.description,
      ]),
      await loadConceptIndex(),
    );
  } catch (error) {
    console.error("[global-todos:concept-index]", error);
  }

  const outstanding = items.filter((item) => !item.completed).length;

  return (
    <GlobalTodosPageClient
      items={items}
      archiveItems={archiveItems}
      outstanding={outstanding}
      concepts={concepts}
    />
  );
}
