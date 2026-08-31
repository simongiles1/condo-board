"use client";

/** Reference pin from another floor in the family (alignment guide). */
export const REGISTRATION_MARK_REFERENCE = "rgb(148 163 184)";

/** Suggested building pin from reference-anchor calibration. */
export const REGISTRATION_MARK_SUGGESTED = "rgb(217 119 6)";

/** Pin for the floor you are editing. */
export const REGISTRATION_MARK_THIS = "rgb(220 38 38)";

/** Registration crosshair on a floor-plan canvas (crop or pin editor). */
export function FloorPlanRegistrationMark({
  x,
  y,
  color,
  className = "",
  inverseScale = 1,
}: {
  x: number;
  y: number;
  color: string;
  className?: string;
  /** Counter-scale so the mark stays a fixed screen size inside a zoomed canvas. */
  inverseScale?: number;
}) {
  return (
    <div
      className={`pointer-events-none absolute ${className}`}
      style={{
        left: x,
        top: y,
        color,
        transform: inverseScale === 1 ? undefined : `scale(${inverseScale})`,
        transformOrigin: "0 0",
      }}
    >
      <div
        className="absolute h-8 w-px -translate-x-1/2 -translate-y-1/2"
        style={{ background: color }}
      />
      <div
        className="absolute h-px w-8 -translate-x-1/2 -translate-y-1/2"
        style={{ background: color }}
      />
      <div
        className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white"
        style={{ borderColor: color }}
      />
    </div>
  );
}

export type RegistrationLegendItem = {
  label: string;
  color: string;
};

export function FloorPlanRegistrationLegend({
  items,
  className = "",
}: {
  items: RegistrationLegendItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <FloorPlanColorLegend
      title="Registration marks"
      items={items}
      className={className}
    />
  );
}

export function FloorPlanMarkupLegend({
  items,
  className = "",
}: {
  items: RegistrationLegendItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <FloorPlanColorLegend
      title="Wall types"
      items={items}
      className={className}
    />
  );
}

function FloorPlanColorLegend({
  title,
  items,
  className = "",
}: {
  title: string;
  items: RegistrationLegendItem[];
  className?: string;
}) {
  return (
    <div
      className={`pointer-events-none rounded-lg border border-slate-200 bg-white/95 px-2.5 py-2 text-xs text-slate-700 shadow-sm ${className}`}
    >
      <p className="mb-1.5 font-medium text-slate-900">{title}</p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={`${item.label}-${item.color}`} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-white"
              style={{ borderColor: item.color }}
            />
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
