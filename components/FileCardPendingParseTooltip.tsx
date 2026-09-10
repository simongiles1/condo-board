"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { FileCardCorpusSummary } from "@/lib/rag/file-card-runs";
import { useHoverPopover } from "@/lib/ui/use-hover-popover";

const VIEWPORT_MARGIN = 8;
const EXTRACTION_LAB_HREF = "/admin/analysis/extraction";

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
    zIndex: 60,
  };
}

function TooltipBody({ summary }: { summary: FileCardCorpusSummary }) {
  const stuck = summary.pendingWithMarkdownCount;
  return (
    <div className="space-y-3 text-xs leading-relaxed text-slate-700">
      <p>
        File cards only run on attachments whose extraction status is{" "}
        <span className="font-semibold text-slate-900">parsed</span>. These files are still{" "}
        <span className="font-semibold text-slate-900">pending</span>, so they are skipped by
        Pending corpus and will not show archive summary badges until promotion completes.
      </p>
      {stuck > 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50/80 px-2.5 py-2 text-amber-950">
          <span className="font-semibold">{stuck.toLocaleString()}</span> of{" "}
          {summary.pendingParseStatusCount.toLocaleString()} already have markdown on disk but
          could not be promoted—often because vision pages are still pending, processing, or{" "}
          <span className="font-semibold">failed</span> (for example a partial PDF OCR run).
        </p>
      ) : null}
      <div>
        <p className="mb-1.5 font-semibold text-slate-900">How to clear the backlog</p>
        <ol className="list-decimal space-y-1.5 pl-4">
          <li>
            Open the{" "}
            <Link
              href={EXTRACTION_LAB_HREF}
              className="font-medium text-teal-800 underline hover:text-teal-950"
            >
              Extraction lab
            </Link>{" "}
            and filter for attachments that need work (failed vision, uncached Docling, or stuck
            pending).
          </li>
          <li>
            Run or resume a <span className="font-medium">Docling / vision backfill</span> on those
            files. Retry any <span className="font-medium">failed vision pages</span> until the
            document can promote to parsed.
          </li>
          <li>
            Confirm <span className="font-medium">parse status</span> shows parsed in the lab (not
            pending).
          </li>
          <li>
            Return here and run <span className="font-medium">Pending corpus</span> (or target the
            parent emails) to generate file cards.
          </li>
        </ol>
      </div>
    </div>
  );
}

export function FileCardPendingParseTooltip({
  summary,
}: {
  summary: FileCardCorpusSummary;
}) {
  const count = summary.pendingParseStatusCount;
  if (count <= 0) return null;

  const rootRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hover = useHoverPopover({ group: false });
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 60,
  });

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
  }, [hover.open, count]);

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
  }, [hover.open, count]);

  return (
    <>
      <span
        ref={rootRef}
        tabIndex={0}
        className="inline-flex cursor-help items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-950 ring-1 ring-amber-200 underline decoration-amber-400/80 decoration-dotted underline-offset-2"
        onMouseEnter={hover.onTriggerEnter}
        onMouseLeave={hover.onTriggerLeave}
        onFocus={hover.onTriggerFocus}
        onBlur={hover.onTriggerBlur}
      >
        {count.toLocaleString()} pending extraction
      </span>

      {hover.open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-max min-w-[20rem] max-w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3.5 shadow-lg"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              {...hover.popoverProps}
            >
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Pending parse status · not cardable yet
              </p>
              <TooltipBody summary={summary} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
