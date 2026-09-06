"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getPdfPageCount } from "@/lib/pdf/pdf-page-count";
import {
  cancelPdfCanvasRender,
  renderPdfPageToCanvas,
} from "@/lib/pdf/pdfjs-browser";

type Props = {
  url: string;
  className?: string;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

export function ZoomablePdfViewer({ url, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRootRef = useRef<HTMLDivElement>(null);

  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [fitWidth, setFitWidth] = useState(true);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [renderingPage, setRenderingPage] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pageWidthPt, setPageWidthPt] = useState<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPdfData(null);
    setPage(1);
    setPageCount(0);
    setLoadingPdf(true);
    setRenderingPage(false);
    setErrorMessage(null);
    setFitWidth(true);

    fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
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
        setErrorMessage(error instanceof Error ? error.message : "Could not load PDF.");
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  const resolveScale = useCallback(() => {
    if (!fitWidth || !pageWidthPt || viewportWidth <= 0) return scale;
    const padding = 32;
    const available = Math.max(200, viewportWidth - padding);
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, available / pageWidthPt));
  }, [fitWidth, pageWidthPt, scale, viewportWidth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pdfData || !canvas) return;

    let cancelled = false;
    setRenderingPage(true);
    setErrorMessage(null);
    const effectiveScale = resolveScale();
    cancelPdfCanvasRender(canvas);

    renderPdfPageToCanvas(pdfData, page, canvas, effectiveScale)
      .then((info) => {
        if (cancelled) return;
        if (info?.pageWidthPt) {
          setPageWidthPt(info.pageWidthPt);
        }
        setRenderingPage(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("[ZoomablePdfViewer] PDF render failed:", error);
        setRenderingPage(false);
        setErrorMessage("Could not render PDF page.");
      });

    return () => {
      cancelled = true;
      cancelPdfCanvasRender(canvas);
    };
  }, [pdfData, page, scale, fitWidth, pageWidthPt, viewportWidth]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const observer = new ResizeObserver(() => {
      setViewportWidth(element.clientWidth);
    });
    observer.observe(element);
    setViewportWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [pdfData]);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === viewerRootRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    if (!viewerRootRef.current) return;
    if (document.fullscreenElement === viewerRootRef.current) {
      await document.exitFullscreen();
      return;
    }
    await viewerRootRef.current.requestFullscreen();
  }

  function zoomIn() {
    setFitWidth(false);
    setScale((current) => Math.min(MAX_SCALE, Math.round((current + SCALE_STEP) * 100) / 100));
  }

  function zoomOut() {
    setFitWidth(false);
    setScale((current) => Math.max(MIN_SCALE, Math.round((current - SCALE_STEP) * 100) / 100));
  }

  function resetFitWidth() {
    setFitWidth(true);
  }

  const displayScale = Math.round(resolveScale() * 100);

  if (loadingPdf) {
    return (
      <div className={`flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-slate-600 ${className ?? ""}`}>
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
      <div className={`rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 ${className ?? ""}`}>
        {errorMessage}
      </div>
    );
  }

  return (
    <div
      ref={viewerRootRef}
      className={`flex min-h-0 flex-col bg-slate-100 ${isFullscreen ? "h-screen" : ""} ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || renderingPage}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-sm tabular-nums text-slate-700">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount || renderingPage}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={zoomOut}
            disabled={renderingPage}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={resetFitWidth}
            className={`rounded-md border px-2.5 py-1 text-sm font-medium tabular-nums ${
              fitWidth
                ? "border-teal-200 bg-teal-50 text-teal-800"
                : "border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
            title="Fit to width"
          >
            {displayScale}%
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={renderingPage}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className={`min-h-0 flex-1 overflow-auto p-4 ${isFullscreen ? "h-[calc(100vh-3rem)]" : ""}`}
      >
        <div ref={containerRef} className="mx-auto flex w-max min-w-full justify-center">
          {renderingPage ? (
            <div className="flex min-h-[24rem] items-center justify-center text-sm text-slate-600">
              Rendering page…
            </div>
          ) : null}
          <canvas
            ref={canvasRef}
            className={`rounded border border-slate-300 bg-white shadow-sm ${renderingPage ? "hidden" : ""}`}
          />
        </div>
      </div>
    </div>
  );
}
