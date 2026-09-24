"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  chartSeriesForTimelineSenderIds,
  DEFAULT_EMAIL_TIMELINE_SENDER_IDS,
  EMAIL_TIMELINE_SENDER_OPTIONS,
  emailsForTimelineSenderIds,
  type EmailTimelineChartLayout,
  type EmailTimelineChartSeries,
} from "@/lib/email/timeline-senders";
import {
  hasActiveFilters,
  parseEmailThreadFilters,
  searchParamsToFilterRecord,
} from "@/lib/email/thread-filter-params";
import {
  timelineRollingAverageMonths,
  type TimelineBin,
  type TimelineBinSize,
} from "@/lib/email/timeline-bins";

const EmailTimelineChart = dynamic(
  () =>
    import("@/components/EmailTimelineChart").then(
      (module) => module.EmailTimelineChart,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[18.5rem] items-center justify-center text-sm text-slate-500">
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
  series?: EmailTimelineChartSeries[];
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const BIN_OPTIONS: Array<{ id: TimelineBinSize; label: string }> = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "month_avg_2", label: "2-mo avg" },
  { id: "month_avg_3", label: "3-mo avg" },
];

const CHART_LAYOUT_OPTIONS: Array<{
  id: EmailTimelineChartLayout;
  label: string;
}> = [
  { id: "stacked", label: "Stacked" },
  { id: "grouped", label: "Side by side" },
];

export function EmailTimelineDialog({ open, onClose }: Props) {
  const searchParams = useSearchParams();
  const activeFilters = parseEmailThreadFilters(
    searchParamsToFilterRecord(searchParams),
  );
  const filtersActive = hasActiveFilters(activeFilters);

  const [binSize, setBinSize] = useState<TimelineBinSize>("week");
  const [selectedSenderIds, setSelectedSenderIds] = useState<string[]>(
    () => [...DEFAULT_EMAIL_TIMELINE_SENDER_IDS],
  );
  const [chartLayout, setChartLayout] =
    useState<EmailTimelineChartLayout>("stacked");
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTimeline = useCallback(
    async (nextBinSize: TimelineBinSize, senderIds: string[]) => {
      const senderEmails = emailsForTimelineSenderIds(senderIds);
      if (senderEmails.length === 0) {
        setData(null);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("page");
        params.delete("from");
        params.delete("startedChain");
        for (const email of senderEmails) {
          params.append("from", email);
        }
        params.set("field", "both");
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
    void loadTimeline(binSize, selectedSenderIds);
  }, [open, binSize, selectedSenderIds, loadTimeline]);

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
  const senderEmails = emailsForTimelineSenderIds(selectedSenderIds);
  const noSendersSelected = senderEmails.length === 0;
  const multiPersonChart = selectedSenderIds.length > 1;
  const chartSeries =
    data?.series ?? chartSeriesForTimelineSenderIds(selectedSenderIds);
  const rollingMonths = timelineRollingAverageMonths(binSize);

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
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close"
        >
          <CloseIcon />
        </button>
        <div className="border-b border-slate-100 px-6 py-5 pr-14">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2
                id="email-timeline-title"
                className="text-xl font-semibold text-slate-900"
              >
                Email volume over time
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {noSendersSelected
                  ? "Select at least one person to chart email volume."
                  : rollingMonths
                    ? `${rollingMonths}-month rolling average of monthly email counts (From or Cc).`
                    : filtersActive
                      ? "Counts for the selected people plus other active inbox filters."
                      : "Counts for the selected people (From or Cc)."}
                {data && !rollingMonths
                  ? ` ${data.totalCount.toLocaleString()} total.`
                  : null}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <EmailTimelineSenderMultiSelect
                value={selectedSenderIds}
                onChange={setSelectedSenderIds}
              />
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
              {multiPersonChart ? (
                <div
                  className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-100 p-0.5"
                  role="group"
                  aria-label="Chart layout"
                >
                  {CHART_LAYOUT_OPTIONS.map((option) => {
                    const selected = chartLayout === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setChartLayout(option.id)}
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
              ) : null}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pb-6 pt-4">
          {noSendersSelected ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Choose at least one person above to load the chart.
            </div>
          ) : loading ? (
            <div className="flex h-[18.5rem] items-center justify-center text-sm text-slate-500">
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
            <EmailTimelineChart
              bins={bins}
              series={multiPersonChart ? chartSeries : undefined}
              layout={chartLayout}
              valuesAreAverages={rollingMonths != null}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function EmailTimelineSenderMultiSelect({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = new Set(value);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const summary =
    value.length === 0
      ? "Select people"
      : value.length === EMAIL_TIMELINE_SENDER_OPTIONS.length
        ? "All people"
        : EMAIL_TIMELINE_SENDER_OPTIONS
            .filter((option) => selected.has(option.id))
            .map((option) => option.label.split(" ")[0])
            .join(", ");

  function toggleSender(id: string) {
    if (selected.has(id)) {
      onChange(value.filter((item) => item !== id));
      return;
    }
    onChange([...value, id]);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-w-[10rem] items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-300"
      >
        <span className="truncate">{summary}</span>
        <ChevronDownIcon className={open ? "rotate-180" : ""} />
      </button>

      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="People to include in chart"
          aria-multiselectable="true"
          className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {EMAIL_TIMELINE_SENDER_OPTIONS.map((option) => {
            const checked = selected.has(option.id);
            return (
              <li key={option.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggleSender(option.id)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      checked
                        ? "border-teal-700 bg-teal-700 text-white"
                        : "border-slate-300 bg-white"
                    }`}
                    aria-hidden
                  >
                    {checked ? <CheckIcon /> : null}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-slate-900">
                      {option.label}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {option.email}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={`h-4 w-4 shrink-0 text-slate-500 transition ${className ?? ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden
      className="h-3 w-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={3}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
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
