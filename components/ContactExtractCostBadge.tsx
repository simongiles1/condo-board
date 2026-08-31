"use client";

import { createPortal } from "react-dom";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { ContactExtractRunsTable } from "@/components/ContactExtractRunsTable";
import {
  contactExtractItemCount,
  type ContactExtractSummary,
} from "@/lib/email-analysis/contact-highlight-run-display";
import { formatCostUsd } from "@/lib/gemini/usage";
import { closeActiveHoverPopover } from "@/lib/ui/hover-popover-group";
import { useHoverPopover } from "@/lib/ui/use-hover-popover";

const VIEWPORT_MARGIN = 8;

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
  summary: ContactExtractSummary;
  onOpenHarvest?: () => void;
};

export function ContactExtractCostBadge({ summary, onOpenHarvest }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hover = useHoverPopover();
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 50,
  });

  useLayoutEffect(() => {
    if (!hover.open || !rootRef.current || !popoverRef.current) return;

    const triggerRect = rootRef.current.getBoundingClientRect();
    const popoverRect = popoverRef.current.getBoundingClientRect();
    setPopoverStyle(
      computePopoverPosition(
        triggerRect,
        popoverRect.width,
        popoverRect.height,
      ),
    );
  }, [hover.open, summary]);

  const costLabel = formatCostUsd(summary.totalCostUsd);
  const itemCount = contactExtractItemCount(summary);

  return (
    <>
      <div
        ref={rootRef}
        className="inline-flex max-w-full"
        onMouseEnter={hover.onTriggerEnter}
        onMouseLeave={hover.onTriggerLeave}
        onFocus={hover.onTriggerFocus}
        onBlur={hover.onTriggerBlur}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          hover.forceClose();
          onOpenHarvest?.();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            closeActiveHoverPopover();
          }
          if (onOpenHarvest && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.stopPropagation();
            hover.forceClose();
            onOpenHarvest();
          }
        }}
      >
        <span
          tabIndex={0}
          role={onOpenHarvest ? "button" : undefined}
          aria-label={`Contact extraction ${itemCount}, ${costLabel}${onOpenHarvest ? ". Click to inspect highlights" : ""}`}
          className={`inline-flex max-w-full items-center gap-1 truncate rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium tabular-nums text-violet-900 ring-1 ring-violet-200 ${onOpenHarvest ? "cursor-pointer hover:ring-2 hover:ring-violet-300/80" : "cursor-default"}`}
        >
          Contact
          <span>{itemCount}</span>
          <span className="text-violet-800">{costLabel}</span>
        </span>
      </div>

      {hover.open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-max min-w-[44rem] max-w-[min(56rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              {...hover.popoverProps}
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Contact extraction by model
              </p>
              <ContactExtractRunsTable runs={summary.runs} compact />
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
