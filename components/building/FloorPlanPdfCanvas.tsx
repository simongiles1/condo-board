"use client";

import { memo, useEffect, useRef, useState } from "react";

import {
  CLIP_RASTER_OVERSCAN_PX,
  clampPdfVisibleRender,
  clipRasterKey,
  clipRasterKeyEquals,
  overlayPanZoom,
  panZoomFollowTransform,
  pdfOverlayRenderParams,
  pdfVisibleRenderParams,
  type CanvasRect,
  type PdfPanZoom,
} from "@/lib/building/floor-plan-align";

function followCssTransform(
  current: PdfPanZoom,
  rendered: PdfPanZoom,
  currentOverlay?: CanvasRect | null,
  renderedOverlay?: CanvasRect | null,
): string {
  const follow = panZoomFollowTransform(
    currentOverlay ? overlayPanZoom(current, currentOverlay) : current,
    renderedOverlay ? overlayPanZoom(rendered, renderedOverlay) : rendered,
  );
  return `translate(${follow.x}px, ${follow.y}px) scale(${follow.scale})`;
}
import {
  loadPdfBuffer,
  queueRenderPdfPageToCanvas,
  releasePdfCanvas,
  renderPdfPageClipToCanvas,
  renderPdfPageToCanvas,
  type PdfPageRenderInfo,
} from "@/lib/pdf/pdfjs-browser";

const MAX_RENDER_EDGE = 8192;
const RENDER_SETTLE_MS = 200;
const VIEWPORT_EPS_PX = 16;

function viewportDimensionMatches(a: number, b: number): boolean {
  return Math.abs(a - b) < VIEWPORT_EPS_PX;
}

export const FloorPlanPdfCanvas = memo(function FloorPlanPdfCanvas({
  url,
  scale,
  className,
  opacity = 1,
  cssWidth,
  cssHeight,
  queuedRender = false,
  renderRetry = 0,
  waitForVisibleTab = false,
  onRendered,
  onError,
}: {
  url: string;
  scale: number;
  className?: string;
  opacity?: number;
  cssWidth?: number;
  cssHeight?: number;
  /** Queue raster jobs so many compare sheets preload without starving each other. */
  queuedRender?: boolean;
  /** Bump to retry stalled renders (e.g. after a background browser tab wakes up). */
  renderRetry?: number;
  /** Fetch while hidden, but defer canvas raster until this browser tab is foregrounded. */
  waitForVisibleTab?: boolean;
  onRendered?: (info: PdfPageRenderInfo) => void;
  onError?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );

  useEffect(() => {
    if (!waitForVisibleTab) return;
    function onVisibilityChange() {
      setTabVisible(!document.hidden);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [waitForVisibleTab]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (waitForVisibleTab && !tabVisible) return;
    let cancelled = false;

    loadPdfBuffer(url)
      .then(async (buffer) => {
        if (cancelled || !canvasRef.current) return;
        const render = queuedRender
          ? queueRenderPdfPageToCanvas
          : renderPdfPageToCanvas;
        return render(buffer, 1, canvasRef.current, scale);
      })
      .then((info) => {
        const el = canvasRef.current;
        if (cancelled || !el || el.width < 2 || el.height < 2) return;
        if (info) {
          onRenderedRef.current?.(info);
          return;
        }
        onRenderedRef.current?.({
          canvasWidth: el.width,
          canvasHeight: el.height,
          pageWidthPt: el.width / scale,
          pageHeightPt: el.height / scale,
          scale,
        });
      })
      .catch(() => {
        if (!cancelled) onErrorRef.current?.();
      });

    return () => {
      cancelled = true;
      releasePdfCanvas(canvas);
    };
  }, [url, scale, queuedRender, renderRetry, waitForVisibleTab, tabVisible]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        opacity,
        display: "block",
        width: cssWidth,
        height: cssHeight,
      }}
    />
  );
}, (prev, next) =>
  prev.url === next.url &&
  prev.scale === next.scale &&
  prev.opacity === next.opacity &&
  prev.cssWidth === next.cssWidth &&
  prev.cssHeight === next.cssHeight &&
  prev.queuedRender === next.queuedRender &&
  prev.renderRetry === next.renderRetry &&
  prev.waitForVisibleTab === next.waitForVisibleTab);

/**
 * Full-screen crop/align: rasterize the visible PDF region (plus overscan) at
 * device pixels. Hidden until a clip actually paints so a blank canvas cannot
 * cover the sheet.
 *
 * Zoom / viewport / layout-scale changes, and pans past half the overscan,
 * schedule a new raster after the view settles. While dragging, pan and
 * overlay origin CSS-follow the last paint so the sheet does not flash a
 * pdf.js reload. New rasters paint onto a scratch canvas and copy over, so
 * the visible bitmap is never cleared in place.
 */
export const FloorPlanPdfClipCanvas = memo(function FloorPlanPdfClipCanvas({
  url,
  view,
  layoutScale,
  viewportWidth,
  viewportHeight,
  overlay,
  background,
  onPaintedChange,
}: {
  url: string;
  view: PdfPanZoom;
  layoutScale: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Sheet position on the layout canvas (for multi-PDF align views). */
  overlay?: CanvasRect;
  /** Omit for a transparent clip (stacked alignment overlays). */
  background?: string;
  onPaintedChange?: (painted: boolean) => void;
}) {
  const clipBackground = background ?? (overlay ? undefined : "#ffffff");
  const overscan = CLIP_RASTER_OVERSCAN_PX;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const onPaintedChangeRef = useRef(onPaintedChange);
  onPaintedChangeRef.current = onPaintedChange;
  const reportPainted = (ready: boolean) => {
    onPaintedChangeRef.current?.(ready);
  };
  const [painted, setPainted] = useState<PdfPanZoom | null>(null);
  const paintedRef = useRef<PdfPanZoom | null>(null);
  const paintedOverlayRef = useRef<CanvasRect | null>(null);
  const paintedViewportRef = useRef({ width: 0, height: 0 });
  const paintedLayoutScaleRef = useRef(0);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;

  const applyFollowTransform = (
    current: PdfPanZoom,
    rendered: PdfPanZoom,
    currentOverlay?: CanvasRect | null,
    renderedOverlay?: CanvasRect | null,
  ) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    wrapper.style.transform = followCssTransform(
      current,
      rendered,
      currentOverlay,
      renderedOverlay,
    );
    wrapper.style.visibility = "visible";
  };

  useEffect(() => {
    setPainted(null);
    paintedRef.current = null;
    paintedOverlayRef.current = null;
    paintedViewportRef.current = { width: 0, height: 0 };
    paintedLayoutScaleRef.current = 0;
    reportPainted(false);
    return () => {
      releasePdfCanvas(canvasRef.current);
    };
  }, [url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (
      !canvas ||
      viewportWidth < 2 ||
      viewportHeight < 2 ||
      !(layoutScale > 0)
    ) {
      return;
    }

    const previous = paintedRef.current;
    const previousOverlay = paintedOverlayRef.current;
    const live = viewRef.current;
    const liveOverlay = overlayRef.current;
    if (
      previous &&
      clipRasterKeyEquals(
        clipRasterKey(
          previous,
          paintedLayoutScaleRef.current,
          paintedViewportRef.current.width,
          paintedViewportRef.current.height,
          previousOverlay,
        ),
        clipRasterKey(
          live,
          layoutScale,
          viewportWidth,
          viewportHeight,
          liveOverlay,
        ),
      )
    ) {
      applyFollowTransform(live, previous, liveOverlay, previousOverlay);
      if (!painted) setPainted(previous);
      reportPainted(true);
      return;
    }

    const restorePreviousClip = () => {
      const lastPainted = paintedRef.current;
      if (!lastPainted) return;
      applyFollowTransform(
        viewRef.current,
        lastPainted,
        overlayRef.current,
        paintedOverlayRef.current,
      );
    };

    let ignoreResult = false;
    const timer = window.setTimeout(() => {
      const target: PdfPanZoom = {
        x: viewRef.current.x,
        y: viewRef.current.y,
        zoom: view.zoom,
      };
      const targetOverlay = overlayRef.current;
      const scratch = document.createElement("canvas");
      renderPdfPageClipToCanvas(url, scratch, {
        ...clampPdfVisibleRender(
          targetOverlay
            ? pdfOverlayRenderParams(
                target,
                targetOverlay,
                viewportWidth,
                viewportHeight,
                layoutScale,
                Math.max(1, window.devicePixelRatio || 1),
                overscan,
              )
            : pdfVisibleRenderParams(
                target,
                viewportWidth,
                viewportHeight,
                layoutScale,
                Math.max(1, window.devicePixelRatio || 1),
                overscan,
              ),
          MAX_RENDER_EDGE,
        ),
        background: clipBackground,
      })
        .then((ok) => {
          if (ignoreResult) {
            releasePdfCanvas(scratch);
            return;
          }
          if (!ok || !canvasRef.current) {
            restorePreviousClip();
            releasePdfCanvas(scratch);
            return;
          }
          const display = canvasRef.current;
          display.width = scratch.width;
          display.height = scratch.height;
          const ctx = display.getContext("2d");
          if (ctx) ctx.drawImage(scratch, 0, 0);
          releasePdfCanvas(scratch);
          paintedRef.current = target;
          paintedOverlayRef.current = targetOverlay
            ? { ...targetOverlay }
            : null;
          paintedViewportRef.current = {
            width: viewportWidth,
            height: viewportHeight,
          };
          paintedLayoutScaleRef.current = layoutScale;
          applyFollowTransform(
            viewRef.current,
            target,
            overlayRef.current,
            paintedOverlayRef.current,
          );
          setPainted(target);
          reportPainted(true);
        })
        .catch(() => {
          releasePdfCanvas(scratch);
          if (!ignoreResult) restorePreviousClip();
        });
    }, RENDER_SETTLE_MS);

    return () => {
      ignoreResult = true;
      window.clearTimeout(timer);
      restorePreviousClip();
    };
  }, [
    url,
    view.x,
    view.y,
    view.zoom,
    layoutScale,
    viewportWidth,
    viewportHeight,
    overlay?.x,
    overlay?.y,
    overlay?.width,
    overlay?.height,
    clipBackground,
  ]);

  const paintedOverlay = paintedOverlayRef.current;
  const follow = painted
    ? panZoomFollowTransform(
        overlay ? overlayPanZoom(view, overlay) : view,
        overlay && paintedOverlay
          ? overlayPanZoom(painted, paintedOverlay)
          : painted,
      )
    : { x: 0, y: 0, scale: 1 };

  const clipVisible =
    painted !== null ||
    (paintedRef.current !== null &&
      viewportWidth >= 2 &&
      viewportHeight >= 2);

  return (
    <div
      ref={wrapperRef}
      className="pointer-events-none absolute left-0 top-0 z-[1]"
      style={{
        width: viewportWidth,
        height: viewportHeight,
        visibility: clipVisible ? "visible" : "hidden",
        transform: `translate(${follow.x}px, ${follow.y}px) scale(${follow.scale})`,
        transformOrigin: "0 0",
      }}
    >
      <canvas
        ref={canvasRef}
        className="absolute"
        style={{
          left: -overscan,
          top: -overscan,
          width: viewportWidth + 2 * overscan,
          height: viewportHeight + 2 * overscan,
        }}
      />
    </div>
  );
}, (prev, next) =>
  prev.url === next.url &&
  prev.layoutScale === next.layoutScale &&
  prev.background === next.background &&
  viewportDimensionMatches(prev.viewportWidth, next.viewportWidth) &&
  viewportDimensionMatches(prev.viewportHeight, next.viewportHeight) &&
  prev.view.x === next.view.x &&
  prev.view.y === next.view.y &&
  prev.view.zoom === next.view.zoom &&
  prev.overlay?.x === next.overlay?.x &&
  prev.overlay?.y === next.overlay?.y &&
  prev.overlay?.width === next.overlay?.width &&
  prev.overlay?.height === next.overlay?.height);
