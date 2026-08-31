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
  clampPin,
  buildingHasPin,
  planHasPin,
  nudgePin,
  pdfPointToCanvas,
  canvasPointToPdf,
  panZoomScreenPoint,
  panZoomViewportToPage,
  type PdfPanZoom,
  type PdfPoint,
} from "@/lib/building/floor-plan-align";
import {
  floorPlanFileUrl,
  floorPlanLabel,
  type FloorPlanDto,
  type FloorPlanFamilyDto,
  type FloorPlanSettingsDto,
} from "@/lib/building/floor-plan-shared";

import { FloorPlanExpandIcon } from "./FloorPlanCropEditor";
import {
  FloorPlanRegistrationLegend,
  FloorPlanRegistrationMark,
  REGISTRATION_MARK_THIS,
  type RegistrationLegendItem,
} from "./FloorPlanRegistrationMark";
import { FloorPlanPdfCanvas, FloorPlanPdfClipCanvas } from "./FloorPlanPdfCanvas";
import { FloorPlanZoomToolbar } from "./FloorPlanZoomToolbar";
import { usePdfSession } from "@/lib/pdf/use-pdf-session";

const IDENTITY_VIEW: PdfPanZoom = { x: 0, y: 0, zoom: 1 };
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 16;
const FIT_PAD = 48;
const PAN_SLOP_PX = 4;

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

export function FloorPlanPinEditor({
  plan,
  family,
  settings,
  plans,
  families,
  scale,
  onSave,
  onSetRegistrationPlan,
  saving,
  expanded,
  onExpandedChange,
  embeddedExpanded = false,
  onSwitchToCrop,
}: {
  plan: FloorPlanDto;
  family: FloorPlanFamilyDto;
  settings: FloorPlanSettingsDto;
  plans: FloorPlanDto[];
  families: FloorPlanFamilyDto[];
  scale: number;
  onSave: (pin: PdfPoint) => void;
  onSetRegistrationPlan?: (planId: string) => Promise<void>;
  saving: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  embeddedExpanded?: boolean;
  onSwitchToCrop?: () => void;
}) {
  const width = plan.originalPageWidthPt;
  const height = plan.originalPageHeightPt;
  const url = useMemo(
    () => floorPlanFileUrl(plan.id, "original", plan.updatedAt),
    [plan.id, plan.updatedAt],
  );
  usePdfSession(true, [url]);
  const buildingPinned = buildingHasPin(settings);
  const isRegistration =
    settings.registrationPlanId == null || settings.registrationPlanId === plan.id;
  const [draftPin, setDraftPin] = useState<PdfPoint | null>(() =>
    planHasPin(plan) ? { x: plan.pinXPt!, y: plan.pinYPt! } : null,
  );
  const pin = draftPin;
  const editable = true;
  const [settingReference, setSettingReference] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<PdfPanZoom>(IDENTITY_VIEW);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [panning, setPanning] = useState(false);
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    setDraftPin(
      planHasPin(plan) ? { x: plan.pinXPt!, y: plan.pinYPt! } : null,
    );
  }, [plan.pinXPt, plan.pinYPt, plan.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (expanded && event.key === "Escape") {
        event.preventDefault();
        onExpandedChange(false);
        return;
      }
      if (!editable || !pin) return;
      const step = event.shiftKey ? 10 : 1;
      let next: PdfPoint | null = null;
      if (event.key === "ArrowLeft") next = nudgePin(pin, -step, 0, { width, height });
      if (event.key === "ArrowRight") next = nudgePin(pin, step, 0, { width, height });
      if (event.key === "ArrowDown") next = nudgePin(pin, 0, -step, { width, height });
      if (event.key === "ArrowUp") next = nudgePin(pin, 0, step, { width, height });
      if (!next) return;
      event.preventDefault();
      setDraftPin(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pin, width, height, expanded, onExpandedChange, editable]);

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
  const pageForFitRef = useRef({ width, height });
  pageForFitRef.current = { width, height };
  const scaleForFitRef = useRef(scale);
  scaleForFitRef.current = scale;

  useEffect(() => {
    if (expanded) return;
    setView(IDENTITY_VIEW);
    fittedForExpandRef.current = false;
    gestureRef.current = null;
    setPanning(false);
  }, [expanded]);

  const onViewportSize = useCallback((nextWidth: number, nextHeight: number) => {
    if (!expanded || fittedForExpandRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport || nextWidth < 2 || nextHeight < 2) return;
    setView(fitView(viewport, pageForFitRef.current, scaleForFitRef.current));
    fittedForExpandRef.current = true;
  }, [expanded]);

  const placePinFromClient = useCallback(
    (clientX: number, clientY: number, pageEl: HTMLElement) => {
      if (!editable) return;
      const bounds = pageEl.getBoundingClientRect();
      const next = clampPin(
        canvasPointToPdf(
          {
            x: clientX - bounds.left,
            y: clientY - bounds.top,
          },
          height,
          scale,
        ),
        { width, height },
      );
      setDraftPin(next);
    },
    [editable, height, scale, width],
  );

  const placePinFromViewport = useCallback(
    (clientX: number, clientY: number) => {
      if (!editable) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const bounds = viewport.getBoundingClientRect();
      const pagePoint = panZoomViewportToPage(
        {
          x: clientX - bounds.left,
          y: clientY - bounds.top,
        },
        viewRef.current,
      );
      setDraftPin(
        clampPin(canvasPointToPdf(pagePoint, height, scale), { width, height }),
      );
    },
    [editable, height, scale, width],
  );

  useEffect(() => {
    if (!expanded) return;

    function onMove(event: PointerEvent) {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (!gesture.moved && dx * dx + dy * dy < PAN_SLOP_PX * PAN_SLOP_PX) {
        return;
      }
      gesture.moved = true;
      setPanning(true);
      setView({
        zoom: viewRef.current.zoom,
        x: gesture.originX + dx,
        y: gesture.originY + dy,
      });
    }

    function onUp(event: PointerEvent) {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      setPanning(false);
      if (!gesture || gesture.moved) return;
      placePinFromViewport(event.clientX, event.clientY);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [expanded, placePinFromViewport]);

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
    setView(fitView(viewport, { width, height }, scale));
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

  const pinCanvas = pin ? pdfPointToCanvas(pin, height, scale) : null;
  const pinScreen =
    pinCanvas && expanded ? panZoomScreenPoint(pinCanvas, view) : pinCanvas;

  const registrationLegend: RegistrationLegendItem[] = [];
  if (pin) {
    registrationLegend.push({
      color: REGISTRATION_MARK_THIS,
      label: "Building pin",
    });
  }

  const registrationLabel = settings.registrationLabel;
  const pinnedPlans = plans
    .filter((item) => planHasPin(item))
    .sort(
      (a, b) =>
        a.floorNumber - b.floorNumber || a.name.localeCompare(b.name),
    );

  const instruction = (
    <p className="text-sm text-slate-600">
      {!buildingPinned || isRegistration ? (
        <>
          Click to place the building pin on this PDF
          {registrationLabel ? (
            <>
              {" "}
              at{" "}
              <span className="font-medium text-slate-800">{registrationLabel}</span>
            </>
          ) : null}
          . This is the one pin for the building — every other floor is placed
          relative to it. Crop after the pin is set. Arrow keys nudge 1 pt
          (Shift = 10).
        </>
      ) : (
        <>
          Click the same registration point
          {registrationLabel ? (
            <>
              {" "}
              (
              <span className="font-medium text-slate-800">{registrationLabel}</span>
              )
            </>
          ) : null}{" "}
          on this PDF. The building pin stays put; this places the drawing
          relative to it. Then{" "}
          {onSwitchToCrop ? (
            <button
              type="button"
              onClick={onSwitchToCrop}
              className="font-medium text-sky-700 underline decoration-sky-300 hover:text-sky-900"
            >
              crop
            </button>
          ) : (
            "crop"
          )}{" "}
          the plate. Arrow keys nudge 1 pt (Shift = 10).
        </>
      )}
    </p>
  );

  const saveRow = (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
      <span>
        {pin
          ? `Pin on this PDF at (${pin.x.toFixed(1)}, ${pin.y.toFixed(1)}) pt`
          : "No pin on this PDF yet"}
      </span>
      <button
        type="button"
        disabled={saving || !pin}
        onClick={() => pin && onSave(pin)}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {saving
          ? "Saving pin…"
          : isRegistration || !buildingPinned
            ? "Save building pin"
            : "Save this floor’s pin"}
      </button>
      {onSetRegistrationPlan && pinnedPlans.length > 1 ? (
        <label className="inline-flex items-center gap-2">
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

  const stage = (
    <PinStage
      expanded={expanded}
      view={view}
      panning={panning}
      editable={editable}
      viewportRef={viewportRef}
      url={url}
      scale={scale}
      width={width}
      height={height}
      pinScreen={pinScreen}
      registrationLegend={registrationLegend}
      onExpand={() => onExpandedChange(true)}
      onViewportSize={onViewportSize}
      onInlineClick={(event) => {
        placePinFromClient(
          event.clientX,
          event.clientY,
          event.currentTarget,
        );
      }}
      onBackgroundPointerDown={(event) => {
        if (!expanded || event.button !== 0) return;
        event.preventDefault();
        gestureRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          originX: viewRef.current.x,
          originY: viewRef.current.y,
          moved: false,
        };
      }}
    />
  );

  if (!expanded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {instruction}
        {stage}
        {saveRow}
      </div>
    );
  }

  if (embeddedExpanded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">{instruction}</div>
          <FloorPlanZoomToolbar
            zoom={view.zoom}
            onZoomBy={(factor) => zoomBy(factor)}
            onReset={resetView}
          />
        </div>
        <div className="min-h-0 flex-1">{stage}</div>
        {saveRow}
      </div>
    );
  }

  const modal =
    mounted &&
    createPortal(
      <div className="fixed inset-0 z-[100] flex flex-col bg-white">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="floor-plan-pin-fullscreen-title"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-2">
            <div className="min-w-0 flex-1">
              <p
                id="floor-plan-pin-fullscreen-title"
                className="truncate text-sm font-semibold text-slate-900"
              >
                Building pin — {floorPlanLabel(plan)}
              </p>
              <p className="truncate text-xs text-slate-500">
                {isRegistration || !buildingPinned
                  ? "Click to place the building pin on this PDF · Drag to pan · Scroll to zoom"
                  : "Click the same point on this PDF · Drag to pan · Scroll to zoom"}
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => zoomBy(1 / 1.25)}
                className="rounded-md px-2 py-1 text-sm font-medium text-slate-700 hover:bg-white"
                aria-label="Zoom out"
              >
                −
              </button>
              <span className="min-w-14 px-1 text-center text-xs tabular-nums text-slate-600">
                {Math.round(view.zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => zoomBy(1.25)}
                className="rounded-md px-2 py-1 text-sm font-medium text-slate-700 hover:bg-white"
                aria-label="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                onClick={resetView}
                className="rounded-md px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white"
              >
                Fit
              </button>
            </div>
            <button
              type="button"
              onClick={() => onExpandedChange(false)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
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
    </>
  );
}

function PinStage({
  expanded,
  view,
  panning,
  editable,
  viewportRef,
  url,
  scale,
  width,
  height,
  pinScreen,
  registrationLegend,
  onExpand,
  onViewportSize,
  onInlineClick,
  onBackgroundPointerDown,
}: {
  expanded: boolean;
  view: PdfPanZoom;
  panning: boolean;
  editable: boolean;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  url: string;
  scale: number;
  width: number;
  height: number;
  pinScreen: { x: number; y: number } | null;
  registrationLegend: RegistrationLegendItem[];
  onExpand: () => void;
  onViewportSize: (width: number, height: number) => void;
  onInlineClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onBackgroundPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const pageSize = {
    width: width * scale,
    height: height * scale,
  };
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!expanded) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const sync = () => {
      const nextWidth = viewport.clientWidth;
      const nextHeight = viewport.clientHeight;
      setViewportSize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) return prev;
        return { width: nextWidth, height: nextHeight };
      });
      onViewportSize(nextWidth, nextHeight);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [expanded, viewportRef, onViewportSize]);

  const marks = pinScreen ? (
    <FloorPlanRegistrationMark
      x={pinScreen.x}
      y={pinScreen.y}
      color={REGISTRATION_MARK_THIS}
    />
  ) : null;

  const stageLegend = (
    <FloorPlanRegistrationLegend
      items={registrationLegend}
      className="absolute left-2 top-2 z-30"
    />
  );

  if (!expanded) {
    return (
      <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-slate-100">
        <button
          type="button"
          onClick={onExpand}
          className="absolute right-2 top-2 z-10 rounded-lg border border-slate-200 bg-white/95 p-1.5 text-slate-700 shadow-sm hover:bg-white"
          aria-label="Expand pin editor"
          title="Full screen"
        >
          <FloorPlanExpandIcon />
        </button>
        {stageLegend}
        <div
          className={`relative ${editable ? "cursor-crosshair" : "cursor-default"}`}
          style={pageSize}
          onClick={editable ? onInlineClick : undefined}
        >
          <FloorPlanPdfCanvas url={url} scale={scale} />
          {marks}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className={`relative h-full overflow-hidden bg-slate-200 ${
        panning ? "cursor-grabbing" : editable ? "cursor-crosshair" : "cursor-grab"
      }`}
      style={{ touchAction: "none" }}
      onPointerDown={onBackgroundPointerDown}
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
        <FloorPlanPdfCanvas url={url} scale={scale} />
      </div>
      <FloorPlanPdfClipCanvas
        url={url}
        view={view}
        layoutScale={scale}
        viewportWidth={viewportSize.width}
        viewportHeight={viewportSize.height}
      />
      <div className="pointer-events-none absolute inset-0 z-10">{marks}</div>
      {stageLegend}
    </div>
  );
}
