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

import { parseStoredFromAddress } from "@/lib/email/address-display";
import type { EmailProcessingStats } from "@/lib/email/processing-stats";
import { sumProcessingStats } from "@/lib/email/processing-stats";
import {
  formatDateTime,
  formatProcessingDuration,
} from "@/lib/format/datetime";
import {
  formatCostUsd,
  formatOutputTokensPerSecond,
  formatTokenCount,
} from "@/lib/gemini/usage";
import { HOVER_POPOVER_ATTR } from "@/lib/ui/hover-popover-group";
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

const TABLE_COLGROUP = (
  <colgroup>
    <col className="w-[9.5rem]" />
    <col className="w-[8.5rem]" />
    <col className="w-[4.5rem]" />
    <col className="w-[4.5rem]" />
    <col className="w-[4.5rem]" />
    <col className="w-[4.5rem]" />
    <col className="w-[4.5rem]" />
  </colgroup>
);

function TableHeaderRow() {
  return (
    <tr className="border-b border-slate-200 text-left text-slate-500">
      <th className="pb-2 pr-2 font-semibold">Email</th>
      <th className="pb-2 pr-2 font-semibold whitespace-nowrap">Date/time</th>
      <th className="pb-2 pr-2 text-right font-semibold whitespace-nowrap">
        Duration
      </th>
      <th className="pb-2 pr-2 text-right font-semibold whitespace-nowrap">
        Input
      </th>
      <th className="pb-2 pr-2 text-right font-semibold whitespace-nowrap">
        Output
      </th>
      <th className="pb-2 pr-2 text-right font-semibold whitespace-nowrap">
        Out/s
      </th>
      <th className="pb-2 text-right font-semibold whitespace-nowrap">Cost</th>
    </tr>
  );
}

export function ProcessingStatsTable({ entries }: { entries: EmailProcessingStats[] }) {
  const totals = sumProcessingStats(entries);
  const showTotals = entries.length > 1 && totals.processedCount > 0;

  return (
    <div className="flex max-h-80 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full table-fixed border-collapse text-xs">
          {TABLE_COLGROUP}
          <thead className="sticky top-0 z-10 bg-white">
            <TableHeaderRow />
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((entry) => {
              const isProcessed = Boolean(entry.processedAt);
              const { email } = parseStoredFromAddress(entry.fromAddress);

              return (
                <tr
                  key={entry.emailId}
                  className={isProcessed ? "text-slate-800" : "text-slate-400"}
                >
                  <td
                    className="truncate py-2 pr-2"
                    title={email ?? undefined}
                  >
                    {email ?? "—"}
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    {formatDateTime(entry.receivedAt)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                    {isProcessed
                      ? formatProcessingDuration(entry.processingDurationMs)
                      : "—"}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                    {isProcessed && entry.inputTokens != null
                      ? formatTokenCount(entry.inputTokens)
                      : "—"}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                    {isProcessed && entry.outputTokens != null
                      ? formatTokenCount(entry.outputTokens)
                      : "—"}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                    {isProcessed
                      ? formatOutputTokensPerSecond(
                          entry.outputTokens,
                          entry.processingDurationMs,
                        )
                      : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums whitespace-nowrap">
                    {isProcessed && entry.costUsd != null
                      ? formatCostUsd(entry.costUsd)
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showTotals ? (
        <div className="shrink-0 border-t border-slate-200 bg-white pt-1">
          <table className="w-full table-fixed border-collapse text-xs">
            {TABLE_COLGROUP}
            <tfoot>
              <tr className="font-semibold text-teal-900">
                <td className="py-2 pr-2" colSpan={2}>
                  Total
                  {totals.processedCount < entries.length
                    ? ` (${totals.processedCount} of ${entries.length})`
                    : null}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                  {formatProcessingDuration(totals.processingDurationMs)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                  {formatTokenCount(totals.inputTokens)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                  {formatTokenCount(totals.outputTokens)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                  {formatOutputTokensPerSecond(
                    totals.outputTokens,
                    totals.processingDurationMs,
                  )}
                </td>
                <td className="py-2 text-right tabular-nums whitespace-nowrap">
                  {formatCostUsd(totals.costUsd)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </div>
  );
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
      className="w-max min-w-[42rem] max-w-[min(48rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      {...{ [HOVER_POPOVER_ATTR]: "" }}
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

export function ProcessedCostBadge({
  entries,
  badgeClassName = "inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800 ring-1 ring-teal-200",
  children,
  onOpenDetails,
}: {
  entries: EmailProcessingStats[];
  badgeClassName?: string;
  children: ReactNode;
  /** Opens extraction side panel on click. Hover still shows processing stats. */
  onOpenDetails?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hasPopover = entries.length > 0;
  const hover = useHoverPopover({ enabled: hasPopover });
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    zIndex: 50,
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
  }, [hover.open, entries]);

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
  }, [hover.open, entries]);

  const popoverTitle =
    entries.length === 1
      ? "Processing details"
      : `Processing details · ${entries.length} emails`;

  const interactiveClassName = onOpenDetails
    ? "cursor-pointer hover:ring-2 hover:ring-teal-300/80"
    : "";

  return (
    <div ref={rootRef} className="relative shrink-0">
      <span
        tabIndex={hasPopover || onOpenDetails ? 0 : undefined}
        role={onOpenDetails ? "button" : undefined}
        className={`${badgeClassName} ${interactiveClassName}`}
        onMouseEnter={hover.onTriggerEnter}
        onMouseLeave={hover.onTriggerLeave}
        onFocus={hover.onTriggerFocus}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node)) {
            hover.onTriggerBlur();
          }
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          hover.forceClose();
          if (onOpenDetails) {
            onOpenDetails();
          }
        }}
        onKeyDown={(event) => {
          if (onOpenDetails && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.stopPropagation();
            onOpenDetails();
          }
        }}
      >
        {children}
      </span>

      {hover.open && hasPopover && typeof document !== "undefined"
        ? createPortal(
            <PopoverPanel
              panelRef={popoverRef}
              title={popoverTitle}
              style={popoverStyle}
              onMouseEnter={hover.onPopoverEnter}
              onMouseLeave={hover.onPopoverLeave}
            >
              <ProcessingStatsTable entries={entries} />
            </PopoverPanel>,
            document.body,
          )
        : null}
    </div>
  );
}
