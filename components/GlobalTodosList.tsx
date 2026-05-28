"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

export type GlobalTodoItem = {
  id: string;
  assignee: string;
  role: string;
  description: string;
  deadline: string | null;
  completed: boolean;
  sourceMeetingTitle: string | null;
  sourceMeetingDate: string | null;
};

type Props = {
  items: GlobalTodoItem[];
  showCompleted?: boolean;
};

export function GlobalTodosList({ items, showCompleted = false }: Props) {
  const visible = useMemo(
    () => (showCompleted ? items : items.filter((item) => !item.completed)),
    [items, showCompleted],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, GlobalTodoItem[]>();
    visible.forEach((item) => {
      const key = `${item.assignee}|${item.role}`;
      const arr = map.get(key) ?? [];
      arr.push(item);
      map.set(key, arr);
    });
    return Array.from(map.entries());
  }, [visible]);

  if (!visible.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
        {items.length
          ? "No outstanding global todos — toggle “Show completed” to review finished items."
          : "No global todos yet. Open a meeting’s To-Do tab and use “Merge to global todos” to build the board-wide checklist."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {grouped.map(([key, todos]) => {
        const segments = key.split("|");
        const heading = `${segments[0]} — ${segments[1]}`;
        return (
          <section
            key={key}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <header className="mb-3 text-base font-semibold text-slate-900">
              {heading}
            </header>
            <ul className="space-y-2">
              {todos.map((task) => (
                <li
                  key={task.id}
                  className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border px-3 py-3 ${
                    task.completed
                      ? "border-slate-100 bg-slate-50/80 opacity-75"
                      : "border-slate-100 bg-slate-50"
                  }`}
                >
                  <div className="max-w-xl space-y-2 text-sm text-slate-800">
                    {task.sourceMeetingTitle ? (
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        From {task.sourceMeetingTitle}
                        {task.sourceMeetingDate ? (
                          <span className="normal-case text-teal-800">
                            {" "}
                            · {task.sourceMeetingDate}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    <p className={task.completed ? "line-through" : undefined}>
                      {task.description}
                    </p>
                    {task.deadline ? (
                      <span className="inline-flex rounded-full bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-orange-900 ring-1 ring-orange-200">
                        Deadline: {task.deadline}
                      </span>
                    ) : null}
                  </div>
                  {!task.completed ? (
                    <CompleteButton id={task.id} />
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-900">
                      Done
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function CompleteButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markDone = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/global-todos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Could not update");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  let status: ReactNode = null;
  if (error) {
    status = (
      <p className="max-w-[200px] text-right text-[11px] text-red-600">{error}</p>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => markDone()}
        disabled={loading}
        className="rounded-md bg-teal-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Saving..." : "Mark complete"}
      </button>
      {status}
    </div>
  );
}

export function GlobalTodosEmptyHint() {
  return (
    <p className="text-sm text-slate-600">
      Per-meeting checklists stay on each meeting’s To-Do tab. Use{" "}
      <strong className="font-semibold text-slate-800">
        Merge to global todos
      </strong>{" "}
      there to consolidate items here with AI deduplication, or use{" "}
      <strong className="font-semibold text-slate-800">Add new to-do</strong>{" "}
      for one-off items.{" "}
      <Link href="/meetings" className="text-teal-700 underline">
        Go to meetings
      </Link>
    </p>
  );
}
