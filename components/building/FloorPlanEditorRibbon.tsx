"use client";

import { useRef, useState, type ReactNode } from "react";

import {
  AnchoredMenuPortal,
  useAnchoredMenuDismiss,
} from "@/components/AnchoredMenuPortal";
import {
  STROKE_WIDTHS_PT,
  normalizeDrawColorShortcut,
  type DrawColorPreset,
  type DrawTool,
  type RectangleVariant,
  type CircleVariant,
  type ShapeCrossVariant,
  type StrokeColorFilter,
} from "@/lib/building/floor-plan-annotations";
import { floorPlanLabel, type FloorPlanDto } from "@/lib/building/floor-plan-shared";

function RibbonSection({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-[3.25rem] flex-col justify-between border-r border-slate-200 px-2 py-1 last:border-r-0 ${className ?? ""}`}
    >
      <div className="flex flex-1 items-center gap-1">{children}</div>
      <span className="mt-0.5 text-center text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
    </div>
  );
}

function ToolButton({
  active,
  label,
  title,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md p-1.5 ${
        active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-white"
      }`}
    >
      {children}
    </button>
  );
}

function VisibilityToggle({
  active,
  label,
  title,
  disabled,
  onToggle,
  children,
}: {
  active: boolean;
  label: string;
  title?: string;
  disabled?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title ?? `${active ? "Hide" : "Show"} ${label.toLowerCase()}`}
      aria-label={`${active ? "Hide" : "Show"} ${label}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={onToggle}
      className={`rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-slate-900 text-white"
          : "text-slate-500 hover:bg-white hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function RectangleToolButton({
  active,
  variant,
  onActivate,
  onVariantChange,
}: {
  active: boolean;
  variant: ShapeCrossVariant;
  onActivate: () => void;
  onVariantChange: (variant: ShapeCrossVariant) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useAnchoredMenuDismiss(open, () => setOpen(false), triggerRef, menuRef);

  const variantLabel =
    variant === "cross" ? "Rectangle with diagonals" : "Rectangle";
  const title =
    variant === "cross"
      ? "Rectangle with diagonals (R) — click and drag; Shift for square; Alt to disable line extensions"
      : "Rectangle (R) — click and drag; Shift for square; Alt to disable line extensions";

  return (
    <div
      className={`flex items-stretch rounded-md ${
        active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-white"
      }`}
    >
      <button
        type="button"
        title={title}
        aria-label={variantLabel}
        aria-pressed={active}
        onClick={onActivate}
        className="rounded-l-md p-1.5"
      >
        {variant === "cross" ? <RectCrossIcon /> : <RectIcon />}
      </button>
      <button
        ref={triggerRef}
        type="button"
        title="Rectangle shape"
        aria-label="Choose rectangle shape"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className={`rounded-r-md border-l px-0.5 py-1.5 ${
          active ? "border-white/25" : "border-slate-200"
        }`}
      >
        <ChevronDownIcon
          className={active ? "text-white/80" : undefined}
        />
      </button>
      <AnchoredMenuPortal
        open={open}
        triggerRef={triggerRef}
        menuRef={menuRef}
        align="start"
        width={220}
        zIndex={120}
        className="rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
      >
        <button
          type="button"
          role="menuitemradio"
          aria-checked={variant === "plain"}
          onClick={() => {
            onVariantChange("plain");
            onActivate();
            setOpen(false);
          }}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50 ${
            variant === "plain" ? "bg-slate-100 font-medium" : ""
          }`}
        >
          <RectIcon />
          <span>Rectangle</span>
        </button>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={variant === "cross"}
          onClick={() => {
            onVariantChange("cross");
            onActivate();
            setOpen(false);
          }}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50 ${
            variant === "cross" ? "bg-slate-100 font-medium" : ""
          }`}
        >
          <RectCrossIcon />
          <span>Rectangle with diagonals</span>
        </button>
      </AnchoredMenuPortal>
    </div>
  );
}

function CircleToolButton({
  active,
  variant,
  onActivate,
  onVariantChange,
}: {
  active: boolean;
  variant: ShapeCrossVariant;
  onActivate: () => void;
  onVariantChange: (variant: ShapeCrossVariant) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useAnchoredMenuDismiss(open, () => setOpen(false), triggerRef, menuRef);

  const variantLabel =
    variant === "cross" ? "Circle with diagonals" : "Circle";
  const title =
    variant === "cross"
      ? "Circle with diagonals (O) — click and drag; Shift for perfect circle; Alt to disable line extensions"
      : "Circle (O) — click and drag; Shift for perfect circle; Alt to disable line extensions";

  return (
    <div
      className={`flex items-stretch rounded-md ${
        active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-white"
      }`}
    >
      <button
        type="button"
        title={title}
        aria-label={variantLabel}
        aria-pressed={active}
        onClick={onActivate}
        className="rounded-l-md p-1.5"
      >
        {variant === "cross" ? <CircleCrossIcon /> : <CircleIcon />}
      </button>
      <button
        ref={triggerRef}
        type="button"
        title="Circle shape"
        aria-label="Choose circle shape"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className={`rounded-r-md border-l px-0.5 py-1.5 ${
          active ? "border-white/25" : "border-slate-200"
        }`}
      >
        <ChevronDownIcon
          className={active ? "text-white/80" : undefined}
        />
      </button>
      <AnchoredMenuPortal
        open={open}
        triggerRef={triggerRef}
        menuRef={menuRef}
        align="start"
        width={220}
        zIndex={120}
        className="rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
      >
        <button
          type="button"
          role="menuitemradio"
          aria-checked={variant === "plain"}
          onClick={() => {
            onVariantChange("plain");
            onActivate();
            setOpen(false);
          }}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50 ${
            variant === "plain" ? "bg-slate-100 font-medium" : ""
          }`}
        >
          <CircleIcon />
          <span>Circle</span>
        </button>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={variant === "cross"}
          onClick={() => {
            onVariantChange("cross");
            onActivate();
            setOpen(false);
          }}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50 ${
            variant === "cross" ? "bg-slate-100 font-medium" : ""
          }`}
        >
          <CircleCrossIcon />
          <span>Circle with diagonals</span>
        </button>
      </AnchoredMenuPortal>
    </div>
  );
}

function ColorDropdown({
  color,
  colorPresets,
  onColorChange,
  onColorPresetsChange,
}: {
  color: string;
  colorPresets: DrawColorPreset[];
  onColorChange: (color: string) => void;
  onColorPresetsChange: (presets: DrawColorPreset[]) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("New type");
  const [newColor, setNewColor] = useState("#64748b");
  useAnchoredMenuDismiss(open, () => setOpen(false), triggerRef, menuRef);

  const updatePreset = (index: number, patch: Partial<DrawColorPreset>) => {
    const next = colorPresets.map((preset, i) =>
      i === index ? { ...preset, ...patch } : preset,
    );
    onColorPresetsChange(next);
  };

  const assignShortcut = (index: number, raw: string) => {
    const shortcut = normalizeDrawColorShortcut(raw);
    const next = colorPresets.map((preset, i) => {
      if (i === index) {
        const updated = { ...preset };
        if (shortcut) {
          updated.shortcut = shortcut;
        } else {
          delete updated.shortcut;
        }
        return updated;
      }
      if (shortcut && preset.shortcut === shortcut) {
        const updated = { ...preset };
        delete updated.shortcut;
        return updated;
      }
      return preset;
    });
    onColorPresetsChange(next);
  };

  const removePreset = (index: number) => {
    if (colorPresets.length <= 1) return;
    const removed = colorPresets[index];
    const next = colorPresets.filter((_, i) => i !== index);
    onColorPresetsChange(next);
    if (removed.color === color) {
      onColorChange(next[0]?.color ?? color);
    }
  };

  const addPreset = () => {
    const label = newLabel.trim() || "Untitled";
    const next = [...colorPresets, { color: newColor, label }];
    onColorPresetsChange(next);
    onColorChange(newColor);
    setNewLabel("New type");
  };

  const activePreset = colorPresets.find(
    (preset) => preset.color.toLowerCase() === color.toLowerCase(),
  );
  const activeLabel = activePreset?.label ?? "Custom";

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Stroke color: ${activeLabel}`}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`${activeLabel} (${color})`}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-w-[9rem] max-w-[7.5rem] items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-50"
      >
        <span
          className="h-4 w-4 shrink-0 rounded-full border border-slate-300"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
          {activeLabel}
        </span>
        <ChevronDownIcon className="shrink-0" />
      </button>
      <AnchoredMenuPortal
        open={open}
        triggerRef={triggerRef}
        menuRef={menuRef}
        align="start"
        width={300}
        zIndex={120}
        className="rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
      >
        <div role="menu" aria-label="Stroke color">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            Preset colors
          </p>
          <ul className="space-y-1">
            {colorPresets.map((preset, index) => (
              <li
                key={`${preset.color}-${index}`}
                className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 ${
                  color === preset.color ? "bg-slate-100" : ""
                }`}
              >
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={color === preset.color}
                  title={`Select ${preset.label}`}
                  aria-label={`Select ${preset.label}`}
                  onClick={() => {
                    onColorChange(preset.color);
                    setOpen(false);
                  }}
                  className={`h-6 w-6 shrink-0 rounded-full border-2 ${
                    color === preset.color
                      ? "border-slate-900"
                      : "border-transparent"
                  }`}
                  style={{ backgroundColor: preset.color }}
                />
                <input
                  type="text"
                  value={preset.label}
                  onChange={(event) =>
                    updatePreset(index, { label: event.target.value })
                  }
                  onBlur={(event) => {
                    const label = event.target.value.trim();
                    if (!label) updatePreset(index, { label: "Untitled" });
                  }}
                  aria-label={`Label for ${preset.color}`}
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-700 hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:outline-none"
                />
                <input
                  type="text"
                  value={preset.shortcut ?? ""}
                  maxLength={1}
                  onChange={(event) => assignShortcut(index, event.target.value)}
                  placeholder="·"
                  title="Single-key shortcut (letter or number; not V/L/R/C)"
                  aria-label={`Shortcut key for ${preset.label}`}
                  className="w-6 shrink-0 rounded border border-slate-200 bg-white px-0.5 py-0.5 text-center text-xs font-medium uppercase text-slate-700 hover:border-slate-300 focus:border-slate-400 focus:outline-none"
                />
                {colorPresets.length > 1 ? (
                  <button
                    type="button"
                    title={`Remove ${preset.label}`}
                    aria-label={`Remove ${preset.label}`}
                    onClick={() => removePreset(index)}
                    className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  >
                    <RemoveIcon />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Add preset
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={newColor}
                onChange={(event) => setNewColor(event.target.value)}
                className="h-7 w-8 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0"
                aria-label="New preset color"
              />
              <input
                type="text"
                value={newLabel}
                onChange={(event) => setNewLabel(event.target.value)}
                placeholder="Label"
                aria-label="New preset label"
                className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={addPreset}
                className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Add
              </button>
            </div>
          </div>
          <label className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
            <span>Custom</span>
            <input
              type="color"
              value={color}
              onChange={(event) => onColorChange(event.target.value)}
              className="h-7 w-full cursor-pointer rounded border border-slate-300 bg-white p-0"
              aria-label="Custom color"
            />
          </label>
        </div>
      </AnchoredMenuPortal>
    </div>
  );
}

function OverlayRow({
  enabled,
  planId,
  plans,
  title,
  selectLabel,
  onEnabled,
  onPlanId,
}: {
  enabled: boolean;
  planId: string;
  plans: FloorPlanDto[];
  title: string;
  selectLabel: string;
  onEnabled: (value: boolean) => void;
  onPlanId: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1" title={title}>
      <VisibilityToggle
        active={enabled}
        label={selectLabel}
        title={`${enabled ? "Hide" : "Show"} ${selectLabel.toLowerCase()}`}
        onToggle={() => onEnabled(!enabled)}
      >
        {enabled ? <EyeIcon /> : <EyeOffIcon />}
      </VisibilityToggle>
      <select
        value={planId}
        disabled={!enabled}
        onChange={(event) => onPlanId(event.target.value)}
        className="min-w-0 max-w-[10rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
        aria-label={selectLabel}
      >
        {plans.map((item) => (
          <option key={item.id} value={item.id}>
            {floorPlanLabel(item)}
          </option>
        ))}
      </select>
    </div>
  );
}

function lineOverlayFilterHasSelection(filter: StrokeColorFilter): boolean {
  return filter === "all" || filter.length > 0;
}

function LineOverlayControl({
  enabled,
  planId,
  plans,
  colorPresets,
  colorFilter,
  onEnabled,
  onPlanId,
  onColorFilter,
}: {
  enabled: boolean;
  planId: string;
  plans: FloorPlanDto[];
  colorPresets: DrawColorPreset[];
  colorFilter: StrokeColorFilter;
  onEnabled: (value: boolean) => void;
  onPlanId: (id: string) => void;
  onColorFilter: (filter: StrokeColorFilter) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useAnchoredMenuDismiss(open, () => setOpen(false), triggerRef, menuRef);

  const presetColors = colorPresets.map((preset) => preset.color);
  const allTypesSelected =
    colorFilter === "all" ||
    (presetColors.length > 0 &&
      presetColors.every((color) => colorFilter.includes(color)));
  const someTypesSelected =
    colorFilter !== "all" && colorFilter.length > 0 && !allTypesSelected;
  const hasTypeSelection = lineOverlayFilterHasSelection(colorFilter);
  const activePlan = plans.find((item) => item.id === planId);
  const summaryLabel = activePlan ? floorPlanLabel(activePlan) : "Lines overlay";
  const overlayVisible = enabled && hasTypeSelection;

  const setAllTypes = (checked: boolean) => {
    onColorFilter(checked ? "all" : []);
    if (checked && !enabled) onEnabled(true);
  };

  const toggleType = (color: string, checked: boolean) => {
    const current =
      colorFilter === "all" ? [...presetColors] : [...colorFilter];
    const next = checked
      ? [...new Set([...current, color])]
      : current.filter((item) => item !== color);
    if (next.length === presetColors.length) {
      onColorFilter("all");
    } else {
      onColorFilter(next);
    }
    if (checked && !enabled) onEnabled(true);
  };

  const isTypeChecked = (color: string) =>
    colorFilter === "all" || colorFilter.includes(color);

  const typeSummary =
    colorFilter === "all"
      ? "All types"
      : colorFilter.length === 0
        ? "No types"
        : colorFilter.length === 1
          ? (colorPresets.find((preset) => preset.color === colorFilter[0])
              ?.label ?? "1 type")
          : `${colorFilter.length} types`;

  return (
    <div title="Lines from another floor — choose source floor and line types">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Lines overlay options"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Choose source floor and line types to overlay"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex min-w-0 max-w-[11rem] items-center gap-1 rounded-md border px-1.5 py-1 text-xs hover:bg-slate-50 ${
          overlayVisible
            ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
            : "border-slate-300 bg-white text-slate-700"
        }`}
      >
        <span className="shrink-0 p-0.5" aria-hidden>
          {overlayVisible ? <EyeIcon /> : <EyeOffIcon />}
        </span>
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span className="w-full truncate text-left font-medium">
            {summaryLabel}
          </span>
          <span
            className={`w-full truncate text-left text-[10px] ${
              overlayVisible ? "text-slate-300" : "text-slate-400"
            }`}
          >
            {typeSummary}
          </span>
        </span>
        <ChevronDownIcon
          className={`shrink-0 ${overlayVisible ? "text-slate-300" : ""}`}
        />
      </button>
      <AnchoredMenuPortal
        open={open}
        triggerRef={triggerRef}
        menuRef={menuRef}
        align="start"
        width={280}
        zIndex={120}
        className="rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
      >
        <div role="menu" aria-label="Lines overlay">
          <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={overlayVisible}
              disabled={!hasTypeSelection}
              onChange={(event) => onEnabled(event.target.checked)}
              className="rounded border-slate-300"
            />
            <span>Show lines overlay</span>
          </label>
          <label className="mb-2 block text-xs text-slate-600">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Source floor
            </span>
            <select
              value={planId}
              onChange={(event) => onPlanId(event.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
              aria-label="Source floor for lines overlay"
            >
              {plans.map((item) => (
                <option key={item.id} value={item.id}>
                  {floorPlanLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            Line types
          </p>
          <label className="mb-1 flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-xs text-slate-700 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={allTypesSelected}
              ref={(element) => {
                if (element) element.indeterminate = someTypesSelected;
              }}
              onChange={(event) => setAllTypes(event.target.checked)}
              className="rounded border-slate-300"
            />
            <span className="font-medium">All types</span>
          </label>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto border-t border-slate-100 pt-1">
            {colorPresets.map((preset) => (
              <li key={preset.color}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-xs text-slate-700 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={isTypeChecked(preset.color)}
                    onChange={(event) =>
                      toggleType(preset.color, event.target.checked)
                    }
                    className="rounded border-slate-300"
                  />
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full border border-slate-300"
                    style={{ backgroundColor: preset.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{preset.label}</span>
                  {preset.shortcut ? (
                    <span className="shrink-0 font-mono text-[10px] uppercase text-slate-400">
                      {preset.shortcut}
                    </span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </div>
      </AnchoredMenuPortal>
    </div>
  );
}

export function FloorPlanEditorRibbon({
  tool,
  rectangleVariant,
  circleVariant,
  color,
  colorPresets,
  strokeWidthPt,
  annotationCount,
  selectedCount,
  onToolChange,
  onRectangleVariantChange,
  onCircleVariantChange,
  onColorChange,
  onColorPresetsChange,
  onStrokeWidthChange,
  onDeleteSelected,
  onClear,
  showPin,
  onShowPinChange,
  showReferenceAnchor,
  onShowReferenceAnchorChange,
  showReferenceAnchorControl,
  showCrop,
  onShowCropChange,
  cropAwaitingPin,
  showLines,
  onShowLinesChange,
  crossSetLinesAvailable,
  crossSetLinesLabel,
  crossSetLinesHasMarkup,
  showCrossSetLines,
  onShowCrossSetLinesChange,
  overlayPlans,
  overlayEnabled,
  overlayPlanId,
  onOverlayEnabled,
  onOverlayPlanId,
  lineOverlayPlans,
  lineOverlayEnabled,
  lineOverlayPlanId,
  lineOverlayColorFilter,
  onLineOverlayEnabled,
  onLineOverlayPlanId,
  onLineOverlayColorFilter,
  showLineOverlay,
  buildingPinRequiredReason,
  overlayBlockedReason,
  trailing,
}: {
  tool: DrawTool;
  rectangleVariant: RectangleVariant;
  circleVariant: CircleVariant;
  color: string;
  colorPresets: DrawColorPreset[];
  strokeWidthPt: number;
  annotationCount: number;
  selectedCount: number;
  onToolChange: (tool: DrawTool) => void;
  onRectangleVariantChange: (variant: RectangleVariant) => void;
  onCircleVariantChange: (variant: CircleVariant) => void;
  onColorChange: (color: string) => void;
  onColorPresetsChange: (presets: DrawColorPreset[]) => void;
  onStrokeWidthChange: (width: number) => void;
  onDeleteSelected: () => void;
  onClear: () => void;
  showPin: boolean;
  onShowPinChange: (value: boolean) => void;
  showReferenceAnchor: boolean;
  onShowReferenceAnchorChange: (value: boolean) => void;
  /** Only show the anchor visibility control when this floor already has an anchor. */
  showReferenceAnchorControl: boolean;
  showCrop: boolean;
  onShowCropChange: (value: boolean) => void;
  cropAwaitingPin: boolean;
  showLines: boolean;
  onShowLinesChange: (value: boolean) => void;
  crossSetLinesAvailable: boolean;
  crossSetLinesLabel: string;
  crossSetLinesHasMarkup: boolean;
  showCrossSetLines: boolean;
  onShowCrossSetLinesChange: (value: boolean) => void;
  overlayPlans: FloorPlanDto[];
  overlayEnabled: boolean;
  overlayPlanId: string;
  onOverlayEnabled: (value: boolean) => void;
  onOverlayPlanId: (id: string) => void;
  lineOverlayPlans: FloorPlanDto[];
  lineOverlayEnabled: boolean;
  lineOverlayPlanId: string;
  lineOverlayColorFilter: StrokeColorFilter;
  onLineOverlayEnabled: (value: boolean) => void;
  onLineOverlayPlanId: (id: string) => void;
  onLineOverlayColorFilter: (filter: StrokeColorFilter) => void;
  showLineOverlay: boolean;
  /** Shown when overlays are available but this floor has no building pin yet. */
  buildingPinRequiredReason?: string | null;
  /** Shown when a sheet overlay is on but cannot align yet. */
  overlayBlockedReason?: string | null;
  trailing?: ReactNode;
}) {
  const showOverlaySection =
    overlayPlans.length > 0 || (showLineOverlay && lineOverlayPlans.length > 0);

  return (
    <div
      className={`flex shrink-0 flex-wrap items-stretch rounded-lg border border-slate-200 bg-slate-50 ${
        trailing ? "w-full" : ""
      }`}
    >
      <RibbonSection label="Tools">
        <div
          className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-white p-0.5"
          role="group"
          aria-label="Drawing tools"
        >
          <ToolButton
            active={tool === "none"}
            label="Select"
            title="Select markup (V) — click or drag a rectangle to select walls; Shift to add; Delete to remove"
            onClick={() => onToolChange("none")}
          >
            <PointerIcon />
          </ToolButton>
          <ToolButton
            active={tool === "line"}
            label="Line"
            title="Line (L) — click to place points; Ctrl+Z to undo last point; Shift for H/V/45°; Alt to disable line extensions"
            onClick={() => onToolChange("line")}
          >
            <LineIcon />
          </ToolButton>
          <RectangleToolButton
            active={tool === "rectangle"}
            variant={rectangleVariant}
            onActivate={() => onToolChange("rectangle")}
            onVariantChange={onRectangleVariantChange}
          />
          <CircleToolButton
            active={tool === "circle"}
            variant={circleVariant}
            onActivate={() => onToolChange("circle")}
            onVariantChange={onCircleVariantChange}
          />
          <ToolButton
            active={tool === "cut"}
            label="Cut"
            title="Cut (C) — click two points on the same line to sever the segment between them; Ctrl+Z to undo"
            onClick={() => onToolChange("cut")}
          >
            <CutIcon />
          </ToolButton>
          <ToolButton
            active={tool === "connect"}
            label="Connection"
            title="Connection (K) — click the above box (ABV), then the lower box. Arrow points down from ABV. Click the same box twice to disconnect."
            onClick={() => onToolChange("connect")}
          >
            <ConnectIcon />
          </ToolButton>
        </div>
      </RibbonSection>

      <RibbonSection label="Style">
        <ColorDropdown
          color={color}
          colorPresets={colorPresets}
          onColorChange={onColorChange}
          onColorPresetsChange={onColorPresetsChange}
        />
        <select
          value={strokeWidthPt}
          onChange={(event) => onStrokeWidthChange(Number(event.target.value))}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
          aria-label="Stroke width"
        >
          {STROKE_WIDTHS_PT.map((width) => (
            <option key={width} value={width}>
              {width} px
            </option>
          ))}
        </select>
        {selectedCount > 0 ? (
          <button
            type="button"
            onClick={onDeleteSelected}
            title="Delete selected markup"
            className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Delete{selectedCount > 1 ? ` (${selectedCount})` : ""}
          </button>
        ) : null}
        {annotationCount > 0 ? (
          <button
            type="button"
            onClick={onClear}
            title={`Clear all markup (${annotationCount})`}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Clear ({annotationCount})
          </button>
        ) : null}
      </RibbonSection>

      <RibbonSection label="View">
        <VisibilityToggle
          active={showPin}
          label="pin"
          title={
            buildingPinRequiredReason
              ? buildingPinRequiredReason
              : "Show or hide the building pin"
          }
          onToggle={() => onShowPinChange(!showPin)}
        >
          <PinIcon />
        </VisibilityToggle>
        {showReferenceAnchorControl ? (
          <VisibilityToggle
            active={showReferenceAnchor}
            label="reference anchor"
            title="Show or hide the reference anchor on this floor"
            onToggle={() => onShowReferenceAnchorChange(!showReferenceAnchor)}
          >
            <AnchorIcon />
          </VisibilityToggle>
        ) : null}
        <VisibilityToggle
          active={showCrop}
          label="crop"
          disabled={cropAwaitingPin}
          title={
            cropAwaitingPin
              ? "Place the pin first — the crop rectangle sits relative to it"
              : "Show or hide the crop rectangle"
          }
          onToggle={() => onShowCropChange(!showCrop)}
        >
          <CropIcon />
        </VisibilityToggle>
        <VisibilityToggle
          active={showLines}
          label="lines"
          title="Show or hide saved line markup on this floor"
          onToggle={() => onShowLinesChange(!showLines)}
        >
          <LinesIcon />
        </VisibilityToggle>
        {crossSetLinesAvailable ? (
          <button
            type="button"
            disabled={!crossSetLinesHasMarkup}
            title={
              crossSetLinesHasMarkup
                ? `${showCrossSetLines ? "Hide" : "Show"} ${crossSetLinesLabel.toLowerCase()} for this floor, aligned by the building pin`
                : `No saved lines on ${crossSetLinesLabel.toLowerCase()} for this floor yet`
            }
            aria-label={`${showCrossSetLines ? "Hide" : "Show"} ${crossSetLinesLabel}`}
            aria-pressed={showCrossSetLines}
            onClick={() => onShowCrossSetLinesChange(!showCrossSetLines)}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
              showCrossSetLines
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {showCrossSetLines ? <EyeIcon /> : <EyeOffIcon />}
            <span>{crossSetLinesLabel}</span>
          </button>
        ) : null}
      </RibbonSection>

      {showOverlaySection ? (
        <RibbonSection label="Overlay" className="min-w-[11rem]">
          <div className="flex flex-col gap-1">
            {buildingPinRequiredReason ? (
              <p className="max-w-[14rem] text-[10px] font-medium leading-snug text-amber-800">
                {buildingPinRequiredReason}
              </p>
            ) : null}
            {overlayPlans.length > 0 ? (
              <OverlayRow
                enabled={overlayEnabled}
                planId={overlayPlanId}
                plans={overlayPlans}
                selectLabel="Sheet overlay"
                title="Show another floor's cropped PDF aligned by the building pin (not drawn lines)"
                onEnabled={onOverlayEnabled}
                onPlanId={onOverlayPlanId}
              />
            ) : null}
            {showLineOverlay && lineOverlayPlans.length > 0 ? (
              <div className="flex items-center gap-1">
                <span className="w-9 shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  Lines
                </span>
                <LineOverlayControl
                  enabled={lineOverlayEnabled}
                  planId={lineOverlayPlanId}
                  plans={lineOverlayPlans}
                  colorPresets={colorPresets}
                  colorFilter={lineOverlayColorFilter}
                  onEnabled={onLineOverlayEnabled}
                  onPlanId={onLineOverlayPlanId}
                  onColorFilter={onLineOverlayColorFilter}
                />
              </div>
            ) : null}
            {overlayBlockedReason ? (
              <p className="max-w-[14rem] text-[10px] leading-snug text-amber-700">
                {overlayBlockedReason}
              </p>
            ) : null}
          </div>
        </RibbonSection>
      ) : null}

      {trailing ? (
        <div className="ml-auto flex items-center self-stretch px-2 py-1">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}

function ChevronDownIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={`text-slate-500 ${className}`}
      aria-hidden
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M2.5 2.5l7 7M9.5 2.5l-7 7"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 2l12 12M6.2 6.7C5.8 7.1 5.5 7.7 5.5 8c0 1.4 1.1 2.5 2.5 2.5.3 0 .9-.3 1.3-.7M11.1 11.1C10.1 11.8 9.1 12.2 8 12.2 4.5 12.2 2 8 2 8c.7-1.2 1.7-2.3 2.9-3.1M9.5 4.8C9 4.6 8.5 4.5 8 4.5 6.6 4.5 5.5 5.6 5.5 7c0 .5.1 1 .3 1.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 1.5c-2.2 0-4 1.6-4 3.6 0 2.7 4 9.4 4 9.4s4-6.7 4-9.4c0-2-1.8-3.6-4-3.6Zm0 4.8a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z" />
    </svg>
  );
}

function AnchorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M8 6.5v7M5.5 13.5h5M6 9.5h4"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CropIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden>
      <path d="M4.5 1.5v4h4M11.5 14.5v-4h-4M1.5 4.5h4v4M14.5 11.5h-4v-4" />
    </svg>
  );
}

function LinesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <line x1="2" y1="14" x2="14" y2="2" />
      <line x1="2" y1="10" x2="10" y2="2" />
    </svg>
  );
}

function PointerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4.5 2 3 13.5l2.2-2.2 2.5 4.8 1.7-0.9-2.5-4.8 3.1-0.1L4.5 2z" />
    </svg>
  );
}

function LineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <line x1="2" y1="14" x2="14" y2="2" />
    </svg>
  );
}

function RectIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3" y="3" width="10" height="10" />
    </svg>
  );
}

function RectCrossIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3" y="3" width="10" height="10" />
      <line x1="3" y1="3" x2="13" y2="13" />
      <line x1="13" y1="3" x2="3" y2="13" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="8" cy="8" r="5" />
    </svg>
  );
}

function CircleCrossIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="8" cy="8" r="5" />
      <line x1="3" y1="3" x2="13" y2="13" />
      <line x1="13" y1="3" x2="3" y2="13" />
    </svg>
  );
}

function CutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <line x1="2" y1="14" x2="14" y2="2" />
      <line x1="5" y1="5" x2="11" y2="11" strokeWidth="2" />
    </svg>
  );
}

function ConnectIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="1.5" y="1.5" width="5" height="5" rx="0.5" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" />
      <path d="M6 6.5 9.2 9.7" />
      <path d="M9.2 9.7 7.4 9.35 8.85 11.1" />
    </svg>
  );
}
