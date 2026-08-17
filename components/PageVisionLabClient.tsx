"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PageVisionCostBadge } from "@/components/PageVisionCostBadge";
import {
  isVisionImageExt,
  isVisionImageMime,
} from "@/lib/email/attachment-vision-image-shared";
import { formatCostUsd } from "@/lib/gemini/usage";
import type {
  PageVisionDocDetail,
  PageVisionDocSummary,
  PageVisionListFilter,
  PageVisionListKind,
  PageVisionListSort,
} from "@/lib/email/page-vision-lab";

type ListResponse = {
  documents?: PageVisionDocSummary[];
  total?: number;
  error?: string;
};

type RunResponse = {
  result?: {
    processed: number;
    done: number;
    failed: number;
    skipped: number;
    costUsd: number;
    mergedHashes: string[];
  };
  detail?: PageVisionDocDetail;
  error?: string;
};

const FILTERS: { id: PageVisionListFilter; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "done", label: "Done" },
  { id: "failed", label: "Failed" },
  { id: "all", label: "All vision routes" },
];

const KINDS: { id: PageVisionListKind; label: string }[] = [
  { id: "all", label: "All types" },
  { id: "pdf", label: "PDFs" },
  { id: "image", label: "Images" },
];

const SORTS: { id: PageVisionListSort; label: string }[] = [
  { id: "filename_asc", label: "Name A → Z" },
  { id: "filename_desc", label: "Name Z → A" },
  { id: "pages_desc", label: "Pages high → low" },
  { id: "pages_asc", label: "Pages low → high" },
];

const PAGE_SIZE = 50;

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…`;
}

function totalPagesFor(doc: PageVisionDocSummary): number {
  if (doc.pageCount != null && doc.pageCount > 0) return doc.pageCount;
  return (
    doc.pending +
    doc.processing +
    doc.done +
    doc.failed +
    doc.skipped +
    doc.notNeeded
  );
}

/** Page 1 extract is only for not-yet-done pages (pending/failed retry). */
function canExtractPage1(doc: PageVisionDocSummary): boolean {
  const status = doc.page1VisionStatus;
  return status === "pending" || status === "failed";
}

function isImageAttachment(doc: {
  mimeType?: string | null;
  ext?: string | null;
  filename?: string | null;
}): boolean {
  if (doc.mimeType && isVisionImageMime(doc.mimeType)) return true;
  if (isVisionImageExt(doc.ext)) return true;
  const name = doc.filename?.toLowerCase() ?? "";
  return /\.(png|jpe?g|gif|webp)$/.test(name);
}

function typeBadgeLabel(doc: {
  mimeType?: string | null;
  ext?: string | null;
  filename?: string | null;
}): string {
  const mime = doc.mimeType?.toLowerCase().split(";")[0]?.trim() ?? "";
  if (mime.startsWith("image/")) {
    const subtype = mime.slice("image/".length).toUpperCase();
    if (subtype === "JPEG" || subtype === "JPG") return "JPEG";
    return subtype || "IMAGE";
  }
  if (mime.includes("pdf") || doc.ext?.toLowerCase() === ".pdf") return "PDF";
  if (isImageAttachment(doc)) return "IMAGE";
  const ext = (doc.ext || "").replace(/^\./, "").toUpperCase();
  return ext || "FILE";
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

export function PageVisionLabClient() {
  const [filter, setFilter] = useState<PageVisionListFilter>("pending");
  const [kind, setKind] = useState<PageVisionListKind>("all");
  const [sort, setSort] = useState<PageVisionListSort>("filename_asc");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [documents, setDocuments] = useState<PageVisionDocSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingList, setLoadingList] = useState(true);
  const [runningHash, setRunningHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [previewDoc, setPreviewDoc] = useState<PageVisionDocSummary | null>(
    null,
  );
  const [resultOpen, setResultOpen] = useState(false);
  const [resultDetail, setResultDetail] = useState<PageVisionDocDetail | null>(
    null,
  );
  const [resultPageNo, setResultPageNo] = useState(1);
  const [resultIframeTick, setResultIframeTick] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextSearch = params.get("search")?.trim() ?? "";
    const nextFilter = params.get("filter");
    if (nextSearch) {
      setSearch(nextSearch);
      setSearchInput(nextSearch);
    }
    if (
      nextFilter === "pending" ||
      nextFilter === "done" ||
      nextFilter === "failed" ||
      nextFilter === "all"
    ) {
      setFilter(nextFilter);
    }
  }, []);

  const listPageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        filter,
        kind,
        sort,
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/analysis/page-vision?${params}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as ListResponse;
      if (!res.ok) throw new Error(data.error ?? "Could not load documents.");
      setDocuments(data.documents ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load documents.");
    } finally {
      setLoadingList(false);
    }
  }, [filter, kind, sort, search, page]);
  useEffect(() => {
    void loadList();
  }, [loadList]);

  // If the last page empties (filter change / extract), step back.
  useEffect(() => {
    if (loadingList) return;
    if (page > listPageCount) setPage(listPageCount);
  }, [loadingList, page, listPageCount]);
  const resultPageCount = resultDetail
    ? Math.max(
        resultDetail.pageCount ?? 0,
        ...resultDetail.pages.map((p) => p.pageNo),
        1,
      )
    : 1;

  const goToResultPage = useCallback(
    (nextPage: number) => {
      const clamped = Math.min(Math.max(1, nextPage), resultPageCount);
      setResultPageNo(clamped);
      setResultIframeTick((t) => t + 1);
    },
    [resultPageCount],
  );

  useEffect(() => {
    if (!previewDoc && !resultOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPreviewDoc(null);
        setResultOpen(false);
        return;
      }
      if (!resultOpen || !resultDetail) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToResultPage(resultPageNo - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToResultPage(resultPageNo + 1);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    previewDoc,
    resultOpen,
    resultDetail,
    resultPageNo,
    goToResultPage,
  ]);

  async function openResult(doc: PageVisionDocSummary, pageNo?: number) {
    setError(null);
    try {
      const res = await fetch(`/api/analysis/page-vision/${doc.contentHash}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as PageVisionDocDetail & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not load vision output.");
      const firstDone =
        data.pages.find((p) => p.visionStatus === "done")?.pageNo ?? 1;
      setResultDetail(data);
      setResultPageNo(pageNo ?? firstDone);
      setResultIframeTick((t) => t + 1);
      setResultOpen(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load vision output.",
      );
    }
  }

  async function runVision(
    doc: PageVisionDocSummary,
    pageNos?: number[],
  ) {
    const label =
      pageNos && pageNos.length === 1
        ? `page ${pageNos[0]}`
        : `${doc.pending} page${doc.pending === 1 ? "" : "s"} awaiting vision`;

    if (!(pageNos && pageNos.length > 0) && doc.pending === 0) {
      setError("No pages awaiting vision on this document.");
      return;
    }

    if (
      !window.confirm(
        `Run Gemini page vision on ${label}?\n${doc.filename || shortHash(doc.contentHash)}\nThis incurs API cost.`,
      )
    ) {
      return;
    }

    setRunningHash(doc.contentHash);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/analysis/page-vision/${doc.contentHash}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          pageNos && pageNos.length > 0
            ? { pageNos, force: true }
            : {},
        ),
      });
      const data = (await res.json()) as RunResponse;
      if (!res.ok) throw new Error(data.error ?? "Vision run failed.");

      const r = data.result;
      const remainingPending =
        data.detail?.pages.filter((p) => p.visionStatus === "pending")
          .length ?? null;
      const fullyClearedPending =
        remainingPending === 0 && (r?.done ?? 0) > 0;

      setMessage(
        r
          ? `${doc.filename || shortHash(doc.contentHash)}: done ${r.done}, failed ${r.failed} · ${formatCostUsd(r.costUsd)}` +
              (r.mergedHashes.length ? " · markdown merged" : "") +
              (fullyClearedPending && filter === "pending"
                ? " · showing Done filter"
                : "")
          : "Vision run finished.",
      );

      if (data.detail) {
        const firstDone =
          data.detail.pages.find((p) => p.visionStatus === "done")?.pageNo ?? 1;
        setResultDetail(data.detail);
        // Prefer the requested page, else first done page (not page 1 when
        // only a later vision/ambiguous page was transcribed).
        setResultPageNo(pageNos?.[0] ?? firstDone);
        setResultIframeTick((t) => t + 1);
        setResultOpen(true);
      }

      // Pending filter hides docs with 0 awaiting pages — switch so the row stays visible.
      if (fullyClearedPending && filter === "pending") {
        setPage(1);
        setFilter("done");
      } else {
        await loadList();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vision run failed.");
    } finally {
      setRunningHash(null);
    }
  }

  const resultPage = resultDetail?.pages.find((p) => p.pageNo === resultPageNo);
  const visionMarkdown =
    resultPage?.artifactMarkdown?.trim() ||
    (resultDetail?.markdown && resultPageNo
      ? (() => {
          const open = `<!-- vision:page=${resultPageNo} -->`;
          const close = `<!-- /vision:page=${resultPageNo} -->`;
          const start = resultDetail.markdown!.indexOf(open);
          if (start < 0) return null;
          const end = resultDetail.markdown!.indexOf(close, start);
          if (end < 0) return null;
          return resultDetail.markdown!.slice(start, end + close.length);
        })()
      : null);
  const nativeText = resultPage?.nativeText?.trim() || null;
  const resultMarkdown = visionMarkdown?.trim() || null;
  const showingNativeOnly = !resultMarkdown && Boolean(nativeText);

  function resultEmptyMessage(): string {
    if (!resultPage) return "No page profile for this page.";
    if (resultPage.visionStatus === "not_needed") {
      return "Routed to native text — but selectable text could not be loaded.";
    }
    if (resultPage.visionStatus === "pending") {
      return "Awaiting vision for this page.";
    }
    if (resultPage.visionStatus === "processing") {
      return "Vision in progress for this page…";
    }
    if (resultPage.visionStatus === "failed") {
      return "Vision failed for this page.";
    }
    if (resultPage.visionStatus === "skipped") {
      return "Vision skipped for this page.";
    }
    if (resultPage.visionStatus === "done") {
      return "Vision marked done but artifact is missing.";
    }
    return "No extract for this page yet.";
  }

  const rightPaneBody = resultMarkdown
    ? resultMarkdown
    : nativeText
      ? nativeText
      : resultEmptyMessage();
  const rightPaneSource = resultMarkdown
    ? "vision"
    : nativeText
      ? "native text"
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="shrink-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Attachment substrate
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">
            Page vision lab
          </h1>
          <Link
            href="/admin/analysis"
            className="text-sm font-medium text-teal-800 underline hover:text-teal-950"
          >
            ← Analysis lab
          </Link>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          <span className="font-medium text-slate-800">Awaiting vision</span> =
          PDF pages the profiler routed to vision/ambiguous, plus enrolled
          image attachments, that Gemini has not transcribed yet. Preview with
          the eye; extract from the row actions.
        </p>
      </div>

      {message ? (
        <p className="shrink-0 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="shrink-0 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-2 border-b border-slate-100 p-3">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setPage(1);
                  setFilter(f.id);
                }}
                className={`rounded-md border px-2 py-1 text-xs font-medium ${
                  filter === f.id
                    ? "border-teal-300 bg-teal-50 text-teal-900"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => {
                  setPage(1);
                  setKind(k.id);
                }}
                className={`rounded-md border px-2 py-1 text-xs font-medium ${
                  kind === k.id
                    ? "border-slate-400 bg-slate-100 text-slate-900"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setSearch(searchInput);
            }}
          >
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search filename or hash"
              className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            />
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="shrink-0 font-medium">Sort by</span>
              <select
                value={sort}
                onChange={(e) => {
                  setPage(1);
                  setSort(e.target.value as PageVisionListSort);
                }}
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800"
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Search
            </button>
          </form>
          <p className="text-xs text-slate-500">
            {loadingList
              ? "Loading…"
              : total === 0
                ? "0 documents"
                : `${rangeStart}–${rangeEnd} of ${total} document${total === 1 ? "" : "s"}`}
          </p>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto">
          {documents.map((doc) => {
            const pages = totalPagesFor(doc);
            const busy = runningHash === doc.contentHash;
            const anyBusy = runningHash != null;
            const page1Extractable = canExtractPage1(doc);
            return (
              <li
                key={doc.contentHash}
                className="border-b border-slate-100 px-3 py-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      <span
                        className={`mr-2 inline-block rounded border px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-wide ${
                          isImageAttachment(doc)
                            ? "border-sky-200 bg-sky-50 text-sky-900"
                            : "border-slate-200 bg-slate-50 text-slate-700"
                        }`}
                      >
                        {typeBadgeLabel(doc)}
                      </span>
                      {doc.filename || shortHash(doc.contentHash)}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                      {shortHash(doc.contentHash)}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-600">
                      <span className="font-medium text-slate-800">
                        {pages} page{pages === 1 ? "" : "s"}
                      </span>
                      <span aria-hidden>·</span>
                      <span className="text-amber-800">
                        {doc.pending} awaiting vision
                      </span>
                      <span aria-hidden>·</span>
                      <span
                        className={
                          doc.done > 0
                            ? "font-semibold text-teal-800"
                            : undefined
                        }
                      >
                        {doc.done} done
                      </span>
                      <span aria-hidden>·</span>
                      <span>{doc.failed} failed</span>
                      {doc.parseStatus ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>parse {doc.parseStatus}</span>
                        </>
                      ) : null}
                      {doc.done > 0 ? (
                        <>
                          <span aria-hidden>·</span>
                          <PageVisionCostBadge
                            summary={{
                              costUsd: doc.costUsd,
                              inputTokens: doc.inputTokens,
                              outputTokens: doc.outputTokens,
                              models: doc.models,
                              donePages: doc.done,
                            }}
                          />
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewDoc(doc)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      title="Preview PDF"
                      aria-label={`Preview ${doc.filename || shortHash(doc.contentHash)}`}
                    >
                      <EyeIcon className="h-4 w-4" />
                      Preview
                    </button>
                    {doc.done > 0 ? (
                      <button
                        type="button"
                        onClick={() => void openResult(doc)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-teal-900 hover:bg-teal-50"
                      >
                        View output
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={anyBusy || doc.pending === 0}
                      onClick={() => void runVision(doc)}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
                    >
                      {busy ? "Running…" : "Extract pending"}
                    </button>
                    <button
                      type="button"
                      disabled={anyBusy || pages < 1 || !page1Extractable}
                      onClick={() => void runVision(doc, [1])}
                      title={
                        page1Extractable
                          ? "Extract page 1"
                          : doc.page1VisionStatus === "done"
                            ? "Page 1 already extracted"
                            : "Page 1 is not awaiting vision"
                      }
                      className="rounded-lg border border-teal-300 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-950 hover:bg-teal-100 disabled:opacity-50"
                    >
                      {busy ? "Running…" : "Extract page 1"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
          {!loadingList && documents.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-slate-500">
              No documents match this filter.
            </li>
          ) : null}
        </ul>
        {total > PAGE_SIZE ? (
          <nav
            aria-label="Document list pagination"
            className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
          >
            <p>
              {rangeStart}–{rangeEnd} of {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={loadingList || page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="flex-1 text-center text-slate-600">
                Page {page} of {listPageCount}
              </span>
              <button
                type="button"
                disabled={loadingList || page >= listPageCount}
                onClick={() =>
                  setPage((p) => Math.min(listPageCount, p + 1))
                }
                className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </nav>
        ) : null}
      </section>

      {/* PDF preview modal */}
      {previewDoc ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setPreviewDoc(null)}
            aria-label="Close preview"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="page-vision-preview-title"
            className="relative flex h-[min(90dvh,52rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <h2
                  id="page-vision-preview-title"
                  className="truncate text-lg font-semibold text-slate-900"
                >
                  {previewDoc.filename || shortHash(previewDoc.contentHash)}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {totalPagesFor(previewDoc)} pages · {previewDoc.pending}{" "}
                  awaiting vision
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {isImageAttachment(previewDoc) ? (
              // eslint-disable-next-line @next/next/no-img-element -- lab preview of cached attachment bytes
              <img
                alt={
                  previewDoc.filename ||
                  `Attachment ${shortHash(previewDoc.contentHash)}`
                }
                src={`/api/analysis/page-vision/${previewDoc.contentHash}/file`}
                className="min-h-0 flex-1 w-full object-contain bg-slate-50"
              />
            ) : (
              <iframe
                title="PDF preview"
                src={`/api/analysis/page-vision/${previewDoc.contentHash}/file`}
                className="min-h-0 flex-1 w-full bg-slate-50"
              />
            )}
          </div>
        </div>
      ) : null}

      {/* Extraction result modal: PDF left, extract right, shared page */}
      {resultOpen && resultDetail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setResultOpen(false)}
            aria-label="Close results"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="page-vision-result-title"
            className="relative flex h-[min(90dvh,52rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <h2
                  id="page-vision-result-title"
                  className="truncate text-lg font-semibold text-slate-900"
                >
                  Vision output
                </h2>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {resultDetail.filename || shortHash(resultDetail.contentHash)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={resultPageNo <= 1}
                  onClick={() => goToResultPage(resultPageNo - 1)}
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  ← Page
                </button>
                <span className="tabular-nums text-xs text-slate-700">
                  {resultPageNo} / {resultPageCount}
                </span>
                <button
                  type="button"
                  disabled={resultPageNo >= resultPageCount}
                  onClick={() => goToResultPage(resultPageNo + 1)}
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  Page →
                </button>
                <button
                  type="button"
                  onClick={() => setResultOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-1 border-b border-slate-100 px-3 py-2">
              {resultDetail.pages.map((p) => (
                <button
                  key={p.pageNo}
                  type="button"
                  onClick={() => goToResultPage(p.pageNo)}
                  className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                    resultPageNo === p.pageNo
                      ? "border-teal-300 bg-teal-50 text-teal-900"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  p{p.pageNo} · {p.visionStatus}
                </button>
              ))}
            </div>

            <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section className="flex min-h-0 flex-col border-b border-slate-100 lg:border-b-0 lg:border-r">
                <div className="shrink-0 border-b border-slate-100 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Attachment preview · page {resultPageNo}
                </div>
                {isImageAttachment(resultDetail) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- lab preview of cached attachment bytes
                  <img
                    key={`${resultDetail.contentHash}-${resultPageNo}-${resultIframeTick}`}
                    alt={
                      resultDetail.filename ||
                      `Attachment ${shortHash(resultDetail.contentHash)}`
                    }
                    src={`/api/analysis/page-vision/${resultDetail.contentHash}/file`}
                    className="min-h-[40dvh] flex-1 w-full object-contain bg-slate-50 lg:min-h-0"
                  />
                ) : (
                  <iframe
                    key={`${resultDetail.contentHash}-${resultPageNo}-${resultIframeTick}`}
                    title="PDF preview"
                    src={`/api/analysis/page-vision/${resultDetail.contentHash}/file?page=${resultPageNo}`}
                    className="min-h-[40dvh] flex-1 w-full bg-slate-50 lg:min-h-0"
                  />
                )}
              </section>

              <section className="flex min-h-0 flex-col">
                <div className="shrink-0 border-b border-slate-100 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Extracted content · page {resultPageNo}
                  {resultPage ? ` · ${resultPage.visionStatus}` : ""}
                  {resultPage?.route ? ` · ${resultPage.route}` : ""}
                  {rightPaneSource ? ` · ${rightPaneSource}` : ""}
                </div>
                {showingNativeOnly ? (
                  <p className="shrink-0 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Showing selectable PDF text (vision not required for this
                    page).
                  </p>
                ) : null}
                {resultPage?.visionError ? (
                  <p className="shrink-0 border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {resultPage.visionError}
                  </p>
                ) : null}
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs text-slate-800">
                  {rightPaneBody}
                </pre>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
