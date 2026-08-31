"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  findDrawColorPresetByShortcut,
  indicesInSelectionRect,
  constrainBoxCorner,
  pdfRectFromCorners,
  type CutDraft,
  type CutDraftPoint,
  type BoundingBoxDraft,
  type DrawColorPreset,
  type DrawTool,
  type FloorPlanAnnotation,
  type LineDraft,
  type ShapeCrossVariant,
  type SelectionDraft,
  type VertexDragDraft,
  type VertexHover,
} from "@/lib/building/floor-plan-annotations";
import {
  clearDanglingRiserLinks,
  connectRiserBoxes,
  disconnectRiserBox,
  hitTestConnectableBox,
} from "@/lib/building/floor-plan-riser-links";

const MIN_BOX_PT = 0.5;
const SNAP_SCREEN_PX = 10;
const MAX_UNDO_STACK = 50;

function isBoxTool(tool: DrawTool): tool is "rectangle" | "circle" {
  return tool === "rectangle" || tool === "circle";
}

export function useFloorPlanDrawing({
  pageHeight,
  scale,
  expanded,
  view,
  pageRef,
  viewportRef,
  colorPresets,
  referenceOverlayAnnotationsRef,
  onHideReferenceOverlayAnnotation,
}: {
  pageHeight: number;
  scale: number;
  expanded: boolean;
  view: PdfPanZoom;
  pageRef: React.RefObject<HTMLDivElement | null>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  colorPresets: DrawColorPreset[];
  referenceOverlayAnnotationsRef?: React.RefObject<FloorPlanAnnotation[]>;
  onHideReferenceOverlayAnnotation?: (annotation: FloorPlanAnnotation) => void;
}) {
  const [drawTool, setDrawTool] = useState<DrawTool>("none");
  const [rectangleVariant, setRectangleVariant] =
    useState<ShapeCrossVariant>("plain");
  const [circleVariant, setCircleVariant] = useState<ShapeCrossVariant>("plain");
  const [strokeColor, setStrokeColor] = useState<string>(DRAW_COLORS[0]);
  const [strokeWidthPt, setStrokeWidthPt] = useState(2);
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
  const [cutDraft, setCutDraft] = useState<CutDraft | null>(null);
  const [connectDraftIndex, setConnectDraftIndex] = useState<number | null>(
    null,
  );
  const [connectHoverIndex, setConnectHoverIndex] = useState<number | null>(
    null,
  );
  const boxDraggingRef = useRef(false);
  const boxStartRef = useRef<PdfPoint | null>(null);
  const drawToolRef = useRef(drawTool);
  drawToolRef.current = drawTool;
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
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const selectedIndicesRef = useRef(selectedIndices);
  selectedIndicesRef.current = selectedIndices;
  const selectionDraggingRef = useRef(false);
  const selectionStartRef = useRef<PdfPoint | null>(null);
  const vertexDraggingRef = useRef(false);
  const vertexDragRef = useRef(vertexDrag);
  vertexDragRef.current = vertexDrag;
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
    return true;
  }, []);

  const drawingActive = drawTool !== "none";
  const markupSelectable = drawTool === "none" && annotations.length > 0;
  const selectionInteractive = markupSelectable;

  const deselectAnnotations = useCallback(() => {
    setSelectedIndices([]);
  }, []);

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
      prev.map((item, i) => {
        if (!move.has(i)) return item;
        if (item.type === "polyline") {
          return {
            ...item,
            points: item.points.map((point) => ({
              x: point.x + dx,
              y: point.y + dy,
            })),
          };
        }
        if (item.type === "rectangle" || item.type === "circle") {
          return {
            ...item,
            rect: {
              ...item.rect,
              x: item.rect.x + dx,
              y: item.rect.y + dy,
            },
          };
        }
        return item;
      }),
    );
  }, [pushUndoSnapshot]);

  const onAnnotationSelect = useCallback(
    (index: number, event: React.PointerEvent<SVGPathElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        setSelectedIndices((prev) =>
          prev.includes(index)
            ? prev.filter((i) => i !== index)
            : [...prev, index],
        );
      } else {
        setSelectedIndices([index]);
      }
    },
    [],
  );

  const commitSelectionRect = useCallback(
    (start: PdfPoint, end: PdfPoint, additive: boolean) => {
      const rect = pdfRectFromCorners(start, end);
      if (rect.width < MIN_BOX_PT && rect.height < MIN_BOX_PT) {
        if (!additive) setSelectedIndices([]);
        return;
      }
      const hits = indicesInSelectionRect(annotationsRef.current, rect);
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

  const thresholdPt = snapThresholdPt(
    SNAP_SCREEN_PX,
    scale,
    expanded ? view.zoom : 1,
  );

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
      setAnnotations((prev) =>
        prev.map((item, i) => {
          if (i !== drag.annotationIndex || item.type !== "polyline") {
            return item;
          }
          const points = [...item.points];
          points[drag.pointIndex] = point;
          return { ...item, points };
        }),
      );
      setVertexDrag({
        ...drag,
        snapKind,
        snapSegment,
        alignXThrough,
        alignYThrough,
      });
    },
    [resolveVertexDragPoint],
  );

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
    },
    [clientToPdf, thresholdPt, updateVertexDrag],
  );

  const onSelectPointerUp = useCallback(
    (event: React.PointerEvent) => {
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
    [clientToPdf, commitSelectionRect],
  );

  const annotationPolylinePoints = useCallback(
    (item: FloorPlanAnnotation): PdfPoint[] | null => {
      if (item.type === "polyline") return item.points;
      if (item.type === "rectangle") return rectangleToPolylinePoints(item.rect);
      if (item.type === "circle") return circleToPolylinePoints(item.rect);
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

      const replacements: FloorPlanAnnotation[] = pieces.map((piece) => ({
        type: "polyline",
        points: piece,
        color: item.color,
        strokeWidthPt: item.strokeWidthPt,
      }));

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

  const handleDrawPointerRaw = useCallback(
    (raw: PdfPoint) => {
      lastRawCursorRef.current = raw;
      const tool = drawToolRef.current;

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

      if (tool === "connect") {
        setHoverSnap(null);
        setConnectHoverIndex(
          hitTestConnectableBox(raw, annotationsRef.current, thresholdPt),
        );
        return;
      }

      setHoverSnap(null);
    },
    [thresholdPt, updateLineCursor, updateCutCursor, findCutTarget, snapOptions, boxVariantForTool],
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
      {
        type: "polyline",
        points: draft.points,
        color: draft.segmentColor,
        strokeWidthPt: strokeWidthRef.current,
      },
    ]);
    applyLineDraft(null);
  }, [pushUndoSnapshot, applyLineDraft]);

  /** Commits secured vertices when stroke color changes mid-polyline. */
  const changeStrokeColor = useCallback(
    (newColor: string) => {
      if (newColor.toLowerCase() === strokeColorRef.current.toLowerCase()) {
        return;
      }

      const draft = lineDraftRef.current;
      if (
        drawToolRef.current === "line" &&
        draft &&
        draft.points.length >= 2 &&
        draft.segmentColor.toLowerCase() !== newColor.toLowerCase()
      ) {
        pushUndoSnapshot();
        setAnnotations((prev) => [
          ...prev,
          {
            type: "polyline",
            points: draft.points,
            color: draft.segmentColor,
            strokeWidthPt: strokeWidthRef.current,
          },
        ]);
        const lastPoint = draft.points[draft.points.length - 1];
        applyLineDraft({
          points: [lastPoint],
          cursor: draft.cursor,
          segmentColor: newColor,
          snapKind: draft.snapKind,
          snapSegment: draft.snapSegment,
          alignXThrough: draft.alignXThrough,
          alignYThrough: draft.alignYThrough,
        });
      } else if (drawToolRef.current === "line" && draft) {
        applyLineDraft({ ...draft, segmentColor: newColor });
      }

      setStrokeColor(newColor);
    },
    [pushUndoSnapshot, applyLineDraft],
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
    if (drawToolRef.current === "connect") {
      if (connectDraftIndexRef.current != null) {
        connectDraftIndexRef.current = null;
        setConnectDraftIndex(null);
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

    if (drawToolRef.current !== "line") return false;
    const draft = lineDraftRef.current;
    if (!draft) return false;
    if (draft.points.length >= 2) {
      commitLineDraft();
    } else {
      cancelLineDraft();
    }
    return true;
  }, [commitLineDraft, cancelLineDraft, cancelCutDraft]);

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
        const hit = hitTestConnectableBox(
          raw,
          annotationsRef.current,
          thresholdPt,
        );
        const first = connectDraftIndexRef.current;
        if (hit == null) {
          connectDraftIndexRef.current = null;
          setConnectDraftIndex(null);
          return;
        }
        if (first == null) {
          connectDraftIndexRef.current = hit;
          setConnectDraftIndex(hit);
          return;
        }
        if (hit === first) {
          const target = annotationsRef.current[hit];
          const linked =
            target != null &&
            (target.type === "rectangle" || target.type === "circle") &&
            target.riserRole != null;
          if (linked) {
            pushUndoSnapshot();
            setAnnotations((prev) => disconnectRiserBox(prev, hit));
          }
          connectDraftIndexRef.current = null;
          setConnectDraftIndex(null);
          return;
        }
        const next = connectRiserBoxes(annotationsRef.current, first, hit);
        if (next && next !== annotationsRef.current) {
          pushUndoSnapshot();
          setAnnotations(next);
        }
        connectDraftIndexRef.current = null;
        setConnectDraftIndex(null);
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
        {
          type: tool,
          rect,
          ...(variant === "cross" ? { variant } : {}),
          color: strokeColorRef.current,
          strokeWidthPt: strokeWidthRef.current,
        },
      ]);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [clientToPdf, thresholdPt, pushUndoSnapshot, snapOptions, boxVariantForTool],
  );

  const onToolChange = useCallback(
    (tool: DrawTool) => {
      if (drawToolRef.current === "line" && lineDraftRef.current) {
        commitLineDraft();
      }
      setBoundingBoxDraft(null);
      boxDraggingRef.current = false;
      boxStartRef.current = null;
      setHoverSnap(null);
      applyCutDraft(null);
      setConnectDraftIndex(null);
      connectDraftIndexRef.current = null;
      setConnectHoverIndex(null);
      setHoverVertex(null);
      setVertexDrag(null);
      vertexDraggingRef.current = false;
      setSelectedIndices([]);
      setSelectionDraft(null);
      selectionDraggingRef.current = false;
      selectionStartRef.current = null;
      setDrawTool(tool);
    },
    [commitLineDraft, applyCutDraft],
  );

  const clearAnnotations = useCallback(() => {
    if (annotationsRef.current.length > 0) {
      pushUndoSnapshot();
    }
    setAnnotations([]);
    setSelectedIndices([]);
    setSelectionDraft(null);
    selectionDraggingRef.current = false;
    selectionStartRef.current = null;
    applyLineDraft(null);
    setBoundingBoxDraft(null);
    applyCutDraft(null);
    setConnectDraftIndex(null);
    connectDraftIndexRef.current = null;
    setConnectHoverIndex(null);
    boxDraggingRef.current = false;
    boxStartRef.current = null;
    setHoverSnap(null);
    setHoverVertex(null);
    setVertexDrag(null);
    vertexDraggingRef.current = false;
  }, [pushUndoSnapshot, applyLineDraft, applyCutDraft]);

  const replaceAnnotations = useCallback((next: FloorPlanAnnotation[]) => {
    setAnnotations(next);
    setSelectedIndices([]);
    setSelectionDraft(null);
    selectionDraggingRef.current = false;
    selectionStartRef.current = null;
    applyLineDraft(null);
    setBoundingBoxDraft(null);
    applyCutDraft(null);
    setConnectDraftIndex(null);
    connectDraftIndexRef.current = null;
    setConnectHoverIndex(null);
    boxDraggingRef.current = false;
    boxStartRef.current = null;
    setHoverSnap(null);
    setHoverVertex(null);
    setVertexDrag(null);
    vertexDraggingRef.current = false;
    undoStackRef.current = [];
  }, [applyLineDraft, applyCutDraft]);

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
        {
          type: "polyline",
          points: draft.points,
          color: draft.segmentColor,
          strokeWidthPt: strokeWidthRef.current,
        },
      ];
    }
    return base;
  }, []);

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
    if (!selectionInteractive) return;

    function onMove(event: PointerEvent) {
      const raw = clientToPdf(event.clientX, event.clientY);
      if (!raw) return;

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
  }, [selectionInteractive, clientToPdf, commitSelectionRect, updateVertexDrag, thresholdPt]);

  useEffect(() => {
    if (drawTool !== "none") return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Shift") return;
      shiftDownRef.current = true;
      const raw = lastRawCursorRef.current;
      if (!vertexDraggingRef.current || !raw) return;
      updateVertexDrag(raw);
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key !== "Shift") return;
      shiftDownRef.current = false;
      const raw = lastRawCursorRef.current;
      if (!vertexDraggingRef.current || !raw) return;
      updateVertexDrag(raw);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      shiftDownRef.current = false;
    };
  }, [drawTool, updateVertexDrag]);

  useEffect(() => {
    if (drawTool !== "line") return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Shift") return;
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
    if (!isBoxTool(drawTool)) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Shift") return;
      shiftDownRef.current = true;
      const raw = lastRawCursorRef.current;
      if (!boxDraggingRef.current || !raw) return;
      handleDrawPointerRaw(raw);
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key !== "Shift") return;
      shiftDownRef.current = false;
      const raw = lastRawCursorRef.current;
      if (!boxDraggingRef.current || !raw) return;
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
        case "c":
          tool = "cut";
          break;
        case "k":
          tool = "connect";
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
    hoverSnap,
    hoverVertex,
    vertexDrag,
    setStrokeColor: changeStrokeColor,
    setStrokeWidthPt,
    setRectangleVariant,
    setCircleVariant,
    onToolChange,
    clearAnnotations,
    replaceAnnotations,
    getAnnotationsForSave,
    deselectAnnotations,
    deleteSelected,
    onAnnotationSelect,
    handleEscape,
    onDrawPointerDown,
    onDrawPointerMove,
    onDrawPointerUp,
    onSelectPointerDown,
    onSelectPointerMove,
    onSelectPointerUp,
    onVertexPointerDown,
  };
}
