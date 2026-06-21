"use client";

import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  shouldPurgeThreadExtractionArchive,
  THREAD_PROCESSED_DATA_CATEGORIES,
  THREAD_PROCESSED_DATA_LABELS,
  emptyThreadProcessedDataCounts,
  type ThreadProcessedDataCategory,
  type ThreadProcessedDataCounts,
} from "@/lib/analysis/thread-processed-data-categories";

type Props = {
  open: boolean;
  threadId: string;
  onClose: () => void;
  onDeleted: () => void;
};

type ThreadProcessedDataResponse = {
  counts?: ThreadProcessedDataCounts;
  categoriesWithData?: ThreadProcessedDataCategory[];
  error?: string;
};

export function DeleteThreadProcessedDataDialog({
  open,
  threadId,
  onClose,
  onDeleted,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<ThreadProcessedDataCounts>(
    emptyThreadProcessedDataCounts,
  );
  const [categoriesWithData, setCategoriesWithData] = useState<
    ThreadProcessedDataCategory[]
  >([]);
  const [selected, setSelected] = useState<Set<ThreadProcessedDataCategory>>(
    new Set(),
  );

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected(new Set());

    fetch(`/api/email/threads/${encodeURIComponent(threadId)}/processed-data`)
      .then(async (response) => {
        const data = (await response.json()) as ThreadProcessedDataResponse;
        if (!response.ok) {
          throw new Error(data.error ?? "Could not load thread data summary.");
        }
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        const nextCounts = data.counts ?? emptyThreadProcessedDataCounts();
        const nextCategoriesWithData =
          data.categoriesWithData ??
          THREAD_PROCESSED_DATA_CATEGORIES.filter(
            (category) => nextCounts[category] > 0,
          );

        setCounts(nextCounts);
        setCategoriesWithData(nextCategoriesWithData);
        setSelected(new Set());
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Could not load thread data summary.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, threadId]);

  const visibleCategories = useMemo(
    () =>
      categoriesWithData.length > 0
        ? categoriesWithData
        : THREAD_PROCESSED_DATA_CATEGORIES.filter(
            (category) => counts[category] > 0,
          ),
    [categoriesWithData, counts],
  );

  const selectedCategories = useMemo(
    () => visibleCategories.filter((category) => selected.has(category)),
    [visibleCategories, selected],
  );

  const willPurgeArchive = shouldPurgeThreadExtractionArchive(
    selectedCategories,
    categoriesWithData,
  );

  const totalSelected = selectedCategories.reduce(
    (sum, category) => sum + counts[category],
    0,
  );

  function toggleCategory(category: ThreadProcessedDataCategory) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  async function confirmDelete() {
    if (selectedCategories.length === 0) {
      setError("Select at least one extraction category to delete.");
      return;
    }

    setError(null);
    setBusy(true);

    try {
      const response = await fetch(
        `/api/email/threads/${encodeURIComponent(threadId)}/processed-data`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categories: selectedCategories }),
        },
      );

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not delete thread processed data.");
      }

      onDeleted();
      onClose();
    } catch (deleteError: unknown) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete thread processed data.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title="Delete thread extraction data?"
      description={
        <div className="space-y-4">
          <p>
            Choose which extracted data from this email thread to remove. Emails
            stay in the inbox; use <strong>Re-analyze thread</strong> afterward
            to run AI analysis again.
          </p>

          {loading ? (
            <p className="text-slate-500">Loading extracted data…</p>
          ) : visibleCategories.length === 0 ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              No extraction data is linked to this thread.
            </p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-800">
                Extraction categories to delete
              </legend>
              <ul className="space-y-2">
                {visibleCategories.map((category) => {
                  const count = counts[category];
                  const checked = selected.has(category);
                  const inputId = `delete-thread-data-${category}`;

                  return (
                    <li key={category}>
                      <label
                        htmlFor={inputId}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 ${
                          checked
                            ? "border-red-200 bg-red-50/60"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <input
                          id={inputId}
                          type="checkbox"
                          checked={checked}
                          disabled={busy}
                          onChange={() => toggleCategory(category)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-900">
                            {THREAD_PROCESSED_DATA_LABELS[category]}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {count === 0
                              ? "Archive only for this thread"
                              : `${count} extracted item${count === 1 ? "" : "s"} in this thread`}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          {!loading && visibleCategories.length > 0 && totalSelected === 0 ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Check the categories you want to remove. Unchecked categories are kept.
            </p>
          ) : null}

          {!loading && visibleCategories.length > 0 && !willPurgeArchive ? (
            <p className="text-xs text-slate-500">
              Selected categories are removed from this extraction panel and any
              related saved rows. Select all categories above to fully reset the
              thread so it can be re-analyzed from scratch.
            </p>
          ) : null}

          {!loading && willPurgeArchive ? (
            <p className="text-xs text-slate-500">
              All extraction categories for this thread are selected, so
              extraction records will be removed and processed flags reset so
              the thread can be re-analyzed.
            </p>
          ) : null}

          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              {error}
            </p>
          ) : null}
        </div>
      }
      confirmLabel="Delete selected data"
      busy={busy || loading}
      busyLabel={loading ? "Loading…" : "Deleting…"}
      onConfirm={confirmDelete}
      onCancel={() => {
        if (!busy) onClose();
      }}
    />
  );
}
