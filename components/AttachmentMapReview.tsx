"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ZoomablePdfViewer } from "@/components/ZoomablePdfViewer";
import { agendaItemIndentDepth } from "@/lib/meeting-v2/agenda-outline";
import {
  attachmentPageCards,
  buildAttachmentMap,
  type AttachmentMapRange,
  type AttachmentPageCard,
} from "@/lib/meeting-v2/attachment-map";
import { loadPdfBuffer, renderPdfPageRangeToCanvases } from "@/lib/pdf/pdfjs-browser";

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
  agendaItemId: string | null;
  start: number;
  end: number;
  label: string;
};

type ItemColor = { border: string; wash: string; dot: string };

const ITEM_COLORS: ItemColor[] = [
  { border: "border-teal-500", wash: "bg-teal-50", dot: "bg-teal-500" },
  { border: "border-sky-500", wash: "bg-sky-50", dot: "bg-sky-500" },
  { border: "border-violet-500", wash: "bg-violet-50", dot: "bg-violet-500" },
  { border: "border-emerald-500", wash: "bg-emerald-50", dot: "bg-emerald-500" },
  { border: "border-orange-500", wash: "bg-orange-50", dot: "bg-orange-500" },
  { border: "border-rose-500", wash: "bg-rose-50", dot: "bg-rose-500" },
  { border: "border-indigo-500", wash: "bg-indigo-50", dot: "bg-indigo-500" },
  { border: "border-lime-600", wash: "bg-lime-50", dot: "bg-lime-600" },
];

const UNLINKED_COLOR: ItemColor = {
  border: "border-amber-400",
  wash: "bg-amber-50",
  dot: "bg-amber-400",
};

/**
 * Review screen between package analysis and the live room.
 * Attachment pages are thumbnails colored to match the agenda item that owns them.
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

  const cards = useMemo(() => (map ? attachmentPageCards(map.bands) : []), [map]);

  const colorByItem = useMemo(() => {
    const colors = new Map<string, ItemColor>();
    if (!map) return colors;
    for (const row of map.rows) {
      if (!row.agendaItemId || row.attachmentRanges.length === 0 || colors.has(row.agendaItemId)) {
        continue;
      }
      colors.set(
        row.agendaItemId,
        ITEM_COLORS[colors.size % ITEM_COLORS.length] ?? ITEM_COLORS[0],
      );
    }
    return colors;
  }, [map]);

  const pdfUrl = `/api/meetings/${meetingId}/board-package`;

  function openRanges(agendaItemId: string, ranges: AttachmentMapRange[], label: string) {
    const first = ranges[0];
    if (!first) return;
    setOpenRange({ agendaItemId, start: first.start, end: first.end, label });
  }

  function openCard(card: AttachmentPageCard) {
    if (!map || !card.agendaItemId) {
      setOpenRange({
        agendaItemId: null,
        start: card.page,
        end: card.page,
        label: `Page ${card.page}`,
      });
      return;
    }
    const row = map.rows.find((item) => item.agendaItemId === card.agendaItemId);
    const range = row?.attachmentRanges.find(
      (item) => card.page >= item.start && card.page <= item.end,
    ) ?? { start: card.page, end: card.page };
    const title = row ? `${row.itemNumber ? `${row.itemNumber} ` : ""}${row.title}` : `Page ${card.page}`;
    setOpenRange({
      agendaItemId: card.agendaItemId,
      start: range.start,
      end: range.end,
      label: title,
    });
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
        <div className="mx-4 mb-4 flex min-h-0 flex-1 gap-3">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white text-slate-900">
            {openRange ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setOpenRange(null)}
                    className="rounded-md px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    &larr; Back to pages
                  </button>
                  <p className="truncate text-sm font-semibold">{openRange.label}</p>
                </div>
                <ZoomablePdfViewer
                  key={`${openRange.start}-${openRange.end}`}
                  className="min-h-0 flex-1"
                  url={pdfUrl}
                  initialPage={openRange.start}
                  citedEnd={openRange.end}
                />
              </>
            ) : (
              <AttachmentThumbnailGrid
                url={pdfUrl}
                cards={cards}
                colorFor={(agendaItemId) =>
                  agendaItemId ? colorByItem.get(agendaItemId) ?? UNLINKED_COLOR : UNLINKED_COLOR
                }
                onOpen={openCard}
              />
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
                const color = colorByItem.get(row.agendaItemId);
                const selected = openRange?.agendaItemId === row.agendaItemId;
                return (
                  <li key={row.key}>
                    <button
                      type="button"
                      style={{ paddingLeft }}
                      disabled={missing}
                      onClick={() =>
                        openRanges(
                          row.agendaItemId!,
                          row.attachmentRanges,
                          `${row.itemNumber ? `${row.itemNumber} ` : ""}${row.title}`,
                        )
                      }
                      className={`flex w-full items-start gap-2 rounded-lg py-1.5 pr-2 text-left text-sm disabled:cursor-default ${
                        selected
                          ? "bg-slate-900 text-white"
                          : missing
                            ? "bg-amber-50 text-amber-950"
                            : `${color?.wash ?? ""} hover:bg-slate-50`
                      }`}
                    >
                      <span
                        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm ${
                          missing ? "bg-amber-400" : color?.dot ?? "bg-slate-300"
                        }`}
                      />
                      <span>
                        {row.itemNumber ? `${row.itemNumber} ` : ""}
                        {row.title}
                        {missing ? (
                          <span className="mt-0.5 block text-xs text-amber-800">No attachment pages</span>
                        ) : (
                          <span className={`mt-0.5 block text-xs ${selected ? "text-white/70" : "text-slate-500"}`}>
                            {row.attachmentRanges.map((range) => rangeLabel(range.start, range.end)).join(", ")}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function rangeLabel(start: number, end: number): string {
  return start === end ? `Page ${start}` : `Pages ${start}–${end}`;
}

function AttachmentThumbnailGrid({
  url,
  cards,
  colorFor,
  onOpen,
}: {
  url: string;
  cards: AttachmentPageCard[];
  colorFor: (agendaItemId: string | null) => ItemColor;
  onOpen: (card: AttachmentPageCard) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const rendered = useRef(new Set<number>());
  const started = useRef(new Set<number>());
  const pending = useRef(new Set<number>());
  const dataRef = useRef<ArrayBuffer | null>(null);
  const [pdfReady, setPdfReady] = useState(false);

  const flush = useCallback(() => {
    const data = dataRef.current;
    if (!data) return;
    const pages = [...pending.current].filter(
      (page) => !rendered.current.has(page) && !started.current.has(page),
    );
    pending.current.clear();
    for (const page of pages) started.current.add(page);
    if (pages.length === 0) return;
    void renderPdfPageRangeToCanvases(
      data,
      pages,
      (page) => canvasRefs.current.get(page) ?? null,
      0.22,
    ).then(() => {
      for (const page of pages) rendered.current.add(page);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    rendered.current = new Set();
    started.current = new Set();
    setPdfReady(false);
    void loadPdfBuffer(url).then((data) => {
      if (cancelled) return;
      dataRef.current = data;
      setPdfReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!pdfReady) return;
    const root = gridRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll<HTMLElement>("[data-attachment-page]");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const page = Number((entry.target as HTMLElement).dataset.attachmentPage);
          if (Number.isInteger(page) && !rendered.current.has(page)) pending.current.add(page);
        }
        flush();
      },
      { root, rootMargin: "240px" },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [pdfReady, cards, flush]);

  return (
    <div ref={gridRef} className="min-h-0 flex-1 overflow-auto p-4">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
        {cards.map((card) => {
          const color = colorFor(card.agendaItemId);
          return (
            <li key={card.page}>
              <button
                type="button"
                data-attachment-page={card.page}
                onClick={() => onOpen(card)}
                className={`flex w-full flex-col overflow-hidden rounded-lg border-2 bg-white text-left ${color.border}`}
              >
                <canvas
                  ref={(node) => {
                    if (node) canvasRefs.current.set(card.page, node);
                    else canvasRefs.current.delete(card.page);
                  }}
                  className="h-36 w-full bg-slate-100 object-contain object-top"
                />
                <span className={`px-2 py-1 text-xs font-medium ${color.wash}`}>
                  Page {card.page}
                  {card.agendaItemId ? "" : " · not linked"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
