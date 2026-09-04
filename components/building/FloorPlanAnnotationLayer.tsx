"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
  annotationPdfBounds,
  annotationRotationDeg,
  markupExtentExceedsPage,
  pdfRectFromCorners,
  rotatePdfPointAround,
  rotatePdfPointsAround,
  pdfRectCenter,
  type PdfMarkupExtent,
} from "@/lib/building/floor-plan-annotations";
import {
  annotationHasRiser,
  annotationVisibleWhileFollowingRiser,
  calloutRiserIds,
  findRiserByTypeAndLabel,
  isMechanicalRiserCallout,
  labelsForRiserType,
  lookupRiser,
  matchMechanicalTypeByColor,
  parseRiserLabel,
  resolveCalloutDisplayText,
  type MechanicalRiserDto,
  type MechanicalRiserTypeDto,
  type RiserIdRewrite,
} from "@/lib/building/floor-plan-mechanical-risers";
import {
  boxCenter,
  isConnectableBox,
  listRiserPairs,
  riserArrowEndpoints,
  type ConnectableBox,
} from "@/lib/building/floor-plan-riser-links";
import {
  MAX_ROOM_LEAK_MAX_GAP_PT,
  polygonCentroid,
  ROOM_LABEL_FONT_PX,
  roomDisplayColor,
  type RoomFace,
  type RoomLeak,
} from "@/lib/building/floor-plan-rooms";
import {
  CALLOUT_FONT_PX,
  CALLOUT_LINE_PX,
  CALLOUT_PAD_X_PX,
  CALLOUT_PAD_Y_PX,
  calloutBubbleScreenSize,
  calloutBubbleSizePt,
  calloutLeaderEndpoints,
} from "@/lib/building/floor-plan-callouts";

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

/** SVG rotate is clockwise on a Y-down canvas; PDF rotation is CCW with Y up. */
function boxCanvasRotateTransform(
  item: ConnectableBox,
  pageHeight: number,
  scale: number,
): string | undefined {
  const deg = annotationRotationDeg(item);
  if (deg === 0) return undefined;
  const center = boxCenter(item);
  const canvas = pdfPointToCanvas(center, pageHeight, scale);
  return `rotate(${-deg} ${canvas.x} ${canvas.y})`;
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
const RISER_SELECTED_COLOR = "#0ea5e9";
const RISER_HOVER_COLOR = "#38bdf8";

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

function OutlinedText({
  color,
  fontSize,
  zoom,
  textAnchor = "middle",
  fontWeight = 700,
  children,
}: {
  color: string;
  fontSize: number;
  zoom: number;
  textAnchor?: "middle" | "start" | "end";
  fontWeight?: number;
  children: ReactNode;
}) {
  const whiteStroke = screenPxToCanvasUnits(3, zoom);
  const blackStroke = screenPxToCanvasUnits(1.5, zoom);
  const shared = {
    textAnchor,
    fontSize,
    fontWeight,
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    style: { userSelect: "none" as const },
    pointerEvents: "none" as const,
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
  return (
    <OutlinedText
      color={color}
      fontSize={fontSize}
      zoom={zoom}
      textAnchor="middle"
      fontWeight={700}
    >
      <tspan x={x} y={y}>
        {children}
      </tspan>
    </OutlinedText>
  );
}

function RiserOffsetOverlay({
  annotations,
  pageHeight,
  scale,
  zoom,
  connectDraftIndex,
  connectHoverIndex,
  riserSelectable = false,
  selectedRiserAboveId = null,
  hoverRiserAboveId = null,
  followedRiserIds = [],
  onRiserSelect,
}: {
  annotations: FloorPlanAnnotation[];
  pageHeight: number;
  scale: number;
  zoom: number;
  connectDraftIndex: number | null;
  connectHoverIndex: number | null;
  riserSelectable?: boolean;
  selectedRiserAboveId?: string | null;
  hoverRiserAboveId?: string | null;
  followedRiserIds?: string[];
  onRiserSelect?: (
    aboveId: string,
    event: React.PointerEvent<SVGLineElement>,
  ) => void;
}) {
  const pairs = listRiserPairs(annotations).filter(
    (pair) =>
      followedRiserIds.length === 0 ||
      followedRiserIds.some((id) => annotationHasRiser(pair.above, id)),
  );
  const stroke = screenPxToCanvasUnits(3.5, zoom);
  const hitStroke = screenPxToCanvasUnits(HIT_SCREEN_PX, zoom);
  const fontSize = screenPxToCanvasUnits(11, zoom);
  const labelGap = screenPxToCanvasUnits(4, zoom);

  const highlights: ReactNode[] = [];
  const highlightIndex = (index: number | null, color: string, key: string) => {
    if (index == null) return;
    const item = annotations[index];
    if (!isConnectableBox(item)) return;
    highlights.push(
      <g
        key={key}
        transform={boxCanvasRotateTransform(item, pageHeight, scale)}
      >
        <path
          d={boxFillPath(item, pageHeight, scale)}
          fill={color}
          fillOpacity={0.18}
          stroke={color}
          strokeWidth={stroke}
          pointerEvents="none"
        />
      </g>,
    );
  };
  highlightIndex(connectHoverIndex, CONNECT_HOVER_COLOR, "connect-hover");
  highlightIndex(connectDraftIndex, CONNECT_PENDING_COLOR, "connect-pending");
  const labeledAboveIds = new Set<string>();

  return (
    <g>
      {highlights}
      {pairs.map((pair) => {
        const linkColor = pair.above.color;
        const ends = riserArrowEndpoints(pair.above, pair.below);
        const center = boxCenter(pair.above);
        const localBottom = { x: center.x, y: pair.above.rect.y };
        const bottomPdf = rotatePdfPointAround(
          localBottom,
          center,
          annotationRotationDeg(pair.above),
        );
        const bottom = pdfPointToCanvas(bottomPdf, pageHeight, scale);
        const aboveId = pair.above.id ?? "";
        const selected = aboveId !== "" && selectedRiserAboveId === aboveId;
        const hovered = aboveId !== "" && hoverRiserAboveId === aboveId;
        const startCanvas = ends
          ? pdfPointToCanvas(ends.start, pageHeight, scale)
          : null;
        const endCanvas = ends
          ? pdfPointToCanvas(ends.end, pageHeight, scale)
          : null;
        const showAbvLabel = aboveId !== "" && !labeledAboveIds.has(aboveId);
        if (showAbvLabel) labeledAboveIds.add(aboveId);
        return (
          <g key={`riser-${pair.above.id}-${pair.below.id}`}>
            {ends && startCanvas && endCanvas ? (
              <>
                <line
                  x1={startCanvas.x}
                  y1={startCanvas.y}
                  x2={endCanvas.x}
                  y2={endCanvas.y}
                  stroke={linkColor}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
                {selected || hovered ? (
                  <line
                    x1={startCanvas.x}
                    y1={startCanvas.y}
                    x2={endCanvas.x}
                    y2={endCanvas.y}
                    stroke={selected ? RISER_SELECTED_COLOR : RISER_HOVER_COLOR}
                    strokeWidth={stroke + screenPxToCanvasUnits(3, zoom)}
                    strokeLinecap="round"
                    pointerEvents="none"
                    opacity={0.9}
                  />
                ) : null}
                <ArrowHead
                  start={ends.start}
                  end={ends.end}
                  pageHeight={pageHeight}
                  scale={scale}
                  zoom={zoom}
                  color={linkColor}
                />
                {riserSelectable && aboveId ? (
                  <line
                    x1={startCanvas.x}
                    y1={startCanvas.y}
                    x2={endCanvas.x}
                    y2={endCanvas.y}
                    stroke="transparent"
                    strokeWidth={Math.max(hitStroke, stroke)}
                    strokeLinecap="round"
                    pointerEvents="stroke"
                    className="cursor-pointer"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      onRiserSelect?.(aboveId, event);
                    }}
                  />
                ) : null}
              </>
            ) : null}
            {showAbvLabel ? (
              <OutlinedLabel
                x={bottom.x}
                y={bottom.y + fontSize + labelGap}
                color={linkColor}
                fontSize={fontSize}
                zoom={zoom}
              >
                ABV
              </OutlinedLabel>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

const CATALOG_EDITOR_WIDTH_PX = 240;
const CATALOG_EDITOR_BASE_HEIGHT_PX = 220;
const CATALOG_EDITOR_ROW_HEIGHT_PX = 22;

function catalogEditorHeightPx(selectedCount: number): number {
  return CATALOG_EDITOR_BASE_HEIGHT_PX + Math.max(0, selectedCount - 1) * CATALOG_EDITOR_ROW_HEIGHT_PX;
}

function CatalogCalloutEditor({
  item,
  types,
  risers,
  saving,
  onAssign,
  onTypeChange,
  onReclassify,
  onEnsureRiser,
  onCommit,
}: {
  item: ConnectableBox;
  types: MechanicalRiserTypeDto[];
  risers: MechanicalRiserDto[];
  saving: boolean;
  onAssign: (typeId: string, riserIds: string[]) => void;
  onTypeChange: (typeId: string) => void;
  onReclassify?: (
    riserIds: string[],
    typeId: string,
  ) => Promise<RiserIdRewrite | null>;
  onEnsureRiser?: (typeId: string, label: string) => Promise<string | null>;
  onCommit: () => void;
}) {
  const callout = item.callout;
  const existingIds = callout ? calloutRiserIds(callout) : [];
  const existing = existingIds
    .map((id) => lookupRiser(risers, id))
    .find((riser) => riser != null);
  const matched = matchMechanicalTypeByColor(types, item.color);
  const [typeId, setTypeId] = useState(
    existing?.typeId ?? callout?.typeId ?? matched?.id ?? types[0]?.id ?? "",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(existingIds);
  const [numberFilter, setNumberFilter] = useState("");
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [numberMenuOpen, setNumberMenuOpen] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addValue, setAddValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const openedAtRef = useRef(0);
  const committedRef = useRef(false);
  const reclassifyingRef = useRef(false);
  const typeIdRef = useRef(typeId);
  const selectedIdsRef = useRef(selectedIds);
  const onAssignRef = useRef(onAssign);
  const onCommitRef = useRef(onCommit);
  typeIdRef.current = typeId;
  selectedIdsRef.current = selectedIds;
  onAssignRef.current = onAssign;
  onCommitRef.current = onCommit;

  const persistedRiserIdsKey = callout
    ? JSON.stringify(calloutRiserIds(callout))
    : "[]";

  useEffect(() => {
    openedAtRef.current = performance.now();
    committedRef.current = false;
  }, []);

  useEffect(() => {
    const nextIds = callout ? calloutRiserIds(callout) : [];
    setSelectedIds(nextIds);
    const next = nextIds
      .map((id) => lookupRiser(risers, id))
      .find((riser) => riser != null);
    if (next) {
      setTypeId(next.typeId);
      return;
    }
    if (callout?.typeId) {
      setTypeId(callout.typeId);
    }
  }, [persistedRiserIdsKey, callout?.typeId]);

  useEffect(() => {
    const nextIds = callout ? calloutRiserIds(callout) : [];
    if (nextIds.length === 0) return;
    const next = nextIds
      .map((id) => lookupRiser(risers, id))
      .find((riser) => riser != null);
    if (next) setTypeId(next.typeId);
  }, [risers, persistedRiserIdsKey]);

  const selectedType = types.find((type) => type.id === typeId);
  const labels = labelsForRiserType(risers, typeId);
  const filterText = numberFilter.trim();
  const filteredLabels = labels.filter((value) =>
    filterText
      ? value.toLowerCase().includes(filterText.toLowerCase())
      : true,
  );

  const applyType = (nextId: string) => {
    setTypeMenuOpen(false);
    setNumberFilter("");
    if (nextId === typeIdRef.current) return;
    const assigned = selectedIdsRef.current;
    if (assigned.length > 0 && onReclassify) {
      const previous = typeIdRef.current;
      setTypeId(nextId);
      reclassifyingRef.current = true;
      void (async () => {
        const rewrite = await onReclassify(assigned, nextId);
        reclassifyingRef.current = false;
        if (!rewrite) {
          setTypeId(previous);
          return;
        }
        setSelectedIds([
          ...new Set(assigned.map((id) => rewrite[id] ?? id)),
        ]);
      })();
      return;
    }
    setTypeId(nextId);
    setSelectedIds([]);
    if (nextId) onTypeChange(nextId);
  };

  const addRiserId = (riserId: string) => {
    setSelectedIds((prev) =>
      prev.includes(riserId) ? prev : [...prev, riserId],
    );
    setNumberFilter("");
    setNumberMenuOpen(false);
    setAddOpen(false);
  };

  const removeRiserId = (riserId: string) => {
    setSelectedIds((prev) => prev.filter((id) => id !== riserId));
  };

  const commitSelection = () => {
    if (committedRef.current) return;
    if (reclassifyingRef.current) return;
    committedRef.current = true;
    committedRef.current = true;
    const activeTypeId = typeIdRef.current;
    const activeSelectedIds = selectedIdsRef.current;
    if (activeTypeId && activeSelectedIds.length > 0) {
      onAssignRef.current(activeTypeId, activeSelectedIds);
      return;
    }
    onCommitRef.current();
  };

  const selectExistingLabel = (label: string) => {
    const riser = findRiserByTypeAndLabel(risers, typeId, label);
    if (!riser) return;
    addRiserId(riser.id);
  };

  const submitNewLabel = async () => {
    const parsed = parseRiserLabel(addValue);
    if (!typeId || parsed == null) {
      setAddError("Enter a label using letters and numbers (max 32 characters).");
      return;
    }
    const existingRiser = findRiserByTypeAndLabel(risers, typeId, parsed);
    if (existingRiser) {
      addRiserId(existingRiser.id);
      return;
    }
    if (!onEnsureRiser) {
      setAddError("Saving is unavailable.");
      return;
    }
    setAddError(null);
    const riserId = await onEnsureRiser(typeId, parsed);
    if (!riserId) {
      setAddError("Could not add that label.");
      return;
    }
    addRiserId(riserId);
    setAddValue("");
  };

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (performance.now() - openedAtRef.current < 120) return;
      const target = event.target as Node | null;
      if (editorRef.current?.contains(target)) return;
      commitSelection();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  const fieldClass =
    "h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500";

  return (
    <div
      ref={editorRef}
      role="dialog"
      aria-label="Riser catalog"
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 8,
        background: "#ffffff",
        border: "1.5px solid #0ea5e9",
        borderRadius: 4,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        overflow: "visible",
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="relative">
        <button
          type="button"
          disabled={saving || types.length === 0}
          aria-label="Riser type"
          aria-expanded={typeMenuOpen}
          onClick={() => setTypeMenuOpen((open) => !open)}
          className={`${fieldClass} flex items-center justify-between text-left`}
        >
          <span className="inline-flex min-w-0 items-center gap-2 truncate">
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-sm border border-slate-300"
              style={{ backgroundColor: selectedType?.color ?? "#e2e8f0" }}
            />
            {selectedType?.name ??
              (types.length === 0 ? "Add a mechanical type first" : "Type")}
          </span>
          <span aria-hidden className="ml-1 shrink-0 text-slate-400">
            ▾
          </span>
        </button>
        {typeMenuOpen ? (
          <ul className="absolute left-0 right-0 top-full z-10 mt-0.5 max-h-40 overflow-auto rounded border border-slate-200 bg-white py-1 shadow-md">
            {types.map((type) => (
              <li key={type.id}>
                <button
                  type="button"
                  onClick={() => applyType(type.id)}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs ${
                    type.id === typeId
                      ? "bg-slate-900 text-white"
                      : "text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  <span
                    aria-hidden
                    className="h-3 w-3 shrink-0 rounded-sm border border-slate-300"
                    style={{ backgroundColor: type.color }}
                  />
                  <span className="truncate">{type.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="relative">
        <label className="sr-only" htmlFor="catalog-riser-number">
          Riser label
        </label>
        <input
          id="catalog-riser-number"
          type="text"
          value={numberFilter}
          disabled={saving || !typeId}
          placeholder={labels.length > 0 ? "Filter or enter label" : "Label"}
          aria-expanded={numberMenuOpen}
          autoFocus
          onChange={(event) => {
            setNumberFilter(event.target.value);
            setNumberMenuOpen(true);
          }}
          onFocus={() => setNumberMenuOpen(true)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              if (addOpen) {
                setAddOpen(false);
                return;
              }
              commitSelection();
            } else if (event.key === "Enter") {
              event.preventDefault();
              const parsed = parseRiserLabel(numberFilter);
              if (parsed != null) {
                void (async () => {
                  const existingRiser = findRiserByTypeAndLabel(
                    risers,
                    typeId,
                    parsed,
                  );
                  if (existingRiser) {
                    selectExistingLabel(parsed);
                    return;
                  }
                  if (!onEnsureRiser) return;
                  const riserId = await onEnsureRiser(typeId, parsed);
                  if (riserId) addRiserId(riserId);
                })();
              } else if (selectedIds.length > 0) {
                commitSelection();
              }
            }
          }}
          className={fieldClass}
        />
        {numberMenuOpen && typeId ? (
          <ul className="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-24 overflow-auto rounded border border-slate-200 bg-white py-1 shadow-md">
            {filteredLabels.length > 0 ? (
              filteredLabels.map((value) => (
                <li key={value}>
                  <button
                    type="button"
                    onClick={() => selectExistingLabel(value)}
                    className="block w-full px-2 py-1.5 text-left text-xs text-slate-800 hover:bg-slate-50"
                  >
                    {value}
                  </button>
                </li>
              ))
            ) : (
              <li className="px-2 py-1.5 text-xs text-slate-500">
                {filterText ? "No matches" : "No labels yet"}
              </li>
            )}
            <li className="border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setAddOpen(true);
                  setAddValue(numberFilter);
                  setAddError(null);
                  setNumberMenuOpen(false);
                }}
                className="block w-full px-2 py-1.5 text-left text-xs font-medium text-sky-700 hover:bg-sky-50"
              >
                Add new label…
              </button>
            </li>
          </ul>
        ) : null}
      </div>

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selectedIds.map((riserId) => {
            const riser = lookupRiser(risers, riserId);
            return (
              <span
                key={riserId}
                className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-800"
              >
                {riser?.label ?? "?"}
                <button
                  type="button"
                  aria-label={`Remove riser ${riser?.label ?? riserId}`}
                  className="text-slate-500 hover:text-slate-900"
                  onClick={() => removeRiserId(riserId)}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      {selectedIds.length > 0 ? (
        <button
          type="button"
          disabled={saving || !typeId}
          onClick={() => {
            setNumberMenuOpen(true);
            setAddOpen(false);
          }}
          className="text-left text-[11px] font-medium text-sky-700 hover:text-sky-900 disabled:opacity-50"
        >
          + Add another
        </button>
      ) : null}

      {addOpen ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <p className="mb-1 text-[11px] font-medium text-slate-700">
            New {selectedType?.name ?? "riser"} label
          </p>
          <input
            type="text"
            value={addValue}
            disabled={saving}
            autoFocus
            onChange={(event) => {
              setAddValue(event.target.value);
              setAddError(null);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                void submitNewLabel();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setAddOpen(false);
              }
            }}
            className={fieldClass}
          />
          {addError ? (
            <p className="mt-1 text-[11px] text-red-600">{addError}</p>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void submitNewLabel()}
              className="rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="rounded px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function followOverlayRiserIds(item: FloorPlanAnnotation): string[] {
  if (item.type !== "rectangle" && item.type !== "circle") return [];
  if (!item.callout) return [];
  return calloutRiserIds(item.callout);
}

function FollowReviewButton({
  x,
  y,
  size,
  zoom,
  selected,
  label,
  onPointerDown,
  children,
}: {
  x: number;
  y: number;
  size: number;
  zoom: number;
  selected?: boolean;
  label: string;
  onPointerDown: (event: React.PointerEvent) => void;
  children: ReactNode;
}) {
  const stroke = screenPxToCanvasUnits(1.25, zoom);
  const radius = screenPxToCanvasUnits(3, zoom);
  return (
    <g
      role="button"
      aria-label={label}
      className="cursor-pointer"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        onPointerDown(event);
      }}
    >
      <rect
        x={x}
        y={y}
        width={size}
        height={size}
        rx={radius}
        fill="#ffffff"
        stroke={selected ? "#0ea5e9" : "#0f172a"}
        strokeWidth={selected ? stroke + screenPxToCanvasUnits(0.75, zoom) : stroke}
      />
      {children}
    </g>
  );
}

/** Approve / dismiss / move handles on an unsaved follow overlay box. */
function FollowReviewControls({
  item,
  pageHeight,
  scale,
  zoom,
  selected,
  onApprove,
  onDismiss,
  onMovePointerDown,
}: {
  item: FloorPlanAnnotation;
  pageHeight: number;
  scale: number;
  zoom: number;
  selected: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  onMovePointerDown: (event: React.PointerEvent) => void;
}) {
  const bounds = annotationPdfBounds(item);
  if (!bounds) return null;
  const size = screenPxToCanvasUnits(16, zoom);
  const gap = screenPxToCanvasUnits(3, zoom);
  const pad = screenPxToCanvasUnits(4, zoom);
  const icon = screenPxToCanvasUnits(1.5, zoom);
  const topRight = pdfPointToCanvas(
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    pageHeight,
    scale,
  );
  const stripWidth = size * 3 + gap * 2;
  const originX = topRight.x - stripWidth;
  const originY = topRight.y - size - pad;
  const moveX = originX;
  const checkX = originX + size + gap;
  const deleteX = originX + (size + gap) * 2;
  const cx = (x: number) => x + size / 2;
  const cy = originY + size / 2;
  const arm = size * 0.28;

  return (
    <g pointerEvents="all">
      <FollowReviewButton
        x={moveX}
        y={originY}
        size={size}
        zoom={zoom}
        selected={selected}
        label="Move this overlay on this floor"
        onPointerDown={onMovePointerDown}
      >
        <path
          d={`M ${cx(moveX)} ${cy - arm - size * 0.06} L ${cx(moveX)} ${cy + arm + size * 0.06} M ${cx(moveX) - arm - size * 0.06} ${cy} L ${cx(moveX) + arm + size * 0.06} ${cy} M ${cx(moveX) - size * 0.1} ${cy - arm} L ${cx(moveX)} ${cy - arm - size * 0.08} L ${cx(moveX) + size * 0.1} ${cy - arm} M ${cx(moveX) - size * 0.1} ${cy + arm} L ${cx(moveX)} ${cy + arm + size * 0.08} L ${cx(moveX) + size * 0.1} ${cy + arm} M ${cx(moveX) - arm} ${cy - size * 0.1} L ${cx(moveX) - arm - size * 0.08} ${cy} L ${cx(moveX) - arm} ${cy + size * 0.1} M ${cx(moveX) + arm} ${cy - size * 0.1} L ${cx(moveX) + arm + size * 0.08} ${cy} L ${cx(moveX) + arm} ${cy + size * 0.1}`}
          fill="none"
          stroke="#0f172a"
          strokeWidth={icon}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      </FollowReviewButton>
      <FollowReviewButton
        x={checkX}
        y={originY}
        size={size}
        zoom={zoom}
        label="Save this riser to this floor"
        onPointerDown={() => onApprove()}
      >
        <rect
          x={checkX + size * 0.22}
          y={originY + size * 0.22}
          width={size * 0.56}
          height={size * 0.56}
          rx={screenPxToCanvasUnits(1.5, zoom)}
          fill="none"
          stroke="#0f172a"
          strokeWidth={icon}
          pointerEvents="none"
        />
        <path
          d={`M ${checkX + size * 0.32} ${originY + size * 0.52} L ${checkX + size * 0.44} ${originY + size * 0.68} L ${checkX + size * 0.7} ${originY + size * 0.34}`}
          fill="none"
          stroke="#15803d"
          strokeWidth={icon}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      </FollowReviewButton>
      <FollowReviewButton
        x={deleteX}
        y={originY}
        size={size}
        zoom={zoom}
        label="Remove this overlay; the riser does not continue on this floor"
        onPointerDown={() => onDismiss()}
      >
        <path
          d={`M ${deleteX + size * 0.3} ${originY + size * 0.3} L ${deleteX + size * 0.7} ${originY + size * 0.7} M ${deleteX + size * 0.7} ${originY + size * 0.3} L ${deleteX + size * 0.3} ${originY + size * 0.7}`}
          stroke="#b91c1c"
          strokeWidth={icon}
          strokeLinecap="round"
          pointerEvents="none"
        />
      </FollowReviewButton>
    </g>
  );
}

function CalloutMarks({
  annotations,
  pageHeight,
  scale,
  zoom,
  editingIndex,
  interactive,
  ghost = false,
  ghostOpacity = 0.55,
  dashed = false,
  catalogMode = false,
  riserTypes = [],
  risers = [],
  catalogSaving = false,
  followedRiserIds = [],
  showRiserLabels = true,
  onPointerDown,
  onTextChange,
  onCommit,
  onRemove,
  onCatalogAssign,
  onCatalogType,
  onCatalogReclassify,
  onCatalogEnsureRiser,
}: {
  annotations: FloorPlanAnnotation[];
  pageHeight: number;
  scale: number;
  zoom: number;
  editingIndex: number | null;
  interactive: boolean;
  ghost?: boolean;
  ghostOpacity?: number;
  dashed?: boolean;
  catalogMode?: boolean;
  riserTypes?: MechanicalRiserTypeDto[];
  risers?: MechanicalRiserDto[];
  catalogSaving?: boolean;
  /** When set, only callouts for this riser stack are drawn (saved layer). */
  followedRiserIds?: string[];
  /** When false, hide mechanical riser callout bubbles (boxes stay visible). */
  showRiserLabels?: boolean;
  onPointerDown?: (index: number, event: React.PointerEvent) => void;
  onTextChange?: (index: number, text: string) => void;
  onCommit?: () => void;
  onRemove?: (index: number) => void;
  onCatalogAssign?: (index: number, typeId: string, riserIds: string[]) => void;
  onCatalogType?: (index: number, typeId: string) => void;
  onCatalogReclassify?: (
    riserIds: string[],
    typeId: string,
  ) => Promise<RiserIdRewrite | null>;
  onCatalogEnsureRiser?: (
    typeId: string,
    label: string,
  ) => Promise<string | null>;
}) {
  const marks: ReactNode[] = [];
  for (let index = 0; index < annotations.length; index++) {
    const item = annotations[index];
    if (!isConnectableBox(item) || item.callout == null) continue;
    if (
      followedRiserIds.length > 0 &&
      !annotationVisibleWhileFollowingRiser(item, followedRiserIds)
    ) {
      continue;
    }
    const callout = item.callout;
    const editing = interactive && editingIndex === index;
    const catalogEditing = catalogMode && editing;
    if (
      !showRiserLabels &&
      !catalogEditing &&
      !editing &&
      isMechanicalRiserCallout(callout)
    ) {
      continue;
    }
    const selectedRiserCount = catalogEditing
      ? calloutRiserIds(callout).length
      : 0;
    const editorHeightPx = catalogEditing
      ? catalogEditorHeightPx(Math.max(1, selectedRiserCount))
      : CATALOG_EDITOR_BASE_HEIGHT_PX;
    const displayText = resolveCalloutDisplayText(
      callout,
      riserTypes,
      risers,
    );
    const emptyPlaceholder = catalogMode ? "Type · #" : "Label";
    const screen = catalogEditing
      ? {
          widthPx: CATALOG_EDITOR_WIDTH_PX,
          heightPx: editorHeightPx,
          lines: [displayText],
        }
      : calloutBubbleScreenSize(displayText.length > 0 ? displayText : emptyPlaceholder);
    const width = screenPxToCanvasUnits(screen.widthPx, zoom);
    const height = screenPxToCanvasUnits(screen.heightPx, zoom);
    const center = pdfPointToCanvas(
      { x: callout.x, y: callout.y },
      pageHeight,
      scale,
    );
    const x = center.x - width / 2;
    const y = center.y - height / 2;
    const sizePt = calloutBubbleSizePt(
      catalogEditing ? "Type 99" : displayText.length > 0 ? displayText : emptyPlaceholder,
      scale,
      zoom,
    );
    const ends = calloutLeaderEndpoints(item, callout, sizePt);
    const fontSize = screenPxToCanvasUnits(CALLOUT_FONT_PX, zoom);
    const lineHeight = screenPxToCanvasUnits(CALLOUT_LINE_PX, zoom);
    const padX = screenPxToCanvasUnits(CALLOUT_PAD_X_PX, zoom);
    const padY = screenPxToCanvasUnits(CALLOUT_PAD_Y_PX, zoom);
    const stroke = screenPxToCanvasUnits(1.25, zoom);
    const radius = screenPxToCanvasUnits(3, zoom);
    const closeSize = screenPxToCanvasUnits(12, zoom);
    const placeholder = displayText.length === 0;
    const displayLines = catalogEditing
      ? []
      : calloutBubbleScreenSize(
          displayText.length === 0 ? emptyPlaceholder : displayText,
        ).lines;
    const dash = ghost || dashed
      ? `${screenPxToCanvasUnits(6, zoom)} ${screenPxToCanvasUnits(4, zoom)}`
      : undefined;

    marks.push(
      <g
        key={`callout-${index}`}
        opacity={ghost ? ghostOpacity : 1}
        style={catalogEditing ? { overflow: "visible" } : undefined}
      >
        {ends ? (
          <>
            <line
              x1={pdfPointToCanvas(ends.start, pageHeight, scale).x}
              y1={pdfPointToCanvas(ends.start, pageHeight, scale).y}
              x2={pdfPointToCanvas(ends.end, pageHeight, scale).x}
              y2={pdfPointToCanvas(ends.end, pageHeight, scale).y}
              stroke={item.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={dash}
              pointerEvents="none"
            />
            <ArrowHead
              start={ends.start}
              end={ends.end}
              pageHeight={pageHeight}
              scale={scale}
              zoom={zoom}
              color={item.color}
            />
          </>
        ) : null}
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={radius}
          fill="#ffffff"
          stroke={
            catalogEditing ? "none" : editing ? "#0ea5e9" : item.color
          }
          strokeWidth={
            catalogEditing
              ? 0
              : editing
                ? stroke + screenPxToCanvasUnits(1, zoom)
                : stroke
          }
          strokeDasharray={catalogEditing ? undefined : dash}
          pointerEvents={interactive && !ghost && !catalogEditing ? "all" : "none"}
          className={
            interactive && !ghost && !catalogEditing ? "cursor-move" : undefined
          }
          onPointerDown={
            interactive && !ghost && !catalogEditing
              ? (event) => {
                  if (event.button !== 0) return;
                  onPointerDown?.(index, event);
                }
              : undefined
          }
        />
        {catalogEditing ? (
          <foreignObject
            x={x}
            y={y}
            width={width}
            height={height}
            overflow="visible"
          >
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              style={{
                width: `${screen.widthPx}px`,
                height: `${screen.heightPx}px`,
                transform: `scale(${1 / Math.max(zoom, 0.01)})`,
                transformOrigin: "top left",
              }}
            >
              <CatalogCalloutEditor
                item={item}
                types={riserTypes}
                risers={risers}
                saving={catalogSaving}
                onAssign={(typeId, riserIds) =>
                  onCatalogAssign?.(index, typeId, riserIds)
                }
                onTypeChange={(typeId) => onCatalogType?.(index, typeId)}
                onReclassify={onCatalogReclassify}
                onEnsureRiser={onCatalogEnsureRiser}
                onCommit={() => onCommit?.()}
              />
            </div>
          </foreignObject>
        ) : editing ? (
          <foreignObject x={x} y={y} width={width} height={height}>
            <textarea
              autoFocus
              spellCheck={false}
              value={callout.text}
              placeholder="Label"
              onChange={(event) => onTextChange?.(index, event.target.value)}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCommit?.();
                } else if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onCommit?.();
                }
              }}
              onBlur={() => onCommit?.()}
              style={{
                width: "100%",
                height: "100%",
                boxSizing: "border-box",
                resize: "none",
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: `${fontSize}px`,
                lineHeight: `${lineHeight}px`,
                padding: `${padY}px ${padX}px`,
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
                color: item.color,
              }}
            />
          </foreignObject>
        ) : (
          <OutlinedText
            color={placeholder ? "#94a3b8" : item.color}
            fontSize={fontSize}
            zoom={zoom}
            textAnchor="start"
            fontWeight={400}
          >
            {displayLines.map((line, lineIndex) => (
              <tspan
                key={lineIndex}
                x={x + padX}
                y={y + padY + (lineIndex + 0.8) * lineHeight}
              >
                {line}
              </tspan>
            ))}
          </OutlinedText>
        )}
        {interactive && !ghost && editing ? (
          <g
            className="cursor-pointer"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              onRemove?.(index);
            }}
          >
            <circle
              cx={x + width}
              cy={y}
              r={closeSize / 2}
              fill="#0f172a"
              stroke="#ffffff"
              strokeWidth={screenPxToCanvasUnits(1, zoom)}
            />
            <path
              d={`M ${x + width - closeSize * 0.22} ${y - closeSize * 0.22} L ${x + width + closeSize * 0.22} ${y + closeSize * 0.22} M ${x + width + closeSize * 0.22} ${y - closeSize * 0.22} L ${x + width - closeSize * 0.22} ${y + closeSize * 0.22}`}
              stroke="#ffffff"
              strokeWidth={screenPxToCanvasUnits(1.25, zoom)}
              strokeLinecap="round"
              pointerEvents="none"
            />
          </g>
        ) : null}
      </g>,
    );
  }
  return marks.length > 0 ? <g>{marks}</g> : null;
}

function closedPolygonPath(
  points: PdfPoint[],
  pageHeight: number,
  scale: number,
): string {
  if (points.length < 3) return "";
  return `${polylinePath(points, pageHeight, scale)} Z`;
}

function RoomHoverFill({
  points,
  pageHeight,
  scale,
  zoom,
  color = "#0ea5e9",
  fillOpacity = 0.2,
}: {
  points: PdfPoint[];
  pageHeight: number;
  scale: number;
  zoom: number;
  color?: string;
  fillOpacity?: number;
}) {
  const d = closedPolygonPath(points, pageHeight, scale);
  if (!d) return null;
  return (
    <path
      d={d}
      fill={color}
      fillOpacity={fillOpacity}
      stroke={color}
      strokeWidth={screenPxToCanvasUnits(2, zoom)}
      pointerEvents="none"
    />
  );
}

function RoomLeakGlow({
  leaks,
  pageHeight,
  scale,
  zoom,
}: {
  leaks: RoomLeak[];
  pageHeight: number;
  scale: number;
  zoom: number;
}) {
  const reactId = useId().replace(/:/g, "");
  if (leaks.length === 0) return null;
  const minGlow = screenPxToCanvasUnits(22, zoom);
  const baseStroke = screenPxToCanvasUnits(3, zoom);
  return (
    <g pointerEvents="none" aria-hidden>
      {leaks.map((leak, index) => {
        const a = pdfPointToCanvas(leak.a, pageHeight, scale);
        const b = pdfPointToCanvas(leak.b, pageHeight, scale);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const gap = Math.hypot(b.x - a.x, b.y - a.y);
        // Narrower gaps get a stronger bloom so hairline near-misses stand out.
        const smallness = Math.min(
          1,
          Math.max(0, 1 - leak.width / MAX_ROOM_LEAK_MAX_GAP_PT),
        );
        const radius = Math.max(
          minGlow,
          gap * 1.5 + minGlow * (0.45 + smallness * 0.9),
        );
        const centerOpacity = 0.58 + smallness * 0.32;
        const midOpacity = 0.24 + smallness * 0.22;
        const stroke =
          baseStroke + smallness * screenPxToCanvasUnits(2.5, zoom);
        const gradientId = `room-leak-glow-${reactId}-${index}`;
        const showAnchor = smallness >= 0.35;
        const anchorR = stroke * (1.1 + smallness * 0.5);
        return (
          <g key={gradientId}>
            <defs>
              <radialGradient id={gradientId}>
                <stop
                  offset="0%"
                  stopColor="#ef4444"
                  stopOpacity={centerOpacity}
                />
                <stop
                  offset="38%"
                  stopColor="#ef4444"
                  stopOpacity={midOpacity}
                />
                <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle
              cx={mid.x}
              cy={mid.y}
              r={radius}
              fill={`url(#${gradientId})`}
            />
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#dc2626"
              strokeWidth={stroke}
              strokeLinecap="round"
            />
            {showAnchor ? (
              <circle
                cx={mid.x}
                cy={mid.y}
                r={anchorR}
                fill="#dc2626"
                stroke="#fef2f2"
                strokeWidth={screenPxToCanvasUnits(1, zoom)}
              />
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function RoomLabelEditor({
  item,
  pageHeight,
  scale,
  zoom,
  onChange,
  onCommit,
}: {
  item: Extract<FloorPlanAnnotation, { type: "room" }>;
  pageHeight: number;
  scale: number;
  zoom: number;
  onChange: (text: string) => void;
  onCommit: () => void;
}) {
  const centroid = polygonCentroid(item.points);
  const canvas = pdfPointToCanvas(centroid, pageHeight, scale);
  const widthPx = 148;
  const heightPx = 32;
  const width = screenPxToCanvasUnits(widthPx, zoom);
  const height = screenPxToCanvasUnits(heightPx, zoom);
  return (
    <foreignObject
      x={canvas.x - width / 2}
      y={canvas.y - height / 2}
      width={width}
      height={height}
      overflow="visible"
    >
      <div
        xmlns="http://www.w3.org/1999/xhtml"
        style={{
          width: `${widthPx}px`,
          height: `${heightPx}px`,
          transform: `scale(${1 / Math.max(zoom, 0.01)})`,
          transformOrigin: "top left",
        }}
      >
        <input
          autoFocus
          spellCheck={false}
          value={item.label}
          placeholder="Unit number"
          onChange={(event) => onChange(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape" || event.key === "Enter") {
              event.preventDefault();
              onCommit();
            }
          }}
          onBlur={() => onCommit()}
          className="h-8 w-full rounded border border-sky-400 bg-white px-2 text-sm font-semibold text-slate-800 shadow-sm outline-none"
        />
      </div>
    </foreignObject>
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
  dashed = false,
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
  dashed?: boolean;
  onSelect?: (index: number, event: React.PointerEvent<SVGPathElement>) => void;
}) {
  const stroke = savedStrokeWidth(item.strokeWidthPt, zoom);
  const hitStroke = screenPxToCanvasUnits(HIT_SCREEN_PX, zoom);
  const isRoom = item.type === "room";
  const closedHit =
    isRoom || item.type === "rectangle" || item.type === "circle";
  let d = "";
  if (item.type === "polyline" && item.points.length >= 2) {
    d = polylinePath(item.points, pageHeight, scale);
  } else if (isRoom && item.points.length >= 3) {
    d = `${polylinePath(item.points, pageHeight, scale)} Z`;
  } else if (item.type === "rectangle" || item.type === "circle") {
    d = boundingBoxAnnotationPath(item, pageHeight, scale);
  } else {
    return null;
  }

  const color = item.color;
  const isFilled =
    (item.type === "rectangle" || item.type === "circle") &&
    item.filled === true;
  const dash =
    ghost || dashed
      ? `${screenPxToCanvasUnits(6, zoom)} ${screenPxToCanvasUnits(4, zoom)}`
      : undefined;

  return (
    <g
      opacity={ghost ? ghostOpacity : 1}
      transform={
        item.type === "rectangle" || item.type === "circle"
          ? boxCanvasRotateTransform(item, pageHeight, scale)
          : undefined
      }
    >
      <path
        d={d}
        fill={isFilled ? color : isRoom ? color : "none"}
        fillOpacity={isFilled ? 1 : isRoom ? 0.14 : undefined}
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dash}
        pointerEvents="none"
      />
      {selected ? (
        <path
          d={d}
          fill={isFilled ? color : isRoom ? "#0ea5e9" : "none"}
          fillOpacity={isFilled ? 1 : isRoom ? 0.1 : undefined}
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
          fill={closedHit ? "transparent" : "none"}
          stroke="transparent"
          strokeWidth={Math.max(hitStroke, stroke)}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents={closedHit ? "all" : "stroke"}
          className="cursor-grab"
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

/** Overlay of saved and in-progress markup, including box callouts. */
export function FloorPlanAnnotationLayer({
  pageWidth,
  pageHeight,
  scale,
  zoom = 1,
  overlayAnnotations = [],
  overlayOpacity = 0.55,
  followedOverlayAnnotations = [],
  followedRiserIds = [],
  annotations,
  selectedIndices,
  selectionDraft,
  lineDraft,
  boundingBoxDraft,
  cutDraft,
  hoverSnap,
  hoverVertex = null,
  vertexDrag = null,
  hoverRoom = null,
  hoverLeaks = [],
  listHoverRoomIndex = null,
  editingRoomIndex = null,
  shapeDragging = false,
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
  connectDraftIndex = null,
  connectHoverIndex = null,
  connectDraftOverlayIndex = null,
  connectHoverOverlayIndex = null,
  selectedRiserAboveId = null,
  hoverRiserAboveId = null,
  onRiserSelect,
  showSavedAnnotations = true,
  showOverlayAnnotations = true,
  editingCalloutIndex = null,
  calloutInteractive = false,
  onCalloutPointerDown,
  onCalloutTextChange,
  onCalloutCommit,
  onCalloutRemove,
  onRoomLabelChange,
  onRoomCommit,
  calloutCatalogMode = false,
  riserTypes = [],
  mechanicalRisers = [],
  catalogSaving = false,
  onCalloutCatalogAssign,
  onCalloutCatalogType,
  onCalloutCatalogReclassify,
  onCalloutCatalogEnsureRiser,
  selectedFollowedRiserId = null,
  onFollowedApprove,
  onFollowedDismiss,
  onFollowedMovePointerDown,
  onFollowedSelect,
  showRiserLabels = true,
  markupExtent = null,
  showPageBoundsOutline = false,
}: {
  pageWidth: number;
  pageHeight: number;
  scale: number;
  zoom?: number;
  overlayAnnotations?: FloorPlanAnnotation[];
  overlayOpacity?: number;
  /** Followed riser preview from the floor below; dashed until approved. */
  followedOverlayAnnotations?: FloorPlanAnnotation[];
  /** When non-empty, only those riser stacks' saved boxes/callouts are drawn. */
  followedRiserIds?: string[];
  /** Overlay box selected for this-floor move / arrow-key nudge. */
  selectedFollowedRiserId?: string | null;
  onFollowedApprove?: (index: number) => void;
  onFollowedDismiss?: (index: number) => void;
  onFollowedMovePointerDown?: (
    index: number,
    event: React.PointerEvent,
  ) => void;
  onFollowedSelect?: (riserId: string | null) => void;
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
  hoverRoom?: RoomFace | null;
  /** Near-miss wall gaps for the room under the cursor. */
  hoverLeaks?: RoomLeak[];
  /** Room highlighted from the ribbon unit list. */
  listHoverRoomIndex?: number | null;
  editingRoomIndex?: number | null;
  shapeDragging?: boolean;
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
  connectDraftOverlayIndex?: number | null;
  connectHoverOverlayIndex?: number | null;
  selectedRiserAboveId?: string | null;
  hoverRiserAboveId?: string | null;
  onRiserSelect?: (
    aboveId: string,
    event: React.PointerEvent<SVGLineElement>,
  ) => void;
  editingCalloutIndex?: number | null;
  calloutInteractive?: boolean;
  onCalloutPointerDown?: (
    index: number,
    event: React.PointerEvent,
  ) => void;
  onCalloutTextChange?: (index: number, text: string) => void;
  onCalloutCommit?: () => void;
  onCalloutRemove?: (index: number) => void;
  onRoomLabelChange?: (index: number, text: string) => void;
  onRoomCommit?: () => void;
  calloutCatalogMode?: boolean;
  riserTypes?: MechanicalRiserTypeDto[];
  mechanicalRisers?: MechanicalRiserDto[];
  catalogSaving?: boolean;
  onCalloutCatalogAssign?: (
    index: number,
    typeId: string,
    riserIds: string[],
  ) => void;
  onCalloutCatalogType?: (index: number, typeId: string) => void;
  onCalloutCatalogReclassify?: (
    riserIds: string[],
    typeId: string,
  ) => Promise<RiserIdRewrite | null>;
  onCalloutCatalogEnsureRiser?: (
    typeId: string,
    label: string,
  ) => Promise<string | null>;
  /** When false, hide mechanical riser callout bubbles (boxes stay visible). */
  showRiserLabels?: boolean;
  /** When set and larger than the page, the SVG grows so off-canvas markup is visible. */
  markupExtent?: PdfMarkupExtent | null;
  /** Dashed outline of the PDF page when markup extends past it. */
  showPageBoundsOutline?: boolean;
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
    followedOverlayAnnotations.length > 0 ||
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
          ? rotatePdfPointsAround(
              rectangleToPolylinePoints(item.rect),
              pdfRectCenter(item.rect),
              annotationRotationDeg(item),
            )
          : item.type === "circle"
            ? rotatePdfPointsAround(
                circleToPolylinePoints(item.rect),
                pdfRectCenter(item.rect),
                annotationRotationDeg(item),
              )
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

  const followReviewActive =
    followedOverlayAnnotations.length > 0 &&
    onFollowedApprove != null &&
    !drawInteractive;
  const pointerActive =
    drawInteractive || Boolean(selectInteractive) || followReviewActive;

  const extentActive =
    markupExtent != null &&
    markupExtentExceedsPage(markupExtent, pageWidth, pageHeight);
  const layerTransform = extentActive
    ? `translate(${-markupExtent!.minX * scale}, ${-(pageHeight - markupExtent!.maxY) * scale})`
    : undefined;
  const svgPositionStyle: React.CSSProperties | undefined = extentActive
    ? {
        left: markupExtent!.minX * scale,
        top: (pageHeight - markupExtent!.maxY) * scale,
        width: (markupExtent!.maxX - markupExtent!.minX) * scale,
        height: (markupExtent!.maxY - markupExtent!.minY) * scale,
        overflow: "visible",
      }
    : undefined;

  const handleSelectOrFollowPointerDown = (
    event: React.PointerEvent<SVGSVGElement>,
  ) => {
    if (selectInteractive) {
      onSelectPointerDown?.(event);
      return;
    }
    if (followReviewActive && event.button === 0) {
      onFollowedSelect?.(null);
    }
  };

  return (
    <svg
      className={`absolute z-[30] outline-none ${
        extentActive ? "" : "inset-0 h-full w-full"
      }${pointerActive ? " pointer-events-auto" : " pointer-events-none"}${
        shapeDragging ? " cursor-grabbing" : selectInteractive && hoverVertex ? " cursor-move" : hoverRoom || hoverLeaks.length > 0 ? " cursor-cell" : ""
      }`}
      style={{
        touchAction: pointerActive ? "none" : undefined,
        ...svgPositionStyle,
      }}
      tabIndex={drawInteractive ? -1 : undefined}
      aria-label={drawInteractive ? "Floor plan drawing canvas" : undefined}
      onPointerDown={
        drawInteractive
          ? onPointerDown
          : selectInteractive || followReviewActive
            ? handleSelectOrFollowPointerDown
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
      <g transform={layerTransform}>
      {showPageBoundsOutline && extentActive ? (
        <rect
          x={0}
          y={0}
          width={pageWidth * scale}
          height={pageHeight * scale}
          fill="none"
          stroke="#94a3b8"
          strokeWidth={screenPxToCanvasUnits(1.5, zoom)}
          strokeDasharray={`${screenPxToCanvasUnits(8, zoom)} ${screenPxToCanvasUnits(6, zoom)}`}
          pointerEvents="none"
        />
      ) : null}
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
        <CalloutMarks
          annotations={overlayAnnotations}
          pageHeight={pageHeight}
          scale={scale}
          zoom={zoom}
          editingIndex={null}
          interactive={false}
          ghost
          ghostOpacity={overlayOpacity}
          catalogMode={calloutCatalogMode}
          riserTypes={riserTypes}
          risers={mechanicalRisers}
          showRiserLabels={showRiserLabels}
        />
      </g>
      {followedOverlayAnnotations.length > 0 ? (
        <g pointerEvents={followReviewActive ? "auto" : "none"}>
          {followedOverlayAnnotations.map((item, index) => {
            const riserIds = followOverlayRiserIds(item);
            const selected =
              selectedFollowedRiserId != null &&
              riserIds.includes(selectedFollowedRiserId);
            return (
              <g key={`follow-${index}`}>
                <AnnotationShape
                  item={item}
                  index={index}
                  pageHeight={pageHeight}
                  scale={scale}
                  zoom={zoom}
                  selected={selected}
                  selectable={false}
                  dashed
                />
              </g>
            );
          })}
          {([
            [connectHoverOverlayIndex, CONNECT_HOVER_COLOR, "connect-overlay-hover"],
            [connectDraftOverlayIndex, CONNECT_PENDING_COLOR, "connect-overlay-pending"],
          ] as const).map(([index, color, key]) => {
            if (index == null) return null;
            const item = followedOverlayAnnotations[index];
            if (!isConnectableBox(item)) return null;
            return (
              <g
                key={key}
                transform={boxCanvasRotateTransform(item, pageHeight, scale)}
              >
                <path
                  d={boxFillPath(item, pageHeight, scale)}
                  fill={color}
                  fillOpacity={0.18}
                  stroke={color}
                  strokeWidth={screenPxToCanvasUnits(3.5, zoom)}
                  pointerEvents="none"
                />
              </g>
            );
          })}
          <CalloutMarks
            annotations={followedOverlayAnnotations}
            pageHeight={pageHeight}
            scale={scale}
            zoom={zoom}
            editingIndex={null}
            interactive={false}
            dashed
            catalogMode={calloutCatalogMode}
            riserTypes={riserTypes}
            risers={mechanicalRisers}
            showRiserLabels={showRiserLabels}
          />
          {followReviewActive
            ? followedOverlayAnnotations.map((item, index) => (
                <FollowReviewControls
                  key={`follow-review-${index}`}
                  item={item}
                  pageHeight={pageHeight}
                  scale={scale}
                  zoom={zoom}
                  selected={
                    selectedFollowedRiserId != null &&
                    followOverlayRiserIds(item).includes(selectedFollowedRiserId)
                  }
                  onApprove={() => onFollowedApprove?.(index)}
                  onDismiss={() => onFollowedDismiss?.(index)}
                  onMovePointerDown={(event) =>
                    onFollowedMovePointerDown?.(index, event)
                  }
                />
              ))
            : null}
        </g>
      ) : null}
      <g
        visibility={savedVisible ? "visible" : "hidden"}
        pointerEvents={savedVisible ? undefined : "none"}
      >
        {annotations.map((item, index) => {
          if (item.type !== "room") return null;
          if (
            followedRiserIds.length > 0 &&
            !annotationVisibleWhileFollowingRiser(item, followedRiserIds)
          ) {
            return null;
          }
          const roomColor = roomDisplayColor(annotations, index);
          return (
            <AnnotationShape
              key={`room-${index}`}
              item={{ ...item, color: roomColor }}
              index={index}
              pageHeight={pageHeight}
              scale={scale}
              zoom={zoom}
              selected={selectedSet.has(index)}
              selectable={selectable && savedVisible}
              onSelect={onAnnotationSelect}
            />
          );
        })}
        {hoverRoom ? (
          <RoomHoverFill
            points={hoverRoom.points}
            pageHeight={pageHeight}
            scale={scale}
            zoom={zoom}
          />
        ) : null}
        <RoomLeakGlow
          leaks={hoverLeaks}
          pageHeight={pageHeight}
          scale={scale}
          zoom={zoom}
        />
        {listHoverRoomIndex != null &&
        (() => {
          const item = annotations[listHoverRoomIndex];
          return item?.type === "room" ? (
            <RoomHoverFill
              points={item.points}
              pageHeight={pageHeight}
              scale={scale}
              zoom={zoom}
              color={roomDisplayColor(annotations, listHoverRoomIndex)}
              fillOpacity={0.32}
            />
          ) : null;
        })()}
        {annotations.map((item, index) => {
          if (
            followedRiserIds.length > 0 &&
            !annotationVisibleWhileFollowingRiser(item, followedRiserIds)
          ) {
            return null;
          }
          if (item.type === "room") {
            if (editingRoomIndex === index) {
              return (
                <RoomLabelEditor
                  key={`room-edit-${index}`}
                  item={item}
                  pageHeight={pageHeight}
                  scale={scale}
                  zoom={zoom}
                  onChange={(text) => onRoomLabelChange?.(index, text)}
                  onCommit={() => onRoomCommit?.()}
                />
              );
            }
            if (!item.label.trim()) return null;
            const centroid = polygonCentroid(item.points);
            const canvas = pdfPointToCanvas(centroid, pageHeight, scale);
            const fontSize = screenPxToCanvasUnits(ROOM_LABEL_FONT_PX, zoom);
            return (
              <OutlinedLabel
                key={`room-label-${index}`}
                x={canvas.x}
                y={canvas.y + fontSize * 0.35}
                color={roomDisplayColor(annotations, index)}
                fontSize={fontSize}
                zoom={zoom}
              >
                {item.label}
              </OutlinedLabel>
            );
          }
          return (
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
          );
        })}
      </g>
      {savedVisible ? (
        <RiserOffsetOverlay
          annotations={annotations}
          pageHeight={pageHeight}
          scale={scale}
          zoom={zoom}
          connectDraftIndex={connectDraftIndex}
          connectHoverIndex={connectHoverIndex}
          riserSelectable={selectInteractive && selectable}
          selectedRiserAboveId={selectedRiserAboveId}
          hoverRiserAboveId={hoverRiserAboveId}
          followedRiserIds={followedRiserIds}
          onRiserSelect={onRiserSelect}
        />
      ) : null}
      {savedVisible ? (
        <CalloutMarks
          annotations={annotations}
          pageHeight={pageHeight}
          scale={scale}
          zoom={zoom}
          editingIndex={editingCalloutIndex}
          interactive={calloutInteractive && savedVisible}
          catalogMode={calloutCatalogMode}
          riserTypes={riserTypes}
          risers={mechanicalRisers}
          catalogSaving={catalogSaving}
          followedRiserIds={followedRiserIds}
          showRiserLabels={showRiserLabels}
          onPointerDown={onCalloutPointerDown}
          onTextChange={onCalloutTextChange}
          onCommit={onCalloutCommit}
          onRemove={onCalloutRemove}
          onCatalogAssign={onCalloutCatalogAssign}
          onCatalogType={onCalloutCatalogType}
          onCatalogReclassify={onCalloutCatalogReclassify}
          onCatalogEnsureRiser={onCalloutCatalogEnsureRiser}
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
      </g>
    </svg>
  );
}
