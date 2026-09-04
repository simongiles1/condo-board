"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clampPdfVisibleRender,
  clipCoordsToPdfPoint,
  pdfPointToClipCoords,
  pdfRectClipRenderParams,
  type PdfPoint,
  type PdfRect,
} from "@/lib/building/floor-plan-align";
import {
  constrainBoxCorner,
  pdfRectFromBoxCorners,
} from "@/lib/building/floor-plan-annotations";
import {
  MIN_TEMPLATE_BOX_PT,
  templateShapeFromPdfRect,
  type RiserTemplateShape,
} from "@/lib/building/floor-plan-riser-templates";
import {
  renderPdfPageClipToCanvas,
  releasePdfCanvas,
} from "@/lib/pdf/pdfjs-browser";

const MAX_RENDER_EDGE = 8192;
/** Smallest clip edge in CSS pixels so small riser clips stay usable. */
export const RISER_TEMPLATE_MIN_PREVIEW_EDGE_PX = 280;

/** CSS pixels per PDF point in the clip preview (matches on-screen nudge step). */
export function riserTemplatePreviewScale(clipRect: PdfRect): number {
  return Math.max(
    1,
    RISER_TEMPLATE_MIN_PREVIEW_EDGE_PX /
      Math.min(clipRect.width, clipRect.height),
  );
}

/** Match main canvas: strokeWidthPt renders as ~that many screen pixels. */
function clipViewBoxStroke(strokeWidthPt: number, previewScale: number): number {
  return Math.max(0.25, strokeWidthPt / previewScale);
}

function clipViewBoxDash(on: number, off: number, previewScale: number): string {
  return `${on / previewScale} ${off / previewScale}`;
}

export function RiserTemplateClipPreview({
  pdfUrl,
  pageHeight,
  clipRect,
  shapes,
  strokeColor,
  draftStrokeWidthPt = 2,
  selectedShapeIndex,
  onSelectShape,
  onMoveShape,
  onDrawShape,
  drawTool,
}: {
  pdfUrl: string;
  pageHeight: number;
  clipRect: PdfRect;
  shapes: RiserTemplateShape[];
  strokeColor: string;
  draftStrokeWidthPt?: number;
  selectedShapeIndex?: number | null;
  onSelectShape?: (index: number | null) => void;
  onMoveShape?: (index: number, offsetXPt: number, offsetYPt: number) => void;
  /** Drag-drawn shape committed on pointer up (same gesture as main canvas boxes). */
  onDrawShape?: (shape: RiserTemplateShape) => void;
  drawTool?: "circle" | "rectangle" | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [painted, setPainted] = useState(false);
  const [dragging, setDragging] = useState<{
    index: number;
    startSvg: PdfPoint;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);
  const [boxDraft, setBoxDraft] = useState<{
    shape: "circle" | "rectangle";
    startPdf: PdfPoint;
    currentPdf: PdfPoint;
  } | null>(null);
  const boxDraggingRef = useRef(false);
  const boxStartPdfRef = useRef<PdfPoint | null>(null);
  const shiftDownRef = useRef(false);

  /** Editing origin: clip center in PDF space (offsets stay where the user places them). */
  const templateOrigin = useMemo(
    () =>
      clipCoordsToPdfPoint(
        { x: clipRect.width / 2, y: clipRect.height / 2 },
        clipRect,
        pageHeight,
      ),
    [clipRect, pageHeight],
  );

  const previewScale = useMemo(
    () => riserTemplatePreviewScale(clipRect),
    [clipRect.height, clipRect.width],
  );
  const displayWidth = clipRect.width * previewScale;
  const displayHeight = clipRect.height * previewScale;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    setPainted(false);

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const renderDpr = dpr * previewScale;
    const params = clampPdfVisibleRender(
      pdfRectClipRenderParams(clipRect, pageHeight, renderDpr),
      MAX_RENDER_EDGE,
    );

    renderPdfPageClipToCanvas(pdfUrl, canvas, {
      ...params,
      background: "#ffffff",
    })
      .then((ok) => {
        if (!cancelled && ok) setPainted(true);
      })
      .catch(() => {
        if (!cancelled) setPainted(false);
      });

    return () => {
      cancelled = true;
      releasePdfCanvas(canvas);
    };
  }, [pdfUrl, clipRect, pageHeight, previewScale]);

  useEffect(() => {
    if (!drawTool) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Shift") return;
      if (shiftDownRef.current) return;
      shiftDownRef.current = true;
      if (!boxDraggingRef.current || !boxStartPdfRef.current) return;
      setBoxDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          currentPdf: constrainBoxCorner(
            prev.startPdf,
            prev.currentPdf,
            true,
          ),
        };
      });
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key !== "Shift") return;
      shiftDownRef.current = false;
      if (!boxDraggingRef.current || !boxStartPdfRef.current) return;
      setBoxDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          currentPdf: constrainBoxCorner(
            prev.startPdf,
            prev.currentPdf,
            false,
          ),
        };
      });
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      shiftDownRef.current = false;
    };
  }, [drawTool]);

  const clipPointToPdf = useCallback(
    (clipX: number, clipY: number): PdfPoint =>
      clipCoordsToPdfPoint({ x: clipX, y: clipY }, clipRect, pageHeight),
    [clipRect, pageHeight],
  );

  const clientToClipPoint = useCallback(
    (clientX: number, clientY: number): PdfPoint | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const local = pt.matrixTransform(ctm.inverse());
      return { x: local.x, y: local.y };
    },
    [],
  );

  const commitBoxDraft = useCallback(
    (startPdf: PdfPoint, endPdf: PdfPoint, shape: "circle" | "rectangle") => {
      const rect = pdfRectFromBoxCorners(
        startPdf,
        endPdf,
        shiftDownRef.current,
      );
      if (rect.width < MIN_TEMPLATE_BOX_PT || rect.height < MIN_TEMPLATE_BOX_PT) {
        return;
      }
      onDrawShape?.(
        templateShapeFromPdfRect(rect, shape, templateOrigin, {
          strokeWidthPt: draftStrokeWidthPt,
          primary: shapes.length === 0,
        }),
      );
    },
    [draftStrokeWidthPt, onDrawShape, templateOrigin, shapes.length],
  );

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const clipPoint = clientToClipPoint(event.clientX, event.clientY);
    if (!clipPoint) return;

    if (drawTool && onDrawShape) {
      const startPdf = clipPointToPdf(clipPoint.x, clipPoint.y);
      boxDraggingRef.current = true;
      boxStartPdfRef.current = startPdf;
      setBoxDraft({
        shape: drawTool,
        startPdf,
        currentPdf: startPdf,
      });
      onSelectShape?.(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const hitIndex = hitTestShape(
      clipPoint.x,
      clipPoint.y,
      shapes,
      templateOrigin,
      clipRect,
      pageHeight,
    );
    if (hitIndex >= 0) {
      onSelectShape?.(hitIndex);
      if (onMoveShape) {
        const shape = shapes[hitIndex]!;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging({
          index: hitIndex,
          startSvg: clipPoint,
          startOffsetX: shape.offsetXPt,
          startOffsetY: shape.offsetYPt,
        });
      }
    } else {
      onSelectShape?.(null);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (boxDraggingRef.current && boxStartPdfRef.current && drawTool) {
      const clipPoint = clientToClipPoint(event.clientX, event.clientY);
      if (!clipPoint) return;
      const currentPdf = constrainBoxCorner(
        boxStartPdfRef.current,
        clipPointToPdf(clipPoint.x, clipPoint.y),
        shiftDownRef.current,
      );
      setBoxDraft({
        shape: drawTool,
        startPdf: boxStartPdfRef.current,
        currentPdf,
      });
      return;
    }

    if (!dragging || !onMoveShape) return;
    const clipPoint = clientToClipPoint(event.clientX, event.clientY);
    if (!clipPoint) return;
    const dx = clipPoint.x - dragging.startSvg.x;
    const dy = clipPoint.y - dragging.startSvg.y;
    onMoveShape(
      dragging.index,
      dragging.startOffsetX + dx,
      dragging.startOffsetY - dy,
    );
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (boxDraggingRef.current && boxStartPdfRef.current && drawTool) {
      boxDraggingRef.current = false;
      const startPdf = boxStartPdfRef.current;
      boxStartPdfRef.current = null;
      const clipPoint = clientToClipPoint(event.clientX, event.clientY);
      setBoxDraft(null);
      if (clipPoint) {
        const endPdf = constrainBoxCorner(
          startPdf,
          clipPointToPdf(clipPoint.x, clipPoint.y),
          shiftDownRef.current,
        );
        commitBoxDraft(startPdf, endPdf, drawTool);
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    if (dragging) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDragging(null);
    }
  };

  const draftRectClip =
    boxDraft != null
      ? pdfRectToClipScreen(
          pdfRectFromBoxCorners(
            boxDraft.startPdf,
            boxDraft.currentPdf,
            shiftDownRef.current,
          ),
          clipRect,
          pageHeight,
        )
      : null;

  const draftStroke = clipViewBoxStroke(draftStrokeWidthPt, previewScale);
  const draftDash = clipViewBoxDash(4, 3, previewScale);

  return (
    <div
      className="relative max-h-[min(52vh,520px)] overflow-auto rounded-lg border border-slate-300 bg-slate-100"
      title="Drag to draw circles/rectangles (Shift = square). Drag existing shapes to reposition."
    >
      <div
        className="relative inline-block"
        style={{ width: displayWidth, height: displayHeight }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block"
          style={{ width: displayWidth, height: displayHeight }}
          aria-hidden
        />
        {!painted && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-xs text-slate-500">
            Loading drawing clip…
          </div>
        )}
        <svg
          ref={svgRef}
          width={displayWidth}
          height={displayHeight}
          viewBox={`0 0 ${clipRect.width} ${clipRect.height}`}
          preserveAspectRatio="xMidYMid meet"
          className={`absolute inset-0 ${
            drawTool ? "cursor-crosshair" : dragging ? "cursor-grabbing" : "cursor-default"
          }`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {shapes.map((shape, i) => {
            const center = shapeCenterInClip(
              shape,
              templateOrigin,
              clipRect,
              pageHeight,
            );
            const selected = selectedShapeIndex === i;
            const shapeStroke = clipViewBoxStroke(
              shape.strokeWidthPt ?? draftStrokeWidthPt,
              previewScale,
            );
            if (shape.type === "circle") {
              const r = shape.widthPt / 2;
              return (
                <g key={i}>
                  <ellipse
                    cx={center.x}
                    cy={center.y}
                    rx={shape.widthPt / 2 + (selected ? 2 / previewScale : 0)}
                    ry={shape.heightPt / 2 + (selected ? 2 / previewScale : 0)}
                    fill={shape.filled ? strokeColor : "none"}
                    fillOpacity={shape.filled ? 0.85 : 0}
                    stroke={selected ? "#0ea5e9" : strokeColor}
                    strokeWidth={shapeStroke + (selected ? 0.5 / previewScale : 0)}
                  />
                  {shape.variant === "cross" ? (
                    <>
                      <line
                        x1={center.x - r}
                        y1={center.y}
                        x2={center.x + r}
                        y2={center.y}
                        stroke={strokeColor}
                        strokeWidth={clipViewBoxStroke(1, previewScale)}
                        pointerEvents="none"
                      />
                      <line
                        x1={center.x}
                        y1={center.y - r}
                        x2={center.x}
                        y2={center.y + r}
                        stroke={strokeColor}
                        strokeWidth={clipViewBoxStroke(1, previewScale)}
                        pointerEvents="none"
                      />
                    </>
                  ) : null}
                </g>
              );
            }
            return (
              <rect
                key={i}
                x={center.x - shape.widthPt / 2}
                y={center.y - shape.heightPt / 2}
                width={shape.widthPt}
                height={shape.heightPt}
                fill={shape.filled ? strokeColor : "none"}
                fillOpacity={shape.filled ? 0.85 : 0}
                stroke={selected ? "#0ea5e9" : strokeColor}
                strokeWidth={shapeStroke + (selected ? 0.5 / previewScale : 0)}
              />
            );
          })}

          {draftRectClip &&
          draftRectClip.width > 0 &&
          draftRectClip.height > 0 &&
          boxDraft ? (
            boxDraft.shape === "circle" ? (
              <ellipse
                cx={draftRectClip.x + draftRectClip.width / 2}
                cy={draftRectClip.y + draftRectClip.height / 2}
                rx={draftRectClip.width / 2}
                ry={draftRectClip.height / 2}
                fill="none"
                stroke={strokeColor}
                strokeWidth={draftStroke}
                strokeDasharray={draftDash}
                pointerEvents="none"
              />
            ) : (
              <rect
                x={draftRectClip.x}
                y={draftRectClip.y}
                width={draftRectClip.width}
                height={draftRectClip.height}
                fill="none"
                stroke={strokeColor}
                strokeWidth={draftStroke}
                strokeDasharray={draftDash}
                pointerEvents="none"
              />
            )
          ) : null}
        </svg>
      </div>
    </div>
  );
}

function pdfRectToClipScreen(
  rect: PdfRect,
  clip: PdfRect,
  pageHeight: number,
): { x: number; y: number; width: number; height: number } {
  const topLeft = pdfPointToClipCoords(
    { x: rect.x, y: rect.y + rect.height },
    clip,
    pageHeight,
  );
  const bottomRight = pdfPointToClipCoords(
    { x: rect.x + rect.width, y: rect.y },
    clip,
    pageHeight,
  );
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

function shapeCenterInClip(
  shape: RiserTemplateShape,
  templateOrigin: PdfPoint,
  clip: PdfRect,
  pageHeight: number,
): PdfPoint {
  const origin = pdfPointToClipCoords(templateOrigin, clip, pageHeight);
  return {
    x: origin.x + shape.offsetXPt,
    y: origin.y - shape.offsetYPt,
  };
}

function hitTestShape(
  clipX: number,
  clipY: number,
  shapes: RiserTemplateShape[],
  templateOrigin: PdfPoint,
  clip: PdfRect,
  pageHeight: number,
): number {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i]!;
    const center = shapeCenterInClip(shape, templateOrigin, clip, pageHeight);
    if (shape.type === "circle") {
      const rx = shape.widthPt / 2 + 2;
      const ry = shape.heightPt / 2 + 2;
      const dx = (clipX - center.x) / rx;
      const dy = (clipY - center.y) / ry;
      if (dx * dx + dy * dy <= 1) return i;
    } else {
      const halfW = shape.widthPt / 2 + 2;
      const halfH = shape.heightPt / 2 + 2;
      if (
        clipX >= center.x - halfW &&
        clipX <= center.x + halfW &&
        clipY >= center.y - halfH &&
        clipY <= center.y + halfH
      ) {
        return i;
      }
    }
  }
  return -1;
}
