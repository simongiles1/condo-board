"use client";

export function FloorPlanZoomToolbar({
  zoom,
  onZoomBy,
  onReset,
  resetLabel = "Fit",
}: {
  zoom: number;
  onZoomBy: (factor: number) => void;
  onReset: () => void;
  resetLabel?: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      <button
        type="button"
        onClick={() => onZoomBy(1 / 1.25)}
        className="rounded-md px-2 py-1 text-sm font-medium text-slate-700 hover:bg-white"
        aria-label="Zoom out"
      >
        −
      </button>
      <span className="min-w-14 px-1 text-center text-xs tabular-nums text-slate-600">
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        onClick={() => onZoomBy(1.25)}
        className="rounded-md px-2 py-1 text-sm font-medium text-slate-700 hover:bg-white"
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        type="button"
        onClick={onReset}
        className="rounded-md px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white"
      >
        {resetLabel}
      </button>
    </div>
  );
}
