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
  claimHoverPopover,
  releaseHoverPopover,
} from "@/lib/ui/hover-popover-group";

const VIEWPORT_MARGIN = 8;
const POPOVER_HIDE_DELAY_MS = 500;
const POPOVER_WIDTH_PX = 320;

export type SyncRunResultKind =
  | "success"
  | "failed"
  | "partial"
  | "interrupted"
  | "running"
  | "clear_all";

type Props = {
  kind: SyncRunResultKind;
  label: string;
  errors: string | null;
};

function computePopoverPosition(
  triggerRect: DOMRect,
  popoverWidth: number,
  popoverHeight: number,
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let top = triggerRect.bottom + VIEWPORT_MARGIN;
  let left = triggerRect.right - popoverWidth;

  if (left < VIEWPORT_MARGIN) {
    left = VIEWPORT_MARGIN;
  }

  if (left + popoverWidth > viewportWidth - VIEWPORT_MARGIN) {
    left = viewportWidth - VIEWPORT_MARGIN - popoverWidth;
  }

  if (top + popoverHeight > viewportHeight - VIEWPORT_MARGIN) {
    top = triggerRect.top - VIEWPORT_MARGIN - popoverHeight;
  }

  top = Math.max(VIEWPORT_MARGIN, top);

  return {
    position: "fixed",
    top,
    left,
    zIndex: 50,
  };
}

function badgeClassName(kind: SyncRunResultKind): string {
  switch (kind) {
    case "failed":
      return "bg-red-100 text-red-800 ring-red-200 hover:bg-red-200/70";
    case "interrupted":
    case "partial":
      return "bg-amber-100 text-amber-900 ring-amber-200 hover:bg-amber-200/70";
    case "running":
      return "bg-slate-100 text-slate-700 ring-slate-200";
    case "clear_all":
      return "bg-red-100 text-red-800 ring-red-200";
    default:
      return "text-slate-600";
  }
}

function popoverTitle(kind: SyncRunResultKind): string {
  switch (kind) {
    case "failed":
      return "Sync failed";
    case "interrupted":
      return "Sync interrupted";
    case "partial":
      return "Sync completed with errors";
    default:
      return "Sync details";
  }
}

function parseErrorLines(errors: string | null): string[] {
  if (!errors) return [];
  return errors
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function classifyErrorLine(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("cursor was not advanced")) {
    return "Cursor";
  }
  if (lower.includes("history cursor expired") || lower.includes("404")) {
    return "History";
  }
  if (line.startsWith("Message ")) {
    return "Message";
  }
  return "General";
}

export function SyncRunResultBadge({ kind, label, errors }: Props) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverInstanceId = useRef(Symbol("sync-run-result-badge")).current;
  const triggerHoveredRef = useRef(false);
  const popoverHoveredRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 50,
  });

  const errorLines = parseErrorLines(errors);
  const showPopover = errorLines.length > 0 && kind !== "success" && kind !== "running";

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

  function showErrorPopover() {
    if (!showPopover) return;
    claimHoverPopover(popoverInstanceId, forceClose);
    triggerHoveredRef.current = true;
    cancelHide();
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !popoverRef.current) return;

    const triggerRect = rootRef.current.getBoundingClientRect();
    const popoverHeight = popoverRef.current.offsetHeight;
    setPopoverStyle({
      ...computePopoverPosition(triggerRect, POPOVER_WIDTH_PX, popoverHeight),
      width: POPOVER_WIDTH_PX,
    });
  }, [open, errorLines.length]);

  useEffect(() => {
    const instanceId = popoverInstanceId;
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      releaseHoverPopover(instanceId);
    };
  }, [popoverInstanceId]);

  if (kind === "success" || kind === "clear_all") {
    return (
      <span className={kind === "clear_all" ? "text-red-800" : "text-slate-600"}>
        {label}
      </span>
    );
  }

  if (kind === "running") {
    return <span className="text-slate-600">{label}</span>;
  }

  const badge = (
    <span
      ref={rootRef}
      className={`inline-flex cursor-help items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 transition-colors ${badgeClassName(kind)}`}
      onMouseEnter={showErrorPopover}
      onMouseLeave={() => {
        triggerHoveredRef.current = false;
        scheduleHide();
      }}
      onFocus={showErrorPopover}
      onBlur={scheduleHide}
      tabIndex={0}
      role="button"
      aria-label={`${label}. Hover for error details.`}
    >
      {label}
    </span>
  );

  if (!showPopover) {
    return badge;
  }

  return (
    <>
      {badge}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              style={popoverStyle}
              className="rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg"
              onMouseEnter={() => {
                popoverHoveredRef.current = true;
                cancelHide();
              }}
              onMouseLeave={() => {
                popoverHoveredRef.current = false;
                scheduleHide();
              }}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {popoverTitle(kind)}
              </p>
              <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto text-sm text-slate-800">
                {errorLines.map((line, index) => (
                  <li key={`${index}-${line.slice(0, 24)}`} className="leading-snug">
                    <span className="mr-1.5 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      {classifyErrorLine(line)}
                    </span>
                    <span className="break-words">{line}</span>
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
