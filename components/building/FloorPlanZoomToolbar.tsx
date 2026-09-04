"use client";

export function FloorPlanZoomToolbar({
  zoom,
  onZoomBy,
  onReset,
  resetLabel = "Fit",
  onFitMarkup,
}: {
  zoom: number;
  onZoomBy: (factor: number) => void;
  onReset: () => void;
  resetLabel?: string;
  /** When off-canvas markup exists, zoom/pan to include every saved line. */
  onFitMarkup?: () => void;
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
      {onFitMarkup ? (
        <button
          type="button"
          onClick={onFitMarkup}
          className="rounded-md px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50"
          title="Zoom to include markup drawn outside the PDF page edge"
        >
          Fit markup
        </button>
      ) : null}
    </div>
  );
}
