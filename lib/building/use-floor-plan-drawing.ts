"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  canvasPointToPdf,
  panZoomViewportToPage,
  type PdfPanZoom,
  type PdfPoint,
} from "@/lib/building/floor-plan-align";
import {
  pdfDeltaPerScreenPixel,
  resolveLineCursor,
  snapApproachFrom,
  snapPoint,
  snapThresholdPt,
  annotationsExcludingIndex,
  hitTestVertex,
  vertexDragAnchor,
  hitTestAnnotations,
  type SnapResult,
} from "@/lib/building/floor-plan-draw-snap";
import {
  cutPolylineBetweenLocations,
  locatePointOnPolyline,
  circleToPolylinePoints,
  rectangleToPolylinePoints,
  type PolylineCutLocation,
} from "@/lib/building/floor-plan-polyline-cut";
import {
  DRAW_COLORS,
  STROKE_WIDTHS_PT,
  findDrawColorPresetByShortcut,
  indicesInSelectionRect,
  constrainBoxCorner,
  normalizeStrokeColor,
  offsetAnnotation,
  pdfRectFromCorners,
  stampAnnotationMarkupSet,
  type CutDraft,
  type CutDraftPoint,
  type BoundingBoxDraft,
  type DrawColorPreset,
  type DrawTool,
  type FloorPlanAnnotation,
  type LineDraft,
  type MechanicalMarkupSet,
  type ShapeCrossVariant,
  type SelectionDraft,
  type VertexDragDraft,
  type VertexHover,
  annotationRotationDeg,
  pdfRectCenter,
  rotatePdfPointsAround,
  rotationFromPointerDrag,
  withAnnotationRotation,
} from "@/lib/building/floor-plan-annotations";
import {
  calloutCopiedOnConnect,
  clearDanglingRiserLinks,
  connectNeedsRiserChoice,
  connectRiserBoxes,
  disconnectRiserBox,
  hitTestConnectableBox,
  hitTestRiserPair,
  isConnectableBox,
  listRiserPairs,
  placeAndConnectRiserBox,
  reverseRiserPair,
  type ConnectPlaceDraft,
  type ConnectRiserChoice,
  type ConnectableBox,
} from "@/lib/building/floor-plan-riser-links";
import { defaultCallout } from "@/lib/building/floor-plan-callouts";
import {
  annotationVisibleWhileFollowingRiser,
  calloutRiserIds,
  type MechanicalRiserDto,
  type MechanicalRiserTypeDto,
} from "@/lib/building/floor-plan-mechanical-risers";
import {
  buildRoomLeakIndex,
  clampRoomLeakMaxGapPt,
  DEFAULT_ROOM_JOIN_EPS_PT,
  DEFAULT_ROOM_LEAK_MAX_GAP_PT,
  enclosingRoomFaceFromCache,
  findMatchingRoomIndex,
  nextRoomColor,
  roomLeaksAtPoint,
  shiftRoomUiIndexAfterRemoval,
  type RoomFace,
  type RoomLeak,
  type RoomLeakIndex,
} from "@/lib/building/floor-plan-rooms";

const MIN_BOX_PT = 0.5;
const SNAP_SCREEN_PX = 10;
const SHAPE_DRAG_SCREEN_PX = 3;
const MAX_UNDO_STACK = 50;

function samePdfPoint(a: PdfPoint | undefined, b: PdfPoint | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y;
}

function sameSnapSegment(
  a: SnapResult["segment"],
  b: SnapResult["segment"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return samePdfPoint(a.a, b.a) && samePdfPoint(a.b, b.b);
}

function isBoxTool(tool: DrawTool): tool is "rectangle" | "circle" {
  return tool === "rectangle" || tool === "circle";
}

type ConnectHit =
  | { kind: "annotation"; index: number }
  | { kind: "overlay"; index: number };

export function useFloorPlanDrawing({
  pageHeight,
  scale,
  expanded,
  view,
  pageRef,
  viewportRef,
  colorPresets,
  referenceOverlayAnnotationsRef,
  followedOverlayAnnotationsRef,
  followedRiserIds = [],
  onHideReferenceOverlayAnnotation,
  initial,
  calloutEnabled = true,
  markupSet = 1,
}: {
  pageHeight: number;
  scale: number;
  expanded: boolean;
  view: PdfPanZoom;
  pageRef: React.RefObject<HTMLDivElement | null>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  colorPresets: DrawColorPreset[];
  referenceOverlayAnnotationsRef?: React.RefObject<FloorPlanAnnotation[]>;
  followedOverlayAnnotationsRef?: React.RefObject<FloorPlanAnnotation[]>;
  followedRiserIds?: string[];
  onHideReferenceOverlayAnnotation?: (annotation: FloorPlanAnnotation) => void;
  calloutEnabled?: boolean;
  markupSet?: MechanicalMarkupSet;
  initial?: {
    drawTool?: DrawTool;
    rectangleVariant?: ShapeCrossVariant;
    circleVariant?: ShapeCrossVariant;
    strokeColor?: string;
    strokeWidthPt?: number;
  };
}) {
  const [drawTool, setDrawTool] = useState<DrawTool>(
    initial?.drawTool ?? "none",
  );
  const [rectangleVariant, setRectangleVariant] = useState<ShapeCrossVariant>(
    initial?.rectangleVariant ?? "plain",
  );
  const [circleVariant, setCircleVariant] = useState<ShapeCrossVariant>(
    initial?.circleVariant ?? "plain",
  );
  const [strokeColor, setStrokeColor] = useState<string>(
    initial?.strokeColor ?? DRAW_COLORS[0],
  );
  const [strokeWidthPt, setStrokeWidthPt] = useState(
    initial?.strokeWidthPt ?? 2,
  );
  const [annotations, setAnnotations] = useState<FloorPlanAnnotation[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(
    null,
  );
  const [lineDraft, setLineDraft] = useState<LineDraft | null>(null);
  const [boundingBoxDraft, setBoundingBoxDraft] =
    useState<BoundingBoxDraft | null>(null);
  const [hoverSnap, setHoverSnap] = useState<SnapResult | null>(null);
  const [hoverVertex, setHoverVertex] = useState<VertexHover | null>(null);
  const [vertexDrag, setVertexDrag] = useState<VertexDragDraft | null>(null);
  const [hoverRoom, setHoverRoom] = useState<RoomFace | null>(null);
  const [hoverLeaks, setHoverLeaks] = useState<RoomLeak[]>([]);
  const [leakMaxGapPt, setLeakMaxGapPt] = useState(DEFAULT_ROOM_LEAK_MAX_GAP_PT);
  const [listHoverRoomIndex, setListHoverRoomIndex] = useState<number | null>(
    null,
  );
  const [editingRoomIndex, setEditingRoomIndex] = useState<number | null>(
    null,
  );
  const [shapeDragging, setShapeDragging] = useState(false);
  const [cutDraft, setCutDraft] = useState<CutDraft | null>(null);
  const [connectDraftIndex, setConnectDraftIndex] = useState<number | null>(
    null,
  );
  const [connectHoverIndex, setConnectHoverIndex] = useState<number | null>(
    null,
  );
  const [connectDraftOverlayIndex, setConnectDraftOverlayIndex] = useState<
    number | null
  >(null);
  const [connectHoverOverlayIndex, setConnectHoverOverlayIndex] = useState<
    number | null
  >(null);
  const [connectRiserChoice, setConnectRiserChoice] =
    useState<ConnectRiserChoice | null>(null);
  const [selectedRiserAboveId, setSelectedRiserAboveId] = useState<
    string | null
  >(null);
  const [hoverRiserAboveId, setHoverRiserAboveId] = useState<string | null>(
    null,
  );
  const [editingCalloutIndex, setEditingCalloutIndex] = useState<
    number | null
  >(null);
  const boxDraggingRef = useRef(false);
  const boxStartRef = useRef<PdfPoint | null>(null);
  const drawToolRef = useRef(drawTool);
  drawToolRef.current = drawTool;
  const calloutEnabledRef = useRef(calloutEnabled);
  calloutEnabledRef.current = calloutEnabled;
  const markupSetRef = useRef(markupSet);
  markupSetRef.current = markupSet;
  const rectangleVariantRef = useRef(rectangleVariant);
  rectangleVariantRef.current = rectangleVariant;
  const circleVariantRef = useRef(circleVariant);
  circleVariantRef.current = circleVariant;
  const strokeColorRef = useRef(strokeColor);
  strokeColorRef.current = strokeColor;
  const strokeWidthRef = useRef(strokeWidthPt);
  strokeWidthRef.current = strokeWidthPt;
  const colorPresetsRef = useRef(colorPresets);
  colorPresetsRef.current = colorPresets;
  const lineDraftRef = useRef(lineDraft);
  lineDraftRef.current = lineDraft;
  const cutDraftRef = useRef(cutDraft);
  cutDraftRef.current = cutDraft;
  const connectDraftIndexRef = useRef(connectDraftIndex);
  connectDraftIndexRef.current = connectDraftIndex;
  const connectDraftOverlayIndexRef = useRef(connectDraftOverlayIndex);
  connectDraftOverlayIndexRef.current = connectDraftOverlayIndex;
  const connectRiserChoiceRef = useRef(connectRiserChoice);
  connectRiserChoiceRef.current = connectRiserChoice;
  const followedRiserIdsRef = useRef(followedRiserIds);
  followedRiserIdsRef.current = followedRiserIds;
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const selectedIndicesRef = useRef(selectedIndices);
  selectedIndicesRef.current = selectedIndices;
  const selectedRiserAboveIdRef = useRef(selectedRiserAboveId);
  selectedRiserAboveIdRef.current = selectedRiserAboveId;
  const selectionDraggingRef = useRef(false);
  const selectionStartRef = useRef<PdfPoint | null>(null);
  const vertexDraggingRef = useRef(false);
  const vertexDragRef = useRef(vertexDrag);
  vertexDragRef.current = vertexDrag;
  const shapeDraggingRef = useRef(false);
  const shapeDragStartRef = useRef<PdfPoint | null>(null);
  const shapeDragIndicesRef = useRef<number[]>([]);
  const shapeDragOriginalsRef = useRef<Map<number, FloorPlanAnnotation>>(
    new Map(),
  );
  const shapeDragMovedRef = useRef(false);
  const shapeDragUndoPushedRef = useRef(false);
  const editingCalloutIndexRef = useRef(editingCalloutIndex);
  editingCalloutIndexRef.current = editingCalloutIndex;
  const editingRoomIndexRef = useRef(editingRoomIndex);
  editingRoomIndexRef.current = editingRoomIndex;
  const roomLabelUndoPushedForRef = useRef<Set<number>>(new Set());
  const calloutDraggingRef = useRef(false);
  const calloutDragIndexRef = useRef<number | null>(null);
  const calloutDragGrabRef = useRef<PdfPoint | null>(null);
  const calloutDragMovedRef = useRef(false);
  const calloutDragUndoPushedRef = useRef(false);
  const rotateDraggingRef = useRef(false);
  const rotateIndexRef = useRef<number | null>(null);
  const rotateCenterRef = useRef<PdfPoint | null>(null);
  const rotateStartPointerRef = useRef<PdfPoint | null>(null);
  const rotateStartDegRef = useRef(0);
  const rotateUndoPushedRef = useRef(false);
  const shiftDownRef = useRef(false);
  const extensionsDisabledRef = useRef(false);
  const lastRawCursorRef = useRef<PdfPoint | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const undoStackRef = useRef<FloorPlanAnnotation[][]>([]);

  const boxVariantForTool = useCallback((tool: "rectangle" | "circle") => {
    return tool === "circle"
      ? circleVariantRef.current
      : rectangleVariantRef.current;
  }, []);

  const applyLineDraft = useCallback((next: LineDraft | null) => {
    lineDraftRef.current = next;
    setLineDraft(next);
  }, []);

  const applyCutDraft = useCallback((next: CutDraft | null) => {
    cutDraftRef.current = next;
    setCutDraft(next);
  }, []);

  const pushUndoSnapshot = useCallback(() => {
    undoStackRef.current.push(
      JSON.parse(JSON.stringify(annotationsRef.current)) as FloorPlanAnnotation[],
    );
    if (undoStackRef.current.length > MAX_UNDO_STACK) {
      undoStackRef.current.shift();
    }
  }, []);

  const undoAnnotationSnapshot = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return false;
    setAnnotations(prev);
    setSelectedIndices([]);
    setSelectedRiserAboveId(null);
    return true;
  }, []);

  const drawingActive = drawTool !== "none";
  const markupSelectable = drawTool === "none" && annotations.length > 0;
  const selectionInteractive = markupSelectable;

  const deselectAnnotations = useCallback(() => {
    setSelectedIndices([]);
    setSelectedRiserAboveId(null);
  }, []);

  const selectRiserConnection = useCallback(
    (aboveId: string, additive: boolean) => {
      setSelectedRiserAboveId((prev) => {
        if (additive && prev === aboveId) return null;
        return aboveId;
      });
      if (!additive) {
        setSelectedIndices([]);
      }
    },
    [],
  );

  const flipSelectedRiserDirection = useCallback(() => {
    const aboveId = selectedRiserAboveIdRef.current;
    if (!aboveId) return;
    const pair = listRiserPairs(annotationsRef.current).find(
      (item) => item.above.id === aboveId,
    );
    if (!pair) {
      setSelectedRiserAboveId(null);
      return;
    }
    const next = reverseRiserPair(
      annotationsRef.current,
      pair.aboveIndex,
      pair.belowIndex,
    );
    if (!next || next === annotationsRef.current) return;
    pushUndoSnapshot();
    setAnnotations(next);
    setSelectedRiserAboveId(pair.below.id ?? null);
  }, [pushUndoSnapshot]);

  const deleteSelected = useCallback(() => {
    const indices = selectedIndicesRef.current;
    if (indices.length === 0) return;
    pushUndoSnapshot();
    const remove = new Set(indices);
    setAnnotations((prev) =>
      clearDanglingRiserLinks(prev.filter((_, i) => !remove.has(i))),
    );
    setSelectedIndices([]);
  }, [pushUndoSnapshot]);

  const nudgeSelected = useCallback((dx: number, dy: number) => {
    const indices = selectedIndicesRef.current;
    if (indices.length === 0) return;
    const move = new Set(indices);
    pushUndoSnapshot();
    setAnnotations((prev) =>
      prev.map((item, i) => (move.has(i) ? offsetAnnotation(item, dx, dy) : item)),
    );
  }, [pushUndoSnapshot]);

  const clearShapeDrag = useCallback(() => {
    shapeDraggingRef.current = false;
    shapeDragStartRef.current = null;
    shapeDragIndicesRef.current = [];
    shapeDragOriginalsRef.current = new Map();
    shapeDragMovedRef.current = false;
    shapeDragUndoPushedRef.current = false;
    setShapeDragging(false);
  }, []);

  const updateShapeDrag = useCallback(
    (raw: PdfPoint) => {
      if (!shapeDraggingRef.current) return;
      const start = shapeDragStartRef.current;
      if (!start) return;
      const dx = raw.x - start.x;
      const dy = raw.y - start.y;
      const threshold =
        pdfDeltaPerScreenPixel(
          scale,
          expanded ? viewRef.current.zoom : 1,
        ) * SHAPE_DRAG_SCREEN_PX;
      if (
        !shapeDragMovedRef.current &&
        Math.hypot(dx, dy) < Math.max(threshold, 0.05)
      ) {
        return;
      }
      if (!shapeDragMovedRef.current) {
        shapeDragMovedRef.current = true;
        setShapeDragging(true);
      }
      if (!shapeDragUndoPushedRef.current) {
        pushUndoSnapshot();
        shapeDragUndoPushedRef.current = true;
      }
      const originals = shapeDragOriginalsRef.current;
      setAnnotations((prev) =>
        prev.map((item, i) => {
          const origin = originals.get(i);
          return origin ? offsetAnnotation(origin, dx, dy) : item;
        }),
      );
    },
    [expanded, pushUndoSnapshot, scale],
  );

  const finishShapeDrag = useCallback(
    (event?: React.PointerEvent | PointerEvent) => {
      if (!shapeDraggingRef.current) return;
      if (
        event &&
        "hasPointerCapture" in event.currentTarget &&
        typeof event.currentTarget.hasPointerCapture === "function" &&
        event.currentTarget.hasPointerCapture(event.pointerId)
      ) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      clearShapeDrag();
    },
    [clearShapeDrag],
  );

  const startShapeDrag = useCallback(
    (
      indices: number[],
      raw: PdfPoint,
      event: React.PointerEvent,
    ) => {
      const originals = new Map<number, FloorPlanAnnotation>();
      for (const index of indices) {
        const item = annotationsRef.current[index];
        if (item) originals.set(index, item);
      }
      shapeDraggingRef.current = true;
      shapeDragStartRef.current = raw;
      shapeDragIndicesRef.current = indices;
      shapeDragOriginalsRef.current = originals;
      shapeDragMovedRef.current = false;
      shapeDragUndoPushedRef.current = false;
      lastRawCursorRef.current = raw;
      if (
        "setPointerCapture" in event.currentTarget &&
        typeof event.currentTarget.setPointerCapture === "function"
      ) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [],
  );

  const updateCalloutDrag = useCallback((raw: PdfPoint) => {
    const index = calloutDragIndexRef.current;
    const grab = calloutDragGrabRef.current;
    if (index == null || grab == null) return;
    const item = annotationsRef.current[index];
    if (!isConnectableBox(item) || item.callout == null) return;
    const next = { x: raw.x - grab.x, y: raw.y - grab.y };
    if (
      Math.hypot(next.x - item.callout.x, next.y - item.callout.y) > 0.2
    ) {
      calloutDragMovedRef.current = true;
    }
    if (calloutDragMovedRef.current && !calloutDragUndoPushedRef.current) {
      pushUndoSnapshot();
      calloutDragUndoPushedRef.current = true;
    }
    setAnnotations((prev) =>
      prev.map((entry, i) => {
        if (i !== index || !isConnectableBox(entry) || entry.callout == null) {
          return entry;
        }
        return { ...entry, callout: { ...entry.callout, x: next.x, y: next.y } };
      }),
    );
  }, [pushUndoSnapshot]);

  const finishCalloutDrag = useCallback(() => {
    if (!calloutDraggingRef.current) return;
    const index = calloutDragIndexRef.current;
    const moved = calloutDragMovedRef.current;
    calloutDraggingRef.current = false;
    calloutDragIndexRef.current = null;
    calloutDragGrabRef.current = null;
    calloutDragMovedRef.current = false;
    calloutDragUndoPushedRef.current = false;
    if (!moved && index != null) {
      pushUndoSnapshot();
      setEditingCalloutIndex(index);
    }
  }, [pushUndoSnapshot]);

  const clearRotateDrag = useCallback(() => {
    rotateDraggingRef.current = false;
    rotateIndexRef.current = null;
    rotateCenterRef.current = null;
    rotateStartPointerRef.current = null;
    rotateStartDegRef.current = 0;
    rotateUndoPushedRef.current = false;
  }, []);

  const applyRotateAtPointer = useCallback(
    (raw: PdfPoint) => {
      if (!rotateDraggingRef.current) return;
      const index = rotateIndexRef.current;
      const center = rotateCenterRef.current;
      const startPointer = rotateStartPointerRef.current;
      if (index == null || center == null || startPointer == null) return;
      const dist = Math.hypot(raw.x - center.x, raw.y - center.y);
      if (dist < 2) return;
      const nextDeg = rotationFromPointerDrag(
        startPointer,
        raw,
        center,
        rotateStartDegRef.current,
        shiftDownRef.current,
      );
      const item = annotationsRef.current[index];
      if (!isConnectableBox(item)) return;
      if (annotationRotationDeg(item) === nextDeg) return;
      if (!rotateUndoPushedRef.current) {
        pushUndoSnapshot();
        rotateUndoPushedRef.current = true;
      }
      setAnnotations((prev) =>
        prev.map((entry, i) =>
          i === index && isConnectableBox(entry)
            ? withAnnotationRotation(entry, nextDeg)
            : entry,
        ),
      );
    },
    [pushUndoSnapshot],
  );

  const finishRotateDrag = useCallback(() => {
    clearRotateDrag();
  }, [clearRotateDrag]);

  const onCalloutTextChange = useCallback((index: number, text: string) => {
    setAnnotations((prev) =>
      prev.map((entry, i) => {
        if (i !== index || !isConnectableBox(entry) || entry.callout == null) {
          return entry;
        }
        return { ...entry, callout: { ...entry.callout, text } };
      }),
    );
  }, []);

  const onCalloutCommit = useCallback(() => {
    setEditingCalloutIndex(null);
  }, []);

  const onCalloutRemove = useCallback(
    (index: number) => {
      const item = annotationsRef.current[index];
      if (!isConnectableBox(item) || item.callout == null) return;
      pushUndoSnapshot();
      setAnnotations((prev) =>
        prev.map((entry, i) => {
          if (i !== index || !isConnectableBox(entry) || entry.callout == null) {
            return entry;
          }
          const next = { ...entry };
          delete next.callout;
          return next;
        }),
      );
      setEditingCalloutIndex(null);
    },
    [pushUndoSnapshot],
  );

  const assignCalloutRiser = useCallback(
    (
      index: number,
      payload: {
        riserIds: string[];
        text: string;
        color: string;
        typeId?: string;
      },
    ) => {
      const item = annotationsRef.current[index];
      if (!isConnectableBox(item) || item.callout == null) return;
      const riserIds = payload.riserIds.filter(Boolean);
      if (riserIds.length === 0) return;
      pushUndoSnapshot();
      setAnnotations((prev) =>
        prev.map((entry, i) => {
          if (i !== index || !isConnectableBox(entry) || entry.callout == null) {
            return entry;
          }
          const callout = {
            ...entry.callout,
            text: payload.text,
            riserId: riserIds[0],
            riserIds,
          };
          if (payload.typeId) callout.typeId = payload.typeId;
          return {
            ...entry,
            color: payload.color,
            callout,
          };
        }),
      );
      setEditingCalloutIndex(null);
    },
    [pushUndoSnapshot],
  );

  const patchCalloutCatalog = useCallback(
    (
      index: number,
      payload: { typeId: string; color: string },
    ) => {
      const item = annotationsRef.current[index];
      if (!isConnectableBox(item) || item.callout == null) return;
      setAnnotations((prev) =>
        prev.map((entry, i) => {
          if (i !== index || !isConnectableBox(entry) || entry.callout == null) {
            return entry;
          }
          return {
            ...entry,
            color: payload.color,
            callout: {
              ...entry.callout,
              typeId: payload.typeId,
            },
          };
        }),
      );
    },
    [],
  );

  const commitSelectionRect = useCallback(
    (start: PdfPoint, end: PdfPoint, additive: boolean) => {
      const rect = pdfRectFromCorners(start, end);
      if (rect.width < MIN_BOX_PT && rect.height < MIN_BOX_PT) {
        if (!additive) {
          setSelectedIndices([]);
          setSelectedRiserAboveId(null);
        }
        return;
      }
      const hits = indicesInSelectionRect(annotationsRef.current, rect);
      setSelectedRiserAboveId(null);
      if (additive) {
        setSelectedIndices((prev) => {
          const next = new Set(prev);
          for (const index of hits) next.add(index);
          return [...next];
        });
      } else {
        setSelectedIndices(hits);
      }
    },
    [],
  );

  const clientToPdf = useCallback(
    (clientX: number, clientY: number): PdfPoint | null => {
      if (expanded) {
        const viewport = viewportRef.current;
        if (!viewport) return null;
        const bounds = viewport.getBoundingClientRect();
        const pagePoint = panZoomViewportToPage(
          { x: clientX - bounds.left, y: clientY - bounds.top },
          viewRef.current,
        );
        return canvasPointToPdf(pagePoint, pageHeight, scale);
      }
      const pageEl = pageRef.current;
      if (!pageEl) return null;
      const bounds = pageEl.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return null;
      const sx = pageEl.offsetWidth / bounds.width;
      const sy = pageEl.offsetHeight / bounds.height;
      return canvasPointToPdf(
        {
          x: (clientX - bounds.left) * sx,
          y: (clientY - bounds.top) * sy,
        },
        pageHeight,
        scale,
      );
    },
    [expanded, pageHeight, scale, pageRef, viewportRef],
  );

  const onAnnotationSelect = useCallback(
    (index: number, event: React.PointerEvent<SVGPathElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedRiserAboveId(null);
      setEditingCalloutIndex(null);
      setEditingRoomIndex(null);
      if (event.shiftKey) {
        setSelectedIndices((prev) =>
          prev.includes(index)
            ? prev.filter((i) => i !== index)
            : [...prev, index],
        );
        return;
      }
      const keep =
        selectedIndicesRef.current.includes(index) &&
        selectedIndicesRef.current.length > 0
          ? selectedIndicesRef.current
          : [index];
      if (
        keep.length !== selectedIndicesRef.current.length ||
        keep.some((item, i) => item !== selectedIndicesRef.current[i])
      ) {
        setSelectedIndices(keep);
      }
      const raw = clientToPdf(event.clientX, event.clientY);
      if (!raw) return;
      startShapeDrag(keep, raw, event);
    },
    [clientToPdf, startShapeDrag],
  );

  const onCalloutPointerDown = useCallback(
    (index: number, event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (editingCalloutIndexRef.current === index) return;
      const raw = clientToPdf(event.clientX, event.clientY);
      if (!raw) return;
      const item = annotationsRef.current[index];
      if (!isConnectableBox(item) || item.callout == null) return;
      setEditingCalloutIndex(null);
      calloutDraggingRef.current = true;
      calloutDragIndexRef.current = index;
      calloutDragGrabRef.current = {
        x: raw.x - item.callout.x,
        y: raw.y - item.callout.y,
      };
      calloutDragMovedRef.current = false;
      calloutDragUndoPushedRef.current = false;
    },
    [clientToPdf],
  );

  const thresholdPt = snapThresholdPt(
    SNAP_SCREEN_PX,
    scale,
    expanded ? view.zoom : 1,
  );

  const roomLeakIndexRef = useRef<RoomLeakIndex>({
    realFaces: [],
    sealedFaces: [],
    leaks: [],
  });
  const draggingForRooms = vertexDrag != null || shapeDragging;
  const roomLeakIndex = useMemo(() => {
    // Vertex/shape drags rewrite annotations every pointer move. Rebuilding the
    // planar room graph each time freezes a traced floor for seconds.
    if (draggingForRooms) {
      return roomLeakIndexRef.current;
    }
    return buildRoomLeakIndex(
      annotations,
      DEFAULT_ROOM_JOIN_EPS_PT,
      leakMaxGapPt,
    );
  }, [annotations, leakMaxGapPt, draggingForRooms]);
  roomLeakIndexRef.current = roomLeakIndex;
  const roomFaces = roomLeakIndex.realFaces;
  const roomFacesRef = useRef(roomFaces);
  roomFacesRef.current = roomFaces;

  const snapOptions = useCallback(
    () =>
      extensionsDisabledRef.current
        ? { disableExtensionSnaps: true as const }
        : undefined,
    [],
  );

  const resolveVertexDragPoint = useCallback(
    (raw: PdfPoint, annotationIndex: number, pointIndex: number) => {
      const item = annotationsRef.current[annotationIndex];
      if (!item || item.type !== "polyline") {
        return {
          point: raw,
          snapKind: null as SnapResult["kind"],
          snapSegment: undefined,
          alignXThrough: undefined,
          alignYThrough: undefined,
        };
      }
      const anchor = vertexDragAnchor(item.points, pointIndex);
      const resolved = resolveLineCursor(
        raw,
        anchor,
        shiftDownRef.current,
        annotationsExcludingIndex(annotationsRef.current, annotationIndex),
        [],
        thresholdPt,
        snapOptions(),
      );
      return {
        point: resolved.point,
        snapKind: resolved.kind,
        snapSegment: resolved.segment,
        alignXThrough: resolved.alignXThrough,
        alignYThrough: resolved.alignYThrough,
      };
    },
    [thresholdPt, snapOptions],
  );

  const updateVertexDrag = useCallback(
    (raw: PdfPoint) => {
      const drag = vertexDragRef.current;
      if (!drag) return;
      const {
        point,
        snapKind,
        snapSegment,
        alignXThrough,
        alignYThrough,
      } = resolveVertexDragPoint(raw, drag.annotationIndex, drag.pointIndex);
      // Shift key-repeat (and Chrome re-dispatch during React's discrete flush)
      // re-enters with the same cursor. Returning `prev` stops a nested update loop.
      setAnnotations((prev) => {
        const item = prev[drag.annotationIndex];
        if (!item || item.type !== "polyline") return prev;
        const current = item.points[drag.pointIndex];
        if (current && samePdfPoint(current, point)) return prev;
        const points = [...item.points];
        points[drag.pointIndex] = point;
        return prev.map((candidate, i) =>
          i === drag.annotationIndex ? { ...item, points } : candidate,
        );
      });
      setVertexDrag((prev) => {
        if (
          prev &&
          prev.annotationIndex === drag.annotationIndex &&
          prev.pointIndex === drag.pointIndex &&
          prev.snapKind === snapKind &&
          sameSnapSegment(prev.snapSegment, snapSegment) &&
          samePdfPoint(prev.alignXThrough, alignXThrough) &&
          samePdfPoint(prev.alignYThrough, alignYThrough)
        ) {
          return prev;
        }
        return {
          annotationIndex: drag.annotationIndex,
          pointIndex: drag.pointIndex,
          snapKind,
          snapSegment,
          alignXThrough,
          alignYThrough,
        };
      });
    },
    [resolveVertexDragPoint],
  );
  const updateVertexDragRef = useRef(updateVertexDrag);
  updateVertexDragRef.current = updateVertexDrag;

  const startVertexDrag = useCallback(
    (
      vertex: { annotationIndex: number; pointIndex: number },
      raw: PdfPoint,
      event: React.PointerEvent,
    ) => {
      pushUndoSnapshot();
      vertexDraggingRef.current = true;
      if (!selectedIndicesRef.current.includes(vertex.annotationIndex)) {
        if (event.shiftKey) {
          setSelectedIndices((prev) =>
            prev.includes(vertex.annotationIndex)
              ? prev
              : [...prev, vertex.annotationIndex],
          );
        } else {
          setSelectedIndices([vertex.annotationIndex]);
        }
      }
      const {
        point,
        snapKind,
        snapSegment,
        alignXThrough,
        alignYThrough,
      } = resolveVertexDragPoint(
        raw,
        vertex.annotationIndex,
        vertex.pointIndex,
      );
      setAnnotations((prev) =>
        prev.map((item, i) => {
          if (i !== vertex.annotationIndex || item.type !== "polyline") {
            return item;
          }
          const points = [...item.points];
          points[vertex.pointIndex] = point;
          return { ...item, points };
        }),
      );
      setHoverVertex(null);
      setVertexDrag({
        annotationIndex: vertex.annotationIndex,
        pointIndex: vertex.pointIndex,
        snapKind,
        snapSegment,
        alignXThrough,
        alignYThrough,
      });
      lastRawCursorRef.current = raw;
      if (
        "setPointerCapture" in event.currentTarget &&
        typeof event.currentTarget.setPointerCapture === "function"
      ) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [pushUndoSnapshot, resolveVertexDragPoint],
  );

  const onVertexPointerDown = useCallback(
    (
      annotationIndex: number,
      pointIndex: number,
      event: React.PointerEvent<SVGRectElement>,
    ) => {
      if (!selectionInteractive || event.button !== 0) return;
      const raw = clientToPdf(event.clientX, event.clientY);
      if (!raw) return;
      startVertexDrag({ annotationIndex, pointIndex }, raw, event);
    },
    [selectionInteractive, clientToPdf, startVertexDrag],
  );

  const onSelectPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!selectionInteractive || event.button !== 0) return;
      const raw = clientToPdf(event.clientX, event.clientY);
      if (!raw) return;

      const vertex = hitTestVertex(raw, annotationsRef.current, thresholdPt);
      if (vertex) {
        event.preventDefault();
        event.stopPropagation();
        startVertexDrag(vertex, raw, event);
        return;
      }

      const referenceOverlay = referenceOverlayAnnotationsRef?.current ?? [];
      if (referenceOverlay.length > 0 && onHideReferenceOverlayAnnotation) {
        const overlayIndex = hitTestAnnotations(
          raw,
          referenceOverlay,
          thresholdPt,
        );
        if (overlayIndex != null) {
          event.preventDefault();
          event.stopPropagation();
          onHideReferenceOverlayAnnotation(referenceOverlay[overlayIndex]);
          return;
        }
      }

      event.preventDefault();
      event.stopPropagation();
      setSelectedRiserAboveId(null);
      selectionDraggingRef.current = true;
      selectionStartRef.current = raw;
      setSelectionDraft({ start: raw, current: raw });
      if (
        "setPointerCapture" in event.currentTarget &&
        typeof event.currentTarget.setPointerCapture === "function"
      ) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [
      selectionInteractive,
      clientToPdf,
      thresholdPt,
      startVertexDrag,
      referenceOverlayAnnotationsRef,
      onHideReferenceOverlayAnnotation,
    ],
  );

  const onSelectPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const raw = clientToPdf(event.clientX, event.clientY);
      if (!raw) return;

      if (shapeDraggingRef.current) {
        lastRawCursorRef.current = raw;
        updateShapeDrag(raw);
        return;
      }

      if (vertexDraggingRef.current) {
        lastRawCursorRef.current = raw;
        updateVertexDrag(raw);
        return;
      }

      if (selectionDraggingRef.current) {
        const start = selectionStartRef.current;
        if (!start) return;
        setSelectionDraft({ start, current: raw });
        return;
      }

      setHoverVertex(hitTestVertex(raw, annotationsRef.current, thresholdPt));
      setHoverRiserAboveId(
        hitTestRiserPair(raw, annotationsRef.current, thresholdPt),
      );
    },
    [clientToPdf, thresholdPt, updateShapeDrag, updateVertexDrag],
  );

  const onRiserSelect = useCallback(
    (aboveId: string, event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      selectRiserConnection(aboveId, event.shiftKey);
    },
    [selectRiserConnection],
  );

  const onSelectPointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (shapeDraggingRef.current) {
        finishShapeDrag(event);
        return;
      }

      if (vertexDraggingRef.current) {
        vertexDraggingRef.current = false;
        setVertexDrag(null);
        if (
          "hasPointerCapture" in event.currentTarget &&
          typeof event.currentTarget.hasPointerCapture === "function" &&
          event.currentTarget.hasPointerCapture(event.pointerId)
        ) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        return;
      }

      if (!selectionDraggingRef.current) return;
      selectionDraggingRef.current = false;
      const start = selectionStartRef.current;
      selectionStartRef.current = null;
      setSelectionDraft(null);
      if (!start) return;
      const endRaw = clientToPdf(event.clientX, event.clientY);
      if (!endRaw) return;
      commitSelectionRect(start, endRaw, event.shiftKey);
      if (
        "hasPointerCapture" in event.currentTarget &&
        typeof event.currentTarget.hasPointerCapture === "function" &&
        event.currentTarget.hasPointerCapture(event.pointerId)
      ) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [clientToPdf, commitSelectionRect, finishShapeDrag],
  );

  const annotationPolylinePoints = useCallback(
    (item: FloorPlanAnnotation): PdfPoint[] | null => {
      if (item.type === "polyline" || item.type === "room") return item.points;
      if (item.type === "rectangle") {
        return rotatePdfPointsAround(
          rectangleToPolylinePoints(item.rect),
          pdfRectCenter(item.rect),
          annotationRotationDeg(item),
        );
      }
      if (item.type === "circle") {
        return rotatePdfPointsAround(
          circleToPolylinePoints(item.rect),
          pdfRectCenter(item.rect),
          annotationRotationDeg(item),
        );
      }
      return null;
    },
    [],
  );

  const resolveCutSnap = useCallback(
    (raw: PdfPoint): SnapResult => {
      const snapped = snapPoint(raw, annotationsRef.current, [], thresholdPt, snapOptions());
      if (snapped.kind === "endpoint" || snapped.kind === "on-line") {
        return snapped;
      }
      return { point: raw, kind: null };
    },
    [thresholdPt, snapOptions],
  );

  const locateCutOnAnnotation = useCallback(
    (
      annotationIndex: number,
      raw: PdfPoint,
    ): { location: PolylineCutLocation; snap: SnapResult } | null => {
      const item = annotationsRef.current[annotationIndex];
      if (!item) return null;
      const points = annotationPolylinePoints(item);
      if (!points) return null;

      const snapped = resolveCutSnap(raw);
      if (!snapped.kind) return null;

      const location = locatePointOnPolyline(points, snapped.point, thresholdPt);
      if (!location) return null;

      return { location, snap: snapped };
    },
    [annotationPolylinePoints, resolveCutSnap, thresholdPt],
  );

  const findCutTarget = useCallback(
    (raw: PdfPoint): {
      annotationIndex: number;
      location: PolylineCutLocation;
      snap: SnapResult;
    } | null => {
      const annotations = annotationsRef.current;
      for (let i = annotations.length - 1; i >= 0; i--) {
        const hit = locateCutOnAnnotation(i, raw);
        if (hit) {
          return {
            annotationIndex: i,
            location: hit.location,
            snap: hit.snap,
          };
        }
      }
      return null;
    },
    [locateCutOnAnnotation],
  );

  const cutDraftPointFromTarget = useCallback(
    (
      annotationIndex: number,
      location: PolylineCutLocation,
      snap: SnapResult,
    ): CutDraftPoint => ({
      annotationIndex,
      segmentIndex: location.segmentIndex,
      t: location.t,
      point: location.point,
      snapKind: snap.kind as "endpoint" | "on-line",
      snapSegment: snap.segment,
    }),
    [],
  );

  const updateCutCursor = useCallback(
    (raw: PdfPoint) => {
      const draft = cutDraftRef.current;
      if (!draft) return;
      const target = findCutTarget(raw);
      if (target) {
        applyCutDraft({
          ...draft,
          cursor: target.location.point,
          snapKind: target.snap.kind,
          snapSegment: target.snap.segment,
        });
      } else {
        applyCutDraft({
          ...draft,
          cursor: raw,
          snapKind: null,
          snapSegment: undefined,
        });
      }
    },
    [findCutTarget, applyCutDraft],
  );

  const applyCut = useCallback(
    (first: CutDraftPoint, second: CutDraftPoint) => {
      if (first.annotationIndex !== second.annotationIndex) return false;

      const index = first.annotationIndex;
      const item = annotationsRef.current[index];
      if (!item) return false;

      const points = annotationPolylinePoints(item);
      if (!points) return false;

      const locA: PolylineCutLocation = {
        segmentIndex: first.segmentIndex,
        t: first.t,
        point: first.point,
      };
      const locB: PolylineCutLocation = {
        segmentIndex: second.segmentIndex,
        t: second.t,
        point: second.point,
      };

      const pieces = cutPolylineBetweenLocations(points, locA, locB);
      if (pieces.length === 0) return false;

      pushUndoSnapshot();

      const replacements: FloorPlanAnnotation[] = pieces.map((piece) =>
        stampAnnotationMarkupSet(
          {
            type: "polyline",
            points: piece,
            color: item.color,
            strokeWidthPt: item.strokeWidthPt,
          },
          markupSetRef.current,
        ),
      );

      setAnnotations((prev) => {
        const next = [...prev];
        next.splice(index, 1, ...replacements);
        return clearDanglingRiserLinks(next);
      });
      return true;
    },
    [annotationPolylinePoints, pushUndoSnapshot],
  );

  const cancelCutDraft = useCallback(() => {
    applyCutDraft(null);
  }, [applyCutDraft]);

  const refreshCutHover = useCallback(
    (raw: PdfPoint) => {
      const target = findCutTarget(raw);
      if (target) {
        setHoverSnap({
          point: target.location.point,
          kind: target.snap.kind,
          segment: target.snap.segment,
          approachFrom: target.snap.kind === "on-line" ? raw : undefined,
        });
      } else {
        setHoverSnap(null);
      }
    },
    [findCutTarget],
  );

  const undoCutPoint = useCallback(() => {
    if (drawToolRef.current !== "cut") return false;
    const draft = cutDraftRef.current;
    if (!draft?.first) return false;

    applyCutDraft(null);
    const raw = lastRawCursorRef.current;
    if (raw) refreshCutHover(raw);
    return true;
  }, [applyCutDraft, refreshCutHover]);

  const resolveLinePoint = useCallback(
    (raw: PdfPoint, draft: LineDraft | null) => {
      const anchor =
        draft && draft.points.length > 0
          ? draft.points[draft.points.length - 1]
          : null;
      const resolved = resolveLineCursor(
        raw,
        anchor,
        shiftDownRef.current,
        annotationsRef.current,
        draft?.points ?? [],
        thresholdPt,
        snapOptions(),
      );
      return {
        point: resolved.point,
        snapKind: resolved.kind,
        snapSegment: resolved.segment,
        alignXThrough: resolved.alignXThrough,
        alignYThrough: resolved.alignYThrough,
      };
    },
    [thresholdPt, snapOptions],
  );

  const updateLineCursor = useCallback(
    (raw: PdfPoint) => {
      const draft = lineDraftRef.current;
      if (!draft) return;
      const { point, snapKind, snapSegment, alignXThrough, alignYThrough } =
        resolveLinePoint(raw, draft);
      applyLineDraft({
        ...draft,
        cursor: point,
        snapKind,
        snapSegment,
        alignXThrough,
        alignYThrough,
      });
    },
    [resolveLinePoint, applyLineDraft],
  );

  const connectBoxVisible = useCallback((item: FloorPlanAnnotation) => {
    const followed = followedRiserIdsRef.current;
    if (followed.length === 0) return true;
    return annotationVisibleWhileFollowingRiser(item, followed);
  }, []);

  const hitTestConnectTarget = useCallback(
    (raw: PdfPoint): ConnectHit | null => {
      const saved = hitTestConnectableBox(
        raw,
        annotationsRef.current,
        thresholdPt,
        connectBoxVisible,
      );
      if (saved != null) return { kind: "annotation", index: saved };
      const overlays = followedOverlayAnnotationsRef?.current ?? [];
      const overlay = hitTestConnectableBox(raw, overlays, thresholdPt);
      if (overlay != null) return { kind: "overlay", index: overlay };
      return null;
    },
    [connectBoxVisible, followedOverlayAnnotationsRef, thresholdPt],
  );

  const clearConnectDraft = useCallback(() => {
    connectDraftIndexRef.current = null;
    connectDraftOverlayIndexRef.current = null;
    setConnectDraftIndex(null);
    setConnectDraftOverlayIndex(null);
    setConnectHoverIndex(null);
    setConnectHoverOverlayIndex(null);
  }, []);

  const connectDraftHit = useCallback((): ConnectHit | null => {
    if (connectDraftIndexRef.current != null) {
      return { kind: "annotation", index: connectDraftIndexRef.current };
    }
    if (connectDraftOverlayIndexRef.current != null) {
      return { kind: "overlay", index: connectDraftOverlayIndexRef.current };
    }
    return null;
  }, []);

  const setConnectDraftHit = useCallback((hit: ConnectHit) => {
    if (hit.kind === "annotation") {
      connectDraftIndexRef.current = hit.index;
      connectDraftOverlayIndexRef.current = null;
      setConnectDraftIndex(hit.index);
      setConnectDraftOverlayIndex(null);
      return;
    }
    connectDraftIndexRef.current = null;
    connectDraftOverlayIndexRef.current = hit.index;
    setConnectDraftIndex(null);
    setConnectDraftOverlayIndex(hit.index);
  }, []);

  const resolveConnectSource = useCallback(
    (hit: ConnectHit): ConnectableBox | null => {
      const item =
        hit.kind === "overlay"
          ? followedOverlayAnnotationsRef?.current?.[hit.index]
          : annotationsRef.current[hit.index];
      return isConnectableBox(item) ? item : null;
    },
    [followedOverlayAnnotationsRef],
  );

  const commitPlacedRiserBox = useCallback(
    (
      hit: ConnectHit,
      center: PdfPoint,
      options?: {
        copyRiserIds?: string[];
        types: MechanicalRiserTypeDto[];
        risers: MechanicalRiserDto[];
      },
    ) => {
      const source = resolveConnectSource(hit);
      if (!source) return;
      const next = placeAndConnectRiserBox(
        annotationsRef.current,
        source,
        center,
        hit.kind === "annotation" ? hit.index : null,
        options,
      );
      if (!next) return;
      pushUndoSnapshot();
      const aboveIndex = next.length - 1;
      setAnnotations(next);
      setSelectedIndices([aboveIndex]);
      const above = next[aboveIndex];
      setSelectedRiserAboveId(
        isConnectableBox(above) && above.id ? above.id : null,
      );
    },
    [pushUndoSnapshot, resolveConnectSource],
  );

  const beginPlaceFromSource = useCallback(
    (hit: ConnectHit, center: PdfPoint) => {
      const source = resolveConnectSource(hit);
      if (!source) {
        clearConnectDraft();
        return;
      }
      if (source.callout && connectNeedsRiserChoice(source.callout)) {
        const place: ConnectPlaceDraft = {
          kind: hit.kind,
          index: hit.index,
          center,
        };
        connectRiserChoiceRef.current = {
          riserIds: calloutRiserIds(source.callout),
          place,
        };
        setConnectRiserChoice(connectRiserChoiceRef.current);
        clearConnectDraft();
        return;
      }
      commitPlacedRiserBox(hit, center);
      clearConnectDraft();
    },
    [clearConnectDraft, commitPlacedRiserBox, resolveConnectSource],
  );

  const handleDrawPointerRaw = useCallback(
    (raw: PdfPoint) => {
      lastRawCursorRef.current = raw;
      const tool = drawToolRef.current;

      if (tool === "room") {
        setHoverSnap(null);
        setHoverRoom(
          enclosingRoomFaceFromCache(raw, roomFacesRef.current),
        );
        setHoverLeaks(roomLeaksAtPoint(raw, roomLeakIndexRef.current));
        return;
      }

      if (tool === "rotate" && rotateDraggingRef.current) {
        applyRotateAtPointer(raw);
        setHoverSnap(null);
        return;
      }

      if (tool === "line" && lineDraftRef.current) {
        updateLineCursor(raw);
        setHoverSnap(null);
        return;
      }

      if (tool === "cut" && cutDraftRef.current) {
        updateCutCursor(raw);
        setHoverSnap(null);
        return;
      }

      if (isBoxTool(tool) && boxDraggingRef.current) {
        const start = boxStartRef.current;
        if (!start) return;
        const snapped = snapPoint(
          raw,
          annotationsRef.current,
          [],
          thresholdPt,
          snapOptions(),
        );
        setBoundingBoxDraft({
          shape: tool,
          start,
          current: constrainBoxCorner(
            start,
            snapped.point,
            shiftDownRef.current,
          ),
          variant: boxVariantForTool(tool),
          snapKind: snapped.kind,
          snapSegment: snapped.segment,
          alignXThrough: snapped.alignXThrough,
          alignYThrough: snapped.alignYThrough,
        });
        setHoverSnap(null);
        return;
      }

      if (tool === "line" || isBoxTool(tool)) {
        const draftPoints = lineDraftRef.current?.points ?? [];
        const snapped = snapPoint(
          raw,
          annotationsRef.current,
          draftPoints,
          thresholdPt,
          snapOptions(),
        );
        setHoverSnap(
          snapped.kind
            ? {
                ...snapped,
                approachFrom: snapApproachFrom(snapped.kind, raw),
              }
            : null,
        );
        return;
      }

      if (tool === "cut") {
        const target = findCutTarget(raw);
        if (target) {
          setHoverSnap({
            point: target.location.point,
            kind: target.snap.kind,
            segment: target.snap.segment,
            approachFrom:
              target.snap.kind === "on-line" ? raw : undefined,
          });
        } else {
          setHoverSnap(null);
        }
        return;
      }

      if (tool === "connect" || tool === "callout" || tool === "rotate") {
        setHoverSnap(null);
        if (tool === "connect") {
          const hit = hitTestConnectTarget(raw);
          setConnectHoverIndex(
            hit?.kind === "annotation" ? hit.index : null,
          );
          setConnectHoverOverlayIndex(
            hit?.kind === "overlay" ? hit.index : null,
          );
          return;
        }
        setConnectHoverIndex(
          hitTestConnectableBox(raw, annotationsRef.current, thresholdPt),
        );
        setConnectHoverOverlayIndex(null);
        return;
      }

      setHoverSnap(null);
    },
    [thresholdPt, updateLineCursor, updateCutCursor, findCutTarget, snapOptions, boxVariantForTool, hitTestConnectTarget, applyRotateAtPointer],
  );

  const commitLineDraft = useCallback(() => {
    const draft = lineDraftRef.current;
    if (!draft || draft.points.length < 2) {
      applyLineDraft(null);
      return;
    }
    pushUndoSnapshot();
    setAnnotations((prev) => [
      ...prev,
      stampAnnotationMarkupSet(
        {
          type: "polyline",
          points: draft.points,
          color: draft.segmentColor,
          strokeWidthPt: strokeWidthRef.current,
        },
        markupSetRef.current,
      ),
    ]);
    applyLineDraft(null);
  }, [pushUndoSnapshot, applyLineDraft]);

  /** Commits secured vertices when stroke color changes mid-polyline. */
  const changeStrokeColor = useCallback(
    (newColor: string) => {
      const normalizedNew = normalizeStrokeColor(newColor);

      if (
        drawToolRef.current === "none" &&
        selectedIndicesRef.current.length > 0
      ) {
        const selected = new Set(selectedIndicesRef.current);
        const needsUpdate = [...selected].some((index) => {
          const item = annotationsRef.current[index];
          return (
            item != null &&
            normalizeStrokeColor(item.color) !== normalizedNew
          );
        });
        if (needsUpdate) {
          pushUndoSnapshot();
          setAnnotations((prev) =>
            prev.map((item, index) =>
              selected.has(index) ? { ...item, color: normalizedNew } : item,
            ),
          );
        }
        setStrokeColor(normalizedNew);
        return;
      }

      if (
        normalizedNew === normalizeStrokeColor(strokeColorRef.current)
      ) {
        return;
      }

      const draft = lineDraftRef.current;
      if (
        drawToolRef.current === "line" &&
        draft &&
        draft.points.length >= 2 &&
        normalizeStrokeColor(draft.segmentColor) !== normalizedNew
      ) {
        pushUndoSnapshot();
        setAnnotations((prev) => [
          ...prev,
          stampAnnotationMarkupSet(
            {
              type: "polyline",
              points: draft.points,
              color: draft.segmentColor,
              strokeWidthPt: strokeWidthRef.current,
            },
            markupSetRef.current,
          ),
        ]);
        const lastPoint = draft.points[draft.points.length - 1];
        applyLineDraft({
          points: [lastPoint],
          cursor: draft.cursor,
          segmentColor: normalizedNew,
          snapKind: draft.snapKind,
          snapSegment: draft.snapSegment,
          alignXThrough: draft.alignXThrough,
          alignYThrough: draft.alignYThrough,
        });
      } else if (drawToolRef.current === "line" && draft) {
        applyLineDraft({ ...draft, segmentColor: normalizedNew });
      }

      setStrokeColor(normalizedNew);
    },
    [pushUndoSnapshot, applyLineDraft],
  );

  const changeStrokeWidthPt = useCallback(
    (newWidth: number) => {
      const width = STROKE_WIDTHS_PT.some((item) => item === newWidth)
        ? newWidth
        : strokeWidthRef.current;

      if (
        drawToolRef.current === "none" &&
        selectedIndicesRef.current.length > 0
      ) {
        const selected = new Set(selectedIndicesRef.current);
        const needsUpdate = [...selected].some((index) => {
          const item = annotationsRef.current[index];
          return item != null && item.strokeWidthPt !== width;
        });
        if (needsUpdate) {
          pushUndoSnapshot();
          setAnnotations((prev) =>
            prev.map((item, index) =>
              selected.has(index) ? { ...item, strokeWidthPt: width } : item,
            ),
          );
        }
        setStrokeWidthPt(width);
        return;
      }

      if (width === strokeWidthRef.current) {
        return;
      }

      setStrokeWidthPt(width);
    },
    [pushUndoSnapshot],
  );

  const cancelLineDraft = useCallback(() => {
    applyLineDraft(null);
  }, [applyLineDraft]);

  const undoLastLinePoint = useCallback(() => {
    if (drawToolRef.current !== "line") return false;
    const draft = lineDraftRef.current;
    if (!draft || draft.points.length === 0) return false;

    if (draft.points.length === 1) {
      applyLineDraft(null);
      const raw = lastRawCursorRef.current;
      if (raw) {
        const snapped = snapPoint(
          raw,
          annotationsRef.current,
          [],
          thresholdPt,
          snapOptions(),
        );
        setHoverSnap(
          snapped.kind
            ? {
                ...snapped,
                approachFrom: snapApproachFrom(snapped.kind, raw),
              }
            : null,
        );
      }
      return true;
    }

    const nextPoints = draft.points.slice(0, -1);
    const reducedDraft = { ...draft, points: nextPoints };
    const raw = lastRawCursorRef.current;
    if (raw) {
      const {
        point,
        snapKind,
        snapSegment,
        alignXThrough,
        alignYThrough,
      } = resolveLinePoint(raw, reducedDraft);
      applyLineDraft({
        points: nextPoints,
        cursor: point,
        segmentColor: draft.segmentColor,
        snapKind,
        snapSegment,
        alignXThrough,
        alignYThrough,
      });
    } else {
      const anchor = nextPoints[nextPoints.length - 1];
      applyLineDraft({
        points: nextPoints,
        cursor: anchor,
        segmentColor: draft.segmentColor,
        snapKind: null,
        snapSegment: undefined,
        alignXThrough: undefined,
        alignYThrough: undefined,
      });
    }
    return true;
  }, [applyLineDraft, resolveLinePoint, thresholdPt]);

  const handleEscape = useCallback(() => {
    if (connectRiserChoiceRef.current != null) {
      connectRiserChoiceRef.current = null;
      setConnectRiserChoice(null);
      return true;
    }

    if (editingCalloutIndexRef.current != null) {
      setEditingCalloutIndex(null);
      return true;
    }

    if (editingRoomIndexRef.current != null) {
      roomLabelUndoPushedForRef.current.delete(editingRoomIndexRef.current);
      setEditingRoomIndex(null);
      return true;
    }

    if (drawToolRef.current === "connect") {
      if (
        connectDraftIndexRef.current != null ||
        connectDraftOverlayIndexRef.current != null
      ) {
        clearConnectDraft();
        return true;
      }
      return false;
    }

    if (drawToolRef.current === "cut") {
      if (cutDraftRef.current) {
        cancelCutDraft();
        return true;
      }
      return false;
    }

    if (rotateDraggingRef.current) {
      const index = rotateIndexRef.current;
      const startDeg = rotateStartDegRef.current;
      if (rotateUndoPushedRef.current && index != null) {
        setAnnotations((prev) =>
          prev.map((entry, i) =>
            i === index && isConnectableBox(entry)
              ? withAnnotationRotation(entry, startDeg)
              : entry,
          ),
        );
        undoStackRef.current.pop();
      }
      clearRotateDrag();
      return true;
    }

    if (drawToolRef.current !== "line") return false;
    const draft = lineDraftRef.current;
    if (!draft) return false;
    if (draft.points.length >= 2) {
      commitLineDraft();
    } else {
      cancelLineDraft();
    }
    return true;
  }, [commitLineDraft, cancelLineDraft, cancelCutDraft, clearConnectDraft, clearRotateDrag]);

  const releaseTypingFocus = useCallback((target: EventTarget | null) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (active === target) return;
    const tag = active.tagName;
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      active.isContentEditable
    ) {
      active.blur();
    }
  }, []);

  const commitRoomAtPoint = useCallback(
    (raw: PdfPoint) => {
      const face = enclosingRoomFaceFromCache(raw, roomFacesRef.current);
      setHoverRoom(face);
      setHoverLeaks(roomLeaksAtPoint(raw, roomLeakIndexRef.current));
      if (!face) {
        setEditingRoomIndex(null);
        return;
      }
      const existing = findMatchingRoomIndex(
        annotationsRef.current,
        face.points,
      );
      if (existing != null) {
        setEditingRoomIndex(existing);
        setSelectedIndices([existing]);
        return;
      }
      const nextIndex = annotationsRef.current.length;
      pushUndoSnapshot();
      setAnnotations((prev) => [
        ...prev,
        stampAnnotationMarkupSet(
          {
            type: "room",
            points: face.points,
            label: "",
            color: nextRoomColor(annotationsRef.current),
            strokeWidthPt: strokeWidthRef.current,
          },
          markupSetRef.current,
        ),
      ]);
      roomLabelUndoPushedForRef.current.add(nextIndex);
      setEditingRoomIndex(nextIndex);
      setSelectedIndices([nextIndex]);
    },
    [pushUndoSnapshot],
  );

  const onRoomLabelChange = useCallback(
    (index: number, text: string) => {
      if (!roomLabelUndoPushedForRef.current.has(index)) {
        pushUndoSnapshot();
        roomLabelUndoPushedForRef.current.add(index);
      }
      setAnnotations((prev) =>
        prev.map((item, i) =>
          i === index && item.type === "room" ? { ...item, label: text } : item,
        ),
      );
    },
    [pushUndoSnapshot],
  );

  const onRoomCommit = useCallback(() => {
    setEditingRoomIndex((current) => {
      if (current != null) roomLabelUndoPushedForRef.current.delete(current);
      return null;
    });
  }, []);

  const deleteRoom = useCallback(
    (index: number) => {
      const item = annotationsRef.current[index];
      if (!item || item.type !== "room") return;
      pushUndoSnapshot();
      setAnnotations((prev) => prev.filter((_, i) => i !== index));
      setSelectedIndices([]);
      setEditingRoomIndex((current) => {
        if (current != null) roomLabelUndoPushedForRef.current.delete(current);
        return shiftRoomUiIndexAfterRemoval(current, index);
      });
      setListHoverRoomIndex((current) =>
        shiftRoomUiIndexAfterRemoval(current, index),
      );
      roomLabelUndoPushedForRef.current.delete(index);
      for (const pushedIndex of [...roomLabelUndoPushedForRef.current]) {
        if (pushedIndex > index) {
          roomLabelUndoPushedForRef.current.delete(pushedIndex);
          roomLabelUndoPushedForRef.current.add(pushedIndex - 1);
        }
      }
    },
    [pushUndoSnapshot],
  );

  const onDrawPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (drawToolRef.current === "none") return;
      event.preventDefault();
      event.stopPropagation();
      releaseTypingFocus(event.currentTarget);
      if (event.currentTarget instanceof SVGSVGElement) {
        event.currentTarget.focus({ preventScroll: true });
      }
      const raw = clientToPdf(event.clientX, event.clientY);
      if (!raw) return;

      if (drawToolRef.current === "room") {
        lastRawCursorRef.current = raw;
        commitRoomAtPoint(raw);
        return;
      }

      if (drawToolRef.current === "line") {
        const draft = lineDraftRef.current;
        lastRawCursorRef.current = raw;
        const {
          point,
          snapKind,
          snapSegment,
          alignXThrough,
          alignYThrough,
        } = resolveLinePoint(raw, draft);
        if (!draft) {
          applyLineDraft({
            points: [point],
            cursor: point,
            segmentColor: strokeColorRef.current,
            snapKind,
            snapSegment,
            alignXThrough,
            alignYThrough,
          });
          return;
        }
        applyLineDraft({
          points: [...draft.points, point],
          cursor: point,
          segmentColor: draft.segmentColor,
          snapKind,
          snapSegment,
          alignXThrough,
          alignYThrough,
        });
        return;
      }

      if (drawToolRef.current === "cut") {
        lastRawCursorRef.current = raw;
        const target = findCutTarget(raw);
        if (!target) return;

        const draft = cutDraftRef.current;
        const cutPoint = cutDraftPointFromTarget(
          target.annotationIndex,
          target.location,
          target.snap,
        );

        if (!draft) {
          applyCutDraft({
            first: cutPoint,
            cursor: cutPoint.point,
            snapKind: cutPoint.snapKind,
            snapSegment: cutPoint.snapSegment,
          });
          setHoverSnap(null);
          return;
        }

        if (!draft.first) {
          applyCutDraft({
            first: cutPoint,
            cursor: cutPoint.point,
            snapKind: cutPoint.snapKind,
            snapSegment: cutPoint.snapSegment,
          });
          setHoverSnap(null);
          return;
        }

        if (draft.first.annotationIndex !== cutPoint.annotationIndex) {
          applyCutDraft({
            first: cutPoint,
            cursor: cutPoint.point,
            snapKind: cutPoint.snapKind,
            snapSegment: cutPoint.snapSegment,
          });
          setHoverSnap(null);
          return;
        }

        if (applyCut(draft.first, cutPoint)) {
          applyCutDraft(null);
          setHoverSnap(null);
        }
        return;
      }

      if (drawToolRef.current === "connect") {
        lastRawCursorRef.current = raw;
        const hit = hitTestConnectTarget(raw);
        const first = connectDraftHit();
        if (hit == null) {
          if (first) {
            beginPlaceFromSource(first, raw);
            return;
          }
          clearConnectDraft();
          return;
        }
        if (first == null) {
          setConnectDraftHit(hit);
          return;
        }
        if (hit.kind === first.kind && hit.index === first.index) {
          if (hit.kind === "annotation") {
            const target = annotationsRef.current[hit.index];
            const linked =
              target != null &&
              (target.type === "rectangle" || target.type === "circle") &&
              target.riserRole != null;
            if (linked) {
              pushUndoSnapshot();
              setAnnotations((prev) => disconnectRiserBox(prev, hit.index));
            }
          }
          clearConnectDraft();
          return;
        }
        if (first.kind === "overlay" || hit.kind === "overlay") {
          setConnectDraftHit(hit);
          return;
        }
        const firstBox = annotationsRef.current[first.index];
        const secondBox = annotationsRef.current[hit.index];
        if (isConnectableBox(firstBox) && isConnectableBox(secondBox)) {
          const source = calloutCopiedOnConnect(firstBox, secondBox);
          if (source && connectNeedsRiserChoice(source)) {
            connectRiserChoiceRef.current = {
              aboveIndex: first.index,
              belowIndex: hit.index,
              riserIds: calloutRiserIds(source),
            };
            setConnectRiserChoice(connectRiserChoiceRef.current);
            clearConnectDraft();
            return;
          }
        }
        const next = connectRiserBoxes(
          annotationsRef.current,
          first.index,
          hit.index,
        );
        if (next && next !== annotationsRef.current) {
          pushUndoSnapshot();
          setAnnotations(next);
        }
        clearConnectDraft();
        return;
      }

      if (drawToolRef.current === "callout") {
        lastRawCursorRef.current = raw;
        const hit = hitTestConnectableBox(
          raw,
          annotationsRef.current,
          thresholdPt,
        );
        if (hit == null) {
          setEditingCalloutIndex(null);
          return;
        }
        const target = annotationsRef.current[hit];
        if (!isConnectableBox(target)) return;
        if (target.callout) {
          pushUndoSnapshot();
          setEditingCalloutIndex(hit);
          return;
        }
        pushUndoSnapshot();
        setAnnotations((prev) =>
          prev.map((entry, i) =>
            i === hit && isConnectableBox(entry)
              ? { ...entry, callout: defaultCallout(entry) }
              : entry,
          ),
        );
        setEditingCalloutIndex(hit);
        return;
      }

      if (drawToolRef.current === "rotate") {
        lastRawCursorRef.current = raw;
        const hit = hitTestConnectableBox(
          raw,
          annotationsRef.current,
          thresholdPt,
        );
        if (hit == null) {
          setConnectHoverIndex(null);
          return;
        }
        const target = annotationsRef.current[hit];
        if (!isConnectableBox(target)) return;
        rotateDraggingRef.current = true;
        rotateIndexRef.current = hit;
        rotateCenterRef.current = {
          x: target.rect.x + target.rect.width / 2,
          y: target.rect.y + target.rect.height / 2,
        };
        rotateStartPointerRef.current = raw;
        rotateStartDegRef.current = annotationRotationDeg(target);
        rotateUndoPushedRef.current = false;
        setConnectHoverIndex(hit);
        setSelectedIndices([hit]);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      if (isBoxTool(drawToolRef.current)) {
        const shape = drawToolRef.current;
        const snapped = snapPoint(
          raw,
          annotationsRef.current,
          [],
          thresholdPt,
          snapOptions(),
        );
        boxDraggingRef.current = true;
        boxStartRef.current = snapped.point;
        setBoundingBoxDraft({
          shape,
          start: snapped.point,
          current: snapped.point,
          variant: boxVariantForTool(shape),
          snapKind: snapped.kind,
          snapSegment: snapped.segment,
          alignXThrough: snapped.alignXThrough,
          alignYThrough: snapped.alignYThrough,
        });
        setHoverSnap(null);
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [
      clientToPdf,
      resolveLinePoint,
      findCutTarget,
      cutDraftPointFromTarget,
      applyCut,
      applyLineDraft,
      applyCutDraft,
      pushUndoSnapshot,
      releaseTypingFocus,
      snapOptions,
      thresholdPt,
      boxVariantForTool,
      hitTestConnectTarget,
      connectDraftHit,
      beginPlaceFromSource,
      clearConnectDraft,
      setConnectDraftHit,
      commitRoomAtPoint,
    ],
  );

  const onDrawPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const raw = clientToPdf(event.clientX, event.clientY);
      if (!raw) return;
      handleDrawPointerRaw(raw);
    },
    [clientToPdf, handleDrawPointerRaw],
  );

  const onDrawPointerUp = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const tool = drawToolRef.current;
      if (tool === "rotate" && rotateDraggingRef.current) {
        finishRotateDrag();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        return;
      }
      if (!isBoxTool(tool) || !boxDraggingRef.current) {
        return;
      }
      boxDraggingRef.current = false;
      const start = boxStartRef.current;
      boxStartRef.current = null;
      setBoundingBoxDraft(null);
      if (!start) return;
      const endRaw = clientToPdf(event.clientX, event.clientY);
      if (!endRaw) return;
      const end = constrainBoxCorner(
        start,
        snapPoint(
          endRaw,
          annotationsRef.current,
          [],
          thresholdPt,
          snapOptions(),
        ).point,
        shiftDownRef.current,
      );
      const rect = pdfRectFromCorners(start, end);
      if (rect.width < MIN_BOX_PT || rect.height < MIN_BOX_PT) return;
      const variant = boxVariantForTool(tool);
      pushUndoSnapshot();
      setAnnotations((prev) => [
        ...prev,
        stampAnnotationMarkupSet(
          {
            type: tool,
            rect,
            ...(variant === "cross" ? { variant } : {}),
            color: strokeColorRef.current,
            strokeWidthPt: strokeWidthRef.current,
          },
          markupSetRef.current,
        ),
      ]);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [clientToPdf, thresholdPt, pushUndoSnapshot, snapOptions, boxVariantForTool, finishRotateDrag],
  );

  const onToolChange = useCallback(
    (tool: DrawTool) => {
      const next = tool === "callout" && !calloutEnabledRef.current ? "none" : tool;
      if (drawToolRef.current === "line" && lineDraftRef.current) {
        commitLineDraft();
      }
      setBoundingBoxDraft(null);
      boxDraggingRef.current = false;
      boxStartRef.current = null;
      setHoverSnap(null);
      applyCutDraft(null);
      clearConnectDraft();
      connectRiserChoiceRef.current = null;
      setConnectRiserChoice(null);
      setSelectedRiserAboveId(null);
      setHoverRiserAboveId(null);
      setHoverVertex(null);
      setVertexDrag(null);
      vertexDraggingRef.current = false;
      clearShapeDrag();
      setHoverRoom(null);
      setHoverLeaks([]);
      setEditingRoomIndex(null);
      setSelectedIndices([]);
      setSelectionDraft(null);
      selectionDraggingRef.current = false;
      selectionStartRef.current = null;
      setEditingCalloutIndex(null);
      calloutDraggingRef.current = false;
      calloutDragIndexRef.current = null;
      clearRotateDrag();
      setDrawTool(next);
    },
    [commitLineDraft, applyCutDraft, clearConnectDraft, clearRotateDrag, clearShapeDrag],
  );

  useEffect(() => {
    if (!calloutEnabled && drawToolRef.current === "callout") {
      onToolChange("none");
    }
  }, [calloutEnabled, onToolChange]);

  useEffect(() => {
    if (drawToolRef.current !== "room") {
      setHoverLeaks((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const raw = lastRawCursorRef.current;
    if (!raw) {
      setHoverLeaks((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    setHoverLeaks(roomLeaksAtPoint(raw, roomLeakIndex));
  }, [roomLeakIndex]);

  const changeLeakMaxGapPt = useCallback((value: number) => {
    setLeakMaxGapPt(clampRoomLeakMaxGapPt(value));
  }, []);

  const clearAnnotations = useCallback(() => {
    if (annotationsRef.current.length > 0) {
      pushUndoSnapshot();
    }
    setAnnotations([]);
    setSelectedIndices([]);
    setSelectedRiserAboveId(null);
    setSelectionDraft(null);
    selectionDraggingRef.current = false;
    selectionStartRef.current = null;
    applyLineDraft(null);
    setBoundingBoxDraft(null);
    applyCutDraft(null);
    clearConnectDraft();
    connectRiserChoiceRef.current = null;
    setConnectRiserChoice(null);
    boxDraggingRef.current = false;
    boxStartRef.current = null;
    setHoverSnap(null);
    setHoverVertex(null);
    setVertexDrag(null);
    vertexDraggingRef.current = false;
    clearShapeDrag();
    setHoverRoom(null);
    setHoverLeaks([]);
    setEditingRoomIndex(null);
    setEditingCalloutIndex(null);
    calloutDraggingRef.current = false;
    calloutDragIndexRef.current = null;
    clearRotateDrag();
  }, [pushUndoSnapshot, applyLineDraft, applyCutDraft, clearConnectDraft, clearRotateDrag, clearShapeDrag]);

  const appendAnnotations = useCallback(
    (items: FloorPlanAnnotation[], select = true) => {
      if (items.length === 0) return;
      pushUndoSnapshot();
      const start = annotationsRef.current.length;
      setAnnotations((prev) => [...prev, ...items]);
      setSelectedRiserAboveId(null);
      if (select) {
        setSelectedIndices(items.map((_, i) => start + i));
      }
    },
    [pushUndoSnapshot],
  );

  const replaceAnnotations = useCallback((next: FloorPlanAnnotation[]) => {
    setAnnotations(next);
    setSelectedIndices([]);
    setSelectedRiserAboveId(null);
    setSelectionDraft(null);
    selectionDraggingRef.current = false;
    selectionStartRef.current = null;
    applyLineDraft(null);
    setBoundingBoxDraft(null);
    applyCutDraft(null);
    clearConnectDraft();
    connectRiserChoiceRef.current = null;
    setConnectRiserChoice(null);
    boxDraggingRef.current = false;
    boxStartRef.current = null;
    setHoverSnap(null);
    setHoverVertex(null);
    setVertexDrag(null);
    vertexDraggingRef.current = false;
    clearShapeDrag();
    setHoverRoom(null);
    setHoverLeaks([]);
    setEditingRoomIndex(null);
    setEditingCalloutIndex(null);
    calloutDraggingRef.current = false;
    calloutDragIndexRef.current = null;
    undoStackRef.current = [];
  }, [applyLineDraft, applyCutDraft, clearConnectDraft, clearShapeDrag]);

  const mapAnnotations = useCallback(
    (mapper: (prev: FloorPlanAnnotation[]) => FloorPlanAnnotation[]) => {
      setAnnotations(mapper);
    },
    [],
  );

  const cancelConnectRiserChoice = useCallback(() => {
    connectRiserChoiceRef.current = null;
    setConnectRiserChoice(null);
  }, []);

  const confirmConnectRiserChoice = useCallback(
    (
      copyRiserIds: string[],
      catalog: {
        types: MechanicalRiserTypeDto[];
        risers: MechanicalRiserDto[];
      },
    ) => {
      const choice = connectRiserChoiceRef.current;
      if (choice == null) return;
      const selected = copyRiserIds.filter(Boolean);
      if (selected.length === 0) return;
      if (choice.place) {
        connectRiserChoiceRef.current = null;
        setConnectRiserChoice(null);
        commitPlacedRiserBox(
          { kind: choice.place.kind, index: choice.place.index },
          choice.place.center,
          {
            copyRiserIds: selected,
            types: catalog.types,
            risers: catalog.risers,
          },
        );
        return;
      }
      if (choice.aboveIndex == null || choice.belowIndex == null) return;
      const next = connectRiserBoxes(
        annotationsRef.current,
        choice.aboveIndex,
        choice.belowIndex,
        {
          copyRiserIds: selected,
          types: catalog.types,
          risers: catalog.risers,
        },
      );
      connectRiserChoiceRef.current = null;
      setConnectRiserChoice(null);
      if (next && next !== annotationsRef.current) {
        pushUndoSnapshot();
        setAnnotations(next);
      }
    },
    [pushUndoSnapshot, commitPlacedRiserBox],
  );

  /** Includes an in-progress line polyline when it has at least two vertices. */
  const getAnnotationsForSave = useCallback((): FloorPlanAnnotation[] => {
    const base = annotationsRef.current;
    const draft = lineDraftRef.current;
    if (
      drawToolRef.current === "line" &&
      draft &&
      draft.points.length >= 2
    ) {
      return [
        ...base,
        stampAnnotationMarkupSet(
          {
            type: "polyline",
            points: draft.points,
            color: draft.segmentColor,
            strokeWidthPt: strokeWidthRef.current,
          },
          markupSetRef.current,
        ),
      ];
    }
    return base;
  }, []);

  useEffect(() => {
    if (drawTool !== "none") return;
    if (selectedIndices.length === 0) return;
    const item = annotationsRef.current[selectedIndices[0]];
    if (!item) return;
    const next = normalizeStrokeColor(item.color);
    if (normalizeStrokeColor(strokeColorRef.current) !== next) {
      setStrokeColor(next);
    }
  }, [selectedIndices, drawTool]);

  useEffect(() => {
    if (drawTool !== "none") return;
    if (selectedIndices.length === 0) return;
    const item = annotationsRef.current[selectedIndices[0]];
    if (!item) return;
    if (strokeWidthRef.current !== item.strokeWidthPt) {
      setStrokeWidthPt(item.strokeWidthPt);
    }
  }, [selectedIndices, drawTool]);

  useEffect(() => {
    if (!drawingActive) return;

    function onMove(event: PointerEvent) {
      const raw = clientToPdf(event.clientX, event.clientY);
      if (!raw) return;
      handleDrawPointerRaw(raw);
    }

    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [drawingActive, clientToPdf, handleDrawPointerRaw]);

  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (!calloutDraggingRef.current) return;
      const raw = clientToPdf(event.clientX, event.clientY);
      if (!raw) return;
      lastRawCursorRef.current = raw;
      updateCalloutDrag(raw);
    }

    function onUp() {
      finishCalloutDrag();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [clientToPdf, updateCalloutDrag, finishCalloutDrag]);

  useEffect(() => {
    if (!selectionInteractive) return;

    function onMove(event: PointerEvent) {
      const raw = clientToPdf(event.clientX, event.clientY);
      if (!raw) return;

      if (shapeDraggingRef.current) {
        lastRawCursorRef.current = raw;
        updateShapeDrag(raw);
        return;
      }

      if (vertexDraggingRef.current) {
        lastRawCursorRef.current = raw;
        updateVertexDrag(raw);
        return;
      }

      if (selectionDraggingRef.current) {
        const start = selectionStartRef.current;
        if (!start) return;
        setSelectionDraft({ start, current: raw });
        return;
      }

      setHoverVertex(hitTestVertex(raw, annotationsRef.current, thresholdPt));
    }

    function onUp(event: PointerEvent) {
      if (shapeDraggingRef.current) {
        finishShapeDrag(event);
        return;
      }

      if (vertexDraggingRef.current) {
        vertexDraggingRef.current = false;
        setVertexDrag(null);
        return;
      }

      if (!selectionDraggingRef.current) return;
      selectionDraggingRef.current = false;
      const start = selectionStartRef.current;
      selectionStartRef.current = null;
      setSelectionDraft(null);
      if (!start) return;
      const endRaw = clientToPdf(event.clientX, event.clientY);
      if (!endRaw) return;
      commitSelectionRect(start, endRaw, event.shiftKey);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [selectionInteractive, clientToPdf, commitSelectionRect, updateVertexDrag, updateShapeDrag, finishShapeDrag, thresholdPt]);

  useEffect(() => {
    if (drawTool !== "none") return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Shift") return;
      if (shiftDownRef.current) return;
      shiftDownRef.current = true;
      const raw = lastRawCursorRef.current;
      if (!vertexDraggingRef.current || !raw) return;
      updateVertexDragRef.current(raw);
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key !== "Shift") return;
      if (!shiftDownRef.current) return;
      shiftDownRef.current = false;
      const raw = lastRawCursorRef.current;
      if (!vertexDraggingRef.current || !raw) return;
      updateVertexDragRef.current(raw);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      shiftDownRef.current = false;
    };
  }, [drawTool]);

  useEffect(() => {
    if (drawTool !== "line") return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Shift") return;
      if (shiftDownRef.current) return;
      shiftDownRef.current = true;
      const draft = lineDraftRef.current;
      const raw = lastRawCursorRef.current;
      if (!draft || !raw) return;
      const { point, snapKind, snapSegment, alignXThrough, alignYThrough } =
        resolveLinePoint(raw, draft);
      applyLineDraft({
        ...draft,
        cursor: point,
        snapKind,
        snapSegment,
        alignXThrough,
        alignYThrough,
      });
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key !== "Shift") return;
      if (!shiftDownRef.current) return;
      shiftDownRef.current = false;
      const draft = lineDraftRef.current;
      const raw = lastRawCursorRef.current;
      if (!draft || !raw) return;
      const { point, snapKind, snapSegment, alignXThrough, alignYThrough } =
        resolveLinePoint(raw, draft);
      applyLineDraft({
        ...draft,
        cursor: point,
        snapKind,
        snapSegment,
        alignXThrough,
        alignYThrough,
      });
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      shiftDownRef.current = false;
    };
  }, [drawTool, resolveLinePoint, applyLineDraft]);

  useEffect(() => {
    if (!isBoxTool(drawTool) && drawTool !== "rotate") return;

    function dragging() {
      return drawTool === "rotate"
        ? rotateDraggingRef.current
        : boxDraggingRef.current;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Shift") return;
      if (shiftDownRef.current) return;
      shiftDownRef.current = true;
      const raw = lastRawCursorRef.current;
      if (!dragging() || !raw) return;
      handleDrawPointerRaw(raw);
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key !== "Shift") return;
      if (!shiftDownRef.current) return;
      shiftDownRef.current = false;
      const raw = lastRawCursorRef.current;
      if (!dragging() || !raw) return;
      handleDrawPointerRaw(raw);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [drawTool, handleDrawPointerRaw]);

  useEffect(() => {
    function isAltKey(event: KeyboardEvent) {
      return (
        event.key === "Alt" ||
        event.code === "AltLeft" ||
        event.code === "AltRight"
      );
    }

    function refreshAfterExtensionToggle() {
      const raw = lastRawCursorRef.current;
      if (!raw) return;

      if (vertexDraggingRef.current) {
        updateVertexDrag(raw);
        return;
      }

      if (drawToolRef.current === "line" && lineDraftRef.current) {
        updateLineCursor(raw);
        return;
      }

      if (
        drawToolRef.current === "line" ||
        drawToolRef.current === "rectangle" ||
        drawToolRef.current === "circle" ||
        drawToolRef.current === "cut"
      ) {
        handleDrawPointerRaw(raw);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (!isAltKey(event)) return;
      if (extensionsDisabledRef.current) return;
      extensionsDisabledRef.current = true;
      if (drawToolRef.current !== "none" || vertexDraggingRef.current) {
        event.preventDefault();
      }
      refreshAfterExtensionToggle();
    }

    function onKeyUp(event: KeyboardEvent) {
      if (!isAltKey(event)) return;
      if (!extensionsDisabledRef.current) return;
      extensionsDisabledRef.current = false;
      refreshAfterExtensionToggle();
    }

    function onBlur() {
      if (!extensionsDisabledRef.current) return;
      extensionsDisabledRef.current = false;
      refreshAfterExtensionToggle();
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      extensionsDisabledRef.current = false;
    };
  }, [updateVertexDrag, updateLineCursor, handleDrawPointerRaw]);

  useEffect(() => {
    if (!drawingActive) return;

    function isTypingTarget(target: EventTarget | null) {
      return (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      );
    }

    function isUndoChord(event: KeyboardEvent) {
      return (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        (event.key.toLowerCase() === "z" || event.code === "KeyZ")
      );
    }

    function hasInProgressDrawUndo() {
      return (
        (drawToolRef.current === "line" &&
          (lineDraftRef.current?.points.length ?? 0) > 0) ||
        (drawToolRef.current === "cut" && cutDraftRef.current?.first != null)
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      if (isUndoChord(event)) {
        const allowAnnotationUndo = !isTypingTarget(event.target);
        if (hasInProgressDrawUndo() || allowAnnotationUndo) {
          if (undoCutPoint()) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (undoLastLinePoint()) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (allowAnnotationUndo && undoAnnotationSnapshot()) {
            event.preventDefault();
            event.stopPropagation();
          }
        }
        return;
      }

      if (isTypingTarget(event.target)) return;

      if (event.key === "Escape") {
        if (handleEscape()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    drawingActive,
    handleEscape,
    undoLastLinePoint,
    undoCutPoint,
    undoAnnotationSnapshot,
  ]);

  useEffect(() => {
    if (drawTool !== "none") return;

    function isTypingTarget(target: EventTarget | null) {
      return (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (
        selectedIndicesRef.current.length === 0 &&
        !selectedRiserAboveIdRef.current
      ) {
        return;
      }

      if (event.key === "Escape") {
        if (selectedRiserAboveIdRef.current) {
          setSelectedRiserAboveId(null);
          event.preventDefault();
        }
        return;
      }

      if (selectedIndicesRef.current.length === 0) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelected();
        event.preventDefault();
        return;
      }

      const step = pdfDeltaPerScreenPixel(
        scale,
        expanded ? viewRef.current.zoom : 1,
      );
      let dx = 0;
      let dy = 0;
      switch (event.key) {
        case "ArrowLeft":
          dx = -step;
          break;
        case "ArrowRight":
          dx = step;
          break;
        case "ArrowUp":
          dy = step;
          break;
        case "ArrowDown":
          dy = -step;
          break;
        default:
          return;
      }

      nudgeSelected(dx, dy);
      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [drawTool, deleteSelected, nudgeSelected, scale, expanded]);

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      return (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key.length === 1) {
        const preset = findDrawColorPresetByShortcut(
          colorPresetsRef.current,
          key,
        );
        if (preset) {
          changeStrokeColor(preset.color);
          event.preventDefault();
          return;
        }
      }

      let tool: DrawTool | null = null;
      switch (key) {
        case "v":
          tool = "none";
          break;
        case "l":
          tool = "line";
          break;
        case "r":
          tool = "rectangle";
          break;
        case "o":
          tool = "circle";
          break;
        case "u":
          tool = "room";
          break;
        case "c":
          tool = "cut";
          break;
        case "k":
          tool = "connect";
          break;
        case "a":
          if (!calloutEnabledRef.current) return;
          tool = "callout";
          break;
        case "t":
          tool = "rotate";
          break;
        default:
          return;
      }

      onToolChange(tool);
      event.preventDefault();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onToolChange, changeStrokeColor]);

  return {
    drawTool,
    rectangleVariant,
    circleVariant,
    drawingActive,
    markupSelectable,
    selectionInteractive,
    strokeColor,
    strokeWidthPt,
    annotations,
    selectedIndices,
    selectionDraft,
    lineDraft,
    boundingBoxDraft,
    cutDraft,
    connectDraftIndex,
    connectHoverIndex,
    connectDraftOverlayIndex,
    connectHoverOverlayIndex,
    connectRiserChoice,
    selectedRiserAboveId,
    hoverRiserAboveId,
    hoverSnap,
    hoverVertex,
    vertexDrag,
    hoverRoom,
    hoverLeaks,
    leakMaxGapPt,
    listHoverRoomIndex,
    editingRoomIndex,
    shapeDragging,
    editingCalloutIndex,
    setStrokeColor: changeStrokeColor,
    setStrokeWidthPt: changeStrokeWidthPt,
    setLeakMaxGapPt: changeLeakMaxGapPt,
    setRectangleVariant,
    setCircleVariant,
    onToolChange,
    clearAnnotations,
    replaceAnnotations,
    appendAnnotations,
    mapAnnotations,
    getAnnotationsForSave,
    deselectAnnotations,
    deleteSelected,
    onAnnotationSelect,
    onRiserSelect,
    onCalloutPointerDown,
    onCalloutTextChange,
    onCalloutCommit,
    onCalloutRemove,
    onRoomLabelChange,
    onRoomCommit,
    setListHoverRoomIndex,
    deleteRoom,
    assignCalloutRiser,
    patchCalloutCatalog,
    flipSelectedRiserDirection,
    handleEscape,
    confirmConnectRiserChoice,
    cancelConnectRiserChoice,
    onDrawPointerDown,
    onDrawPointerMove,
    onDrawPointerUp,
    onSelectPointerDown,
    onSelectPointerMove,
    onSelectPointerUp,
    onVertexPointerDown,
  };
}
