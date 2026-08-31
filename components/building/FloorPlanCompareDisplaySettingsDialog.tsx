"use client";

import { useEffect, useState } from "react";

import {
  compareScaleFactorKey,
  compareScaleFactorLabel,
  defaultCompareScaleDisplaySettings,
  loadCompareScaleDisplaySettings,
  saveCompareScaleDisplaySettings,
  type CompareScaleDisplayEntry,
  type CompareScaleDisplaySettings,
} from "@/lib/building/floor-plan-compare-display-settings";

function GearIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.03 1.41 1.03H21a2 2 0 1 1 0 4h-.09c-.64 0-1.15.43-1.41 1.03Z" />
    </svg>
  );
}

export function FloorPlanCompareDisplaySettingsButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50"
      aria-label="Compare display settings"
      title="Compare display settings"
    >
      <GearIcon className="h-4 w-4" />
    </button>
  );
}

export function FloorPlanCompareDisplaySettingsDialog({
  open,
  scaleDenominators,
  activeScaleDenominator,
  activeAutoFitScale,
  activeAppliedScale,
  activeOffsetX,
  activeOffsetY,
  onClose,
  onChange,
}: {
  open: boolean;
  scaleDenominators: Array<number | null>;
  activeScaleDenominator: number | null | undefined;
  activeAutoFitScale: number | null;
  activeAppliedScale: number | null;
  activeOffsetX: number;
  activeOffsetY: number;
  onClose: () => void;
  onChange: (settings: CompareScaleDisplaySettings) => void;
}) {
  const [draft, setDraft] = useState<CompareScaleDisplaySettings>(() =>
    loadCompareScaleDisplaySettings(),
  );

  useEffect(() => {
    if (!open) return;
    setDraft(loadCompareScaleDisplaySettings());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  function updateEntry(
    scaleDenominator: number | null,
    field: keyof CompareScaleDisplayEntry,
    raw: string,
  ) {
    const key = compareScaleFactorKey(scaleDenominator);
    const next = { ...draft };
    const current = { ...(next[key] ?? {}) };

    if (!raw.trim()) {
      delete current[field];
    } else {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      if (field === "fit" && parsed <= 0) {
        delete current[field];
      } else {
        current[field] = parsed;
      }
    }

    if (Object.keys(current).length === 0) {
      delete next[key];
    } else {
      next[key] = current;
    }

    setDraft(next);
    saveCompareScaleDisplaySettings(next);
    onChange(next);
  }

  function resetAll() {
    const next = defaultCompareScaleDisplaySettings();
    setDraft(next);
    saveCompareScaleDisplaySettings(next);
    onChange(next);
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Close settings"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-display-settings-title"
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h2
          id="compare-display-settings-title"
          className="text-lg font-semibold text-slate-900"
        >
          Compare display scale
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Tune fit and screen-space offsets per architectural scale. Values are
          saved in this browser.
        </p>

        <div className="mt-5 space-y-4">
          {scaleDenominators.map((scaleDenominator) => {
            const key = compareScaleFactorKey(scaleDenominator);
            const entry = draft[key] ?? {};
            const isActive =
              compareScaleFactorKey(activeScaleDenominator) === key;
            return (
              <div
                key={key}
                className={`rounded-lg border px-3 py-3 ${
                  isActive
                    ? "border-sky-300 bg-sky-50"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-900">
                    {compareScaleFactorLabel(scaleDenominator)}
                  </span>
                  {isActive ? (
                    <span className="text-xs font-medium text-sky-800">
                      Current floor
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="block text-sm text-slate-600">
                    Fit multiplier
                    <input
                      type="number"
                      min={0.1}
                      max={20}
                      step={0.05}
                      value={entry.fit ?? ""}
                      placeholder="1"
                      onChange={(event) =>
                        updateEntry(scaleDenominator, "fit", event.target.value)
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                    />
                  </label>
                  <label className="block text-sm text-slate-600">
                    X offset (px)
                    <input
                      type="number"
                      step={1}
                      value={entry.offsetX ?? ""}
                      placeholder="0"
                      onChange={(event) =>
                        updateEntry(
                          scaleDenominator,
                          "offsetX",
                          event.target.value,
                        )
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                    />
                  </label>
                  <label className="block text-sm text-slate-600">
                    Y offset (px)
                    <input
                      type="number"
                      step={1}
                      value={entry.offsetY ?? ""}
                      placeholder="0"
                      onChange={(event) =>
                        updateEntry(
                          scaleDenominator,
                          "offsetY",
                          event.target.value,
                        )
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {activeAutoFitScale != null ? (
          <div className="mt-5 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
            <p>
              Auto-fit scale (before multiplier):{" "}
              <span className="font-mono">{activeAutoFitScale.toFixed(3)}</span>
            </p>
            {activeAppliedScale != null ? (
              <p className="mt-1">
                Applied scale (with multiplier):{" "}
                <span className="font-mono">
                  {activeAppliedScale.toFixed(3)}
                </span>
              </p>
            ) : null}
            <p className="mt-1">
              Active offset:{" "}
              <span className="font-mono">
                {activeOffsetX}px, {activeOffsetY}px
              </span>
            </p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={resetAll}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300"
          >
            Reset all
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
