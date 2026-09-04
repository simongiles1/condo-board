"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  AnchoredMenuPortal,
  useAnchoredMenuDismiss,
} from "@/components/AnchoredMenuPortal";
import {
  DRAW_COLOR_FAMILIES,
  STROKE_WIDTHS_PT,
  drawColorFamilyLabel,
  normalizeDrawColorShortcut,
  normalizeStrokeColor,
  presetsInFamily,
  presetDrawColorFamily,
  strokeColorFilterHasSelection,
  type DrawColorFamily,
  type DrawColorPreset,
  type DrawTool,
  type MechanicalMarkupSet,
  type RectangleVariant,
  type CircleVariant,
  type ShapeCrossVariant,
  type StrokeColorFilter,
} from "@/lib/building/floor-plan-annotations";
import { floorPlanLabel, type FloorPlanDto } from "@/lib/building/floor-plan-shared";
import {
  DEFAULT_ROOM_LEAK_MAX_GAP_PT,
  MAX_ROOM_LEAK_MAX_GAP_PT,
  MIN_ROOM_LEAK_MAX_GAP_PT,
  type FloorPlanRoomListEntry,
} from "@/lib/building/floor-plan-rooms";
import {
  formatFollowedRisersSummary,
  groupRisersForFollowMenu,
  riserIsCompleted,
  type MechanicalRiserDto,
  type MechanicalRiserTypeDto,
  type TaggedRiserFloorGroup,
} from "@/lib/building/floor-plan-mechanical-risers";

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

export function MechanicalMarkupSetToggle({
  value,
  onChange,
}: {
  value: MechanicalMarkupSet;
  onChange: (value: MechanicalMarkupSet) => void;
}) {
  return (
    <div
      className="flex items-stretch overflow-hidden rounded-md border border-slate-200 bg-white"
      role="group"
      aria-label="Riser labeling pass"
    >
      <button
        type="button"
        aria-pressed={value === 1}
        title="Pass 1 — existing mechanical labels. Switching does not delete them."
        onClick={() => onChange(1)}
        className={`px-2 py-1 text-xs font-semibold ${
          value === 1
            ? "bg-slate-900 text-white"
            : "text-slate-600 hover:bg-slate-50"
        }`}
      >
        V1
      </button>
      <button
        type="button"
        aria-pressed={value === 2}
        title="Pass 2 — blank slate for tracing each riser up the building. Pass 1 stays saved."
        onClick={() => onChange(2)}
        className={`px-2 py-1 text-xs font-semibold ${
          value === 2
            ? "bg-slate-900 text-white"
            : "text-slate-600 hover:bg-slate-50"
        }`}
      >
        V2
      </button>
    </div>
  );
}

export function RiserLabelsToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      Riser labels
    </label>
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
  defaultFamily,
  onColorChange,
  onColorPresetsChange,
}: {
  color: string;
  colorPresets: DrawColorPreset[];
  defaultFamily: DrawColorFamily;
  onColorChange: (color: string) => void;
  onColorPresetsChange: (presets: DrawColorPreset[]) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("New type");
  const [newColor, setNewColor] = useState("#64748b");
  const [newFamily, setNewFamily] = useState<DrawColorFamily>(defaultFamily);
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
    const typeId =
      newFamily === "mechanical" ? crypto.randomUUID() : undefined;
    const next: DrawColorPreset[] = [
      ...colorPresets,
      {
        color: newColor,
        label,
        family: newFamily,
        ...(typeId ? { typeId } : {}),
      },
    ];
    onColorPresetsChange(next);
    onColorChange(newColor);
    setNewLabel("New type");
  };

  const normalizedColor = normalizeStrokeColor(color);
  const activePreset = colorPresets.find(
    (preset) => normalizeStrokeColor(preset.color) === normalizedColor,
  );
  const activeLabel = activePreset?.label ?? "Custom";
  const presetMatchesColor = (presetColor: string) =>
    normalizeStrokeColor(presetColor) === normalizedColor;

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
        width={360}
        zIndex={120}
        className="rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
      >
        <div role="menu" aria-label="Stroke color">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            Legend
          </p>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {DRAW_COLOR_FAMILIES.map((family) => {
              const rows = colorPresets
                .map((preset, index) => ({ preset, index }))
                .filter((row) => presetDrawColorFamily(row.preset) === family);
              if (rows.length === 0) return null;
              return (
                <div key={family}>
                  <p className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    {drawColorFamilyLabel(family)}
                  </p>
                  <ul className="space-y-1">
                    {rows.map(({ preset, index }) => (
                      <li
                        key={`${preset.color}-${index}`}
                        className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 ${
                          presetMatchesColor(preset.color) ? "bg-slate-100" : ""
                        }`}
                      >
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={presetMatchesColor(preset.color)}
                          title={`Select ${preset.label}`}
                          aria-label={`Select ${preset.label}`}
                          onClick={() => {
                            onColorChange(preset.color);
                            setOpen(false);
                          }}
                          className={`h-6 w-6 shrink-0 rounded-full border-2 ${
                            presetMatchesColor(preset.color)
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
                            if (!label)
                              updatePreset(index, { label: "Untitled" });
                          }}
                          aria-label={`Label for ${preset.color}`}
                          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-700 hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:outline-none"
                        />
                        <select
                          value={presetDrawColorFamily(preset)}
                          onChange={(event) => {
                            const family = event.target.value as DrawColorFamily;
                            const next = colorPresets.map((row, i) => {
                              if (i !== index) return row;
                              const updated: DrawColorPreset = {
                                ...row,
                                family,
                              };
                              if (family === "mechanical") {
                                updated.typeId =
                                  row.typeId ?? crypto.randomUUID();
                              } else {
                                delete updated.typeId;
                              }
                              return updated;
                            });
                            onColorPresetsChange(next);
                          }}
                          title="Architectural or mechanical family"
                          aria-label={`Family for ${preset.label}`}
                          className="w-[4.25rem] shrink-0 rounded border border-slate-200 bg-white px-0.5 py-0.5 text-[10px] text-slate-700"
                        >
                          {DRAW_COLOR_FAMILIES.map((option) => (
                            <option key={option} value={option}>
                              {option === "architectural" ? "Arch" : "Mech"}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={preset.shortcut ?? ""}
                          maxLength={1}
                          onChange={(event) =>
                            assignShortcut(index, event.target.value)
                          }
                          placeholder="·"
                          title="Single-key shortcut (letter or number; not V/L/R/O/C/K/A/T)"
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
                </div>
              );
            })}
          </div>
          <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Add type
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
              <select
                value={newFamily}
                onChange={(event) =>
                  setNewFamily(event.target.value as DrawColorFamily)
                }
                aria-label="New type family"
                className="w-[4.25rem] shrink-0 rounded border border-slate-300 bg-white px-0.5 py-1 text-[10px] text-slate-700"
              >
                {DRAW_COLOR_FAMILIES.map((option) => (
                  <option key={option} value={option}>
                    {option === "architectural" ? "Arch" : "Mech"}
                  </option>
                ))}
              </select>
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

function FollowRiserControl({
  riserTypes,
  risers,
  followedRiserIds,
  onFollowedRiserIds,
  onCompletedChange,
}: {
  riserTypes: MechanicalRiserTypeDto[];
  risers: MechanicalRiserDto[];
  followedRiserIds: string[];
  onFollowedRiserIds: (ids: string[]) => void;
  onCompletedChange?: (id: string, completed: boolean) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useAnchoredMenuDismiss(open, () => setOpen(false), triggerRef, menuRef);

  const groups = groupRisersForFollowMenu(riserTypes, risers);
  const followedSet = new Set(followedRiserIds);
  const followed = risers.filter((riser) => followedSet.has(riser.id));
  const summaryLabel = formatFollowedRisersSummary(
    riserTypes,
    risers,
    followedRiserIds,
  );
  const openCount = risers.filter((riser) => !riserIsCompleted(riser)).length;
  const followedOpenCount = followed.filter((riser) => !riserIsCompleted(riser))
    .length;
  const allRiserIds = risers.map((riser) => riser.id);
  const allSelected =
    allRiserIds.length > 0 &&
    allRiserIds.every((id) => followedSet.has(id));
  const someSelected = followedRiserIds.length > 0 && !allSelected;

  const toggleRiser = (riserId: string) => {
    if (followedSet.has(riserId)) {
      onFollowedRiserIds(followedRiserIds.filter((id) => id !== riserId));
      return;
    }
    onFollowedRiserIds([...followedRiserIds, riserId]);
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      onFollowedRiserIds([]);
      return;
    }
    onFollowedRiserIds(allRiserIds);
  };

  return (
    <div title="Preview selected riser boxes from the floor below. Approve, move, or dismiss each box on this floor.">
      <button
        ref={triggerRef}
        type="button"
        aria-label={
          followed.length > 0
            ? `Following ${summaryLabel}`
            : "Follow mechanical risers"
        }
        aria-expanded={open}
        aria-haspopup="menu"
        title="Show selected riser boxes from the floor below as overlays. Approve each box to keep it, dismiss if it does not continue, or move it on this floor."
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex min-w-0 max-w-[11rem] items-center gap-1 rounded-md border px-1.5 py-1 text-xs hover:bg-slate-50 ${
          followed.length > 0
            ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
            : "border-slate-300 bg-white text-slate-700"
        }`}
      >
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span className="w-full truncate text-left font-medium">
            {summaryLabel}
          </span>
          <span
            className={`w-full truncate text-left text-[10px] ${
              followed.length > 0 ? "text-slate-300" : "text-slate-400"
            }`}
          >
            {risers.length === 0
              ? "None created"
              : followed.length > 0 && followedOpenCount === 0
                ? "Completed"
                : followed.length > 0
                  ? `${followedOpenCount} open`
                  : `${openCount} open`}
          </span>
        </span>
        <ChevronDownIcon
          className={`shrink-0 ${followed.length > 0 ? "text-slate-300" : ""}`}
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
        <div role="menu" aria-label="Follow risers">
          <button
            type="button"
            role="menuitem"
            aria-disabled={followedRiserIds.length === 0}
            disabled={followedRiserIds.length === 0}
            onClick={() => {
              onFollowedRiserIds([]);
              setOpen(false);
            }}
            className={`mb-1 flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${
              followedRiserIds.length === 0
                ? "bg-slate-100 font-medium"
                : "text-slate-700"
            }`}
          >
            Not following
          </button>
          {groups.length === 0 ? (
            <p className="px-2 py-1 text-xs text-slate-500">
              Label a box with Callout (A) to add a riser.
            </p>
          ) : (
            <>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={allSelected ? true : someSelected ? "mixed" : false}
                onClick={toggleSelectAll}
                className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                    allSelected || someSelected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white"
                  }`}
                  aria-hidden
                >
                  {allSelected ? "✓" : someSelected ? "−" : ""}
                </span>
                Select all
              </button>
              <div className="max-h-72 space-y-1.5 overflow-y-auto border-t border-slate-100 pt-1">
              {groups.map((group) => (
                <div key={group.type.id}>
                  <p className="mb-0.5 flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-300"
                      style={{ backgroundColor: group.type.color }}
                      aria-hidden
                    />
                    {group.type.name}
                  </p>
                  <ul className="space-y-0.5">
                    {group.risers.map((riser) => {
                      const selected = followedSet.has(riser.id);
                      const completed = riserIsCompleted(riser);
                      return (
                        <li
                          key={riser.id}
                          className={`flex items-center gap-1 rounded-md px-1 py-0.5 ${
                            selected ? "bg-slate-100" : ""
                          }`}
                        >
                          <button
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={selected}
                            onClick={() => toggleRiser(riser.id)}
                            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs text-slate-700 hover:bg-slate-50"
                          >
                            <span
                              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                                selected
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-300 bg-white"
                              }`}
                              aria-hidden
                            >
                              {selected ? "✓" : ""}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {riser.label}
                            </span>
                            {completed ? (
                              <span className="shrink-0 text-[10px] uppercase tracking-wide text-emerald-700">
                                Done
                              </span>
                            ) : null}
                          </button>
                          {onCompletedChange ? (
                            <button
                              type="button"
                              role="switch"
                              aria-checked={completed}
                              title={
                                completed
                                  ? "Mark as still tracing"
                                  : "Mark completed — stops copying onto new floors"
                              }
                              aria-label={
                                completed
                                  ? `Mark ${group.type.name} ${riser.label} as still tracing`
                                  : `Mark ${group.type.name} ${riser.label} completed`
                              }
                              onClick={() =>
                                onCompletedChange(riser.id, !completed)
                              }
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                completed
                                  ? "bg-emerald-600 text-white"
                                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                              }`}
                            >
                              {completed ? "Done" : "Open"}
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              </div>
            </>
          )}
        </div>
      </AnchoredMenuPortal>
    </div>
  );
}

function RoomListDropdown({
  rooms,
  listHoverRoomIndex,
  onListHoverRoomIndex,
  onRoomLabelChange,
  onRoomDelete,
}: {
  rooms: FloorPlanRoomListEntry[];
  listHoverRoomIndex: number | null;
  onListHoverRoomIndex: (index: number | null) => void;
  onRoomLabelChange: (index: number, label: string) => void;
  onRoomDelete: (index: number) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useAnchoredMenuDismiss(
    open,
    () => {
      setOpen(false);
      onListHoverRoomIndex(null);
    },
    triggerRef,
    menuRef,
  );

  const summary =
    rooms.length === 0
      ? "Units"
      : `${rooms.length} unit${rooms.length === 1 ? "" : "s"}`;

  return (
    <div title="Tagged units on this floor — rename, delete, or hover to highlight">
      <button
        ref={triggerRef}
        type="button"
        aria-label={
          rooms.length > 0
            ? `${summary} on this floor`
            : "No units tagged on this floor"
        }
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={rooms.length === 0}
        title="Tagged units on this floor"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-w-0 max-w-[9rem] items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="truncate">{summary}</span>
        <ChevronDownIcon className="shrink-0" />
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
        <div role="menu" aria-label="Units on this floor">
          <p className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            Units on this floor
          </p>
          <ul className="max-h-72 space-y-0.5 overflow-y-auto">
            {rooms.map((room) => {
              const highlighted = listHoverRoomIndex === room.index;
              const placeholder = room.label.trim() ? undefined : "Unit number";
              return (
                <li
                  key={room.index}
                  role="none"
                  onMouseEnter={() => onListHoverRoomIndex(room.index)}
                  onMouseLeave={() => onListHoverRoomIndex(null)}
                  className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 ${
                    highlighted ? "bg-sky-50" : "hover:bg-slate-50"
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-300"
                    style={{ backgroundColor: room.color }}
                    aria-hidden
                  />
                  <input
                    type="text"
                    value={room.label}
                    placeholder={placeholder}
                    aria-label={
                      room.label.trim()
                        ? `Rename unit ${room.label}`
                        : "Unit number"
                    }
                    onChange={(event) =>
                      onRoomLabelChange(room.index, event.target.value)
                    }
                    onPointerDown={(event) => event.stopPropagation()}
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium text-slate-800 outline-none focus:border-sky-400 focus:bg-white"
                  />
                  <button
                    type="button"
                    title={`Remove unit ${room.label.trim() || "highlight"}`}
                    aria-label={`Delete unit ${room.label.trim() || "highlight"}`}
                    onClick={() => onRoomDelete(room.index)}
                    className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <TrashIcon />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </AnchoredMenuPortal>
    </div>
  );
}

function RiserInventoryToggle({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-controls="riser-inventory-panel"
      title="List tagged risers by floor, type, and number"
      onClick={() => onOpenChange(!open)}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs font-medium ${
        open
          ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      <ListPanelIcon />
      List
    </button>
  );
}

function StandardizeRisersToggle({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title="Standardize riser sizes and shapes (rectangles and circles) per type"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
    >
      <StandardizeIcon />
      Standardize
    </button>
  );
}

function StandardizeIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="2" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
    </svg>
  );
}

function formatTypeLegendLabel(type: MechanicalRiserTypeDto): string {
  return type.shortcut
    ? `${type.name} (${type.shortcut.toUpperCase()})`
    : type.name;
}

function toggleSetValue<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function splitColumnMajor<T>(items: T[]): [T[], T[]] {
  const firstColumnCount = Math.ceil(items.length / 2);
  return [items.slice(0, firstColumnCount), items.slice(firstColumnCount)];
}

export function RiserInventoryPanel({
  floors,
  markupSet,
  onClose,
  onRiserClick,
}: {
  floors: TaggedRiserFloorGroup[];
  markupSet: MechanicalMarkupSet;
  onClose: () => void;
  onRiserClick?: (args: {
    floorNumber: number;
    riserId: string;
    approved: boolean;
  }) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [approvalFilter, setApprovalFilter] = useState<
    "all" | "approved" | "unapproved"
  >("all");
  const [collapsedFloors, setCollapsedFloors] = useState(
    () => new Set(floors.filter((floor) => !floor.current).map((floor) => floor.floorNumber)),
  );
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(() => new Set());
  const currentRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    function onWheel(event: WheelEvent) {
      event.stopPropagation();
    }
    panel.addEventListener("wheel", onWheel, { capture: true });
    return () => panel.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  function riserMatchesFilter(approved: boolean): boolean {
    if (approvalFilter === "all") return true;
    return approvalFilter === "approved" ? approved : !approved;
  }

  function filteredTypes(floor: TaggedRiserFloorGroup) {
    return floor.types
      .map((group) => ({
        ...group,
        risers: group.risers.filter((riser) => riserMatchesFilter(riser.approved)),
      }))
      .filter((group) => group.risers.length > 0);
  }

  function visibleRiserCount(floor: TaggedRiserFloorGroup): number {
    return filteredTypes(floor).reduce(
      (sum, group) => sum + group.risers.length,
      0,
    );
  }

  const hasVisibleRisers = floors.some(
    (floor) => floor.current || visibleRiserCount(floor) > 0,
  );

  return (
    <aside
      ref={panelRef}
      id="riser-inventory-panel"
      aria-label="Tagged risers by floor"
      className="absolute bottom-0 right-0 top-0 z-30 flex w-72 flex-col border-l border-slate-200 bg-white shadow-lg"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      <div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 px-3 py-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">Tagged risers</p>
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Pass {markupSet}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close tagged risers"
          >
            <RemoveIcon />
          </button>
        </div>
        <div
          className="grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5"
          role="tablist"
          aria-label="Riser approval filter"
        >
          {(
            [
              ["all", "All"],
              ["unapproved", "Unapproved"],
              ["approved", "Approved"],
            ] as const
          ).map(([value, label]) => {
            const selected = approvalFilter === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setApprovalFilter(value)}
                className={`rounded-md px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition ${
                  selected
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {floors.length === 0 ? (
          <p className="px-2 py-1 text-xs text-slate-500">No mechanical floors.</p>
        ) : !hasVisibleRisers ? (
          <p className="px-2 py-1 text-xs text-slate-500">
            {approvalFilter === "all"
              ? "No risers to show."
              : approvalFilter === "approved"
                ? "No tagged risers."
                : "No pending risers."}
          </p>
        ) : (
          <ul className="space-y-1">
            {floors.map((floor) => {
              const floorTypes = filteredTypes(floor);
              const count = visibleRiserCount(floor);
              if (count === 0 && !floor.current) return null;
              const expanded = !collapsedFloors.has(floor.floorNumber);
              return (
                <li
                  key={floor.floorNumber}
                  ref={floor.current ? currentRef : undefined}
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() =>
                      setCollapsedFloors((prev) =>
                        toggleSetValue(prev, floor.floorNumber),
                      )
                    }
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs hover:bg-slate-50"
                  >
                    <ChevronDownIcon
                      className={`shrink-0 transition-transform ${
                        expanded ? "" : "-rotate-90"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">
                      Floor {floor.floorNumber}
                    </span>
                    {floor.current ? (
                      <span className="shrink-0 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 ring-1 ring-sky-200">
                        This floor
                      </span>
                    ) : null}
                    <span className="shrink-0 tabular-nums text-[10px] text-slate-400">
                      {count}
                    </span>
                  </button>
                  {expanded ? (
                    floorTypes.length === 0 ? (
                      <p className="px-7 py-1 text-xs text-slate-500">
                        None tagged
                      </p>
                    ) : (
                      <ul className="mb-1 ml-3 space-y-0.5 border-l border-slate-100 pl-2">
                        {floorTypes.map((group) => {
                          const typeKey = `${floor.floorNumber}:${group.type.id}`;
                          const typeExpanded = !collapsedTypes.has(typeKey);
                          return (
                            <li key={group.type.id}>
                              <button
                                type="button"
                                aria-expanded={typeExpanded}
                                onClick={() =>
                                  setCollapsedTypes((prev) =>
                                    toggleSetValue(prev, typeKey),
                                  )
                                }
                                className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs hover:bg-slate-50"
                              >
                                <ChevronDownIcon
                                  className={`shrink-0 transition-transform ${
                                    typeExpanded ? "" : "-rotate-90"
                                  }`}
                                />
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-white"
                                  style={{ borderColor: group.type.color }}
                                  aria-hidden
                                />
                                <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                                  {formatTypeLegendLabel(group.type)}
                                </span>
                                <span className="shrink-0 tabular-nums text-[10px] text-slate-400">
                                  {group.risers.length}
                                </span>
                              </button>
                              {typeExpanded ? (
                                <div className="ml-6 flex gap-x-2 py-0.5">
                                  {splitColumnMajor(group.risers).map(
                                    (column, columnIndex) => (
                                      <ul
                                        key={columnIndex}
                                        className="min-w-0 flex-1 space-y-0.5"
                                      >
                                        {column.map((riser) => (
                                          <li key={riser.id}>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                onRiserClick?.({
                                                  floorNumber: floor.floorNumber,
                                                  riserId: riser.id,
                                                  approved: riser.approved,
                                                })
                                              }
                                              className={`w-full rounded px-1 py-0.5 text-left text-xs font-medium hover:bg-slate-50 ${
                                                riser.approved
                                                  ? ""
                                                  : "border border-dashed border-amber-300/80 bg-amber-50/70 hover:bg-amber-50"
                                              }`}
                                              style={
                                                riser.approved
                                                  ? { color: group.type.color }
                                                  : undefined
                                              }
                                              title={
                                                riser.approved
                                                  ? "Center canvas on this tagged riser"
                                                  : "Center canvas on this pending riser"
                                              }
                                            >
                                              <span
                                                className={
                                                  riser.approved
                                                    ? ""
                                                    : "text-amber-900/80"
                                                }
                                              >
                                                {riser.label}
                                              </span>
                                            </button>
                                          </li>
                                        ))}
                                      </ul>
                                    ),
                                  )}
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
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

function familySelectionState(
  filter: StrokeColorFilter,
  presets: DrawColorPreset[],
  family: DrawColorFamily,
): { all: boolean; some: boolean } {
  const colors = presetsInFamily(presets, family).map((preset) => preset.color);
  if (colors.length === 0) return { all: false, some: false };
  const selectedCount = colors.filter(
    (color) => filter === "all" || filter.includes(color),
  ).length;
  return {
    all: selectedCount === colors.length,
    some: selectedCount > 0 && selectedCount < colors.length,
  };
}

export function LineOverlayControl({
  enabled,
  planId,
  plans,
  colorPresets,
  colorFilter,
  onEnabled,
  onPlanId,
  onColorFilter,
  title = "Overlay lines by family — architectural types come from this floor's other drawing; mechanical types come from the source floor",
  zIndex = 120,
}: {
  enabled: boolean;
  planId: string;
  plans: FloorPlanDto[];
  colorPresets: DrawColorPreset[];
  colorFilter: StrokeColorFilter;
  onEnabled: (value: boolean) => void;
  onPlanId: (id: string) => void;
  onColorFilter: (filter: StrokeColorFilter) => void;
  title?: string;
  zIndex?: number;
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
  const hasTypeSelection = strokeColorFilterHasSelection(colorFilter);
  const activePlan = plans.find((item) => item.id === planId);
  const summaryLabel = activePlan ? floorPlanLabel(activePlan) : "Lines overlay";
  const overlayVisible = enabled && hasTypeSelection;
  const architecturalState = familySelectionState(
    colorFilter,
    colorPresets,
    "architectural",
  );
  const mechanicalState = familySelectionState(
    colorFilter,
    colorPresets,
    "mechanical",
  );

  const commitFilter = (next: string[], checked: boolean) => {
    if (next.length === presetColors.length) {
      onColorFilter("all");
    } else {
      onColorFilter(next);
    }
    if (checked && !enabled) onEnabled(true);
  };

  const setAllTypes = (checked: boolean) => {
    onColorFilter(checked ? "all" : []);
    if (checked && !enabled) onEnabled(true);
  };

  const setFamilyTypes = (family: DrawColorFamily, checked: boolean) => {
    const familyColors = presetsInFamily(colorPresets, family).map(
      (preset) => preset.color,
    );
    const current =
      colorFilter === "all" ? [...presetColors] : [...colorFilter];
    const next = checked
      ? [...new Set([...current, ...familyColors])]
      : current.filter((color) => !familyColors.includes(color));
    commitFilter(next, checked);
  };

  const toggleType = (color: string, checked: boolean) => {
    const current =
      colorFilter === "all" ? [...presetColors] : [...colorFilter];
    const next = checked
      ? [...new Set([...current, color])]
      : current.filter((item) => item !== color);
    commitFilter(next, checked);
  };

  const isTypeChecked = (color: string) =>
    colorFilter === "all" || colorFilter.includes(color);

  const typeSummary = allTypesSelected
    ? "All types"
    : colorFilter.length === 0
      ? "No types"
      : architecturalState.all && !mechanicalState.some
        ? "Architectural"
        : mechanicalState.all && !architecturalState.some
          ? "Mechanical"
          : colorFilter.length === 1
            ? (colorPresets.find((preset) => preset.color === colorFilter[0])
                ?.label ?? "1 type")
            : `${colorFilter.length} types`;

  return (
    <div title={title}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Lines overlay options"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Choose which line types to overlay"
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
        zIndex={zIndex}
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
          {plans.length > 0 ? (
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
          ) : null}
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
          <div className="max-h-64 space-y-1.5 overflow-y-auto border-t border-slate-100 pt-1">
            {DRAW_COLOR_FAMILIES.map((family) => {
              const familyPresets = presetsInFamily(colorPresets, family);
              if (familyPresets.length === 0) return null;
              const state = familySelectionState(
                colorFilter,
                colorPresets,
                family,
              );
              return (
                <div key={family}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-xs text-slate-800 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={state.all}
                      ref={(element) => {
                        if (element) element.indeterminate = state.some;
                      }}
                      onChange={(event) =>
                        setFamilyTypes(family, event.target.checked)
                      }
                      className="rounded border-slate-300"
                    />
                    <span className="font-medium">
                      All {drawColorFamilyLabel(family).toLowerCase()}
                    </span>
                  </label>
                  <ul className="mt-0.5 space-y-0.5 pl-4">
                    {familyPresets.map((preset) => (
                      <li key={`${family}-${preset.color}-${preset.label}`}>
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
                          <span className="min-w-0 flex-1 truncate">
                            {preset.label}
                          </span>
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
              );
            })}
          </div>
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
  selectedRiserConnection,
  onFlipRiserDirection,
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
  showRiserLabels = true,
  onShowRiserLabelsChange,
  extendMarkupBounds = true,
  onExtendMarkupBoundsChange,
  hasOffCanvasMarkup = false,
  onFitMarkupView,
  defaultColorFamily,
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
  showCalloutTool = true,
  markupSet = 1,
  onMarkupSetChange,
  riserTypes = [],
  risers = [],
  followedRiserIds = [],
  onFollowedRiserIds,
  onFollowedRiserCompleted,
  riserInventoryOpen = false,
  onRiserInventoryOpen,
  onStandardizeOpen,
  rooms = [],
  listHoverRoomIndex = null,
  onListHoverRoomIndex,
  onRoomLabelChange,
  onRoomDelete,
  leakMaxGapPt = DEFAULT_ROOM_LEAK_MAX_GAP_PT,
  onLeakMaxGapChange,
}: {
  tool: DrawTool;
  rectangleVariant: RectangleVariant;
  circleVariant: CircleVariant;
  color: string;
  colorPresets: DrawColorPreset[];
  strokeWidthPt: number;
  annotationCount: number;
  selectedCount: number;
  selectedRiserConnection: boolean;
  onFlipRiserDirection: () => void;
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
  showRiserLabels?: boolean;
  onShowRiserLabelsChange?: (value: boolean) => void;
  extendMarkupBounds?: boolean;
  onExtendMarkupBoundsChange?: (value: boolean) => void;
  hasOffCanvasMarkup?: boolean;
  onFitMarkupView?: () => void;
  defaultColorFamily: DrawColorFamily;
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
  /** Callout labels mechanical risers from the type+number catalog. */
  showCalloutTool?: boolean;
  markupSet?: MechanicalMarkupSet;
  onMarkupSetChange?: (value: MechanicalMarkupSet) => void;
  riserTypes?: MechanicalRiserTypeDto[];
  risers?: MechanicalRiserDto[];
  followedRiserIds?: string[];
  onFollowedRiserIds?: (ids: string[]) => void;
  onFollowedRiserCompleted?: (id: string, completed: boolean) => void;
  riserInventoryOpen?: boolean;
  onRiserInventoryOpen?: (open: boolean) => void;
  onStandardizeOpen?: () => void;
  rooms?: FloorPlanRoomListEntry[];
  listHoverRoomIndex?: number | null;
  onListHoverRoomIndex?: (index: number | null) => void;
  onRoomLabelChange?: (index: number, label: string) => void;
  onRoomDelete?: (index: number) => void;
  leakMaxGapPt?: number;
  onLeakMaxGapChange?: (value: number) => void;
}) {
  const showOverlaySection = overlayPlans.length > 0 || showLineOverlay;

  return (
    <div
      className={`flex shrink-0 flex-wrap items-stretch rounded-lg border border-slate-200 bg-slate-50 ${
        trailing ? "w-full" : ""
      }`}
    >
      <RibbonSection label="Tools">
        <div
          className="flex flex-col gap-0.5 rounded-md border border-slate-200 bg-white p-0.5"
          role="group"
          aria-label="Drawing tools"
        >
          <div className="flex items-center gap-0.5">
            <ToolButton
              active={tool === "none"}
              label="Select"
              title="Select markup (V) — click a shape to highlight it, then drag to move or use arrow keys; drag a rectangle to select walls; Shift to add; Delete to remove"
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
              active={tool === "room"}
              label="Room"
              title="Room (U) — hover an enclosed area to preview it; small wall gaps glow red. Click to define a unit and type its number."
              onClick={() => onToolChange("room")}
            >
              <RoomIcon />
            </ToolButton>
            <RoomListDropdown
              rooms={rooms}
              listHoverRoomIndex={listHoverRoomIndex ?? null}
              onListHoverRoomIndex={onListHoverRoomIndex ?? (() => {})}
              onRoomLabelChange={onRoomLabelChange ?? (() => {})}
              onRoomDelete={onRoomDelete ?? (() => {})}
            />
            {tool === "room" && onLeakMaxGapChange ? (
              <label
                className="ml-0.5 flex w-[6.75rem] flex-col justify-center gap-0.5 px-1"
                title="Maximum gap treated as a leak. Doorways and large openings between structural and outer walls stay dark."
              >
                <span className="text-[10px] font-medium leading-none text-slate-500">
                  Leak {leakMaxGapPt} pt
                </span>
                <input
                  type="range"
                  min={MIN_ROOM_LEAK_MAX_GAP_PT}
                  max={MAX_ROOM_LEAK_MAX_GAP_PT}
                  step={1}
                  value={leakMaxGapPt}
                  onChange={(event) =>
                    onLeakMaxGapChange(Number(event.target.value))
                  }
                  className="h-4 w-full accent-red-600"
                  aria-label="Room leak gap threshold in PDF points"
                />
              </label>
            ) : null}
          </div>
          <div className="flex items-center gap-0.5">
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
              title="Connection (K) — click the above box (ABV), then the lower box. After the first box, click empty canvas to place an ABV copy; the arrow points at the existing (from-below) riser. Combined callouts ask which risers continue. Click the same box twice to disconnect."
              onClick={() => onToolChange("connect")}
            >
              <ConnectIcon />
            </ToolButton>
            {showCalloutTool ? (
              <ToolButton
                active={tool === "callout"}
                label="Callout"
                title="Callout (A) — click a mechanical riser box, then pick its type and number"
                onClick={() => onToolChange("callout")}
              >
                <CalloutIcon />
              </ToolButton>
            ) : null}
            <ToolButton
              active={tool === "rotate"}
              label="Rotate"
              title="Rotate (T) — click and hold a box to spin it; Shift snaps to 45°"
              onClick={() => onToolChange("rotate")}
            >
              <RotateIcon />
            </ToolButton>
          </div>
        </div>
      </RibbonSection>

      {selectedRiserConnection ? (
        <RibbonSection label="Connection">
          <button
            type="button"
            onClick={onFlipRiserDirection}
            title="Flip which box is above (ABV) vs below — reverses the arrow direction"
            className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <FlipDirectionIcon />
            Flip direction
          </button>
        </RibbonSection>
      ) : null}

      <RibbonSection label="Style">
        <ColorDropdown
          color={color}
          colorPresets={colorPresets}
          defaultFamily={defaultColorFamily}
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
            title={
              onMarkupSetChange
                ? `Clear pass ${markupSet} markup on this floor (${annotationCount}). The other pass is kept.`
                : `Clear all markup (${annotationCount})`
            }
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Clear ({annotationCount})
          </button>
        ) : null}
      </RibbonSection>

      {showCalloutTool &&
      (onMarkupSetChange || onFollowedRiserIds || onRiserInventoryOpen || onStandardizeOpen) ? (
        <RibbonSection label="Risers">
          {onMarkupSetChange ? (
            <MechanicalMarkupSetToggle
              value={markupSet}
              onChange={onMarkupSetChange}
            />
          ) : null}
          {onFollowedRiserIds ? (
            <FollowRiserControl
              riserTypes={riserTypes}
              risers={risers}
              followedRiserIds={followedRiserIds}
              onFollowedRiserIds={onFollowedRiserIds}
              onCompletedChange={onFollowedRiserCompleted}
            />
          ) : null}
          {onRiserInventoryOpen ? (
            <RiserInventoryToggle
              open={riserInventoryOpen}
              onOpenChange={onRiserInventoryOpen}
            />
          ) : null}
          {onStandardizeOpen ? (
            <StandardizeRisersToggle
              onClick={onStandardizeOpen}
            />
          ) : null}
        </RibbonSection>
      ) : null}

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
        {onExtendMarkupBoundsChange ? (
          <VisibilityToggle
            active={extendMarkupBounds}
            label="extend canvas"
            title={
              hasOffCanvasMarkup
                ? "Show saved markup outside the PDF page edge (off-canvas lines). Use Fit markup in the zoom toolbar to jump there."
                : "Expand the markup layer past the PDF page when lines are stored off-canvas"
            }
            onToggle={() => onExtendMarkupBoundsChange(!extendMarkupBounds)}
          >
            <ExtendCanvasIcon />
          </VisibilityToggle>
        ) : null}
        {hasOffCanvasMarkup && onFitMarkupView ? (
          <button
            type="button"
            onClick={onFitMarkupView}
            className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
            title="Pan and zoom to markup stored outside the PDF page"
          >
            Fit off-canvas
          </button>
        ) : null}
        {showCalloutTool ? (
          <VisibilityToggle
            active={showRiserLabels}
            label="riser labels"
            title="Show or hide mechanical riser callout labels (boxes stay visible)"
            onToggle={() => onShowRiserLabelsChange?.(!showRiserLabels)}
          >
            <CalloutIcon />
          </VisibilityToggle>
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
            {showLineOverlay ? (
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

function ExtendCanvasIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="4" y="4" width="8" height="8" strokeDasharray="2 2" />
      <path d="M1 8h2M13 8h2M8 1v2M8 13v2" />
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

function CalloutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="7" y="1.5" width="7.5" height="5" rx="0.5" />
      <path d="M8.2 6.5 4.2 10.2" />
      <rect x="1.5" y="9.5" width="5.5" height="5" rx="0.5" />
    </svg>
  );
}

function RoomIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden>
      <path d="M2.5 3.5h6.5v9H2.5z" fill="currentColor" fillOpacity="0.2" />
      <path d="M9 3.5h4.5v5H9z" fill="currentColor" fillOpacity="0.12" />
      <path d="M2.5 3.5h11v9H2.5zM9 3.5v9M9 8.5h4.5" />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M13 8A5 5 0 1 1 10.2 3.6" strokeLinecap="round" />
      <path d="M10 1.8 10.2 3.6 12 3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FlipDirectionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3 5.5h10" />
      <path d="M11 3.5 13 5.5 11 7.5" />
      <path d="M13 10.5H3" />
      <path d="M5 8.5 3 10.5 5 12.5" />
    </svg>
  );
}

function ListPanelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M6.5 2v12" />
      <path d="M8.5 5.5h3.5M8.5 8h3.5M8.5 10.5h2.5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3.5 4.5h9" strokeLinecap="round" />
      <path d="M6 4.5V3.25h4V4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 4.5 5.5 12.5h5L11 4.5" strokeLinejoin="round" />
    </svg>
  );
}
