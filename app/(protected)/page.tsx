export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import Link from "next/link";

import { fetchGlobalTodoRows } from "@/lib/todos/global-todos";
import { isWorkingListTodo } from "@/lib/email-analysis/todo-lifecycle";

export default async function DashboardPage() {
  const rows = await fetchGlobalTodoRows();
  const outstanding = rows.filter(
    (row) =>
      !row.completed &&
      isWorkingListTodo(row.sourceKind, row.sourceEmailReceivedAt),
  ).length;

  return (
    <section className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Overview
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">
          Board checklist
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          What still needs to be done lives on one list: meetings, recent email
          harvests, and manual items. Older email harvests are on Archive.
        </p>
      </div>
      <Link
        href="/operations/todos"
        className="inline-flex rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-teal-800 shadow-sm hover:border-teal-300 hover:bg-teal-50"
      >
        Open global to-dos ({outstanding} outstanding) →
      </Link>
    </section>
  );
}
