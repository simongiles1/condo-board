/** East/west sheet overlap layout. PDF space is origin bottom-left. */

import {
  clampCropToPage,
  MIN_CROP_PT,
  type PdfPoint,
  type PdfRect,
  type PdfSize,
} from "./floor-plan-align";

/** Fraction of the narrower sheet that overlaps in the default placement. */
const DEFAULT_OVERLAP_FRACTION = 0.35;

export type SplitCanvasLayout = {
  width: number;
  height: number;
  west: PdfPoint;
  east: PdfPoint;
};

/**
 * Place the east sheet so its west edge overlaps the east edge of the west
 * sheet (elevator core). Heights are centered when they differ.
 */
export function defaultEastOffset(west: PdfSize, east: PdfSize): PdfPoint {
  const overlap =
    Math.min(west.width, east.width) * DEFAULT_OVERLAP_FRACTION;
  return {
    x: west.width - overlap,
    y: (west.height - east.height) / 2,
  };
}

/**
 * Bounding canvas that contains the west sheet at its origin and the east
 * sheet at `eastOffset` (east origin relative to west origin). Negative
 * offsets shift west away from (0, 0) so the canvas origin stays bottom-left.
 */
export function splitCanvasLayout(
  west: PdfSize,
  east: PdfSize,
  eastOffset: PdfPoint,
): SplitCanvasLayout {
  const minX = Math.min(0, eastOffset.x);
  const minY = Math.min(0, eastOffset.y);
  const maxX = Math.max(west.width, eastOffset.x + east.width);
  const maxY = Math.max(west.height, eastOffset.y + east.height);
  return {
    width: maxX - minX,
    height: maxY - minY,
    west: { x: zero(0 - minX), y: zero(0 - minY) },
    east: { x: zero(eastOffset.x - minX), y: zero(eastOffset.y - minY) },
  };
}

function zero(value: number): number {
  return value === 0 ? 0 : value;
}

export function nudgeEastOffset(
  offset: PdfPoint,
  dx: number,
  dy: number,
): PdfPoint {
  return { x: offset.x + dx, y: offset.y + dy };
}

/** Inverse of {@link nudgeEastOffset}: moves the west sheet in PDF space. */
export function nudgeWestOffset(
  offset: PdfPoint,
  dx: number,
  dy: number,
): PdfPoint {
  return { x: offset.x - dx, y: offset.y - dy };
}

export function splitSheetSizes(plan: {
  westPageWidthPt: number | null;
  westPageHeightPt: number | null;
  eastPageWidthPt: number | null;
  eastPageHeightPt: number | null;
}): { west: PdfSize; east: PdfSize } | null {
  if (
    plan.westPageWidthPt == null ||
    plan.westPageHeightPt == null ||
    plan.eastPageWidthPt == null ||
    plan.eastPageHeightPt == null ||
    !(plan.westPageWidthPt > 0) ||
    !(plan.westPageHeightPt > 0) ||
    !(plan.eastPageWidthPt > 0) ||
    !(plan.eastPageHeightPt > 0)
  ) {
    return null;
  }
  return {
    west: { width: plan.westPageWidthPt, height: plan.westPageHeightPt },
    east: { width: plan.eastPageWidthPt, height: plan.eastPageHeightPt },
  };
}

export function resolvedEastOffset(
  west: PdfSize,
  east: PdfSize,
  saved: { x: number | null; y: number | null },
): PdfPoint {
  if (saved.x != null && saved.y != null && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    return { x: saved.x, y: saved.y };
  }
  return defaultEastOffset(west, east);
}

export type SplitAlignDraft = {
  offset: PdfPoint;
  westCrop: PdfRect;
  eastCrop: PdfRect;
};

export type SavedSheetCrop = {
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
};

/** Starting keep-region so title-block edges can be pulled in by hand. */
export function defaultSheetCrop(page: PdfSize): PdfRect {
  const inset = Math.min(page.width, page.height) * 0.08;
  return clampCropToPage(
    {
      x: inset,
      y: inset,
      width: page.width - inset * 2,
      height: page.height - inset * 2,
    },
    page,
  );
}

export function resolvedSheetCrop(page: PdfSize, saved: SavedSheetCrop): PdfRect {
  if (
    saved.x == null ||
    saved.y == null ||
    saved.width == null ||
    saved.height == null ||
    !Number.isFinite(saved.x) ||
    !Number.isFinite(saved.y) ||
    !Number.isFinite(saved.width) ||
    !Number.isFinite(saved.height)
  ) {
    return defaultSheetCrop(page);
  }
  const clamped = clampCropToPage(
    { x: saved.x, y: saved.y, width: saved.width, height: saved.height },
    page,
  );
  if (clamped.width >= MIN_CROP_PT && clamped.height >= MIN_CROP_PT) {
    return clamped;
  }
  return defaultSheetCrop(page);
}

/**
 * Clip each sheet, then stamp using this offset so building content stays
 * where the full-sheet alignment put it. Cropping shifts each page origin.
 */
export function clippedEastOffset(
  eastOffset: PdfPoint,
  westCrop: PdfRect,
  eastCrop: PdfRect,
): PdfPoint {
  return {
    x: eastOffset.x + eastCrop.x - westCrop.x,
    y: eastOffset.y + eastCrop.y - westCrop.y,
  };
}

export function requireSheetCrop(
  crop: PdfRect,
  page: PdfSize,
  label: string,
): PdfRect {
  const clamped = clampCropToPage(crop, page);
  if (!(clamped.width >= MIN_CROP_PT) || !(clamped.height >= MIN_CROP_PT)) {
    throw new Error(`${label} crop must isolate a region of the sheet.`);
  }
  return clamped;
}

export function parsePdfRect(raw: unknown, label: string): PdfRect {
  if (raw == null || typeof raw !== "object") {
    throw new Error(`${label} crop is required.`);
  }
  const record = raw as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const width = Number(record.width);
  const height = Number(record.height);
  if (![x, y, width, height].every(Number.isFinite)) {
    throw new Error(`${label} crop x, y, width, and height are required.`);
  }
  return { x, y, width, height };
}

export function parseOptionalPdfRect(
  raw: unknown,
  label: string,
): PdfRect | undefined {
  if (raw == null) return undefined;
  return parsePdfRect(raw, label);
}
