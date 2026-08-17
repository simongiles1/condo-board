"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  eventExtractItemCount,
  eventExtractItemKey,
  type EventExtractListItem,
  type EventExtractSummary,
} from "@/lib/email-analysis/event-highlight-run-display";
import {
  EVENT_HIGHLIGHT_BADGE_CLASS,
  EVENT_HIGHLIGHT_LABELS,
  EVENT_HIGHLIGHT_TYPES,
  type EventHighlightType,
} from "@/lib/email-analysis/event-highlight-shared";
import { formatCostUsd } from "@/lib/gemini/usage";
import {
  claimHoverPopover,
  closeActiveHoverPopover,
  releaseHoverPopover,
} from "@/lib/ui/hover-popover-group";

const VIEWPORT_MARGIN = 8;
const POPOVER_HIDE_DELAY_MS = 500;

function computePopoverPosition(
  triggerRect: DOMRect,
  popoverWidth: number,
  popoverHeight: number,
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const spaceAbove = triggerRect.top - VIEWPORT_MARGIN;
  const spaceBelow = viewportHeight - triggerRect.bottom - VIEWPORT_MARGIN;
  const showAbove = spaceAbove >= popoverHeight || spaceAbove >= spaceBelow;

  let top: number;
  let transform: string;

  if (showAbove) {
    top = triggerRect.top - VIEWPORT_MARGIN;
    transform = "translate(-100%, -100%)";
    if (top - popoverHeight < VIEWPORT_MARGIN) {
      top = VIEWPORT_MARGIN + popoverHeight;
    }
  } else {
    top = triggerRect.bottom + VIEWPORT_MARGIN;
    transform = "translate(-100%, 0)";
    if (top + popoverHeight > viewportHeight - VIEWPORT_MARGIN) {
      top = viewportHeight - VIEWPORT_MARGIN - popoverHeight;
    }
  }

  const left = Math.min(
    Math.max(triggerRect.right, VIEWPORT_MARGIN + popoverWidth),
    viewportWidth - VIEWPORT_MARGIN,
  );

  return {
    position: "fixed",
    top,
    left,
    transform,
    zIndex: 50,
  };
}

function TypeBadge({ type }: { type: EventHighlightType }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${EVENT_HIGHLIGHT_BADGE_CLASS[type]}`}
    >
      {EVENT_HIGHLIGHT_LABELS[type]}
    </span>
  );
}

type Props = {
  summary: EventExtractSummary;
  onOpenHarvest?: (args?: {
    focusEmailId?: string | null;
    focusQuote?: string | null;
  }) => void;
};

export function EventExtractCostBadge({ summary, onOpenHarvest }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverInstanceId = useRef(Symbol("event-extract-cost-badge")).current;
  const triggerHoveredRef = useRef(false);
  const popoverHoveredRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 50,
  });

  function cancelHide() {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }

  function forceClose() {
    cancelHide();
    triggerHoveredRef.current = false;
    popoverHoveredRef.current = false;
    setOpen(false);
    releaseHoverPopover(popoverInstanceId);
  }

  function scheduleHide() {
    cancelHide();
    hideTimeoutRef.current = setTimeout(() => {
      if (!triggerHoveredRef.current && !popoverHoveredRef.current) {
        forceClose();
      }
    }, POPOVER_HIDE_DELAY_MS);
  }

  function showPopover() {
    claimHoverPopover(popoverInstanceId, forceClose);
    cancelHide();
    setOpen(true);
  }

  function openPanel(eventItem?: EventExtractListItem | null) {
    closeActiveHoverPopover();
    forceClose();
    onOpenHarvest?.({
      focusEmailId: eventItem?.emailId ?? null,
      focusQuote: eventItem?.sourceQuote ?? null,
    });
  }

  useEffect(() => {
    return () => {
      cancelHide();
      releaseHoverPopover(popoverInstanceId);
    };
  }, [popoverInstanceId]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !popoverRef.current) return;

    const triggerRect = rootRef.current.getBoundingClientRect();
    const popoverRect = popoverRef.current.getBoundingClientRect();
    setPopoverStyle(
      computePopoverPosition(
        triggerRect,
        popoverRect.width,
        popoverRect.height,
      ),
    );
  }, [open, summary]);

  const costLabel = formatCostUsd(summary.totalCostUsd);
  const events = summary.events ?? [];
  const itemCount = eventExtractItemCount(summary);
  const typeCounts = EVENT_HIGHLIGHT_TYPES.map((type) => ({
    type,
    count: events.filter((event) => event.type === type).length,
  })).filter((entry) => entry.count > 0);

  return (
    <>
      <div
        ref={rootRef}
        className="inline-flex max-w-full"
        onMouseEnter={() => {
          triggerHoveredRef.current = true;
          showPopover();
        }}
        onMouseLeave={() => {
          triggerHoveredRef.current = false;
          scheduleHide();
        }}
        onFocus={() => showPopover()}
        onBlur={() => scheduleHide()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openPanel(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            closeActiveHoverPopover();
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            openPanel(null);
          }
        }}
      >
        <span
          tabIndex={0}
          role="button"
          className="inline-flex max-w-full cursor-pointer items-center gap-1 truncate rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium tabular-nums text-sky-900 ring-1 ring-sky-200 hover:ring-2 hover:ring-sky-300/80"
        >
          Events
          <span>{itemCount}</span>
          <span className="text-sky-800">{costLabel}</span>
        </span>
      </div>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-max min-w-[18rem] max-w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onMouseEnter={() => {
                popoverHoveredRef.current = true;
                cancelHide();
              }}
              onMouseLeave={() => {
                popoverHoveredRef.current = false;
                scheduleHide();
              }}
            >
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Event harvest
                </p>
                <p className="text-xs font-medium tabular-nums text-slate-700">
                  {costLabel}
                </p>
              </div>
              {typeCounts.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-1">
                  {typeCounts.map(({ type, count }) => (
                    <span
                      key={type}
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${EVENT_HIGHLIGHT_BADGE_CLASS[type]}`}
                    >
                      {EVENT_HIGHLIGHT_LABELS[type]}
                      <span className="tabular-nums">{count}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {events.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No calendar events extracted.
                </p>
              ) : (
                <ul className="max-h-[min(24rem,70vh)] space-y-2 overflow-y-auto">
                  {events.map((event, index) => {
                    const key = eventExtractItemKey(event, index);
                    return (
                    <li
                      key={key}
                      className="flex items-start gap-2"
                    >
                      <TypeBadge type={event.type} />
                      <button
                        type="button"
                        className="min-w-0 flex-1 rounded text-left hover:bg-slate-50"
                        onClick={(clickEvent) => {
                          clickEvent.preventDefault();
                          clickEvent.stopPropagation();
                          openPanel(event);
                        }}
                      >
                        <span className="block text-sm font-medium text-slate-900">
                          {event.title}
                        </span>
                        {event.when ? (
                          <span className="mt-0.5 block text-xs tabular-nums text-slate-500">
                            {event.when}
                          </span>
                        ) : null}
                        {event.detail ? (
                          <span className="mt-0.5 block text-xs text-slate-600">
                            {event.detail}
                          </span>
                        ) : null}
                      </button>
                    </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-slate-500">
                Click the badge or an event to inspect highlights in the thread
              </p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
