import type { FloorPlanFamilyDto } from "@/lib/building/floor-plan-shared";

const STORAGE_KEY = "floor-plan-compare-scale-fit-factors";

/** Key for families without an architectural scale denominator. */
export const COMPARE_SCALE_NONE_KEY = "__none__";

export type CompareScaleDisplayEntry = {
  fit?: number;
  offsetX?: number;
  offsetY?: number;
};

export type CompareScaleDisplaySettings = Record<string, CompareScaleDisplayEntry>;

export function compareScaleFactorKey(
  scaleDenominator: number | null | undefined,
): string {
  if (scaleDenominator == null || scaleDenominator <= 0) {
    return COMPARE_SCALE_NONE_KEY;
  }
  return String(scaleDenominator);
}

export function compareScaleFactorLabel(
  scaleDenominator: number | null | undefined,
): string {
  if (scaleDenominator == null || scaleDenominator <= 0) {
    return "No scale set";
  }
  return `1:${scaleDenominator}`;
}

export function defaultCompareScaleDisplaySettings(): CompareScaleDisplaySettings {
  return {};
}

function normalizeEntry(
  value: unknown,
): CompareScaleDisplayEntry | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return { fit: value };
  }
  if (!value || typeof value !== "object") return null;

  const raw = value as CompareScaleDisplayEntry;
  const entry: CompareScaleDisplayEntry = {};
  if (typeof raw.fit === "number" && Number.isFinite(raw.fit) && raw.fit > 0) {
    entry.fit = raw.fit;
  }
  if (typeof raw.offsetX === "number" && Number.isFinite(raw.offsetX)) {
    entry.offsetX = raw.offsetX;
  }
  if (typeof raw.offsetY === "number" && Number.isFinite(raw.offsetY)) {
    entry.offsetY = raw.offsetY;
  }
  return Object.keys(entry).length > 0 ? entry : null;
}

export function loadCompareScaleDisplaySettings(): CompareScaleDisplaySettings {
  if (typeof window === "undefined") return defaultCompareScaleDisplaySettings();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultCompareScaleDisplaySettings();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return defaultCompareScaleDisplaySettings();
    }
    const next: CompareScaleDisplaySettings = {};
    for (const [key, value] of Object.entries(parsed)) {
      const entry = normalizeEntry(value);
      if (entry) next[key] = entry;
    }
    return next;
  } catch {
    return defaultCompareScaleDisplaySettings();
  }
}

export function saveCompareScaleDisplaySettings(
  settings: CompareScaleDisplaySettings,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function resolveCompareScaleFitFactor(
  scaleDenominator: number | null | undefined,
  settings: CompareScaleDisplaySettings,
): number {
  const entry = settings[compareScaleFactorKey(scaleDenominator)];
  const value = entry?.fit;
  if (value != null && Number.isFinite(value) && value > 0) {
    return value;
  }
  return 1;
}

export function resolveCompareScaleOffset(
  scaleDenominator: number | null | undefined,
  settings: CompareScaleDisplaySettings,
): { x: number; y: number } {
  const entry = settings[compareScaleFactorKey(scaleDenominator)];
  return {
    x:
      entry?.offsetX != null && Number.isFinite(entry.offsetX)
        ? entry.offsetX
        : 0,
    y:
      entry?.offsetY != null && Number.isFinite(entry.offsetY)
        ? entry.offsetY
        : 0,
  };
}

export function uniqueCompareScaleDenominators(
  families: FloorPlanFamilyDto[],
): Array<number | null> {
  const seen = new Set<string>();
  const result: Array<number | null> = [];
  for (const family of families) {
    const denom = family.scaleDenominator;
    const key = compareScaleFactorKey(denom);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(denom ?? null);
  }
  return result.sort((left, right) => {
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return left - right;
  });
}
