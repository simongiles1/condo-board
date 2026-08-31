"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  drawingSetLabel,
  type FloorPlanDrawingSet,
} from "@/lib/building/floor-plan-shared";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function FloorPlanExpandedShell({
  mounted,
  planName,
  familyName,
  drawingSet,
  onDrawingSetChange,
  prevPlanId,
  nextPlanId,
  onSelectPlan,
  onClose,
  enableFloorKeys = true,
  children,
}: {
  mounted: boolean;
  planName: string;
  familyName: string;
  drawingSet?: FloorPlanDrawingSet;
  onDrawingSetChange?: (set: FloorPlanDrawingSet) => void;
  prevPlanId: string | null;
  nextPlanId: string | null;
  onSelectPlan: (id: string) => void;
  onClose: () => void;
  /** When false, arrow keys are left to the child (east/west nudge). */
  enableFloorKeys?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!mounted) return;

    function onKey(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && enableFloorKeys && prevPlanId) {
        event.preventDefault();
        onSelectPlan(prevPlanId);
      }
      if (event.key === "ArrowRight" && enableFloorKeys && nextPlanId) {
        event.preventDefault();
        onSelectPlan(nextPlanId);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, prevPlanId, nextPlanId, onSelectPlan, onClose, enableFloorKeys]);

  if (!mounted) return <>{children}</>;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-white">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="floor-plan-edit-fullscreen-title"
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2">
          <span className="shrink-0 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800 ring-1 ring-sky-200">
            {familyName}
          </span>
          {drawingSet && onDrawingSetChange ? (
            <div
              className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white p-0.5"
              role="group"
              aria-label="Drawing set"
            >
              {(["architectural", "mechanical"] as const).map((set) => (
                <button
                  key={set}
                  type="button"
                  onClick={() => onDrawingSetChange(set)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                    drawingSet === set
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {drawingSetLabel(set)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <p
              id="floor-plan-edit-fullscreen-title"
              className="truncate text-sm font-semibold text-slate-900"
            >
              {planName}
            </p>
            <p className="truncate text-xs text-slate-500">
              {enableFloorKeys
                ? "Toggle pin and crop visibility · Drag the pin to reposition · Arrow keys flip floors"
                : "Drag the east sheet to overlap elevator cores · Arrow keys nudge 1 pt"}
            </p>
          </div>
          <button
            type="button"
            disabled={!prevPlanId}
            onClick={() => prevPlanId && onSelectPlan(prevPlanId)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            ← Previous
          </button>
          <button
            type="button"
            disabled={!nextPlanId}
            onClick={() => nextPlanId && onSelectPlan(nextPlanId)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Next →
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            aria-label="Exit full screen"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 flex flex-col">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
