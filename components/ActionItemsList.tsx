"use client";

import { useMemo, useState, type ReactNode } from "react";

export type DashboardActionItem = {
  id: string;
  assignee: string;
  role: string;
  description: string;
  deadline: string | null;
  meetingTitle: string;
  meetingDate: string;
};

type Props = {
  items: DashboardActionItem[];
};

export function ActionItemsList({ items }: Props) {
  const grouped = useMemo(() => {
    const map = new Map<string, DashboardActionItem[]>();
    items.forEach((item) => {
      const key = `${item.assignee}|${item.role}`;
      const arr = map.get(key) ?? [];
      arr.push(item);
      map.set(key, arr);
    });
    return Array.from(map.entries());
  }, [items]);

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
        Nothing outstanding yet — finalize meetings to hydrate action items here.
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
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-3"
                >
                  <div className="max-w-xl space-y-2 text-sm text-slate-800">
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {task.meetingTitle}{" "}
                      <span className="normal-case text-teal-800">
                        · {task.meetingDate}
                      </span>
                    </p>
                    <p>{task.description}</p>
                    {task.deadline ? (
                      <span className="inline-flex rounded-full bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-orange-900 ring-1 ring-orange-200">
                        Deadline: {task.deadline}
                      </span>
                    ) : null}
                  </div>
                  <CompleteButton id={task.id} />
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
      const res = await fetch(`/api/action-items/${id}`, {
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
    status = <p className="max-w-[200px] text-right text-[11px] text-red-600">{error}</p>;
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
