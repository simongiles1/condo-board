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
  formatCostUsd,
  formatTokenCount,
} from "@/lib/gemini/usage";
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

export type PageVisionCostSummary = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  models: string[];
  donePages: number;
};

type Props = {
  summary: PageVisionCostSummary;
};

export function PageVisionCostBadge({ summary }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverInstanceId = useRef(Symbol("page-vision-cost-badge")).current;
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

    const triggerRect = rootRef.current.getBoundingClientRect();
    const popoverRect = popoverRef.current.getBoundingClientRect();
    setPopoverStyle({
      ...computePopoverPosition(
        triggerRect,
        popoverRect.width,
        popoverRect.height,
      ),
      visibility: "visible",
    });
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

  const costLabel = formatCostUsd(summary.costUsd);
  const modelLabel =
    summary.models.length === 0
      ? "—"
      : summary.models.length === 1
        ? summary.models[0]
        : summary.models.join(", ");

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
        onClick={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            closeActiveHoverPopover();
          }
        }}
      >
        <span
          tabIndex={0}
          title={`Page vision ${costLabel} — hover for tokens and model`}
          className="inline-flex max-w-full cursor-default items-center gap-1 truncate rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium tabular-nums text-teal-900 ring-1 ring-teal-200"
        >
          Vision
          <span className="text-teal-800">{costLabel}</span>
        </span>
      </div>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-max min-w-[14rem] max-w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
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
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Page vision
                {summary.donePages > 1
                  ? ` · ${summary.donePages} pages`
                  : ""}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs text-slate-800">
                <dt className="text-slate-500">Input</dt>
                <dd className="text-right tabular-nums">
                  {formatTokenCount(summary.inputTokens)}
                </dd>
                <dt className="text-slate-500">Output</dt>
                <dd className="text-right tabular-nums">
                  {formatTokenCount(summary.outputTokens)}
                </dd>
                <dt className="text-slate-500">Model</dt>
                <dd className="truncate text-right" title={modelLabel}>
                  {modelLabel}
                </dd>
                <dt className="font-medium text-slate-700">Cost</dt>
                <dd className="text-right font-medium tabular-nums text-teal-900">
                  {costLabel}
                </dd>
              </dl>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
