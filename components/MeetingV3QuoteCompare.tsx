"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { MarkdownPreview } from "@/components/MarkdownPreview";
import type { MeetingsV3PackageStatus } from "@/lib/meeting-v3/package-status";
import type { AnnotatedQuoteRow } from "@/lib/meeting-v3/quote-ledger";
import type { MeetingsV3PackageStage } from "@/lib/meeting-v3/workspace";

type ExtractedPage = {
  pageNumber: number;
  pageHeading: string | null;
  extractedText: string;
};

const STAGE_LABEL: Record<MeetingsV3PackageStage, string> = {
  created: "Ready to extract",
  extracting: "Extracting the board package",
  reading_quotes: "Building the quote ledger",
  ready: "Quote ledger ready",
  failed: "Extraction failed",
};

const CHECK_TONE: Record<AnnotatedQuoteRow["checkStatus"], string> = {
  ok: "bg-emerald-50 text-emerald-800 border-emerald-200",
  mismatch: "bg-red-50 text-red-800 border-red-200",
  incomplete: "bg-amber-50 text-amber-900 border-amber-200",
  unchecked: "bg-slate-50 text-slate-700 border-slate-200",
};

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

type PageNavProps = {
  pages: ExtractedPage[];
  pageIndex: number;
  pageNumber: number | null;
  rowCount: number;
  onPageChange: (pageNumber: number) => void;
  onExpand?: () => void;
};

function PageNavBar({ pages, pageIndex, pageNumber, rowCount, onPageChange, onExpand }: PageNavProps) {
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
        {rowCount} quote {rowCount === 1 ? "row" : "rows"} stored
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
  pageRows: AnnotatedQuoteRow[];
  inLedgerWindow: boolean;
  busy: boolean;
  totalRowCount: number;
  panelMinHeightClass: string;
};

function CompareColumns({
  meetingId,
  pageNumber,
  selectedPage,
  pageRows,
  inLedgerWindow,
  busy,
  totalRowCount,
  panelMinHeightClass,
}: CompareColumnsProps) {
  const extractText = selectedPage?.extractedText?.trim() || "No extracted text on this page.";

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
          <MarkdownPreview>{extractText}</MarkdownPreview>
        </div>
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="shrink-0 border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
          Quote ledger
        </h2>
        <div className="min-h-0 flex-1 overflow-auto">
          {busy && totalRowCount === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-600">Reading quote rows from the agenda pages.</p>
          ) : !inLedgerWindow ? (
            <p className="px-3 py-4 text-sm text-slate-600">
              This page is outside the agenda window, so it is not in the quote ledger.
            </p>
          ) : pageRows.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-600">No quote rows on this page.</p>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Check</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map((row) => (
                  <tr key={`${row.pageNumber}-${row.vendor}-${row.lineKind}-${row.amountCents}-${row.itemLabel}`}>
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-slate-900">{row.vendor}</div>
                      <div className="text-xs text-slate-500">{row.itemLabel}</div>
                      {row.equipment ? <div className="text-xs text-slate-500">{row.equipment}</div> : null}
                    </td>
                    <td className="px-3 py-2 align-top capitalize text-slate-700">{row.lineKind}</td>
                    <td className="px-3 py-2 align-top tabular-nums text-slate-900">
                      {money.format(row.amountCents / 100)}
                      <div className="text-xs capitalize text-slate-500">{row.taxBasis.replaceAll("_", " ")}</div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${CHECK_TONE[row.checkStatus]}`}
                      >
                        {row.checkStatus}
                      </span>
                      <p className="mt-1 text-xs text-slate-600">{row.checkDetail}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Board-package PDF, Docling text, and quote ledger for one page at a time.
 */
export function MeetingV3QuoteCompare({ initial }: { initial: MeetingsV3PackageStatus }) {
  const [status, setStatus] = useState(initial);
  const [running, setRunning] = useState(
    initial.stage === "extracting" || initial.stage === "reading_quotes",
  );
  const [error, setError] = useState<string | null>(initial.error);
  const [pages, setPages] = useState<ExtractedPage[]>([]);
  const [rows, setRows] = useState<AnnotatedQuoteRow[]>([]);
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const busy = running || status.stage === "extracting" || status.stage === "reading_quotes";

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
          if (next.stage !== "extracting" && next.stage !== "reading_quotes") {
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
    if (status.quoteRowCount === 0 && status.stage !== "ready") return;
    let cancelled = false;
    void fetch(`/api/v3/meetings/${status.id}/quote-ledger`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { rows?: AnnotatedQuoteRow[] };
        if (!cancelled) setRows(payload.rows ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status.id, status.quoteRowCount, status.stage]);

  const pageIndex = pages.findIndex((page) => page.pageNumber === pageNumber);
  const selectedPage = pageIndex >= 0 ? pages[pageIndex] : null;
  const pageRows = useMemo(
    () => rows.filter((row) => row.pageNumber === pageNumber),
    [rows, pageNumber],
  );
  const inLedgerWindow = pageNumber != null && status.ledgerPageNumbers.includes(pageNumber);

  const compareProps: CompareColumnsProps = {
    meetingId: status.id,
    pageNumber,
    selectedPage,
    pageRows,
    inLedgerWindow,
    busy,
    totalRowCount: rows.length,
    panelMinHeightClass: "min-h-[28rem]",
  };

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
      if (payload && "stage" in payload) setStatus(payload);
    } catch (extractError) {
      const message = extractError instanceof Error ? extractError.message : "Package extraction failed.";
      setError(message);
      setStatus((current) => ({ ...current, stage: "failed", error: message }));
    } finally {
      setRunning(false);
    }
  }

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
        <button
          type="button"
          onClick={() => void extractPackage()}
          disabled={busy}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? "Working…" : status.pageCount > 0 ? "Re-run extraction" : "Extract meeting package"}
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
      {status.truncated ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          No agenda split is recorded, so the quote ledger stops at page 15. Later extracted pages stay in the Docling column.
        </p>
      ) : null}

      {status.pageCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-16 text-center text-slate-600">
          {busy
            ? "Docling is reading the board package. The comparison opens when the quote ledger is stored."
            : "Extract the meeting package to compare the PDF, the Docling text, and the quote ledger."}
        </div>
      ) : (
        <>
          <PageNavBar
            pages={pages}
            pageIndex={pageIndex}
            pageNumber={pageNumber}
            rowCount={rows.length}
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
                rowCount={rows.length}
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
