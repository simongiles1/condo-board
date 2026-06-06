"use client";

import { useEffect, useRef, useState } from "react";

import { getPdfPageCount } from "@/lib/pdf/pdf-page-count";
import { renderPdfPageToCanvas } from "@/lib/pdf/pdfjs-browser";

type Props = {
  url: string;
};

export function PdfAttachmentPreview({ url }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [renderingPage, setRenderingPage] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPdfData(null);
    setPage(1);
    setPageCount(0);
    setLoadingPdf(true);
    setRenderingPage(false);
    setErrorMessage(null);

    fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error ?? "Could not load PDF.");
        }
        return response.arrayBuffer();
      })
      .then(async (buffer) => {
        if (cancelled) return;
        const count = await getPdfPageCount(buffer);
        if (cancelled) return;
        setPdfData(buffer);
        setPageCount(count);
        setLoadingPdf(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadingPdf(false);
        setErrorMessage(
          error instanceof Error ? error.message : "Could not load PDF.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!pdfData || !canvasRef.current) return;

    let cancelled = false;
    setRenderingPage(true);
    setErrorMessage(null);

    renderPdfPageToCanvas(pdfData, page, canvasRef.current)
      .then(() => {
        if (!cancelled) setRenderingPage(false);
      })
      .catch(() => {
        if (!cancelled) {
          setRenderingPage(false);
          setErrorMessage("Could not render PDF preview.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pdfData, page]);

  if (loadingPdf) {
    return (
      <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 text-sm text-slate-600">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600"
          aria-hidden
        />
        <p>Loading PDF…</p>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        {errorMessage}
      </div>
    );
  }

  return (
    <div className="flex min-h-[50dvh] flex-col items-center gap-3">
      {pageCount > 1 ? (
        <div className="flex items-center gap-3 text-sm text-slate-700">
          <button
            type="button"
            disabled={page <= 1 || renderingPage}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-md border border-slate-200 px-3 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-white"
          >
            Previous
          </button>
          <span className="tabular-nums">
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount || renderingPage}
            onClick={() =>
              setPage((current) => Math.min(pageCount, current + 1))
            }
            className="rounded-md border border-slate-200 px-3 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-white"
          >
            Next
          </button>
        </div>
      ) : null}

      <div className="relative flex w-full justify-center overflow-auto rounded-lg border border-slate-200 bg-white p-2">
        {renderingPage ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-sm text-slate-600">
            Rendering…
          </div>
        ) : null}
        <canvas ref={canvasRef} className="max-h-[70dvh] max-w-full" />
      </div>
    </div>
  );
}
