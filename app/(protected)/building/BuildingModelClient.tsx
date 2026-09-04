"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { EquipmentLegend } from "@/components/building/EquipmentLegend";
import { FloorPlanExpandIcon } from "@/components/building/FloorPlanCropEditor";
import type { BuildingStructureOptions } from "@/components/building/BuildingShell";
import type {
  BuildingGeometryModel,
  UnitDescriptor,
} from "@/lib/building/building-geometry";
import type {
  BuildingRiserGeometryModel,
  RiserDescriptor,
  TerminalEquipmentDescriptor,
} from "@/lib/building/riser-geometry";
import {
  ALL_EQUIPMENT_CATEGORIES,
  type EquipmentCategory,
  type EquipmentItem,
} from "@/lib/building/fixtures";
import type { RegistryMapItem } from "@/lib/building/equipment-registry";

const BuildingScene = dynamic(
  () =>
    import("@/components/building/BuildingScene").then(
      (mod) => mod.BuildingScene,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-slate-900 text-sm text-slate-400">
        Loading 3D view…
      </div>
    ),
  },
);

function registryItemsToEquipment(items: RegistryMapItem[]): EquipmentItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    floor: item.floor,
    position: item.position,
  }));
}

function formatFloorDisplay(floorNumber: number): string {
  if (floorNumber < 0) return `P${Math.abs(floorNumber)}`;
  if (floorNumber === 0) return "Ground";
  return `Floor ${floorNumber}`;
}

type QuickPreset =
  | "reset"
  | "mechanical-only"
  | "only-hc"
  | "only-sanitary"
  | "floors-8-10"
  | "structure-only";

/** Shell opacity applied when any unit is highlighted so the unit reads clearly. */
const UNIT_FOCUS_SHELL_OPACITY = 0.05;

type QuickPresetBarProps = {
  activePreset: QuickPreset | null;
  onSelectPreset: (preset: QuickPreset) => void;
};

function QuickPresetBar({ activePreset, onSelectPreset }: QuickPresetBarProps) {
  const presets: { id: QuickPreset; label: string; icon: string; title: string }[] = [
    { id: "reset", label: "Reset Full", icon: "🔄", title: "Show full building with all systems at standard opacity" },
    { id: "mechanical-only", label: "Mechanical Only", icon: "🚰", title: "Hide all walls & slabs to isolate the 3D piping network" },
    { id: "only-hc", label: "Only HC", icon: "❄️", title: "Isolate Heating & Cooling risers with ghosted structure" },
    { id: "only-sanitary", label: "Sanitary & Laundry", icon: "🚽", title: "Isolate Sanitary & Laundry drainage risers" },
    { id: "floors-8-10", label: "Floors 8–10", icon: "🏢", title: "Isolate structural plate & risers on Floors 8 to 10" },
    { id: "structure-only", label: "Structure Only", icon: "🏛️", title: "Show only building shell (slabs & walls) without risers" },
  ];

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Quick View Presets
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {presets.map((p) => {
          const isActive = activePreset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectPreset(p.id)}
              title={p.title}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-[11px] font-medium transition ${
                isActive
                  ? "border-sky-500 bg-sky-50 text-sky-900 shadow-2xs"
                  : "border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-slate-100"
              }`}
            >
              <span>{p.icon}</span>
              <span className="truncate">{p.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type StructureControlsProps = {
  visible: boolean;
  showSlabs: boolean;
  showWalls: boolean;
  slabOpacity: number;
  wallOpacity: number;
  onToggleVisible: () => void;
  onToggleSlabs: () => void;
  onToggleWalls: () => void;
  onChangeSlabOpacity: (val: number) => void;
  onChangeWallOpacity: (val: number) => void;
  highlightedUnitCount?: number;
  onClearHighlightedUnits?: () => void;
  onSwitchToUnitsTab?: () => void;
};

function StructureControls({
  visible,
  showSlabs,
  showWalls,
  slabOpacity,
  wallOpacity,
  onToggleVisible,
  onToggleSlabs,
  onToggleWalls,
  onChangeSlabOpacity,
  onChangeWallOpacity,
  highlightedUnitCount = 0,
  onClearHighlightedUnits,
  onSwitchToUnitsTab,
}: StructureControlsProps) {
  return (
    <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
      <div className="flex items-center justify-between border-b border-slate-200/80 pb-1.5">
        <label className="flex items-center gap-2 font-medium text-slate-800 cursor-pointer text-xs">
          <input
            type="checkbox"
            checked={visible}
            onChange={onToggleVisible}
            className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
          <span>Structure Shell</span>
        </label>
        <span className="text-[10px] text-slate-500">
          {visible ? "Walls & Slabs" : "Hidden"}
        </span>
      </div>

      {visible ? (
        <div className="space-y-2 text-xs">
          {/* Active Highlight Banner */}
          {highlightedUnitCount > 0 ? (
            <div className="flex items-center justify-between rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] text-sky-900">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500 animate-pulse" />
                <span className="font-medium truncate">
                  {highlightedUnitCount} unit{highlightedUnitCount > 1 ? "s" : ""} highlighted (opaque)
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {onSwitchToUnitsTab ? (
                  <button
                    type="button"
                    onClick={onSwitchToUnitsTab}
                    className="text-[10px] font-semibold text-sky-700 hover:text-sky-900 hover:underline"
                  >
                    View
                  </button>
                ) : null}
                {onClearHighlightedUnits ? (
                  <button
                    type="button"
                    onClick={onClearHighlightedUnits}
                    className="text-[10px] font-semibold text-slate-500 hover:text-slate-700"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Wall controls */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-slate-700 cursor-pointer text-[11px]">
                <input
                  type="checkbox"
                  checked={showWalls}
                  onChange={onToggleWalls}
                  className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span>Walls</span>
              </label>
              <span className="tabular-nums font-mono text-[10px] text-slate-600">
                {showWalls ? `${Math.round(wallOpacity * 100)}%` : "Off"}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={showWalls ? wallOpacity : 0}
              disabled={!showWalls}
              onChange={(e) => onChangeWallOpacity(Number.parseFloat(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-sky-600 disabled:opacity-30"
              title={
                highlightedUnitCount > 0
                  ? "Adjust opacity for walls not touching highlighted units"
                  : "Adjust wall transparency to see pipes in cavities"
              }
            />
            {highlightedUnitCount > 0 && showWalls ? (
              <p className="text-[10px] text-slate-500 italic">
                Touching walls stay 100% opaque
              </p>
            ) : null}
          </div>

          {/* Slab controls */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-slate-700 cursor-pointer text-[11px]">
                <input
                  type="checkbox"
                  checked={showSlabs}
                  onChange={onToggleSlabs}
                  className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span>Floor Slabs</span>
              </label>
              <span className="tabular-nums font-mono text-[10px] text-slate-600">
                {showSlabs ? `${Math.round(slabOpacity * 100)}%` : "Off"}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={showSlabs ? slabOpacity : 0}
              disabled={!showSlabs}
              onChange={(e) => onChangeSlabOpacity(Number.parseFloat(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-sky-600 disabled:opacity-30"
              title="Adjust slab thickness and opacity"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

type UnitSearchControlsProps = {
  units: UnitDescriptor[];
  highlightedUnitIds: Set<string>;
  onToggleUnit: (unitId: string) => void;
  onHighlightAll: (unitIds: string[]) => void;
  onClearAll: () => void;
  visibleFloors?: Set<number>;
};

function UnitSearchControls({
  units,
  highlightedUnitIds,
  onToggleUnit,
  onHighlightAll,
  onClearAll,
  visibleFloors,
}: UnitSearchControlsProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterFloor, setFilterFloor] = useState<number | "all">("all");

  // Deduplicate units by unitId (units spanning multiple room polygons share the same unitId)
  const uniqueUnits = useMemo(() => {
    const map = new Map<string, UnitDescriptor>();
    for (const u of units) {
      if (!map.has(u.unitId)) {
        map.set(u.unitId, u);
      }
    }
    return Array.from(map.values());
  }, [units]);

  // Filter units by search query and optional floor filter
  const filteredUnits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return uniqueUnits.filter((u) => {
      if (filterFloor !== "all" && u.floorNumber !== filterFloor) return false;
      if (visibleFloors != null && !visibleFloors.has(u.floorNumber)) return false;
      if (!q) return true;
      return (
        u.label.toLowerCase().includes(q) ||
        `unit ${u.label}`.toLowerCase().includes(q) ||
        `floor ${u.floorNumber}`.toLowerCase().includes(q)
      );
    });
  }, [uniqueUnits, searchQuery, filterFloor, visibleFloors]);

  // Unique floors available in units
  const availableFloors = useMemo(() => {
    return [...new Set(uniqueUnits.map((u) => u.floorNumber))].sort((a, b) => a - b);
  }, [uniqueUnits]);

  // Currently highlighted unit objects
  const highlightedUnits = useMemo(() => {
    return uniqueUnits.filter((u) => highlightedUnitIds.has(u.unitId));
  }, [uniqueUnits, highlightedUnitIds]);

  return (
    <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
      <div className="flex items-center justify-between border-b border-slate-200/80 pb-1.5">
        <span className="font-semibold text-slate-800 text-xs">
          Unit Highlighting
        </span>
        <span className="text-[10px] text-slate-500">
          Solid walls &amp; floor
        </span>
      </div>

      {/* Search Input */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search unit number (e.g. 101, 204)..."
          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 pr-7 text-xs text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        {searchQuery ? (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
            title="Clear search"
          >
            ✕
          </button>
        ) : null}
      </div>

      {/* Floor quick-filter buttons if multiple floors */}
      {availableFloors.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setFilterFloor("all")}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition cursor-pointer ${
              filterFloor === "all"
                ? "bg-slate-800 text-white"
                : "bg-slate-200/70 text-slate-700 hover:bg-slate-300/70"
            }`}
          >
            All Floors
          </button>
          {availableFloors.map((fl) => (
            <button
              key={fl}
              type="button"
              onClick={() => setFilterFloor(fl)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition cursor-pointer ${
                filterFloor === fl
                  ? "bg-sky-600 text-white"
                  : "bg-slate-200/70 text-slate-700 hover:bg-slate-300/70"
              }`}
            >
              Floor {fl}
            </button>
          ))}
        </div>
      ) : null}

      {/* Header with stats and bulk actions */}
      <div className="flex items-center justify-between text-[11px] text-slate-600 border-b border-slate-200/80 pb-1">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-800">
            {filteredUnits.length}
          </span>
          <span>{filteredUnits.length === 1 ? "unit" : "units"}</span>
          {highlightedUnitIds.size > 0 ? (
            <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
              {highlightedUnitIds.size} highlighted
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {filteredUnits.length > 0 &&
          filteredUnits.some((u) => !highlightedUnitIds.has(u.unitId)) ? (
            <button
              type="button"
              onClick={() =>
                onHighlightAll(filteredUnits.map((u) => u.unitId))
              }
              className="text-[10px] font-semibold text-sky-600 hover:text-sky-800 cursor-pointer"
            >
              Highlight all
            </button>
          ) : null}

          {highlightedUnitIds.size > 0 ? (
            <button
              type="button"
              onClick={onClearAll}
              className="text-[10px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Clear all
            </button>
          ) : null}
        </div>
      </div>

      {/* Active Highlight Chips */}
      {highlightedUnits.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Active Highlights (Solid walls &amp; floor)
          </div>
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
            {highlightedUnits.map((u) => (
              <span
                key={`chip-${u.unitId}`}
                className="inline-flex items-center gap-1 rounded bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-[11px] font-medium text-sky-900"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: u.color }}
                />
                <span>Unit {u.label}</span>
                <button
                  type="button"
                  onClick={() => onToggleUnit(u.unitId)}
                  className="text-sky-400 hover:text-sky-700 ml-0.5 cursor-pointer font-bold"
                  title="Remove highlight"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Unit List */}
      <div className="max-h-56 overflow-y-auto space-y-1 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white p-1">
        {filteredUnits.length === 0 ? (
          <div className="p-3 text-center text-xs text-slate-500">
            {uniqueUnits.length === 0
              ? "No units modeled in building."
              : "No units found matching search."}
          </div>
        ) : (
          filteredUnits.map((u) => {
            const isHighlighted = highlightedUnitIds.has(u.unitId);
            return (
              <div
                key={u.unitId}
                onClick={() => onToggleUnit(u.unitId)}
                className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition text-xs ${
                  isHighlighted
                    ? "bg-sky-50/80 text-sky-950 font-medium"
                    : "hover:bg-slate-50 text-slate-700"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={isHighlighted}
                    onChange={() => {}} // handled by parent onClick
                    className="rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
                  />
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: u.color }}
                  />
                  <span className="font-semibold truncate">
                    Unit {u.label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                    Floor {u.floorNumber}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="text-[10px] text-slate-500 leading-relaxed">
        Toggled units and their touching walls render 100% opaque. All other walls follow the Structure Shell wall transparency slider.
      </p>
    </div>
  );
}

type FloorFilterMode = "all" | "range" | "single";

type FloorFilterControlsProps = {
  allFloors: number[];
  mode: FloorFilterMode;
  rangeMin: number;
  rangeMax: number;
  singleFloor: number;
  onChangeMode: (mode: FloorFilterMode) => void;
  onChangeRangeMin: (val: number) => void;
  onChangeRangeMax: (val: number) => void;
  onChangeSingleFloor: (val: number) => void;
  onQuickRange: (min: number, max: number) => void;
};

function FloorFilterControls({
  allFloors,
  mode,
  rangeMin,
  rangeMax,
  singleFloor,
  onChangeMode,
  onChangeRangeMin,
  onChangeRangeMax,
  onChangeSingleFloor,
  onQuickRange,
}: FloorFilterControlsProps) {
  const minAvail = allFloors.length > 0 ? allFloors[0]! : 1;
  const maxAvail = allFloors.length > 0 ? allFloors[allFloors.length - 1]! : 32;

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 text-xs">
      <div className="flex items-center justify-between border-b border-slate-200/80 pb-1.5">
        <span className="font-medium text-slate-800">Floor Isolation</span>
        <div className="flex gap-1 text-[10px]">
          <button
            type="button"
            onClick={() => onChangeMode("all")}
            className={`rounded px-1.5 py-0.5 font-medium transition ${
              mode === "all"
                ? "bg-sky-600 text-white"
                : "bg-slate-200 text-slate-700 hover:bg-slate-300"
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onChangeMode("range")}
            className={`rounded px-1.5 py-0.5 font-medium transition ${
              mode === "range"
                ? "bg-sky-600 text-white"
                : "bg-slate-200 text-slate-700 hover:bg-slate-300"
            }`}
          >
            Range
          </button>
          <button
            type="button"
            onClick={() => onChangeMode("single")}
            className={`rounded px-1.5 py-0.5 font-medium transition ${
              mode === "single"
                ? "bg-sky-600 text-white"
                : "bg-slate-200 text-slate-700 hover:bg-slate-300"
            }`}
          >
            Single
          </button>
        </div>
      </div>

      {mode === "range" ? (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-[11px] text-slate-700 font-medium">
            <span>Range:</span>
            <span className="font-mono text-sky-700">
              {formatFloorDisplay(rangeMin)} → {formatFloorDisplay(rangeMax)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-500">From Floor</label>
              <select
                value={rangeMin}
                onChange={(e) => onChangeRangeMin(Number.parseInt(e.target.value, 10))}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
              >
                {allFloors.map((f) => (
                  <option key={f} value={f}>
                    {formatFloorDisplay(f)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500">To Floor</label>
              <select
                value={rangeMax}
                onChange={(e) => onChangeRangeMax(Number.parseInt(e.target.value, 10))}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
              >
                {allFloors.map((f) => (
                  <option key={f} value={f}>
                    {formatFloorDisplay(f)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-1 pt-1">
            <button
              type="button"
              onClick={() => onQuickRange(minAvail, 0)}
              className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-300"
            >
              Basement
            </button>
            <button
              type="button"
              onClick={() => onQuickRange(1, 7)}
              className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-300"
            >
              Podium (1–7)
            </button>
            <button
              type="button"
              onClick={() => onQuickRange(8, 24)}
              className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-300"
            >
              Tower (8–24)
            </button>
            <button
              type="button"
              onClick={() => onQuickRange(25, maxAvail)}
              className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-300"
            >
              Upper (25–{maxAvail})
            </button>
          </div>
        </div>
      ) : null}

      {mode === "single" ? (
        <div className="space-y-1.5 pt-1">
          <label className="block text-[11px] font-medium text-slate-700">
            Select Level
          </label>
          <select
            value={singleFloor}
            onChange={(e) => onChangeSingleFloor(Number.parseInt(e.target.value, 10))}
            className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            {allFloors.map((f) => (
              <option key={f} value={f}>
                {formatFloorDisplay(f)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {mode === "all" ? (
        <div className="text-[11px] text-slate-500">
          Showing all {allFloors.length} levels. Switch to Range or Single to isolate specific plates.
        </div>
      ) : null}
    </div>
  );
}

function RiserEyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 2l12 12M6.2 6.7C5.8 7.1 5.5 7.7 5.5 8c0 1.4 1.1 2.5 2.5 2.5.3 0 .9-.3 1.3-.7M11.1 11.1C10.1 11.8 9.1 12.2 8 12.2 4.5 12.2 2 8 2 8c.7-1.2 1.7-2.3 2.9-3.1M9.5 4.8C9 4.6 8.5 4.5 8 4.5 6.6 4.5 5.5 5.6 5.5 7c0 .5.1 1 .3 1.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

type RiserControlsProps = {
  enabled: boolean;
  opacity: number;
  showEquipment: boolean;
  systemTypes: BuildingRiserGeometryModel["systemTypes"];
  risers: RiserDescriptor[];
  visibleRiserIds: Set<string>;
  highlightedRiserIds: Set<string>;
  totalRiserCount: number;
  totalLengthM: number;
  onToggleEnabled: () => void;
  onChangeOpacity: (opacity: number) => void;
  onToggleShowEquipment: () => void;
  onToggleRiserVisibility: (riserId: string) => void;
  onToggleRiserHighlight: (riser: RiserDescriptor) => void;
  onToggleSystemVisibility: (typeId: string) => void;
  onSelectAllRisers: () => void;
  onDeselectAllRisers: () => void;
};

function RiserControls({
  enabled,
  opacity,
  showEquipment,
  systemTypes,
  risers,
  visibleRiserIds,
  highlightedRiserIds,
  totalRiserCount,
  totalLengthM,
  onToggleEnabled,
  onChangeOpacity,
  onToggleShowEquipment,
  onToggleRiserVisibility,
  onToggleRiserHighlight,
  onToggleSystemVisibility,
  onSelectAllRisers,
  onDeselectAllRisers,
}: RiserControlsProps) {
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(() => new Set());
  const [showFocusedOnly, setShowFocusedOnly] = useState(false);
  const [showVisibleOnly, setShowVisibleOnly] = useState(false);

  const risersByType = useMemo(() => {
    const map = new Map<string, RiserDescriptor[]>();
    for (const riser of risers) {
      const list = map.get(riser.typeId) ?? [];
      list.push(riser);
      map.set(riser.typeId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true }),
      );
    }
    return map;
  }, [risers]);

  const visibleRiserCount = risers.filter((riser) =>
    visibleRiserIds.has(riser.riserId),
  ).length;
  const activeSystemsCount = systemTypes.filter((sys) => {
    const group = risersByType.get(sys.id) ?? [];
    return group.some((riser) => visibleRiserIds.has(riser.riserId));
  }).length;
  const focusedRiserCount = highlightedRiserIds.size;
  const listFilterActive = showFocusedOnly || showVisibleOnly;

  const riserMatchesListFilter = useCallback(
    (riser: RiserDescriptor) => {
      if (showFocusedOnly && !highlightedRiserIds.has(riser.riserId)) {
        return false;
      }
      if (showVisibleOnly && !visibleRiserIds.has(riser.riserId)) {
        return false;
      }
      return true;
    },
    [showFocusedOnly, showVisibleOnly, highlightedRiserIds, visibleRiserIds],
  );

  const filteredSystemTypes = useMemo(() => {
    if (!listFilterActive) return systemTypes;
    return systemTypes.filter((sys) => {
      const groupRisers = risersByType.get(sys.id) ?? [];
      return groupRisers.some(riserMatchesListFilter);
    });
  }, [listFilterActive, systemTypes, risersByType, riserMatchesListFilter]);

  const toggleExpanded = (typeId: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(typeId)) {
        next.delete(typeId);
      } else {
        next.add(typeId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 text-xs">
      {/* Header and Toggle */}
      <div className="flex items-center justify-between border-b border-slate-200/80 pb-1.5">
        <label className="flex items-center gap-2 font-medium text-slate-800 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={onToggleEnabled}
            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span>3D Mechanical Risers</span>
        </label>
        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
          {enabled
            ? `${activeSystemsCount}/${systemTypes.length} sys · ${visibleRiserCount}/${totalRiserCount} pipes`
            : "Off"}
        </span>
      </div>

      {enabled ? (
        <div className="space-y-3">
          {/* Opacity Slider */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-slate-600">
              <label htmlFor="riser-opacity-slider" className="text-[11px] font-medium text-slate-700">
                Pipe Opacity
              </label>
              <span className="tabular-nums font-mono text-[10px] font-medium text-slate-800">
                {Math.round(opacity * 100)}%
              </span>
            </div>
            <input
              id="riser-opacity-slider"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => onChangeOpacity(Number.parseFloat(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-emerald-600"
            />
          </div>

          {/* Terminal Equipment Toggle */}
          <div className="flex items-center justify-between text-slate-700">
            <label htmlFor="riser-terminal-equipment" className="text-[11px] font-medium cursor-pointer">
              Terminal Equipment
            </label>
            <input
              id="riser-terminal-equipment"
              type="checkbox"
              checked={showEquipment}
              onChange={onToggleShowEquipment}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
          </div>

          {/* System Layers */}
          <div className="border-t border-slate-200/80 pt-2">
            <div className="flex items-center justify-between pb-1.5">
              <span className="text-[11px] font-medium text-slate-700">
                System Layers ({totalLengthM.toFixed(0)}m)
              </span>
              <div className="flex gap-2 text-[10px]">
                <button
                  type="button"
                  onClick={onSelectAllRisers}
                  className="font-medium text-emerald-600 hover:text-emerald-700"
                >
                  All
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={onDeselectAllRisers}
                  className="font-medium text-slate-500 hover:text-slate-700"
                >
                  None
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 pb-1.5">
              <button
                type="button"
                onClick={() => setShowFocusedOnly((value) => !value)}
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition ${
                  showFocusedOnly
                    ? "border-sky-300 bg-sky-50 text-sky-800"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                aria-pressed={showFocusedOnly}
                title="Show only focused risers in the list"
              >
                <RiserEyeIcon open={showFocusedOnly} />
                Focused
                <span
                  className={`rounded-full px-1 tabular-nums ${
                    showFocusedOnly ? "bg-sky-100" : "bg-slate-100"
                  }`}
                >
                  {focusedRiserCount}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setShowVisibleOnly((value) => !value)}
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition ${
                  showVisibleOnly
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                aria-pressed={showVisibleOnly}
                title="Show only visible (checked) risers in the list"
              >
                <span className="text-[9px] leading-none">✓</span>
                Visible
                <span
                  className={`rounded-full px-1 tabular-nums ${
                    showVisibleOnly ? "bg-emerald-100" : "bg-slate-100"
                  }`}
                >
                  {visibleRiserCount}
                </span>
              </button>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-0.5 pr-1">
              {filteredSystemTypes.length === 0 ? (
                <p className="px-1 py-2 text-[10px] text-slate-500">
                  {showFocusedOnly && focusedRiserCount === 0
                    ? "No risers are focused. Click a pipe or use an eye icon to focus one."
                    : "No risers match the current list filters."}
                </p>
              ) : null}
              {filteredSystemTypes.map((sys) => {
                const groupRisers = risersByType.get(sys.id) ?? [];
                const filteredGroupRisers = listFilterActive
                  ? groupRisers.filter(riserMatchesListFilter)
                  : groupRisers;
                const visibleInGroup = groupRisers.filter((riser) =>
                  visibleRiserIds.has(riser.riserId),
                ).length;
                const focusedInGroup = groupRisers.filter((riser) =>
                  highlightedRiserIds.has(riser.riserId),
                ).length;
                const allVisible =
                  groupRisers.length > 0 && visibleInGroup === groupRisers.length;
                const noneVisible = visibleInGroup === 0;
                const isExpanded =
                  expandedTypes.has(sys.id) ||
                  (listFilterActive && filteredGroupRisers.length > 0);

                return (
                  <div key={sys.id} className="rounded-md">
                    <div
                      className={`flex items-center gap-1 rounded-md px-1 py-1 text-[11px] transition select-none ${
                        visibleInGroup > 0
                          ? "bg-white text-slate-900 shadow-2xs"
                          : "text-slate-500"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleExpanded(sys.id)}
                        className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? `Collapse ${sys.name}` : `Expand ${sys.name}`}
                      >
                        <span
                          className={`inline-block text-[10px] transition-transform ${
                            isExpanded ? "rotate-90" : ""
                          }`}
                        >
                          ▶
                        </span>
                      </button>
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={allVisible}
                          ref={(input) => {
                            if (input) {
                              input.indeterminate = !allVisible && !noneVisible;
                            }
                          }}
                          onChange={() => onToggleSystemVisibility(sys.id)}
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/10 shadow-2xs"
                          style={{ backgroundColor: sys.color }}
                        />
                        <span className="truncate font-medium">{sys.name}</span>
                      </label>
                      <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                        {listFilterActive
                          ? `${filteredGroupRisers.length}/${groupRisers.length}`
                          : `${visibleInGroup}/${groupRisers.length}`}
                        {focusedInGroup > 0 ? (
                          <span className="ml-1 text-sky-600">· {focusedInGroup} focused</span>
                        ) : null}
                      </span>
                    </div>

                    {isExpanded ? (
                      <div className="ml-5 space-y-0.5 border-l border-slate-200 pl-2 pb-1">
                        {(listFilterActive ? filteredGroupRisers : groupRisers).map((riser) => {
                          const isVisible = visibleRiserIds.has(riser.riserId);
                          const isHighlighted = highlightedRiserIds.has(riser.riserId);
                          return (
                            <div
                              key={riser.riserId}
                              className={`flex items-center gap-1 rounded px-1 py-0.5 text-[10px] ${
                                isHighlighted
                                  ? "bg-sky-50 text-sky-900"
                                  : isVisible
                                    ? "text-slate-700"
                                    : "text-slate-400"
                              }`}
                            >
                              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={isVisible}
                                  onChange={() => onToggleRiserVisibility(riser.riserId)}
                                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className="truncate" title={riser.label}>
                                  {riser.label}
                                </span>
                              </label>
                              <button
                                type="button"
                                onClick={() => onToggleRiserHighlight(riser)}
                                className={`shrink-0 rounded p-0.5 transition ${
                                  isHighlighted
                                    ? "text-sky-600 hover:bg-sky-100"
                                    : "text-slate-300 hover:bg-slate-100 hover:text-slate-500"
                                }`}
                                title={
                                  isHighlighted
                                    ? "Stop highlighting this riser"
                                    : "Highlight this riser and dim others"
                                }
                                aria-label={
                                  isHighlighted
                                    ? `Stop highlighting ${riser.label}`
                                    : `Highlight ${riser.label}`
                                }
                                aria-pressed={isHighlighted}
                              >
                                <RiserEyeIcon open={isHighlighted} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type BlueprintControlsProps = {
  enabled: boolean;
  opacity: number;
  levels: BuildingGeometryModel["levels"];
  visibleFloors: Set<number>;
  onToggleEnabled: () => void;
  onChangeOpacity: (opacity: number) => void;
  onToggleFloor: (floorNumber: number) => void;
  onSelectAllFloors: () => void;
  onDeselectAllFloors: () => void;
};

function BlueprintOverlayControls({
  enabled,
  opacity,
  levels,
  visibleFloors,
  onToggleEnabled,
  onChangeOpacity,
  onToggleFloor,
  onSelectAllFloors,
  onDeselectAllFloors,
}: BlueprintControlsProps) {
  const sortedLevels = useMemo(
    () => [...levels].sort((a, b) => b.floorNumber - a.floorNumber),
    [levels],
  );
  const [levelQuery, setLevelQuery] = useState("");
  const visibleCount = levels.filter((l) => visibleFloors.has(l.floorNumber)).length;

  const filteredLevels = useMemo(() => {
    const query = levelQuery.trim().toLowerCase();
    if (!query) return sortedLevels;
    return sortedLevels.filter((lvl) => {
      const floorNumber = String(lvl.floorNumber);
      return (
        floorNumber.includes(query) ||
        (lvl.planName ?? "").toLowerCase().includes(query)
      );
    });
  }, [levelQuery, sortedLevels]);

  return (
    <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 text-xs">
      <div className="flex items-center justify-between border-b border-slate-200/80 pb-1.5">
        <label className="flex items-center gap-2 font-medium text-slate-800 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={onToggleEnabled}
            className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
          <span>2D Blueprint Textures</span>
        </label>
        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
          {enabled ? `${visibleCount}/${levels.length}` : "Off"}
        </span>
      </div>

      {enabled ? (
        <div className="space-y-2.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-slate-600">
              <label htmlFor="blueprint-opacity-slider" className="text-[11px] font-medium text-slate-700">
                Blueprint Opacity
              </label>
              <span className="tabular-nums font-mono text-[10px] font-medium text-slate-800">
                {Math.round(opacity * 100)}%
              </span>
            </div>
            <input
              id="blueprint-opacity-slider"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => onChangeOpacity(Number.parseFloat(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-sky-600"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between pb-1">
              <span className="text-[11px] font-medium text-slate-700">Slab Overlays</span>
              <div className="flex gap-2 text-[10px]">
                <button
                  type="button"
                  onClick={onSelectAllFloors}
                  className="font-medium text-sky-600 hover:text-sky-700"
                >
                  All
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={onDeselectAllFloors}
                  className="font-medium text-slate-500 hover:text-slate-700"
                >
                  None
                </button>
              </div>
            </div>

            <input
              type="text"
              value={levelQuery}
              onChange={(e) => setLevelQuery(e.target.value)}
              placeholder="Filter levels (e.g. 2, Tower)…"
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
            />

            <div className="max-h-28 overflow-y-auto space-y-1 pr-1 pt-1">
              {filteredLevels.map((lvl) => {
                const isChecked = visibleFloors.has(lvl.floorNumber);
                return (
                  <label
                    key={lvl.planId}
                    className={`flex items-center gap-2 rounded px-2 py-0.5 text-[11px] transition cursor-pointer select-none ${
                      isChecked
                        ? "bg-sky-100 text-sky-900 font-medium"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggleFloor(lvl.floorNumber)}
                      className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span className="flex-1 truncate">
                      {formatFloorDisplay(lvl.floorNumber)}
                    </span>
                    <span className="tabular-nums font-mono text-[10px] text-slate-400">
                      {lvl.elevationM.toFixed(1)}m
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type InspectorModalCardProps = {
  riser: RiserDescriptor | null;
  selectedRiserCount?: number;
  equipment: TerminalEquipmentDescriptor | null;
  onClear: () => void;
  onIsolateRiser: (riser: RiserDescriptor) => void;
  onFilterToFloors: (minFloor: number, maxFloor: number) => void;
};

function InspectorModalCard({
  riser,
  selectedRiserCount = 0,
  equipment,
  onClear,
  onIsolateRiser,
  onFilterToFloors,
}: InspectorModalCardProps) {
  if (!riser && !equipment) return null;

  const title = riser
    ? `${riser.systemName} ${riser.label}`
    : equipment?.label ?? "Equipment";
  const systemColor = riser?.systemColor ?? equipment?.systemColor ?? "#38bdf8";

  return (
    <div className="pointer-events-auto w-84 rounded-xl border-2 border-sky-400/80 bg-white/95 p-3 text-xs shadow-2xl backdrop-blur-md transition">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-3 w-3 rounded-full border border-black/20 shrink-0 shadow-xs"
            style={{ backgroundColor: systemColor }}
          />
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900 truncate text-sm">
              {title}
            </h3>
            <p className="text-[10px] text-slate-500">
              {selectedRiserCount > 1
                ? `${selectedRiserCount} risers highlighted · click a pipe or eye icon to toggle`
                : "Click a pipe or eye icon to highlight · expand system layers for per-riser controls"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {riser?.completed ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
              Completed
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
              In progress
            </span>
          )}
          <button
            type="button"
            onClick={onClear}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Close inspection card"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Equipment Specifics if selected */}
      {equipment ? (
        <div className="mt-2 rounded-lg bg-sky-50/70 p-2 text-slate-800 border border-sky-100">
          <div className="font-semibold text-sky-900 text-[11px]">
            Terminal Unit: {equipment.label}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] text-slate-600">
            <div>
              <span className="text-slate-400">Geometry:</span> {equipment.kind}
            </div>
            <div>
              <span className="text-slate-400">Position:</span> (
              {equipment.position[0].toFixed(1)}, {equipment.position[1].toFixed(1)},{" "}
              {equipment.position[2].toFixed(1)})
            </div>
          </div>
        </div>
      ) : null}

      {/* Riser Metadata Grid */}
      {riser ? (
        <div className="mt-2.5 space-y-2.5">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-slate-50 p-1.5 border border-slate-100">
              <span className="block text-[10px] text-slate-400">Nominal Diameter</span>
              <span className="font-semibold text-slate-800">
                {(riser.pipeRadius * 2000).toFixed(0)} mm
              </span>
            </div>
            <div className="rounded-lg bg-slate-50 p-1.5 border border-slate-100">
              <span className="block text-[10px] text-slate-400">Total Run Length</span>
              <span className="font-semibold text-slate-800">
                {riser.totalLengthM.toFixed(1)} m
              </span>
            </div>
            <div className="rounded-lg bg-slate-50 p-1.5 border border-slate-100">
              <span className="block text-[10px] text-slate-400">Elevation Run</span>
              <span className="font-semibold text-slate-800 truncate" title={`${riser.bottomTerminal[1].toFixed(1)}m to ${riser.topTerminal[1].toFixed(1)}m`}>
                {riser.bottomTerminal[1].toFixed(1)}m → {riser.topTerminal[1].toFixed(1)}m
              </span>
            </div>
            <div className="rounded-lg bg-slate-50 p-1.5 border border-slate-100">
              <span className="block text-[10px] text-slate-400">Spanned Floors</span>
              <span className="font-semibold text-slate-800">
                {formatFloorDisplay(riser.minFloor)} → {formatFloorDisplay(riser.maxFloor)}
              </span>
            </div>
          </div>

          {/* Connected floors tag list */}
          {riser.connectedFloors && riser.connectedFloors.length > 0 ? (
            <div>
              <span className="block text-[10px] font-medium text-slate-500 pb-1">
                Connected Levels ({riser.connectedFloors.length} plates)
              </span>
              <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto pr-1">
                {riser.connectedFloors.map((f) => (
                  <span
                    key={f}
                    className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-mono text-sky-800 border border-sky-200"
                  >
                    {formatFloorDisplay(f)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 pt-1 border-t border-slate-100">
            <button
              type="button"
              onClick={() => onIsolateRiser(riser)}
              className="flex-1 rounded-lg bg-sky-600 px-2 py-1.5 text-center text-[11px] font-medium text-white shadow-xs hover:bg-sky-500"
            >
              Isolate Riser Run
            </button>
            <button
              type="button"
              onClick={() => onFilterToFloors(riser.minFloor, riser.maxFloor)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              title="Filter floor isolation to this riser's floors"
            >
              Filter Floors
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function BuildingModelClient({
  registryMapItems = [],
  structure,
  risers,
}: {
  registryMapItems?: RegistryMapItem[];
  structure?: BuildingGeometryModel;
  risers?: BuildingRiserGeometryModel;
}) {
  const [visibleCategories, setVisibleCategories] = useState<
    Set<EquipmentCategory>
  >(() => new Set(ALL_EQUIPMENT_CATEGORIES));

  // Structure Visibility & Opacity (Phase 3)
  const [structureVisible, setStructureVisible] = useState(true);
  const [showSlabs, setShowSlabs] = useState(true);
  const [showWalls, setShowWalls] = useState(true);
  const [slabOpacity, setSlabOpacity] = useState(0.38);
  const [wallOpacity, setWallOpacity] = useState(0.42);

  // Floor Isolation (Phase 3)
  const allFloorNumbers = useMemo(
    () => structure?.levels.map((l) => l.floorNumber).sort((a, b) => a - b) ?? [],
    [structure],
  );
  const minBuildingFloor = allFloorNumbers.length > 0 ? allFloorNumbers[0]! : 1;
  const maxBuildingFloor =
    allFloorNumbers.length > 0 ? allFloorNumbers[allFloorNumbers.length - 1]! : 32;

  const [floorFilterMode, setFloorFilterMode] = useState<FloorFilterMode>("all");
  const [floorRangeMin, setFloorRangeMin] = useState(minBuildingFloor);
  const [floorRangeMax, setFloorRangeMax] = useState(maxBuildingFloor);
  const [singleFloor, setSingleFloor] = useState(1);

  // Derived visible floors set
  const visibleFloors = useMemo<Set<number> | undefined>(() => {
    if (floorFilterMode === "all") return undefined;
    if (floorFilterMode === "single") return new Set([singleFloor]);
    return new Set(
      allFloorNumbers.filter((f) => f >= floorRangeMin && f <= floorRangeMax),
    );
  }, [floorFilterMode, singleFloor, floorRangeMin, floorRangeMax, allFloorNumbers]);

  // 2D Blueprints
  const [blueprintEnabled, setBlueprintEnabled] = useState(false);
  const [blueprintOpacity, setBlueprintOpacity] = useState(0.75);
  const [visibleBlueprintFloors, setVisibleBlueprintFloors] = useState<Set<number>>(
    () => new Set(),
  );

  useEffect(() => {
    if (!structure?.levels) return;
    setVisibleBlueprintFloors((prev) => {
      const next = new Set<number>();
      for (const level of structure.levels) {
        if (prev.has(level.floorNumber)) next.add(level.floorNumber);
      }
      return next;
    });
  }, [structure]);

  // Mechanical Risers
  const [risersEnabled, setRisersEnabled] = useState(true);
  const [risersOpacity, setRisersOpacity] = useState(1.0);
  const [showRiserEquipment, setShowRiserEquipment] = useState(true);
  const [visibleRiserIds, setVisibleRiserIds] = useState<Set<string>>(
    () => new Set(risers?.risers.map((r) => r.riserId) ?? []),
  );

  useEffect(() => {
    if (!risers?.risers) return;
    setVisibleRiserIds(new Set(risers.risers.map((r) => r.riserId)));
  }, [risers]);

  // Selection & Click-to-Inspect (Phase 3)
  const [selectedRisers, setSelectedRisers] = useState<RiserDescriptor[]>([]);
  const selectedRiserIds = useMemo(
    () => new Set(selectedRisers.map((riser) => riser.riserId)),
    [selectedRisers],
  );
  const primarySelectedRiser =
    selectedRisers.length > 0
      ? selectedRisers[selectedRisers.length - 1]
      : null;
  const [selectedEquipment, setSelectedEquipment] =
    useState<TerminalEquipmentDescriptor | null>(null);
  const [activePreset, setActivePreset] = useState<QuickPreset | null>("reset");

  // Panel Tab in the control drawer
  const [activeTab, setActiveTab] = useState<
    "layers" | "units" | "floors" | "blueprints"
  >("layers");
  const [controlsCollapsed, setControlsCollapsed] = useState(false);

  // Unit Highlighting
  const [highlightedUnitIds, setHighlightedUnitIds] = useState<Set<string>>(
    () => new Set(),
  );
  const highlightedUnitIdsRef = useRef(highlightedUnitIds);
  highlightedUnitIdsRef.current = highlightedUnitIds;

  const applyUnitFocusShellOpacity = useCallback(() => {
    setSlabOpacity(UNIT_FOCUS_SHELL_OPACITY);
    setWallOpacity(UNIT_FOCUS_SHELL_OPACITY);
  }, []);

  const handleToggleUnit = useCallback((unitId: string) => {
    setActivePreset(null);
    const turningOn = !highlightedUnitIdsRef.current.has(unitId);
    if (turningOn) {
      applyUnitFocusShellOpacity();
    }
    setHighlightedUnitIds((prev) => {
      const next = new Set(prev);
      if (turningOn) {
        next.add(unitId);
      } else {
        next.delete(unitId);
      }
      return next;
    });
  }, [applyUnitFocusShellOpacity]);

  const handleClearUnits = useCallback(() => {
    setHighlightedUnitIds(new Set());
  }, []);

  const handleHighlightAllUnits = useCallback((ids: string[]) => {
    setActivePreset(null);
    const addedAny = ids.some((id) => !highlightedUnitIdsRef.current.has(id));
    if (addedAny) {
      applyUnitFocusShellOpacity();
    }
    setHighlightedUnitIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        next.add(id);
      }
      return next;
    });
  }, [applyUnitFocusShellOpacity]);

  // Preset Handler
  const handleSelectPreset = useCallback(
    (preset: QuickPreset) => {
      setActivePreset(preset);

      if (preset === "reset") {
        setStructureVisible(true);
        setShowSlabs(true);
        setShowWalls(true);
        setSlabOpacity(0.38);
        setWallOpacity(0.42);
        setRisersEnabled(true);
        setRisersOpacity(1.0);
        setShowRiserEquipment(true);
        if (risers) {
          setVisibleRiserIds(new Set(risers.risers.map((r) => r.riserId)));
        }
        setBlueprintEnabled(false);
        setFloorFilterMode("all");
        setSelectedRisers([]);
        setSelectedEquipment(null);
        setHighlightedUnitIds(new Set());
      } else if (preset === "mechanical-only") {
        setStructureVisible(false);
        setRisersEnabled(true);
        setRisersOpacity(1.0);
        setShowRiserEquipment(true);
        if (risers) {
          setVisibleRiserIds(new Set(risers.risers.map((r) => r.riserId)));
        }
        setBlueprintEnabled(false);
        setFloorFilterMode("all");
      } else if (preset === "only-hc") {
        setStructureVisible(true);
        setShowSlabs(true);
        setShowWalls(true);
        setSlabOpacity(0.16);
        setWallOpacity(0.12);
        setRisersEnabled(true);
        setRisersOpacity(1.0);
        setShowRiserEquipment(true);
        if (risers) {
          const hcTypeIds = new Set(
            risers.systemTypes
              .filter((s) => /hc|heat|cool|hvac/i.test(`${s.id} ${s.name}`))
              .map((s) => s.id),
          );
          if (hcTypeIds.size === 0 && risers.systemTypes[0]) {
            hcTypeIds.add(risers.systemTypes[0].id);
          }
          setVisibleRiserIds(
            new Set(
              risers.risers
                .filter((r) => hcTypeIds.has(r.typeId))
                .map((r) => r.riserId),
            ),
          );
        }
        setBlueprintEnabled(false);
        setFloorFilterMode("all");
      } else if (preset === "only-sanitary") {
        setStructureVisible(true);
        setShowSlabs(true);
        setShowWalls(true);
        setSlabOpacity(0.16);
        setWallOpacity(0.12);
        setRisersEnabled(true);
        setRisersOpacity(1.0);
        setShowRiserEquipment(true);
        if (risers) {
          const drainTypeIds = new Set(
            risers.systemTypes
              .filter((s) =>
                /sanitar|laund|s\(l\)|drain|waste/i.test(`${s.id} ${s.name}`),
              )
              .map((s) => s.id),
          );
          if (drainTypeIds.size === 0 && risers.systemTypes[0]) {
            drainTypeIds.add(risers.systemTypes[0].id);
          }
          setVisibleRiserIds(
            new Set(
              risers.risers
                .filter((r) => drainTypeIds.has(r.typeId))
                .map((r) => r.riserId),
            ),
          );
        }
        setBlueprintEnabled(false);
        setFloorFilterMode("all");
      } else if (preset === "floors-8-10") {
        setStructureVisible(true);
        setShowSlabs(true);
        setShowWalls(true);
        setSlabOpacity(0.48);
        setWallOpacity(0.42);
        setRisersEnabled(true);
        setRisersOpacity(1.0);
        setShowRiserEquipment(true);
        if (risers) {
          setVisibleRiserIds(new Set(risers.risers.map((r) => r.riserId)));
        }
        setFloorFilterMode("range");
        setFloorRangeMin(8);
        setFloorRangeMax(10);
      } else if (preset === "structure-only") {
        setStructureVisible(true);
        setShowSlabs(true);
        setShowWalls(true);
        setSlabOpacity(0.6);
        setWallOpacity(0.55);
        setRisersEnabled(false);
        setBlueprintEnabled(false);
        setFloorFilterMode("all");
      }
    },
    [risers],
  );

  const handleToggleCategory = useCallback((category: EquipmentCategory) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const handleToggleBlueprintFloor = useCallback((floorNumber: number) => {
    setVisibleBlueprintFloors((prev) => {
      const next = new Set(prev);
      if (next.has(floorNumber)) {
        next.delete(floorNumber);
      } else {
        next.add(floorNumber);
      }
      return next;
    });
  }, []);

  const handleSelectAllBlueprintFloors = useCallback(() => {
    if (!structure?.levels) return;
    setVisibleBlueprintFloors(new Set(structure.levels.map((l) => l.floorNumber)));
  }, [structure]);

  const handleDeselectAllBlueprintFloors = useCallback(() => {
    setVisibleBlueprintFloors(new Set());
  }, []);

  const handleToggleRiserVisibility = useCallback((riserId: string) => {
    setActivePreset(null);
    setVisibleRiserIds((prev) => {
      const next = new Set(prev);
      if (next.has(riserId)) {
        next.delete(riserId);
        setSelectedRisers((selected) =>
          selected.filter((riser) => riser.riserId !== riserId),
        );
      } else {
        next.add(riserId);
      }
      return next;
    });
  }, []);

  const handleToggleRiserHighlight = useCallback((riser: RiserDescriptor) => {
    setSelectedEquipment(null);
    setSelectedRisers((prev) => {
      const exists = prev.some((item) => item.riserId === riser.riserId);
      if (exists) {
        return prev.filter((item) => item.riserId !== riser.riserId);
      }
      return [...prev, riser];
    });
  }, []);

  const handleToggleSystemVisibility = useCallback(
    (typeId: string) => {
      if (!risers) return;
      setActivePreset(null);
      const groupIds = risers.risers
        .filter((r) => r.typeId === typeId)
        .map((r) => r.riserId);
      setVisibleRiserIds((prev) => {
        const allVisible = groupIds.every((id) => prev.has(id));
        const next = new Set(prev);
        if (allVisible) {
          for (const id of groupIds) {
            next.delete(id);
          }
          setSelectedRisers((selected) =>
            selected.filter((riser) => !groupIds.includes(riser.riserId)),
          );
        } else {
          for (const id of groupIds) {
            next.add(id);
          }
        }
        return next;
      });
    },
    [risers],
  );

  const handleSelectAllRisers = useCallback(() => {
    if (!risers?.risers) return;
    setActivePreset(null);
    setVisibleRiserIds(new Set(risers.risers.map((r) => r.riserId)));
  }, [risers]);

  const handleDeselectAllRisers = useCallback(() => {
    setActivePreset(null);
    setVisibleRiserIds(new Set());
    setSelectedRisers([]);
  }, []);

  const handleIsolateRiser = useCallback((riser: RiserDescriptor) => {
    setActivePreset(null);
    setSelectedRisers([riser]);
    setSelectedEquipment(null);
    setRisersEnabled(true);
    setStructureVisible(true);
    setWallOpacity(0.15);
    setSlabOpacity(0.2);
    setVisibleRiserIds(new Set([riser.riserId]));
  }, []);

  const handleFilterToFloors = useCallback((minF: number, maxF: number) => {
    setActivePreset(null);
    setFloorFilterMode("range");
    setFloorRangeMin(minF);
    setFloorRangeMax(maxF);
  }, []);

  const floorCount = structure?.levels.length ?? 0;
  const skippedCount = structure?.skipped.length ?? 0;
  const [fullscreen, setFullscreen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setFullscreen(false);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // Scene structure options
  const isInspectDimmed = Boolean(selectedRisers.length > 0 || selectedEquipment);

  const structureOptions = useMemo<BuildingStructureOptions>(
    () => ({
      visible: structureVisible,
      showSlabs,
      showWalls,
      slabOpacity,
      wallOpacity,
      visibleFloors,
      dimmed: isInspectDimmed,
      highlightedUnitIds,
      onToggleUnit: handleToggleUnit,
    }),
    [
      structureVisible,
      showSlabs,
      showWalls,
      slabOpacity,
      wallOpacity,
      visibleFloors,
      isInspectDimmed,
      highlightedUnitIds,
      handleToggleUnit,
    ],
  );

  const viewport = (
    <div
      className={`relative min-h-0 flex-1 overflow-hidden ${
        fullscreen ? "" : "rounded-xl border border-slate-200 shadow-sm"
      }`}
    >
      <BuildingScene
        visibleCategories={visibleCategories}
        equipment={
          registryMapItems.length > 0
            ? registryItemsToEquipment(registryMapItems)
            : undefined
        }
        structure={structure}
        structureOptions={structureOptions}
        blueprintOverlay={{
          visible: blueprintEnabled,
          opacity: blueprintOpacity,
          visibleFloors: visibleBlueprintFloors,
        }}
        risers={risers}
        riserOptions={{
          visible: risersEnabled,
          opacity: risersOpacity,
          showEquipment: showRiserEquipment,
          visibleRiserIds,
          highlightRiserIds: selectedRiserIds,
          selectedEquipmentKey: selectedEquipment?.key,
          onSelectRiser: (r) => {
            if (!r) {
              setSelectedRisers([]);
              setSelectedEquipment(null);
              return;
            }
            handleToggleRiserHighlight(r);
          },
          onSelectEquipment: (eq) => {
            setSelectedEquipment(eq);
            if (eq && risers) {
              const parentRiser =
                risers.risers.find((r) => r.riserId === eq.riserId) ?? null;
              setSelectedRisers(parentRiser ? [parentRiser] : []);
            }
          },
          visibleFloors,
          dimNonHighlighted: isInspectDimmed,
        }}
      />

      {/* Top-Left Control Panel Drawer */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-sm flex-col gap-2">
        <div className="pointer-events-auto rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">
                {floorCount === 1
                  ? "1 floor modeled"
                  : `${floorCount} floors modeled`}
              </p>
              <p className="mt-0.5 text-slate-600 text-[11px]">
                Left-drag to pan · Middle-drag to rotate · Scroll to zoom · Click a pipe to highlight · expand System Layers for visibility
              </p>
            </div>
            <button
              type="button"
              onClick={() => setControlsCollapsed((v) => !v)}
              className="rounded p-1 text-slate-400 hover:text-slate-700"
              title={controlsCollapsed ? "Expand panel" : "Collapse panel"}
            >
              {controlsCollapsed ? "▼" : "▲"}
            </button>
          </div>

          {!controlsCollapsed ? (
            <div className="mt-2.5 border-t border-slate-200/80 pt-2 space-y-2.5">
              {/* Quick Presets */}
              <QuickPresetBar
                activePreset={activePreset}
                onSelectPreset={handleSelectPreset}
              />

              {/* Sub-Panel Tabs */}
              <div className="flex border-b border-slate-200 pt-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("layers")}
                  className={`flex-1 pb-1.5 text-center text-xs font-semibold transition border-b-2 ${
                    activeTab === "layers"
                      ? "border-sky-600 text-sky-700"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Layers
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("units")}
                  className={`flex-1 pb-1.5 text-center text-xs font-semibold transition border-b-2 ${
                    activeTab === "units"
                      ? "border-sky-600 text-sky-700"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Units{highlightedUnitIds.size > 0 ? ` (${highlightedUnitIds.size})` : ""}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("floors")}
                  className={`flex-1 pb-1.5 text-center text-xs font-semibold transition border-b-2 ${
                    activeTab === "floors"
                      ? "border-sky-600 text-sky-700"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Floor Slices
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("blueprints")}
                  className={`flex-1 pb-1.5 text-center text-xs font-semibold transition border-b-2 ${
                    activeTab === "blueprints"
                      ? "border-sky-600 text-sky-700"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  2D Blueprints
                </button>
              </div>

              {/* Tab Contents */}
              <div className="max-h-[50vh] overflow-y-auto pr-1 space-y-2">
                {activeTab === "layers" ? (
                  <>
                    <StructureControls
                      visible={structureVisible}
                      showSlabs={showSlabs}
                      showWalls={showWalls}
                      slabOpacity={slabOpacity}
                      wallOpacity={wallOpacity}
                      onToggleVisible={() => {
                        setActivePreset(null);
                        setStructureVisible((v) => !v);
                      }}
                      onToggleSlabs={() => {
                        setActivePreset(null);
                        setShowSlabs((v) => !v);
                      }}
                      onToggleWalls={() => {
                        setActivePreset(null);
                        setShowWalls((v) => !v);
                      }}
                      onChangeSlabOpacity={(val) => {
                        setActivePreset(null);
                        setSlabOpacity(val);
                      }}
                      onChangeWallOpacity={(val) => {
                        setActivePreset(null);
                        setWallOpacity(val);
                      }}
                      highlightedUnitCount={highlightedUnitIds.size}
                      onClearHighlightedUnits={handleClearUnits}
                      onSwitchToUnitsTab={() => setActiveTab("units")}
                    />

                    {risers && risers.totalRiserCount > 0 ? (
                      <RiserControls
                        enabled={risersEnabled}
                        opacity={risersOpacity}
                        showEquipment={showRiserEquipment}
                        systemTypes={risers.systemTypes}
                        risers={risers.risers}
                        visibleRiserIds={visibleRiserIds}
                        highlightedRiserIds={selectedRiserIds}
                        totalRiserCount={risers.totalRiserCount}
                        totalLengthM={risers.totalPipeLengthM}
                        onToggleEnabled={() => {
                          setActivePreset(null);
                          setRisersEnabled((v) => !v);
                        }}
                        onChangeOpacity={(val) => {
                          setActivePreset(null);
                          setRisersOpacity(val);
                        }}
                        onToggleShowEquipment={() => {
                          setActivePreset(null);
                          setShowRiserEquipment((v) => !v);
                        }}
                        onToggleRiserVisibility={handleToggleRiserVisibility}
                        onToggleRiserHighlight={handleToggleRiserHighlight}
                        onToggleSystemVisibility={handleToggleSystemVisibility}
                        onSelectAllRisers={handleSelectAllRisers}
                        onDeselectAllRisers={handleDeselectAllRisers}
                      />
                    ) : null}
                  </>
                ) : null}

                {activeTab === "units" ? (
                  <UnitSearchControls
                    units={structure?.units ?? []}
                    highlightedUnitIds={highlightedUnitIds}
                    onToggleUnit={handleToggleUnit}
                    onHighlightAll={handleHighlightAllUnits}
                    onClearAll={handleClearUnits}
                    visibleFloors={visibleFloors}
                  />
                ) : null}

                {activeTab === "floors" ? (
                  <FloorFilterControls
                    allFloors={allFloorNumbers}
                    mode={floorFilterMode}
                    rangeMin={floorRangeMin}
                    rangeMax={floorRangeMax}
                    singleFloor={singleFloor}
                    onChangeMode={(m) => {
                      setActivePreset(null);
                      setFloorFilterMode(m);
                    }}
                    onChangeRangeMin={(val) => {
                      setActivePreset(null);
                      setFloorRangeMin(val);
                    }}
                    onChangeRangeMax={(val) => {
                      setActivePreset(null);
                      setFloorRangeMax(val);
                    }}
                    onChangeSingleFloor={(val) => {
                      setActivePreset(null);
                      setSingleFloor(val);
                    }}
                    onQuickRange={(min, max) => {
                      setActivePreset(null);
                      setFloorFilterMode("range");
                      setFloorRangeMin(min);
                      setFloorRangeMax(max);
                    }}
                  />
                ) : null}

                {activeTab === "blueprints" && structure?.levels ? (
                  <BlueprintOverlayControls
                    enabled={blueprintEnabled}
                    opacity={blueprintOpacity}
                    levels={structure.levels}
                    visibleFloors={visibleBlueprintFloors}
                    onToggleEnabled={() => {
                      setActivePreset(null);
                      setBlueprintEnabled((v) => !v);
                    }}
                    onChangeOpacity={setBlueprintOpacity}
                    onToggleFloor={handleToggleBlueprintFloor}
                    onSelectAllFloors={handleSelectAllBlueprintFloors}
                    onDeselectAllFloors={handleDeselectAllBlueprintFloors}
                  />
                ) : null}
              </div>

              {skippedCount > 0 ? (
                <p className="border-t border-slate-100 pt-1 text-[10px] text-slate-400">
                  {skippedCount} sheet{skippedCount === 1 ? "" : "s"} skipped (unpinned, uncropped, unmerged, or duplicate).
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Floating Inspector Modal / Card */}
      {(primarySelectedRiser || selectedEquipment) ? (
        <div className="absolute right-3 top-3 z-20 max-w-sm">
          <InspectorModalCard
            riser={primarySelectedRiser}
            selectedRiserCount={selectedRisers.length}
            equipment={selectedEquipment}
            onClear={() => {
              setSelectedRisers([]);
              setSelectedEquipment(null);
            }}
            onIsolateRiser={handleIsolateRiser}
            onFilterToFloors={handleFilterToFloors}
          />
        </div>
      ) : null}

      <EquipmentLegend
        visibleCategories={visibleCategories}
        onToggleCategory={handleToggleCategory}
      />

      {!fullscreen ? (
        <div className="pointer-events-none absolute bottom-3 right-3 z-10">
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white/95 px-2.5 py-1.5 text-sm font-medium text-slate-700 shadow-lg backdrop-blur-sm hover:bg-white"
            aria-label="Enter full screen"
            title="Full screen"
          >
            <FloorPlanExpandIcon />
            Expand
          </button>
        </div>
      ) : null}
    </div>
  );

  if (fullscreen && mounted) {
    return createPortal(
      <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="building-model-fullscreen-title"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-2">
            <div className="min-w-0 flex-1">
              <p
                id="building-model-fullscreen-title"
                className="text-sm font-semibold text-white"
              >
                Asset overview &amp; 3D
              </p>
              <p className="text-xs text-slate-400">
                Left-drag rotate · Scroll zoom · Middle- or right-drag pan · Esc
                to close
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
              aria-label="Exit full screen"
            >
              <FloorPlanExpandIcon />
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 flex flex-col">{viewport}</div>
        </div>
      </div>,
      document.body,
    );
  }

  if (fullscreen) {
    return (
      <div className="flex min-h-[12rem] flex-1 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600">
        Viewing in full screen…
      </div>
    );
  }

  return viewport;
}
