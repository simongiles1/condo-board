"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  canvasPointToPdf,
  canvasRectToPdf,
  clampCropOrigin,
  clampCropToPage,
  MIN_CROP_PT,
  panZoomViewportToPage,
  pdfRectToCanvas,
  resizeCanvasRectFromHandle,
  type CanvasPoint,
  type CanvasRect,
  type CropHandleKind,
  type PdfPanZoom,
  type PdfPoint,
  type PdfRect,
  type PdfSize,
} from "@/lib/building/floor-plan-align";
import { pdfDeltaPerScreenPixel } from "@/lib/building/floor-plan-draw-snap";
import {
  floorPlanFileUrl,
  floorPlanLabel,
  type FloorPlanDto,
} from "@/lib/building/floor-plan-shared";
import {
  nudgeEastOffset,
  nudgeWestOffset,
  resolvedEastOffset,
  resolvedSheetCrop,
  splitCanvasLayout,
  splitSheetSizes,
  type SplitAlignDraft,
} from "@/lib/building/floor-plan-split";

import { usePdfSession } from "@/lib/pdf/use-pdf-session";

import { FloorPlanExpandIcon } from "./FloorPlanCropEditor";
import { FloorPlanPdfCanvas, FloorPlanPdfClipCanvas } from "./FloorPlanPdfCanvas";
import { FloorPlanZoomToolbar } from "./FloorPlanZoomToolbar";

const IDENTITY_VIEW: PdfPanZoom = { x: 0, y: 0, zoom: 1 };
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 16;
const FIT_PAD = 48;
const HANDLE_HIT_PX = 10;
const VIEWPORT_SIZE_EPS_PX = 16;

type AlignSheet = "west" | "east";
type AlignTool = "align" | "crop";
type CropTone = "west" | "east";

const HANDLE_KINDS: CropHandleKind[] = ["n", "e", "s", "w", "nw", "ne", "sw", "se"];

const HANDLE_CLASS: Record<CropHandleKind, string> = {
  n: "pointer-events-auto left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
  e: "pointer-events-auto right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  s: "pointer-events-auto left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
  w: "pointer-events-auto left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  nw: "pointer-events-auto left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  ne: "pointer-events-auto right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  sw: "pointer-events-auto left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  se: "pointer-events-auto right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
};

const HANDLE_CURSOR: Record<CropHandleKind, string> = {
  n: "ns-resize",
  e: "ew-resize",
  s: "ns-resize",
  w: "ew-resize",
  nw: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  se: "nwse-resize",
};

function alignHoverCursor(
  tool: AlignTool,
  selectedSheet: AlignSheet,
  pagePoint: CanvasPoint,
  westCanvas: CanvasRect,
  eastCanvas: CanvasRect,
  westCropCanvas: CanvasRect,
  eastCropCanvas: CanvasRect,
  handleSlop: number,
): string {
  if (tool === "crop") {
    const selectedCrop =
      selectedSheet === "east" ? eastCropCanvas : westCropCanvas;
    const handle = hitCropHandle(selectedCrop, pagePoint, handleSlop);
    if (handle) return HANDLE_CURSOR[handle];
    if (pointInRect(pagePoint, selectedCrop)) return "move";
    if (pointInRect(pagePoint, eastCanvas) || pointInRect(pagePoint, westCanvas)) {
      return "crosshair";
    }
    return "grab";
  }
  return "grab";
}

const CROP_TONE_CLASS: Record<CropTone, { box: string; handle: string }> = {
  west: {
    box: "border-2 border-sky-500 bg-sky-500/10",
    handle: "border border-white bg-sky-600",
  },
  east: {
    box: "border-2 border-rose-500 bg-rose-500/10",
    handle: "border border-white bg-rose-600",
  },
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function fitView(
  viewport: HTMLElement,
  page: { width: number; height: number },
  scale: number,
): PdfPanZoom {
  const zoom = Math.min(
    (viewport.clientWidth - FIT_PAD) / (page.width * scale),
    (viewport.clientHeight - FIT_PAD) / (page.height * scale),
    ZOOM_MAX,
  );
  const clamped = Math.max(zoom, ZOOM_MIN);
  return {
    zoom: clamped,
    x: (viewport.clientWidth - page.width * scale * clamped) / 2,
    y: (viewport.clientHeight - page.height * scale * clamped) / 2,
  };
}

function zoomAround(
  view: PdfPanZoom,
  factor: number,
  originX: number,
  originY: number,
): PdfPanZoom {
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom * factor));
  if (next === view.zoom) return view;
  const ratio = next / view.zoom;
  return {
    zoom: next,
    x: originX - (originX - view.x) * ratio,
    y: originY - (originY - view.y) * ratio,
  };
}

function pointInRect(point: CanvasPoint, rect: CanvasRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function cropOnLayout(
  crop: PdfRect,
  sheetCanvas: CanvasRect,
  pageHeight: number,
  scale: number,
): CanvasRect {
  const local = pdfRectToCanvas(crop, pageHeight, scale);
  return {
    x: sheetCanvas.x + local.x,
    y: sheetCanvas.y + local.y,
    width: local.width,
    height: local.height,
  };
}

function hitCropHandle(
  rect: CanvasRect,
  point: CanvasPoint,
  slop: number,
): CropHandleKind | null {
  const handles: { kind: CropHandleKind; x: number; y: number }[] = [
    { kind: "n", x: rect.x + rect.width / 2, y: rect.y },
    { kind: "e", x: rect.x + rect.width, y: rect.y + rect.height / 2 },
    { kind: "s", x: rect.x + rect.width / 2, y: rect.y + rect.height },
    { kind: "w", x: rect.x, y: rect.y + rect.height / 2 },
    { kind: "nw", x: rect.x, y: rect.y },
    { kind: "ne", x: rect.x + rect.width, y: rect.y },
    { kind: "sw", x: rect.x, y: rect.y + rect.height },
    { kind: "se", x: rect.x + rect.width, y: rect.y + rect.height },
  ];
  let best: CropHandleKind | null = null;
  let bestDist = slop;
  for (const handle of handles) {
    const dist = Math.hypot(point.x - handle.x, point.y - handle.y);
    if (dist <= bestDist) {
      best = handle.kind;
      bestDist = dist;
    }
  }
  return best;
}

function layoutPointToSheetPdf(
  pagePoint: CanvasPoint,
  sheetCanvas: CanvasRect,
  sheet: PdfSize,
  scale: number,
): PdfPoint | null {
  if (!pointInRect(pagePoint, sheetCanvas)) return null;
  return canvasPointToPdf(
    { x: pagePoint.x - sheetCanvas.x, y: pagePoint.y - sheetCanvas.y },
    sheet.height,
    scale,
  );
}

function rubberBandCrop(start: PdfPoint, now: PdfPoint, page: PdfSize): PdfRect {
  return clampCropToPage(
    {
      x: Math.min(start.x, now.x),
      y: Math.min(start.y, now.y),
      width: Math.abs(now.x - start.x),
      height: Math.abs(now.y - start.y),
    },
    page,
  );
}

function cropsFromPlan(
  plan: FloorPlanDto,
  sheets: { west: PdfSize; east: PdfSize },
): { west: PdfRect; east: PdfRect } {
  return {
    west: resolvedSheetCrop(sheets.west, {
      x: plan.westCropXPt,
      y: plan.westCropYPt,
      width: plan.westCropWidthPt,
      height: plan.westCropHeightPt,
    }),
    east: resolvedSheetCrop(sheets.east, {
      x: plan.eastCropXPt,
      y: plan.eastCropYPt,
      width: plan.eastCropWidthPt,
      height: plan.eastCropHeightPt,
    }),
  };
}

export function FloorPlanSplitAlignEditor({
  plan,
  scale,
  saving,
  expanded,
  embeddedExpanded = false,
  onExpandedChange,
  onSaveAlign,
  onMerge,
}: {
  plan: FloorPlanDto;
  scale: number;
  saving: boolean;
  expanded: boolean;
  embeddedExpanded?: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSaveAlign: (draft: SplitAlignDraft) => Promise<void>;
  onMerge: (draft: SplitAlignDraft) => Promise<void>;
}) {
  const sheets = useMemo(
    () => splitSheetSizes(plan),
    [
      plan.westPageWidthPt,
      plan.westPageHeightPt,
      plan.eastPageWidthPt,
      plan.eastPageHeightPt,
    ],
  );
  const [offset, setOffset] = useState<PdfPoint>(() =>
    sheets
      ? resolvedEastOffset(sheets.west, sheets.east, {
          x: plan.eastOffsetXPt,
          y: plan.eastOffsetYPt,
        })
      : { x: 0, y: 0 },
  );
  const [westCrop, setWestCrop] = useState<PdfRect>(() =>
    sheets
      ? cropsFromPlan(plan, sheets).west
      : { x: 0, y: 0, width: 1, height: 1 },
  );
  const [eastCrop, setEastCrop] = useState<PdfRect>(() =>
    sheets
      ? cropsFromPlan(plan, sheets).east
      : { x: 0, y: 0, width: 1, height: 1 },
  );
  const [westOpacity, setWestOpacity] = useState(0.7);
  const [eastOpacity, setEastOpacity] = useState(0.7);
  const [selectedSheet, setSelectedSheet] = useState<AlignSheet>("east");
  const [tool, setTool] = useState<AlignTool>("align");
  const [view, setView] = useState<PdfPanZoom>(IDENTITY_VIEW);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [westClipPainted, setWestClipPainted] = useState(false);
  const [eastClipPainted, setEastClipPainted] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const westCropRef = useRef(westCrop);
  westCropRef.current = westCrop;
  const eastCropRef = useRef(eastCrop);
  eastCropRef.current = eastCrop;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const selectedSheetRef = useRef(selectedSheet);
  selectedSheetRef.current = selectedSheet;
  const dragRef = useRef<
    | {
        kind: "sheet";
        sheet: AlignSheet;
        startX: number;
        startY: number;
        origin: PdfPoint;
      }
    | { kind: "pan"; startX: number; startY: number; originX: number; originY: number }
    | {
        kind: "crop-move";
        sheet: AlignSheet;
        startX: number;
        startY: number;
        origin: PdfRect;
      }
    | {
        kind: "crop-handle";
        sheet: AlignSheet;
        handle: CropHandleKind;
        origin: PdfRect;
      }
    | {
        kind: "crop-draw";
        sheet: AlignSheet;
        startPdf: PdfPoint;
        previous: PdfRect;
      }
    | null
  >(null);

  useEffect(() => {
    const sizes = splitSheetSizes(plan);
    setOffset(
      sizes
        ? resolvedEastOffset(sizes.west, sizes.east, {
            x: plan.eastOffsetXPt,
            y: plan.eastOffsetYPt,
          })
        : { x: 0, y: 0 },
    );
    if (sizes) {
      const next = cropsFromPlan(plan, sizes);
      setWestCrop(next.west);
      setEastCrop(next.east);
    }
  }, [plan.id]);

  const layout = useMemo(() => {
    if (!sheets) return null;
    return splitCanvasLayout(sheets.west, sheets.east, offset);
  }, [sheets, offset]);

  // West/east bytes do not change while nudging — only updatedAt does after save.
  const fileCacheBust = useMemo(() => plan.updatedAt, [plan.id]);
  const westUrl = useMemo(
    () => floorPlanFileUrl(plan.id, "west", fileCacheBust),
    [fileCacheBust, plan.id],
  );
  const eastUrl = useMemo(
    () => floorPlanFileUrl(plan.id, "east", fileCacheBust),
    [fileCacheBust, plan.id],
  );
  usePdfSession(true, [westUrl, eastUrl]);

  const resetView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !layout) return;
    setView(fitView(viewport, layout, scale));
  }, [layout, scale]);

  const zoomBy = useCallback(
    (factor: number, originX?: number, originY?: number) => {
      const viewport = viewportRef.current;
      setView((current) => {
        const ox = originX ?? (viewport ? viewport.clientWidth / 2 : 0);
        const oy = originY ?? (viewport ? viewport.clientHeight / 2 : 0);
        return zoomAround(current, factor, ox, oy);
      });
    },
    [],
  );

  const fittedForExpandRef = useRef(false);
  useEffect(() => {
    if (!expanded) {
      setView(IDENTITY_VIEW);
      fittedForExpandRef.current = false;
    }
  }, [expanded]);

  useLayoutEffect(() => {
    if (!expanded || fittedForExpandRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport || !layout || viewport.clientWidth < 2) return;
    setView(fitView(viewport, layout, scale));
    fittedForExpandRef.current = true;
  }, [expanded, layout, scale]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const sync = () => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      setViewportSize((prev) => {
        if (
          Math.abs(prev.width - width) < VIEWPORT_SIZE_EPS_PX &&
          Math.abs(prev.height - height) < VIEWPORT_SIZE_EPS_PX
        ) {
          return prev;
        }
        return { width, height };
      });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [expanded, layout]);

  useEffect(() => {
    setWestClipPainted(false);
    setEastClipPainted(false);
  }, [westUrl, eastUrl]);

  const currentDraft = useCallback(
    (): SplitAlignDraft => ({
      offset: offsetRef.current,
      westCrop: westCropRef.current,
      eastCrop: eastCropRef.current,
    }),
    [],
  );

  const persistDraft = useCallback(
    (next?: SplitAlignDraft) => {
      void onSaveAlign(next ?? currentDraft());
    },
    [currentDraft, onSaveAlign],
  );

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveAlignRef = useRef(onSaveAlign);
  onSaveAlignRef.current = onSaveAlign;
  const schedulePersistDraft = useCallback(
    (next: SplitAlignDraft) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void onSaveAlignRef.current(next);
      }, 400);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (!saveTimerRef.current) return;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      void onSaveAlignRef.current(currentDraft());
    };
  }, [currentDraft]);

  useEffect(() => {
    if (!layout) return;
    const node = viewportRef.current;
    if (!node) return;

    function onWheel(event: WheelEvent) {
      const el = viewportRef.current;
      if (!el) return;
      event.preventDefault();
      const bounds = el.getBoundingClientRect();
      zoomBy(
        event.deltaY > 0 ? 0.9 : 1.1,
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    }

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [layout, zoomBy]);

  const westCanvas = useMemo(() => {
    if (!sheets || !layout) return null;
    return pdfRectToCanvas(
      {
        x: layout.west.x,
        y: layout.west.y,
        width: sheets.west.width,
        height: sheets.west.height,
      },
      layout.height,
      scale,
    );
  }, [layout, scale, sheets]);
  const eastCanvas = useMemo(() => {
    if (!sheets || !layout) return null;
    return pdfRectToCanvas(
      {
        x: layout.east.x,
        y: layout.east.y,
        width: sheets.east.width,
        height: sheets.east.height,
      },
      layout.height,
      scale,
    );
  }, [layout, scale, sheets]);

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || !layout || !sheets || !westCanvas || !eastCanvas) return;
      if (drag.kind === "pan") {
        setView({
          ...viewRef.current,
          x: drag.originX + (event.clientX - drag.startX),
          y: drag.originY + (event.clientY - drag.startY),
        });
        return;
      }
      const viewport = viewportRef.current;
      if (!viewport) return;
      const bounds = viewport.getBoundingClientRect();
      const now = panZoomViewportToPage(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        viewRef.current,
      );
      if (drag.kind === "sheet" || drag.kind === "crop-move") {
        const start = panZoomViewportToPage(
          { x: drag.startX - bounds.left, y: drag.startY - bounds.top },
          viewRef.current,
        );
        const dxPt = (now.x - start.x) / scale;
        const dyPt = -(now.y - start.y) / scale;
        if (drag.kind === "sheet") {
          if (drag.sheet === "east") {
            setOffset({
              x: drag.origin.x + dxPt,
              y: drag.origin.y + dyPt,
            });
          } else {
            setOffset({
              x: drag.origin.x - dxPt,
              y: drag.origin.y - dyPt,
            });
          }
          return;
        }
        const sheet = drag.sheet === "east" ? sheets.east : sheets.west;
        const setCrop = drag.sheet === "east" ? setEastCrop : setWestCrop;
        const origin = clampCropOrigin(
          drag.origin.x + dxPt,
          drag.origin.y + dyPt,
          drag.origin.width,
          drag.origin.height,
          sheet.width,
          sheet.height,
        );
        setCrop({ ...drag.origin, x: origin.x, y: origin.y });
        return;
      }
      const sheet = drag.sheet === "east" ? sheets.east : sheets.west;
      const sheetCanvas = drag.sheet === "east" ? eastCanvas : westCanvas;
      const setCrop = drag.sheet === "east" ? setEastCrop : setWestCrop;
      if (drag.kind === "crop-handle") {
        const local = {
          x: now.x - sheetCanvas.x,
          y: now.y - sheetCanvas.y,
        };
        setCrop(
          canvasRectToPdf(
            resizeCanvasRectFromHandle(
              drag.handle,
              pdfRectToCanvas(drag.origin, sheet.height, scale),
              local,
              { width: sheet.width * scale, height: sheet.height * scale },
            ),
            sheet.height,
            scale,
          ),
        );
        return;
      }
      const nowPdf = layoutPointToSheetPdf(now, sheetCanvas, sheet, scale);
      if (!nowPdf) return;
      setCrop(rubberBandCrop(drag.startPdf, nowPdf, sheet));
    }

    function onUp() {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.kind === "crop-draw") {
        const crop =
          drag.sheet === "east" ? eastCropRef.current : westCropRef.current;
        if (crop.width < MIN_CROP_PT || crop.height < MIN_CROP_PT) {
          if (drag.sheet === "east") setEastCrop(drag.previous);
          else setWestCrop(drag.previous);
          return;
        }
      }
      if (drag.kind !== "pan") {
        persistDraft();
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [eastCanvas, layout, persistDraft, scale, sheets, westCanvas]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (!sheets) return;
      const step =
        pdfDeltaPerScreenPixel(scale, viewRef.current.zoom) *
        (event.shiftKey ? 10 : 1);
      if (toolRef.current === "crop") {
        const crop =
          selectedSheetRef.current === "east"
            ? eastCropRef.current
            : westCropRef.current;
        const page =
          selectedSheetRef.current === "east" ? sheets.east : sheets.west;
        let dx = 0;
        let dy = 0;
        if (event.key === "ArrowLeft") dx = -step;
        if (event.key === "ArrowRight") dx = step;
        if (event.key === "ArrowDown") dy = -step;
        if (event.key === "ArrowUp") dy = step;
        if (!dx && !dy) return;
        event.preventDefault();
        const origin = clampCropOrigin(
          crop.x + dx,
          crop.y + dy,
          crop.width,
          crop.height,
          page.width,
          page.height,
        );
        const next = { ...crop, x: origin.x, y: origin.y };
        if (selectedSheetRef.current === "east") setEastCrop(next);
        else setWestCrop(next);
        schedulePersistDraft({
          offset: offsetRef.current,
          westCrop:
            selectedSheetRef.current === "west" ? next : westCropRef.current,
          eastCrop:
            selectedSheetRef.current === "east" ? next : eastCropRef.current,
        });
        return;
      }
      let next: PdfPoint | null = null;
      if (event.key === "ArrowLeft") {
        next =
          selectedSheet === "east"
            ? nudgeEastOffset(offsetRef.current, -step, 0)
            : nudgeWestOffset(offsetRef.current, -step, 0);
      }
      if (event.key === "ArrowRight") {
        next =
          selectedSheet === "east"
            ? nudgeEastOffset(offsetRef.current, step, 0)
            : nudgeWestOffset(offsetRef.current, step, 0);
      }
      if (event.key === "ArrowDown") {
        next =
          selectedSheet === "east"
            ? nudgeEastOffset(offsetRef.current, 0, -step)
            : nudgeWestOffset(offsetRef.current, 0, -step);
      }
      if (event.key === "ArrowUp") {
        next =
          selectedSheet === "east"
            ? nudgeEastOffset(offsetRef.current, 0, step)
            : nudgeWestOffset(offsetRef.current, 0, step);
      }
      if (!next) return;
      event.preventDefault();
      setOffset(next);
      schedulePersistDraft({
        offset: next,
        westCrop: westCropRef.current,
        eastCrop: eastCropRef.current,
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scale, schedulePersistDraft, selectedSheet, sheets]);

  if (!sheets || !layout || !westCanvas || !eastCanvas) {
    return (
      <p className="m-auto text-sm text-slate-500">
        West and east PDFs are required before they can be aligned.
      </p>
    );
  }

  const westCropCanvas = cropOnLayout(
    westCrop,
    westCanvas,
    sheets.west.height,
    scale,
  );
  const eastCropCanvas = cropOnLayout(
    eastCrop,
    eastCanvas,
    sheets.east.height,
    scale,
  );

  const setViewportCursor = (cursor: string) => {
    const node = viewportRef.current;
    if (node && node.style.cursor !== cursor) node.style.cursor = cursor;
  };

  const updateHoverCursor = (event: { clientX: number; clientY: number }) => {
    const drag = dragRef.current;
    if (drag) {
      if (drag.kind === "crop-handle") {
        setViewportCursor(HANDLE_CURSOR[drag.handle]);
      } else if (drag.kind === "crop-move") {
        setViewportCursor("move");
      } else if (drag.kind === "crop-draw") {
        setViewportCursor("crosshair");
      } else {
        setViewportCursor("grabbing");
      }
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const pagePoint = panZoomViewportToPage(
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      viewRef.current,
    );
    const handleSlop = HANDLE_HIT_PX / Math.max(viewRef.current.zoom, 0.01);
    setViewportCursor(
      alignHoverCursor(
        toolRef.current,
        selectedSheetRef.current,
        pagePoint,
        westCanvas,
        eastCanvas,
        westCropCanvas,
        eastCropCanvas,
        handleSlop,
      ),
    );
  };

  const beginPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 1 || event.ctrlKey) {
      event.preventDefault();
      dragRef.current = {
        kind: "pan",
        startX: event.clientX,
        startY: event.clientY,
        originX: view.x,
        originY: view.y,
      };
      return;
    }
    if (event.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const pagePoint = panZoomViewportToPage(
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      view,
    );
    if (tool === "crop") {
      const selectedCropCanvas =
        selectedSheet === "east" ? eastCropCanvas : westCropCanvas;
      const handle = hitCropHandle(
        selectedCropCanvas,
        pagePoint,
        HANDLE_HIT_PX / Math.max(view.zoom, 0.01),
      );
      if (handle) {
        event.preventDefault();
        dragRef.current = {
          kind: "crop-handle",
          sheet: selectedSheet,
          handle,
          origin: selectedSheet === "east" ? eastCrop : westCrop,
        };
        return;
      }
      const onEast = pointInRect(pagePoint, eastCanvas);
      const onWest = pointInRect(pagePoint, westCanvas);
      const hitSheet: AlignSheet | null = onEast ? "east" : onWest ? "west" : null;
      if (hitSheet) {
        event.preventDefault();
        setSelectedSheet(hitSheet);
        const crop = hitSheet === "east" ? eastCrop : westCrop;
        const cropCanvas = hitSheet === "east" ? eastCropCanvas : westCropCanvas;
        const sheetCanvas = hitSheet === "east" ? eastCanvas : westCanvas;
        const sheet = hitSheet === "east" ? sheets.east : sheets.west;
        if (pointInRect(pagePoint, cropCanvas)) {
          dragRef.current = {
            kind: "crop-move",
            sheet: hitSheet,
            startX: event.clientX,
            startY: event.clientY,
            origin: crop,
          };
          return;
        }
        const startPdf = layoutPointToSheetPdf(
          pagePoint,
          sheetCanvas,
          sheet,
          scale,
        );
        if (!startPdf) return;
        dragRef.current = {
          kind: "crop-draw",
          sheet: hitSheet,
          startPdf,
          previous: crop,
        };
        return;
      }
    } else {
      const onEast = pointInRect(pagePoint, eastCanvas);
      const onWest = pointInRect(pagePoint, westCanvas);
      if (onEast) {
        event.preventDefault();
        setSelectedSheet("east");
        dragRef.current = {
          kind: "sheet",
          sheet: "east",
          startX: event.clientX,
          startY: event.clientY,
          origin: offset,
        };
        return;
      }
      if (onWest) {
        event.preventDefault();
        setSelectedSheet("west");
        dragRef.current = {
          kind: "sheet",
          sheet: "west",
          startX: event.clientX,
          startY: event.clientY,
          origin: offset,
        };
        return;
      }
    }
    event.preventDefault();
    dragRef.current = {
      kind: "pan",
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    };
  };

  const zoomToolbar = (
    <FloorPlanZoomToolbar
      zoom={view.zoom}
      onZoomBy={(factor) => zoomBy(factor)}
      onReset={resetView}
    />
  );

  const canMerge =
    westCrop.width >= MIN_CROP_PT &&
    westCrop.height >= MIN_CROP_PT &&
    eastCrop.width >= MIN_CROP_PT &&
    eastCrop.height >= MIN_CROP_PT;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-slate-600">
          {tool === "crop"
            ? "Draw or resize a rectangle on each sheet so only building content remains. Title blocks and sheet borders outside the box are discarded on merge."
            : "Click a sheet to select it, then drag or use arrow keys to align the elevator cores. Both drawings are translucent — lines darken where they match."}
        </p>
        {zoomToolbar}
        {!embeddedExpanded ? (
          <button
            type="button"
            onClick={() => onExpandedChange(!expanded)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            aria-label={expanded ? "Exit full screen" : "Expand align editor"}
            title="Full screen"
          >
            <FloorPlanExpandIcon />
            {expanded ? "Close" : "Expand"}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex rounded-md border border-slate-200 bg-white p-0.5">
          <button
            type="button"
            aria-pressed={tool === "align"}
            onClick={() => setTool("align")}
            className={`rounded px-2 py-1 text-xs font-medium ${
              tool === "align"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Align
          </button>
          <button
            type="button"
            aria-pressed={tool === "crop"}
            onClick={() => setTool("crop")}
            className={`rounded px-2 py-1 text-xs font-medium ${
              tool === "crop"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Crop
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          West opacity
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={westOpacity}
            onChange={(event) => setWestOpacity(Number(event.target.value))}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          East opacity
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={eastOpacity}
            onChange={(event) => setEastOpacity(Number(event.target.value))}
          />
        </label>
        <span className="text-xs tabular-nums text-slate-500">
          Offset {offset.x.toFixed(1)}, {offset.y.toFixed(1)} pt · Selected{" "}
          {selectedSheet}
        </span>
        <button
          type="button"
          disabled={saving || !canMerge}
          onClick={() => {
            if (saveTimerRef.current) {
              clearTimeout(saveTimerRef.current);
              saveTimerRef.current = null;
            }
            void onMerge(currentDraft());
          }}
          className="ml-auto rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? "Merging…" : "Merge into one drawing"}
        </button>
      </div>

      <div
        ref={viewportRef}
        className="relative min-h-[24rem] flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white"
        style={{ touchAction: "none" }}
        onPointerDown={(event) => {
          beginPointer(event);
          updateHoverCursor(event);
        }}
        onPointerMove={updateHoverCursor}
        onPointerLeave={() => setViewportCursor("grab")}
      >
        <div
          className="pointer-events-none absolute left-0 top-0 origin-top-left"
          style={{
            width: layout.width * scale,
            height: layout.height * scale,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            visibility:
              westClipPainted && eastClipPainted ? "hidden" : "visible",
          }}
        >
          <div
            className="absolute"
            style={{
              left: westCanvas.x,
              top: westCanvas.y,
              width: westCanvas.width,
              height: westCanvas.height,
              opacity: westOpacity,
              mixBlendMode: "multiply",
            }}
          >
            <FloorPlanPdfCanvas
              url={westUrl}
              scale={scale}
              cssWidth={westCanvas.width}
              cssHeight={westCanvas.height}
              className="block"
            />
          </div>
          <div
            className="absolute"
            style={{
              left: eastCanvas.x,
              top: eastCanvas.y,
              width: eastCanvas.width,
              height: eastCanvas.height,
              opacity: eastOpacity,
              mixBlendMode: "multiply",
            }}
          >
            <FloorPlanPdfCanvas
              url={eastUrl}
              scale={scale}
              cssWidth={eastCanvas.width}
              cssHeight={eastCanvas.height}
              className="block"
            />
          </div>
        </div>
        {viewportSize.width >= 2 && viewportSize.height >= 2 ? (
          <>
            <div
              className="pointer-events-none absolute inset-0"
              style={{ opacity: westOpacity, mixBlendMode: "multiply" }}
            >
              <FloorPlanPdfClipCanvas
                url={westUrl}
                view={view}
                layoutScale={scale}
                viewportWidth={viewportSize.width}
                viewportHeight={viewportSize.height}
                overlay={westCanvas}
                onPaintedChange={setWestClipPainted}
              />
            </div>
            <div
              className="pointer-events-none absolute inset-0"
              style={{ opacity: eastOpacity, mixBlendMode: "multiply" }}
            >
              <FloorPlanPdfClipCanvas
                url={eastUrl}
                view={view}
                layoutScale={scale}
                viewportWidth={viewportSize.width}
                viewportHeight={viewportSize.height}
                overlay={eastCanvas}
                onPaintedChange={setEastClipPainted}
              />
            </div>
          </>
        ) : null}
        <div
          className="pointer-events-none absolute left-0 top-0 z-10 origin-top-left"
          style={{
            width: layout.width * scale,
            height: layout.height * scale,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          }}
        >
          <div
            className={`absolute ${
              selectedSheet === "west" ? "ring-2 ring-sky-600 ring-offset-1" : ""
            }`}
            style={{
              left: westCanvas.x,
              top: westCanvas.y,
              width: westCanvas.width,
              height: westCanvas.height,
            }}
          >
            <SheetCropOverlay
              crop={westCrop}
              page={sheets.west}
              scale={scale}
              tone="west"
              showMask={tool === "crop"}
              showHandles={tool === "crop" && selectedSheet === "west"}
            />
            <span className="pointer-events-none absolute left-1 top-1 rounded bg-sky-700/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
              West
            </span>
          </div>
          <div
            className={`absolute ${
              selectedSheet === "east" ? "ring-2 ring-rose-600 ring-offset-1" : ""
            }`}
            style={{
              left: eastCanvas.x,
              top: eastCanvas.y,
              width: eastCanvas.width,
              height: eastCanvas.height,
            }}
          >
            <SheetCropOverlay
              crop={eastCrop}
              page={sheets.east}
              scale={scale}
              tone="east"
              showMask={tool === "crop"}
              showHandles={tool === "crop" && selectedSheet === "east"}
            />
            <span className="pointer-events-none absolute right-1 top-1 rounded bg-rose-700/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
              East
            </span>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {floorPlanLabel(plan)} ·{" "}
        {tool === "crop"
          ? "Click west or east, then drag inside the box to move it, drag a handle to resize, or drag outside the box to draw a new rectangle. Arrow keys nudge the selected crop."
          : "Click west or east to select. Arrow keys nudge the selected sheet 1 px (Shift for 10 px). Middle-click or Ctrl-drag pans."}
      </p>
    </div>
  );
}

function SheetCropOverlay({
  crop,
  page,
  scale,
  tone,
  showMask,
  showHandles,
}: {
  crop: PdfRect;
  page: PdfSize;
  scale: number;
  tone: CropTone;
  showMask: boolean;
  showHandles: boolean;
}) {
  const rect = pdfRectToCanvas(crop, page.height, scale);
  const pageW = page.width * scale;
  const pageH = page.height * scale;
  const dim = "absolute bg-slate-900/45";
  return (
    <>
      {showMask ? (
        <>
          <div className={dim} style={{ left: 0, top: 0, width: pageW, height: rect.y }} />
          <div
            className={dim}
            style={{ left: 0, top: rect.y, width: rect.x, height: rect.height }}
          />
          <div
            className={dim}
            style={{
              left: rect.x + rect.width,
              top: rect.y,
              width: Math.max(0, pageW - rect.x - rect.width),
              height: rect.height,
            }}
          />
          <div
            className={dim}
            style={{
              left: 0,
              top: rect.y + rect.height,
              width: pageW,
              height: Math.max(0, pageH - rect.y - rect.height),
            }}
          />
        </>
      ) : null}
      <div
        className={`absolute ${
          showHandles
            ? `${CROP_TONE_CLASS[tone].box} pointer-events-auto cursor-move`
            : `border-2 border-dashed ${
                tone === "west" ? "border-sky-500" : "border-rose-500"
              }`
        }`}
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
        }}
      >
        {showHandles
          ? HANDLE_KINDS.map((kind) => (
              <div
                key={kind}
                className={`absolute h-3 w-3 rounded-sm ${CROP_TONE_CLASS[tone].handle} ${HANDLE_CLASS[kind]}`}
              />
            ))
          : null}
      </div>
    </>
  );
}
