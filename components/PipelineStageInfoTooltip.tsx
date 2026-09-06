"use client";

import { createPortal } from "react-dom";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  getPipelineStageTooltip,
  type PipelineStageTooltip,
} from "@/lib/meeting-v2/pipeline-stage-tooltips";
import { useHoverPopover } from "@/lib/ui/use-hover-popover";

const VIEWPORT_MARGIN = 8;

function InfoCircleIcon() {
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

  const spaceAbove = triggerRect.top - VIEWPORT_MARGIN;
  const spaceBelow = viewportHeight - triggerRect.bottom - VIEWPORT_MARGIN;
  const showAbove = spaceAbove >= popoverHeight || spaceAbove >= spaceBelow;

  let top: number;
  if (showAbove) {
    top = Math.max(VIEWPORT_MARGIN, triggerRect.top - VIEWPORT_MARGIN - popoverHeight);
  } else {
    top = Math.min(
      viewportHeight - VIEWPORT_MARGIN - popoverHeight,
      triggerRect.bottom + VIEWPORT_MARGIN,
    );
  }

  let left = triggerRect.left + triggerRect.width / 2 - popoverWidth / 2;
  left = Math.min(
    Math.max(left, VIEWPORT_MARGIN),
    viewportWidth - VIEWPORT_MARGIN - popoverWidth,
  );

  return {
    position: "fixed",
    top,
    left,
    zIndex: 60,
  };
}

function TooltipContent({ tooltip }: { tooltip: PipelineStageTooltip }) {
  const useTwoColumns = tooltip.sections.length >= 2;

  return (
    <div className="space-y-2.5 text-sm leading-snug text-slate-700">
      <p className="text-slate-600">{tooltip.summary}</p>
      <div
        className={
          useTwoColumns
            ? "grid grid-cols-2 gap-x-6 gap-y-3"
            : "space-y-2.5"
        }
      >
        {tooltip.sections.map((section, sectionIndex) => (
          <div
            key={sectionIndex}
            className={
              useTwoColumns && section.items.length <= 1 ? "col-span-2" : undefined
            }
          >
            {section.title ? (
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {section.title}
              </p>
            ) : null}
            <ul className="list-disc space-y-1 pl-4 marker:text-slate-300">
              {section.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

type Props = {
  stageId: string;
  label?: string;
};

export function PipelineStageInfoTooltip({ stageId, label }: Props) {
  const tooltip = getPipelineStageTooltip(stageId);
  const rootRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hover = useHoverPopover({ scanGroup: `pipeline-stage-${stageId}` });
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 60,
  });

  useLayoutEffect(() => {
    if (!hover.open || !rootRef.current || !popoverRef.current) return;

    const triggerRect = rootRef.current.getBoundingClientRect();
    const popoverRect = popoverRef.current.getBoundingClientRect();
    setPopoverStyle({
      ...computePopoverPosition(triggerRect, popoverRect.width, popoverRect.height),
      visibility: "visible",
    });
  }, [hover.open, stageId]);

  if (!tooltip) return null;

  const ariaLabel = label
    ? `What happens during ${label}`
    : `What happens during ${tooltip.title}`;

  return (
    <>
      <span
        ref={rootRef}
        className="inline-flex shrink-0"
        onMouseEnter={hover.onTriggerEnter}
        onMouseLeave={hover.onTriggerLeave}
        onFocus={hover.onTriggerFocus}
        onBlur={hover.onTriggerBlur}
      >
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          aria-label={ariaLabel}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <InfoCircleIcon />
        </button>
      </span>

      {hover.open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              className="w-[min(40rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              {...hover.popoverProps}
            >
              <p className="mb-2 text-sm font-semibold text-slate-900">{tooltip.title}</p>
              <TooltipContent tooltip={tooltip} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
