"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  attachmentKindClasses,
  type attachmentKind,
} from "@/lib/email/attachment-display";
import type {
  AttachmentAnalytics,
  AttachmentDownloadBatchResult,
  AttachmentParseBatchResult,
} from "@/lib/email/attachment-analytics-types";
import { formatAnalyticsSize } from "@/lib/email/attachment-analytics-types";
import {
  hasActiveFilters,
  parseEmailThreadFilters,
  searchParamsToFilterRecord,
} from "@/lib/email/thread-filter-params";

type Props = {
  open: boolean;
  onClose: () => void;
};

function kindBadgeClasses(kind: ReturnType<typeof attachmentKind>): string {
  return attachmentKindClasses(kind);
}

function formatPages(stat: AttachmentAnalytics["byType"][number]): string {
  if (stat.totalPages == null) return "—";
  if (stat.totalPages === 0 && stat.pendingPageCount > 0) return "Counting…";
  const parts = [stat.totalPages.toLocaleString()];
  if (stat.uncachedCount > 0) {
    parts.push(`+${stat.uncachedCount} not downloaded`);
  } else if (stat.pendingPageCount > 0) {
    parts.push(`${stat.pendingPageCount} pending`);
  }
  return parts.join(" · ");
}

export function EmailAttachmentAnalyticsDialog({ open, onClose }: Props) {
  const searchParams = useSearchParams();
  const activeFilters = parseEmailThreadFilters(
    searchParamsToFilterRecord(searchParams),
  );
  const filtersActive = hasActiveFilters(activeFilters);

  const [data, setData] = useState<AttachmentAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{
    cached: number;
    total: number;
    failed: number;
    lastError: string | null;
  } | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState<{
    parsed: number;
    needsOcr: number;
    failed: number;
    remaining: number;
    lastError: string | null;
  } | null>(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page");

      const response = await fetch(
        `/api/email/attachments/analytics?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error("Could not load attachment analytics.");
      }

      const payload = (await response.json()) as AttachmentAnalytics;
      setData(payload);
    } catch (loadError) {
      console.error("[EmailAttachmentAnalyticsDialog]", loadError);
      setError("Could not load attachment analytics.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  const downloadAllAttachments = useCallback(async () => {
    setDownloading(true);
    setError(null);
    setDownloadProgress((current) => ({
      cached: current?.cached ?? data?.totalAttachments
        ? (data?.totalAttachments ?? 0) - (data?.uncachedTotal ?? 0)
        : 0,
      total: current?.total ?? data?.totalAttachments ?? 0,
      failed: 0,
      lastError: null,
    }));

    let totalFailed = 0;
    let lastError: string | null = null;

    try {
      for (;;) {
        const response = await fetch("/api/email/attachments/download-batch", {
          method: "POST",
        });
        if (!response.ok) {
          throw new Error("Could not download attachments.");
        }

        const batch = (await response.json()) as AttachmentDownloadBatchResult;
        totalFailed += batch.failed;
        lastError = batch.lastError;

        setDownloadProgress({
          cached: batch.cached,
          total: batch.total,
          failed: totalFailed,
          lastError,
        });

        if (
          batch.remaining === 0 ||
          (batch.downloaded === 0 && batch.failed === 0) ||
          (batch.downloaded === 0 && batch.failed > 0)
        ) {
          break;
        }
      }

      await loadAnalytics();
    } catch (downloadError) {
      console.error("[EmailAttachmentAnalyticsDialog:download]", downloadError);
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Could not download attachments.",
      );
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  }, [data?.totalAttachments, data?.uncachedTotal, loadAnalytics]);

  const parseAllAttachments = useCallback(async () => {
    setParsing(true);
    setError(null);
    setParseProgress({
      parsed: 0,
      needsOcr: 0,
      failed: 0,
      remaining: data?.parseStatus?.pending ?? 0,
      lastError: null,
    });

    let totalParsed = 0;
    let totalNeedsOcr = 0;
    let totalFailed = 0;
    let lastError: string | null = null;

    try {
      for (;;) {
        const response = await fetch("/api/email/attachments/parse-batch", {
          method: "POST",
        });
        const batch = (await response.json()) as AttachmentParseBatchResult & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(batch.error ?? "Could not convert attachments.");
        }

        totalParsed += batch.parsed;
        totalNeedsOcr += batch.needsOcr;
        totalFailed += batch.failed;
        lastError = batch.lastError;

        setParseProgress({
          parsed: totalParsed,
          needsOcr: totalNeedsOcr,
          failed: totalFailed,
          remaining: batch.remaining,
          lastError,
        });

        if (batch.remaining === 0 || batch.processed === 0) {
          break;
        }
      }

      await loadAnalytics();
    } catch (parseError) {
      console.error("[EmailAttachmentAnalyticsDialog:parse]", parseError);
      setError(
        parseError instanceof Error
          ? parseError.message
          : "Could not convert attachments.",
      );
    } finally {
      setParsing(false);
      setParseProgress(null);
    }
  }, [data?.parseStatus?.pending, loadAnalytics]);

  useEffect(() => {
    if (!open) return;
    void loadAnalytics();
  }, [open, loadAnalytics]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const byType = data?.byType ?? [];
  const uncachedTotal = data?.uncachedTotal ?? 0;
  const downloadPercent =
    downloadProgress && downloadProgress.total > 0
      ? Math.round((downloadProgress.cached / downloadProgress.total) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="attachment-analytics-title"
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <h2
            id="attachment-analytics-title"
            className="text-xl font-semibold text-slate-900"
          >
            Attachment analytics
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {filtersActive
              ? "Counts for attachments on emails matching the active filters."
              : "Counts for all ingested email attachments."}
            {data
              ? ` ${data.totalAttachments.toLocaleString()} attachments · ${formatAnalyticsSize(data.totalSizeBytes)} total.`
              : null}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading && !data ? (
            <div className="flex h-48 items-center justify-center text-sm text-slate-500">
              Loading analytics…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {error}
            </div>
          ) : byType.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              No attachments match the current filters.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium text-right">Count</th>
                    <th className="px-4 py-3 font-medium text-right">Size</th>
                    <th className="px-4 py-3 font-medium text-right">Pages</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {byType.map((stat) => (
                    <tr key={stat.kind} className="bg-white">
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${kindBadgeClasses(stat.kind)}`}
                        >
                          {stat.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                        {stat.count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {formatAnalyticsSize(stat.totalSizeBytes)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {formatPages(stat)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {data?.totalPages != null ? (
                  <tfoot className="border-t border-slate-200 bg-slate-50">
                    <tr>
                      <td
                        className="px-4 py-3 font-medium text-slate-700"
                        colSpan={3}
                      >
                        Total PDF pages
                        {!data.pageCountComplete ? (
                          <span className="ml-2 text-xs font-normal text-amber-700">
                            (partial — some PDFs not yet analyzed)
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900">
                        {data.totalPages.toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          )}

          {downloading && downloadProgress ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center justify-between gap-3 text-sm text-amber-900">
                <span>
                  Downloading attachments… {downloadProgress.cached.toLocaleString()}{" "}
                  / {downloadProgress.total.toLocaleString()}
                </span>
                <span className="tabular-nums">{downloadPercent}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-amber-100">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all"
                  style={{ width: `${downloadPercent}%` }}
                />
              </div>
              {downloadProgress.failed > 0 ? (
                <p className="mt-2 text-xs text-amber-800">
                  {downloadProgress.failed.toLocaleString()} failed
                  {downloadProgress.lastError
                    ? `: ${downloadProgress.lastError}`
                    : null}
                </p>
              ) : null}
            </div>
          ) : null}

          {parsing && parseProgress ? (
            <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-4">
              <div className="flex items-center justify-between gap-3 text-sm text-sky-900">
                <span>Converting attachments to Markdown…</span>
                <span className="tabular-nums">
                  {parseProgress.remaining.toLocaleString()} remaining
                </span>
              </div>
              <p className="mt-2 text-xs text-sky-800">
                {parseProgress.parsed.toLocaleString()} parsed
                {parseProgress.needsOcr > 0
                  ? ` · ${parseProgress.needsOcr.toLocaleString()} need OCR`
                  : ""}
                {parseProgress.failed > 0
                  ? ` · ${parseProgress.failed.toLocaleString()} failed`
                  : ""}
                {parseProgress.lastError
                  ? ` · ${parseProgress.lastError}`
                  : ""}
              </p>
            </div>
          ) : null}

          {data?.parseStatus && data.parseStatus.total > 0 ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-600">
              <p className="font-medium text-slate-700">Markdown conversion</p>
              <p className="mt-1 tabular-nums">
                {data.parseStatus.parsed.toLocaleString()} parsed
                {" · "}
                {data.parseStatus.pending.toLocaleString()} pending
                {" · "}
                {data.parseStatus.needsOcr.toLocaleString()} need OCR
                {" · "}
                {data.parseStatus.unsupported.toLocaleString()} unsupported
                {" · "}
                {data.parseStatus.failed.toLocaleString()} failed
                {" · "}
                {data.parseStatus.total.toLocaleString()} unique files
              </p>
            </div>
          ) : null}

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
            <p className="font-medium text-slate-700">How page counts work</p>
            <p className="mt-1">
              Gmail only stores filename, type, and size — not page counts. PDF
              pages are counted by opening each cached file (using pdf-lib).
              Images are not paginated. Word and other document types need a full
              render engine for accurate page counts, so they are listed by
              attachment count only.
            </p>
            <p className="mt-2 font-medium text-slate-700">
              How Markdown conversion works
            </p>
            <p className="mt-1">
              PDF and Office files are converted via Cloudflare Workers AI
              toMarkdown into{" "}
              <code className="rounded bg-slate-100 px-1">.md</code> sidecars
              beside the cached bytes. Scanned PDFs with almost no extractable
              text are marked &quot;need OCR&quot; for a later vision pass.
              Images are skipped here.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-6 py-4">
          <div className="text-xs text-slate-500">
            {uncachedTotal > 0
              ? `${uncachedTotal.toLocaleString()} not yet downloaded from Gmail`
              : data
                ? "All attachments downloaded"
                : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {uncachedTotal > 0 ? (
              <button
                type="button"
                onClick={() => void downloadAllAttachments()}
                disabled={downloading || parsing || loading}
                className="rounded-md border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {downloading ? "Downloading…" : "Download all attachments"}
              </button>
            ) : null}
            {(data?.parseStatus?.pending ?? 0) > 0 ||
            (data?.parseStatus?.total ?? 0) === 0 ? (
              <button
                type="button"
                onClick={() => void parseAllAttachments()}
                disabled={downloading || parsing || loading || uncachedTotal > 0}
                className="rounded-md border border-sky-700 bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
                title={
                  uncachedTotal > 0
                    ? "Download attachments first"
                    : "Convert PDF/Office attachments to Markdown"
                }
              >
                {parsing ? "Converting…" : "Convert to Markdown"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void loadAnalytics()}
              disabled={loading || downloading || parsing}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={downloading || parsing}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function EmailAttachmentAnalyticsIconButton({
  onClick,
  title = "View attachment analytics",
}: {
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
    </button>
  );
}

export function EmailAttachmentAnalyticsButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <EmailAttachmentAnalyticsIconButton onClick={() => setOpen(true)} />
      <EmailAttachmentAnalyticsDialog
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
