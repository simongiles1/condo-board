"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  formatExtractionFieldLabel,
  type InboxExtractionSummary,
} from "@/lib/email/extraction-display";
import { formatDateTime } from "@/lib/format/datetime";

const VIEWPORT_MARGIN = 8;
const POPOVER_HIDE_DELAY_MS = 500;

function SparklesIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.94 15.5 11 19l1.06-3.5L15.5 14l-3.44-1.06L11 9.5 9.94 13 6.5 14z" />
      <path d="M5 3v4M3 5h4M19 17v4M17 19h4" />
    </svg>
  );
}

function urgencyClassName(urgency?: string): string {
  switch (urgency) {
    case "urgent":
      return "bg-red-50 text-red-800 ring-red-200";
    case "high":
      return "bg-amber-50 text-amber-900 ring-amber-200";
    case "low":
      return "bg-slate-50 text-slate-600 ring-slate-200";
    default:
      return "bg-violet-50 text-violet-800 ring-violet-200";
  }
}

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

function PopoverPanel({
  panelRef,
  title,
  children,
  style,
  onMouseEnter,
  onMouseLeave,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  title: string;
  children: ReactNode;
  style: CSSProperties;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <div
      ref={panelRef}
      role="tooltip"
      style={style}
      className="w-max min-w-[16rem] max-w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      {children}
    </div>
  );
}

function ExtractionSummaryContent({ summary }: { summary: InboxExtractionSummary }) {
  const countEntries = Object.entries(summary.counts).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div className="space-y-3 text-sm text-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        {summary.documentType ? (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
            {summary.documentType.replace(/_/g, " ")}
          </span>
        ) : null}
        {summary.urgency ? (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${urgencyClassName(summary.urgency)}`}
          >
            {summary.urgency}
          </span>
        ) : null}
      </div>

      {summary.summary ? (
        <p className="text-sm leading-relaxed text-slate-700">{summary.summary}</p>
      ) : null}

      {summary.tags && summary.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {[...new Set(summary.tags)].map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {countEntries.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {countEntries.map(([key, count]) => (
            <span
              key={key}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
            >
              {formatExtractionFieldLabel(key)}: {count}
            </span>
          ))}
        </div>
      ) : null}

      {summary.highlights.length > 0 ? (
        <ul className="max-h-40 space-y-1 overflow-y-auto pr-1 text-xs text-slate-600">
          {summary.highlights.map((highlight) => (
            <li key={highlight} className="leading-snug">
              {highlight}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ThreadExtractionContent({ summary }: { summary: InboxExtractionSummary }) {
  if (summary.emails.length <= 1) {
    return <ExtractionSummaryContent summary={summary} />;
  }

  return (
    <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
      {summary.emails.map((email) => (
        <div key={email.emailId} className="space-y-2 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
          <div className="text-xs text-slate-600">
            <p className="font-medium text-slate-800">{email.subject}</p>
            <p>
              <span>{email.fromAddress}</span>
              <span className="mx-1 text-slate-400">·</span>
              <time dateTime={email.receivedAt}>{formatDateTime(email.receivedAt)}</time>
            </p>
          </div>
          <ExtractionSummaryContent
            summary={{
              totalFacts: Object.values(email.counts).reduce(
                (sum, count) => sum + count,
                0,
              ),
              documentType: email.documentType,
              summary: email.summary,
              urgency: email.urgency,
              tags: email.tags,
              counts: email.counts,
              highlights: email.highlights,
              emails: [email],
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function EmailExtractionBadge({
  summary,
  multiEmail = false,
}: {
  summary?: InboxExtractionSummary | null;
  multiEmail?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerHoveredRef = useRef(false);
  const popoverHoveredRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 50,
  });

  const hasSummary = Boolean(summary && summary.totalFacts > 0);
  const title =
    summary && multiEmail
      ? `Extracted metadata across ${summary.emails.length} emails`
      : "Extracted metadata";

  function cancelHide() {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }

  function scheduleHide() {
    cancelHide();
    hideTimeoutRef.current = setTimeout(() => {
      if (!triggerHoveredRef.current && !popoverHoveredRef.current) {
        setOpen(false);
      }
    }, POPOVER_HIDE_DELAY_MS);
  }

  function showPopover() {
    cancelHide();
    setOpen(true);
  }

  useEffect(() => {
    return () => cancelHide();
  }, []);

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !popoverRef.current) return;

    function updatePosition() {
      const triggerRect = rootRef.current?.getBoundingClientRect();
      const popover = popoverRef.current;
      if (!triggerRect || !popover) return;

      setPopoverStyle({
        ...computePopoverPosition(
          triggerRect,
          popover.offsetWidth,
          popover.offsetHeight,
        ),
        visibility: "visible",
      });
    }

    updatePosition();
  }, [open, summary]);

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const triggerRect = rootRef.current?.getBoundingClientRect();
      const popover = popoverRef.current;
      if (!triggerRect || !popover) return;

      setPopoverStyle({
        ...computePopoverPosition(
          triggerRect,
          popover.offsetWidth,
          popover.offsetHeight,
        ),
        visibility: "visible",
      });
    }

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, summary]);

  if (!hasSummary || !summary) {
    return null;
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`${summary.totalFacts} extracted fact${summary.totalFacts === 1 ? "" : "s"}`}
        className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium tabular-nums text-violet-800 ring-1 ring-violet-200 transition hover:bg-violet-100/80"
        onMouseEnter={() => {
          triggerHoveredRef.current = true;
          showPopover();
        }}
        onMouseLeave={() => {
          triggerHoveredRef.current = false;
          scheduleHide();
        }}
        onFocus={showPopover}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node)) {
            scheduleHide();
          }
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <SparklesIcon />
        <span>{summary.totalFacts}</span>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <PopoverPanel
              panelRef={popoverRef}
              title={title}
              style={popoverStyle}
              onMouseEnter={() => {
                popoverHoveredRef.current = true;
                cancelHide();
              }}
              onMouseLeave={() => {
                popoverHoveredRef.current = false;
                scheduleHide();
              }}
            >
              {multiEmail ? (
                <ThreadExtractionContent summary={summary} />
              ) : (
                <ExtractionSummaryContent summary={summary} />
              )}
            </PopoverPanel>,
            document.body,
          )
        : null}
    </div>
  );
}
