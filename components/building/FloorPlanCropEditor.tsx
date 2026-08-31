"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  applyFamilyCropSize,
  buildingHasPin,
  clampPin,
  cropAlignedToPin,
  cropWaitsForPin,
  defaultCropOverlayId,
  editOverlayBlockedReason,
  editOverlayCandidates,
  editOverlayPlateLayout,
  resolveOverlayAnchorPin,
  familyCropFitsPage,
  familyCropSizeLocked,
  familyPlatePin,
  nudgePin,
  cropDraftIsDirty,
  pinDraftIsDirty,
  pinFromReferenceAnchor,
  pinReferencePlanCandidates,
  planHasPin,
  planHasReferenceAnchor,
  referenceAnchorDraftIsDirty,
  resolvePinReferencePlan,
  savedPlanReferenceAnchor,
  pdfPointToCanvas,
  pdfRectToCanvas,
  canvasRectToPdf,
  canvasPointToPdf,
  panZoomScreenPoint,
  panZoomScreenRect,
  panZoomViewportToPage,
  pdfPointsEqual,
  resizeCanvasRectFromHandle,
  type CropHandleKind,
  type EditOverlayPlateLayout,
  type PdfPoint,
  type PdfRect,
  type PdfSize,
} from "@/lib/building/floor-plan-align";
import {
  floorPlanFileUrl,
  floorPlanLabel,
  lineOverlayCandidates,
  crossSetLinePlanForFloor,
  drawingSetLabel,
  otherDrawingSet,
  type FloorPlanDrawingSet,
  type FloorPlanDto,
  type FloorPlanFamilyDto,
  type FloorPlanSettingsDto,
} from "@/lib/building/floor-plan-shared";

import {
  FloorPlanMarkupLegend,
  FloorPlanRegistrationLegend,
  FloorPlanRegistrationMark,
  REGISTRATION_MARK_REFERENCE,
  REGISTRATION_MARK_SUGGESTED,
  REGISTRATION_MARK_THIS,
  type RegistrationLegendItem,
} from "./FloorPlanRegistrationMark";
import { FloorPlanAnnotationLayer } from "./FloorPlanAnnotationLayer";
import { FloorPlanEditorRibbon } from "./FloorPlanEditorRibbon";
import { FloorPlanPdfCanvas, FloorPlanPdfClipCanvas } from "./FloorPlanPdfCanvas";
import { FloorPlanZoomToolbar } from "./FloorPlanZoomToolbar";
import type { PdfPageRenderInfo } from "@/lib/pdf/pdfjs-browser";
import { useFloorPlanDrawing } from "@/lib/building/use-floor-plan-drawing";
import type { SnapResult } from "@/lib/building/floor-plan-draw-snap";
import type {
  CutDraft,
  DrawColorPreset,
  FloorPlanAnnotation,
  LineDraft,
  BoundingBoxDraft,
  SelectionDraft,
  VertexDragDraft,
  VertexHover,
} from "@/lib/building/floor-plan-annotations";
import {
  clearFloorPlanAnnotationDraft,
  resolveFloorPlanAnnotationMarkup,
  writeFloorPlanAnnotationDraft,
} from "@/lib/building/floor-plan-annotation-draft";
import { annotationsForHigherFloor } from "@/lib/building/floor-plan-riser-links";
import {
  annotationsGeometricallyEqual,
  excludeMatchingOverlayAnnotations,
  filterAnnotationsByStrokeColors,
  floorPlanAnnotationsEqual,
  mapAnnotationsAcrossPlans,
  type StrokeColorFilter,
} from "@/lib/building/floor-plan-annotations";
import { usePdfSession } from "@/lib/pdf/use-pdf-session";

type ViewTransform = { x: number; y: number; zoom: number };

const IDENTITY_VIEW: ViewTransform = { x: 0, y: 0, zoom: 1 };
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 16;
const FIT_PAD = 48;
const PAN_SLOP_PX = 4;
/** Both the base sheet and overlay render at this opacity when overlay is on. */
const EDIT_OVERLAY_OPACITY = 0.5;
const LINE_OVERLAY_OPACITY = 0.75;

function mappedOverlayAnnotationsFromSource(
  sourcePlan: FloorPlanDto | null,
  sourceFamily: FloorPlanFamilyDto | null,
  anchorPin: PdfPoint | null,
  anchorFamily: FloorPlanFamilyDto,
): FloorPlanAnnotation[] {
  if (!sourcePlan || !sourceFamily || !anchorPin || !planHasPin(sourcePlan)) {
    return [];
  }
  const sourceMarkup = resolveFloorPlanAnnotationMarkup(
    sourcePlan.id,
    sourcePlan.annotations,
  );
  if (sourceMarkup.length === 0) return [];
  return mapAnnotationsAcrossPlans(
    annotationsForHigherFloor(sourceMarkup),
    { x: sourcePlan.pinXPt!, y: sourcePlan.pinYPt! },
    anchorPin,
    sourceFamily,
    anchorFamily,
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function defaultUnlockedCrop(page: PdfSize): PdfRect {
  const inset = Math.min(page.width, page.height) * 0.08;
  return {
    x: inset,
    y: inset,
    width: page.width - inset * 2,
    height: page.height - inset * 2,
  };
}

function initialCrop(
  plan: FloorPlanDto,
  family: FloorPlanFamilyDto,
  page: PdfSize,
  resizeFamily: boolean,
  pin: PdfPoint | null,
  platePin: PdfPoint | null,
): PdfRect {
  const familySize =
    family.cropWidthPt != null && family.cropHeightPt != null
      ? { width: family.cropWidthPt, height: family.cropHeightPt }
      : null;
  const lockSize = resizeFamily ? null : familySize;
  if (plan.cropXPt != null && plan.cropYPt != null && familySize && !resizeFamily) {
    return applyFamilyCropSize(
      familySize,
      {
        x: plan.cropXPt,
        y: plan.cropYPt,
        width: familySize.width,
        height: familySize.height,
      },
      page,
    );
  }
  if (familySize && !resizeFamily && pin) {
    return cropAlignedToPin(pin, familySize, page, platePin);
  }
  const proposed = familySize && !resizeFamily
    ? {
        x: (page.width - familySize.width) / 2,
        y: (page.height - familySize.height) / 2,
        width: familySize.width,
        height: familySize.height,
      }
    : defaultUnlockedCrop(page);
  return applyFamilyCropSize(lockSize, proposed, page);
}

function fitView(
  viewport: HTMLElement,
  page: PdfSize,
  scale: number,
): ViewTransform {
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
  view: ViewTransform,
  factor: number,
  originX: number,
  originY: number,
): ViewTransform {
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom * factor));
  if (next === view.zoom) return view;
  const ratio = next / view.zoom;
  return {
    zoom: next,
    x: originX - (originX - view.x) * ratio,
    y: originY - (originY - view.y) * ratio,
  };
}

type DragKind = "move" | CropHandleKind;
type HandleKind = CropHandleKind;

const HANDLE_KINDS: HandleKind[] = ["n", "e", "s", "w", "nw", "ne", "sw", "se"];

const HANDLE_CLASS: Record<HandleKind, string> = {
  n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  s: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
  w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  sw: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  se: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
};

type CropTone = "crop" | "overlay";

export function FloorPlanCropEditor({
  plan,
  family,
  settings,
  plans,
  families,
  allPlans,
  allFamilies,
  drawingSet,
  scale,
  onSave,
  onSavePin,
  onSaveReferenceAnchor,
  onSaveAnnotations,
  onSaveDrawColorPresets,
  onSetRegistrationPlan,
  onSetPinReferencePlan,
  onMoveToNewFamily,
  saving,
  savingAnnotations = false,
  expanded,
  onExpandedChange,
  embeddedExpanded = false,
}: {
  plan: FloorPlanDto;
  family: FloorPlanFamilyDto;
  settings: FloorPlanSettingsDto;
  plans: FloorPlanDto[];
  families: FloorPlanFamilyDto[];
  allPlans: FloorPlanDto[];
  allFamilies: FloorPlanFamilyDto[];
  drawingSet: FloorPlanDrawingSet;
  scale: number;
  onSave: (crop: PdfRect) => void;
  onSavePin: (pin: PdfPoint) => void;
  onSaveReferenceAnchor: (anchor: PdfPoint) => void;
  onSaveAnnotations: (annotations: FloorPlanAnnotation[]) => Promise<void>;
  onSaveDrawColorPresets?: (presets: DrawColorPreset[]) => Promise<void>;
  onSetRegistrationPlan?: (planId: string) => Promise<void>;
  onSetPinReferencePlan?: (planId: string) => Promise<void>;
  onMoveToNewFamily: (name: string) => Promise<void>;
  saving: boolean;
  savingAnnotations?: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Parent owns the full-screen shell; render crop UI inside it without a second portal. */
  embeddedExpanded?: boolean;
}) {
  const storedPage: PdfSize = useMemo(
    () => ({
      width: plan.originalPageWidthPt,
      height: plan.originalPageHeightPt,
    }),
    [plan.originalPageWidthPt, plan.originalPageHeightPt],
  );
  const [page, setPage] = useState<PdfSize>(storedPage);
  const overlayPlans = useMemo(
    () => editOverlayCandidates(plans, plan),
    [plans, plan],
  );
  const defaultOverlayId = defaultCropOverlayId(
    overlayPlans,
    plan.floorNumber,
  );
  const [overlayEnabled, setOverlayEnabled] = useState(false);
  const [overlayPlanId, setOverlayPlanId] = useState(defaultOverlayId ?? "");
  const lineOverlayPlans = useMemo(
    () => lineOverlayCandidates(plans, plan),
    [plans, plan],
  );
  const defaultLineOverlayId = defaultCropOverlayId(
    lineOverlayPlans,
    plan.floorNumber,
  );
  const [lineOverlayEnabled, setLineOverlayEnabled] = useState(false);
  const [lineOverlayPlanId, setLineOverlayPlanId] = useState(
    defaultLineOverlayId ?? "",
  );
  const [lineOverlayColorFilter, setLineOverlayColorFilter] =
    useState<StrokeColorFilter>("all");
  const crossSetLinePlan = useMemo(
    () => crossSetLinePlanForFloor(allPlans, allFamilies, plan, drawingSet),
    [allPlans, allFamilies, plan, drawingSet],
  );
  const [showCrossSetLines, setShowCrossSetLines] = useState(false);
  const crossSetLinesLabel = `${drawingSetLabel(otherDrawingSet(drawingSet))} lines`;
  const [savedAnnotations, setSavedAnnotations] = useState(
    () => plan.annotations,
  );
  const annotationDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingAnnotationsRef = useRef<FloorPlanAnnotation[]>([]);
  const annotationsDirtyRef = useRef(false);
  const annotationPlanIdRef = useRef(plan.id);
  annotationPlanIdRef.current = plan.id;
  const [showPin, setShowPin] = useState(true);
  const [showReferenceAnchor, setShowReferenceAnchor] = useState(true);
  const [showCrop, setShowCrop] = useState(true);
  const [showLines, setShowLines] = useState(true);
  const [colorPresets, setColorPresets] = useState<DrawColorPreset[]>(
    () => settings.drawColorPresets,
  );
  const colorPresetsSaveRef = useRef<Promise<void> | null>(null);
  const colorPresetsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [draftPin, setDraftPin] = useState<PdfPoint | null>(() =>
    planHasPin(plan) ? { x: plan.pinXPt!, y: plan.pinYPt! } : null,
  );
  const [draftReferenceAnchor, setDraftReferenceAnchor] = useState<PdfPoint | null>(
    () =>
      planHasReferenceAnchor(plan)
        ? { x: plan.referenceAnchorXPt!, y: plan.referenceAnchorYPt! }
        : null,
  );
  const [placingReferenceAnchor, setPlacingReferenceAnchor] = useState(false);
  const [pinDrag, setPinDrag] = useState<{
    startX: number;
    startY: number;
    startPin: PdfPoint;
  } | null>(null);
  const [referenceAnchorDrag, setReferenceAnchorDrag] = useState<{
    startX: number;
    startY: number;
    startAnchor: PdfPoint;
  } | null>(null);
  const [settingReference, setSettingReference] = useState(false);
  const [settingPinReference, setSettingPinReference] = useState(false);
  const [resizeFamily, setResizeFamily] = useState(false);
  const [resizeChoiceOpen, setResizeChoiceOpen] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState("");
  const [movingFamily, setMovingFamily] = useState(false);
  const platePin = useMemo(
    () => familyPlatePin(plans, plan),
    [plans, plan],
  );
  const platePinRef = useRef(platePin);
  platePinRef.current = platePin;

  useEffect(() => {
    setColorPresets(settings.drawColorPresets);
  }, [settings.drawColorPresets]);

  const handleColorPresetsChange = useCallback(
    (next: DrawColorPreset[]) => {
      setColorPresets(next);
      if (!onSaveDrawColorPresets) return;
      if (colorPresetsSaveTimerRef.current) {
        clearTimeout(colorPresetsSaveTimerRef.current);
      }
      colorPresetsSaveTimerRef.current = setTimeout(() => {
        colorPresetsSaveTimerRef.current = null;
        const save = onSaveDrawColorPresets(next);
        colorPresetsSaveRef.current = save;
        void save.finally(() => {
          if (colorPresetsSaveRef.current === save) {
            colorPresetsSaveRef.current = null;
          }
        });
      }, 500);
    },
    [onSaveDrawColorPresets],
  );

  useEffect(() => {
    return () => {
      if (colorPresetsSaveTimerRef.current) {
        clearTimeout(colorPresetsSaveTimerRef.current);
      }
    };
  }, []);

  const markupLegend: RegistrationLegendItem[] = useMemo(
    () =>
      colorPresets.map((preset) => ({
        color: preset.color,
        label: preset.shortcut
          ? `${preset.label} (${preset.shortcut.toUpperCase()})`
          : preset.label,
      })),
    [colorPresets],
  );
  const [crop, setCrop] = useState<PdfRect>(() =>
    initialCrop(
      plan,
      family,
      storedPage,
      false,
      planHasPin(plan) ? { x: plan.pinXPt!, y: plan.pinYPt! } : null,
      platePin,
    ),
  );
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const draftPinRef = useRef(draftPin);
  draftPinRef.current = draftPin;
  const draftReferenceAnchorRef = useRef(draftReferenceAnchor);
  draftReferenceAnchorRef.current = draftReferenceAnchor;
  const cropLockedToPinRef = useRef(
    !plan.hasCropped &&
      family.cropWidthPt != null &&
      family.cropHeightPt != null,
  );
  const pageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<ViewTransform>(IDENTITY_VIEW);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [drag, setDrag] = useState<{
    kind: DragKind;
    startX: number;
    startY: number;
    start: PdfRect;
  } | null>(null);
  const [pan, setPan] = useState<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const placeGestureRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  const referenceOverlayAnnotationsRef = useRef<FloorPlanAnnotation[]>([]);
  const [hiddenOverlayAnnotations, setHiddenOverlayAnnotations] = useState<
    FloorPlanAnnotation[]
  >([]);

  const hideReferenceOverlayAnnotation = useCallback(
    (annotation: FloorPlanAnnotation) => {
      setHiddenOverlayAnnotations((prev) => {
        if (prev.some((item) => annotationsGeometricallyEqual(item, annotation))) {
          return prev;
        }
        return [...prev, annotation];
      });
    },
    [],
  );

  const drawing = useFloorPlanDrawing({
    pageHeight: page.height,
    scale,
    expanded,
    view,
    pageRef,
    viewportRef,
    colorPresets,
    referenceOverlayAnnotationsRef,
    onHideReferenceOverlayAnnotation: hideReferenceOverlayAnnotation,
  });
  const {
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
    setStrokeColor,
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
  } = drawing;

  const handleDeleteSelected = useCallback(() => {
    const removed = selectedIndices
      .map((index) => annotations[index])
      .filter((item): item is FloorPlanAnnotation => item != null);
    deleteSelected();
    if (removed.length === 0) return;
    setHiddenOverlayAnnotations((prev) => {
      const next = [...prev];
      for (const item of removed) {
        if (!next.some((hidden) => annotationsGeometricallyEqual(hidden, item))) {
          next.push(item);
        }
      }
      return next;
    });
  }, [selectedIndices, annotations, deleteSelected]);

  const handleClearAnnotations = useCallback(() => {
    clearAnnotations();
    setHiddenOverlayAnnotations([]);
  }, [clearAnnotations]);

  useEffect(() => {
    if (overlayPlans.length === 0) {
      setOverlayEnabled(false);
      setOverlayPlanId("");
      return;
    }
    if (!overlayPlans.some((item) => item.id === overlayPlanId)) {
      setOverlayPlanId(
        defaultCropOverlayId(overlayPlans, plan.floorNumber) ??
          overlayPlans[0].id,
      );
    }
  }, [overlayPlans, overlayPlanId, plan.floorNumber]);

  useEffect(() => {
    if (lineOverlayPlans.length === 0) {
      setLineOverlayEnabled(false);
      setLineOverlayPlanId("");
      return;
    }
    if (!lineOverlayPlans.some((item) => item.id === lineOverlayPlanId)) {
      setLineOverlayPlanId(
        defaultCropOverlayId(lineOverlayPlans, plan.floorNumber) ??
          lineOverlayPlans[0].id,
      );
    }
  }, [lineOverlayPlans, lineOverlayPlanId, plan.floorNumber]);

  useEffect(() => {
    if (!crossSetLinePlan) setShowCrossSetLines(false);
  }, [crossSetLinePlan]);

  const loadedPlanIdRef = useRef<string | null>(null);
  const savedAnnotationsRef = useRef(savedAnnotations);
  savedAnnotationsRef.current = savedAnnotations;

  useEffect(() => {
    setHiddenOverlayAnnotations([]);
  }, [plan.id]);

  const pendingAnnotations = useMemo(
    () => getAnnotationsForSave(),
    [
      getAnnotationsForSave,
      annotations,
      lineDraft,
      drawTool,
      strokeColor,
      strokeWidthPt,
    ],
  );

  const annotationsDirty = useMemo(
    () => !floorPlanAnnotationsEqual(pendingAnnotations, savedAnnotations),
    [pendingAnnotations, savedAnnotations],
  );
  pendingAnnotationsRef.current = pendingAnnotations;
  annotationsDirtyRef.current = annotationsDirty;

  useEffect(() => {
    const planChanged = loadedPlanIdRef.current !== plan.id;
    if (!planChanged && annotationsDirtyRef.current) return;
    loadedPlanIdRef.current = plan.id;
    const initial = resolveFloorPlanAnnotationMarkup(plan.id, plan.annotations);
    setSavedAnnotations(plan.annotations);
    replaceAnnotations(initial);
  }, [plan.id, plan.annotations, replaceAnnotations]);

  useEffect(() => {
    return () => {
      if (annotationDraftTimerRef.current) {
        clearTimeout(annotationDraftTimerRef.current);
        annotationDraftTimerRef.current = null;
      }
      if (annotationsDirtyRef.current) {
        writeFloorPlanAnnotationDraft(
          annotationPlanIdRef.current,
          pendingAnnotationsRef.current,
          savedAnnotationsRef.current,
        );
      }
    };
  }, [plan.id]);

  useEffect(() => {
    if (!annotationsDirty) {
      if (floorPlanAnnotationsEqual(pendingAnnotations, savedAnnotations)) {
        clearFloorPlanAnnotationDraft(plan.id);
      }
      return;
    }

    if (annotationDraftTimerRef.current) {
      clearTimeout(annotationDraftTimerRef.current);
    }
    annotationDraftTimerRef.current = setTimeout(() => {
      annotationDraftTimerRef.current = null;
      writeFloorPlanAnnotationDraft(
        plan.id,
        pendingAnnotations,
        savedAnnotationsRef.current,
      );
    }, 400);

    return () => {
      if (annotationDraftTimerRef.current) {
        clearTimeout(annotationDraftTimerRef.current);
        annotationDraftTimerRef.current = null;
      }
    };
  }, [annotationsDirty, pendingAnnotations, plan.id, savedAnnotations]);

  const [savingLines, setSavingLines] = useState(false);

  const handleSaveAnnotations = useCallback(async () => {
    const toSave = getAnnotationsForSave();
    setSavingLines(true);
    try {
      await onSaveAnnotations(toSave);
      replaceAnnotations(toSave);
      setSavedAnnotations(toSave);
      clearFloorPlanAnnotationDraft(plan.id);
    } catch {
      // Parent surfaces the error message.
    } finally {
      setSavingLines(false);
    }
  }, [getAnnotationsForSave, onSaveAnnotations, plan.id, replaceAnnotations]);

  const overlayPlan =
    overlayEnabled && overlayPlanId
      ? overlayPlans.find((item) => item.id === overlayPlanId) ?? null
      : null;
  const overlayActive = overlayPlan != null;
  const calibrationPlan = useMemo(
    () => resolvePinReferencePlan(settings, plans),
    [settings, plans],
  );
  const suggestedPin = useMemo(() => {
    if (!calibrationPlan || calibrationPlan.id === plan.id) return null;
    if (!draftReferenceAnchor) return null;
    return pinFromReferenceAnchor(calibrationPlan, draftReferenceAnchor, page);
  }, [calibrationPlan, plan.id, draftReferenceAnchor, page]);
  const anchorPin = resolveOverlayAnchorPin(draftPin, plan, suggestedPin);
  const lineOverlayPlan =
    lineOverlayPlanId
      ? lineOverlayPlans.find((item) => item.id === lineOverlayPlanId) ?? null
      : null;
  const lineOverlayFamily = useMemo(
    () =>
      lineOverlayPlan
        ? families.find((item) => item.id === lineOverlayPlan.familyId) ?? null
        : null,
    [families, lineOverlayPlan],
  );
  const crossSetLineFamily = useMemo(
    () =>
      crossSetLinePlan
        ? allFamilies.find((item) => item.id === crossSetLinePlan.familyId) ??
          null
        : null,
    [allFamilies, crossSetLinePlan],
  );
  const crossSetPlanHasMarkup = (crossSetLinePlan?.annotations.length ?? 0) > 0;
  const overlayFamily = useMemo(
    () =>
      overlayPlan
        ? families.find((item) => item.id === overlayPlan.familyId) ?? null
        : null,
    [families, overlayPlan],
  );
  const overlayAnnotations = useMemo(() => {
    const mapped: FloorPlanAnnotation[] = [];
    if (lineOverlayEnabled && lineOverlayPlan) {
      mapped.push(
        ...filterAnnotationsByStrokeColors(
          mappedOverlayAnnotationsFromSource(
            lineOverlayPlan,
            lineOverlayFamily,
            anchorPin,
            family,
          ),
          lineOverlayColorFilter,
        ),
      );
    }
    if (showCrossSetLines && crossSetLinePlan) {
      mapped.push(
        ...mappedOverlayAnnotationsFromSource(
          crossSetLinePlan,
          crossSetLineFamily,
          anchorPin,
          family,
        ),
      );
    }
    return excludeMatchingOverlayAnnotations(
      [...annotations, ...hiddenOverlayAnnotations],
      mapped,
    );
  }, [
    lineOverlayEnabled,
    lineOverlayPlan,
    lineOverlayFamily,
    lineOverlayColorFilter,
    showCrossSetLines,
    crossSetLinePlan,
    crossSetLineFamily,
    anchorPin,
    family,
    annotations,
    hiddenOverlayAnnotations,
  ]);
  referenceOverlayAnnotationsRef.current = overlayAnnotations;
  const importOverlaySource = useMemo(() => {
    if (lineOverlayPlan && lineOverlayFamily) {
      return { plan: lineOverlayPlan, family: lineOverlayFamily };
    }
    if (overlayActive && overlayPlan && overlayFamily) {
      return { plan: overlayPlan, family: overlayFamily };
    }
    return null;
  }, [
    lineOverlayPlan,
    lineOverlayFamily,
    overlayActive,
    overlayPlan,
    overlayFamily,
  ]);
  const importableOverlayAnnotations = useMemo(() => {
    const mapped =
      importOverlaySource
        ? mappedOverlayAnnotationsFromSource(
            importOverlaySource.plan,
            importOverlaySource.family,
            anchorPin,
            family,
          )
        : [];
    const filtered =
      lineOverlayPlan &&
      importOverlaySource?.plan.id === lineOverlayPlan.id
        ? filterAnnotationsByStrokeColors(mapped, lineOverlayColorFilter)
        : mapped;
    return filtered;
  }, [
    importOverlaySource,
    anchorPin,
    family,
    lineOverlayPlan,
    lineOverlayColorFilter,
  ]);

  const handleImportOverlayLines = useCallback(async () => {
    if (importableOverlayAnnotations.length === 0) return;
    const current = getAnnotationsForSave();
    const toAdd = excludeMatchingOverlayAnnotations(
      current,
      importableOverlayAnnotations,
    );
    if (toAdd.length === 0) {
      window.alert("All selected overlay lines already exist on this floor.");
      return;
    }
    const sourceLabel = importOverlaySource
      ? floorPlanLabel(importOverlaySource.plan)
      : "overlay";
    const confirmed = window.confirm(
      current.length > 0
        ? `Add ${toAdd.length} line(s) from ${sourceLabel} to this floor (${current.length} existing line(s) will be kept)?`
        : `Add ${toAdd.length} line(s) from ${sourceLabel} to this floor?`,
    );
    if (!confirmed) return;
    const merged = [...current, ...toAdd];
    setSavingLines(true);
    try {
      await onSaveAnnotations(merged);
      replaceAnnotations(merged);
      setSavedAnnotations(merged);
      clearFloorPlanAnnotationDraft(plan.id);
      setLineOverlayEnabled(false);
      setHiddenOverlayAnnotations([]);
    } catch {
      // Parent surfaces the error message.
    } finally {
      setSavingLines(false);
    }
  }, [
    importableOverlayAnnotations,
    getAnnotationsForSave,
    importOverlaySource,
    onSaveAnnotations,
    replaceAnnotations,
    plan.id,
  ]);

  const originalUrl = useMemo(
    () => floorPlanFileUrl(plan.id, "original", plan.updatedAt),
    [plan.id, plan.updatedAt],
  );
  const ghostUrl = useMemo(
    () =>
      overlayPlan
        ? floorPlanFileUrl(overlayPlan.id, "cropped", overlayPlan.updatedAt)
        : null,
    [overlayPlan],
  );
  usePdfSession(
    true,
    ghostUrl ? [originalUrl, ghostUrl] : [originalUrl],
  );
  const familySize: PdfSize | null = useMemo(() => {
    if (family.cropWidthPt != null && family.cropHeightPt != null) {
      return { width: family.cropWidthPt, height: family.cropHeightPt };
    }
    return null;
  }, [family.cropWidthPt, family.cropHeightPt]);
  const familyHasPlate = familyCropSizeLocked(familySize);
  const cropAwaitingPin = cropWaitsForPin({
    familyHasPlate,
    hasSavedCrop: plan.hasCropped || (plan.cropXPt != null && plan.cropYPt != null),
    hasPin: draftPin != null,
  });
  const cropChromeVisible = showCrop && !cropAwaitingPin;
  const overlayLayout = useMemo(() => {
    if (!overlayPlan || !overlayFamily || !anchorPin) {
      return null;
    }
    return editOverlayPlateLayout(
      anchorPin,
      { x: crop.x, y: crop.y },
      crop.height,
      family,
      overlayPlan,
      overlayFamily,
      scale,
    );
  }, [
    overlayPlan,
    overlayFamily,
    anchorPin,
    crop.x,
    crop.y,
    crop.height,
    family,
    scale,
  ]);
  const overlayBlockedReason = useMemo(() => {
    const sheetReason =
      overlayLayout == null
        ? editOverlayBlockedReason({
            overlayActive,
            overlayPlan,
            overlayFamily,
            alignmentPin: anchorPin,
            cropAwaitingPin,
          })
        : null;
    if (sheetReason) return sheetReason;
    if (!lineOverlayEnabled || !lineOverlayPlan || anchorPin) return null;
    if (cropAwaitingPin) {
      return "Place the building pin first — the crop rectangle sits relative to it.";
    }
    return "Place the building pin or reference anchor on this floor to align the overlay.";
  }, [
    overlayLayout,
    overlayActive,
    overlayPlan,
    overlayFamily,
    anchorPin,
    cropAwaitingPin,
    lineOverlayEnabled,
    lineOverlayPlan,
  ]);
  const buildingPinRequiredReason = useMemo(() => {
    if (anchorPin) return null;
    if (lineOverlayPlans.length === 0 && overlayPlans.length === 0) return null;
    return "Building pin not set on this floor — click the drawing to place the red crosshair, then save.";
  }, [anchorPin, lineOverlayPlans.length, overlayPlans.length]);
  const overlayRenderable = overlayActive && overlayLayout != null;
  const overlayLocked = overlayActive && familyCropSizeLocked(familySize);
  const familyFitsPage =
    familySize == null || familyCropFitsPage(familySize, page);
  const familyPlateLocked =
    familyCropSizeLocked(familySize) &&
    !resizeFamily &&
    !overlayActive &&
    familyFitsPage;
  const sizeLocked = overlayLocked || familyPlateLocked;
  const handlesHidden = overlayLocked;
  const buildingPinned = buildingHasPin(settings);
  const isRegistration =
    settings.registrationPlanId == null || settings.registrationPlanId === plan.id;

  useEffect(() => {
    setDraftPin(
      planHasPin(plan) ? { x: plan.pinXPt!, y: plan.pinYPt! } : null,
    );
  }, [plan.pinXPt, plan.pinYPt, plan.id]);

  useEffect(() => {
    setDraftReferenceAnchor(
      planHasReferenceAnchor(plan)
        ? { x: plan.referenceAnchorXPt!, y: plan.referenceAnchorYPt! }
        : null,
    );
  }, [plan.referenceAnchorXPt, plan.referenceAnchorYPt, plan.id]);

  useEffect(() => {
    if (!sizeLocked || !familySize) return;
    setCrop((current) => {
      const next = applyFamilyCropSize(familySize, current, page);
      if (
        next.x === current.x &&
        next.y === current.y &&
        next.width === current.width &&
        next.height === current.height
      ) {
        return current;
      }
      return next;
    });
  }, [sizeLocked, familySize, page]);

  const applyProposed = useCallback(
    (proposed: PdfRect) => {
      setCrop(applyFamilyCropSize(sizeLocked ? familySize : null, proposed, page));
    },
    [familySize, sizeLocked, page],
  );

  const onPdfRendered = useCallback((info: PdfPageRenderInfo) => {
    if (!(info.pageWidthPt > 0) || !(info.pageHeightPt > 0)) return;
    const next = { width: info.pageWidthPt, height: info.pageHeightPt };
    setPage((prev) => {
      if (
        Math.abs(prev.width - next.width) < 0.5 &&
        Math.abs(prev.height - next.height) < 0.5
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    cropLockedToPinRef.current =
      !plan.hasCropped &&
      family.cropWidthPt != null &&
      family.cropHeightPt != null;
  }, [plan.id]);

  useEffect(() => {
    if (plan.hasCropped) cropLockedToPinRef.current = false;
  }, [plan.hasCropped]);

  useEffect(() => {
    setDrag(null);
    setResizeFamily(false);
    setResizeChoiceOpen(false);
    setNewFamilyName("");
    onToolChange("none");
    setCrop(
      initialCrop(
        plan,
        family,
        page,
        false,
        draftPinRef.current,
        platePinRef.current,
      ),
    );
  }, [
    page.width,
    page.height,
    plan.id,
    plan.cropXPt,
    plan.cropYPt,
    family.id,
    family.cropWidthPt,
    family.cropHeightPt,
  ]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [expanded]);

  const fittedForExpandRef = useRef(false);
  const pageForFitRef = useRef(page);
  pageForFitRef.current = page;
  const scaleForFitRef = useRef(scale);
  scaleForFitRef.current = scale;

  useEffect(() => {
    if (expanded) return;
    setView(IDENTITY_VIEW);
    fittedForExpandRef.current = false;
  }, [expanded]);

  const onViewportSize = useCallback((width: number, height: number) => {
    if (!expanded || fittedForExpandRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport || width < 2 || height < 2) return;
    // Fit once when the full-screen viewport is measured. Re-fitting later
    // (PDF page size, clip raster) would yank zoom after the user started.
    setView(fitView(viewport, pageForFitRef.current, scaleForFitRef.current));
    fittedForExpandRef.current = true;
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (handleEscape()) return;
        onExpandedChange(false);
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, onExpandedChange, handleEscape]);

  useEffect(() => {
    if (!expanded) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    function onPointerDown(event: PointerEvent) {
      const ctrlPan = event.button === 0 && event.ctrlKey;
      if (event.button !== 1 && !ctrlPan) return;
      event.preventDefault();
      event.stopPropagation();
      setPan({
        startX: event.clientX,
        startY: event.clientY,
        originX: viewRef.current.x,
        originY: viewRef.current.y,
      });
    }

    function onAuxClick(event: MouseEvent) {
      if (event.button === 1) event.preventDefault();
    }

    viewport.addEventListener("pointerdown", onPointerDown, { capture: true });
    viewport.addEventListener("auxclick", onAuxClick);
    return () => {
      viewport.removeEventListener("pointerdown", onPointerDown, { capture: true });
      viewport.removeEventListener("auxclick", onAuxClick);
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) {
      setCtrlHeld(false);
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Control") setCtrlHeld(true);
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.key === "Control") setCtrlHeld(false);
    }

    function onBlur() {
      setCtrlHeld(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      setCtrlHeld(false);
    };
  }, [expanded]);

  useEffect(() => {
    if (!drag) return;

    function onMove(event: PointerEvent) {
      const pageEl = pageRef.current;
      if (!pageEl) return;
      const bounds = pageEl.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      // Convert client pixels through the CSS pan/zoom transform into page-local
      // coordinates (the same space as pdfRectToCanvas).
      const sx = pageEl.offsetWidth / bounds.width;
      const sy = pageEl.offsetHeight / bounds.height;
      if (drag.kind === "move" || sizeLocked) {
        applyProposed({
          ...drag.start,
          x: drag.start.x + ((event.clientX - drag.startX) * sx) / scale,
          y: drag.start.y - ((event.clientY - drag.startY) * sy) / scale,
        });
        return;
      }
      const canvasStart = pdfRectToCanvas(drag.start, page.height, scale);
      const pageW = page.width * scale;
      const pageH = page.height * scale;
      applyProposed(
        canvasRectToPdf(
          resizeCanvasRectFromHandle(
            drag.kind,
            canvasStart,
            {
              x: (event.clientX - bounds.left) * sx,
              y: (event.clientY - bounds.top) * sy,
            },
            { width: pageW, height: pageH },
          ),
          page.height,
          scale,
        ),
      );
    }

    function onUp() {
      setDrag(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, applyProposed, sizeLocked, page, scale]);

  useEffect(() => {
    if (!pan) return;

    function onMove(event: PointerEvent) {
      setView({
        zoom: viewRef.current.zoom,
        x: pan.originX + (event.clientX - pan.startX),
        y: pan.originY + (event.clientY - pan.startY),
      });
    }

    function onUp() {
      setPan(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [pan]);

  const applyPin = useCallback(
    (next: PdfPoint) => {
      setDraftPin(next);
      if (!cropLockedToPinRef.current || !familySize) return;
      setCrop(cropAlignedToPin(next, familySize, page, platePin));
    },
    [familySize, page, platePin],
  );

  const applyReferenceAnchor = useCallback((next: PdfPoint) => {
    setDraftReferenceAnchor(next);
    setPlacingReferenceAnchor(false);
  }, []);

  const placePinFromClient = useCallback(
    (clientX: number, clientY: number, pageEl: HTMLElement) => {
      const bounds = pageEl.getBoundingClientRect();
      applyPin(
        clampPin(
          canvasPointToPdf(
            { x: clientX - bounds.left, y: clientY - bounds.top },
            page.height,
            scale,
          ),
          page,
        ),
      );
    },
    [applyPin, page, scale],
  );

  const placeReferenceAnchorFromClient = useCallback(
    (clientX: number, clientY: number, pageEl: HTMLElement) => {
      const bounds = pageEl.getBoundingClientRect();
      applyReferenceAnchor(
        clampPin(
          canvasPointToPdf(
            { x: clientX - bounds.left, y: clientY - bounds.top },
            page.height,
            scale,
          ),
          page,
        ),
      );
    },
    [applyReferenceAnchor, page, scale],
  );

  const placeReferenceAnchorFromViewport = useCallback(
    (clientX: number, clientY: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const bounds = viewport.getBoundingClientRect();
      const pagePoint = panZoomViewportToPage(
        { x: clientX - bounds.left, y: clientY - bounds.top },
        viewRef.current,
      );
      applyReferenceAnchor(
        clampPin(canvasPointToPdf(pagePoint, page.height, scale), page),
      );
    },
    [applyReferenceAnchor, page, scale],
  );

  const placePinFromViewport = useCallback(
    (clientX: number, clientY: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const bounds = viewport.getBoundingClientRect();
      const pagePoint = panZoomViewportToPage(
        { x: clientX - bounds.left, y: clientY - bounds.top },
        viewRef.current,
      );
      applyPin(clampPin(canvasPointToPdf(pagePoint, page.height, scale), page));
    },
    [applyPin, page, scale],
  );

  const placePinAtPointer = useCallback(
    (clientX: number, clientY: number) => {
      if (expanded) {
        placePinFromViewport(clientX, clientY);
        return;
      }
      const pageEl = pageRef.current;
      if (pageEl) placePinFromClient(clientX, clientY, pageEl);
    },
    [expanded, placePinFromClient, placePinFromViewport],
  );

  const placeReferenceAnchorAtPointer = useCallback(
    (clientX: number, clientY: number) => {
      if (expanded) {
        placeReferenceAnchorFromViewport(clientX, clientY);
        return;
      }
      const pageEl = pageRef.current;
      if (pageEl) placeReferenceAnchorFromClient(clientX, clientY, pageEl);
    },
    [expanded, placeReferenceAnchorFromClient, placeReferenceAnchorFromViewport],
  );

  const beginPinDrag = useCallback(
    (event: React.PointerEvent) => {
      if (!draftPinRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      setPinDrag({
        startX: event.clientX,
        startY: event.clientY,
        startPin: draftPinRef.current,
      });
    },
    [],
  );

  const beginReferenceAnchorDrag = useCallback(
    (event: React.PointerEvent) => {
      if (!draftReferenceAnchorRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      setReferenceAnchorDrag({
        startX: event.clientX,
        startY: event.clientY,
        startAnchor: draftReferenceAnchorRef.current,
      });
    },
    [],
  );

  useEffect(() => {
    if (!pinDrag) return;

    function onMove(event: PointerEvent) {
      if (expanded) {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const bounds = viewport.getBoundingClientRect();
        const pagePoint = panZoomViewportToPage(
          { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
          viewRef.current,
        );
        applyPin(
          clampPin(canvasPointToPdf(pagePoint, page.height, scale), page),
        );
        return;
      }
      const pageEl = pageRef.current;
      if (!pageEl) return;
      const bounds = pageEl.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const sx = pageEl.offsetWidth / bounds.width;
      const sy = pageEl.offsetHeight / bounds.height;
      const dx = ((event.clientX - pinDrag.startX) * sx) / scale;
      const dy = -((event.clientY - pinDrag.startY) * sy) / scale;
      applyPin(
        clampPin(
          { x: pinDrag.startPin.x + dx, y: pinDrag.startPin.y + dy },
          page,
        ),
      );
    }

    function onUp() {
      setPinDrag(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [pinDrag, page, scale, expanded, applyPin]);

  useEffect(() => {
    if (!referenceAnchorDrag) return;

    function onMove(event: PointerEvent) {
      if (expanded) {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const bounds = viewport.getBoundingClientRect();
        const pagePoint = panZoomViewportToPage(
          { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
          viewRef.current,
        );
        applyReferenceAnchor(
          clampPin(canvasPointToPdf(pagePoint, page.height, scale), page),
        );
        return;
      }
      const pageEl = pageRef.current;
      if (!pageEl) return;
      const bounds = pageEl.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const sx = pageEl.offsetWidth / bounds.width;
      const sy = pageEl.offsetHeight / bounds.height;
      const dx = ((event.clientX - referenceAnchorDrag.startX) * sx) / scale;
      const dy = -((event.clientY - referenceAnchorDrag.startY) * sy) / scale;
      applyReferenceAnchor(
        clampPin(
          {
            x: referenceAnchorDrag.startAnchor.x + dx,
            y: referenceAnchorDrag.startAnchor.y + dy,
          },
          page,
        ),
      );
    }

    function onUp() {
      setReferenceAnchorDrag(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [referenceAnchorDrag, page, scale, expanded, applyReferenceAnchor]);

  useEffect(() => {
    if (embeddedExpanded) return;

    function onKey(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (!draftPinRef.current) return;
      const step = event.shiftKey ? 10 : 1;
      let next: PdfPoint | null = null;
      const pin = draftPinRef.current;
      if (event.key === "ArrowLeft") next = nudgePin(pin, -step, 0, page);
      if (event.key === "ArrowRight") next = nudgePin(pin, step, 0, page);
      if (event.key === "ArrowDown") next = nudgePin(pin, 0, -step, page);
      if (event.key === "ArrowUp") next = nudgePin(pin, 0, step, page);
      if (!next) return;
      event.preventDefault();
      applyPin(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyPin, page, embeddedExpanded]);

  useEffect(() => {
    if (!expanded || draftPin || placingReferenceAnchor) return;

    function onMove(event: PointerEvent) {
      const gesture = placeGestureRef.current;
      if (!gesture || gesture.moved) return;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (dx * dx + dy * dy < PAN_SLOP_PX * PAN_SLOP_PX) return;
      gesture.moved = true;
      placeGestureRef.current = null;
    }

    function onUp(event: PointerEvent) {
      const gesture = placeGestureRef.current;
      placeGestureRef.current = null;
      if (!gesture || gesture.moved) return;
      placePinFromViewport(event.clientX, event.clientY);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [expanded, draftPin, placingReferenceAnchor, placePinFromViewport]);

  useEffect(() => {
    if (!expanded || !placingReferenceAnchor) return;

    function onMove(event: PointerEvent) {
      const gesture = placeGestureRef.current;
      if (!gesture || gesture.moved) return;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (dx * dx + dy * dy < PAN_SLOP_PX * PAN_SLOP_PX) return;
      gesture.moved = true;
      placeGestureRef.current = null;
    }

    function onUp(event: PointerEvent) {
      const gesture = placeGestureRef.current;
      placeGestureRef.current = null;
      if (!gesture || gesture.moved) return;
      placeReferenceAnchorAtPointer(event.clientX, event.clientY);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [expanded, placingReferenceAnchor, placeReferenceAnchorAtPointer]);

  const screen = pdfRectToCanvas(crop, page.height, scale);
  const cropTone: CropTone = overlayActive ? "overlay" : "crop";
  const activePin = draftPin;
  const activeReferenceAnchor = draftReferenceAnchor;
  const calibrationPlans = useMemo(
    () =>
      pinReferencePlanCandidates(plans).sort(
        (a, b) =>
          a.floorNumber - b.floorNumber || a.name.localeCompare(b.name),
      ),
    [plans],
  );
  const hasReferenceAnchorOnFloor = activeReferenceAnchor != null;
  const needsReferenceAnchorOnFloor =
    calibrationPlan != null &&
    calibrationPlan.id !== plan.id &&
    !hasReferenceAnchorOnFloor;
  const canMarkCalibrationAnchor =
    calibrationPlan == null && planHasPin(plan) && !hasReferenceAnchorOnFloor;

  useEffect(() => {
    setPlacingReferenceAnchor(false);
  }, [plan.id]);

  const discardUnsavedReferenceAnchor = useCallback(() => {
    setDraftReferenceAnchor(
      planHasReferenceAnchor(plan)
        ? { x: plan.referenceAnchorXPt!, y: plan.referenceAnchorYPt! }
        : null,
    );
    setPlacingReferenceAnchor(false);
  }, [plan]);

  const beginReferenceAnchorPlacement = useCallback(() => {
    setPlacingReferenceAnchor(true);
  }, []);

  const beginBuildingPinPlacement = useCallback(() => {
    discardUnsavedReferenceAnchor();
  }, [discardUnsavedReferenceAnchor]);

  const showSuggestedPin =
    suggestedPin != null &&
    (draftPin == null ||
      !pdfPointsEqual(draftPin, suggestedPin));
  const placingPin = showPin && activePin == null && !placingReferenceAnchor;
  const placingAnchor = placingReferenceAnchor;
  const showBuildingPin = showPin && activePin != null;
  const showReferenceAnchorMark =
    showReferenceAnchor && activeReferenceAnchor != null;
  const buildingPinOnPage =
    showBuildingPin && activePin
      ? pdfPointToCanvas(activePin, page.height, scale)
      : null;
  const buildingPinViewport =
    buildingPinOnPage && expanded
      ? panZoomScreenPoint(buildingPinOnPage, view)
      : buildingPinOnPage;
  const referenceAnchorOnPage = showReferenceAnchorMark
    ? pdfPointToCanvas(activeReferenceAnchor!, page.height, scale)
    : null;
  const referenceAnchorViewport =
    referenceAnchorOnPage && expanded
      ? panZoomScreenPoint(referenceAnchorOnPage, view)
      : referenceAnchorOnPage;
  const suggestedPinOnPage =
    showSuggestedPin && suggestedPin
      ? pdfPointToCanvas(suggestedPin, page.height, scale)
      : null;
  const suggestedPinViewport =
    suggestedPinOnPage && expanded
      ? panZoomScreenPoint(suggestedPinOnPage, view)
      : suggestedPinOnPage;
  const registrationLegend: RegistrationLegendItem[] = [];
  if (showBuildingPin) {
    registrationLegend.push({
      color: REGISTRATION_MARK_THIS,
      label: "Building pin",
    });
  }
  if (showReferenceAnchorMark) {
    registrationLegend.push({
      color: REGISTRATION_MARK_REFERENCE,
      label: "Reference anchor",
    });
  }
  if (showSuggestedPin) {
    registrationLegend.push({
      color: REGISTRATION_MARK_SUGGESTED,
      label: "Suggested pin",
    });
  }

  useEffect(() => {
    if (expanded) return;
    const root = pageRef.current;
    if (!root) return;
    const canvas = root.querySelector("canvas");
    if (!canvas) return;
    const syncFromCanvas = () => {
      if (canvas.width === 300 && canvas.height === 150) return;
      if (canvas.width < 2 || canvas.height < 2) return;
      onPdfRendered({
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        pageWidthPt: canvas.width / scale,
        pageHeightPt: canvas.height / scale,
        scale,
      });
    };
    syncFromCanvas();
    const observer = new MutationObserver(syncFromCanvas);
    observer.observe(canvas, {
      attributes: true,
      attributeFilter: ["width", "height"],
    });
    return () => observer.disconnect();
  }, [onPdfRendered, scale, expanded, originalUrl]);

  const onBackgroundPointerDown = (event: React.PointerEvent) => {
    if (!expanded || event.button !== 0) return;
    if (event.ctrlKey) return;
    if (drawingActive) return;
    if (selectionInteractive) {
      onSelectPointerDown(event);
      return;
    }
    if (placingReferenceAnchor) {
      if (draftReferenceAnchorRef.current) return;
      event.preventDefault();
      placeGestureRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: viewRef.current.x,
        originY: viewRef.current.y,
        moved: false,
      };
      return;
    }
    if (draftPinRef.current) return;
    event.preventDefault();
    placeGestureRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
      moved: false,
    };
  };

  const beginDrag = (
    kind: DragKind,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    if (drawingActive) return;
    if (markupSelectable) deselectAnnotations();
    if (placingPin) {
      event.stopPropagation();
      placePinAtPointer(event.clientX, event.clientY);
      return;
    }
    if (kind !== "move" && sizeLocked) {
      setResizeChoiceOpen(true);
      return;
    }
    event.stopPropagation();
    cropLockedToPinRef.current = false;
    setDrag({
      kind,
      startX: event.clientX,
      startY: event.clientY,
      start: cropRef.current,
    });
  };

  const confirmResizeFamily = () => {
    cropLockedToPinRef.current = false;
    setResizeFamily(true);
    setResizeChoiceOpen(false);
    setOverlayEnabled(false);
  };

  const confirmNewFamily = async () => {
    const name = newFamilyName.trim();
    if (!name) return;
    setMovingFamily(true);
    try {
      await onMoveToNewFamily(name);
      setResizeChoiceOpen(false);
      setNewFamilyName("");
    } finally {
      setMovingFamily(false);
    }
  };

  const zoomBy = useCallback(
    (factor: number, originX?: number, originY?: number) => {
      const viewport = viewportRef.current;
      const cx = originX ?? (viewport ? viewport.clientWidth / 2 : 0);
      const cy = originY ?? (viewport ? viewport.clientHeight / 2 : 0);
      setView((current) => zoomAround(current, factor, cx, cy));
    },
    [],
  );

  const resetView = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setView(fitView(viewport, page, scale));
  };

  useEffect(() => {
    if (!expanded || !mounted) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      zoomBy(
        event.deltaY > 0 ? 0.9 : 1.1,
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    }

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [expanded, mounted, zoomBy]);

  const pinnedPlans = plans
    .filter((item) => planHasPin(item))
    .sort(
      (a, b) =>
        a.floorNumber - b.floorNumber || a.name.localeCompare(b.name),
    );

  const zoomToolbar = (
    <FloorPlanZoomToolbar
      zoom={view.zoom}
      onZoomBy={(factor) => zoomBy(factor)}
      onReset={resetView}
    />
  );

  const renderEditorRibbon = (trailing?: React.ReactNode) => (
    <FloorPlanEditorRibbon
      tool={drawTool}
      rectangleVariant={rectangleVariant}
      circleVariant={circleVariant}
      color={strokeColor}
      colorPresets={colorPresets}
      strokeWidthPt={strokeWidthPt}
      annotationCount={annotations.length}
      selectedCount={selectedIndices.length}
      onToolChange={onToolChange}
      onRectangleVariantChange={setRectangleVariant}
      onCircleVariantChange={setCircleVariant}
      onColorChange={setStrokeColor}
      onColorPresetsChange={handleColorPresetsChange}
      onStrokeWidthChange={setStrokeWidthPt}
      onDeleteSelected={handleDeleteSelected}
      onClear={handleClearAnnotations}
      showPin={showPin}
      onShowPinChange={setShowPin}
      showReferenceAnchor={showReferenceAnchor}
      onShowReferenceAnchorChange={setShowReferenceAnchor}
      showReferenceAnchorControl={hasReferenceAnchorOnFloor}
      showCrop={showCrop}
      onShowCropChange={setShowCrop}
      cropAwaitingPin={cropAwaitingPin}
      showLines={showLines}
      onShowLinesChange={setShowLines}
      crossSetLinesAvailable={crossSetLinePlan != null}
      crossSetLinesLabel={crossSetLinesLabel}
      crossSetLinesHasMarkup={crossSetPlanHasMarkup}
      showCrossSetLines={showCrossSetLines}
      onShowCrossSetLinesChange={setShowCrossSetLines}
      overlayPlans={overlayPlans}
      overlayEnabled={overlayEnabled}
      overlayPlanId={overlayPlanId}
      onOverlayEnabled={(value) => {
        setOverlayEnabled(value);
        if (value && !overlayPlans.some((item) => item.id === overlayPlanId)) {
          setOverlayPlanId(defaultOverlayId ?? overlayPlans[0]?.id ?? "");
        }
      }}
      onOverlayPlanId={(id) => {
        setOverlayPlanId(id);
        if (id) setOverlayEnabled(true);
      }}
      lineOverlayPlans={lineOverlayPlans}
      lineOverlayEnabled={lineOverlayEnabled}
      lineOverlayPlanId={lineOverlayPlanId}
      lineOverlayColorFilter={lineOverlayColorFilter}
      onLineOverlayEnabled={(value) => {
        setLineOverlayEnabled(value);
        if (!value) return;
        const nextId = lineOverlayPlans.some(
          (item) => item.id === lineOverlayPlanId,
        )
          ? lineOverlayPlanId
          : (defaultLineOverlayId ?? lineOverlayPlans[0]?.id ?? "");
        if (nextId) setLineOverlayPlanId(nextId);
      }}
      onLineOverlayPlanId={(id) => {
        setLineOverlayPlanId(id);
        if (id) setLineOverlayEnabled(true);
      }}
      onLineOverlayColorFilter={(filter) => {
        setLineOverlayColorFilter(filter);
        if (filter === "all" || filter.length > 0) {
          setLineOverlayEnabled(true);
        } else {
          setLineOverlayEnabled(false);
        }
      }}
      showLineOverlay={lineOverlayPlans.length > 0}
      buildingPinRequiredReason={buildingPinRequiredReason}
      overlayBlockedReason={overlayBlockedReason}
      trailing={trailing}
    />
  );

  const stage = (
    <CropStage
      expanded={expanded}
      view={view}
      pan={pan != null}
      ctrlHeld={ctrlHeld}
      viewportRef={viewportRef}
      pageRef={pageRef}
      page={page}
      scale={scale}
      originalUrl={originalUrl}
      onPdfRendered={onPdfRendered}
      ghostUrl={ghostUrl}
      overlayLayout={overlayLayout}
      overlayOpacity={EDIT_OVERLAY_OPACITY}
      baseOpacity={overlayRenderable ? EDIT_OVERLAY_OPACITY : 1}
      showCrop={cropChromeVisible}
      showLines={showLines}
      placingPin={placingPin}
      placingAnchor={placingAnchor}
      buildingPinViewport={buildingPinViewport}
      buildingPinOnPage={!expanded ? buildingPinOnPage : null}
      referenceAnchorViewport={referenceAnchorViewport}
      referenceAnchorOnPage={!expanded ? referenceAnchorOnPage : null}
      suggestedPinViewport={suggestedPinViewport}
      suggestedPinOnPage={!expanded ? suggestedPinOnPage : null}
      onPinDragStart={beginPinDrag}
      onReferenceAnchorDragStart={beginReferenceAnchorDrag}
      onInlinePlacePin={(event) => {
        if (placingReferenceAnchor) {
          if (markupSelectable) deselectAnnotations();
          placeReferenceAnchorFromClient(
            event.clientX,
            event.clientY,
            event.currentTarget,
          );
          return;
        }
        if (draftPinRef.current) return;
        if (markupSelectable) deselectAnnotations();
        placePinFromClient(event.clientX, event.clientY, event.currentTarget);
      }}
      registrationLegend={registrationLegend}
      markupLegend={markupLegend}
      screen={screen}
      locked={handlesHidden}
      tone={cropTone}
      onExpand={() => onExpandedChange(true)}
      onViewportSize={onViewportSize}
      onBackgroundPointerDown={onBackgroundPointerDown}
      onBeginDrag={beginDrag}
      drawingActive={drawingActive}
      markupSelectable={markupSelectable}
      selectionInteractive={selectionInteractive}
      annotations={annotations}
      selectedIndices={selectedIndices}
      selectionDraft={selectionDraft}
      lineDraft={lineDraft}
      boundingBoxDraft={boundingBoxDraft}
      cutDraft={cutDraft}
      connectDraftIndex={connectDraftIndex}
      connectHoverIndex={connectHoverIndex}
      hoverSnap={hoverSnap}
      hoverVertex={hoverVertex}
      vertexDrag={vertexDrag}
      draftColor={strokeColor}
      draftStrokeWidthPt={strokeWidthPt}
      onDrawPointerDown={onDrawPointerDown}
      onDrawPointerMove={onDrawPointerMove}
      onDrawPointerUp={onDrawPointerUp}
      onSelectPointerDown={onSelectPointerDown}
      onSelectPointerMove={onSelectPointerMove}
      onSelectPointerUp={onSelectPointerUp}
      onVertexPointerDown={onVertexPointerDown}
      onAnnotationSelect={onAnnotationSelect}
      onDeselectAnnotations={deselectAnnotations}
      overlayAnnotations={overlayAnnotations}
      lineOverlayOpacity={LINE_OVERLAY_OPACITY}
      showLineOverlayAnnotations={
        lineOverlayEnabled || showCrossSetLines
      }
    />
  );

  const saveRow = (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
      {importableOverlayAnnotations.length > 0 ? (
        <button
          type="button"
          disabled={saving || savingAnnotations || savingLines}
          onClick={() => void handleImportOverlayLines()}
          title="Add aligned line markup from the overlay floor to this floor (keeps existing lines)"
          className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-900 hover:bg-violet-100 disabled:opacity-60"
        >
          {savingLines ? "Saving overlay…" : "Add overlay lines"}
        </button>
      ) : null}
      {annotationsDirty ? (
        <button
          type="button"
          disabled={saving || savingAnnotations || savingLines}
          onClick={() => void handleSaveAnnotations()}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {savingAnnotations || savingLines ? "Saving lines…" : "Save lines"}
        </button>
      ) : null}
      {cropChromeVisible ? (
        <>
          <span>
            {crop.width.toFixed(1)} × {crop.height.toFixed(1)} pt at (
            {crop.x.toFixed(1)}, {crop.y.toFixed(1)})
          </span>
          <button
            type="button"
            disabled={saving || !cropDraftIsDirty(plan, family, crop)}
            onClick={() => onSave(crop)}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? "Saving crop…" : "Save crop"}
          </button>
        </>
      ) : null}
      {showPin ? (
        <>
          {draftPin ? (
            <span>
              Pin at ({draftPin.x.toFixed(1)}, {draftPin.y.toFixed(1)}) pt
            </span>
          ) : placingReferenceAnchor ? (
            <span className="max-w-md text-slate-700">
              Click the same structural feature on this floor as on{" "}
              {calibrationPlan ? floorPlanLabel(calibrationPlan) : "the calibration floor"}{" "}
              (gray crosshair). An amber pin shows where the building pin belongs, or
              you can place the building pin directly.
            </span>
          ) : (
            <span className="max-w-md font-medium text-amber-900">
              Click the drawing to place the building pin (red crosshair).
            </span>
          )}
          {showSuggestedPin && suggestedPin ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                applyPin(suggestedPin);
                onSavePin(suggestedPin);
              }}
              title="Place the building pin from reference-anchor calibration and save it"
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
            >
              {saving ? "Saving pin…" : "Apply suggested pin"}
            </button>
          ) : null}
          {!draftPin && needsReferenceAnchorOnFloor ? (
            placingReferenceAnchor ? (
              <button
                type="button"
                disabled={saving}
                onClick={beginBuildingPinPlacement}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                Place building pin instead
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={beginReferenceAnchorPlacement}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                Calibrate with reference anchor
              </button>
            )
          ) : null}
          <button
            type="button"
            disabled={saving || !pinDraftIsDirty(plan, draftPin)}
            onClick={() => draftPin && onSavePin(draftPin)}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving
              ? "Saving pin…"
              : isRegistration || !buildingPinned
                ? "Save building pin"
                : "Save this floor's pin"}
          </button>
        </>
      ) : null}
      {draftReferenceAnchor ? (
        <>
          <span>
            Anchor at ({draftReferenceAnchor.x.toFixed(1)},{" "}
            {draftReferenceAnchor.y.toFixed(1)}) pt
          </span>
          {!draftPin ? (
            <button
              type="button"
              disabled={saving}
              onClick={beginBuildingPinPlacement}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            >
              Place building pin instead
            </button>
          ) : null}
          <button
            type="button"
            disabled={saving || !referenceAnchorDraftIsDirty(plan, draftReferenceAnchor)}
            onClick={() =>
              draftReferenceAnchor && onSaveReferenceAnchor(draftReferenceAnchor)
            }
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? "Saving anchor…" : "Save reference anchor"}
          </button>
        </>
      ) : canMarkCalibrationAnchor ? (
        placingReferenceAnchor ? (
          <span className="max-w-md text-slate-700">
            Click a structural feature that is visible on every floor (e.g. elevator
            shaft corner). This pairs with your building pin to calibrate other floors.
          </span>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={beginReferenceAnchorPlacement}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            Mark structural reference
          </button>
        )
      ) : null}
      {onSetPinReferencePlan && calibrationPlans.length > 1 ? (
        <label className="inline-flex items-center gap-2 text-sm">
          Calibration floor
          <select
            value={settings.pinReferencePlanId ?? calibrationPlan?.id ?? ""}
            disabled={settingPinReference}
            onChange={(event) => {
              const planId = event.target.value;
              if (!planId) return;
              setSettingPinReference(true);
              void onSetPinReferencePlan(planId).finally(() =>
                setSettingPinReference(false),
              );
            }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-50"
            aria-label="Calibration floor for reference-anchor pin offset"
          >
            {calibrationPlans.map((item) => {
              const familyName =
                families.find((entry) => entry.id === item.familyId)?.name ??
                family.name;
              return (
                <option key={item.id} value={item.id}>
                  {familyName} · {floorPlanLabel(item)}
                </option>
              );
            })}
          </select>
        </label>
      ) : null}
      {onSetRegistrationPlan && pinnedPlans.length > 1 ? (
        <label className="inline-flex items-center gap-2 text-sm">
          Reference floor
          <select
            value={settings.registrationPlanId ?? plan.id}
            disabled={settingReference}
            onChange={(event) => {
              const planId = event.target.value;
              if (!planId) return;
              setSettingReference(true);
              void onSetRegistrationPlan(planId).finally(() =>
                setSettingReference(false),
              );
            }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-50"
            aria-label="Reference floor for building pin"
          >
            {pinnedPlans.map((item) => {
              const familyName =
                families.find((entry) => entry.id === item.familyId)?.name ??
                family.name;
              return (
                <option key={item.id} value={item.id}>
                  {familyName} · {floorPlanLabel(item)}
                </option>
              );
            })}
          </select>
        </label>
      ) : null}
    </div>
  );

  const inlineEditor = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {renderEditorRibbon()}
      {stage}
      {saveRow}
    </div>
  );

  const resizeChoiceDialog =
    mounted &&
    resizeChoiceOpen &&
    createPortal(
      <ResizeFamilyChoiceDialog
        familyName={family.name}
        newFamilyName={newFamilyName}
        onNewFamilyName={setNewFamilyName}
        onResizeFamily={confirmResizeFamily}
        onCreateFamily={() => void confirmNewFamily()}
        onClose={() => setResizeChoiceOpen(false)}
        busy={movingFamily}
      />,
      document.body,
    );

  if (!expanded) {
    return (
      <>
        {inlineEditor}
        {resizeChoiceDialog}
      </>
    );
  }

  if (embeddedExpanded) {
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
          {renderEditorRibbon(zoomToolbar)}
          <div className="min-h-0 flex-1">{stage}</div>
          {saveRow}
        </div>
        {resizeChoiceDialog}
      </>
    );
  }

  const modal =
    mounted &&
    createPortal(
      <div className="fixed inset-0 z-[100] flex flex-col bg-white">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="floor-plan-crop-fullscreen-title"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2">
            <p
              id="floor-plan-crop-fullscreen-title"
              className="min-w-0 shrink-0 truncate text-sm font-semibold text-slate-900"
            >
              Crop {floorPlanLabel(plan)}
            </p>
            <div className="min-w-0 flex-1">{renderEditorRibbon(zoomToolbar)}</div>
            <button
              type="button"
              onClick={() => onExpandedChange(false)}
              className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              aria-label="Exit full screen"
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1">{stage}</div>
          <div className="shrink-0 border-t border-slate-200 px-4 py-3">
            {saveRow}
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <p className="text-sm text-slate-500">Editing in full screen…</p>
      </div>
      {modal}
      {resizeChoiceDialog}
    </>
  );
}

function CropStage({
  expanded,
  view,
  pan,
  ctrlHeld,
  viewportRef,
  pageRef,
  page,
  scale,
  originalUrl,
  onPdfRendered,
  ghostUrl,
  overlayLayout,
  overlayOpacity,
  baseOpacity,
  showCrop,
  showLines,
  placingPin,
  placingAnchor,
  buildingPinViewport,
  buildingPinOnPage,
  referenceAnchorViewport,
  referenceAnchorOnPage,
  suggestedPinViewport,
  suggestedPinOnPage,
  onPinDragStart,
  onReferenceAnchorDragStart,
  onInlinePlacePin,
  registrationLegend,
  markupLegend,
  screen,
  locked,
  tone,
  onExpand,
  onViewportSize,
  onBackgroundPointerDown,
  onBeginDrag,
  drawingActive,
  markupSelectable,
  selectionInteractive,
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
  draftColor,
  draftStrokeWidthPt,
  onDrawPointerDown,
  onDrawPointerMove,
  onDrawPointerUp,
  onSelectPointerDown,
  onSelectPointerMove,
  onSelectPointerUp,
  onVertexPointerDown,
  onAnnotationSelect,
  onDeselectAnnotations,
  overlayAnnotations,
  lineOverlayOpacity,
  showLineOverlayAnnotations,
}: {
  expanded: boolean;
  view: ViewTransform;
  pan: boolean;
  ctrlHeld: boolean;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  pageRef: React.RefObject<HTMLDivElement | null>;
  page: PdfSize;
  scale: number;
  originalUrl: string;
  onPdfRendered: (info: PdfPageRenderInfo) => void;
  ghostUrl: string | null;
  overlayLayout: EditOverlayPlateLayout | null;
  overlayOpacity: number;
  baseOpacity: number;
  showCrop: boolean;
  showLines: boolean;
  placingPin: boolean;
  placingAnchor: boolean;
  buildingPinViewport: { x: number; y: number } | null;
  buildingPinOnPage: { x: number; y: number } | null;
  referenceAnchorViewport: { x: number; y: number } | null;
  referenceAnchorOnPage: { x: number; y: number } | null;
  suggestedPinViewport: { x: number; y: number } | null;
  suggestedPinOnPage: { x: number; y: number } | null;
  onPinDragStart: (event: React.PointerEvent) => void;
  onReferenceAnchorDragStart: (event: React.PointerEvent) => void;
  onInlinePlacePin: (event: React.MouseEvent<HTMLDivElement>) => void;
  registrationLegend: RegistrationLegendItem[];
  markupLegend: RegistrationLegendItem[];
  screen: { x: number; y: number; width: number; height: number };
  locked: boolean;
  tone: CropTone;
  onExpand: () => void;
  onViewportSize: (width: number, height: number) => void;
  onBackgroundPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onBeginDrag: (
    kind: DragKind,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  drawingActive: boolean;
  markupSelectable: boolean;
  selectionInteractive: boolean;
  annotations: FloorPlanAnnotation[];
  selectedIndices: number[];
  selectionDraft: SelectionDraft | null;
  lineDraft: LineDraft | null;
  boundingBoxDraft: BoundingBoxDraft | null;
  cutDraft: CutDraft | null;
  connectDraftIndex: number | null;
  connectHoverIndex: number | null;
  hoverSnap: SnapResult | null;
  hoverVertex: VertexHover | null;
  vertexDrag: VertexDragDraft | null;
  draftColor: string;
  draftStrokeWidthPt: number;
  onDrawPointerDown: (event: React.PointerEvent<SVGSVGElement>) => void;
  onDrawPointerMove: (event: React.PointerEvent<SVGSVGElement>) => void;
  onDrawPointerUp: (event: React.PointerEvent<SVGSVGElement>) => void;
  onSelectPointerDown: (event: React.PointerEvent) => void;
  onSelectPointerMove: (event: React.PointerEvent) => void;
  onSelectPointerUp: (event: React.PointerEvent) => void;
  onVertexPointerDown: (
    annotationIndex: number,
    pointIndex: number,
    event: React.PointerEvent<SVGRectElement>,
  ) => void;
  onAnnotationSelect: (
    index: number,
    event: React.PointerEvent<SVGPathElement>,
  ) => void;
  onDeselectAnnotations: () => void;
  overlayAnnotations: FloorPlanAnnotation[];
  lineOverlayOpacity: number;
  showLineOverlayAnnotations: boolean;
}) {
  const pageSize = {
    width: page.width * scale,
    height: page.height * scale,
  };
  const VIEWPORT_SIZE_EPS_PX = 16;
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!expanded) return;
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
      onViewportSize(width, height);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [expanded, viewportRef, onViewportSize]);

  const pinMark = (
    coords: { x: number; y: number },
    color: string,
    draggable: boolean,
    onDragStart?: (event: React.PointerEvent) => void,
  ) => (
    <div
      className={`absolute ${draggable ? "pointer-events-auto z-20" : "pointer-events-none"}`}
      style={{ left: coords.x, top: coords.y }}
    >
      {draggable && onDragStart ? (
        <div
          className="absolute -left-4 -top-4 h-8 w-8 cursor-move"
          onPointerDown={onDragStart}
          aria-label="Drag to reposition mark"
        />
      ) : null}
      <FloorPlanRegistrationMark
        x={0}
        y={0}
        color={color}
        className="relative"
      />
    </div>
  );

  const annotationLayer = (
    <FloorPlanAnnotationLayer
      pageWidth={page.width}
      pageHeight={page.height}
      scale={scale}
      zoom={expanded ? view.zoom : 1}
      overlayAnnotations={overlayAnnotations}
      overlayOpacity={lineOverlayOpacity}
      annotations={annotations}
      showSavedAnnotations={showLines}
      showOverlayAnnotations={showLineOverlayAnnotations}
      selectedIndices={selectedIndices}
      selectionDraft={selectionDraft}
      lineDraft={lineDraft}
      boundingBoxDraft={boundingBoxDraft}
      cutDraft={cutDraft}
      connectDraftIndex={connectDraftIndex}
      connectHoverIndex={connectHoverIndex}
      hoverSnap={hoverSnap}
      hoverVertex={hoverVertex}
      vertexDrag={vertexDrag}
      draftColor={draftColor}
      draftStrokeWidthPt={draftStrokeWidthPt}
      drawInteractive={drawingActive}
      selectInteractive={selectionInteractive && showLines}
      selectable={markupSelectable && showLines}
      onPointerDown={onDrawPointerDown}
      onPointerMove={onDrawPointerMove}
      onPointerUp={onDrawPointerUp}
      onSelectPointerDown={onSelectPointerDown}
      onSelectPointerMove={onSelectPointerMove}
      onSelectPointerUp={onSelectPointerUp}
      onVertexPointerDown={onVertexPointerDown}
      onAnnotationSelect={onAnnotationSelect}
    />
  );

  const overlayLayer =
    ghostUrl && overlayLayout ? (
      <div
        className="pointer-events-none absolute"
        style={{
          left: screen.x + overlayLayout.offset.x,
          top: screen.y + overlayLayout.offset.y,
          width: overlayLayout.width,
          height: overlayLayout.height,
        }}
      >
        <FloorPlanPdfCanvas
          url={ghostUrl}
          scale={overlayLayout.scale}
          opacity={overlayOpacity}
        />
      </div>
    ) : null;

  const overlay = (
    <>
      {overlayLayer}
      {buildingPinOnPage && !drawingActive
        ? pinMark(buildingPinOnPage, true)
        : null}
      {!expanded && showCrop ? (
        <CropChrome
          rect={screen}
          locked={locked}
          showHandles
          grab={false}
          placingPin={placingPin && !drawingActive}
          tone={tone}
          onBeginDrag={onBeginDrag}
          pointerEvents={drawingActive ? "none" : "auto"}
        />
      ) : null}
      {!expanded ? annotationLayer : null}
    </>
  );

  const cropPointerEvents = drawingActive ? "none" : "auto";

  const cropChrome =
    showCrop ? (
      <CropChrome
        rect={expanded ? panZoomScreenRect(screen, view) : screen}
        locked={locked}
        showHandles
        grab={false}
        placingPin={placingPin && !drawingActive}
        tone={tone}
        onBeginDrag={onBeginDrag}
        pointerEvents={cropPointerEvents}
      />
    ) : null;

  const viewportMarks = expanded
    ? !drawingActive
      ? (
          <>
            {referenceAnchorViewport
              ? pinMark(
                  referenceAnchorViewport,
                  REGISTRATION_MARK_REFERENCE,
                  true,
                  onReferenceAnchorDragStart,
                )
              : null}
            {suggestedPinViewport
              ? pinMark(suggestedPinViewport, REGISTRATION_MARK_SUGGESTED, false)
              : null}
            {buildingPinViewport
              ? pinMark(
                  buildingPinViewport,
                  REGISTRATION_MARK_THIS,
                  true,
                  onPinDragStart,
                )
              : null}
          </>
        )
      : null
    : null;

  const inlineMarks = !expanded ? (
    <>
      {referenceAnchorOnPage
        ? pinMark(
            referenceAnchorOnPage,
            REGISTRATION_MARK_REFERENCE,
            true,
            onReferenceAnchorDragStart,
          )
        : null}
      {suggestedPinOnPage
        ? pinMark(suggestedPinOnPage, REGISTRATION_MARK_SUGGESTED, false)
        : null}
      {buildingPinOnPage
        ? pinMark(buildingPinOnPage, REGISTRATION_MARK_THIS, true, onPinDragStart)
        : null}
    </>
  ) : null;

  const stageLegend =
    registrationLegend.length > 0 || markupLegend.length > 0 ? (
      <div className="absolute left-2 top-2 z-20 flex flex-col gap-2">
        {registrationLegend.length > 0 ? (
          <FloorPlanRegistrationLegend items={registrationLegend} />
        ) : null}
        {markupLegend.length > 0 ? (
          <FloorPlanMarkupLegend items={markupLegend} />
        ) : null}
      </div>
    ) : null;

  if (!expanded) {
    return (
      <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-slate-100">
        <button
          type="button"
          onClick={onExpand}
          className="absolute right-2 top-2 z-10 rounded-lg border border-slate-200 bg-white/95 p-1.5 text-slate-700 shadow-sm hover:bg-white"
          aria-label="Expand crop editor"
          title="Full screen"
        >
          <FloorPlanExpandIcon />
        </button>
        {stageLegend}
        <div
          ref={pageRef}
          className={`relative ${
            (placingPin || placingAnchor) && !drawingActive
              ? "cursor-crosshair"
              : drawingActive
                ? "cursor-crosshair"
                : markupSelectable
                  ? "cursor-default"
                  : ""
          }`}
          style={pageSize}
          onPointerDown={(event) => {
            if (event.button !== 0 || !selectionInteractive) return;
            onSelectPointerDown(event);
          }}
          onPointerMove={
            selectionInteractive ? onSelectPointerMove : undefined
          }
          onPointerUp={selectionInteractive ? onSelectPointerUp : undefined}
          onClick={
            (placingPin || placingAnchor) && !drawingActive
              ? onInlinePlacePin
              : undefined
          }
        >
          <FloorPlanPdfCanvas
            url={originalUrl}
            scale={scale}
            opacity={baseOpacity}
            onRendered={onPdfRendered}
          />
          {overlay}
          {inlineMarks}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className={`relative h-full overflow-hidden bg-slate-200 ${
        pan
          ? "cursor-grabbing"
          : ctrlHeld
            ? "cursor-grab"
            : drawingActive || placingPin || placingAnchor
              ? "cursor-crosshair"
              : markupSelectable
                ? "cursor-default"
                : "cursor-default"
      }`}
      style={{ touchAction: "none" }}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={selectionInteractive ? onSelectPointerMove : undefined}
      onPointerUp={selectionInteractive ? onSelectPointerUp : undefined}
    >
      <div
        className="pointer-events-none absolute left-0 top-0"
        style={{
          width: pageSize.width,
          height: pageSize.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          transformOrigin: "0 0",
        }}
      >
        <FloorPlanPdfCanvas
          url={originalUrl}
          scale={scale}
          opacity={baseOpacity}
        />
      </div>
      <div style={{ opacity: baseOpacity }}>
        <FloorPlanPdfClipCanvas
          url={originalUrl}
          view={view}
          layoutScale={scale}
          viewportWidth={viewportSize.width}
          viewportHeight={viewportSize.height}
        />
      </div>
      <div
        className="absolute left-0 top-0 z-10 pointer-events-none"
        style={{
          width: pageSize.width,
          height: pageSize.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          transformOrigin: "0 0",
        }}
      >
        <div ref={pageRef} className="relative" style={pageSize}>
          {overlay}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 z-20">
        {viewportMarks}
        {cropChrome}
        <div
          className="pointer-events-none absolute left-0 top-0 z-[25]"
          style={{
            width: pageSize.width,
            height: pageSize.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <div className="relative" style={pageSize}>
            {annotationLayer}
          </div>
        </div>
      </div>
      {stageLegend}
    </div>
  );
}

const CROP_TONE_CLASS: Record<CropTone, { box: string; handle: string }> = {
  crop: {
    box: "border-2 border-sky-500 bg-sky-500/10",
    handle: "border border-white bg-sky-600",
  },
  overlay: {
    box: "border-2 border-violet-500 bg-violet-500/10",
    handle: "border border-white bg-violet-600",
  },
};

function CropChrome({
  rect,
  locked,
  showHandles,
  grab,
  placingPin,
  tone,
  onBeginDrag,
  pointerEvents = "auto",
}: {
  rect: { x: number; y: number; width: number; height: number };
  locked: boolean;
  showHandles: boolean;
  grab: boolean;
  placingPin: boolean;
  tone: CropTone;
  onBeginDrag: (
    kind: DragKind,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  pointerEvents?: "auto" | "none";
}) {
  return (
    <div
      className={`absolute ${pointerEvents === "auto" ? "pointer-events-auto" : "pointer-events-none"} ${CROP_TONE_CLASS[tone].box} ${
        placingPin ? "cursor-crosshair" : grab ? "cursor-grab" : "cursor-move"
      }`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
      onPointerDown={(event) => onBeginDrag("move", event)}
    >
      {showHandles
        ? HANDLE_KINDS.map((kind) => (
            <Handle
              key={kind}
              kind={kind}
              tone={tone}
              onPointerDown={onBeginDrag}
            />
          ))
        : null}
    </div>
  );
}

function Handle({
  kind,
  tone,
  onPointerDown,
}: {
  kind: HandleKind;
  tone: CropTone;
  onPointerDown: (
    kind: DragKind,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
}) {
  const label =
    kind === "e" || kind === "w"
      ? "Resize crop width"
      : kind === "n" || kind === "s"
        ? "Resize crop height"
        : "Resize crop corner";
  return (
    <div
      aria-label={label}
      className={`absolute h-3 w-3 rounded-sm ${CROP_TONE_CLASS[tone].handle} ${HANDLE_CLASS[kind]}`}
      onPointerDown={(event) => onPointerDown(kind, event)}
    />
  );
}

function ResizeFamilyChoiceDialog({
  familyName,
  newFamilyName,
  onNewFamilyName,
  onResizeFamily,
  onCreateFamily,
  onClose,
  busy,
}: {
  familyName: string;
  newFamilyName: string;
  onNewFamilyName: (value: string) => void;
  onResizeFamily: () => void;
  onCreateFamily: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="floor-plan-resize-family-title"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2
          id="floor-plan-resize-family-title"
          className="text-base font-semibold text-slate-900"
        >
          Change crop size
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          This sheet is in the <span className="font-medium">{familyName}</span>{" "}
          family, which uses a fixed crop size shared by every floor in the
          family. How do you want to proceed?
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onResizeFamily}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-60"
          >
            <span className="font-medium text-slate-900">Resize the family</span>
            <span className="mt-0.5 block text-slate-600">
              Change the crop for every floor in {familyName}. Saving updates all
              cropped siblings.
            </span>
          </button>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-900">
              Move to a new family
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Keep other floors on the current crop size. This sheet gets its own
              family with a different crop.
            </p>
            <label className="mt-3 block text-sm text-slate-700">
              New family name
              <input
                type="text"
                value={newFamilyName}
                disabled={busy}
                onChange={(event) => onNewFamilyName(event.target.value)}
                placeholder="e.g. Ground floor (large plate)"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:opacity-60"
              />
            </label>
            <button
              type="button"
              disabled={busy || !newFamilyName.trim()}
              onClick={onCreateFamily}
              className="mt-3 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {busy ? "Moving sheet…" : "Create family & move sheet"}
            </button>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="mt-4 text-sm text-slate-500 hover:text-slate-800 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function FloorPlanExpandIcon({
  className = "h-4 w-4",
}: {
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        d="M2.5 6.5V2.5H6.5M13.5 6.5V2.5H9.5M2.5 9.5v4H6.5M13.5 9.5v4H9.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
