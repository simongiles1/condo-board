"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { MarkdownPreview } from "@/components/MarkdownPreview";
import type { MeetingsV3PackageStatus } from "@/lib/meeting-v3/package-status";
import type { MeetingsV3PackageStage } from "@/lib/meeting-v3/workspace";

type ExtractedPage = {
  pageNumber: number;
  pageHeading: string | null;
  extractedText: string;
};

type PageRewrite = {
  pageNumber: number;
  correctedText: string;
};

type AgendaItem = {
  itemNumber: string;
  title: string;
  sourcePages: number[];
  summary: string | null;
  amount: string | null;
  vendors: string[];
  recommendation: string | null;
};

const STAGE_LABEL: Record<MeetingsV3PackageStage, string> = {
  created: "Ready to extract",
  extracting: "Extracting the board package",
  correcting: "Correcting every page",
  ready: "Pages corrected",
  failed: "Extraction failed",
};

type PageNavProps = {
  pages: ExtractedPage[];
  pageIndex: number;
  pageNumber: number | null;
  correctedCount: number;
  onPageChange: (pageNumber: number) => void;
  onExpand?: () => void;
};

function PageNavBar({ pages, pageIndex, pageNumber, correctedCount, onPageChange, onExpand }: PageNavProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
        disabled={pageIndex <= 0}
        onClick={() => {
          const previous = pages[pageIndex - 1];
          if (previous) onPageChange(previous.pageNumber);
        }}
      >
        Previous page
      </button>
      <label className="text-sm text-slate-700">
        Page
        <select
          className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1.5"
          value={pageNumber ?? ""}
          onChange={(event) => onPageChange(Number(event.target.value))}
        >
          {pages.map((page) => (
            <option key={page.pageNumber} value={page.pageNumber}>
              {page.pageNumber}
              {page.pageHeading ? ` — ${page.pageHeading}` : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
        disabled={pageIndex < 0 || pageIndex >= pages.length - 1}
        onClick={() => {
          const next = pages[pageIndex + 1];
          if (next) onPageChange(next.pageNumber);
        }}
      >
        Next page
      </button>
      <span className="text-sm text-slate-500">
        {correctedCount} corrected {correctedCount === 1 ? "page" : "pages"}
      </span>
      {onExpand ? (
        <button
          type="button"
          onClick={onExpand}
          className="ml-auto rounded-md border border-teal-700 px-3 py-1.5 text-sm font-semibold text-teal-800 hover:bg-teal-50"
        >
          Expand comparison
        </button>
      ) : null}
    </div>
  );
}

type CompareColumnsProps = {
  meetingId: string;
  pageNumber: number | null;
  selectedPage: ExtractedPage | null;
  busy: boolean;
  correctedText: string | null;
  panelMinHeightClass: string;
};

function CompareColumns({
  meetingId,
  pageNumber,
  selectedPage,
  busy,
  correctedText,
  panelMinHeightClass,
}: CompareColumnsProps) {
  const doclingText = selectedPage?.extractedText?.trim() || "No extracted text on this page.";
  const corrected = correctedText?.trim()
    || (busy ? "Correcting this page." : "This page has not been corrected yet.");

  return (
    <div className={`grid min-h-0 flex-1 gap-3 lg:grid-cols-3 ${panelMinHeightClass}`}>
      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="shrink-0 border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
          Board package
        </h2>
        {pageNumber != null ? (
          <iframe
            key={pageNumber}
            title={`Board package page ${pageNumber}`}
            src={`/api/meetings/${meetingId}/board-package#page=${pageNumber}`}
            className="min-h-0 w-full flex-1"
          />
        ) : null}
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="shrink-0 border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
          Docling extract
        </h2>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <MarkdownPreview>{doclingText}</MarkdownPreview>
        </div>
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="shrink-0 border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
          Corrected extract
        </h2>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <MarkdownPreview>{corrected}</MarkdownPreview>
        </div>
      </section>
    </div>
  );
}

/**
 * Board-package PDF, Docling text, and the corrected page, with the agenda built from those corrections.
 */
export function MeetingV3QuoteCompare({ initial }: { initial: MeetingsV3PackageStatus }) {
  const [status, setStatus] = useState(initial);
  const [running, setRunning] = useState(
    initial.stage === "extracting" || initial.stage === "correcting",
  );
  const [error, setError] = useState<string | null>(initial.error);
  const [pages, setPages] = useState<ExtractedPage[]>([]);
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [rewrites, setRewrites] = useState<PageRewrite[]>([]);
  const [rewriting, setRewriting] = useState(false);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  const [buildingAgenda, setBuildingAgenda] = useState(false);

  const busy = running || rewriting || buildingAgenda || status.stage === "extracting" || status.stage === "correcting";

  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  useEffect(() => {
    if (!busy) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void fetch(`/api/v3/meetings/${status.id}/package`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok || cancelled) return;
          const next = (await response.json()) as MeetingsV3PackageStatus;
          if (cancelled) return;
          setStatus(next);
          setError(next.error);
          if (next.stage !== "extracting" && next.stage !== "correcting") {
            setRunning(false);
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [busy, status.id]);

  useEffect(() => {
    if (status.pageCount === 0) return;
    let cancelled = false;
    void fetch(`/api/v2/meetings/${status.id}/board-package-extract`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { pages?: ExtractedPage[] };
        if (cancelled) return;
        const nextPages = [...(payload.pages ?? [])].sort((left, right) => left.pageNumber - right.pageNumber);
        setPages(nextPages);
        setPageNumber((current) => current ?? nextPages[0]?.pageNumber ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status.id, status.pageCount, status.stage]);

  useEffect(() => {
    if (status.pageCount === 0) return;
    let cancelled = false;
    void fetch(`/api/v3/meetings/${status.id}/page-rewrite`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { pages?: PageRewrite[] };
        if (cancelled) return;
        setRewrites(payload.pages ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status.id, status.pageCount, status.correctedPageCount, status.stage]);

  useEffect(() => {
    if (status.pageCount === 0) return;
    let cancelled = false;
    void fetch(`/api/v3/meetings/${status.id}/agenda`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { items?: AgendaItem[] };
        if (cancelled) return;
        setAgendaItems(payload.items ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status.id, status.pageCount, status.agendaItemCount, status.stage]);

  const pageIndex = pages.findIndex((page) => page.pageNumber === pageNumber);
  const selectedPage = pageIndex >= 0 ? pages[pageIndex] : null;
  const correctedText = rewrites.find((page) => page.pageNumber === pageNumber)?.correctedText ?? null;

  const compareProps: CompareColumnsProps = {
    meetingId: status.id,
    pageNumber,
    selectedPage,
    busy,
    correctedText,
    panelMinHeightClass: "min-h-[28rem]",
  };

  async function rewritePages() {
    setRewriting(true);
    setError(null);
    try {
      const response = await fetch(`/api/v3/meetings/${status.id}/page-rewrite`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { pages?: PageRewrite[]; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Page rewrite failed.");
      }
      setRewrites(payload?.pages ?? []);
      setAgendaItems([]);
      setExpanded(true);
    } catch (rewriteError) {
      const message = rewriteError instanceof Error ? rewriteError.message : "Page rewrite failed.";
      setError(message);
    } finally {
      setRewriting(false);
    }
  }

  async function extractPackage() {
    setRunning(true);
    setError(null);
    setStatus((current) => ({ ...current, stage: "extracting", error: null, currentStep: "Extracting the board package" }));
    try {
      const response = await fetch(`/api/v3/meetings/${status.id}/package`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | (MeetingsV3PackageStatus & { error?: string })
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Package extraction failed.");
      }
      if (payload && "stage" in payload) {
        setStatus(payload);
        setAgendaItems([]);
      }
    } catch (extractError) {
      const message = extractError instanceof Error ? extractError.message : "Package extraction failed.";
      setError(message);
      setStatus((current) => ({ ...current, stage: "failed", error: message }));
    } finally {
      setRunning(false);
    }
  }

  async function buildAgenda() {
    setBuildingAgenda(true);
    setError(null);
    setStatus((current) => ({ ...current, currentStep: "Building the agenda from corrected pages" }));
    try {
      const response = await fetch(`/api/v3/meetings/${status.id}/agenda`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { items?: AgendaItem[]; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Agenda extraction failed.");
      }
      setAgendaItems(payload?.items ?? []);
      setStatus((current) => ({
        ...current,
        currentStep: "Agenda built from corrected pages",
        agendaItemCount: payload?.items?.length ?? 0,
      }));
    } catch (agendaError) {
      const message = agendaError instanceof Error ? agendaError.message : "Agenda extraction failed.";
      setError(message);
    } finally {
      setBuildingAgenda(false);
    }
  }

  const pageAgenda = agendaItems.filter((item) => item.sourcePages.includes(pageNumber ?? -1));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/operations/meetings?v=3" className="text-xs font-semibold uppercase tracking-wide text-teal-700 hover:text-teal-900">
            Meetings V3
          </Link>
          <h1 className="text-2xl font-semibold text-slate-900">{status.title}</h1>
          <p className="text-sm text-slate-600">
            {status.meetingDate}
            {" · "}
            {status.currentStep || STAGE_LABEL[status.stage]}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {status.correctedPageCount > 0 || rewrites.length > 0 ? (
            <button
              type="button"
              onClick={() => void buildAgenda()}
              disabled={busy}
              className="rounded-lg border border-teal-700 bg-white px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
            >
              {buildingAgenda ? "Building agenda…" : agendaItems.length > 0 ? "Rebuild agenda" : "Build agenda"}
            </button>
          ) : null}
          {status.pageCount > 0 ? (
            <button
              type="button"
              onClick={() => void rewritePages()}
              disabled={busy}
              className="rounded-lg border border-teal-700 bg-white px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
            >
              {rewriting ? "Correcting every page…" : "Correct every page"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void extractPackage()}
            disabled={busy}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {running || status.stage === "extracting" || status.stage === "correcting"
              ? "Working…"
              : status.pageCount > 0
                ? "Re-run extraction"
                : "Extract meeting package"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
      {status.pageCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
          {busy
            ? "Docling is reading the board package. Every stored page is then corrected."
            : "Extract the meeting package to compare the PDF, the Docling text, and the corrected page."}
        </div>
      ) : (
        <>
          {agendaItems.length > 0 ? (
            <section className="rounded-xl border border-slate-200 bg-white">
              <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
                Agenda from corrected pages
              </h2>
              <ul className="max-h-52 divide-y divide-slate-100 overflow-auto">
                {agendaItems.map((item) => {
                  const sourcePages = [...item.sourcePages].sort((left, right) => left - right);
                  const onPage = sourcePages.includes(pageNumber ?? -1);
                  const firstPage = sourcePages[0];
                  return (
                    <li key={`${item.itemNumber}-${item.title}`}>
                      <button
                        type="button"
                        disabled={firstPage == null}
                        onClick={() => {
                          if (firstPage != null) setPageNumber(firstPage);
                        }}
                        className={`flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-default ${onPage ? "bg-teal-50" : ""}`}
                      >
                        <span className="font-semibold tabular-nums text-slate-900">{item.itemNumber}</span>
                        <span className="font-medium text-slate-800">{item.title}</span>
                        {sourcePages.length > 0 ? (
                          <span className="text-xs text-slate-500">
                            {sourcePages.length === 1
                              ? `page ${sourcePages[0]}`
                              : `pages ${sourcePages[0]}–${sourcePages[sourcePages.length - 1]}`}
                          </span>
                        ) : null}
                        {item.amount ? <span className="text-xs font-medium text-slate-700">{item.amount}</span> : null}
                        {item.vendors.length > 0 ? (
                          <span className="text-xs text-slate-600">{item.vendors.join(", ")}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {pageAgenda.length > 0 && pageNumber != null ? (
                <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-600">
                  Page {pageNumber}: {pageAgenda.map((item) => item.itemNumber).join(", ")}
                </p>
              ) : null}
            </section>
          ) : null}
          <PageNavBar
            pages={pages}
            pageIndex={pageIndex}
            pageNumber={pageNumber}
            correctedCount={rewrites.length}
            onPageChange={setPageNumber}
            onExpand={() => setExpanded(true)}
          />
          <CompareColumns {...compareProps} />
        </>
      )}

      {expanded && status.pageCount > 0 ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-slate-900/70 p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="v3-compare-expanded-title"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-2xl">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
              <div>
                <p id="v3-compare-expanded-title" className="text-sm font-semibold text-slate-900">
                  Page comparison — {status.title}
                </p>
                <p className="text-xs text-slate-500">Escape or Close to return</p>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
              <PageNavBar
                pages={pages}
                pageIndex={pageIndex}
                pageNumber={pageNumber}
                correctedCount={rewrites.length}
                onPageChange={setPageNumber}
              />
              <CompareColumns {...compareProps} panelMinHeightClass="min-h-0 flex-1" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
