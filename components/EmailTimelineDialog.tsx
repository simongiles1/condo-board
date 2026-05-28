"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  hasActiveFilters,
  parseEmailThreadFilters,
  searchParamsToFilterRecord,
} from "@/lib/email/thread-filter-params";
import type { TimelineBin, TimelineBinSize } from "@/lib/email/timeline-bins";

const EmailTimelineChart = dynamic(
  () =>
    import("@/components/EmailTimelineChart").then(
      (module) => module.EmailTimelineChart,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-80 items-center justify-center text-sm text-slate-500">
        Loading chart…
      </div>
    ),
  },
);

type TimelineResponse = {
  bins: TimelineBin[];
  totalCount: number;
  binSize: TimelineBinSize;
  filtersActive: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const BIN_OPTIONS: Array<{ id: TimelineBinSize; label: string }> = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

export function EmailTimelineDialog({ open, onClose }: Props) {
  const searchParams = useSearchParams();
  const activeFilters = parseEmailThreadFilters(
    searchParamsToFilterRecord(searchParams),
  );
  const filtersActive = hasActiveFilters(activeFilters);

  const [binSize, setBinSize] = useState<TimelineBinSize>("week");
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTimeline = useCallback(
    async (nextBinSize: TimelineBinSize) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("page");
        params.set("bin", nextBinSize);

        const response = await fetch(`/api/email/timeline?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Could not load timeline.");
        }

        const payload = (await response.json()) as TimelineResponse;
        setData(payload);
      } catch (loadError) {
        console.error("[EmailTimelineDialog]", loadError);
        setError("Could not load email timeline.");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [searchParams],
  );

  useEffect(() => {
    if (!open) return;
    void loadTimeline(binSize);
  }, [open, binSize, loadTimeline]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const bins = data?.bins ?? [];

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
        aria-labelledby="email-timeline-title"
        className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2
                id="email-timeline-title"
                className="text-xl font-semibold text-slate-900"
              >
                Email volume over time
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {filtersActive
                  ? "Counts for emails matching the active filters."
                  : "Counts for all ingested emails."}
                {data ? ` ${data.totalCount.toLocaleString()} total.` : null}
              </p>
            </div>

            <div
              className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-100 p-0.5"
              role="group"
              aria-label="Bin size"
            >
              {BIN_OPTIONS.map((option) => {
                const selected = binSize === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setBinSize(option.id)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                      selected
                        ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex h-80 items-center justify-center text-sm text-slate-500">
              Loading timeline…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {error}
            </div>
          ) : bins.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              No emails match the current filters.
            </div>
          ) : (
            <EmailTimelineChart bins={bins} />
          )}
        </div>

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

export function EmailTimelineIconButton({
  onClick,
  title = "View email volume over time",
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
        <path d="M3 3v18h18" />
        <path d="M7 16l4-6 4 3 5-8" />
      </svg>
    </button>
  );
}

export function EmailTimelineChartButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <EmailTimelineIconButton onClick={() => setOpen(true)} />
      <EmailTimelineDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
