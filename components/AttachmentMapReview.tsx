"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ZoomablePdfViewer } from "@/components/ZoomablePdfViewer";
import { agendaItemIndentDepth } from "@/lib/meeting-v2/agenda-outline";
import {
  buildAttachmentMap,
  type AttachmentMapBand,
  type AttachmentMapRange,
} from "@/lib/meeting-v2/attachment-map";

type StatusPayload = {
  meeting: {
    title: string;
    upcomingMeeting?: { agendaContentEndsAtPage: number } | null;
    counts: { documentPages: number };
  };
  items: Array<{
    id: string;
    title: string;
    itemNumber: string | null;
    sectionLabel?: string | null;
    sourcePages?: number[];
  }>;
  sources: {
    boardPackage: { pageCount: number | null } | null;
  };
};

type OpenRange = {
  agendaItemId: string;
  start: number;
  end: number;
};

const ITEM_COLORS = [
  "bg-teal-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-orange-500",
  "bg-rose-500",
  "bg-indigo-500",
  "bg-lime-600",
];

/**
 * Review screen between package analysis and the live room.
 * Shows which agenda items own attachment pages, and which package pages are still unlinked.
 */
export function AttachmentMapReview({ meetingId }: { meetingId: string }) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRange, setOpenRange] = useState<OpenRange | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/v2/meetings/${meetingId}/status`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | (StatusPayload & { error?: string })
          | null;
        if (!response.ok || !payload || payload.error) {
          throw new Error(payload?.error ?? "Could not load the meeting.");
        }
        if (!cancelled) setStatus(payload);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load the meeting.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const split = status?.meeting.upcomingMeeting?.agendaContentEndsAtPage ?? null;
  const pageCount =
    status?.sources.boardPackage?.pageCount ?? status?.meeting.counts.documentPages ?? 0;
  const map = useMemo(() => {
    if (!status || split == null || pageCount < 1) return null;
    return buildAttachmentMap({
      items: status.items.map((item) => ({
        id: item.id,
        itemNumber: item.itemNumber,
        title: item.title,
        sourcePages: item.sourcePages ?? [],
        sectionLabel: item.sectionLabel,
      })),
      agendaContentEndsAtPage: split,
      pageCount,
    });
  }, [status, split, pageCount]);

  const colorByItem = useMemo(() => {
    const colors = new Map<string, string>();
    if (!map) return colors;
    for (const row of map.rows) {
      if (!row.agendaItemId || row.attachmentRanges.length === 0 || colors.has(row.agendaItemId)) {
        continue;
      }
      colors.set(row.agendaItemId, ITEM_COLORS[colors.size % ITEM_COLORS.length] ?? ITEM_COLORS[0]);
    }
    return colors;
  }, [map]);

  function openItem(agendaItemId: string, ranges: AttachmentMapRange[]) {
    const first = ranges[0];
    if (!first) {
      setOpenRange(null);
      return;
    }
    setOpenRange({ agendaItemId, start: first.start, end: first.end });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950 text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link
          href={`/operations/meetings/v2/${meetingId}`}
          className="text-sm font-medium text-slate-300 hover:text-white"
        >
          &larr; Back to meeting
        </Link>
        <p className="text-sm text-slate-300">{status?.meeting.title ?? "Attachment map"}</p>
        <Link
          href={`/operations/meetings/v2/${meetingId}/room`}
          className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950"
        >
          Start meeting
        </Link>
      </header>

      {error ? <p className="px-4 pb-3 text-sm text-rose-200">{error}</p> : null}
      {!error && !status ? <p className="px-4 pb-3 text-sm text-slate-300">Loading package…</p> : null}
      {status && split == null ? (
        <p className="px-4 pb-3 text-sm text-slate-300">
          This meeting has no agenda and attachment split to review.
        </p>
      ) : null}

      {map ? (
        <>
          <section className="px-4 pb-3">
            <div className="flex h-8 overflow-hidden rounded-lg bg-slate-800">
              {map.bands.map((band) => (
                <MapBand
                  key={`${band.kind}-${band.start}-${band.end}`}
                  band={band}
                  pageCount={map.pageCount}
                  colorClass={
                    band.kind === "linked" ? colorByItem.get(band.agendaItemId) ?? "bg-teal-500" : ""
                  }
                  selected={
                    band.kind === "linked" &&
                    openRange?.agendaItemId === band.agendaItemId &&
                    openRange.start === band.start &&
                    openRange.end === band.end
                  }
                  onOpen={
                    band.kind === "linked"
                      ? () =>
                          setOpenRange({
                            agendaItemId: band.agendaItemId,
                            start: band.start,
                            end: band.end,
                          })
                      : undefined
                  }
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
              <Legend swatch="bg-slate-500" label="Agenda pages" />
              <Legend swatch="bg-teal-500" label="Linked attachments, one color per item" />
              <Legend swatch="bg-amber-400" label="Attachment pages not linked" />
              <span>
                {map.itemsWithoutAttachments} agenda item
                {map.itemsWithoutAttachments === 1 ? "" : "s"} with no attachments
                {" · "}
                {map.unlinkedAttachmentPages} attachment page
                {map.unlinkedAttachmentPages === 1 ? "" : "s"} not linked
              </span>
            </div>
          </section>

          <div className="relative mx-4 mb-4 flex min-h-0 flex-1 gap-3">
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white text-slate-900">
              {openRange ? (
                <>
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                    <p className="truncate text-sm font-semibold">
                      {rangeLabel(openRange.start, openRange.end)}
                    </p>
                    <button
                      type="button"
                      onClick={() => setOpenRange(null)}
                      className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                    >
                      Close
                    </button>
                  </div>
                  <ZoomablePdfViewer
                    key={`${openRange.start}-${openRange.end}`}
                    className="min-h-0 flex-1"
                    url={`/api/meetings/${meetingId}/board-package`}
                    initialPage={openRange.start}
                    citedEnd={openRange.end}
                  />
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-slate-500">
                  Choose an agenda item that has attachment pages to open that part of the package.
                </div>
              )}
            </main>
            <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-sm">
              <p className="border-b border-slate-200 px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Agenda
              </p>
              <ul className="min-h-0 flex-1 overflow-auto p-1">
                {map.rows.map((row) => {
                  const paddingLeft = `${12 + agendaItemIndentDepth(row.itemNumber) * 16}px`;
                  if (row.kind === "heading" || !row.agendaItemId) {
                    return (
                      <li key={row.key}>
                        <div
                          style={{ paddingLeft }}
                          className="w-full rounded-lg py-1.5 pr-2 text-left text-sm font-medium text-slate-600"
                        >
                          {row.itemNumber ? `${row.itemNumber} ` : ""}
                          {row.title}
                        </div>
                      </li>
                    );
                  }
                  const missing = row.attachmentRanges.length === 0;
                  const selected = openRange?.agendaItemId === row.agendaItemId;
                  return (
                    <li key={row.key}>
                      <div
                        style={{ paddingLeft }}
                        className={`rounded-lg py-1.5 pr-2 ${
                          selected
                            ? "bg-slate-900 text-white"
                            : missing
                              ? "bg-amber-50 text-amber-950"
                              : ""
                        }`}
                      >
                        <button
                          type="button"
                          className="w-full text-left text-sm"
                          onClick={() => openItem(row.agendaItemId!, row.attachmentRanges)}
                        >
                          {row.itemNumber ? `${row.itemNumber} ` : ""}
                          {row.title}
                        </button>
                        {row.attachmentRanges.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {row.attachmentRanges.map((range) => {
                              const active =
                                selected &&
                                openRange?.start === range.start &&
                                openRange?.end === range.end;
                              return (
                                <button
                                  key={`${range.start}-${range.end}`}
                                  type="button"
                                  onClick={() =>
                                    setOpenRange({
                                      agendaItemId: row.agendaItemId!,
                                      start: range.start,
                                      end: range.end,
                                    })
                                  }
                                  className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${
                                    active
                                      ? "bg-white/15 text-white"
                                      : "bg-slate-100 text-teal-800 hover:bg-slate-200"
                                  }`}
                                >
                                  {rangeLabel(range.start, range.end)}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="mt-0.5 text-xs text-amber-800">No attachment pages</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}

function rangeLabel(start: number, end: number): string {
  return start === end ? `Page ${start}` : `Pages ${start}–${end}`;
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-4 rounded-sm ${swatch}`} />
      {label}
    </span>
  );
}

function MapBand({
  band,
  pageCount,
  colorClass,
  selected,
  onOpen,
}: {
  band: AttachmentMapBand;
  pageCount: number;
  colorClass: string;
  selected: boolean;
  onOpen?: () => void;
}) {
  const width = `${((band.end - band.start + 1) / pageCount) * 100}%`;
  const label = rangeLabel(band.start, band.end);
  const className = `h-full min-w-px ${
    band.kind === "agenda" ? "bg-slate-500" : band.kind === "gap" ? "bg-amber-400" : colorClass
  } ${selected ? "ring-2 ring-inset ring-white" : ""}`;
  if (!onOpen) {
    return <div title={label} style={{ width }} className={className} />;
  }
  return (
    <button
      type="button"
      title={label}
      style={{ width }}
      className={className}
      onClick={onOpen}
    />
  );
}
