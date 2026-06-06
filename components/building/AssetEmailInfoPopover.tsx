"use client";

import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { BuildingEmailReference } from "@/lib/building/resolve-source-email";
import { formatDateTime } from "@/lib/format/datetime";

const VIEWPORT_MARGIN = 8;
const HIDE_DELAY_MS = 500;

function InfoIcon() {
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
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

  let top = triggerRect.top;
  let left = triggerRect.right + VIEWPORT_MARGIN;

  if (left + popoverWidth > viewportWidth - VIEWPORT_MARGIN) {
    left = triggerRect.left - VIEWPORT_MARGIN - popoverWidth;
  }

  if (top + popoverHeight > viewportHeight - VIEWPORT_MARGIN) {
    top = viewportHeight - VIEWPORT_MARGIN - popoverHeight;
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

export function AssetEmailInfoPopover({ emails, onOpenEmail }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 50,
  });

  const showPopover = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    setOpen(true);
  }, []);

  const scheduleHidePopover = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    hideTimeoutRef.current = setTimeout(() => {
      hideTimeoutRef.current = null;
      setOpen(false);
    }, HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
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

  if (!emails.length) {
    return <span className="text-slate-300">—</span>;
  }

  return (
    <div
      ref={rootRef}
      className="relative inline-flex"
      onMouseEnter={showPopover}
      onMouseLeave={scheduleHidePopover}
      onFocus={showPopover}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node)) {
          scheduleHidePopover();
        }
      }}
    >
      <button
        type="button"
        aria-label={`${emails.length} linked email${emails.length === 1 ? "" : "s"}`}
        className="inline-flex rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-teal-700"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <InfoIcon />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-max min-w-[16rem] max-w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
              onMouseEnter={showPopover}
              onMouseLeave={scheduleHidePopover}
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Linked emails ({emails.length})
              </p>
              <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {emails.map((email) => (
                  <li key={email.emailId}>
                    <button
                      type="button"
                      onClick={() => {
                        if (hideTimeoutRef.current) {
                          clearTimeout(hideTimeoutRef.current);
                          hideTimeoutRef.current = null;
                        }
                        setOpen(false);
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
