"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import type { BoardPackageSelection } from "@/lib/pdf/board-package";
import {
  defaultInitialPageSelection,
} from "@/lib/pdf/extract-pages";
import { getPdfPageCount } from "@/lib/pdf/pdf-page-count";
import { renderPdfPageToCanvas } from "@/lib/pdf/pdfjs-browser";
import { formatPageList, parsePageRangeInput } from "@/lib/pdf/page-selection";

export type { BoardPackageSelection };

type Props = {
  disabled?: boolean;
  label?: string;
  onSelectionChange: (value: BoardPackageSelection | null) => void;
};

export function BoardPackagePageSelector({
  disabled = false,
  label = "Board package / management report *",
  onSelectionChange,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [previewPage, setPreviewPage] = useState(1);
  const [rangeInput, setRangeInput] = useState("1-20");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedSorted = [...selected].sort((a, b) => a - b);
  const selectedKey = selectedSorted.join(",");

  useEffect(() => {
    if (!sourceFile || selected.size === 0) {
      onSelectionChange(null);
      return;
    }
    onSelectionChange({
      sourceFile,
      pageCount,
      selectedPages: [...selected].sort((a, b) => a - b),
    });
  }, [sourceFile, pageCount, selected, selectedKey, onSelectionChange]);

  const loadFile = useCallback(async (file: File) => {
    setLoadError(null);
    setLoading(true);
    try {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        throw new Error("Board package must be a PDF.");
      }
      const buffer = await file.arrayBuffer();
      const count = await getPdfPageCount(buffer);

      const initial = defaultInitialPageSelection(count);
      setSourceFile(file);
      setPdfBytes(buffer);
      setPageCount(count);
      setSelected(new Set(initial));
      setPreviewPage(1);
      setRangeInput(`1-${Math.min(20, count)}`);
      setRangeError(null);
    } catch (e) {
      setSourceFile(null);
      setPdfBytes(null);
      setPageCount(0);
      setSelected(new Set());
      setLoadError(e instanceof Error ? e.message : "Could not read PDF.");
      onSelectionChange(null);
    } finally {
      setLoading(false);
    }
  }, [onSelectionChange]);

  const onPick = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) void loadFile(f);
    },
    [loadFile],
  );

  const onDropFiles = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f) void loadFile(f);
    },
    [loadFile],
  );

  const preventDefaults = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const clearFile = useCallback(() => {
    setSourceFile(null);
    setPdfBytes(null);
    setPageCount(0);
    setSelected(new Set());
    setLoadError(null);
    setRangeError(null);
    if (inputRef.current) inputRef.current.value = "";
    onSelectionChange(null);
  }, [onSelectionChange]);

  const togglePage = useCallback((page: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
    setPreviewPage(page);
  }, []);

  const setPages = useCallback((pages: number[]) => {
    setSelected(new Set(pages));
    if (pages.length > 0) {
      setPreviewPage(pages[0]);
    }
  }, []);

  const applyRange = useCallback(() => {
    const { pages, error } = parsePageRangeInput(rangeInput, pageCount);
    if (error) {
      setRangeError(error);
      return;
    }
    setRangeError(null);
    setPages(pages);
  }, [rangeInput, pageCount, setPages]);

  useEffect(() => {
    if (!pdfBytes || !canvasRef.current) return;

    let cancelled = false;

    async function render() {
      const canvas = canvasRef.current;
      if (!canvas || !pdfBytes) return;
      await renderPdfPageToCanvas(pdfBytes, previewPage, canvas);
    }

    void render().catch(() => {
      if (!cancelled) setLoadError("Could not render page preview.");
    });

    return () => {
      cancelled = true;
    };
  }, [pdfBytes, previewPage]);

  return (
    <div className="flex flex-col gap-2 md:col-span-3">
      <span className="text-sm font-medium text-slate-800">
        {label}
      </span>

      {!sourceFile ? (
        <label
          htmlFor={inputId}
          className="flex cursor-pointer flex-col rounded-lg border-2 border-dashed border-teal-200 bg-teal-50/40 px-4 py-6 text-center text-sm transition hover:border-teal-400 hover:bg-teal-50"
          onDragEnter={preventDefaults}
          onDragOver={preventDefaults}
          onDrop={onDropFiles}
        >
          <span className="font-medium text-teal-900">Drop PDF here</span>
          <span className="mt-1 text-slate-600">or click to browse</span>
          <span className="mt-2 text-xs text-slate-500">
            Large packages often include attachments—select only the management
            report pages (typically the first 15–20).
          </span>
          {loading ? (
            <span className="mt-3 text-xs text-slate-600">Reading PDF…</span>
          ) : null}
        </label>
      ) : (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-sm text-slate-800">{sourceFile.name}</p>
              <p className="mt-1 text-xs text-slate-600">
                {pageCount} pages total · including{" "}
                <strong>{selectedSorted.length}</strong> for Gemini (
                {formatPageList(selectedSorted)})
              </p>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={clearFile}
              className="text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50"
            >
              Choose different file
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-1 flex-wrap gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  setPages(defaultInitialPageSelection(pageCount))
                }
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
              >
                First 20 pages
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  setPages(Array.from({ length: pageCount }, (_, i) => i + 1))
                }
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
              >
                All pages
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setPages([])}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  const inverted: number[] = [];
                  for (let p = 1; p <= pageCount; p += 1) {
                    if (!selected.has(p)) inverted.push(p);
                  }
                  setPages(inverted);
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
              >
                Invert
              </button>
            </div>
            <div className="flex min-w-[220px] flex-1 items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-700">
                Page range
                <input
                  type="text"
                  value={rangeInput}
                  onChange={(e) => setRangeInput(e.target.value)}
                  placeholder="1-20, 25"
                  disabled={disabled}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-sm text-slate-900"
                />
              </label>
              <button
                type="button"
                disabled={disabled}
                onClick={applyRange}
                className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          </div>
          {rangeError ? (
            <p className="text-xs text-red-700">{rangeError}</p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="flex max-h-72 flex-col rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Pages to include
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                <ul className="grid grid-cols-4 gap-1 sm:grid-cols-6 md:grid-cols-8">
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map(
                    (page) => {
                      const on = selected.has(page);
                      return (
                        <li key={page}>
                          <label
                            className={`flex cursor-pointer items-center justify-center rounded-md border px-1 py-1.5 text-xs font-mono transition ${
                              on
                                ? "border-teal-500 bg-teal-50 text-teal-900"
                                : "border-slate-200 bg-slate-50 text-slate-500 line-through decoration-slate-400"
                            } ${previewPage === page ? "ring-2 ring-teal-300" : ""}`}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={on}
                              disabled={disabled}
                              onChange={() => togglePage(page)}
                            />
                            {page}
                          </label>
                        </li>
                      );
                    },
                  )}
                </ul>
              </div>
              <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                Checked = sent to Gemini. Unchecked pages are stripped out.
              </p>
            </div>

            <div className="flex flex-col rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Preview
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={disabled || previewPage <= 1}
                    onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <span className="font-mono text-xs text-slate-700">
                    {previewPage} / {pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={disabled || previewPage >= pageCount}
                    onClick={() =>
                      setPreviewPage((p) => Math.min(pageCount, p + 1))
                    }
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
              <div className="flex min-h-[200px] flex-1 items-start justify-center overflow-auto bg-slate-100 p-3">
                <canvas ref={canvasRef} className="max-w-full shadow-md" />
              </div>
            </div>
          </div>
        </div>
      )}

      {loadError ? (
        <p className="text-sm text-red-700">{loadError}</p>
      ) : null}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept=".pdf,application/pdf"
        className="sr-only"
        disabled={disabled}
        onChange={onPick}
      />
    </div>
  );
}
