"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { CorpusSearchFileCard } from "@/lib/rag/search";
import { useHoverPopover } from "@/lib/ui/use-hover-popover";

const VIEWPORT_MARGIN = 8;

function documentTypeBadgeClass(documentType: string): string {
  switch (documentType) {
    case "study":
      return "bg-purple-100 text-purple-900 ring-purple-200";
    case "tables":
      return "bg-blue-100 text-blue-900 ring-blue-200";
    case "signed_report":
      return "bg-emerald-100 text-emerald-900 ring-emerald-200";
    case "proposal":
    case "sample":
      return "bg-amber-100 text-amber-900 ring-amber-200";
    default:
      return "bg-slate-100 text-slate-800 ring-slate-200";
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

function FileCardTooltipContent({ card }: { card: CorpusSearchFileCard }) {
  const typeClass = documentTypeBadgeClass(card.documentType);
  return (
    <div className="space-y-2.5 text-xs leading-relaxed text-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${typeClass}`}
        >
          {card.documentType.replace(/_/g, " ")}
        </span>
        {card.documentDate ? (
          <span className="text-[11px] text-slate-500">Date: {card.documentDate}</span>
        ) : null}
      </div>
      <div>
        <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Summary
        </p>
        <p className="text-slate-800">{card.summary}</p>
      </div>
      {card.coveringEmailContext ? (
        <div>
          <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Email context
          </p>
          <p className="text-slate-600">{card.coveringEmailContext}</p>
        </div>
      ) : null}
      {card.parties.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Parties
          </p>
          <div className="flex flex-wrap gap-1">
            {card.parties.map((party) => (
              <span
                key={party}
                className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700"
              >
                {party}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function FileCardSummaryBadge({ card }: { card: CorpusSearchFileCard }) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hover = useHoverPopover({ group: false });
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 50,
  });

  const typeClass = documentTypeBadgeClass(card.documentType);
  const shortLabel = card.documentType.replace(/_/g, " ");

  useLayoutEffect(() => {
    if (!hover.open || !rootRef.current || !popoverRef.current) return;

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
  }, [hover.open, card.summary, card.documentType]);

  useEffect(() => {
    if (!hover.open) return;

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

    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [hover.open, card.summary]);

  return (
    <>
      <span
        ref={rootRef}
        tabIndex={0}
        className={`inline-flex cursor-default items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${typeClass}`}
        title="File card summary"
        onMouseEnter={hover.onTriggerEnter}
        onMouseLeave={hover.onTriggerLeave}
        onFocus={hover.onTriggerFocus}
        onBlur={hover.onTriggerBlur}
      >
        {shortLabel}
      </span>

      {hover.open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-max min-w-[18rem] max-w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              {...hover.popoverProps}
            >
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Extraction lab · file card
              </p>
              <FileCardTooltipContent card={card} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
