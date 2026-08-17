"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DoclingBackfillButton } from "@/components/DoclingBackfillButton";
import { formatCostUsd, formatTokenCount } from "@/lib/gemini/usage";
import {
  isVisionImageExt,
  isVisionImageMime,
} from "@/lib/email/attachment-vision-image-shared";
import type {
  ExtractionCostSummary,
  ExtractionDocSummary,
  ExtractionFilterCounts,
  ExtractionListFilter,
  ExtractionListKind,
  ExtractionListSort,
  ExtractionProcessResult,
} from "@/lib/email/attachment-extraction-lab";
import type {
  PageVisionDocDetail,
  PageVisionPageDetail,
} from "@/lib/email/page-vision-lab";

type ListResponse = {
  documents?: ExtractionDocSummary[];
  total?: number;
  totalVisionPages?: number;
  costs?: ExtractionCostSummary | null;
  filterCounts?: ExtractionFilterCounts | null;
  error?: string;
};

type ProcessResponse = {
  result?: ExtractionProcessResult;
  costs?: ExtractionCostSummary | null;
  error?: string;
};

type DoclingResponse = {
  contentHash?: string;
  markdown?: string | null;
  pages?: Array<{ pageNo: number; markdown: string; cached?: boolean }>;
  requestedPages?: number[];
  skippedPages?: number[];
  elapsedMs?: number;
  pageCount?: number | null;
  cached?: boolean;
  error?: string;
};

type ExtractPaneSource = "lab" | "docling";

function extractDoclingPageFromMarkdown(
  markdown: string | null | undefined,
  pageNo: number,
): string | null {
  if (!markdown?.trim() || pageNo < 1) return null;
  const open = `<!-- docling:page=${pageNo} -->`;
  const close = `<!-- /docling:page=${pageNo} -->`;
  const start = markdown.indexOf(open);
  if (start < 0) return null;
  const end = markdown.indexOf(close, start);
  if (end < 0) return null;
  return markdown.slice(start + open.length, end).trim() || null;
}

/** Keep in sync with EXTRACTION_PROCESS_MAX_HASHES in attachment-extraction-lab. */
const EXTRACTION_PROCESS_MAX_HASHES = 20;

const FILTERS: { id: ExtractionListFilter; label: string }[] = [
  { id: "needs_work", label: "Needs work" },
  { id: "parsed", label: "Parsed" },
  { id: "failed", label: "Failed" },
  { id: "all", label: "All unique files" },
];

const KINDS: { id: ExtractionListKind; label: string }[] = [
  { id: "all", label: "All types" },
  { id: "pdf", label: "PDFs" },
  { id: "image", label: "Images" },
  { id: "other", label: "Other" },
];

const SORTS: { id: ExtractionListSort; label: string }[] = [
  { id: "filename_asc", label: "Name A → Z" },
  { id: "filename_desc", label: "Name Z → A" },
  { id: "pages_desc", label: "Pages high → low" },
  { id: "pages_asc", label: "Pages low → high" },
];

const PAGE_SIZE = 50;
const DEFAULT_SELECT_N = 5;

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…`;
}

function pathLabel(path: ExtractionDocSummary["path"]): string {
  switch (path) {
    case "text":
      return "Text (CF)";
    case "vision":
      return "Vision";
    case "mixed":
      return "Mixed";
    default:
      return "Unprofiled";
  }
}

function pathClasses(path: ExtractionDocSummary["path"]): string {
  switch (path) {
    case "text":
      return "bg-slate-100 text-slate-700";
    case "vision":
      return "bg-amber-50 text-amber-900";
    case "mixed":
      return "bg-teal-50 text-teal-900";
    default:
      return "bg-slate-50 text-slate-500";
  }
}

function typeBadge(kind: ExtractionDocSummary["kind"]): string {
  if (kind === "pdf") return "PDF";
  if (kind === "image") return "IMAGE";
  return "FILE";
}

function isImageAttachment(doc: {
  mimeType?: string | null;
  ext?: string | null;
  kind?: ExtractionDocSummary["kind"];
}): boolean {
  if (doc.kind === "image") return true;
  if (doc.mimeType && isVisionImageMime(doc.mimeType)) return true;
  return isVisionImageExt(doc.ext);
}

function pageCountForDetail(detail: PageVisionDocDetail): number {
  return Math.max(
    detail.pageCount ?? 0,
    ...detail.pages.map((p) => p.pageNo),
    1,
  );
}

function visionMarkdownForPage(
  detail: PageVisionDocDetail,
  pageNo: number,
  page?: PageVisionPageDetail,
): string | null {
  const fromArtifact = page?.artifactMarkdown?.trim();
  if (fromArtifact) return fromArtifact;
  const markdown = detail.markdown;
  if (!markdown || !pageNo) return null;
  const open = `<!-- vision:page=${pageNo} -->`;
  const close = `<!-- /vision:page=${pageNo} -->`;
  const start = markdown.indexOf(open);
  if (start < 0) return null;
  const end = markdown.indexOf(close, start);
  if (end < 0) return null;
  return markdown.slice(start, end + close.length).trim();
}

function extractPaneForPage(
  detail: PageVisionDocDetail,
  pageNo: number,
  page?: PageVisionPageDetail,
): { body: string; source: string | null; nativeOnly: boolean } {
  const visionMarkdown = visionMarkdownForPage(detail, pageNo, page);
  const nativeText = page?.nativeText?.trim() || null;
  const fullMarkdown = detail.markdown?.trim() || null;

  if (visionMarkdown) {
    return { body: visionMarkdown, source: "vision", nativeOnly: false };
  }
  if (nativeText) {
    return { body: nativeText, source: "native text", nativeOnly: true };
  }
  if (fullMarkdown) {
    return {
      body: fullMarkdown,
      source: detail.parserName || "markdown",
      nativeOnly: false,
    };
  }

  let message = "No extract for this page yet.";
  if (!page) message = "No page profile for this page.";
  else if (page.visionStatus === "pending") {
    message = "Awaiting vision for this page.";
  } else if (page.visionStatus === "failed") {
    message = "Vision failed for this page.";
  } else if (page.visionStatus === "processing") {
    message = "Vision in progress for this page…";
  }

  return { body: message, source: null, nativeOnly: false };
}

export function AttachmentExtractionLabClient() {
  const [filter, setFilter] = useState<ExtractionListFilter>("needs_work");
  const [kind, setKind] = useState<ExtractionListKind>("all");
  const [sort, setSort] = useState<ExtractionListSort>("filename_asc");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [selectN, setSelectN] = useState(DEFAULT_SELECT_N);
  const [documents, setDocuments] = useState<ExtractionDocSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [totalVisionPages, setTotalVisionPages] = useState(0);
  const [costs, setCosts] = useState<ExtractionCostSummary | null>(null);
  const [filterCounts, setFilterCounts] =
    useState<ExtractionFilterCounts | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingList, setLoadingList] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<ExtractionProcessResult | null>(null);
  const [costsOpen, setCostsOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewDetail, setViewDetail] = useState<PageVisionDocDetail | null>(null);
  const [viewPageNo, setViewPageNo] = useState(1);
  const [viewIframeTick, setViewIframeTick] = useState(0);
  const [viewLoadingHash, setViewLoadingHash] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [extractSource, setExtractSource] = useState<ExtractPaneSource>("lab");
  const [doclingMarkdown, setDoclingMarkdown] = useState<string | null>(null);
  const [doclingPages, setDoclingPages] = useState<Map<number, string>>(
    () => new Map(),
  );
  const [doclingSkippedPages, setDoclingSkippedPages] = useState<number[]>([]);
  const [doclingLoading, setDoclingLoading] = useState(false);
  const [doclingMeta, setDoclingMeta] = useState<string | null>(null);
  const [doclingError, setDoclingError] = useState<string | null>(null);

  const listPageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  const selectedCount = selected.size;
  const selectNClamped = Math.min(
    Math.max(1, selectN || 1),
    EXTRACTION_PROCESS_MAX_HASHES,
  );
  const lastRunErrors = useMemo(
    () => lastRun?.files.filter((f) => f.error) ?? [],
    [lastRun],
  );

  const viewPageCount = viewDetail ? pageCountForDetail(viewDetail) : 1;
  const viewPage = viewDetail?.pages.find((p) => p.pageNo === viewPageNo);
  const labPane = viewDetail
    ? extractPaneForPage(viewDetail, viewPageNo, viewPage)
    : { body: "", source: null, nativeOnly: false };
  const textRoutePages = useMemo(() => {
    if (!viewDetail) return [] as number[];
    return viewDetail.pages
      .filter((p) => p.route === "text")
      .map((p) => p.pageNo)
      .sort((a, b) => a - b);
  }, [viewDetail]);
  const hasDoclingForViewPage =
    doclingPages.has(viewPageNo) ||
    Boolean(extractDoclingPageFromMarkdown(doclingMarkdown, viewPageNo));
  const doclingPageBody =
    doclingPages.get(viewPageNo) ??
    extractDoclingPageFromMarkdown(doclingMarkdown, viewPageNo);
  const viewPageSkippedForDocling =
    Boolean(viewPage) &&
    viewPage!.route !== "text" &&
    (doclingSkippedPages.includes(viewPageNo) ||
      viewPage!.route === "vision" ||
      viewPage!.route === "ambiguous");
  const showingDocling = extractSource === "docling";
  const viewPane = showingDocling
    ? doclingPageBody
      ? {
          body: doclingPageBody,
          source: "docling",
          nativeOnly: false,
        }
      : viewPageSkippedForDocling
        ? {
            body:
              "This page is routed to vision/ambiguous — Docling was not run.\n" +
              "Switch to Lab to see vision markdown or native text.",
            source: "docling skipped",
            nativeOnly: false,
          }
        : {
            body: hasDoclingForViewPage
              ? "Docling page body missing."
              : "No Docling extract for this page yet. Run Extract with Docling (text-route pages only).",
            source: null,
            nativeOnly: false,
          }
    : labPane;

  const goToViewPage = useCallback(
    (nextPage: number) => {
      const clamped = Math.min(Math.max(1, nextPage), viewPageCount);
      setViewPageNo(clamped);
      setViewIframeTick((t) => t + 1);
    },
    [viewPageCount],
  );

  useEffect(() => {
    if (!viewOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setViewOpen(false);
        return;
      }
      if (!viewDetail) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToViewPage(viewPageNo - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToViewPage(viewPageNo + 1);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [viewOpen, viewDetail, viewPageNo, goToViewPage]);

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
        costs: "1",
      });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/analysis/extraction?${params}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as ListResponse;
      if (!res.ok) throw new Error(data.error ?? "Could not load documents.");
      setDocuments(data.documents ?? []);
      setTotal(data.total ?? 0);
      setTotalVisionPages(data.totalVisionPages ?? 0);
      setCosts(data.costs ?? null);
      setFilterCounts(data.filterCounts ?? null);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load documents.");
    } finally {
      setLoadingList(false);
    }
  }, [filter, kind, sort, search, page]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (loadingList) return;
    if (page > listPageCount) setPage(listPageCount);
  }, [loadingList, page, listPageCount]);

  const allVisibleSelected = useMemo(
    () =>
      documents.length > 0 &&
      documents.every((doc) => selected.has(doc.contentHash)),
    [documents, selected],
  );

  function toggleHash(hash: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else {
        if (next.size >= EXTRACTION_PROCESS_MAX_HASHES) {
          setError(
            `Select at most ${EXTRACTION_PROCESS_MAX_HASHES} files per run.`,
          );
          return prev;
        }
        next.add(hash);
      }
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const doc of documents) next.delete(doc.contentHash);
        return next;
      }
      const next = new Set(prev);
      for (const doc of documents) {
        if (next.size >= EXTRACTION_PROCESS_MAX_HASHES) break;
        next.add(doc.contentHash);
      }
      return next;
    });
  }

  function selectFirstN() {
    const next = new Set<string>();
    for (const doc of documents) {
      if (next.size >= selectNClamped) break;
      next.add(doc.contentHash);
    }
    setSelected(next);
    setError(null);
  }

  async function copyContentHash(hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(hash);
      window.setTimeout(() => {
        setCopiedHash((current) => (current === hash ? null : current));
      }, 1500);
    } catch {
      setError("Could not copy hash to clipboard.");
    }
  }

  function applyDoclingResponse(data: DoclingResponse) {
    const nextPages = new Map<number, string>();
    for (const page of data.pages ?? []) {
      if (page.pageNo >= 1 && page.markdown?.trim()) {
        nextPages.set(page.pageNo, page.markdown.trim());
      }
    }
    if (nextPages.size === 0 && data.markdown?.trim()) {
      // Older whole-doc cache: parse markers.
      const matches = data.markdown.matchAll(
        /<!-- docling:page=(\d+) -->([\s\S]*?)<!-- \/docling:page=\1 -->/g,
      );
      for (const match of matches) {
        const pageNo = Number(match[1]);
        const body = match[2]?.trim() ?? "";
        if (pageNo >= 1 && body) nextPages.set(pageNo, body);
      }
    }
    setDoclingPages(nextPages);
    setDoclingMarkdown(data.markdown?.trim() || null);
    setDoclingSkippedPages(
      Array.isArray(data.skippedPages) ? data.skippedPages : [],
    );

    const parts: string[] = [];
    if (data.cached) parts.push("cached");
    else if (typeof data.elapsedMs === "number" && data.elapsedMs > 0) {
      parts.push(`${(data.elapsedMs / 1000).toFixed(1)}s`);
    }
    const requested =
      data.requestedPages?.length ??
      nextPages.size ??
      data.pageCount ??
      0;
    if (requested > 0) parts.push(`${requested} text page${requested === 1 ? "" : "s"}`);
    if (data.skippedPages && data.skippedPages.length > 0) {
      parts.push(`skipped vision ${data.skippedPages.join(",")}`);
    }
    setDoclingMeta(parts.length > 0 ? parts.join(" · ") : null);
  }

  async function loadCachedDocling(contentHash: string) {
    setDoclingError(null);
    setDoclingMeta(null);
    setDoclingMarkdown(null);
    setDoclingPages(new Map());
    setDoclingSkippedPages([]);
    setExtractSource("lab");
    try {
      const res = await fetch(
        `/api/analysis/extraction/${contentHash}/docling`,
        { cache: "no-store" },
      );
      if (res.status === 404) return;
      const data = (await res.json()) as DoclingResponse;
      if (!res.ok) return;
      if (data.markdown?.trim() || (data.pages && data.pages.length > 0)) {
        applyDoclingResponse(data);
      }
    } catch {
      // Cache miss / sidecar offline is fine until user clicks Extract.
    }
  }

  async function runDoclingExtract(options?: { force?: boolean }) {
    if (!viewDetail) return;
    const hash = viewDetail.contentHash;
    if (textRoutePages.length === 0) {
      setDoclingError(
        "No text-route pages on this document — Docling is for text pages only (vision stays on Gemini).",
      );
      return;
    }
    setDoclingLoading(true);
    setDoclingError(null);
    try {
      const res = await fetch(
        `/api/analysis/extraction/${hash}/docling${
          options?.force ? "?force=1" : ""
        }`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            force: Boolean(options?.force),
            pages: textRoutePages,
          }),
        },
      );
      const data = (await res.json()) as DoclingResponse;
      if (!res.ok) {
        throw new Error(data.error ?? "Docling extract failed.");
      }
      if (
        !data.markdown?.trim() &&
        !(data.pages && data.pages.some((p) => p.markdown?.trim()))
      ) {
        throw new Error("Docling returned empty markdown.");
      }
      applyDoclingResponse(data);
      setExtractSource("docling");
    } catch (err) {
      setDoclingError(
        err instanceof Error ? err.message : "Docling extract failed.",
      );
    } finally {
      setDoclingLoading(false);
    }
  }

  async function openExtractView(doc: ExtractionDocSummary) {
    setViewLoadingHash(doc.contentHash);
    setError(null);
    setDoclingError(null);
    setDoclingMarkdown(null);
    setDoclingPages(new Map());
    setDoclingSkippedPages([]);
    setDoclingMeta(null);
    setExtractSource("lab");
    try {
      const res = await fetch(`/api/analysis/page-vision/${doc.contentHash}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as PageVisionDocDetail & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not load document extract.");
      }
      const firstPage =
        data.pages.find((p) => p.visionStatus === "done")?.pageNo ??
        data.pages[0]?.pageNo ??
        1;
      setViewDetail(data);
      setViewPageNo(firstPage);
      setViewIframeTick((t) => t + 1);
      setViewOpen(true);
      void loadCachedDocling(doc.contentHash);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load document extract.",
      );
    } finally {
      setViewLoadingHash(null);
    }
  }

  async function processSelected() {
    const hashes = [...selected];
    if (hashes.length === 0) {
      setError("Select at least one file to process.");
      return;
    }
    if (
      !window.confirm(
        `Process ${hashes.length} selected file${hashes.length === 1 ? "" : "s"}?\n` +
          `Markdown (Cloudflare) runs when needed; Gemini vision only for routed pages/images.`,
      )
    ) {
      return;
    }

    setProcessing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/analysis/extraction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentHashes: hashes }),
      });
      const data = (await res.json()) as ProcessResponse;
      if (!res.ok) throw new Error(data.error ?? "Process failed.");
      const result = data.result;
      setLastRun(result ?? null);
      if (data.costs) setCosts(data.costs);
      if (result) {
        const errs = result.files.filter((f) => f.error).length;
        setMessage(
          `Processed ${result.processed}: markdown ${result.markdownRan}, vision ${result.visionRan}` +
            (result.visionCostUsd > 0
              ? ` · ${formatCostUsd(result.visionCostUsd)} vision`
              : " · $0 vision") +
            (errs > 0 ? ` · ${errs} error${errs === 1 ? "" : "s"}` : ""),
        );
      }
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Process failed.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="shrink-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Attachment substrate
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-slate-900">
              Extraction lab
            </h1>
            <button
              type="button"
              onClick={() => setCostsOpen(true)}
              disabled={!costs}
              title="Cost & path breakdown"
              aria-label="Open cost and path breakdown"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <BreakdownIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <DoclingBackfillButton />
            <Link
              href="/admin/analysis/page-vision"
              className="font-medium text-teal-800 underline hover:text-teal-950"
            >
              Page vision lab
            </Link>
            <Link
              href="/admin/analysis"
              className="font-medium text-teal-800 underline hover:text-teal-950"
            >
              ← Analysis lab
            </Link>
          </div>
        </div>
      </div>

      {costs ? (
        <div className="grid shrink-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Needs work"
            value={costs.needsWork.toLocaleString()}
            hint={`${costs.parsed.toLocaleString()} parsed · ${costs.total.toLocaleString()} unique`}
          />
          <StatCard
            label="Vision AI cost"
            value={formatCostUsd(costs.totalVisionCostUsd)}
            hint={`${costs.byPath.vision.count.toLocaleString()} on vision/mixed`}
          />
          <StatCard
            label="Text-only files"
            value={costs.byPath.textOnly.count.toLocaleString()}
            hint={`CF ${formatTokenCount(costs.byPath.textOnly.cfTokens)} tok · $0 Gemini`}
          />
          <StatCard
            label="CF toMarkdown tokens"
            value={formatTokenCount(costs.totalCfTokens)}
            hint="Cloudflare tokens (not USD)"
          />
        </div>
      ) : null}

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

      {lastRunErrors.length > 0 ? (
        <div className="shrink-0 max-h-36 overflow-y-auto rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="font-medium">
            {lastRunErrors.length} error
            {lastRunErrors.length === 1 ? "" : "s"} in last run
          </p>
          <ul className="mt-1 space-y-1.5 text-xs">
            {lastRunErrors.map((f) => (
              <li key={f.contentHash}>
                <span className="font-semibold text-red-950">
                  {f.filename || shortHash(f.contentHash)}
                </span>
                <span className="text-red-700/80">
                  {" "}
                  ({shortHash(f.contentHash)})
                </span>
                <div className="mt-0.5 break-words font-mono text-[11px] text-red-700">
                  {f.error}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {lastRun && lastRun.files.length > 0 && lastRunErrors.length === 0 ? (
        <details className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
          <summary className="cursor-pointer font-medium text-slate-800">
            Last run ({lastRun.files.length} files ·{" "}
            {formatCostUsd(lastRun.visionCostUsd)} vision)
          </summary>
          <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-slate-600">
            {lastRun.files.map((f) => (
              <li key={f.contentHash}>
                <span className="font-medium text-slate-800">
                  {f.filename || shortHash(f.contentHash)}
                </span>
                {" — "}
                {f.markdownRan ? "markdown" : "no markdown"}
                {f.vision
                  ? ` · vision ${f.vision.done}d/${f.vision.failed}f`
                  : " · no vision"}
                {f.visionCostUsd > 0
                  ? ` · ${formatCostUsd(f.visionCostUsd)}`
                  : ""}
                <span>
                  {" "}
                  · {f.parseStatusBefore} → {f.parseStatusAfter}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-2 border-b border-slate-100 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
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
                  {filterCounts ? (
                    <span className="ml-1 tabular-nums text-slate-500">
                      {filterCounts.filter[f.id].toLocaleString()}
                    </span>
                  ) : null}
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
                  {filterCounts ? (
                    <span className="ml-1 tabular-nums text-slate-500">
                      {filterCounts.kind[k.id].toLocaleString()}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
          <form
            className="flex flex-wrap items-center gap-2"
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
              <span className="shrink-0 font-medium">Sort</span>
              <select
                value={sort}
                onChange={(e) => {
                  setPage(1);
                  setSort(e.target.value as ExtractionListSort);
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

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="font-medium">Select</span>
              <input
                type="number"
                min={1}
                max={EXTRACTION_PROCESS_MAX_HASHES}
                value={selectN}
                onChange={(e) => setSelectN(Number(e.target.value) || 1)}
                className="w-14 rounded-md border border-slate-200 px-2 py-1 text-sm tabular-nums"
              />
              <span>on this page</span>
            </label>
            <button
              type="button"
              onClick={selectFirstN}
              disabled={loadingList || documents.length === 0 || processing}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Select first {selectNClamped}
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={selectedCount === 0 || processing}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Clear
            </button>
            <span className="text-xs text-slate-500">
              {selectedCount} selected (max {EXTRACTION_PROCESS_MAX_HASHES})
            </span>
            <button
              type="button"
              onClick={() => void processSelected()}
              disabled={processing || selectedCount === 0}
              className="ml-auto rounded-md border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-100 disabled:opacity-50"
            >
              {processing
                ? "Processing…"
                : `Process selected (${selectedCount})`}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
          <span>
            {loadingList
              ? "Loading…"
              : `${rangeStart}–${rangeEnd} of ${total.toLocaleString()} documents [${totalVisionPages.toLocaleString()} vision pages]`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1 || loadingList}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-slate-200 px-2 py-0.5 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="tabular-nums">
              {page}/{listPageCount}
            </span>
            <button
              type="button"
              disabled={page >= listPageCount || loadingList}
              onClick={() => setPage((p) => Math.min(listPageCount, p + 1))}
              className="rounded border border-slate-200 px-2 py-0.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
          <li className="flex items-center gap-3 bg-slate-50/80 px-3 py-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleAllVisible}
              disabled={documents.length === 0 || processing}
              aria-label="Select all on this page"
            />
            <span>Select page</span>
          </li>
          {documents.map((doc) => {
            const checked = selected.has(doc.contentHash);
            return (
              <li
                key={doc.contentHash}
                className="flex items-start gap-3 px-3 py-2.5 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked}
                  disabled={processing}
                  onChange={() => toggleHash(doc.contentHash)}
                  aria-label={`Select ${doc.filename || doc.contentHash}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex flex-wrap items-center gap-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                        {typeBadge(doc.kind)}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${pathClasses(doc.path)}`}
                      >
                        {pathLabel(doc.path)}
                      </span>
                      <span className="truncate text-sm font-medium text-slate-900">
                        {doc.filename || shortHash(doc.contentHash)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <span
                        className="max-w-[7.5rem] truncate font-mono text-[11px] text-slate-400"
                        title={doc.contentHash}
                      >
                        {shortHash(doc.contentHash)}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyContentHash(doc.contentHash)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        title={
                          copiedHash === doc.contentHash
                            ? "Copied"
                            : "Copy content hash"
                        }
                        aria-label="Copy content hash"
                      >
                        {copiedHash === doc.contentHash ? (
                          <CheckIcon className="h-3.5 w-3.5 text-teal-700" />
                        ) : (
                          <CopyIcon className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void openExtractView(doc)}
                        disabled={viewLoadingHash === doc.contentHash}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                        title="Preview attachment and extract"
                        aria-label="Preview attachment and extract"
                      >
                        <EyeIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {doc.pageCount != null
                      ? `${doc.pageCount} pages`
                      : "pages ?"}
                    {" · "}
                    parse {doc.parseStatus}
                    {doc.pendingVision > 0
                      ? ` · ${doc.pendingVision} awaiting vision`
                      : ""}
                    {doc.doneVision > 0
                      ? ` · ${doc.doneVision} vision done`
                      : ""}
                    {doc.failedVision > 0
                      ? ` · ${doc.failedVision} vision failed`
                      : ""}
                    {doc.visionCostUsd > 0
                      ? ` · ${formatCostUsd(doc.visionCostUsd)}`
                      : ""}
                    {doc.cfTokens != null && doc.cfTokens > 0
                      ? ` · CF ${formatTokenCount(doc.cfTokens)} tok`
                      : ""}
                  </p>
                  {doc.parseError ? (
                    <p className="mt-1 truncate text-xs text-red-600">
                      {doc.parseError}
                    </p>
                  ) : null}
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
      </section>

      {viewOpen && viewDetail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setViewOpen(false)}
            aria-label="Close preview"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="extraction-view-title"
            className="relative flex h-[min(90dvh,52rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <h2
                  id="extraction-view-title"
                  className="truncate text-lg font-semibold text-slate-900"
                >
                  Extracted content
                </h2>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {viewDetail.filename || shortHash(viewDetail.contentHash)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={viewPageNo <= 1}
                  onClick={() => goToViewPage(viewPageNo - 1)}
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  ← Page
                </button>
                <span className="tabular-nums text-xs text-slate-700">
                  {viewPageNo} / {viewPageCount}
                </span>
                <button
                  type="button"
                  disabled={viewPageNo >= viewPageCount}
                  onClick={() => goToViewPage(viewPageNo + 1)}
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  Page →
                </button>
                <button
                  type="button"
                  disabled={doclingLoading || textRoutePages.length === 0}
                  onClick={() => void runDoclingExtract()}
                  title={
                    textRoutePages.length === 0
                      ? "No text-route pages — Docling is for text pages only"
                      : `Docling text pages: ${textRoutePages.join(", ")} (npm run docling:sidecar)`
                  }
                  className="rounded-md border border-teal-300 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-900 hover:bg-teal-100 disabled:opacity-40"
                >
                  {doclingLoading
                    ? "Docling…"
                    : doclingPages.size > 0 || doclingMarkdown
                      ? "Re-run Docling"
                      : "Extract with Docling"}
                </button>
                {doclingPages.size > 0 || doclingMarkdown ? (
                  <button
                    type="button"
                    disabled={doclingLoading || textRoutePages.length === 0}
                    onClick={() => void runDoclingExtract({ force: true })}
                    title="Ignore cache and convert text pages again"
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Force
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setViewOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            {viewDetail.pages.length > 0 ? (
              <div className="flex shrink-0 flex-wrap gap-1 border-b border-slate-100 px-3 py-2">
                {viewDetail.pages.map((p) => (
                  <button
                    key={p.pageNo}
                    type="button"
                    onClick={() => goToViewPage(p.pageNo)}
                    className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                      viewPageNo === p.pageNo
                        ? "border-teal-300 bg-teal-50 text-teal-900"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    p{p.pageNo} · {p.route || p.visionStatus}
                    {p.route === "text" && doclingPages.has(p.pageNo)
                      ? " · docling"
                      : ""}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section className="flex min-h-0 flex-col border-b border-slate-100 lg:border-b-0 lg:border-r">
                <div className="shrink-0 border-b border-slate-100 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Attachment preview · page {viewPageNo}
                </div>
                {isImageAttachment({
                  mimeType: viewDetail.mimeType,
                  ext: viewDetail.ext,
                  kind: classifyKindFromDetail(viewDetail),
                }) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- lab preview of cached bytes
                  <img
                    key={`${viewDetail.contentHash}-${viewIframeTick}`}
                    alt={
                      viewDetail.filename ||
                      `Attachment ${shortHash(viewDetail.contentHash)}`
                    }
                    src={`/api/analysis/page-vision/${viewDetail.contentHash}/file`}
                    className="min-h-[40dvh] flex-1 w-full object-contain bg-slate-50 lg:min-h-0"
                  />
                ) : (
                  <iframe
                    key={`${viewDetail.contentHash}-${viewPageNo}-${viewIframeTick}`}
                    title="Attachment preview"
                    src={`/api/analysis/page-vision/${viewDetail.contentHash}/file?page=${viewPageNo}`}
                    className="min-h-[40dvh] flex-1 w-full bg-slate-50 lg:min-h-0"
                  />
                )}
              </section>

              <section className="flex min-h-0 flex-col">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Extracted content · page {viewPageNo}
                    {viewPage?.route ? ` · ${viewPage.route}` : ""}
                    {showingDocling
                      ? doclingPageBody
                        ? " · docling"
                        : viewPageSkippedForDocling
                          ? " · docling skipped"
                          : " · docling"
                      : `${viewPage ? ` · ${viewPage.visionStatus}` : ""}${
                          viewPane.source ? ` · ${viewPane.source}` : ""
                        }`}
                    {showingDocling && doclingMeta ? ` · ${doclingMeta}` : ""}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setExtractSource("lab")}
                      className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                        extractSource === "lab"
                          ? "border-slate-400 bg-slate-100 text-slate-900"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      Lab
                    </button>
                    <button
                      type="button"
                      disabled={doclingPages.size === 0 && !doclingMarkdown}
                      onClick={() => setExtractSource("docling")}
                      className={`rounded border px-2 py-0.5 text-[11px] font-medium disabled:opacity-40 ${
                        extractSource === "docling"
                          ? "border-teal-400 bg-teal-50 text-teal-900"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      Docling
                    </button>
                  </div>
                </div>
                {showingDocling && doclingPageBody ? (
                  <p className="shrink-0 border-b border-teal-100 bg-teal-50 px-3 py-2 text-xs text-teal-900">
                    Docling structured markdown for this text-route page.
                    {doclingSkippedPages.length > 0
                      ? ` Vision/ambiguous pages skipped: ${doclingSkippedPages.join(", ")}.`
                      : ""}
                  </p>
                ) : showingDocling && viewPageSkippedForDocling ? (
                  <p className="shrink-0 border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Mixed doc: this page stays on the vision path. Docling only
                    runs for text-route pages ({textRoutePages.join(", ") || "none"}).
                  </p>
                ) : !showingDocling && viewPane.nativeOnly ? (
                  <p className="shrink-0 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Showing selectable PDF text (vision not required for this
                    page). Use Extract with Docling to compare structured
                    markdown on text pages.
                  </p>
                ) : null}
                {doclingError ? (
                  <p className="shrink-0 border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {doclingError}
                  </p>
                ) : null}
                {!showingDocling && viewPage?.visionError ? (
                  <p className="shrink-0 border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {viewPage.visionError}
                  </p>
                ) : null}
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs text-slate-800">
                  {viewPane.body}
                </pre>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {costsOpen && costs ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="presentation"
          onClick={() => setCostsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="extraction-costs-title"
            className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2
                  id="extraction-costs-title"
                  className="text-lg font-semibold text-slate-900"
                >
                  Cost & path breakdown
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Vision $ is Gemini. CF tokens are Cloudflare toMarkdown (not
                  USD).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCostsOpen(false)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="overflow-x-auto overflow-y-auto p-5">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Breakdown</th>
                    <th className="px-3 py-2 font-medium">Files</th>
                    <th className="px-3 py-2 font-medium">Vision $</th>
                    <th className="px-3 py-2 font-medium">CF tokens</th>
                    <th className="px-3 py-2 font-medium">Text-only</th>
                    <th className="px-3 py-2 font-medium">Vision path</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {(
                    [
                      ["PDF", costs.byKind.pdf],
                      ["Image", costs.byKind.image],
                      ["Other", costs.byKind.other],
                      ["Path: text only", costs.byPath.textOnly],
                      ["Path: vision/mixed", costs.byPath.vision],
                    ] as const
                  ).map(([label, bucket]) => (
                    <tr key={label}>
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {label}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {bucket.count.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatCostUsd(bucket.visionCostUsd)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatTokenCount(bucket.cfTokens)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {bucket.textOnlyDocs.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {bucket.visionDocs.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BreakdownIcon({ className }: { className?: string }) {
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
        d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3"
      />
    </svg>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

function classifyKindFromDetail(
  detail: PageVisionDocDetail,
): ExtractionDocSummary["kind"] {
  if (detail.mimeType?.toLowerCase().startsWith("image/")) return "image";
  if (
    detail.mimeType?.toLowerCase().includes("pdf") ||
    detail.ext?.toLowerCase() === ".pdf"
  ) {
    return "pdf";
  }
  return "other";
}

function CopyIcon({ className }: { className?: string }) {
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
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
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
