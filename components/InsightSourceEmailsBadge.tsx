"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { BuildingEmailReference } from "@/lib/building/resolve-source-email";
import { formatDateTime } from "@/lib/format/datetime";
import {
  claimHoverPopover,
  releaseHoverPopover,
} from "@/lib/ui/hover-popover-group";

const VIEWPORT_MARGIN = 8;
const POPOVER_HIDE_DELAY_MS = 500;

function MailIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function computePopoverPosition(
  triggerRect: DOMRect,
  popoverWidth: number,
  popoverHeight: number,
): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let top = triggerRect.bottom + VIEWPORT_MARGIN;
  let left = triggerRect.left;

  if (left + popoverWidth > viewportWidth - VIEWPORT_MARGIN) {
    left = viewportWidth - VIEWPORT_MARGIN - popoverWidth;
  }

  if (top + popoverHeight > viewportHeight - VIEWPORT_MARGIN) {
    top = triggerRect.top - VIEWPORT_MARGIN - popoverHeight;
  }

  top = Math.max(VIEWPORT_MARGIN, top);
  left = Math.max(VIEWPORT_MARGIN, left);

  return {
    position: "fixed",
    top,
    left,
    zIndex: 50,
  };
}

type Props = {
  emails: BuildingEmailReference[];
  onOpenEmail: (emailId: string) => void;
};

export function InsightSourceEmailsBadge({ emails, onOpenEmail }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverInstanceId = useRef(Symbol("insight-source-emails-badge")).current;
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

  useEffect(() => {
    return () => {
      cancelHide();
      releaseHoverPopover(popoverInstanceId);
    };
  }, [popoverInstanceId]);

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
  }, [open, emails.length]);

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
  }, [open, emails.length]);

  if (!emails.length) return null;

  return (
    <div
      ref={rootRef}
      className="relative inline-flex"
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
    >
      <button
        type="button"
        aria-label={`${emails.length} source email${emails.length === 1 ? "" : "s"}`}
        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-teal-800 shadow-sm transition hover:border-teal-200 hover:bg-teal-50"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <MailIcon />
        <span className="tabular-nums">{emails.length}</span>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-max min-w-[16rem] max-w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
              onMouseEnter={() => {
                popoverHoveredRef.current = true;
                cancelHide();
              }}
              onMouseLeave={() => {
                popoverHoveredRef.current = false;
                scheduleHide();
              }}
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Source email{emails.length === 1 ? "" : "s"} ({emails.length})
              </p>
              <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {emails.map((email) => (
                  <li key={email.emailId}>
                    <button
                      type="button"
                      onClick={() => {
                        forceClose();
                        onOpenEmail(email.emailId);
                      }}
                      className="w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-50"
                    >
                      <p className="text-sm font-medium text-teal-800">
                        {email.subject}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-600">
                        {email.fromAddress}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(email.receivedAt)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
