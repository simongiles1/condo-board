"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { ProjectExtractRunsTable } from "@/components/ProjectExtractRunsTable";
import {
  projectExtractItemCount,
  type ProjectExtractSummary,
} from "@/lib/email-analysis/project-highlight-run-display";
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

type Props = {
  summary: ProjectExtractSummary;
  onOpenHarvest?: () => void;
};

export function ProjectExtractCostBadge({ summary, onOpenHarvest }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverInstanceId = useRef(Symbol("project-extract-cost-badge")).current;
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
    setPopoverStyle(
      computePopoverPosition(
        triggerRect,
        popoverRect.width,
        popoverRect.height,
      ),
    );
  }, [open, summary]);

  const costLabel = formatCostUsd(summary.totalCostUsd);
  const itemCount = projectExtractItemCount(summary);

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
          onOpenHarvest?.();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            closeActiveHoverPopover();
          }
          if (onOpenHarvest && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.stopPropagation();
            onOpenHarvest();
          }
        }}
      >
        <span
          tabIndex={0}
          role={onOpenHarvest ? "button" : undefined}
          title={`Project extraction ${itemCount} · ${costLabel} — hover for model breakdown${onOpenHarvest ? "; click to inspect highlights" : ""}`}
          className={`inline-flex max-w-full items-center gap-1 truncate rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium tabular-nums text-orange-900 ring-1 ring-orange-200 ${onOpenHarvest ? "cursor-pointer hover:ring-2 hover:ring-orange-300/80" : "cursor-default"}`}
        >
          Projects
          <span>{itemCount}</span>
          <span className="text-orange-800">{costLabel}</span>
        </span>
      </div>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-max min-w-[44rem] max-w-[min(56rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
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
                Project extraction by model
              </p>
              <ProjectExtractRunsTable runs={summary.runs} compact />
              <p className="mt-2 text-right text-xs font-medium tabular-nums text-slate-700">
                Total {costLabel}
              </p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
