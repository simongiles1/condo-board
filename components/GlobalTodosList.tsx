"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { EmailSidePanel } from "@/components/EmailSidePanel";
import { LinkedConceptText } from "@/components/LinkedConceptText";
import { DISPLAY_TIME_ZONE, formatDisplayDate } from "@/lib/format/datetime";
import { formatMeetingDate } from "@/lib/format-meeting-date";

export type GlobalTodoItem = {
  id: string;
  assignee: string;
  role: string;
  description: string;
  deadline: string | null;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
  sourceKind: "meeting" | "email" | "manual";
  sourceMeetingTitle: string | null;
  sourceMeetingDate: string | null;
  sourceEmailId: string | null;
  sourceEmailThreadId: string | null;
  sourceEmailReceivedAt: string | null;
  sourceQuote: string | null;
  completePath?: string;
};

export type GlobalTodoScope = "working" | "archive";

type SourcePanelTarget = {
  emailId: string | null;
  threadId: string | null;
  highlightQuote: string | null;
  verifyLabel: string | null;
};

export type GlobalTodoTab = "due" | "open-ended" | "done";

export type GlobalTodoSort =
  | "reverse-chronological"
  | "chronological"
  | "due-soonest"
  | "due-latest"
  | "assignee";

type TodoListFilters = {
  sourceKinds: GlobalTodoItem["sourceKind"][];
  assignees: string[];
  dateFrom: string;
  dateTo: string;
  overdueOnly: boolean;
  query: string;
};

type Props = {
  items: GlobalTodoItem[];
  archiveItems?: GlobalTodoItem[];
};

const SCOPES: { id: GlobalTodoScope; label: string }[] = [
  { id: "working", label: "Working" },
  { id: "archive", label: "Archive" },
];

const TABS: { id: GlobalTodoTab; label: string }[] = [
  { id: "due", label: "Due" },
  { id: "open-ended", label: "Open-ended" },
  { id: "done", label: "Done" },
];

const SORT_OPTIONS: { id: GlobalTodoSort; label: string }[] = [
  { id: "reverse-chronological", label: "Reverse chronological" },
  { id: "chronological", label: "Chronological" },
  { id: "due-soonest", label: "Due date (soonest)" },
  { id: "due-latest", label: "Due date (latest)" },
  { id: "assignee", label: "Assignee (A–Z)" },
];

const SORT_SELECT_CLASS =
  "h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";

const SOURCE_KIND_OPTIONS: { id: GlobalTodoItem["sourceKind"]; label: string }[] =
  [
    { id: "email", label: "Email harvest" },
    { id: "meeting", label: "Meeting" },
    { id: "manual", label: "Manual" },
  ];

const EMPTY_FILTERS: TodoListFilters = {
  sourceKinds: [],
  assignees: [],
  dateFrom: "",
  dateTo: "",
  overdueOnly: false,
  query: "",
};

const ARCHIVE_PAGE_SIZE = 50;

export function GlobalTodosList({ items, archiveItems = [] }: Props) {
  const [scope, setScope] = useState<GlobalTodoScope>("working");
  const scopedItems = scope === "archive" ? archiveItems : items;
  const [sourcePanel, setSourcePanel] = useState<SourcePanelTarget | null>(
    null,
  );
  const [tab, setTab] = useState<GlobalTodoTab>(() =>
    items.some((item) => !item.completed && hasDeadline(item))
      ? "due"
      : "open-ended",
  );
  const [filters, setFilters] = useState<TodoListFilters>(EMPTY_FILTERS);
  const [sortBy, setSortBy] = useState<GlobalTodoSort>("reverse-chronological");
  const [archivePage, setArchivePage] = useState(1);

  useEffect(() => {
    setArchivePage(1);
  }, [scope, tab, filters, sortBy]);

  const assigneeOptions = useMemo(
    () => uniqueAssignees(scopedItems),
    [scopedItems],
  );

  const filtered = useMemo(
    () => scopedItems.filter((item) => matchesTodoFilters(item, filters)),
    [scopedItems, filters],
  );

  const counts = useMemo(() => {
    let due = 0;
    let openEnded = 0;
    let done = 0;
    for (const item of filtered) {
      if (item.completed) {
        done += 1;
      } else if (hasDeadline(item)) {
        due += 1;
      } else {
        openEnded += 1;
      }
    }
    return { due, "open-ended": openEnded, done };
  }, [filtered]);

  const visible = useMemo(
    () =>
      sortTodoItems(
        filtered.filter((item) => matchesTab(item, tab)),
        sortBy,
      ),
    [filtered, tab, sortBy],
  );

  const archiveTotalPages = Math.max(
    1,
    Math.ceil(visible.length / ARCHIVE_PAGE_SIZE),
  );
  const archiveSafePage = Math.min(archivePage, archiveTotalPages);
  const displayed =
    scope === "archive"
      ? visible.slice(
          (archiveSafePage - 1) * ARCHIVE_PAGE_SIZE,
          archiveSafePage * ARCHIVE_PAGE_SIZE,
        )
      : visible;
  const archiveRangeStart =
    visible.length > 0 ? (archiveSafePage - 1) * ARCHIVE_PAGE_SIZE + 1 : 0;
  const archiveRangeEnd = Math.min(
    archiveSafePage * ARCHIVE_PAGE_SIZE,
    visible.length,
  );

  const filtersActive = hasActiveTodoFilters(filters);
  const workingOpen = items.filter((item) => !item.completed).length;
  const archiveOpen = archiveItems.filter((item) => !item.completed).length;
  const scopeOpen = { working: workingOpen, archive: archiveOpen };

  if (!items.length && !archiveItems.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
        No global todos yet. Merge a meeting checklist, add a to-do, or extract
        to-dos from recent email.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1"
            role="tablist"
            aria-label="Working or archive"
          >
            {SCOPES.map((entry) => {
              const selected = scope === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => {
                    if (selected) return;
                    const nextItems =
                      entry.id === "archive" ? archiveItems : items;
                    setScope(entry.id);
                    setFilters(EMPTY_FILTERS);
                    setTab(
                      nextItems.some(
                        (item) => !item.completed && hasDeadline(item),
                      )
                        ? "due"
                        : nextItems.some((item) => !item.completed)
                          ? "open-ended"
                          : "done",
                    );
                  }}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    selected
                      ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {entry.label}
                  <span className="ml-1.5 text-xs font-medium text-slate-500">
                    ({scopeOpen[entry.id]})
                  </span>
                </button>
              );
            })}
          </div>
          <div
            className="inline-flex max-w-full flex-wrap rounded-xl border border-slate-200 bg-slate-100 p-1"
            role="tablist"
            aria-label="To-do status"
          >
          {TABS.map((entry) => {
            const selected = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  if (!selected) setTab(entry.id);
                }}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  selected
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {entry.label}
                <span className="ml-1.5 text-xs font-medium text-slate-500">
                  ({counts[entry.id]})
                </span>
              </button>
            );
          })}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Sort by</span>
            <select
              value={sortBy}
              onChange={(event) =>
                setSortBy(event.target.value as GlobalTodoSort)
              }
              aria-label="Sort to-dos"
              className={SORT_SELECT_CLASS}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <TodoFilterButton
            filters={filters}
            assigneeOptions={assigneeOptions}
            active={filtersActive}
            onApply={setFilters}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        {scope === "archive" && visible.length > ARCHIVE_PAGE_SIZE ? (
          <p className="shrink-0 text-xs text-slate-500">
            {archiveRangeStart}–{archiveRangeEnd} of {visible.length} archive
            to-do{visible.length === 1 ? "" : "s"}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.length ? (
            <ul className="space-y-2">
              {displayed.map((task) => (
                <TodoRow
                  key={task.id}
                  task={task}
                  sourceOpen={
                    sourcePanel != null &&
                    (sourcePanel.emailId === task.sourceEmailId ||
                      sourcePanel.threadId === task.sourceEmailThreadId)
                  }
                  onOpenSource={setSourcePanel}
                />
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
              {filtersActive
                ? "No to-dos match these filters."
                : emptyTabMessage(tab, scope)}
            </div>
          )}
        </div>

        {scope === "archive" && archiveTotalPages > 1 ? (
          <nav
            aria-label="Archive to-do pagination"
            className="flex shrink-0 items-center gap-2 border-t border-slate-200 pt-3 text-xs text-slate-600"
          >
            <button
              type="button"
              disabled={archiveSafePage <= 1}
              onClick={() => setArchivePage((page) => Math.max(1, page - 1))}
              className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="flex-1 text-center">
              Page {archiveSafePage} of {archiveTotalPages}
            </span>
            <button
              type="button"
              disabled={archiveSafePage >= archiveTotalPages}
              onClick={() =>
                setArchivePage((page) =>
                  Math.min(archiveTotalPages, page + 1),
                )
              }
              className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </nav>
        ) : null}
      </div>

      <EmailSidePanel
        emailId={sourcePanel?.emailId ?? null}
        threadId={sourcePanel?.threadId ?? null}
        highlightQuote={sourcePanel?.highlightQuote ?? null}
        verifyLabel={sourcePanel?.verifyLabel ?? null}
        onClose={() => setSourcePanel(null)}
      />
    </div>
  );
}

function TodoFilterButton({
  filters,
  assigneeOptions,
  active,
  onApply,
}: {
  filters: TodoListFilters;
  assigneeOptions: string[];
  active: boolean;
  onApply: (next: TodoListFilters) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState<TodoListFilters>(filters);

  useEffect(() => {
    if (menuOpen) setDraft(filters);
  }, [filters, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-label="Filter to-dos"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        title="Filter to-dos"
        className={`relative inline-flex h-8 w-8 items-center justify-center rounded-lg border bg-white shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 ${
          active
            ? "border-teal-600 text-teal-700"
            : "border-slate-200 text-slate-500"
        }`}
      >
        <FilterIcon />
        {active ? (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-teal-600 ring-2 ring-white"
          />
        ) : null}
      </button>

      {menuOpen ? (
        <div
          role="menu"
          aria-label="To-do filters"
          className="absolute right-0 top-[calc(100%+0.375rem)] z-20 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
        >
          <div className="space-y-4">
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Harvest type
              </legend>
              <div className="mt-2 space-y-1.5">
                {SOURCE_KIND_OPTIONS.map((option) => (
                  <label
                    key={option.id}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      checked={draft.sourceKinds.includes(option.id)}
                      onChange={() =>
                        setDraft((current) => ({
                          ...current,
                          sourceKinds: toggleValue(
                            current.sourceKinds,
                            option.id,
                          ),
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span className="text-sm text-slate-700">{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Associated with
              </legend>
              <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1">
                {assigneeOptions.map((name) => (
                  <label
                    key={name}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      checked={draft.assignees.includes(name)}
                      onChange={() =>
                        setDraft((current) => ({
                          ...current,
                          assignees: toggleValue(current.assignees, name),
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span className="text-sm text-slate-700">{name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="todo-filter-query"
                className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Description
              </label>
              <input
                id="todo-filter-query"
                type="search"
                value={draft.query}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    query: event.target.value,
                  }))
                }
                placeholder="Task, assignee, or quote…"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="todo-filter-date-from"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Source after
                </label>
                <input
                  id="todo-filter-date-from"
                  type="date"
                  value={draft.dateFrom}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      dateFrom: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
                />
              </div>
              <div>
                <label
                  htmlFor="todo-filter-date-to"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Source before
                </label>
                <input
                  id="todo-filter-date-to"
                  type="date"
                  value={draft.dateTo}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      dateTo: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={draft.overdueOnly}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    overdueOnly: event.target.checked,
                  }))
                }
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              />
              <span className="text-sm text-slate-700">Overdue only</span>
            </label>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => {
                  setDraft(EMPTY_FILTERS);
                  onApply(EMPTY_FILTERS);
                  setMenuOpen(false);
                }}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  onApply(draft);
                  setMenuOpen(false);
                }}
                className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TodoRow({
  task,
  sourceOpen,
  onOpenSource,
}: {
  task: GlobalTodoItem;
  sourceOpen: boolean;
  onOpenSource: (target: SourcePanelTarget) => void;
}) {
  const overdue = isOverdue(task.deadline);
  const canOpenSource = Boolean(
    task.sourceKind === "email" &&
      (task.sourceEmailThreadId || task.sourceEmailId),
  );
  const sourceDate = sourceDateLabel(task);

  function openSource() {
    onOpenSource({
      emailId: task.sourceEmailId,
      threadId: task.sourceEmailThreadId,
      highlightQuote: task.sourceQuote?.trim() || null,
      verifyLabel: task.description,
    });
  }

  return (
    <li
      className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border px-3 py-3 shadow-sm ${
        task.completed
          ? "border-slate-100 bg-white opacity-75"
          : sourceOpen
            ? "border-amber-300 bg-amber-50/40"
            : "border-slate-200 bg-white"
      } ${canOpenSource ? "cursor-pointer hover:border-amber-200 hover:bg-amber-50/30" : ""}`}
      onClick={canOpenSource ? openSource : undefined}
    >
      <div className="min-w-0 flex-1 space-y-2 text-sm text-slate-800">
        <p className={task.completed ? "line-through" : undefined}>
          <LinkedConceptText text={task.description} />
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {task.assignee.trim() ? (
            <span className="inline-flex rounded-full bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-900 ring-1 ring-violet-200">
              <LinkedConceptText text={assigneeLabel(task)} />
            </span>
          ) : null}
          <span className="inline-flex rounded-full bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
            {sourceKindLabel(task)}
          </span>
          {task.deadline ? (
            <span
              className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1 ${
                overdue
                  ? "bg-red-50 text-red-900 ring-red-200"
                  : "bg-orange-50 text-orange-900 ring-orange-200"
              }`}
            >
              {overdue ? "Overdue: " : "Due: "}
              {task.deadline}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-start gap-2">
        <span className="flex h-[34px] w-[10.5rem] shrink-0 items-center justify-end whitespace-nowrap text-xs font-medium text-slate-500">
          {sourceDate ?? ""}
        </span>
        {canOpenSource ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openSource();
            }}
            aria-label={
              task.sourceEmailThreadId ? "Open thread" : "Open email"
            }
            title={task.sourceEmailThreadId ? "Open thread" : "Open email"}
            className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          >
            <EyeIcon className="h-4 w-4" />
          </button>
        ) : null}
        {!task.completed ? (
        <CompleteButton
          id={task.id}
          completePath={task.completePath}
        />
        ) : (
          <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-900">
            Done
          </span>
        )}
      </div>
    </li>
  );
}

function CompleteButton({
  id,
  completePath,
}: {
  id: string;
  completePath?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markDone = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(completePath ?? `/api/global-todos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Could not update");
      }
      router.refresh();
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
        onClick={(event) => {
          event.stopPropagation();
          markDone();
        }}
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
      Per-meeting checklists stay on each meeting’s To-Do tab until you{" "}
      <strong className="font-semibold text-slate-800">
        Merge to global todos
      </strong>
      . Recent email harvests (last 120 days) land on{" "}
      <strong className="font-semibold text-slate-800">Working</strong>
      . Older harvests go to{" "}
      <strong className="font-semibold text-slate-800">Archive</strong>
      , which still splits open vs closed after thread close-out. Use{" "}
      <strong className="font-semibold text-slate-800">Add new to-do</strong>{" "}
      for one-off items.{" "}
      <Link href="/operations/meetings" className="text-teal-700 underline">
        Go to meetings
      </Link>
      .
    </p>
  );
}

function hasDeadline(item: GlobalTodoItem): boolean {
  return Boolean(item.deadline?.trim());
}

function matchesTab(item: GlobalTodoItem, tab: GlobalTodoTab): boolean {
  if (tab === "done") return item.completed;
  if (item.completed) return false;
  return tab === "due" ? hasDeadline(item) : !hasDeadline(item);
}

function hasActiveTodoFilters(filters: TodoListFilters): boolean {
  return (
    filters.sourceKinds.length > 0 ||
    filters.assignees.length > 0 ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo) ||
    filters.overdueOnly ||
    Boolean(filters.query.trim())
  );
}

function matchesTodoFilters(
  item: GlobalTodoItem,
  filters: TodoListFilters,
): boolean {
  if (
    filters.sourceKinds.length > 0 &&
    !filters.sourceKinds.includes(item.sourceKind)
  ) {
    return false;
  }

  if (filters.assignees.length > 0) {
    const name = item.assignee.trim() || "Unassigned";
    if (!filters.assignees.includes(name)) return false;
  }

  const query = filters.query.trim().toLowerCase();
  if (query) {
    const haystack = [
      item.description,
      item.assignee,
      item.sourceQuote ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (filters.dateFrom || filters.dateTo) {
    const key = sourceDateKey(item);
    if (!key) return false;
    if (filters.dateFrom && key < filters.dateFrom) return false;
    if (filters.dateTo && key > filters.dateTo) return false;
  }

  if (filters.overdueOnly && (item.completed || !isOverdue(item.deadline))) {
    return false;
  }

  return true;
}

function uniqueAssignees(items: GlobalTodoItem[]): string[] {
  const names = new Set<string>();
  for (const item of items) {
    names.add(item.assignee.trim() || "Unassigned");
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value];
}

function sourceChronology(item: GlobalTodoItem): string {
  if (item.sourceEmailReceivedAt) return item.sourceEmailReceivedAt;
  if (item.sourceMeetingDate) return `${item.sourceMeetingDate}T00:00:00.000Z`;
  return item.createdAt;
}

function sourceDateKey(item: GlobalTodoItem): string | null {
  if (item.sourceMeetingDate && !item.sourceEmailReceivedAt) {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(item.sourceMeetingDate.trim());
    if (match) return match[1];
  }
  return toDateKey(sourceChronology(item));
}

function toDateKey(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function sortTodoItems(
  items: GlobalTodoItem[],
  sortBy: GlobalTodoSort,
): GlobalTodoItem[] {
  const sorted = [...items];
  switch (sortBy) {
    case "reverse-chronological":
      sorted.sort((a, b) =>
        sourceChronology(b).localeCompare(sourceChronology(a)),
      );
      break;
    case "chronological":
      sorted.sort((a, b) =>
        sourceChronology(a).localeCompare(sourceChronology(b)),
      );
      break;
    case "due-soonest":
      sorted.sort((a, b) => {
        const aTime =
          parseDeadline(a.deadline)?.getTime() ?? Number.POSITIVE_INFINITY;
        const bTime =
          parseDeadline(b.deadline)?.getTime() ?? Number.POSITIVE_INFINITY;
        if (aTime !== bTime) return aTime - bTime;
        return sourceChronology(b).localeCompare(sourceChronology(a));
      });
      break;
    case "due-latest":
      sorted.sort((a, b) => {
        const aTime =
          parseDeadline(a.deadline)?.getTime() ?? Number.NEGATIVE_INFINITY;
        const bTime =
          parseDeadline(b.deadline)?.getTime() ?? Number.NEGATIVE_INFINITY;
        if (aTime !== bTime) return bTime - aTime;
        return sourceChronology(b).localeCompare(sourceChronology(a));
      });
      break;
    case "assignee":
      sorted.sort((a, b) => {
        const aName = a.assignee.trim() || "Unassigned";
        const bName = b.assignee.trim() || "Unassigned";
        const byName = aName.localeCompare(bName);
        if (byName !== 0) return byName;
        return sourceChronology(b).localeCompare(sourceChronology(a));
      });
      break;
  }
  return sorted;
}

function parseDeadline(deadline: string | null): Date | null {
  if (!deadline?.trim()) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(deadline.trim());
  if (iso) {
    const parsed = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = Date.parse(deadline);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isOverdue(deadline: string | null): boolean {
  const parsed = parseDeadline(deadline);
  if (!parsed) return false;
  return parsed < startOfToday();
}

function assigneeLabel(item: GlobalTodoItem): string {
  const role = item.role.trim();
  if (!role || role.toLowerCase() === "email") return item.assignee;
  return `${item.assignee} · ${role}`;
}

function sourceKindLabel(item: GlobalTodoItem): string {
  if (item.sourceKind === "email") return "Email harvest";
  if (item.sourceKind === "manual") return "Manual";
  if (item.sourceMeetingTitle) return item.sourceMeetingTitle;
  return "Meeting";
}

function sourceDateLabel(item: GlobalTodoItem): string | null {
  if (item.sourceEmailReceivedAt) {
    return formatDisplayDate(item.sourceEmailReceivedAt);
  }
  if (item.sourceMeetingDate) {
    const date = item.sourceMeetingDate.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? formatMeetingDate(date)
      : date;
  }
  if (item.createdAt) return formatDisplayDate(item.createdAt);
  return null;
}

function emptyTabMessage(
  tab: GlobalTodoTab,
  scope: GlobalTodoScope,
): string {
  if (scope === "archive") {
    if (tab === "due") return "No dated archive to-dos.";
    if (tab === "done") return "No closed archive to-dos yet.";
    return "No open-ended archive to-dos.";
  }
  if (tab === "due") return "No dated to-dos.";
  if (tab === "done") return "No completed to-dos yet.";
  return "No open-ended to-dos.";
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12s-3.75 6.75-9.75 6.75S2.25 12 2.25 12z"
      />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg
      aria-hidden
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 4.5h18M6 12h12M10 19.5h4"
      />
    </svg>
  );
}
