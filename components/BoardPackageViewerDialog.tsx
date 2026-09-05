"use client";

import { useEffect, useState } from "react";

import { MarkdownPreview } from "@/components/MarkdownPreview";
import { PullMeetingSourcesButton } from "@/components/PullMeetingSourcesButton";
import { ZoomablePdfViewer } from "@/components/ZoomablePdfViewer";

type BoardPackageMeta = {
  fileName: string;
  pageCount: number | null;
  sizeBytes: number | null;
  available: boolean;
  source: "file" | "metadata";
};

type ExtractedPage = {
  pageNumber: number;
  pageHeading: string | null;
  extractedText: string;
};

type FormatTab = "pdf" | "markdown";

type Props = {
  open: boolean;
  meetingId: string;
  onClose: () => void;
  /** When true, renders only the viewer body (no modal shell). */
  embedded?: boolean;
};

export function BoardPackageViewerDialog({
  open,
  meetingId,
  onClose,
  embedded = false,
}: Props) {
  const [meta, setMeta] = useState<BoardPackageMeta | null>(null);
  const [formatTab, setFormatTab] = useState<FormatTab>("pdf");
  const [extractPages, setExtractPages] = useState<ExtractedPage[]>([]);
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [markdownPageIndex, setMarkdownPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function loadBoardPackage() {
      setLoading(true);
      setError(null);
      setMeta(null);
      setExtractPages([]);
      setExtractError(null);
      setMarkdownPageIndex(0);
      setFormatTab("pdf");

      try {
        const metaRes = await fetch(`/api/meetings/${meetingId}/board-package?meta=1`);
        if (!metaRes.ok) {
          const payload = (await metaRes.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "Could not load board package.");
        }

        const metaPayload = (await metaRes.json()) as BoardPackageMeta;
        if (cancelled) return;
        setMeta(metaPayload);

        if (!metaPayload.available) {
          setError(
            "Board package metadata exists in the database, but the PDF file is not stored on this machine. Open the meeting in the environment where it was uploaded, or upload the meeting again locally.",
          );
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load board package.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadBoardPackage();

    return () => {
      cancelled = true;
    };
  }, [open, meetingId]);

  useEffect(() => {
    if (!open || formatTab !== "markdown") return;

    let cancelled = false;
    setExtractLoading(true);
    setExtractError(null);

    async function loadExtract() {
      try {
        const response = await fetch(`/api/v2/meetings/${meetingId}/board-package-extract`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Could not load extracted markdown.");
        }
        const payload = (await response.json()) as { pages: ExtractedPage[] };
        if (cancelled) return;
        setExtractPages(payload.pages ?? []);
        setMarkdownPageIndex(0);
      } catch (e) {
        if (cancelled) return;
        setExtractError(e instanceof Error ? e.message : "Could not load extracted markdown.");
      } finally {
        if (!cancelled) setExtractLoading(false);
      }
    }

    void loadExtract();

    return () => {
      cancelled = true;
    };
  }, [open, meetingId, formatTab]);

  if (!open) return null;

  const downloadUrl = `/api/meetings/${meetingId}/board-package`;
  const sizeLabel =
    meta?.sizeBytes != null
      ? meta.sizeBytes >= 1_048_576
        ? `${(meta.sizeBytes / 1_048_576).toFixed(1)} MB`
        : `${Math.max(1, Math.round(meta.sizeBytes / 1024))} KB`
      : null;

  const activeExtractPage = extractPages[markdownPageIndex] ?? null;

  const formatStrip = (
    <div
      className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
      role="tablist"
      aria-label="Board package format"
    >
      <button
        type="button"
        role="tab"
        aria-selected={formatTab === "pdf"}
        onClick={() => setFormatTab("pdf")}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          formatTab === "pdf"
            ? "bg-white text-slate-900 shadow-sm"
            : "text-slate-600 hover:text-slate-900"
        }`}
      >
        Raw PDF
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={formatTab === "markdown"}
        onClick={() => setFormatTab("markdown")}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          formatTab === "markdown"
            ? "bg-white text-slate-900 shadow-sm"
            : "text-slate-600 hover:text-slate-900"
        }`}
      >
        Docling Markdown
      </button>
    </div>
  );

  const contentBlock = (
    <div className={`min-h-0 flex-1 overflow-hidden ${embedded ? "" : "px-6 py-5"}`}>
      {loading ? (
        <p className={`text-sm text-slate-600 ${embedded ? "px-4 py-3" : ""}`}>Loading board package…</p>
      ) : error ? (
        <div className={`rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 ${embedded ? "mx-4 my-3" : ""}`}>
          <p>{error}</p>
          <PullMeetingSourcesButton
            meetingId={meetingId}
            className="mt-3"
            onPulled={() => window.location.reload()}
          />
        </div>
      ) : formatTab === "pdf" && meta?.available ? (
        <ZoomablePdfViewer
          url={downloadUrl}
          className={embedded ? "h-[min(60vh,560px)]" : "h-[min(70vh,720px)] rounded-xl border border-slate-200"}
        />
      ) : formatTab === "markdown" ? (
        <div className={`flex min-h-0 flex-col ${embedded ? "h-[min(60vh,560px)]" : "h-[min(70vh,720px)]"}`}>
          {extractLoading ? (
            <p className={`text-sm text-slate-600 ${embedded ? "px-4 py-3" : ""}`}>Loading extracted markdown…</p>
          ) : extractError ? (
            <div className={`rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 ${embedded ? "mx-4 my-3" : ""}`}>
              {extractError}
            </div>
          ) : extractPages.length === 0 ? (
            <div className={`rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600 ${embedded ? "mx-4 my-3" : ""}`}>
              No extracted pages yet. Run the pipeline to ingest the board package with Docling.
            </div>
          ) : (
            <>
              <div className={`flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 ${embedded ? "" : "rounded-t-xl border border-b-slate-200"}`}>
                <button
                  type="button"
                  disabled={markdownPageIndex <= 0}
                  onClick={() => setMarkdownPageIndex((current) => Math.max(0, current - 1))}
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="text-sm tabular-nums text-slate-700">
                  Page {activeExtractPage?.pageNumber ?? 1} of {extractPages.length}
                </span>
                <button
                  type="button"
                  disabled={markdownPageIndex >= extractPages.length - 1}
                  onClick={() =>
                    setMarkdownPageIndex((current) => Math.min(extractPages.length - 1, current + 1))
                  }
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
                {activeExtractPage?.pageHeading ? (
                  <span className="ml-2 truncate text-sm text-slate-500">{activeExtractPage.pageHeading}</span>
                ) : null}
              </div>
              <div className={`min-h-0 flex-1 overflow-auto bg-white p-4 ${embedded ? "" : "rounded-b-xl border border-t-0 border-slate-200"}`}>
                {activeExtractPage ? (
                  <MarkdownPreview>{activeExtractPage.extractedText}</MarkdownPreview>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className={`rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 ${embedded ? "mx-4 my-3" : ""}`}>
          Board package preview is not available on this server.
        </div>
      )}
    </div>
  );

  if (embedded) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-sm text-slate-600">
                {meta?.fileName ?? "board-package.pdf"}
              </p>
              {meta ? (
                <p className="mt-1 text-xs text-slate-500">
                  {meta.pageCount != null ? `${meta.pageCount} pages` : "Page count unknown"}
                  {sizeLabel ? ` · ${sizeLabel}` : ""}
                </p>
              ) : null}
            </div>
            {formatStrip}
          </div>
        </div>
        {contentBlock}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-package-viewer-title"
        className="relative flex max-h-[92vh] w-full max-w-5xl flex-col rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2
                id="board-package-viewer-title"
                className="text-xl font-semibold text-slate-900"
              >
                Board Package
              </h2>
              <p className="mt-1 font-mono text-sm text-slate-600">
                {meta?.fileName ?? "board-package.pdf"}
              </p>
              {meta ? (
                <p className="mt-2 text-sm text-slate-500">
                  {meta.pageCount != null ? `${meta.pageCount} pages` : "Page count unknown"}
                  {sizeLabel ? ` · ${sizeLabel}` : ""}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {formatStrip}
              {meta?.available ? (
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Download PDF
                </a>
              ) : null}
            </div>
          </div>
        </div>

        {contentBlock}

        <div className="flex justify-end border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
