/** Pure crop / pin / neighbor math for floor-plan alignment. PDF space is origin bottom-left. */

export type PdfSize = {
  width: number;
  height: number;
};

export type PdfRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfPoint = {
  x: number;
  y: number;
};

export type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasPoint = {
  x: number;
  y: number;
};

/** CSS pan/zoom of a page drawn at a fixed layout scale. Origin is the viewport top-left. */
export type PdfPanZoom = {
  x: number;
  y: number;
  zoom: number;
};

/**
 * pdf.js clip that fills the viewport at `dpr` device pixels per CSS pixel.
 * `offsetX`/`offsetY` are passed to `page.getViewport` so the visible top-left
 * lands at canvas (0, 0) without allocating a full-page bitmap.
 */
export type PdfVisibleRender = {
  canvasWidth: number;
  canvasHeight: number;
  renderScale: number;
  offsetX: number;
  offsetY: number;
};

export type FamilyNeighborPlan = {
  id: string;
  familyId: string;
  floorNumber: number;
  name?: string;
};

export type FamilyCroppedNeighborPlan = FamilyNeighborPlan & {
  hasCropped: boolean;
};

const EPS = 1e-6;

/** Smallest unlocked crop, in PDF points. Avoids a 0×0 drag crashing the editor. */
export const MIN_CROP_PT = 1;

/**
 * Cropped PDFs in a family must share this plate size. 0.5pt covers float
 * noise from 90°/270° box swaps; a later resize is tens of points.
 */
export const CROP_SIZE_MATCH_PT = 0.5;

/** Cropped W×H stored on a floor-plan row, when both dimensions are set. */
export function planCropSize(plan: {
  cropWidthPt: number | null;
  cropHeightPt: number | null;
}): PdfSize | null {
  if (
    plan.cropWidthPt != null &&
    plan.cropHeightPt != null &&
    plan.cropWidthPt > EPS &&
    plan.cropHeightPt > EPS
  ) {
    return { width: plan.cropWidthPt, height: plan.cropHeightPt };
  }
  return null;
}

/** True when a cropped sheet's visual page is the family plate. */
export function croppedSizeMatchesFamily(
  cropped: PdfSize,
  family: PdfSize,
  eps = CROP_SIZE_MATCH_PT,
): boolean {
  return (
    Math.abs(cropped.width - family.width) <= eps &&
    Math.abs(cropped.height - family.height) <= eps
  );
}

export type PdfRotationDeg = 0 | 90 | 180 | 270;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

export function normalizeRotationDegrees(angle: number): PdfRotationDeg {
  const n = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  if (n === 90 || n === 180 || n === 270) return n;
  return 0;
}

/**
 * Size of the page as pdf.js draws it (Rotate applied). Architectural sheets
 * are often portrait MediaBoxes with /Rotate 90 or 270; the crop overlay must
 * use this size or the right edge stops short of the visible drawing.
 */
export function visualPageSize(media: PdfSize, rotationDeg: number): PdfSize {
  const rot = normalizeRotationDegrees(rotationDeg);
  if (rot === 90 || rot === 270) {
    return { width: media.height, height: media.width };
  }
  return { width: media.width, height: media.height };
}

/**
 * Visual crop (origin bottom-left of the displayed page) → MediaBox in
 * unrotated PDF user space. /Rotate is clockwise, matching pdf.js.
 */
export function visualCropToMedia(
  crop: PdfRect,
  media: PdfSize,
  rotationDeg: number,
): PdfRect {
  const rot = normalizeRotationDegrees(rotationDeg);
  const vis = visualPageSize(media, rot);
  switch (rot) {
    case 90:
      return {
        x: vis.height - crop.y - crop.height,
        y: crop.x,
        width: crop.height,
        height: crop.width,
      };
    case 180:
      return {
        x: vis.width - crop.x - crop.width,
        y: vis.height - crop.y - crop.height,
        width: crop.width,
        height: crop.height,
      };
    case 270:
      return {
        x: crop.y,
        y: vis.width - crop.x - crop.width,
        width: crop.height,
        height: crop.width,
      };
    default:
      return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
  }
}

/** Inverse of visualCropToMedia. */
export function mediaCropToVisual(
  crop: PdfRect,
  media: PdfSize,
  rotationDeg: number,
): PdfRect {
  const rot = normalizeRotationDegrees(rotationDeg);
  const vis = visualPageSize(media, rot);
  switch (rot) {
    case 90:
      return {
        x: crop.y,
        y: vis.height - crop.x - crop.width,
        width: crop.height,
        height: crop.width,
      };
    case 180:
      return {
        x: vis.width - crop.x - crop.width,
        y: vis.height - crop.y - crop.height,
        width: crop.width,
        height: crop.height,
      };
    case 270:
      return {
        x: vis.width - crop.y - crop.height,
        y: crop.x,
        width: crop.height,
        height: crop.width,
      };
    default:
      return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
  }
}

/** Keep the crop rectangle fully on the page. Size is unchanged. */
export function clampCropOrigin(
  x: number,
  y: number,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number,
): PdfPoint {
  return {
    x: clamp(x, 0, Math.max(0, pageWidth - width)),
    y: clamp(y, 0, Math.max(0, pageHeight - height)),
  };
}

/**
 * Intersect a proposed crop with the page. Opposite edges stay put when a
 * handle is dragged past the sheet; the crop never leaves the page.
 */
export function clampCropToPage(proposed: PdfRect, page: PdfSize): PdfRect {
  const x0 = clamp(proposed.x, 0, page.width);
  const y0 = clamp(proposed.y, 0, page.height);
  const x1 = clamp(proposed.x + proposed.width, 0, page.width);
  const y1 = clamp(proposed.y + proposed.height, 0, page.height);
  return {
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  };
}

/**
 * When `familySize` is set, proposed W×H is ignored and only origin moves
 * (overlay matching). If the plate is larger than the page, W×H shrinks to
 * the sheet so the crop editor can mount — callers that need a true family
 * plate should pad the page first. Unlocked resizes that spill off the sheet
 * are clamped, not rejected.
 */
export function applyFamilyCropSize(
  familySize: PdfSize | null,
  proposed: PdfRect,
  page: PdfSize,
): PdfRect {
  if (familySize) {
    const width = familySize.width;
    const height = familySize.height;
    if (!(width > EPS) || !(height > EPS)) {
      throw new Error("Crop size must be greater than zero.");
    }
    const fittedWidth = Math.min(width, page.width);
    const fittedHeight = Math.min(height, page.height);
    const origin = clampCropOrigin(
      proposed.x,
      proposed.y,
      fittedWidth,
      fittedHeight,
      page.width,
      page.height,
    );
    return {
      x: origin.x,
      y: origin.y,
      width: fittedWidth,
      height: fittedHeight,
    };
  }

  const crop = clampCropToPage(proposed, page);
  const minW = Math.min(MIN_CROP_PT, page.width);
  const minH = Math.min(MIN_CROP_PT, page.height);
  const width = Math.max(crop.width, minW);
  const height = Math.max(crop.height, minH);
  if (!(width > EPS) || !(height > EPS)) {
    throw new Error("Crop size must be greater than zero.");
  }
  const origin = clampCropOrigin(
    crop.x,
    crop.y,
    width,
    height,
    page.width,
    page.height,
  );
  return { x: origin.x, y: origin.y, width, height };
}

export function familyCropSizeLocked(familySize: PdfSize | null): boolean {
  return (
    familySize != null &&
    familySize.width > EPS &&
    familySize.height > EPS
  );
}

/** True when the family plate can sit fully on this page. */
export function familyCropFitsPage(
  familySize: PdfSize,
  page: PdfSize,
): boolean {
  return (
    familySize.width - page.width <= EPS &&
    familySize.height - page.height <= EPS
  );
}

/** Pin stays inside the page (PDF space, origin bottom-left). */
export function clampPin(
  pin: PdfPoint,
  pageSize: PdfSize,
): PdfPoint {
  return {
    x: clamp(pin.x, 0, Math.max(0, pageSize.width)),
    y: clamp(pin.y, 0, Math.max(0, pageSize.height)),
  };
}

export function nudgePin(
  pin: PdfPoint,
  dx: number,
  dy: number,
  cropSize: PdfSize,
): PdfPoint {
  return clampPin({ x: pin.x + dx, y: pin.y + dy }, cropSize);
}

/**
 * Translate overlay B so its registration pin lands on A's pin.
 * Values are PDF-space (Y up). Canvas Y-down conversion is separate.
 */
export function pinOverlayOffset(
  a: PdfPoint,
  b: PdfPoint,
): PdfPoint {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** Place overlay B on a canvas that already shows A at (0,0), Y down. */
export function pinOverlayCanvasOffset(
  a: PdfPoint,
  aPageHeight: number,
  b: PdfPoint,
  bPageHeight: number,
  aScale: number,
  bScale: number = aScale,
): CanvasPoint {
  const aCanvas = pdfPointToCanvas(a, aPageHeight, aScale);
  const bCanvas = pdfPointToCanvas(b, bPageHeight, bScale);
  return {
    x: aCanvas.x - bCanvas.x,
    y: aCanvas.y - bCanvas.y,
  };
}

export function pdfRectToCanvas(
  crop: PdfRect,
  pageHeight: number,
  scale: number,
): CanvasRect {
  return {
    x: crop.x * scale,
    y: (pageHeight - crop.y - crop.height) * scale,
    width: crop.width * scale,
    height: crop.height * scale,
  };
}

export function canvasRectToPdf(
  rect: CanvasRect,
  pageHeight: number,
  scale: number,
): PdfRect {
  const width = rect.width / scale;
  const height = rect.height / scale;
  return {
    x: rect.x / scale,
    y: pageHeight - rect.y / scale - height,
    width,
    height,
  };
}

/** Crop overlay handles. Side handles (`n`/`e`/`s`/`w`) move one edge. */
export type CropHandleKind = "n" | "e" | "s" | "w" | "nw" | "ne" | "sw" | "se";

/** Smallest canvas-pixel crop while dragging a handle, so a collapsed drag cannot vanish. */
const MIN_HANDLE_CROP_PX = 8;

/**
 * Resize a canvas-space crop from a handle. Side handles ignore the axis they
 * do not own, so you can pan to the far edge of a sheet and change only width
 * or only height without seeing the opposite corners.
 */
export function resizeCanvasRectFromHandle(
  kind: CropHandleKind,
  start: CanvasRect,
  pointer: CanvasPoint,
  page: PdfSize,
): CanvasRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  const px = Math.min(page.width, Math.max(0, pointer.x));
  const py = Math.min(page.height, Math.max(0, pointer.y));
  if (kind === "n" || kind === "nw" || kind === "ne") top = py;
  if (kind === "s" || kind === "sw" || kind === "se") bottom = py;
  if (kind === "w" || kind === "nw" || kind === "sw") left = px;
  if (kind === "e" || kind === "ne" || kind === "se") right = px;
  const x = Math.min(left, right);
  const y = Math.min(top, bottom);
  return {
    x,
    y,
    width: Math.max(
      1,
      Math.min(page.width - x, Math.max(MIN_HANDLE_CROP_PX, Math.abs(right - left))),
    ),
    height: Math.max(
      1,
      Math.min(page.height - y, Math.max(MIN_HANDLE_CROP_PX, Math.abs(bottom - top))),
    ),
  };
}

export function pdfPointToCanvas(
  point: PdfPoint,
  pageHeight: number,
  scale: number,
): CanvasPoint {
  return {
    x: point.x * scale,
    y: (pageHeight - point.y) * scale,
  };
}

export function canvasPointToPdf(
  point: CanvasPoint,
  pageHeight: number,
  scale: number,
): PdfPoint {
  return {
    x: point.x / scale,
    y: pageHeight - point.y / scale,
  };
}

/** Pan/zoom so a PDF-point extent (not just the page) fits the viewport. */
export function fitPanZoomToPdfExtent(
  viewport: { clientWidth: number; clientHeight: number },
  extent: { minX: number; minY: number; maxX: number; maxY: number },
  pageHeight: number,
  layoutScale: number,
  fitPad: number,
  zoomMin: number,
  zoomMax: number,
): PdfPanZoom {
  const width = (extent.maxX - extent.minX) * layoutScale;
  const height = (extent.maxY - extent.minY) * layoutScale;
  if (!(width > 0) || !(height > 0)) {
    return { x: 0, y: 0, zoom: 1 };
  }
  const zoom = Math.min(
    (viewport.clientWidth - fitPad) / width,
    (viewport.clientHeight - fitPad) / height,
    zoomMax,
  );
  const clamped = Math.max(zoom, zoomMin);
  const centerX = ((extent.minX + extent.maxX) / 2) * layoutScale;
  const centerY = (pageHeight - (extent.minY + extent.maxY) / 2) * layoutScale;
  return {
    zoom: clamped,
    x: viewport.clientWidth / 2 - centerX * clamped,
    y: viewport.clientHeight / 2 - centerY * clamped,
  };
}

/**
 * Map a CSS pan/zoom of a page drawn at `layoutScale` into a pdf.js clip.
 * One PDF point becomes `layoutScale * zoom * dpr` device pixels — the same
 * density as the on-screen sheet — so zooming re-rasterizes instead of stretching.
 */
export function pdfClipFromElementRects(
  pageBox: { left: number; top: number; width: number },
  viewportBox: { left: number; top: number; width: number; height: number },
  pageWidthPt: number,
  dpr: number,
): PdfVisibleRender {
  const pixelRatio = Math.max(1, dpr);
  const cssPerPt = pageWidthPt > 0 ? pageBox.width / pageWidthPt : 1;
  return {
    canvasWidth: Math.max(1, Math.round(viewportBox.width * pixelRatio)),
    canvasHeight: Math.max(1, Math.round(viewportBox.height * pixelRatio)),
    renderScale: cssPerPt * pixelRatio,
    offsetX: (pageBox.left - viewportBox.left) * pixelRatio,
    offsetY: (pageBox.top - viewportBox.top) * pixelRatio,
  };
}

/**
 * Rasterize a PDF-point rectangle at 1 CSS pixel per point (× dpr device pixels).
 * Used for template design previews that must match on-plan scale.
 */
export function pdfRectClipRenderParams(
  clip: PdfRect,
  pageHeight: number,
  dpr = 1,
): PdfVisibleRender {
  const pixelRatio = Math.max(1, dpr);
  const topCanvas = pageHeight - clip.y - clip.height;
  return {
    canvasWidth: Math.max(1, Math.round(clip.width * pixelRatio)),
    canvasHeight: Math.max(1, Math.round(clip.height * pixelRatio)),
    renderScale: pixelRatio,
    offsetX: -clip.x * pixelRatio,
    offsetY: -topCanvas * pixelRatio,
  };
}

/** Convert a PDF point to coordinates inside a clip rect (SVG y-down, 1 pt = 1 unit). */
export function pdfPointToClipCoords(
  point: PdfPoint,
  clip: PdfRect,
  pageHeight: number,
): CanvasPoint {
  return {
    x: point.x - clip.x,
    y: clip.y + clip.height - point.y,
  };
}

/** Convert clip-local SVG coordinates back to a PDF point. */
export function clipCoordsToPdfPoint(
  point: CanvasPoint,
  clip: PdfRect,
  pageHeight: number,
): PdfPoint {
  return {
    x: point.x + clip.x,
    y: clip.y + clip.height - point.y,
  };
}

export function pdfVisibleRenderParams(
  view: PdfPanZoom,
  viewportWidth: number,
  viewportHeight: number,
  layoutScale: number,
  dpr: number,
  overscanPx = 0,
): PdfVisibleRender {
  const pixelRatio = Math.max(1, dpr);
  const zoom = view.zoom === 0 ? 1 : view.zoom;
  const pad = Math.max(0, overscanPx);
  return {
    canvasWidth: Math.max(1, Math.round((viewportWidth + 2 * pad) * pixelRatio)),
    canvasHeight: Math.max(
      1,
      Math.round((viewportHeight + 2 * pad) * pixelRatio),
    ),
    renderScale: layoutScale * zoom * pixelRatio,
    offsetX: (view.x + pad) * pixelRatio,
    offsetY: (view.y + pad) * pixelRatio,
  };
}

/**
 * Shrink a clip so neither canvas edge exceeds `maxEdge`, keeping the same
 * PDF region in view (scale and offsets move together).
 */
export function clampPdfVisibleRender(
  params: PdfVisibleRender,
  maxEdge = 8192,
): PdfVisibleRender {
  const edge = Math.max(params.canvasWidth, params.canvasHeight, 1);
  if (!(edge > maxEdge)) return params;
  const k = maxEdge / edge;
  return {
    canvasWidth: Math.max(1, Math.round(params.canvasWidth * k)),
    canvasHeight: Math.max(1, Math.round(params.canvasHeight * k)),
    renderScale: params.renderScale * k,
    offsetX: params.offsetX * k,
    offsetY: params.offsetY * k,
  };
}

/**
 * Same clip math when this PDF's page (0,0) is the overlay rect in page-canvas
 * space (the ghost crop sitting on the live sheet).
 */
export function pdfOverlayRenderParams(
  view: PdfPanZoom,
  overlay: CanvasRect,
  viewportWidth: number,
  viewportHeight: number,
  layoutScale: number,
  dpr: number,
  overscanPx = 0,
): PdfVisibleRender {
  const base = pdfVisibleRenderParams(
    view,
    viewportWidth,
    viewportHeight,
    layoutScale,
    dpr,
    overscanPx,
  );
  const pixelRatio = Math.max(1, dpr);
  const pad = Math.max(0, overscanPx);
  return {
    ...base,
    offsetX: (view.x + overlay.x * view.zoom + pad) * pixelRatio,
    offsetY: (view.y + overlay.y * view.zoom + pad) * pixelRatio,
  };
}

/**
 * Extra CSS pixels rasterized past each viewport edge. Modest pans CSS-follow
 * into this margin instead of showing a blank strip.
 */
export const CLIP_RASTER_OVERSCAN_PX = 256;

/**
 * Identity for a clip raster: zoom, layout scale, viewport size, overlay size,
 * and pan. Small pans CSS-follow the last paint; a pan past half the overscan
 * starts another pdf.js job after the view settles.
 */
export type ClipRasterKey = {
  zoom: number;
  layoutScale: number;
  viewportWidth: number;
  viewportHeight: number;
  overlayWidth: number | null;
  overlayHeight: number | null;
  panX: number;
  panY: number;
};

const CLIP_RASTER_VIEWPORT_EPS_PX = 16;
const CLIP_RASTER_ZOOM_EPS = 0.0001;
const CLIP_RASTER_SIZE_EPS_PX = 0.5;
const CLIP_RASTER_PAN_EPS_PX = CLIP_RASTER_OVERSCAN_PX / 2;

export function clipRasterKey(
  view: PdfPanZoom,
  layoutScale: number,
  viewportWidth: number,
  viewportHeight: number,
  overlay?: CanvasRect | null,
): ClipRasterKey {
  const origin = overlay ? overlayPanZoom(view, overlay) : view;
  return {
    zoom: view.zoom,
    layoutScale,
    viewportWidth,
    viewportHeight,
    overlayWidth: overlay ? overlay.width : null,
    overlayHeight: overlay ? overlay.height : null,
    panX: origin.x,
    panY: origin.y,
  };
}

export function clipRasterKeyEquals(
  a: ClipRasterKey,
  b: ClipRasterKey,
): boolean {
  const overlayOk =
    a.overlayWidth === null && b.overlayWidth === null
      ? true
      : a.overlayWidth !== null &&
        b.overlayWidth !== null &&
        a.overlayHeight !== null &&
        b.overlayHeight !== null &&
        Math.abs(a.overlayWidth - b.overlayWidth) < CLIP_RASTER_SIZE_EPS_PX &&
        Math.abs(a.overlayHeight - b.overlayHeight) < CLIP_RASTER_SIZE_EPS_PX;
  return (
    Math.abs(a.zoom - b.zoom) < CLIP_RASTER_ZOOM_EPS &&
    Math.abs(a.layoutScale - b.layoutScale) < CLIP_RASTER_ZOOM_EPS &&
    Math.abs(a.viewportWidth - b.viewportWidth) < CLIP_RASTER_VIEWPORT_EPS_PX &&
    Math.abs(a.viewportHeight - b.viewportHeight) < CLIP_RASTER_VIEWPORT_EPS_PX &&
    overlayOk &&
    Math.abs(a.panX - b.panX) < CLIP_RASTER_PAN_EPS_PX &&
    Math.abs(a.panY - b.panY) < CLIP_RASTER_PAN_EPS_PX
  );
}

/**
 * Pan/zoom whose origin is this sheet's layout rect, so a clip can CSS-follow
 * both viewport pan/zoom and east/west nudges without re-rasterizing.
 */
export function overlayPanZoom(
  view: PdfPanZoom,
  overlay: CanvasRect,
): PdfPanZoom {
  return {
    x: view.x + overlay.x * view.zoom,
    y: view.y + overlay.y * view.zoom,
    zoom: view.zoom,
  };
}

/**
 * CSS transform that keeps a clip rendered at `rendered` aligned while the
 * live pan/zoom moves. Pan and overlay origin stay on this transform; a new
 * raster is only for zoom / viewport / layout-scale changes.
 */
export function panZoomFollowTransform(
  current: PdfPanZoom,
  rendered: PdfPanZoom,
): { x: number; y: number; scale: number } {
  const scale = rendered.zoom === 0 ? 1 : current.zoom / rendered.zoom;
  return {
    scale,
    x: current.x - rendered.x * scale,
    y: current.y - rendered.y * scale,
  };
}

/**
 * Page-canvas rect → viewport pixels under CSS pan/zoom. Crop chrome uses
 * this so border/handles stay a constant screen width while the sheet zooms.
 */
export function panZoomScreenRect(
  rect: CanvasRect,
  view: PdfPanZoom,
): CanvasRect {
  return {
    x: view.x + rect.x * view.zoom,
    y: view.y + rect.y * view.zoom,
    width: rect.width * view.zoom,
    height: rect.height * view.zoom,
  };
}

/** Page-canvas point → viewport pixels. Pin marks stay a constant screen size. */
export function panZoomScreenPoint(
  point: CanvasPoint,
  view: PdfPanZoom,
): CanvasPoint {
  return {
    x: view.x + point.x * view.zoom,
    y: view.y + point.y * view.zoom,
  };
}

/**
 * Zoom plus the building pin's viewport position. Switching sheets reapplies
 * this so the pin stays on the same screen pixel at the same zoom.
 */
export type PinRelativeView = {
  zoom: number;
  pinScreenX: number;
  pinScreenY: number;
};

export function pinRelativeViewFromTransform(
  view: PdfPanZoom,
  pin: PdfPoint,
  pageHeight: number,
  scale: number,
): PinRelativeView {
  const screen = panZoomScreenPoint(
    pdfPointToCanvas(pin, pageHeight, scale),
    view,
  );
  return {
    zoom: view.zoom,
    pinScreenX: screen.x,
    pinScreenY: screen.y,
  };
}

export function transformFromPinRelativeView(
  stored: PinRelativeView,
  pin: PdfPoint,
  pageHeight: number,
  scale: number,
): PdfPanZoom {
  const canvas = pdfPointToCanvas(pin, pageHeight, scale);
  const zoom = stored.zoom;
  return {
    zoom,
    x: stored.pinScreenX - canvas.x * zoom,
    y: stored.pinScreenY - canvas.y * zoom,
  };
}

/**
 * Pan so a PDF point sits at the viewport center. View x/y are CSS pan of
 * the Y-flipped page canvas — the same space as
 * {@link transformFromPinRelativeView} — not raw PDF y.
 */
export function centerViewOnPagePoint(
  view: PdfPanZoom,
  viewport: { width: number; height: number },
  pagePoint: PdfPoint,
  pageHeight: number,
  layoutScale: number,
): PdfPanZoom {
  return transformFromPinRelativeView(
    {
      zoom: view.zoom,
      pinScreenX: viewport.width / 2,
      pinScreenY: viewport.height / 2,
    },
    pagePoint,
    pageHeight,
    layoutScale,
  );
}

/**
 * Ignore viewport noise (scrollbars) but still recenter when the shell
 * actually grows or shrinks. Same 16px band as clip-raster viewport compares.
 */
export const VIEWPORT_RECENTER_EPS_PX = 16;

export type ViewportResizePan =
  | { action: "none" }
  | { action: "seed" }
  | { action: "recenter"; x: number; y: number };

/**
 * Pan delta when the edit viewport changes size. The first real measurement
 * must not be treated as a grow from 0×0 — that would shift a restored
 * pin-relative view down-right by half the viewport on every sheet remount.
 */
export function viewportResizePanAction(
  previous: { width: number; height: number },
  next: { width: number; height: number },
  epsPx: number = VIEWPORT_RECENTER_EPS_PX,
): ViewportResizePan {
  if (!(previous.width >= 2) || !(previous.height >= 2)) {
    return { action: "seed" };
  }
  if (
    Math.abs(previous.width - next.width) < epsPx &&
    Math.abs(previous.height - next.height) < epsPx
  ) {
    return { action: "none" };
  }
  return {
    action: "recenter",
    x: (next.width - previous.width) / 2,
    y: (next.height - previous.height) / 2,
  };
}

/**
 * Viewport pixels → page-canvas. Inverse of panZoomScreenPoint; used so a
 * click on a zoomed sheet still maps to the same PDF point.
 */
export function panZoomViewportToPage(
  point: CanvasPoint,
  view: PdfPanZoom,
): CanvasPoint {
  const zoom = view.zoom === 0 ? 1 : view.zoom;
  return {
    x: (point.x - view.x) / zoom,
    y: (point.y - view.y) / zoom,
  };
}

function comparePlans(a: FamilyNeighborPlan, b: FamilyNeighborPlan): number {
  if (a.floorNumber !== b.floorNumber) return a.floorNumber - b.floorNumber;
  const nameDelta = (a.name ?? "").localeCompare(b.name ?? "");
  if (nameDelta !== 0) return nameDelta;
  return a.id.localeCompare(b.id);
}

/** Prev/next stay inside the current family, ordered by floor number then name. */
export function familyNeighbors(
  plans: FamilyNeighborPlan[],
  currentId: string,
): { prevId: string | null; nextId: string | null } {
  const current = plans.find((plan) => plan.id === currentId);
  if (!current) return { prevId: null, nextId: null };
  const siblings = plans
    .filter((plan) => plan.familyId === current.familyId)
    .sort(comparePlans);
  const index = siblings.findIndex((plan) => plan.id === currentId);
  if (index < 0) return { prevId: null, nextId: null };
  return {
    prevId: index > 0 ? siblings[index - 1].id : null,
    nextId: index < siblings.length - 1 ? siblings[index + 1].id : null,
  };
}

/** Cropped sheets in a family, in the same order prev/next uses. */
export function familyCroppedPlans<T extends FamilyCroppedNeighborPlan>(
  plans: T[],
  familyId: string,
): T[] {
  return plans
    .filter((plan) => plan.familyId === familyId && plan.hasCropped)
    .sort(comparePlans);
}

/**
 * Prev/next among cropped siblings only. Uncropped uploads are skipped so a
 * compare session never lands on a sheet with nothing to paint.
 */
export function familyCroppedNeighbors(
  plans: FamilyCroppedNeighborPlan[],
  currentId: string,
): { prevId: string | null; nextId: string | null } {
  return familyNeighbors(
    plans.filter((plan) => plan.hasCropped),
    currentId,
  );
}

export type BuildingComparePlan = FamilyCroppedNeighborPlan & {
  hasCropped: boolean;
  pinXPt: number | null;
  pinYPt: number | null;
};

function compareFamilies(
  a: { id: string; sortOrder: number; name: string },
  b: { id: string; sortOrder: number; name: string },
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name);
}

/**
 * Cropped, pinned sheets across the whole building in floor-number order.
 * Layout families (e.g. L vs S variants) interleave by level so compare
 * prev/next matches the sidebar list, not folder drag order.
 */
export function buildingComparePlans<
  T extends BuildingComparePlan,
  F extends { id: string; sortOrder: number; name: string },
>(plans: T[], families: F[]): T[] {
  const familyRank = new Map(
    [...families]
      .sort(compareFamilies)
      .map((family, index) => [family.id, index] as const),
  );
  return plans
    .filter((plan) => plan.hasCropped && planHasPin(plan))
    .sort((a, b) => {
      if (a.floorNumber !== b.floorNumber) return a.floorNumber - b.floorNumber;
      const familyDelta =
        (familyRank.get(a.familyId) ?? 0) - (familyRank.get(b.familyId) ?? 0);
      if (familyDelta !== 0) return familyDelta;
      return comparePlans(a, b);
    });
}

/** Prev/next across every cropped, pinned sheet in the building. */
export function buildingCompareNeighbors<
  T extends BuildingComparePlan,
  F extends { id: string; sortOrder: number; name: string },
>(
  plans: T[],
  families: F[],
  currentId: string,
): { prevId: string | null; nextId: string | null } {
  const ordered = buildingComparePlans(plans, families);
  const index = ordered.findIndex((plan) => plan.id === currentId);
  if (index < 0) return { prevId: null, nextId: null };
  return {
    prevId: index > 0 ? ordered[index - 1].id : null,
    nextId: index < ordered.length - 1 ? ordered[index + 1].id : null,
  };
}

/** Every uploaded sheet in folder order (family drag order, then floor number). */
export function buildingPlanOrder<
  T extends FamilyNeighborPlan,
  F extends { id: string; sortOrder: number; name: string },
>(plans: T[], families: F[]): T[] {
  const familyRank = new Map(
    [...families]
      .sort(compareFamilies)
      .map((family, index) => [family.id, index] as const),
  );
  return [...plans].sort((a, b) => {
    const familyDelta =
      (familyRank.get(a.familyId) ?? 0) - (familyRank.get(b.familyId) ?? 0);
    if (familyDelta !== 0) return familyDelta;
    return comparePlans(a, b);
  });
}

/** Prev/next across every floor plan in the building. */
export function buildingPlanNeighbors<
  T extends FamilyNeighborPlan,
  F extends { id: string; sortOrder: number; name: string },
>(
  plans: T[],
  families: F[],
  currentId: string,
): { prevId: string | null; nextId: string | null } {
  const ordered = buildingPlanOrder(plans, families);
  const index = ordered.findIndex((plan) => plan.id === currentId);
  if (index < 0) return { prevId: null, nextId: null };
  return {
    prevId: index > 0 ? ordered[index - 1].id : null,
    nextId: index < ordered.length - 1 ? ordered[index + 1].id : null,
  };
}

/** Every uploaded sheet in floor-number order, ignoring family. */
export function globalPlanOrder<T extends FamilyNeighborPlan>(plans: T[]): T[] {
  return [...plans].sort(comparePlans);
}

/**
 * Flat sidebar list: floor number lowest to highest, ignoring family folders.
 */
export function flatPlanOrder<T extends FamilyNeighborPlan>(plans: T[]): T[] {
  return globalPlanOrder(plans);
}

/** Prev/next across every floor plan in floor-number order. */
export function globalPlanNeighbors(
  plans: FamilyNeighborPlan[],
  currentId: string,
): { prevId: string | null; nextId: string | null } {
  const ordered = globalPlanOrder(plans);
  const index = ordered.findIndex((plan) => plan.id === currentId);
  if (index < 0) return { prevId: null, nextId: null };
  return {
    prevId: index > 0 ? ordered[index - 1].id : null,
    nextId: index < ordered.length - 1 ? ordered[index + 1].id : null,
  };
}

const COORD_EPSILON = 0.05;

export function pdfPointsEqual(
  a: PdfPoint,
  b: PdfPoint,
  epsilon = COORD_EPSILON,
): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}

export function pdfRectsEqual(
  a: PdfRect,
  b: PdfRect,
  epsilon = COORD_EPSILON,
): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}

export function savedPlanPin(plan: {
  pinXPt: number | null;
  pinYPt: number | null;
}): PdfPoint | null {
  return planHasPin(plan) ? { x: plan.pinXPt!, y: plan.pinYPt! } : null;
}

export function savedPlanCrop(
  plan: {
    hasCropped: boolean;
    cropXPt: number | null;
    cropYPt: number | null;
  },
  family: { cropWidthPt: number | null; cropHeightPt: number | null },
): PdfRect | null {
  if (!plan.hasCropped || plan.cropXPt == null || plan.cropYPt == null) {
    return null;
  }
  if (family.cropWidthPt == null || family.cropHeightPt == null) {
    return null;
  }
  return {
    x: plan.cropXPt,
    y: plan.cropYPt,
    width: family.cropWidthPt,
    height: family.cropHeightPt,
  };
}

export function pinDraftIsDirty(
  plan: { pinXPt: number | null; pinYPt: number | null },
  draft: PdfPoint | null,
): boolean {
  const saved = savedPlanPin(plan);
  if (!saved) return draft != null;
  if (!draft) return false;
  return !pdfPointsEqual(draft, saved);
}

export function cropDraftIsDirty(
  plan: {
    hasCropped: boolean;
    cropXPt: number | null;
    cropYPt: number | null;
  },
  family: { cropWidthPt: number | null; cropHeightPt: number | null },
  draft: PdfRect,
): boolean {
  const saved = savedPlanCrop(plan, family);
  if (!saved) return true;
  return !pdfRectsEqual(draft, saved);
}

export type CropOverlayCandidate = {
  id: string;
  familyId: string;
  name: string;
  floorNumber: number;
  hasCropped: boolean;
};

function compareOverlayCandidates(
  a: CropOverlayCandidate,
  b: CropOverlayCandidate,
): number {
  return comparePlans(a, b);
}

/** Cropped siblings in the same family, for the crop-editor overlay dropdown. */
export function cropOverlayCandidates<T extends CropOverlayCandidate>(
  plans: T[],
  plan: { id: string; familyId: string },
): T[] {
  return plans
    .filter(
      (item) =>
        item.familyId === plan.familyId &&
        item.id !== plan.id &&
        item.hasCropped,
    )
    .sort(compareOverlayCandidates);
}

/** Cropped and pinned sheets anywhere in the building, for edit-mode overlay. */
export function editOverlayCandidates<T extends CropOverlayCandidate>(
  plans: T[],
  plan: { id: string },
): T[] {
  return plans
    .filter(
      (item) =>
        item.id !== plan.id &&
        item.hasCropped &&
        planHasPin(item as { pinXPt: number | null; pinYPt: number | null }),
    )
    .sort(compareOverlayCandidates);
}

export type EditOverlayPlateLayout = {
  /** Pin-aligned offset from the draft crop's top-left on the original-page canvas. */
  offset: CanvasPoint;
  scale: number;
  width: number;
  height: number;
};

/**
 * Pin-align an overlay cropped plate onto the sheet being edited. The draft
 * crop renders on the original PDF at `pageScale`; architectural scale
 * differences use the same multipliers as compare mode.
 */
export function editOverlayPlateLayout(
  anchorPin: PdfPoint,
  anchorCropOrigin: PdfPoint,
  anchorCropHeight: number,
  anchorFamily: { scaleDenominator?: number | null },
  overlayPlan: {
    pinXPt: number | null;
    pinYPt: number | null;
    cropXPt: number | null;
    cropYPt: number | null;
  },
  overlayFamily: {
    cropWidthPt: number | null;
    cropHeightPt: number | null;
    scaleDenominator?: number | null;
  },
  pageScale: number,
): EditOverlayPlateLayout | null {
  const referenceDenominator = resolveCompareReferenceScaleDenominator(
    anchorFamily,
    [overlayFamily],
  );
  const anchorFamilyScale = effectiveFamilyScale(
    pageScale,
    anchorFamily,
    referenceDenominator,
  );
  const overlayFamilyScale = effectiveFamilyScale(
    pageScale,
    overlayFamily,
    referenceDenominator,
  );
  const anchorRenderScale = pageScale;
  const overlayRenderScale =
    anchorFamilyScale > 0
      ? pageScale * (overlayFamilyScale / anchorFamilyScale)
      : pageScale;

  const offset = compareSheetCanvasOffset(
    {
      pinXPt: anchorPin.x,
      pinYPt: anchorPin.y,
      cropXPt: anchorCropOrigin.x,
      cropYPt: anchorCropOrigin.y,
    },
    { cropHeightPt: anchorCropHeight },
    overlayPlan,
    overlayFamily,
    anchorRenderScale,
    overlayRenderScale,
  );

  if (
    !offset ||
    overlayFamily.cropWidthPt == null ||
    overlayFamily.cropHeightPt == null
  ) {
    return null;
  }

  return {
    offset,
    scale: overlayRenderScale,
    width: overlayFamily.cropWidthPt * overlayRenderScale,
    height: overlayFamily.cropHeightPt * overlayRenderScale,
  };
}

/** Pin used to align sheet/line overlays in edit mode. */
export function resolveOverlayAnchorPin(
  draftPin: PdfPoint | null,
  plan: { pinXPt: number | null; pinYPt: number | null },
  suggestedPin: PdfPoint | null,
): PdfPoint | null {
  return draftPin ?? savedPlanPin(plan) ?? suggestedPin;
}

/** Why a sheet overlay is enabled but not visible, or null when it should render. */
export function editOverlayBlockedReason(input: {
  overlayActive: boolean;
  overlayPlan: {
    pinXPt: number | null;
    pinYPt: number | null;
    cropXPt: number | null;
    cropYPt: number | null;
  } | null;
  overlayFamily: {
    cropWidthPt: number | null;
    cropHeightPt: number | null;
  } | null;
  alignmentPin: PdfPoint | null;
  cropAwaitingPin: boolean;
}): string | null {
  if (!input.overlayActive || !input.overlayPlan) return null;
  if (input.cropAwaitingPin && !input.alignmentPin) {
    return "Place the building pin first — the crop rectangle sits relative to it.";
  }
  if (!input.alignmentPin) {
    return "Place the building pin or reference anchor on this floor to align the overlay.";
  }
  if (!input.overlayFamily) {
    return "The overlay floor's drawing set could not be loaded.";
  }
  if (
    input.overlayFamily.cropWidthPt == null ||
    input.overlayFamily.cropHeightPt == null
  ) {
    return "The overlay floor's family does not have a crop plate size yet.";
  }
  if (!planPinOnCropped(input.overlayPlan)) {
    return "The overlay floor is missing crop coordinates — save its crop first.";
  }
  return null;
}

/**
 * Prefer the nearest already-cropped sheet at or below this floor. Falls
 * back to the first sibling so a later recrop still has a default overlay.
 */
export function defaultCropOverlayId(
  candidates: Array<{ id: string; floorNumber: number }>,
  planFloorNumber: number,
): string | null {
  if (candidates.length === 0) return null;
  const prev = [...candidates]
    .reverse()
    .find((item) => item.floorNumber <= planFloorNumber);
  return prev?.id ?? candidates[0].id;
}

export function planHasPin(plan: {
  pinXPt: number | null;
  pinYPt: number | null;
}): boolean {
  return (
    plan.pinXPt != null &&
    Number.isFinite(plan.pinXPt) &&
    plan.pinYPt != null &&
    Number.isFinite(plan.pinYPt)
  );
}

export function buildingHasPin(settings: {
  pinXPt: number | null;
  pinYPt: number | null;
}): boolean {
  return planHasPin(settings);
}

export function planHasReferenceAnchor(plan: {
  referenceAnchorXPt: number | null;
  referenceAnchorYPt: number | null;
}): boolean {
  return (
    plan.referenceAnchorXPt != null &&
    Number.isFinite(plan.referenceAnchorXPt) &&
    plan.referenceAnchorYPt != null &&
    Number.isFinite(plan.referenceAnchorYPt)
  );
}

export function savedPlanReferenceAnchor(plan: {
  referenceAnchorXPt: number | null;
  referenceAnchorYPt: number | null;
}): PdfPoint | null {
  return planHasReferenceAnchor(plan)
    ? { x: plan.referenceAnchorXPt!, y: plan.referenceAnchorYPt! }
    : null;
}

export function referenceAnchorDraftIsDirty(
  plan: {
    referenceAnchorXPt: number | null;
    referenceAnchorYPt: number | null;
  },
  draft: PdfPoint | null,
): boolean {
  const saved = savedPlanReferenceAnchor(plan);
  if (!saved) return draft != null;
  if (!draft) return false;
  return !pdfPointsEqual(draft, saved);
}

/** Offset from reference anchor to building pin on the calibration floor. */
export function pinOffsetFromReferenceAnchor(
  calibrationPlan: {
    pinXPt: number | null;
    pinYPt: number | null;
    referenceAnchorXPt: number | null;
    referenceAnchorYPt: number | null;
  },
): PdfPoint | null {
  const pin = savedPlanPin(calibrationPlan);
  const anchor = savedPlanReferenceAnchor(calibrationPlan);
  if (!pin || !anchor) return null;
  return { x: pin.x - anchor.x, y: pin.y - anchor.y };
}

/**
 * Infer the building pin on a target floor from its reference anchor and the
 * calibration floor's pin-to-anchor offset.
 */
export function pinFromReferenceAnchor(
  calibrationPlan: {
    pinXPt: number | null;
    pinYPt: number | null;
    referenceAnchorXPt: number | null;
    referenceAnchorYPt: number | null;
  },
  targetAnchor: PdfPoint,
  page: PdfSize,
): PdfPoint | null {
  const offset = pinOffsetFromReferenceAnchor(calibrationPlan);
  if (!offset) return null;
  return clampPin(
    { x: targetAnchor.x + offset.x, y: targetAnchor.y + offset.y },
    page,
  );
}

export function resolvePinReferencePlan<
  T extends {
    id: string;
    pinXPt: number | null;
    pinYPt: number | null;
    referenceAnchorXPt: number | null;
    referenceAnchorYPt: number | null;
  },
>(settings: { pinReferencePlanId: string | null }, plans: T[]): T | null {
  const candidates = plans.filter(
    (plan) => planHasPin(plan) && planHasReferenceAnchor(plan),
  );
  if (candidates.length === 0) return null;
  if (settings.pinReferencePlanId) {
    const selected = candidates.find(
      (plan) => plan.id === settings.pinReferencePlanId,
    );
    if (selected) return selected;
  }
  return candidates[0] ?? null;
}

export function pinReferencePlanCandidates<
  T extends {
    id: string;
    pinXPt: number | null;
    pinYPt: number | null;
    referenceAnchorXPt: number | null;
    referenceAnchorYPt: number | null;
  },
>(plans: T[]): T[] {
  return plans.filter(
    (plan) => planHasPin(plan) && planHasReferenceAnchor(plan),
  );
}

/** Pin position on the original PDF when the crop window is at `crop`. */
export function buildingPinOnOriginalPage(
  crop: PdfRect,
  pin: PdfPoint,
): PdfPoint {
  return { x: crop.x + pin.x, y: crop.y + pin.y };
}

/** Inverse of buildingPinOnOriginalPage: pin in cropped-plate coordinates. */
export function pinOnCroppedPlate(
  originalPin: PdfPoint,
  cropOrigin: PdfPoint,
): PdfPoint {
  return { x: originalPin.x - cropOrigin.x, y: originalPin.y - cropOrigin.y };
}

/** Pin on the cropped plate, or null when this sheet is not pinned and cropped. */
export function planPinOnCropped(plan: {
  pinXPt: number | null;
  pinYPt: number | null;
  cropXPt: number | null;
  cropYPt: number | null;
}): PdfPoint | null {
  if (!planHasPin(plan) || plan.cropXPt == null || plan.cropYPt == null) {
    return null;
  }
  return pinOnCroppedPlate(
    { x: plan.pinXPt!, y: plan.pinYPt! },
    { x: plan.cropXPt, y: plan.cropYPt },
  );
}

export type FamilyPlatePinPlan = {
  id: string;
  familyId: string;
  floorNumber: number;
  pinXPt: number | null;
  pinYPt: number | null;
  cropXPt: number | null;
  cropYPt: number | null;
};

/**
 * Pin-on-plate offset from the nearest cropped sibling at or below this
 * floor. Registration is for building-wide pin alignment; crop placement
 * within a family should follow the closest already-cropped sheet.
 */
export function familyPlatePin(
  plans: FamilyPlatePinPlan[],
  plan: { id: string; familyId: string; floorNumber: number },
): PdfPoint | null {
  const siblings = plans
    .filter(
      (item) =>
        item.familyId === plan.familyId &&
        item.id !== plan.id &&
        planPinOnCropped(item) != null,
    )
    .sort(
      (a, b) => a.floorNumber - b.floorNumber || a.id.localeCompare(b.id),
    );
  if (siblings.length === 0) return null;
  const prev = [...siblings]
    .reverse()
    .find((item) => item.floorNumber <= plan.floorNumber);
  return planPinOnCropped(prev ?? siblings[0]);
}

/**
 * Place the family plate so `pin` lands on `platePin` (or the plate center
 * when the family has no sibling offset yet). Origin is clamped to the page.
 */
export function cropAlignedToPin(
  pin: PdfPoint,
  familySize: PdfSize,
  page: PdfSize,
  platePin: PdfPoint | null,
): PdfRect {
  const offset = platePin ?? {
    x: familySize.width / 2,
    y: familySize.height / 2,
  };
  return applyFamilyCropSize(
    familySize,
    {
      x: pin.x - offset.x,
      y: pin.y - offset.y,
      width: familySize.width,
      height: familySize.height,
    },
    page,
  );
}

/**
 * Hide the crop rectangle on a new sheet in a family that already has a
 * plate, until a pin exists so the rect can sit on that pin. A brand-new
 * family with no plate still shows the rect so the first crop can be drawn.
 */
export function cropWaitsForPin(input: {
  familyHasPlate: boolean;
  hasSavedCrop: boolean;
  hasPin: boolean;
}): boolean {
  return input.familyHasPlate && !input.hasSavedCrop && !input.hasPin;
}

export type CompareStackFamily = {
  cropWidthPt: number | null;
  cropHeightPt: number | null;
  scaleDenominator?: number | null;
};

/** Screen zoom boost for coarser architectural scales (higher denominator = more zoomed-out on paper). */
export function familyDisplayScaleMultiplier(
  familyDenominator: number | null | undefined,
  referenceDenominator: number | null | undefined,
): number {
  if (
    familyDenominator == null ||
    referenceDenominator == null ||
    familyDenominator <= 0 ||
    referenceDenominator <= 0
  ) {
    return 1;
  }
  return familyDenominator / referenceDenominator;
}

/** Canvas scale for one family, given a base layout scale and reference architectural scale. */
export function effectiveFamilyScale(
  baseScale: number,
  family: { scaleDenominator?: number | null },
  referenceDenominator: number | null | undefined,
): number {
  return (
    baseScale *
    familyDisplayScaleMultiplier(family.scaleDenominator, referenceDenominator)
  );
}

/** Rendered crop size for one compare sheet at a base layout scale. */
export function compareSheetRenderSize(
  baseScale: number,
  family: CompareStackFamily,
  referenceDenominator: number | null | undefined,
): { width: number; height: number } {
  const sheetScale = effectiveFamilyScale(
    baseScale,
    family,
    referenceDenominator,
  );
  return {
    width: (family.cropWidthPt ?? 0) * sheetScale,
    height: (family.cropHeightPt ?? 0) * sheetScale,
  };
}

/** Finest (most zoomed-in) architectural scale in the compare stack — baseline screen zoom. */
export function resolveCompareReferenceScaleDenominator(
  _anchorFamily: { scaleDenominator?: number | null },
  sheetFamilies: Array<{ scaleDenominator?: number | null }>,
): number | null {
  const denominators = sheetFamilies
    .map((family) => family.scaleDenominator)
    .filter((value): value is number => value != null && value > 0);
  if (denominators.length === 0) return null;
  return Math.min(...denominators);
}

/** Registration sheet when it is compare-ready, otherwise the first compare sheet. */
export function resolveCompareAnchor<T extends BuildingComparePlan>(
  compareSheets: T[],
  registrationPlanId: string | null,
): T | null {
  if (compareSheets.length === 0) return null;
  if (registrationPlanId) {
    const registered = compareSheets.find(
      (sheet) => sheet.id === registrationPlanId,
    );
    if (registered) return registered;
  }
  return compareSheets[0];
}

/** Canvas offset so a sheet's pin lands on the anchor pin (anchor at 0,0). */
export function compareSheetCanvasOffset(
  anchorPlan: {
    pinXPt: number | null;
    pinYPt: number | null;
    cropXPt: number | null;
    cropYPt: number | null;
  },
  anchorFamily: { cropHeightPt: number | null },
  sheetPlan: {
    pinXPt: number | null;
    pinYPt: number | null;
    cropXPt: number | null;
    cropYPt: number | null;
  },
  sheetFamily: { cropHeightPt: number | null },
  anchorScale: number,
  sheetScale: number = anchorScale,
): CanvasPoint | null {
  const anchorPin = planPinOnCropped(anchorPlan);
  const sheetPin = planPinOnCropped(sheetPlan);
  if (
    !anchorPin ||
    !sheetPin ||
    anchorFamily.cropHeightPt == null ||
    sheetFamily.cropHeightPt == null
  ) {
    return null;
  }
  return pinOverlayCanvasOffset(
    anchorPin,
    anchorFamily.cropHeightPt,
    sheetPin,
    sheetFamily.cropHeightPt,
    anchorScale,
    sheetScale,
  );
}

export type CompareStackLayout = {
  width: number;
  height: number;
  /** Per-sheet offsets normalized so the bounding box starts at (0, 0). */
  offsets: Record<string, CanvasPoint>;
  /** Fixed registration pin position within the stack container. */
  pinX: number;
  pinY: number;
};

/**
 * Pin-aligned layout for compare mode: every sheet offset so registration pins
 * coincide, with a fixed bounding box and pin mark position for the modal.
 */
export function compareStackLayout(
  anchorPlan: BuildingComparePlan,
  anchorFamily: CompareStackFamily,
  sheets: Array<{ plan: BuildingComparePlan; family: CompareStackFamily }>,
  baseScale: number,
  referenceScaleDenominator?: number | null,
): CompareStackLayout | null {
  const anchorPin = planPinOnCropped(anchorPlan);
  const anchorHeight = anchorFamily.cropHeightPt;
  if (!anchorPin || anchorHeight == null) return null;

  const referenceDenominator =
    referenceScaleDenominator ??
    resolveCompareReferenceScaleDenominator(
      anchorFamily,
      sheets.map((entry) => entry.family),
    );
  const anchorScale = effectiveFamilyScale(
    baseScale,
    anchorFamily,
    referenceDenominator,
  );
  const anchorPinCanvas = pdfPointToCanvas(anchorPin, anchorHeight, anchorScale);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rawOffsets: Record<string, CanvasPoint> = {};

  for (const { plan, family } of sheets) {
    const sheetScale = effectiveFamilyScale(
      baseScale,
      family,
      referenceDenominator,
    );
    const raw = compareSheetCanvasOffset(
      anchorPlan,
      anchorFamily,
      plan,
      family,
      anchorScale,
      sheetScale,
    );
    if (!raw) continue;

    const w = (family.cropWidthPt ?? 0) * sheetScale;
    const h = (family.cropHeightPt ?? 0) * sheetScale;
    minX = Math.min(minX, raw.x);
    minY = Math.min(minY, raw.y);
    maxX = Math.max(maxX, raw.x + w);
    maxY = Math.max(maxY, raw.y + h);
    rawOffsets[plan.id] = raw;
  }

  if (minX === Infinity || Object.keys(rawOffsets).length === 0) return null;

  const offsets: Record<string, CanvasPoint> = {};
  for (const [id, raw] of Object.entries(rawOffsets)) {
    offsets[id] = { x: raw.x - minX, y: raw.y - minY };
  }

  return {
    width: maxX - minX,
    height: maxY - minY,
    offsets,
    pinX: anchorPinCanvas.x - minX,
    pinY: anchorPinCanvas.y - minY,
  };
}

export type FloorPlanStatus = "unmerged" | "uploaded" | "cropped" | "pinned";

export function floorPlanStatus(input: {
  cropped: boolean;
  pinned: boolean;
  needsMerge?: boolean;
}): FloorPlanStatus {
  if (input.needsMerge) return "unmerged";
  if (input.pinned) return "pinned";
  if (input.cropped) return "cropped";
  return "uploaded";
}
