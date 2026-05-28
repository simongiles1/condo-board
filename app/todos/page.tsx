export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { GlobalTodosPageClient } from "./GlobalTodosPageClient";
import { fetchGlobalTodoRows } from "@/lib/todos/global-todos";
import type { GlobalTodoItem } from "@/components/GlobalTodosList";

export default async function GlobalTodosPage() {
  const rows = await fetchGlobalTodoRows();

  const items: GlobalTodoItem[] = rows.map((row) => ({
    id: row.id,
    assignee: row.assignee,
    role: row.role,
    description: row.description,
    deadline: row.deadline,
    completed: row.completed,
    sourceMeetingTitle: row.sourceMeetingTitle,
    sourceMeetingDate: row.sourceMeetingDate,
  }));

  const outstanding = items.filter((item) => !item.completed).length;

  return <GlobalTodosPageClient items={items} outstanding={outstanding} />;
}
