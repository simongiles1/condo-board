import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";

import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { loadPdfLibDocument } from "@/lib/pdf/extract-pages";
import { assertLooksLikePdf } from "@/lib/pdf/pdf-bytes";

import type { PdfRect } from "./floor-plan-align";
import { visualCropToMedia, visualPageSize } from "./floor-plan-align";

type PdfDocumentInit = Parameters<typeof getDocument>[0];

export type PdfPageSizeInfo = {
  width: number;
  height: number;
  mediaWidth: number;
  mediaHeight: number;
  rotationDeg: number;
  pageCount: number;
};

async function readPdfPageSizePdfjs(bytes: Uint8Array): Promise<PdfPageSizeInfo> {
  const loadingTask = getDocument({
    data: bytes,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  } as PdfDocumentInit);
  const doc = await loadingTask.promise;
  try {
    const pageCount = doc.numPages;
    if (pageCount < 1) {
      throw new Error("PDF has no pages.");
    }
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const view = page.view;
    const mediaWidth = view[2] - view[0];
    const mediaHeight = view[3] - view[1];
    return {
      width: viewport.width,
      height: viewport.height,
      mediaWidth,
      mediaHeight,
      rotationDeg: page.rotate ?? 0,
      pageCount,
    };
  } finally {
    await doc.destroy?.();
  }
}

async function readPdfPageSizePdfLib(bytes: Uint8Array): Promise<PdfPageSizeInfo> {
  const doc = await loadPdfLibDocument(bytes);
  const pageCount = doc.getPageCount();
  if (pageCount < 1) {
    throw new Error("PDF has no pages.");
  }
  const page = doc.getPage(0);
  const media = page.getSize();
  const visual = visualPageSize(media, page.getRotation().angle);
  return {
    width: visual.width,
    height: visual.height,
    mediaWidth: media.width,
    mediaHeight: media.height,
    rotationDeg: page.getRotation().angle,
    pageCount,
  };
}

const FLOOR_PLAN_ROOT = path.join(process.cwd(), "data", "floor-plans");

export function floorPlanDir(planId: string): string {
  return path.join(FLOOR_PLAN_ROOT, planId);
}

export function floorPlanOriginalPath(planId: string): string {
  return path.join(floorPlanDir(planId), "original.pdf");
}

export function floorPlanCroppedPath(planId: string): string {
  return path.join(floorPlanDir(planId), "cropped.pdf");
}

export function floorPlanWestPath(planId: string): string {
  return path.join(floorPlanDir(planId), "west.pdf");
}

export function floorPlanEastPath(planId: string): string {
  return path.join(floorPlanDir(planId), "east.pdf");
}

export async function writeFloorPlanOriginal(
  planId: string,
  bytes: Uint8Array,
): Promise<string> {
  const dir = floorPlanDir(planId);
  await mkdir(dir, { recursive: true });
  const filePath = floorPlanOriginalPath(planId);
  await writeFile(filePath, bytes);
  return filePath;
}

export async function writeFloorPlanCropped(
  planId: string,
  bytes: Uint8Array,
): Promise<string> {
  const dir = floorPlanDir(planId);
  await mkdir(dir, { recursive: true });
  const filePath = floorPlanCroppedPath(planId);
  await writeFile(filePath, bytes);
  return filePath;
}

export async function writeFloorPlanWest(
  planId: string,
  bytes: Uint8Array,
): Promise<string> {
  const dir = floorPlanDir(planId);
  await mkdir(dir, { recursive: true });
  const filePath = floorPlanWestPath(planId);
  await writeFile(filePath, bytes);
  return filePath;
}

export async function writeFloorPlanEast(
  planId: string,
  bytes: Uint8Array,
): Promise<string> {
  const dir = floorPlanDir(planId);
  await mkdir(dir, { recursive: true });
  const filePath = floorPlanEastPath(planId);
  await writeFile(filePath, bytes);
  return filePath;
}

export async function removeFloorPlanFiles(planId: string): Promise<void> {
  await rm(floorPlanDir(planId), { recursive: true, force: true });
}

export async function readPdfPageSize(bytes: Uint8Array): Promise<PdfPageSizeInfo> {
  assertLooksLikePdf(bytes, "PDF");
  try {
    return await readPdfPageSizePdfLib(bytes);
  } catch (pdfLibError) {
    try {
      return await readPdfPageSizePdfjs(bytes);
    } catch {
      const detail =
        pdfLibError instanceof Error ? pdfLibError.message : "Invalid PDF.";
      throw new Error(`Could not read PDF: ${detail}`);
    }
  }
}

/**
 * Copy page 1 into a new PDF whose MediaBox/CropBox equal the crop rect so
 * every sheet in a family has identical page dimensions.
 *
 * `crop` is in visual space (the page as pdf.js draws it, origin bottom-left).
 * Rotated sheets are converted to unrotated user space before the box is set.
 */
export async function cropFloorPlanPdf(
  source: Uint8Array,
  crop: PdfRect,
): Promise<Uint8Array> {
  const src = await loadPdfLibDocument(source);
  if (src.getPageCount() < 1) {
    throw new Error("PDF has no pages.");
  }
  const dst = await PDFDocument.create();
  const [page] = await dst.copyPages(src, [0]);
  const media = page.getSize();
  const box = visualCropToMedia(crop, media, page.getRotation().angle);
  page.setMediaBox(box.x, box.y, box.width, box.height);
  page.setCropBox(box.x, box.y, box.width, box.height);
  page.setBleedBox(box.x, box.y, box.width, box.height);
  page.setTrimBox(box.x, box.y, box.width, box.height);
  dst.addPage(page);
  return dst.save();
}

export async function cropFloorPlanPdfFromPath(
  originalPath: string,
  crop: PdfRect,
): Promise<Uint8Array> {
  const source = await readFile(originalPath);
  return cropFloorPlanPdf(source, crop);
}

export async function readPdfPageSizeFromPath(originalPath: string) {
  return readPdfPageSize(await readFile(originalPath));
}
