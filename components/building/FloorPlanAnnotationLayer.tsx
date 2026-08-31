"use client";

import { useMemo, type ReactNode } from "react";

import type { PdfPoint, PdfRect } from "@/lib/building/floor-plan-align";
import { pdfPointToCanvas } from "@/lib/building/floor-plan-align";
import {
  screenPxToCanvasUnits,
  snapShowsExtensionGuides,
  vertexDragAnchor,
  type SnapKind,
  type SnapResult,
  type SnapSegment,
} from "@/lib/building/floor-plan-draw-snap";
import type {
  BoundingBoxDraft,
  CutDraft,
  FloorPlanAnnotation,
  FloorPlanCircleAnnotation,
  FloorPlanRectangleAnnotation,
  LineDraft,
  SelectionDraft,
  ShapeCrossVariant,
  VertexDragDraft,
  VertexHover,
} from "@/lib/building/floor-plan-annotations";
import {
  ellipseCrossDiagonalSegments,
  locatePointOnPolyline,
  materializePolylineCuts,
  rectangleToPolylinePoints,
  circleToPolylinePoints,
} from "@/lib/building/floor-plan-polyline-cut";
import {
  pdfRectFromCorners,
} from "@/lib/building/floor-plan-annotations";
import {
  boxCenter,
  isConnectableBox,
  listRiserPairs,
  riserArrowEndpoints,
  type ConnectableBox,
} from "@/lib/building/floor-plan-riser-links";

const HIT_SCREEN_PX = 12;

/** Constant screen-pixel stroke; compensate for the page pan/zoom CSS transform. */
function savedStrokeWidth(strokeWidthPx: number, zoom: number): number {
  return screenPxToCanvasUnits(Math.max(1, strokeWidthPx), zoom);
}

function polylinePath(
  points: PdfPoint[],
  pageHeight: number,
  scale: number,
): string {
  if (points.length === 0) return "";
  const first = pdfPointToCanvas(points[0], pageHeight, scale);
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i++) {
    const pt = pdfPointToCanvas(points[i], pageHeight, scale);
    d += ` L ${pt.x} ${pt.y}`;
  }
  return d;
}

function rectPath(rect: PdfRect, pageHeight: number, scale: number): string {
  const topLeft = pdfPointToCanvas(
    { x: rect.x, y: rect.y + rect.height },
    pageHeight,
    scale,
  );
  const bottomRight = pdfPointToCanvas(
    { x: rect.x + rect.width, y: rect.y },
    pageHeight,
    scale,
  );
  const x = topLeft.x;
  const y = topLeft.y;
  const w = bottomRight.x - topLeft.x;
  const h = bottomRight.y - topLeft.y;
  return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
}

function crossDiagonalsPath(
  rect: PdfRect,
  pageHeight: number,
  scale: number,
): string {
  const bl = pdfPointToCanvas({ x: rect.x, y: rect.y }, pageHeight, scale);
  const br = pdfPointToCanvas(
    { x: rect.x + rect.width, y: rect.y },
    pageHeight,
    scale,
  );
  const tr = pdfPointToCanvas(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    pageHeight,
    scale,
  );
  const tl = pdfPointToCanvas(
    { x: rect.x, y: rect.y + rect.height },
    pageHeight,
    scale,
  );
  return ` M ${bl.x} ${bl.y} L ${tr.x} ${tr.y} M ${br.x} ${br.y} L ${tl.x} ${tl.y}`;
}

function rectAnnotationPath(
  rect: PdfRect,
  pageHeight: number,
  scale: number,
  variant: ShapeCrossVariant = "plain",
): string {
  let d = rectPath(rect, pageHeight, scale);
  if (variant === "cross") {
    d += crossDiagonalsPath(rect, pageHeight, scale);
  }
  return d;
}

function ellipseCrossDiagonalsPath(
  rect: PdfRect,
  pageHeight: number,
  scale: number,
): string {
  const segments = ellipseCrossDiagonalSegments(rect);
  let d = "";
  for (const segment of segments) {
    const a = pdfPointToCanvas(segment.a, pageHeight, scale);
    const b = pdfPointToCanvas(segment.b, pageHeight, scale);
    d += ` M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  }
  return d;
}

function circleAnnotationPath(
  rect: PdfRect,
  pageHeight: number,
  scale: number,
  variant: ShapeCrossVariant = "plain",
): string {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const center = pdfPointToCanvas({ x: cx, y: cy }, pageHeight, scale);
  const right = pdfPointToCanvas({ x: cx + rect.width / 2, y: cy }, pageHeight, scale);
  const top = pdfPointToCanvas(
    { x: cx, y: cy + rect.height / 2 },
    pageHeight,
    scale,
  );
  const canvasRx = Math.abs(right.x - center.x);
  const canvasRy = Math.abs(top.y - center.y);
  let d = `M ${center.x - canvasRx} ${center.y} A ${canvasRx} ${canvasRy} 0 1 0 ${center.x + canvasRx} ${center.y} A ${canvasRx} ${canvasRy} 0 1 0 ${center.x - canvasRx} ${center.y}`;
  if (variant === "cross") {
    d += ellipseCrossDiagonalsPath(rect, pageHeight, scale);
  }
  return d;
}

function boundingBoxAnnotationPath(
  item: FloorPlanRectangleAnnotation | FloorPlanCircleAnnotation,
  pageHeight: number,
  scale: number,
): string {
  if (item.type === "circle") {
    return circleAnnotationPath(item.rect, pageHeight, scale, item.variant);
  }
  return rectAnnotationPath(item.rect, pageHeight, scale, item.variant);
}

function boundingBoxDraftPath(
  shape: "rectangle" | "circle",
  rect: PdfRect,
  pageHeight: number,
  scale: number,
  variant: ShapeCrossVariant,
): string {
  if (shape === "circle") {
    return circleAnnotationPath(rect, pageHeight, scale, variant);
  }
  return rectAnnotationPath(rect, pageHeight, scale, variant);
}

const SNAP_COLOR = "#0ea5e9";

function SnapExtensionGuides({
  snapKind,
  point,
  segment,
  alignXThrough,
  alignYThrough,
  pageWidth,
  pageHeight,
  scale,
  zoom,
}: {
  snapKind: SnapKind | null | undefined;
  point: PdfPoint;
  segment?: SnapSegment;
  alignXThrough?: PdfPoint;
  alignYThrough?: PdfPoint;
  pageWidth: number;
  pageHeight: number;
  scale: number;
  zoom: number;
}) {
  if (!snapShowsExtensionGuides(snapKind)) return null;

  const stroke = screenPxToCanvasUnits(1.5, zoom);
  const dash = `${screenPxToCanvasUnits(6, zoom)} ${screenPxToCanvasUnits(4, zoom)}`;
  const guides: React.ReactNode[] = [];

  if (snapKind === "collinear" && segment) {
    const a = pdfPointToCanvas(segment.a, pageHeight, scale);
    const b = pdfPointToCanvas(segment.b, pageHeight, scale);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      const tx = dx / len;
      const ty = dy / len;
      const extent = Math.max(pageWidth * scale, pageHeight * scale) * 2;
      const snapCanvas = pdfPointToCanvas(point, pageHeight, scale);
      guides.push(
        <line
          key="collinear"
          x1={snapCanvas.x - tx * extent}
          y1={snapCanvas.y - ty * extent}
          x2={snapCanvas.x + tx * extent}
          y2={snapCanvas.y + ty * extent}
          stroke={SNAP_COLOR}
          strokeWidth={stroke}
          strokeDasharray={dash}
          strokeLinecap="round"
          pointerEvents="none"
          opacity={0.85}
        />,
      );
    }
  }

  if (
    (snapKind === "align-x" || snapKind === "align-xy") &&
    alignXThrough
  ) {
    const top = pdfPointToCanvas({ x: alignXThrough.x, y: pageHeight }, pageHeight, scale);
    const bottom = pdfPointToCanvas({ x: alignXThrough.x, y: 0 }, pageHeight, scale);
    const ref = pdfPointToCanvas(alignXThrough, pageHeight, scale);
    guides.push(
      <g key="align-x">
        <line
          x1={top.x}
          y1={top.y}
          x2={bottom.x}
          y2={bottom.y}
          stroke={SNAP_COLOR}
          strokeWidth={stroke}
          strokeDasharray={dash}
          pointerEvents="none"
          opacity={0.85}
        />
        <rect
          x={ref.x - screenPxToCanvasUnits(4, zoom)}
          y={ref.y - screenPxToCanvasUnits(4, zoom)}
          width={screenPxToCanvasUnits(8, zoom)}
          height={screenPxToCanvasUnits(8, zoom)}
          fill="none"
          stroke={SNAP_COLOR}
          strokeWidth={stroke}
          pointerEvents="none"
        />
      </g>,
    );
  }

  if (
    (snapKind === "align-y" || snapKind === "align-xy") &&
    alignYThrough
  ) {
    const left = pdfPointToCanvas({ x: 0, y: alignYThrough.y }, pageHeight, scale);
    const right = pdfPointToCanvas({ x: pageWidth, y: alignYThrough.y }, pageHeight, scale);
    const ref = pdfPointToCanvas(alignYThrough, pageHeight, scale);
    guides.push(
      <g key="align-y">
        <line
          x1={left.x}
          y1={left.y}
          x2={right.x}
          y2={right.y}
          stroke={SNAP_COLOR}
          strokeWidth={stroke}
          strokeDasharray={dash}
          pointerEvents="none"
          opacity={0.85}
        />
        <rect
          x={ref.x - screenPxToCanvasUnits(4, zoom)}
          y={ref.y - screenPxToCanvasUnits(4, zoom)}
          width={screenPxToCanvasUnits(8, zoom)}
          height={screenPxToCanvasUnits(8, zoom)}
          fill="none"
          stroke={SNAP_COLOR}
          strokeWidth={stroke}
          pointerEvents="none"
        />
      </g>,
    );
  }

  return <g pointerEvents="none">{guides}</g>;
}

function AlignmentSnapMarker({
  point,
  pageHeight,
  scale,
  zoom,
}: {
  point: PdfPoint;
  pageHeight: number;
  scale: number;
  zoom: number;
}) {
  const canvas = pdfPointToCanvas(point, pageHeight, scale);
  const arm = screenPxToCanvasUnits(10, zoom);
  const stroke = screenPxToCanvasUnits(2.5, zoom);
  return (
    <g pointerEvents="none" stroke={SNAP_COLOR} strokeWidth={stroke}>
      <line
        x1={canvas.x - arm}
        y1={canvas.y}
        x2={canvas.x + arm}
        y2={canvas.y}
      />
      <line
        x1={canvas.x}
        y1={canvas.y - arm}
        x2={canvas.x}
        y2={canvas.y + arm}
      />
    </g>
  );
}

function EndpointHandle({
  point,
  pageHeight,
  scale,
  zoom,
  active = false,
}: {
  point: PdfPoint;
  pageHeight: number;
  scale: number;
  zoom: number;
  active?: boolean;
}) {
  const canvas = pdfPointToCanvas(point, pageHeight, scale);
  const size = screenPxToCanvasUnits(active ? 11 : 9, zoom);
  const stroke = screenPxToCanvasUnits(active ? 2.5 : 2, zoom);
  return (
    <rect
      x={canvas.x - size / 2}
      y={canvas.y - size / 2}
      width={size}
      height={size}
      fill="none"
      stroke={SNAP_COLOR}
      strokeWidth={stroke}
      pointerEvents="none"
    />
  );
}

function OnLineSnapMarker({
  point,
  segment,
  pageHeight,
  scale,
  zoom,
  approachFrom,
}: {
  point: PdfPoint;
  segment: SnapSegment;
  pageHeight: number;
  scale: number;
  zoom: number;
  approachFrom?: PdfPoint;
}) {
  const snap = pdfPointToCanvas(point, pageHeight, scale);
  const a = pdfPointToCanvas(segment.a, pageHeight, scale);
  const b = pdfPointToCanvas(segment.b, pageHeight, scale);

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;

  const tx = dx / len;
  const ty = dy / len;
  const nx = -ty;
  const ny = tx;

  const alongHalf = screenPxToCanvasUnits(18, zoom);
  const perpHalf = screenPxToCanvasUnits(22, zoom);
  const stroke = screenPxToCanvasUnits(2.5, zoom);
  const square = screenPxToCanvasUnits(9, zoom);

  let perpSign = 1;
  if (approachFrom) {
    const from = pdfPointToCanvas(approachFrom, pageHeight, scale);
    const vx = from.x - snap.x;
    const vy = from.y - snap.y;
    // Extend the leg away from the cursor/anchor so it isn't hidden underneath.
    perpSign = vx * nx + vy * ny >= 0 ? -1 : 1;
  }

  const perpX = snap.x + nx * perpSign * perpHalf;
  const perpY = snap.y + ny * perpSign * perpHalf;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

  return (
    <g pointerEvents="none" stroke={SNAP_COLOR} strokeLinecap="square">
      <line
        x1={snap.x - tx * alongHalf}
        y1={snap.y - ty * alongHalf}
        x2={snap.x + tx * alongHalf}
        y2={snap.y + ty * alongHalf}
        strokeWidth={stroke}
      />
      {approachFrom ? (
        <line
          x1={snap.x}
          y1={snap.y}
          x2={perpX}
          y2={perpY}
          strokeWidth={stroke}
        />
      ) : (
        <line
          x1={snap.x - nx * perpHalf}
          y1={snap.y - ny * perpHalf}
          x2={snap.x + nx * perpHalf}
          y2={snap.y + ny * perpHalf}
          strokeWidth={stroke}
        />
      )}
      <rect
        x={snap.x - square / 2}
        y={snap.y - square / 2}
        width={square}
        height={square}
        fill="none"
        stroke={SNAP_COLOR}
        strokeWidth={stroke}
        transform={`rotate(${angleDeg} ${snap.x} ${snap.y})`}
      />
    </g>
  );
}

function SnapMarker({
  point,
  kind,
  segment,
  approachFrom,
  alignXThrough,
  alignYThrough,
  pageWidth,
  pageHeight,
  scale,
  zoom,
  active = true,
}: {
  point: PdfPoint;
  kind: SnapKind;
  segment?: SnapSegment;
  approachFrom?: PdfPoint;
  alignXThrough?: PdfPoint;
  alignYThrough?: PdfPoint;
  pageWidth: number;
  pageHeight: number;
  scale: number;
  zoom: number;
  active?: boolean;
}) {
  return (
    <>
      <SnapExtensionGuides
        snapKind={kind}
        point={point}
        segment={segment}
        alignXThrough={alignXThrough}
        alignYThrough={alignYThrough}
        pageWidth={pageWidth}
        pageHeight={pageHeight}
        scale={scale}
        zoom={zoom}
      />
      {kind === "endpoint" ? (
        <EndpointHandle
          point={point}
          pageHeight={pageHeight}
          scale={scale}
          zoom={zoom}
          active={active}
        />
      ) : kind === "on-line" || kind === "collinear" ? (
        segment ? (
          <OnLineSnapMarker
            point={point}
            segment={segment}
            pageHeight={pageHeight}
            scale={scale}
            zoom={zoom}
            approachFrom={approachFrom}
          />
        ) : null
      ) : kind === "align-x" ||
        kind === "align-y" ||
        kind === "align-xy" ? (
        <AlignmentSnapMarker
          point={point}
          pageHeight={pageHeight}
          scale={scale}
          zoom={zoom}
        />
      ) : null}
    </>
  );
}

const CONNECT_PENDING_COLOR = "#16a34a";
const CONNECT_HOVER_COLOR = "#22c55e";

function boxFillPath(
  item: ConnectableBox,
  pageHeight: number,
  scale: number,
): string {
  if (item.type === "circle") {
    return circleAnnotationPath(item.rect, pageHeight, scale, "plain");
  }
  return rectPath(item.rect, pageHeight, scale);
}

function ArrowHead({
  start,
  end,
  pageHeight,
  scale,
  zoom,
  color,
}: {
  start: { x: number; y: number };
  end: { x: number; y: number };
  pageHeight: number;
  scale: number;
  zoom: number;
  color: string;
}) {
  const from = pdfPointToCanvas(start, pageHeight, scale);
  const to = pdfPointToCanvas(end, pageHeight, scale);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return null;
  const ux = dx / len;
  const uy = dy / len;
  const size = screenPxToCanvasUnits(10, zoom);
  const leftX = to.x - ux * size + -uy * size * 0.45;
  const leftY = to.y - uy * size + ux * size * 0.45;
  const rightX = to.x - ux * size + uy * size * 0.45;
  const rightY = to.y - uy * size + -ux * size * 0.45;
  return (
    <polygon
      points={`${to.x},${to.y} ${leftX},${leftY} ${rightX},${rightY}`}
      fill={color}
      pointerEvents="none"
    />
  );
}

function OutlinedLabel({
  x,
  y,
  children,
  color,
  fontSize,
  zoom,
}: {
  x: number;
  y: number;
  children: string;
  color: string;
  fontSize: number;
  zoom: number;
}) {
  const whiteStroke = screenPxToCanvasUnits(3, zoom);
  const blackStroke = screenPxToCanvasUnits(1.5, zoom);
  const shared = {
    x,
    y,
    textAnchor: "middle" as const,
    fontSize,
    fontWeight: 700 as const,
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    style: { userSelect: "none" as const },
  };
  return (
    <>
      <text
        {...shared}
        fill="none"
        stroke="#ffffff"
        strokeWidth={whiteStroke}
        strokeLinejoin="round"
      >
        {children}
      </text>
      <text
        {...shared}
        fill="none"
        stroke="#000000"
        strokeWidth={blackStroke}
        strokeLinejoin="round"
      >
        {children}
      </text>
      <text {...shared} fill={color}>
        {children}
      </text>
    </>
  );
}

function RiserOffsetOverlay({
  annotations,
  pageHeight,
  scale,
  zoom,
  connectDraftIndex,
  connectHoverIndex,
}: {
  annotations: FloorPlanAnnotation[];
  pageHeight: number;
  scale: number;
  zoom: number;
  connectDraftIndex: number | null;
  connectHoverIndex: number | null;
}) {
  const pairs = listRiserPairs(annotations);
  const stroke = screenPxToCanvasUnits(3.5, zoom);
  const fontSize = screenPxToCanvasUnits(11, zoom);
  const labelGap = screenPxToCanvasUnits(4, zoom);

  const highlights: ReactNode[] = [];
  const highlightIndex = (index: number | null, color: string, key: string) => {
    if (index == null) return;
    const item = annotations[index];
    if (!isConnectableBox(item)) return;
    highlights.push(
      <path
        key={key}
        d={boxFillPath(item, pageHeight, scale)}
        fill={color}
        fillOpacity={0.18}
        stroke={color}
        strokeWidth={stroke}
        pointerEvents="none"
      />,
    );
  };
  highlightIndex(connectHoverIndex, CONNECT_HOVER_COLOR, "connect-hover");
  highlightIndex(connectDraftIndex, CONNECT_PENDING_COLOR, "connect-pending");

  return (
    <g pointerEvents="none">
      {highlights}
      {pairs.map((pair) => {
        const linkColor = pair.above.color;
        const ends = riserArrowEndpoints(pair.above, pair.below);
        const center = boxCenter(pair.above);
        const bottom = pdfPointToCanvas(
          { x: center.x, y: pair.above.rect.y },
          pageHeight,
          scale,
        );
        return (
          <g key={`riser-${pair.above.id}`}>
            {ends ? (
              <>
                <line
                  x1={pdfPointToCanvas(ends.start, pageHeight, scale).x}
                  y1={pdfPointToCanvas(ends.start, pageHeight, scale).y}
                  x2={pdfPointToCanvas(ends.end, pageHeight, scale).x}
                  y2={pdfPointToCanvas(ends.end, pageHeight, scale).y}
                  stroke={linkColor}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                />
                <ArrowHead
                  start={ends.start}
                  end={ends.end}
                  pageHeight={pageHeight}
                  scale={scale}
                  zoom={zoom}
                  color={linkColor}
                />
              </>
            ) : null}
            <OutlinedLabel
              x={bottom.x}
              y={bottom.y + fontSize + labelGap}
              color={linkColor}
              fontSize={fontSize}
              zoom={zoom}
            >
              ABV
            </OutlinedLabel>
          </g>
        );
      })}
    </g>
  );
}

function AnnotationShape({
  item,
  index,
  pageHeight,
  scale,
  zoom,
  selected,
  selectable,
  ghost = false,
  ghostOpacity = 0.55,
  onSelect,
}: {
  item: FloorPlanAnnotation;
  index: number;
  pageHeight: number;
  scale: number;
  zoom: number;
  selected: boolean;
  selectable: boolean;
  ghost?: boolean;
  ghostOpacity?: number;
  onSelect?: (index: number, event: React.PointerEvent<SVGPathElement>) => void;
}) {
  const stroke = savedStrokeWidth(item.strokeWidthPt, zoom);
  const hitStroke = screenPxToCanvasUnits(HIT_SCREEN_PX, zoom);
  let d = "";
  if (item.type === "polyline" && item.points.length >= 2) {
    d = polylinePath(item.points, pageHeight, scale);
  } else if (item.type === "rectangle" || item.type === "circle") {
    d = boundingBoxAnnotationPath(item, pageHeight, scale);
  } else {
    return null;
  }

  const color = item.color;

  return (
    <g opacity={ghost ? ghostOpacity : 1}>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={ghost ? `${screenPxToCanvasUnits(6, zoom)} ${screenPxToCanvasUnits(4, zoom)}` : undefined}
        pointerEvents="none"
      />
      {selected ? (
        <path
          d={d}
          fill="none"
          stroke="#0ea5e9"
          strokeWidth={stroke + screenPxToCanvasUnits(3, zoom)}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
          opacity={0.85}
        />
      ) : null}
      {selectable ? (
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(hitStroke, stroke)}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="stroke"
          className="cursor-pointer"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            onSelect?.(index, event);
          }}
        />
      ) : null}
    </g>
  );
}

function PolylineVertexHandles({
  item,
  annotationIndex,
  pageHeight,
  scale,
  zoom,
  selected,
  hoverVertex,
  vertexDrag,
  onVertexPointerDown,
}: {
  item: FloorPlanAnnotation;
  annotationIndex: number;
  pageHeight: number;
  scale: number;
  zoom: number;
  selected: boolean;
  hoverVertex: VertexHover | null;
  vertexDrag: VertexDragDraft | null;
  onVertexPointerDown?: (
    annotationIndex: number,
    pointIndex: number,
    event: React.PointerEvent<SVGRectElement>,
  ) => void;
}) {
  if (item.type !== "polyline" || item.points.length === 0) return null;

  const hitSize = screenPxToCanvasUnits(HIT_SCREEN_PX, zoom);

  return (
    <>
      {item.points.map((point, pointIndex) => {
        const isHovered =
          hoverVertex?.annotationIndex === annotationIndex &&
          hoverVertex?.pointIndex === pointIndex;
        const isDragging =
          vertexDrag?.annotationIndex === annotationIndex &&
          vertexDrag?.pointIndex === pointIndex;
        if (!selected && !isHovered && !isDragging) return null;

        const canvas = pdfPointToCanvas(point, pageHeight, scale);

        return (
          <g key={pointIndex}>
            <EndpointHandle
              point={point}
              pageHeight={pageHeight}
              scale={scale}
              zoom={zoom}
              active={isHovered || isDragging}
            />
            <rect
              x={canvas.x - hitSize / 2}
              y={canvas.y - hitSize / 2}
              width={hitSize}
              height={hitSize}
              fill="transparent"
              pointerEvents="all"
              className="cursor-move"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                onVertexPointerDown?.(annotationIndex, pointIndex, event);
              }}
            />
          </g>
        );
      })}
    </>
  );
}

export function FloorPlanAnnotationLayer({
  pageWidth,
  pageHeight,
  scale,
  zoom = 1,
  overlayAnnotations = [],
  overlayOpacity = 0.55,
  annotations,
  selectedIndices,
  selectionDraft,
  lineDraft,
  boundingBoxDraft,
  cutDraft,
  hoverSnap,
  hoverVertex = null,
  vertexDrag = null,
  draftColor,
  draftStrokeWidthPt,
  drawInteractive,
  selectInteractive,
  selectable,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onSelectPointerDown,
  onSelectPointerMove,
  onSelectPointerUp,
  onAnnotationSelect,
  onVertexPointerDown,
  showSavedAnnotations = true,
  showOverlayAnnotations = true,
  connectDraftIndex = null,
  connectHoverIndex = null,
}: {
  pageWidth: number;
  pageHeight: number;
  scale: number;
  zoom?: number;
  overlayAnnotations?: FloorPlanAnnotation[];
  overlayOpacity?: number;
  /** When false, saved lines stay in state but are not drawn (drafts/tools still render). */
  showSavedAnnotations?: boolean;
  /** When false, reference overlay lines stay mounted but hidden (no PDF reload). */
  showOverlayAnnotations?: boolean;
  annotations: FloorPlanAnnotation[];
  selectedIndices: number[];
  selectionDraft: SelectionDraft | null;
  lineDraft: LineDraft | null;
  boundingBoxDraft: BoundingBoxDraft | null;
  cutDraft: CutDraft | null;
  hoverSnap: SnapResult | null;
  hoverVertex?: VertexHover | null;
  vertexDrag?: VertexDragDraft | null;
  draftColor: string;
  draftStrokeWidthPt: number;
  drawInteractive: boolean;
  selectInteractive?: boolean;
  selectable: boolean;
  onPointerDown?: (event: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove?: (event: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp?: (event: React.PointerEvent<SVGSVGElement>) => void;
  onSelectPointerDown?: (event: React.PointerEvent<SVGSVGElement>) => void;
  onSelectPointerMove?: (event: React.PointerEvent<SVGSVGElement>) => void;
  onSelectPointerUp?: (event: React.PointerEvent<SVGSVGElement>) => void;
  onAnnotationSelect?: (
    index: number,
    event: React.PointerEvent<SVGPathElement>,
  ) => void;
  onVertexPointerDown?: (
    annotationIndex: number,
    pointIndex: number,
    event: React.PointerEvent<SVGRectElement>,
  ) => void;
  connectDraftIndex?: number | null;
  connectHoverIndex?: number | null;
}) {
  const selectedSet = useMemo(
    () => new Set(selectedIndices),
    [selectedIndices],
  );
  const draftRect =
    boundingBoxDraft != null
      ? pdfRectFromCorners(boundingBoxDraft.start, boundingBoxDraft.current)
      : null;
  const selectionRect =
    selectionDraft != null
      ? pdfRectFromCorners(selectionDraft.start, selectionDraft.current)
      : null;

  const savedVisible = showSavedAnnotations !== false;
  const overlayVisible = showOverlayAnnotations !== false;

  const hasContent =
    annotations.length > 0 ||
    overlayAnnotations.length > 0 ||
    lineDraft != null ||
    boundingBoxDraft != null ||
    selectionDraft != null ||
    cutDraft != null ||
    hoverSnap != null ||
    hoverVertex != null ||
    vertexDrag != null;

  const vertexDragPoint = (() => {
    if (!vertexDrag) return null;
    const item = annotations[vertexDrag.annotationIndex];
    if (!item || item.type !== "polyline") return null;
    return item.points[vertexDrag.pointIndex] ?? null;
  })();

  const vertexDragApproachFrom = (() => {
    if (!vertexDrag) return undefined;
    const item = annotations[vertexDrag.annotationIndex];
    if (!item || item.type !== "polyline") return undefined;
    const anchor = vertexDragAnchor(item.points, vertexDrag.pointIndex);
    return anchor ?? undefined;
  })();

  const cutPreviewPath = (() => {
    if (!cutDraft?.first || !cutDraft.snapKind) return null;

    const item = annotations[cutDraft.first.annotationIndex];
    if (!item) return null;

    const points =
      item.type === "polyline"
        ? item.points
        : item.type === "rectangle"
          ? rectangleToPolylinePoints(item.rect)
          : item.type === "circle"
            ? circleToPolylinePoints(item.rect)
            : null;
    if (!points || points.length < 2) return null;

    const firstLoc = {
      segmentIndex: cutDraft.first.segmentIndex,
      t: cutDraft.first.t,
      point: cutDraft.first.point,
    };
    const secondLoc = locatePointOnPolyline(points, cutDraft.cursor, 48);
    if (!secondLoc) return null;

    const materialized = materializePolylineCuts(points, firstLoc, secondLoc);
    if (!materialized) return null;

    const removed = materialized.points.slice(
      materialized.indexA,
      materialized.indexB + 1,
    );
    if (removed.length < 2) return null;
    return polylinePath(removed, pageHeight, scale);
  })();

  if (!hasContent && !drawInteractive && !selectInteractive && !selectable) return null;

  const pointerActive = drawInteractive || selectInteractive;

  return (
    <svg
      className={`absolute inset-0 z-[30] h-full w-full outline-none ${
        pointerActive ? "pointer-events-auto" : "pointer-events-none"
      }${selectInteractive && hoverVertex ? " cursor-move" : ""}`}
      style={{ touchAction: pointerActive ? "none" : undefined }}
      tabIndex={drawInteractive ? -1 : undefined}
      aria-label={drawInteractive ? "Floor plan drawing canvas" : undefined}
      onPointerDown={
        drawInteractive
          ? onPointerDown
          : selectInteractive
            ? onSelectPointerDown
            : undefined
      }
      onPointerMove={
        drawInteractive
          ? onPointerMove
          : selectInteractive
            ? onSelectPointerMove
            : undefined
      }
      onPointerUp={
        drawInteractive
          ? onPointerUp
          : selectInteractive
            ? onSelectPointerUp
            : undefined
      }
    >
      <g
        visibility={overlayVisible ? "visible" : "hidden"}
        pointerEvents="none"
      >
        {overlayAnnotations.map((item, index) => (
          <AnnotationShape
            key={`overlay-${index}`}
            item={item}
            index={index}
            pageHeight={pageHeight}
            scale={scale}
            zoom={zoom}
            selected={false}
            selectable={false}
            ghost
            ghostOpacity={overlayOpacity}
          />
        ))}
      </g>
      <g
        visibility={savedVisible ? "visible" : "hidden"}
        pointerEvents={savedVisible ? undefined : "none"}
      >
        {annotations.map((item, index) => (
          <g key={index}>
            <AnnotationShape
              item={item}
              index={index}
              pageHeight={pageHeight}
              scale={scale}
              zoom={zoom}
              selected={selectedSet.has(index)}
              selectable={selectable && savedVisible}
              onSelect={onAnnotationSelect}
            />
            {selectInteractive && savedVisible && item.type === "polyline" ? (
              <PolylineVertexHandles
                item={item}
                annotationIndex={index}
                pageHeight={pageHeight}
                scale={scale}
                zoom={zoom}
                selected={selectedSet.has(index)}
                hoverVertex={hoverVertex}
                vertexDrag={vertexDrag}
                onVertexPointerDown={onVertexPointerDown}
              />
            ) : null}
          </g>
        ))}
      </g>
      {savedVisible ? (
        <RiserOffsetOverlay
          annotations={annotations}
          pageHeight={pageHeight}
          scale={scale}
          zoom={zoom}
          connectDraftIndex={connectDraftIndex}
          connectHoverIndex={connectHoverIndex}
        />
      ) : null}
      {lineDraft && lineDraft.points.length > 0 ? (
        <>
          {lineDraft.points.length >= 2 ? (
            <path
              d={polylinePath(lineDraft.points, pageHeight, scale)}
              fill="none"
              stroke={lineDraft.segmentColor}
              strokeWidth={savedStrokeWidth(draftStrokeWidthPt, zoom)}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
            />
          ) : null}
          <line
            x1={
              pdfPointToCanvas(
                lineDraft.points[lineDraft.points.length - 1],
                pageHeight,
                scale,
              ).x
            }
            y1={
              pdfPointToCanvas(
                lineDraft.points[lineDraft.points.length - 1],
                pageHeight,
                scale,
              ).y
            }
            x2={pdfPointToCanvas(lineDraft.cursor, pageHeight, scale).x}
            y2={pdfPointToCanvas(lineDraft.cursor, pageHeight, scale).y}
            stroke={draftColor}
            strokeWidth={savedStrokeWidth(draftStrokeWidthPt, zoom)}
            strokeLinecap="round"
            strokeDasharray={`${screenPxToCanvasUnits(4, zoom)} ${screenPxToCanvasUnits(3, zoom)}`}
            pointerEvents="none"
          />
          {lineDraft.snapKind ? (
            <SnapMarker
              point={lineDraft.cursor}
              kind={lineDraft.snapKind}
              segment={lineDraft.snapSegment}
              approachFrom={
                (lineDraft.snapKind === "on-line" ||
                  lineDraft.snapKind === "collinear") &&
                lineDraft.points.length > 0
                  ? lineDraft.points[lineDraft.points.length - 1]
                  : undefined
              }
              alignXThrough={lineDraft.alignXThrough}
              alignYThrough={lineDraft.alignYThrough}
              pageWidth={pageWidth}
              pageHeight={pageHeight}
              scale={scale}
              zoom={zoom}
            />
          ) : null}
        </>
      ) : null}
      {boundingBoxDraft ? (
        <>
          {draftRect && draftRect.width > 0 && draftRect.height > 0 ? (
            <path
              d={boundingBoxDraftPath(
                boundingBoxDraft.shape,
                draftRect,
                pageHeight,
                scale,
                boundingBoxDraft.variant,
              )}
              fill="none"
              stroke={draftColor}
              strokeWidth={savedStrokeWidth(draftStrokeWidthPt, zoom)}
              strokeDasharray={`${screenPxToCanvasUnits(4, zoom)} ${screenPxToCanvasUnits(3, zoom)}`}
              pointerEvents="none"
            />
          ) : null}
          {boundingBoxDraft.snapKind ? (
            <SnapMarker
              point={boundingBoxDraft.current}
              kind={boundingBoxDraft.snapKind}
              segment={boundingBoxDraft.snapSegment}
              approachFrom={
                boundingBoxDraft.snapKind === "on-line" ||
                boundingBoxDraft.snapKind === "collinear"
                  ? boundingBoxDraft.start
                  : undefined
              }
              alignXThrough={boundingBoxDraft.alignXThrough}
              alignYThrough={boundingBoxDraft.alignYThrough}
              pageWidth={pageWidth}
              pageHeight={pageHeight}
              scale={scale}
              zoom={zoom}
            />
          ) : null}
        </>
      ) : null}
      {selectionRect && selectionRect.width > 0 && selectionRect.height > 0 ? (
        <path
          d={rectPath(selectionRect, pageHeight, scale)}
          fill="rgba(14, 165, 233, 0.12)"
          stroke="#0ea5e9"
          strokeWidth={screenPxToCanvasUnits(1.5, zoom)}
          strokeDasharray={`${screenPxToCanvasUnits(4, zoom)} ${screenPxToCanvasUnits(3, zoom)}`}
          pointerEvents="none"
        />
      ) : null}
      {hoverSnap?.kind ? (
        <SnapMarker
          point={hoverSnap.point}
          kind={hoverSnap.kind}
          segment={hoverSnap.segment}
          approachFrom={hoverSnap.approachFrom}
          alignXThrough={hoverSnap.alignXThrough}
          alignYThrough={hoverSnap.alignYThrough}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          scale={scale}
          zoom={zoom}
          active={false}
        />
      ) : null}
      {vertexDrag?.snapKind && vertexDragPoint ? (
        <SnapMarker
          point={vertexDragPoint}
          kind={vertexDrag.snapKind}
          segment={vertexDrag.snapSegment}
          approachFrom={
            vertexDrag.snapKind === "on-line" ||
            vertexDrag.snapKind === "collinear"
              ? vertexDragApproachFrom
              : undefined
          }
          alignXThrough={vertexDrag.alignXThrough}
          alignYThrough={vertexDrag.alignYThrough}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          scale={scale}
          zoom={zoom}
        />
      ) : null}
      {cutDraft?.first ? (
        <SnapMarker
          point={cutDraft.first.point}
          kind={cutDraft.first.snapKind}
          segment={cutDraft.first.snapSegment}
          approachFrom={
            cutDraft.first.snapKind === "on-line"
              ? cutDraft.cursor
              : undefined
          }
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          scale={scale}
          zoom={zoom}
        />
      ) : null}
      {cutPreviewPath ? (
        <path
          d={cutPreviewPath}
          fill="none"
          stroke="#dc2626"
          strokeWidth={screenPxToCanvasUnits(3, zoom)}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={`${screenPxToCanvasUnits(5, zoom)} ${screenPxToCanvasUnits(4, zoom)}`}
          pointerEvents="none"
          opacity={0.9}
        />
      ) : null}
      {cutDraft && cutDraft.snapKind && !hoverSnap ? (
        <SnapMarker
          point={cutDraft.cursor}
          kind={cutDraft.snapKind}
          segment={cutDraft.snapSegment}
          approachFrom={
            cutDraft.snapKind === "on-line" && cutDraft.first
              ? cutDraft.first.point
              : undefined
          }
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          scale={scale}
          zoom={zoom}
        />
      ) : null}
    </svg>
  );
}
