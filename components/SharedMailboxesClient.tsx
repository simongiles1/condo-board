"use client";

import { useMemo, useState, useTransition } from "react";

import type {
  SharedMailboxOccupant,
  SharedMailboxStats,
  SharedMailboxSummary,
} from "@/lib/contacts/shared-mailboxes";
import {
  formatOccupancyDate,
  formatOccupancyRange,
  mailboxTimelineBounds,
  occupancyBarPercent,
  sharedMailboxStats,
} from "@/lib/contacts/shared-mailboxes";

const BAR_TONES = [
  "bg-teal-500",
  "bg-amber-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-lime-600",
  "bg-cyan-600",
  "bg-fuchsia-500",
] as const;

function barTone(index: number): string {
  return BAR_TONES[index % BAR_TONES.length]!;
}

function OccupancySwimlanes({
  mailbox,
  nowMs,
}: {
  mailbox: SharedMailboxSummary;
  nowMs: number;
}) {
  const bounds = mailboxTimelineBounds(mailbox, nowMs);
  const axisEndLabel = bounds
    ? mailbox.occupants.some((occupant) =>
        occupant.ranges.some((range) => !range.validTo),
      )
      ? "present"
      : formatOccupancyDate(new Date(bounds.endMs).toISOString())
    : null;

  return (
    <div>
      {bounds ? (
        <div className="mb-3 flex items-baseline justify-between gap-3 text-xs text-slate-500">
          <span>{formatOccupancyDate(new Date(bounds.startMs).toISOString())}</span>
          <span className="font-medium text-slate-600">{axisEndLabel}</span>
        </div>
      ) : (
        <p className="mb-3 text-xs text-slate-500">
          No dated occupancy yet — people are listed without a timeline.
        </p>
      )}

      <ul className="space-y-4">
        {mailbox.occupants.map((occupant, index) => (
          <OccupantRow
            key={occupant.personId}
            occupant={occupant}
            tone={barTone(index)}
            bounds={bounds}
            nowMs={nowMs}
          />
        ))}
      </ul>
    </div>
  );
}

function OccupantRow({
  occupant,
  tone,
  bounds,
  nowMs,
}: {
  occupant: SharedMailboxOccupant;
  tone: string;
  bounds: ReturnType<typeof mailboxTimelineBounds>;
  nowMs: number;
}) {
  const overallFrom =
    occupant.ranges
      .map((range) => range.validFrom)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;
  const overallTo = occupant.ranges.some((range) => !range.validTo)
    ? null
    : occupant.ranges
        .map((range) => range.validTo)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
  const evidenceCount = occupant.ranges.reduce(
    (sum, range) => sum + range.evidenceCount,
    0,
  );

  return (
    <li>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {occupant.personName}
            {occupant.isCurrent ? (
              <span className="ml-2 rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-teal-800">
                Current
              </span>
            ) : null}
            {occupant.sparseStub ? (
              <span className="ml-2 text-xs font-normal text-slate-500">
                stub
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {[
              occupant.currentOrganizationName,
              formatOccupancyRange(overallFrom, overallTo),
              evidenceCount > 0
                ? `${evidenceCount} evidence email${evidenceCount === 1 ? "" : "s"}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      {bounds ? (
        <div
          className="relative mt-2 h-7 overflow-hidden rounded-md bg-slate-100"
          role="img"
          aria-label={`${occupant.personName}: ${formatOccupancyRange(overallFrom, overallTo)}`}
        >
          {occupant.ranges
            .filter((range) => range.validFrom || range.validTo)
            .map((range, rangeIndex) => {
            const bar = occupancyBarPercent(
              range.validFrom,
              range.validTo,
              bounds,
              nowMs,
            );
            return (
              <div
                key={`${range.validFrom}-${range.validTo}-${rangeIndex}`}
                title={formatOccupancyRange(range.validFrom, range.validTo)}
                className={`absolute top-1 bottom-1 rounded-sm ${tone} ${
                  occupant.isCurrent ? "opacity-95" : "opacity-80"
                }`}
                style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
              />
            );
          })}
        </div>
      ) : null}
    </li>
  );
}

export function SharedMailboxesClient({
  initialMailboxes,
  initialStats,
}: {
  initialMailboxes: SharedMailboxSummary[];
  initialStats: SharedMailboxStats;
}) {
  const [mailboxes, setMailboxes] = useState(initialMailboxes);
  const [stats, setStats] = useState(initialStats);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(
    initialMailboxes[0]?.email ?? null,
  );
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nowMs = useMemo(() => Date.now(), []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return mailboxes;
    return mailboxes.filter((mailbox) => {
      if (mailbox.email.includes(needle)) return true;
      if (mailbox.currentPersonName?.toLowerCase().includes(needle)) return true;
      return mailbox.occupants.some(
        (occupant) =>
          occupant.personName.toLowerCase().includes(needle) ||
          occupant.currentOrganizationName?.toLowerCase().includes(needle),
      );
    });
  }, [mailboxes, query]);

  const selected =
    filtered.find((mailbox) => mailbox.email === selectedEmail) ??
    filtered[0] ??
    null;

  async function refreshData(): Promise<SharedMailboxSummary[] | null> {
    const res = await fetch("/api/contacts/registry?view=mailboxes");
    const json = (await res.json()) as {
      mailboxes?: SharedMailboxSummary[];
      stats?: SharedMailboxStats;
      error?: string;
    };
    if (!res.ok) {
      setMessage(json.error ?? "Could not refresh shared mailboxes.");
      return null;
    }
    const next = json.mailboxes ?? [];
    setMailboxes(next);
    setStats(json.stats ?? sharedMailboxStats(next));
    setSelectedEmail((prev) => {
      if (prev && next.some((mailbox) => mailbox.email === prev)) return prev;
      return next[0]?.email ?? null;
    });
    return next;
  }

  function refresh() {
    startTransition(async () => {
      setMessage(null);
      await refreshData();
    });
  }

  return (
    <div>
      <header className="mb-6">
        <dl className="flex flex-wrap gap-6 text-sm text-slate-700">
          <div>
            <dt className="text-slate-500">Shared mailboxes</dt>
            <dd className="font-semibold">{stats.mailboxCount}</dd>
          </div>
          <div>
            <dt className="text-slate-500">People on them</dt>
            <dd className="font-semibold">{stats.occupantCount}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-slate-600">
          Role and coverage addresses that more than one contact has used.
          Bars show when each person occupied the mailbox; an open end is
          still current.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={refresh}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
        {message ? (
          <p className="mt-3 text-sm text-slate-600" role="status">
            {message}
          </p>
        ) : null}
      </header>

      <div className="grid min-w-0 gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="flex max-h-[70vh] flex-col overflow-hidden border border-slate-200 bg-white">
          <div className="shrink-0 border-b border-slate-200 bg-slate-50 p-2">
            <label className="sr-only" htmlFor="shared-mailbox-filter">
              Filter shared mailboxes
            </label>
            <input
              id="shared-mailbox-filter"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by email or name"
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400"
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="p-4 text-sm text-slate-500">
                {mailboxes.length === 0
                  ? "No shared mailboxes yet. They appear when two or more people occupy the same address."
                  : "No mailboxes match this filter."}
              </li>
            ) : (
              filtered.map((mailbox) => {
                const active = selected?.email === mailbox.email;
                return (
                  <li key={mailbox.email}>
                    <button
                      type="button"
                      onClick={() => setSelectedEmail(mailbox.email)}
                      className={
                        active
                          ? "w-full border-b border-slate-100 bg-teal-50 px-3 py-2 text-left"
                          : "w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                      }
                    >
                      <span className="block break-all text-sm font-medium text-slate-900">
                        {mailbox.email}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {mailbox.occupantCount}{" "}
                        {mailbox.occupantCount === 1 ? "person" : "people"}
                        {mailbox.currentPersonName
                          ? ` · now ${mailbox.currentPersonName}`
                          : ""}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <section className="border border-slate-200 bg-white p-4">
          {!selected ? (
            <p className="text-sm text-slate-500">
              Select an email address to see who used it.
            </p>
          ) : (
            <>
              <h2 className="break-all text-lg font-semibold text-slate-900">
                {selected.email}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {selected.occupantCount}{" "}
                {selected.occupantCount === 1 ? "contact" : "contacts"}
                {selected.currentPersonName
                  ? ` · current occupant ${selected.currentPersonName}`
                  : ""}
              </p>
              <h3 className="mt-5 text-sm font-semibold text-slate-800">
                Occupancy
              </h3>
              <div className="mt-3">
                <OccupancySwimlanes mailbox={selected} nowMs={nowMs} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
