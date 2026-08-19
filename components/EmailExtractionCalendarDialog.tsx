"use client";

import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  EXTRACTION_CONCEPTS,
  EXTRACTION_CONCEPT_META,
  conceptSliverPaint,
  type ExtractionCalendarDay,
  type ExtractionCalendarResponse,
  type ExtractionConceptId,
  type SliverPaint,
} from "@/lib/email/extraction-calendar";
import {
  hasActiveFilters,
  parseEmailThreadFilters,
  searchParamsToFilterRecord,
} from "@/lib/email/thread-filter-params";
import { closeActiveHoverPopover } from "@/lib/ui/hover-popover-group";

type Props = {
  open: boolean;
  onClose: () => void;
};

const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
const VIEWPORT_MARGIN = 8;

const SLIVER_PAINT_CLASS: Record<
  ExtractionConceptId,
  Record<SliverPaint, string>
> = {
  attachment: {
    empty: "bg-transparent",
    low: "bg-amber-300",
    mid: "bg-amber-500",
    full: "bg-amber-700",
    disabled: "bg-slate-50",
  },
  contact: {
    empty: "bg-transparent",
    low: "bg-violet-300",
    mid: "bg-violet-500",
    full: "bg-violet-700",
    disabled: "bg-slate-50",
  },
  organization: {
    empty: "bg-transparent",
    low: "bg-fuchsia-300",
    mid: "bg-fuchsia-500",
    full: "bg-fuchsia-700",
    disabled: "bg-slate-50",
  },
  project: {
    empty: "bg-transparent",
    low: "bg-orange-300",
    mid: "bg-orange-500",
    full: "bg-orange-700",
    disabled: "bg-slate-50",
  },
  event: {
    empty: "bg-transparent",
    low: "bg-sky-300",
    mid: "bg-sky-500",
    full: "bg-sky-700",
    disabled: "bg-slate-50",
  },
  equipment: {
    empty: "bg-transparent",
    low: "bg-transparent",
    mid: "bg-transparent",
    full: "bg-transparent",
    disabled: "bg-transparent",
  },
  todo: {
    empty: "bg-transparent",
    low: "bg-lime-300",
    mid: "bg-lime-500",
    full: "bg-lime-700",
    disabled: "bg-slate-50",
  },
};

const SWATCH_CLASS: Record<ExtractionConceptId, string> = {
  attachment: "bg-amber-600",
  contact: "bg-violet-600",
  organization: "bg-fuchsia-600",
  project: "bg-orange-600",
  event: "bg-sky-600",
  equipment: "bg-slate-200",
  todo: "bg-lime-600",
};

type HoverState = {
  day: ExtractionCalendarDay;
  rect: DOMRect;
};

function coverageLabel(
  concept: ExtractionConceptId,
  eligible: number,
  extracted: number,
  emailCount: number,
): string {
  if (!EXTRACTION_CONCEPT_META[concept].implemented) return "Not yet";
  if (eligible === 0) {
    if (concept === "attachment" && emailCount > 0) return "No files";
    return "—";
  }
  const missing = eligible - extracted;
  if (missing <= 0) return `${extracted.toLocaleString()} / ${eligible.toLocaleString()}`;
  return `${extracted.toLocaleString()} / ${eligible.toLocaleString()} · ${missing.toLocaleString()} missing`;
}

function formatDayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function computeDayPopoverPosition(
  triggerRect: DOMRect,
  popoverWidth: number,
  popoverHeight: number,
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left = triggerRect.left + triggerRect.width / 2 - popoverWidth / 2;
  left = Math.min(
    Math.max(left, VIEWPORT_MARGIN),
    viewportWidth - popoverWidth - VIEWPORT_MARGIN,
  );

  const spaceAbove = triggerRect.top - VIEWPORT_MARGIN;
  const showAbove =
    spaceAbove >= popoverHeight ||
    spaceAbove >= viewportHeight - triggerRect.bottom - VIEWPORT_MARGIN;

  let top = showAbove
    ? triggerRect.top - popoverHeight - VIEWPORT_MARGIN
    : triggerRect.bottom + VIEWPORT_MARGIN;
  top = Math.min(
    Math.max(top, VIEWPORT_MARGIN),
    viewportHeight - popoverHeight - VIEWPORT_MARGIN,
  );

  return {
    position: "fixed",
    top,
    left,
    zIndex: 80,
  };
}

export function EmailExtractionCalendarDialog({ open, onClose }: Props) {
  const searchParams = useSearchParams();
  const activeFilters = parseEmailThreadFilters(
    searchParamsToFilterRecord(searchParams),
  );
  const filtersActive = hasActiveFilters(activeFilters);

  const [year, setYear] = useState<number | null>(null);
  const [data, setData] = useState<ExtractionCalendarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
  });
  const popoverRef = useRef<HTMLDivElement>(null);

  const loadCalendar = useCallback(
    async (nextYear: number | null) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("page");
        if (nextYear) params.set("year", String(nextYear));

        const response = await fetch(
          `/api/email/extraction-calendar?${params.toString()}`,
        );
        if (!response.ok) {
          throw new Error("Could not load extraction calendar.");
        }

        const payload = (await response.json()) as ExtractionCalendarResponse;
        setData(payload);
      } catch (loadError) {
        console.error("[EmailExtractionCalendarDialog]", loadError);
        setError("Could not load extraction calendar.");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [searchParams],
  );

  useEffect(() => {
    if (!open) return;
    void loadCalendar(year);
  }, [open, year, loadCalendar]);

  useEffect(() => {
    if (!open) {
      setHover(null);
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useLayoutEffect(() => {
    if (!hover || !popoverRef.current) return;
    setPopoverStyle({
      ...computeDayPopoverPosition(
        hover.rect,
        popoverRef.current.offsetWidth,
        popoverRef.current.offsetHeight,
      ),
      visibility: "visible",
    });
  }, [hover]);

  if (!open) return null;

  const years = data?.years ?? [];
  const selectedYear = data?.year ?? year;
  const hoverDay = hover && hover.day.inYear ? hover.day : null;

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
        aria-labelledby="extraction-calendar-title"
        className="relative flex max-h-[90vh] w-max min-w-[32rem] max-w-[calc(100vw-2rem)] flex-col rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        {/* contain-inline-size: header/footer wrap to the grid instead of defining dialog width. */}
        <div className="w-full min-w-0 contain-inline-size border-b border-slate-100 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2
                id="extraction-calendar-title"
                className="text-xl font-semibold text-slate-900"
              >
                Extraction calendar
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {filtersActive
                  ? "Emails matching the active filters, plotted by received day."
                  : "All ingested emails, plotted by received day."}
                {data
                  ? ` ${data.totalEmails.toLocaleString()} in ${data.year}.`
                  : null}
              </p>
            </div>
            <div
              className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-100 p-0.5"
              role="group"
              aria-label="Gap visibility"
            >
              <button
                type="button"
                aria-pressed={!showMissing}
                onClick={() => setShowMissing(false)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  !showMissing
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Extracted
              </button>
              <button
                type="button"
                aria-pressed={showMissing}
                onClick={() => setShowMissing(true)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  showMissing
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Show missing
              </button>
            </div>
          </div>
          {data ? (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {EXTRACTION_CONCEPTS.map((concept) => {
                  const stat = data.totals[concept];
                  const meta = EXTRACTION_CONCEPT_META[concept];
                  const missing = stat.eligible - stat.extracted;
                  const numerator = showMissing ? missing : stat.extracted;
                  const gapVisible = showMissing && meta.implemented && missing > 0;
                  return (
                    <span
                      key={concept}
                      title={
                        meta.implemented
                          ? showMissing
                            ? `${missing.toLocaleString()} missing of ${stat.eligible.toLocaleString()} ${meta.eligibleHint}`
                            : `${stat.extracted.toLocaleString()} extracted of ${stat.eligible.toLocaleString()} ${meta.eligibleHint}`
                          : `${meta.label} extraction is not built yet`
                      }
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-50 px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200"
                    >
                      <span
                        className={`h-2 w-2 rounded-sm ${SWATCH_CLASS[concept]}`}
                      />
                      {meta.label}
                      <span
                        className={`tabular-nums ${
                          gapVisible ? "text-rose-600" : "text-slate-500"
                        }`}
                      >
                        {meta.implemented
                          ? `${numerator.toLocaleString()} / ${stat.eligible.toLocaleString()}`
                          : "Not yet"}
                      </span>
                    </span>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {showMissing
                  ? "Counts are missing / eligible emails."
                  : "Counts are extracted / eligible emails."}{" "}
                Attachments only include emails that have a file.
              </p>
            </>
          ) : null}
        </div>

        <div className="min-h-0 w-max max-w-full flex-1 overflow-auto px-6 py-5">
          {loading ? (
            <div className="flex h-64 items-center justify-center text-sm text-slate-500">
              Loading calendar…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {error}
            </div>
          ) : data ? (
            <div className="flex w-max items-start gap-3">
              <div
                className="pt-5"
                onMouseLeave={() => {
                  setHover(null);
                  setPopoverStyle({ position: "fixed", visibility: "hidden" });
                }}
              >
                <div className="inline-flex gap-2">
                  <div className="flex flex-col gap-[3px] pt-5">
                    {WEEKDAY_LABELS.map((label, index) => (
                      <div
                        key={index}
                        className="flex h-[27px] items-center text-[10px] leading-none text-slate-400"
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="mb-1 flex gap-[3px]">
                      {data.weeks.map((week, weekIndex) => (
                        <div
                          key={weekIndex}
                          className="relative h-4 w-[12px] text-[10px] leading-none text-slate-500"
                        >
                          {week.monthLabel ? (
                            <span className="absolute left-0 top-0 whitespace-nowrap">
                              {week.monthLabel}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-[3px]">
                      {data.weeks.map((week, weekIndex) => (
                        <div key={weekIndex} className="flex flex-col gap-[3px]">
                          {week.days.map((day) => {
                            const isToday = day.date === data.today;
                            return (
                              <button
                                key={day.date}
                                type="button"
                                aria-label={formatDayLabel(day.date)}
                                onMouseEnter={(event) => {
                                  setHover({
                                    day,
                                    rect: event.currentTarget.getBoundingClientRect(),
                                  });
                                }}
                                onFocus={(event) => {
                                  setHover({
                                    day,
                                    rect: event.currentTarget.getBoundingClientRect(),
                                  });
                                }}
                                className={`flex h-[27px] w-[12px] flex-col justify-between rounded-[2px] bg-slate-100 p-px ${
                                  day.inYear ? "opacity-100" : "opacity-30"
                                } ${
                                  isToday
                                    ? "ring-1 ring-slate-500"
                                    : "ring-1 ring-transparent"
                                }`}
                              >
                                {EXTRACTION_CONCEPTS.map((concept) => (
                                  <span
                                    key={concept}
                                    className={`h-[3px] w-full rounded-[1px] ${
                                      SLIVER_PAINT_CLASS[concept][
                                        conceptSliverPaint(
                                          concept,
                                          day.concepts[concept],
                                          showMissing,
                                        )
                                      ]
                                    }`}
                                  />
                                ))}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {years.length > 1 ? (
                <div
                  className="flex shrink-0 flex-col gap-1 pt-5"
                  role="group"
                  aria-label="Year"
                >
                  {years.map((option) => {
                    const selected = option === selectedYear;
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setYear(option)}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                          selected
                            ? "bg-emerald-700 text-white"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex w-full min-w-0 contain-inline-size flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            {showMissing ? (
              <>
                <span>Missing</span>
                <span className="flex items-center gap-0.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-slate-100 ring-1 ring-slate-200" />
                  <span className="h-2.5 w-2.5 rounded-sm bg-amber-300" />
                  <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
                  <span className="h-2.5 w-2.5 rounded-sm bg-amber-700" />
                </span>
                <span>Lighter = some missing, darker = all</span>
                <span>Blank = extracted or nothing to extract that day</span>
              </>
            ) : (
              <>
                <span>Extracted</span>
                <span className="flex items-center gap-0.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-slate-100 ring-1 ring-slate-200" />
                  <span className="h-2.5 w-2.5 rounded-sm bg-violet-300" />
                  <span className="h-2.5 w-2.5 rounded-sm bg-violet-500" />
                  <span className="h-2.5 w-2.5 rounded-sm bg-violet-700" />
                </span>
                <span>Turn on Show missing to see only unfinished work</span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300"
          >
            Close
          </button>
        </div>
      </div>
      {hoverDay
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="pointer-events-none w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg"
            >
              <p className="font-medium text-slate-900">
                {formatDayLabel(hoverDay.date)}
              </p>
              <p className="mt-0.5 text-slate-500">
                {hoverDay.emailCount === 0
                  ? "No emails received"
                  : `${hoverDay.emailCount.toLocaleString()} email${
                      hoverDay.emailCount === 1 ? "" : "s"
                    }`}
              </p>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                {EXTRACTION_CONCEPTS.map((concept) => (
                  <div key={concept} className="contents">
                    <dt className="flex items-center gap-1.5">
                      <span
                        className={`h-2 w-2 rounded-sm ${SWATCH_CLASS[concept]}`}
                      />
                      {EXTRACTION_CONCEPT_META[concept].label}
                    </dt>
                    <dd className="tabular-nums text-slate-500">
                      {coverageLabel(
                        concept,
                        hoverDay.concepts[concept].eligible,
                        hoverDay.concepts[concept].extracted,
                        hoverDay.emailCount,
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function EmailExtractionCalendarIconButton({
  onClick,
  title = "View extraction calendar",
}: {
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        closeActiveHoverPopover();
        onClick();
      }}
      title={title}
      aria-label={title}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="4" height="4" rx="0.8" />
        <rect x="10" y="3" width="4" height="4" rx="0.8" />
        <rect x="17" y="3" width="4" height="4" rx="0.8" />
        <rect x="3" y="10" width="4" height="4" rx="0.8" />
        <rect x="10" y="10" width="4" height="4" rx="0.8" />
        <rect x="17" y="10" width="4" height="4" rx="0.8" />
        <rect x="3" y="17" width="4" height="4" rx="0.8" />
        <rect x="10" y="17" width="4" height="4" rx="0.8" />
        <rect x="17" y="17" width="4" height="4" rx="0.8" />
      </svg>
    </button>
  );
}

export function EmailExtractionCalendarButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <EmailExtractionCalendarIconButton onClick={() => setOpen(true)} />
      <EmailExtractionCalendarDialog
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
