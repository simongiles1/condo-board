import { useMemo, useState } from "react";

import type { DevNoteRow } from "@/lib/notes/fetch-notes";
import { formatDateTime } from "@/lib/format/datetime";
import {
  DEV_NOTE_STATUSES,
  DEV_NOTE_STATUS_LABELS,
  type DevNoteStatus,
} from "@/lib/notes/status";

export type DevNoteItem = DevNoteRow;

type KindFilter = "all" | "bug" | "feature";

const FILTER_OPTIONS: Array<{ id: KindFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "bug", label: "Bugs" },
  { id: "feature", label: "Features" },
];

function PaperclipIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function KindBadge({ kind }: { kind: "bug" | "feature" }) {
  const isBug = kind === "bug";

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
        isBug ? "bg-red-50 text-red-800" : "bg-teal-50 text-teal-800"
      }`}
    >
      {isBug ? "Bug" : "Feature"}
    </span>
  );
}

const STATUS_SELECT_CLASS =
  "w-full min-w-[7.5rem] rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100";

function StatusSelect({
  status,
  disabled,
  onChange,
}: {
  status: DevNoteStatus;
  disabled?: boolean;
  onChange: (status: DevNoteStatus) => void;
}) {
  return (
    <select
      value={status}
      disabled={disabled}
      aria-label="Status"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onChange={(event) => {
        event.stopPropagation();
        onChange(event.target.value as DevNoteStatus);
      }}
      className={STATUS_SELECT_CLASS}
    >
      {DEV_NOTE_STATUSES.map((value) => (
        <option key={value} value={value}>
          {DEV_NOTE_STATUS_LABELS[value]}
        </option>
      ))}
    </select>
  );
}

function AttachmentsCell({ count }: { count: number }) {
  if (count === 0) {
    return <span className="text-slate-300">—</span>;
  }

  const title = `${count} attachment${count === 1 ? "" : "s"}`;

  return (
    <span
      title={title}
      aria-label={title}
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-700 ring-1 ring-slate-200"
    >
      <PaperclipIcon />
      <span>{count}</span>
    </span>
  );
}

type Props = {
  items: DevNoteItem[];
  onSelectNote: (note: DevNoteItem) => void;
  onStatusChange: (note: DevNoteItem, status: DevNoteStatus) => void | Promise<void>;
  statusBusy?: boolean;
};

export function DevNotesList({
  items,
  onSelectNote,
  onStatusChange,
  statusBusy = false,
}: Props) {
  const [filter, setFilter] = useState<KindFilter>("all");

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((note) => note.kind === filter);
  }, [items, filter]);

  const counts = useMemo(
    () => ({
      all: items.length,
      bug: items.filter((n) => n.kind === "bug").length,
      feature: items.filter((n) => n.kind === "feature").length,
    }),
    [items],
  );

  const emptyMessage =
    filter === "bug"
      ? "No bugs recorded yet."
      : filter === "feature"
        ? "No feature ideas recorded yet."
        : "No bugs or features recorded yet.";

  return (
    <div className="space-y-4">
      <div
        className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-100 p-0.5"
        role="group"
        aria-label="Filter notes by type"
      >
        {FILTER_OPTIONS.map((option) => {
          const selected = filter === option.id;

          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setFilter(option.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                selected
                  ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {option.label}
              <span className="ml-1.5 tabular-nums text-slate-500">
                ({counts[option.id]})
              </span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-500">
          {emptyMessage}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th
                  scope="col"
                  className="w-24 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Type
                </th>
                <th
                  scope="col"
                  className="w-36 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="w-48 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Title
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Description
                </th>
                <th
                  scope="col"
                  className="w-40 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Date
                </th>
                <th
                  scope="col"
                  className="w-24 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Attachments
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((note) => (
                <tr
                  key={note.id}
                  onClick={() => onSelectNote(note)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectNote(note);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Edit ${note.kind}: ${note.title}`}
                  className="cursor-pointer hover:bg-slate-50/80 focus:bg-slate-50/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
                >
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    <KindBadge kind={note.kind} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    <StatusSelect
                      status={note.status}
                      disabled={statusBusy}
                      onChange={(status) => void onStatusChange(note, status)}
                    />
                  </td>
                  <td className="px-3 py-2 align-top font-medium text-slate-900">
                    {note.title}
                  </td>
                  <td className="max-w-md px-3 py-2 align-top text-slate-700">
                    <p className="line-clamp-2 whitespace-pre-wrap">
                      {note.description}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top text-slate-600">
                    <time dateTime={note.createdAt}>
                      {formatDateTime(note.createdAt)}
                    </time>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    <AttachmentsCell count={note.screenshots.length} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
