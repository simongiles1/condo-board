import { degrees, PDFDocument, type PDFEmbeddedPage, type PDFPage } from "pdf-lib";

import { loadPdfLibDocument } from "@/lib/pdf/extract-pages";

import type { PdfPoint, PdfRect, PdfSize } from "./floor-plan-align";
import {
  normalizeRotationDegrees,
  visualPageSize,
} from "./floor-plan-align";
import { readPdfPageSize } from "./floor-plan-crop-pdf";
import {
  clippedEastOffset,
  requireSheetCrop,
  splitCanvasLayout,
} from "./floor-plan-split";

/**
 * Stamp an embedded MediaBox page so it matches pdf.js visual coordinates.
 * PDF `/Rotate` is clockwise; pdf-lib `degrees()` is also clockwise, but the
 * origin must move with the rotation or the sheet lands on its side.
 */
function drawEmbeddedPageVisual(
  dest: PDFPage,
  embedded: PDFEmbeddedPage,
  rotationDeg: number,
  x: number,
  y: number,
): void {
  const rot = normalizeRotationDegrees(rotationDeg);
  const width = embedded.width;
  const height = embedded.height;
  switch (rot) {
    case 90:
      dest.drawPage(embedded, {
        x,
        y: y + width,
        width,
        height,
        rotate: degrees(270),
      });
      return;
    case 180:
      dest.drawPage(embedded, {
        x: x + width,
        y: y + height,
        width,
        height,
        rotate: degrees(180),
      });
      return;
    case 270:
      dest.drawPage(embedded, {
        x: x + height,
        y,
        width,
        height,
        rotate: degrees(90),
      });
      return;
    default:
      dest.drawPage(embedded, { x, y, width, height });
  }
}

/**
 * Copy page 1 onto a 0°-rotation PDF whose MediaBox is the visual crop, so
 * stamping uses the same coordinates as pdf.js / the align editor.
 */
async function clipSheetToVisualCrop(
  bytes: Uint8Array,
  crop: PdfRect,
  label: string,
): Promise<{ bytes: Uint8Array; size: PdfSize }> {
  const src = await loadPdfLibDocument(bytes);
  if (src.getPageCount() < 1) {
    throw new Error("PDF has no pages.");
  }
  const srcPage = src.getPage(0);
  const media = srcPage.getSize();
  const rotationDeg = srcPage.getRotation().angle;
  const visual = visualPageSize(media, rotationDeg);
  const box = requireSheetCrop(crop, visual, label);

  const dest = await PDFDocument.create();
  const [embedded] = await dest.embedPages([srcPage]);
  const page = dest.addPage([box.width, box.height]);
  drawEmbeddedPageVisual(page, embedded, rotationDeg, -box.x, -box.y);
  return {
    bytes: await dest.save(),
    size: { width: box.width, height: box.height },
  };
}

/**
 * Clip each sheet to its local crop, then stamp east onto west using the
 * align-editor offset. The offset is adjusted for crop origins so building
 * content stays where the full-sheet alignment placed it.
 *
 * `minSize` pads the merged page (content centered) so a family crop plate
 * that is larger than the overlap still fits.
 */
export async function mergeSplitFloorPlanPdfs(
  westBytes: Uint8Array,
  eastBytes: Uint8Array,
  eastOffset: PdfPoint,
  westCrop: PdfRect,
  eastCrop: PdfRect,
  minSize?: PdfSize | null,
): Promise<{ bytes: Uint8Array; size: PdfSize }> {
  const westInfo = await readPdfPageSize(westBytes);
  const eastInfo = await readPdfPageSize(eastBytes);
  const westBox = requireSheetCrop(
    westCrop,
    { width: westInfo.width, height: westInfo.height },
    "West",
  );
  const eastBox = requireSheetCrop(
    eastCrop,
    { width: eastInfo.width, height: eastInfo.height },
    "East",
  );
  const westClipped = await clipSheetToVisualCrop(westBytes, westBox, "West");
  const eastClipped = await clipSheetToVisualCrop(eastBytes, eastBox, "East");
  const layout = splitCanvasLayout(
    westClipped.size,
    eastClipped.size,
    clippedEastOffset(eastOffset, westBox, eastBox),
  );
  if (!(layout.width > 0) || !(layout.height > 0)) {
    throw new Error("Merged page size must be greater than zero.");
  }

  const outWidth = minSize
    ? Math.max(layout.width, minSize.width)
    : layout.width;
  const outHeight = minSize
    ? Math.max(layout.height, minSize.height)
    : layout.height;
  const originX = (outWidth - layout.width) / 2;
  const originY = (outHeight - layout.height) / 2;

  const dest = await PDFDocument.create();
  const westEmbedded = await dest.embedPdf(westClipped.bytes, [0]);
  const eastEmbedded = await dest.embedPdf(eastClipped.bytes, [0]);
  const page = dest.addPage([outWidth, outHeight]);
  page.drawPage(westEmbedded[0], {
    x: layout.west.x + originX,
    y: layout.west.y + originY,
    width: westClipped.size.width,
    height: westClipped.size.height,
  });
  page.drawPage(eastEmbedded[0], {
    x: layout.east.x + originX,
    y: layout.east.y + originY,
    width: eastClipped.size.width,
    height: eastClipped.size.height,
  });
  return {
    bytes: await dest.save(),
    size: { width: outWidth, height: outHeight },
  };
}
