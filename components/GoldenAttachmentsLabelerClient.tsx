"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getPdfPageCount } from "@/lib/pdf/pdf-page-count";
import type {
  GoldenManifest,
  GoldenManifestDoc,
  GoldenManifestPage,
  PageRouteLabel,
} from "@/lib/dev/golden-attachments";
import type { PageProfile } from "@/lib/pdf/page-profile";

type Progress = {
  totalDocs: number;
  labeledDocs: number;
  totalLabeledPages: number;
};

const ROUTES: PageRouteLabel[] = ["text", "vision", "ambiguous"];

function emptyLabelMap(
  pageCount: number,
  existing: GoldenManifestPage[],
): Map<number, { expectedRoute: PageRouteLabel | ""; notes: string }> {
  const map = new Map<
    number,
    { expectedRoute: PageRouteLabel | ""; notes: string }
  >();
  for (let i = 1; i <= pageCount; i += 1) {
    map.set(i, { expectedRoute: "", notes: "" });
  }
  for (const page of existing) {
    map.set(page.pageNo, {
      expectedRoute: page.expectedRoute,
      notes: page.notes ?? "",
    });
  }
  return map;
}

function labelsToPages(
  map: Map<number, { expectedRoute: PageRouteLabel | ""; notes: string }>,
): GoldenManifestPage[] {
  const pages: GoldenManifestPage[] = [];
  for (const [pageNo, value] of map) {
    if (!value.expectedRoute) continue;
    pages.push({
      pageNo,
      expectedRoute: value.expectedRoute,
      ...(value.notes.trim() ? { notes: value.notes.trim() } : {}),
    });
  }
  return pages.sort((a, b) => a.pageNo - b.pageNo);
}

function textLayerHint(chars: number | null | undefined): string {
  if (chars == null) return "Profiler not loaded yet";
  if (chars <= 0) return "No text layer (scan / image / outlined) → usually vision";
  if (chars < 40) return "Very little text — likely vision";
  return "Text layer present — try selecting in the preview; if selectable → usually text";
}

export function GoldenAttachmentsLabelerClient() {
  const [manifest, setManifest] = useState<GoldenManifest | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [docIndex, setDocIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [loadingManifest, setLoadingManifest] = useState(true);
  const [loadingPdfMeta, setLoadingPdfMeta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profiling, setProfiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [labelMap, setLabelMap] = useState<
    Map<number, { expectedRoute: PageRouteLabel | ""; notes: string }>
  >(new Map());
  const [profiles, setProfiles] = useState<PageProfile[] | null>(null);
  const [dirty, setDirty] = useState(false);
  /** Bump to force iframe remount when jumping pages (Edge/Chrome #page=). */
  const [iframeTick, setIframeTick] = useState(0);

  const documents = manifest?.documents ?? [];
  const doc: GoldenManifestDoc | null = documents[docIndex] ?? null;

  const fileUrl = doc
    ? `/api/analysis/golden-attachments/${doc.contentHash}/file`
    : null;

  const loadManifest = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoadingManifest(true);
    setError(null);
    try {
      const res = await fetch("/api/analysis/golden-attachments", {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        manifest?: GoldenManifest;
        progress?: Progress;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not load manifest.");
      setManifest(data.manifest ?? null);
      setProgress(data.progress ?? null);
      return data.manifest ?? null;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load manifest.");
      return null;
    } finally {
      if (!opts?.quiet) setLoadingManifest(false);
    }
  }, []);

  useEffect(() => {
    void loadManifest();
  }, [loadManifest]);

  const pagesKey = useMemo(
    () => JSON.stringify(doc?.pages ?? []),
    [doc?.id, doc?.pages],
  );

  useEffect(() => {
    if (!doc) return;
    const fromPages = doc.pages ?? [];
    const count = Math.max(
      pageCount,
      doc.pageCount ?? 0,
      ...fromPages.map((p) => p.pageNo),
      0,
    );
    setLabelMap(emptyLabelMap(count > 0 ? count : 1, fromPages));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pageCount handled below
  }, [doc?.id, pagesKey]);

  useEffect(() => {
    if (pageCount <= 0) return;
    setLabelMap((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (let i = 1; i <= pageCount; i += 1) {
        if (!next.has(i)) {
          next.set(i, { expectedRoute: "", notes: "" });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [pageCount]);

  const loadProfile = useCallback(async (contentHash: string) => {
    setProfiling(true);
    try {
      const res = await fetch(
        `/api/analysis/golden-attachments/${contentHash}/profile`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as {
        profiles?: PageProfile[];
        summary?: { totalPages: number };
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Profile failed.");
      setProfiles(data.profiles ?? []);
      if (data.summary?.totalPages) {
        setPageCount(data.summary.totalPages);
      } else if (data.profiles?.length) {
        setPageCount(data.profiles.length);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile failed.");
    } finally {
      setProfiling(false);
    }
  }, []);

  // Resolve page count + auto-run pdfjs profiler (chars / hasTextLayer).
  useEffect(() => {
    if (!doc || !fileUrl) return;
    let cancelled = false;
    setPage(1);
    setPageCount(doc.pageCount && doc.pageCount > 0 ? doc.pageCount : 0);
    setProfiles(null);
    setLoadingPdfMeta(true);
    setError(null);
    setSaveMessage(null);
    setIframeTick((t) => t + 1);

    void (async () => {
      try {
        const res = await fetch(fileUrl, { cache: "no-store" });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error ?? "Could not load PDF.");
        }
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        const count = await getPdfPageCount(buffer);
        if (cancelled) return;
        setPageCount(count);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load PDF.");
        }
      } finally {
        if (!cancelled) setLoadingPdfMeta(false);
      }

      if (!cancelled) {
        await loadProfile(doc.contentHash);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc?.id, doc?.contentHash, fileUrl, loadProfile]);

  const reloadFromDisk = async () => {
    if (dirty) {
      const ok = window.confirm(
        "Reload from disk? Unsaved UI edits on this document will be lost.",
      );
      if (!ok) return;
    }
    const next = await loadManifest({ quiet: true });
    if (!next) return;
    const current = next.documents[docIndex] ?? next.documents[0];
    if (current) {
      const fromPages = current.pages ?? [];
      const count = Math.max(
        pageCount,
        current.pageCount ?? 0,
        ...fromPages.map((p) => p.pageNo),
        0,
      );
      setLabelMap(emptyLabelMap(count > 0 ? count : 1, fromPages));
    }
    setDirty(false);
    setSaveMessage(
      "Reloaded labels from fixtures/golden-attachments/manifest.json",
    );
  };

  const goToPage = (nextPage: number) => {
    const clamped = Math.min(Math.max(1, nextPage), pageCount || nextPage);
    setPage(clamped);
    setIframeTick((t) => t + 1);
  };

  const currentLabel = labelMap.get(page) ?? {
    expectedRoute: "" as const,
    notes: "",
  };
  const profilerGuess = profiles?.find((p) => p.pageNo === page) ?? null;

  const labeledPageCount = useMemo(() => {
    let n = 0;
    for (const value of labelMap.values()) {
      if (value.expectedRoute) n += 1;
    }
    return n;
  }, [labelMap]);

  const setRoute = (route: PageRouteLabel) => {
    setLabelMap((prev) => {
      const next = new Map(prev);
      const existing = next.get(page) ?? { expectedRoute: "", notes: "" };
      next.set(page, { ...existing, expectedRoute: route });
      return next;
    });
    setDirty(true);
    setSaveMessage(null);
  };

  const setNotes = (notes: string) => {
    setLabelMap((prev) => {
      const next = new Map(prev);
      const existing = next.get(page) ?? { expectedRoute: "", notes: "" };
      next.set(page, { ...existing, notes });
      return next;
    });
    setDirty(true);
    setSaveMessage(null);
  };

  const clearCurrentPage = () => {
    setLabelMap((prev) => {
      const next = new Map(prev);
      next.set(page, { expectedRoute: "", notes: "" });
      return next;
    });
    setDirty(true);
    setSaveMessage(null);
  };

  const save = useCallback(async () => {
    if (!doc) return;
    setSaving(true);
    setError(null);
    try {
      const pages = labelsToPages(labelMap);
      const res = await fetch("/api/analysis/golden-attachments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: doc.id, pages }),
      });
      const data = (await res.json()) as {
        manifest?: GoldenManifest;
        progress?: Progress;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Save failed.");
      if (data.manifest) setManifest(data.manifest);
      if (data.progress) setProgress(data.progress);
      setDirty(false);
      setSaveMessage(`Saved ${pages.length} page label(s) for ${doc.id}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [doc, labelMap]);

  const goDoc = (delta: number) => {
    if (documents.length === 0) return;
    if (dirty) {
      const ok = window.confirm(
        "You have unsaved labels on this document. Leave without saving?",
      );
      if (!ok) return;
    }
    setDocIndex((i) => {
      const next = i + delta;
      if (next < 0) return 0;
      if (next >= documents.length) return documents.length - 1;
      return next;
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPage(page - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToPage(page + 1);
      } else if (event.key === "[") {
        event.preventDefault();
        goDoc(-1);
      } else if (event.key === "]") {
        event.preventDefault();
        goDoc(1);
      } else if (event.key === "1") {
        event.preventDefault();
        setRoute("text");
      } else if (event.key === "2") {
        event.preventDefault();
        setRoute("vision");
      } else if (event.key === "3") {
        event.preventDefault();
        setRoute("ambiguous");
      } else if (event.key === "s" || event.key === "S") {
        if (event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount, page, save, dirty, documents.length]);

  if (loadingManifest) {
    return (
      <div className="p-6 text-sm text-slate-600">Loading golden set…</div>
    );
  }

  if (!manifest || !doc || !fileUrl) {
    return (
      <div className="p-6 text-sm text-red-700">
        {error ?? "No golden-set documents found."}
      </div>
    );
  }

  const iframeSrc = `${fileUrl}#page=${page}`;

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col gap-3 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-900">
            Golden attachment labeling
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Preview uses the browser PDF viewer — try selecting text. Chars
            come from pdfjs (ground truth for our pipeline), not from whether
            the canvas used to allow selection.
          </p>
          {progress ? (
            <p className="mt-1 text-xs text-slate-500">
              Docs with labels: {progress.labeledDocs}/{progress.totalDocs} ·
              Total page labels: {progress.totalLabeledPages} · This doc:{" "}
              {labeledPageCount}/{pageCount || "?"} pages
              {dirty ? " · unsaved" : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => goDoc(-1)}
            disabled={docIndex <= 0}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            [ Prev doc
          </button>
          <span className="text-sm tabular-nums text-slate-700">
            {docIndex + 1} / {documents.length}
          </span>
          <button
            type="button"
            onClick={() => goDoc(1)}
            disabled={docIndex >= documents.length - 1}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            Next doc ]
          </button>
          <button
            type="button"
            onClick={() => void reloadFromDisk()}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium"
          >
            Reload from disk
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save (S)"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {saveMessage ? (
        <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {saveMessage}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">
                {doc.id} · {doc.bucket ?? "—"} · {doc.filename}
              </p>
              <p className="truncate font-mono text-xs text-slate-500">
                {doc.contentHash}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-medium text-teal-800 hover:bg-slate-50"
              >
                Open in tab
              </a>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
                className="rounded-md border border-slate-200 px-3 py-1.5 font-medium disabled:opacity-40"
              >
                ← Page
              </button>
              <span className="tabular-nums text-slate-700">
                {page} / {pageCount || "?"}
              </span>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => goToPage(page + 1)}
                className="rounded-md border border-slate-200 px-3 py-1.5 font-medium disabled:opacity-40"
              >
                Page →
              </button>
            </div>
          </div>

          {/* Prominent text-layer signal for the page you're labeling */}
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              profilerGuess == null
                ? "border-slate-200 bg-slate-50 text-slate-600"
                : profilerGuess.chars <= 0
                  ? "border-amber-300 bg-amber-50 text-amber-950"
                  : "border-teal-300 bg-teal-50 text-teal-950"
            }`}
          >
            {profiling || loadingPdfMeta ? (
              <span>Measuring text layer…</span>
            ) : profilerGuess ? (
              <span>
                <strong className="font-semibold">
                  Labeler page {page}: chars={profilerGuess.chars}
                </strong>
                {" · "}
                hasTextLayer={String(profilerGuess.hasTextLayer)}
                {" · "}
                pdfjs route={profilerGuess.route}
                <span className="mt-0.5 block text-xs opacity-90">
                  {textLayerHint(profilerGuess.chars)}
                </span>
                <span className="mt-0.5 block text-xs opacity-80">
                  Use ← Page / Page → above (not the PDF viewer&apos;s own page
                  controls). Metrics follow the labeler page number, which can
                  desync if you flip pages inside the preview.
                </span>
              </span>
            ) : (
              <span>No profiler data — click Refresh in the side panel.</span>
            )}
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
            <iframe
              key={`${doc.contentHash}-${page}-${iframeTick}`}
              title={`PDF preview ${doc.filename ?? doc.id}`}
              src={iframeSrc}
              className="h-full min-h-[50dvh] w-full bg-white"
            />
          </div>
          <p className="text-xs text-slate-500">
            Select text inside the preview (Edge/Chrome PDF viewer). If you can
            select it here, the file has a real text layer for that region.
          </p>
        </section>

        <aside className="flex min-h-0 flex-col gap-3 overflow-auto rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Page {page} label
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Keys: 1=text · 2=vision · 3=ambiguous · ←/→ page · [/] docs · S
              save
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {ROUTES.map((route) => (
              <button
                key={route}
                type="button"
                onClick={() => setRoute(route)}
                className={`rounded-md border px-3 py-2 text-left text-sm font-medium ${
                  currentLabel.expectedRoute === route
                    ? route === "vision"
                      ? "border-amber-500 bg-amber-50 text-amber-950"
                      : route === "ambiguous"
                        ? "border-slate-500 bg-slate-100 text-slate-900"
                        : "border-teal-600 bg-teal-50 text-teal-950"
                    : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                {route}
              </button>
            ))}
            <button
              type="button"
              onClick={clearCurrentPage}
              className="text-left text-xs text-slate-500 underline"
            >
              Clear this page label
            </button>
          </div>

          <label className="block text-sm">
            <span className="font-medium text-slate-800">Notes</span>
            <textarea
              value={currentLabel.notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              placeholder="Optional — why this route"
            />
          </label>

          <div className="rounded-md border border-slate-100 bg-slate-50 p-2 text-xs text-slate-600">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-800">
                pdfjs page metrics
              </span>
              <button
                type="button"
                onClick={() => void loadProfile(doc.contentHash)}
                disabled={profiling}
                className="rounded border border-slate-200 bg-white px-2 py-0.5 font-medium disabled:opacity-50"
              >
                {profiling ? "…" : "Refresh"}
              </button>
            </div>
            {profilerGuess ? (
              <ul className="mt-2 space-y-0.5 font-mono">
                <li>chars={profilerGuess.chars}</li>
                <li>hasTextLayer={String(profilerGuess.hasTextLayer)}</li>
                <li>textArea={profilerGuess.textAreaRatio}</li>
                <li>imageArea={profilerGuess.imageAreaRatio}</li>
                <li>vectorOps={profilerGuess.vectorOps}</li>
                <li>suggestedRoute={profilerGuess.route}</li>
              </ul>
            ) : (
              <p className="mt-1">
                {profiling
                  ? "Running…"
                  : "Loads automatically when you open a document."}
              </p>
            )}
            {profiles && profiles.length > 0 ? (
              <ul className="mt-2 max-h-28 space-y-0.5 overflow-auto border-t border-slate-200 pt-2 font-mono">
                {profiles.map((p) => (
                  <li key={p.pageNo}>
                    <button
                      type="button"
                      onClick={() => goToPage(p.pageNo)}
                      className={`w-full rounded px-1 text-left hover:bg-white ${
                        p.pageNo === page ? "bg-white font-semibold" : ""
                      }`}
                    >
                      p{p.pageNo}: chars={p.chars} → {p.route}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Pages labeled
            </h3>
            <ul className="mt-1 max-h-40 space-y-1 overflow-auto text-xs">
              {Array.from(labelMap.entries())
                .filter(([, v]) => v.expectedRoute)
                .map(([pageNo, v]) => (
                  <li key={pageNo}>
                    <button
                      type="button"
                      onClick={() => goToPage(pageNo)}
                      className={`w-full rounded px-1.5 py-1 text-left hover:bg-slate-100 ${
                        pageNo === page ? "bg-slate-100 font-medium" : ""
                      }`}
                    >
                      p{pageNo}: {v.expectedRoute}
                      {v.notes ? ` — ${v.notes}` : ""}
                    </button>
                  </li>
                ))}
              {labeledPageCount === 0 ? (
                <li className="text-slate-400">None yet</li>
              ) : null}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
