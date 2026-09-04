"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  buildingCompareNeighbors,
  buildingComparePlans,
  compareSheetRenderSize,
  compareStackLayout,
  effectiveFamilyScale,
  resolveCompareAnchor,
  resolveCompareReferenceScaleDenominator,
} from "@/lib/building/floor-plan-align";
import { visibleAnnotationsForCompareSheet } from "@/lib/building/floor-plan-compare-annotations";
import {
  parseDrawColorPresets,
  parseMechanicalMarkupSet,
  presetsInFamily,
  strokeColorFilterHasSelection,
  type DrawColorPreset,
  type MechanicalMarkupSet,
  type StrokeColorFilter,
} from "@/lib/building/floor-plan-annotations";
import {
  hydrateFloorPlanEditRibbonFromStorage,
  readFloorPlanEditRibbonSession,
  writeFloorPlanEditRibbonSession,
} from "@/lib/building/floor-plan-edit-session";
import {
  floorPlanFileUrl,
  floorPlanLabel,
  type FloorPlanDto,
  type FloorPlanFamilyDto,
} from "@/lib/building/floor-plan-shared";
import { loadPdfBuffer, wakePageRenderQueue } from "@/lib/pdf/pdfjs-browser";
import { usePdfSession } from "@/lib/pdf/use-pdf-session";

import {
  loadCompareScaleDisplaySettings,
  resolveCompareScaleFitFactor,
  resolveCompareScaleOffset,
  uniqueCompareScaleDenominators,
  type CompareScaleDisplaySettings,
} from "@/lib/building/floor-plan-compare-display-settings";

import {
  FloorPlanCompareDisplaySettingsButton,
  FloorPlanCompareDisplaySettingsDialog,
} from "./FloorPlanCompareDisplaySettingsDialog";
import {
  familyBadgeColorForId,
  FloorPlanFamilyBadge,
} from "./FloorPlanFamilyBadge";
import { FloorPlanAnnotationLayer } from "./FloorPlanAnnotationLayer";
import { MechanicalMarkupSetToggle, LineOverlayControl, RiserLabelsToggle } from "./FloorPlanEditorRibbon";
import { FloorPlanPdfCanvas } from "./FloorPlanPdfCanvas";
import { FloorPlanZoomToolbar } from "./FloorPlanZoomToolbar";
import {
  FloorPlanRegistrationMark,
  REGISTRATION_MARK_THIS,
} from "./FloorPlanRegistrationMark";

const FIT_PAD = 48;
const FIT_SCALE_MAX = 2.5;
/** Expanded compare fits the active floor; tower crops can need more zoom than the inline viewer. */
const SESSION_FIT_SCALE_MAX = 8;
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 16;

function filterIncludesMechanical(
  filter: StrokeColorFilter,
  presets: DrawColorPreset[],
): boolean {
  const mechanical = presetsInFamily(presets, "mechanical");
  if (mechanical.length === 0) return false;
  if (filter === "all") return true;
  const allowed = new Set(filter);
  return mechanical.some((preset) => allowed.has(preset.color));
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function croppedUrl(plan: FloorPlanDto): string {
  return floorPlanFileUrl(plan.id, "cropped", plan.updatedAt);
}

function fitScaleForBox(
  boxWidth: number,
  boxHeight: number,
  contentWidth: number,
  contentHeight: number,
  maxScale: number = FIT_SCALE_MAX,
): number {
  if (contentWidth <= 0 || contentHeight <= 0) return 1;
  const next = Math.min(
    (boxWidth - FIT_PAD) / contentWidth,
    (boxHeight - FIT_PAD) / contentHeight,
    maxScale,
  );
  return Math.max(0.2, next);
}

function fitScaleForViewport(
  viewport: HTMLElement,
  widthPt: number,
  heightPt: number,
  maxScale: number = FIT_SCALE_MAX,
): number {
  return fitScaleForBox(
    viewport.clientWidth,
    viewport.clientHeight,
    widthPt,
    heightPt,
    maxScale,
  );
}

function familyForPlan(
  families: FloorPlanFamilyDto[],
  plan: FloorPlanDto,
): FloorPlanFamilyDto | null {
  return families.find((family) => family.id === plan.familyId) ?? null;
}

function compareSheetEntries(
  compareSheets: FloorPlanDto[],
  families: FloorPlanFamilyDto[],
) {
  return compareSheets.flatMap((sheet) => {
    const family = familyForPlan(families, sheet);
    return family ? [{ plan: sheet, family }] : [];
  });
}

function resolveCompareStackLayout(
  compareSheets: FloorPlanDto[],
  families: FloorPlanFamilyDto[],
  registrationPlanId: string | null,
  scale: number,
) {
  const anchorPlan = resolveCompareAnchor(compareSheets, registrationPlanId);
  if (!anchorPlan) return null;
  const anchorFamily = familyForPlan(families, anchorPlan);
  if (!anchorFamily) return null;
  const sheetEntries = compareSheetEntries(compareSheets, families);
  const referenceScaleDenominator = resolveCompareReferenceScaleDenominator(
    anchorFamily,
    sheetEntries.map((entry) => entry.family),
  );
  return compareStackLayout(
    anchorPlan,
    anchorFamily,
    sheetEntries,
    scale,
    referenceScaleDenominator,
  );
}

function layoutExtentsAtUnitScale(
  compareSheets: FloorPlanDto[],
  families: FloorPlanFamilyDto[],
  registrationPlanId: string | null,
) {
  const anchor = resolveCompareAnchor(compareSheets, registrationPlanId);
  if (!anchor) return null;
  const anchorFamily = familyForPlan(families, anchor);
  if (!anchorFamily) return null;
  return compareStackLayout(
    anchor,
    anchorFamily,
    compareSheetEntries(compareSheets, families),
    1,
  );
}

/** One scale for every sheet so pin offsets stay valid and canvases never re-rasterize on switch. */
function compareLayoutScale(
  compareSheets: FloorPlanDto[],
  families: FloorPlanFamilyDto[],
  registrationPlanId: string | null,
): number {
  const layout = layoutExtentsAtUnitScale(
    compareSheets,
    families,
    registrationPlanId,
  );
  let maxWidth = layout?.width ?? 0;
  if (maxWidth <= 0) {
    for (const sheet of compareSheets) {
      const family = familyForPlan(families, sheet);
      maxWidth = Math.max(maxWidth, family?.cropWidthPt ?? 0);
    }
  }
  if (maxWidth <= 0) return 1;
  return Math.min(1.4, Math.max(0.45, 900 / maxWidth));
}

function resolveCompareReferenceDenominator(
  compareSheets: FloorPlanDto[],
  families: FloorPlanFamilyDto[],
  registrationPlanId: string | null,
): number | null {
  const anchorPlan = resolveCompareAnchor(compareSheets, registrationPlanId);
  if (!anchorPlan) return null;
  const anchorFamily = familyForPlan(families, anchorPlan);
  if (!anchorFamily) return null;
  return resolveCompareReferenceScaleDenominator(
    anchorFamily,
    compareSheetEntries(compareSheets, families).map((entry) => entry.family),
  );
}

/**
 * One raster scale for the whole compare session so canvases are not
 * re-rasterized when flipping floors. Use the largest per-sheet fit scale
 * so tower crops can still fill the viewport via CSS display scaling.
 */
function sessionRasterScale(
  viewport: HTMLElement,
  compareSheets: FloorPlanDto[],
  families: FloorPlanFamilyDto[],
  registrationPlanId: string | null,
): number {
  const referenceDenominator = resolveCompareReferenceDenominator(
    compareSheets,
    families,
    registrationPlanId,
  );

  let maxFit = 0.2;
  for (const sheet of compareSheets) {
    const family = familyForPlan(families, sheet);
    if (!family) continue;
    const { width, height } = compareSheetRenderSize(
      1,
      family,
      referenceDenominator,
    );
    if (width > 0 && height > 0) {
      maxFit = Math.max(
        maxFit,
        fitScaleForViewport(viewport, width, height, SESSION_FIT_SCALE_MAX),
      );
    }
  }
  if (maxFit > 0.2) return maxFit;

  const layout = layoutExtentsAtUnitScale(
    compareSheets,
    families,
    registrationPlanId,
  );
  if (layout && layout.width > 0 && layout.height > 0) {
    return fitScaleForViewport(
      viewport,
      layout.width,
      layout.height,
      SESSION_FIT_SCALE_MAX,
    );
  }

  let maxWidth = 0;
  let maxHeight = 0;
  for (const sheet of compareSheets) {
    const family = familyForPlan(families, sheet);
    maxWidth = Math.max(maxWidth, family?.cropWidthPt ?? 0);
    maxHeight = Math.max(maxHeight, family?.cropHeightPt ?? 0);
  }
  return fitScaleForViewport(
    viewport,
    maxWidth,
    maxHeight,
    SESSION_FIT_SCALE_MAX,
  );
}

function CompareSheetAnnotations({
  plan,
  family,
  plans,
  families,
  allPlans,
  allFamilies,
  scale,
  displayZoom = 1,
  markupSet,
  colorFilter,
  linesVisible,
  showRiserLabels,
}: {
  plan: FloorPlanDto;
  family: FloorPlanFamilyDto;
  plans: FloorPlanDto[];
  families: FloorPlanFamilyDto[];
  allPlans: FloorPlanDto[];
  allFamilies: FloorPlanFamilyDto[];
  scale: number;
  /** Compensates for a parent CSS scale so stroke width stays constant on screen. */
  displayZoom?: number;
  markupSet?: MechanicalMarkupSet;
  colorFilter: StrokeColorFilter;
  linesVisible: boolean;
  showRiserLabels: boolean;
}) {
  const pageWidth = family.cropWidthPt ?? 0;
  const pageHeight = family.cropHeightPt ?? 0;
  const annotations = useMemo(() => {
    if (!linesVisible || !strokeColorFilterHasSelection(colorFilter)) return [];
    return visibleAnnotationsForCompareSheet({
      plan,
      family,
      plans,
      families,
      allPlans,
      allFamilies,
      markupSet,
      colorFilter,
    });
  }, [
    plan,
    family,
    plans,
    families,
    allPlans,
    allFamilies,
    markupSet,
    colorFilter,
    linesVisible,
  ]);
  if (annotations.length === 0 || pageWidth <= 0 || pageHeight <= 0) {
    return null;
  }

  return (
    <FloorPlanAnnotationLayer
      pageWidth={pageWidth}
      pageHeight={pageHeight}
      scale={scale}
      zoom={displayZoom}
      annotations={annotations}
      selectedIndices={[]}
      selectionDraft={null}
      lineDraft={null}
      boundingBoxDraft={null}
      cutDraft={null}
      hoverSnap={null}
      draftColor="#000000"
      draftStrokeWidthPt={1}
      drawInteractive={false}
      selectInteractive={false}
      selectable={false}
      showRiserLabels={showRiserLabels}
    />
  );
}

function CompareStack({
  plan,
  families,
  plans,
  compareSheets,
  neighbors,
  registrationPlanId,
  scale,
  onionOpacity,
  showRegistrationMark = true,
  layoutOrigin,
  containerSize,
  pinAnchoredLayout = false,
  displayZoom = 1,
  markupSet,
  allPlans,
  allFamilies,
  colorFilter,
  linesVisible,
  showRiserLabels,
  onReadyChange,
}: {
  plan: FloorPlanDto;
  families: FloorPlanFamilyDto[];
  plans: FloorPlanDto[];
  compareSheets: FloorPlanDto[];
  neighbors: { prevId: string | null; nextId: string | null };
  registrationPlanId: string | null;
  scale: number;
  onionOpacity: number;
  showRegistrationMark?: boolean;
  /** Shift stack coordinates — expanded compare anchors at the registration pin. */
  layoutOrigin?: { x: number; y: number };
  containerSize?: { width: number; height: number };
  /** Allow sheet offsets that extend above/left of the pin anchor. */
  pinAnchoredLayout?: boolean;
  /** Parent CSS scale applied outside the stack (full-screen compare fit/zoom). */
  displayZoom?: number;
  markupSet?: MechanicalMarkupSet;
  allPlans: FloorPlanDto[];
  allFamilies: FloorPlanFamilyDto[];
  colorFilter: StrokeColorFilter;
  linesVisible: boolean;
  showRiserLabels: boolean;
  onReadyChange?: (allReady: boolean, readyCount: number) => void;
}) {
  const [readyIds, setReadyIds] = useState<Set<string>>(() => new Set());
  const [visibilityRetry, setVisibilityRetry] = useState(0);
  const sessionUrls = useMemo(
    () => compareSheets.map((sheet) => croppedUrl(sheet)),
    [compareSheets],
  );
  usePdfSession(true, sessionUrls);

  useEffect(() => {
    for (const sheet of compareSheets) {
      void loadPdfBuffer(croppedUrl(sheet)).catch(() => {
        /* FloorPlanPdfCanvas reports render failures via onError. */
      });
    }
  }, [compareSheets]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) return;
      wakePageRenderQueue();
      setVisibilityRetry((pass) => pass + 1);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const anchorPlan = resolveCompareAnchor(compareSheets, registrationPlanId);
  const anchorFamily = anchorPlan ? familyForPlan(families, anchorPlan) : null;
  const sheetEntries = useMemo(
    () => compareSheetEntries(compareSheets, families),
    [compareSheets, families],
  );
  const referenceScaleDenominator = useMemo(() => {
    if (!anchorFamily) return null;
    return resolveCompareReferenceScaleDenominator(
      anchorFamily,
      sheetEntries.map((entry) => entry.family),
    );
  }, [anchorFamily, sheetEntries]);
  const stackLayout = useMemo(() => {
    if (!anchorPlan || !anchorFamily) return null;
    return resolveCompareStackLayout(
      compareSheets,
      families,
      registrationPlanId,
      scale,
    );
  }, [anchorPlan, anchorFamily, compareSheets, families, registrationPlanId, scale]);

  const markReady = useCallback((id: string) => {
    setReadyIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const allReady =
    compareSheets.length > 0 &&
    compareSheets.every((sheet) => readyIds.has(sheet.id));
  const currentReady = readyIds.has(plan.id);
  const readyCount = compareSheets.filter((sheet) => readyIds.has(sheet.id)).length;

  useEffect(() => {
    onReadyChange?.(allReady, readyCount);
  }, [allReady, readyCount, onReadyChange]);

  const containerWidth =
    containerSize?.width ?? stackLayout?.width ?? 0;
  const containerHeight =
    containerSize?.height ?? stackLayout?.height ?? 0;
  const originX = layoutOrigin?.x ?? 0;
  const originY = layoutOrigin?.y ?? 0;

  return (
    <div
      className="relative"
      style={{
        width: containerWidth,
        height: containerHeight,
        overflow: pinAnchoredLayout ? "visible" : undefined,
      }}
    >
      {compareSheets.map((sheet) => {
        const sheetFamily = familyForPlan(families, sheet);
        if (!sheetFamily) return null;
        const sheetScale = effectiveFamilyScale(
          scale,
          sheetFamily,
          referenceScaleDenominator,
        );
        const sheetWidth = (sheetFamily.cropWidthPt ?? 0) * sheetScale;
        const sheetHeight = (sheetFamily.cropHeightPt ?? 0) * sheetScale;
        const isActive = sheet.id === plan.id;
        const isOnion =
          sheet.id === neighbors.prevId &&
          onionOpacity > 0 &&
          readyIds.has(sheet.id);
        const show =
          isActive ||
          (isOnion && !isActive && onionOpacity > 0 && readyIds.has(sheet.id));
        const offset = stackLayout?.offsets[sheet.id] ?? { x: 0, y: 0 };

        return (
          <div
            key={sheet.id}
            className="absolute left-0 top-0"
            style={{
              width: sheetWidth,
              height: sheetHeight,
              left: offset.x - originX,
              top: offset.y - originY,
              visibility: show ? "visible" : "hidden",
              opacity: isActive ? (currentReady ? 1 : 0.35) : isOnion ? onionOpacity : 0,
              zIndex: isOnion ? 2 : isActive ? 1 : 0,
              pointerEvents: "none",
            }}
          >
            <FloorPlanPdfCanvas
              url={croppedUrl(sheet)}
              scale={sheetScale}
              queuedRender
              renderRetry={readyIds.has(sheet.id) ? 0 : visibilityRetry}
              onRendered={() => markReady(sheet.id)}
              onError={() => markReady(sheet.id)}
            />
            {show ? (
              <CompareSheetAnnotations
                plan={sheet}
                family={sheetFamily}
                plans={plans}
                families={families}
                allPlans={allPlans}
                allFamilies={allFamilies}
                scale={sheetScale}
                displayZoom={displayZoom}
                markupSet={markupSet}
                colorFilter={colorFilter}
                linesVisible={linesVisible}
                showRiserLabels={showRiserLabels}
              />
            ) : null}
          </div>
        );
      })}
      {stackLayout && currentReady && showRegistrationMark ? (
        <FloorPlanRegistrationMark
          x={stackLayout.pinX - originX}
          y={stackLayout.pinY - originY}
          color={REGISTRATION_MARK_THIS}
          className="z-30"
        />
      ) : null}
    </div>
  );
}

export function FloorPlanCompareViewer({
  plan,
  family,
  plans,
  families,
  allPlans,
  allFamilies,
  colorPresets,
  registrationPlanId,
  onionOpacity,
  onOnionOpacity,
  onSelectPlan,
  expanded,
  onExpandedChange,
}: {
  plan: FloorPlanDto;
  family: FloorPlanFamilyDto;
  plans: FloorPlanDto[];
  families: FloorPlanFamilyDto[];
  allPlans: FloorPlanDto[];
  allFamilies: FloorPlanFamilyDto[];
  colorPresets: DrawColorPreset[];
  registrationPlanId: string | null;
  onionOpacity: number;
  onOnionOpacity: (value: number) => void;
  onSelectPlan: (id: string) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [inlineReady, setInlineReady] = useState(false);
  const [markupSet, setMarkupSet] = useState<MechanicalMarkupSet>(() =>
    parseMechanicalMarkupSet(readFloorPlanEditRibbonSession().markupSet),
  );
  const [linesVisible, setLinesVisible] = useState(true);
  const [showRiserLabels, setShowRiserLabels] = useState(
    () => readFloorPlanEditRibbonSession().showRiserLabels,
  );
  const [colorFilter, setColorFilter] = useState<StrokeColorFilter>("all");
  const parsedColorPresets = useMemo(
    () => parseDrawColorPresets(colorPresets),
    [colorPresets],
  );
  const compareSheets = buildingComparePlans(plans, families);
  const neighbors = buildingCompareNeighbors(plans, families, plan.id);
  const layoutScale = useMemo(
    () => compareLayoutScale(compareSheets, families, registrationPlanId),
    [compareSheets, families, registrationPlanId],
  );

  const prevPlan = neighbors.prevId
    ? plans.find((item) => item.id === neighbors.prevId) ?? null
    : null;
  const showRiserPass =
    family.kind === "mechanical" ||
    filterIncludesMechanical(colorFilter, parsedColorPresets);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    const stored = hydrateFloorPlanEditRibbonFromStorage();
    setMarkupSet(parseMechanicalMarkupSet(stored.markupSet));
    setShowRiserLabels(stored.showRiserLabels);
  }, []);

  const goTo = useCallback(
    (id: string | null) => {
      if (id) onSelectPlan(id);
    },
    [onSelectPlan],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (!inlineReady) return;
      if (event.key === "ArrowLeft" && neighbors.prevId) {
        event.preventDefault();
        goTo(neighbors.prevId);
      }
      if (event.key === "ArrowRight" && neighbors.nextId) {
        event.preventDefault();
        goTo(neighbors.nextId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inlineReady, neighbors.prevId, neighbors.nextId, goTo]);

  const handleMarkupSetChange = useCallback((next: MechanicalMarkupSet) => {
    setMarkupSet(next);
    const current = readFloorPlanEditRibbonSession();
    writeFloorPlanEditRibbonSession({ ...current, markupSet: next });
  }, []);

  const handleShowRiserLabelsChange = useCallback((next: boolean) => {
    setShowRiserLabels(next);
    const current = readFloorPlanEditRibbonSession();
    writeFloorPlanEditRibbonSession({ ...current, showRiserLabels: next });
  }, []);

  const overlayProps = {
    allPlans,
    allFamilies,
    colorFilter,
    linesVisible,
    markupSet,
    showRiserLabels,
  };

  const controls = (
    <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
      <LineOverlayControl
        enabled={linesVisible}
        planId=""
        plans={[]}
        colorPresets={parsedColorPresets}
        colorFilter={colorFilter}
        onEnabled={setLinesVisible}
        onPlanId={() => {}}
        onColorFilter={setColorFilter}
        title="Show or hide overlay lines by type, independently of which drawings are stacked"
        zIndex={140}
      />
      {showRiserPass ? (
        <>
          <RiserLabelsToggle
            checked={showRiserLabels}
            onChange={handleShowRiserLabelsChange}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Riser pass
            </span>
            <MechanicalMarkupSetToggle
              value={markupSet}
              onChange={handleMarkupSetChange}
            />
          </div>
        </>
      ) : null}
      <label className="flex items-center gap-2">
        Onion skin (previous floor)
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={onionOpacity}
          disabled={!prevPlan}
          onChange={(event) => onOnionOpacity(Number(event.target.value))}
        />
      </label>
      <span className="text-xs text-slate-500">
        {compareSheets.length} cropped &amp; pinned sheet
        {compareSheets.length === 1 ? "" : "s"} across the building
      </span>
    </div>
  );

  const navButtons = (ready: boolean) => (
    <>
      <button
        type="button"
        disabled={!neighbors.prevId || !ready}
        onClick={() => goTo(neighbors.prevId)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
      >
        ← Previous
      </button>
      <button
        type="button"
        disabled={!neighbors.nextId || !ready}
        onClick={() => goTo(neighbors.nextId)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
      >
        Next →
      </button>
    </>
  );

  if (expanded) {
    const modal =
      mounted &&
      createPortal(
        <CompareSession
          plan={plan}
          family={family}
          families={families}
          plans={plans}
          compareSheets={compareSheets}
          registrationPlanId={registrationPlanId}
          onionOpacity={onionOpacity}
          neighbors={neighbors}
          {...overlayProps}
          onSelectPlan={onSelectPlan}
          onClose={() => onExpandedChange(false)}
          controls={controls}
          navButtons={navButtons}
        />,
        document.body,
      );
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <p className="text-sm text-slate-500">Comparing in full screen…</p>
        </div>
        {modal}
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {navButtons(inlineReady)}
          <span className="text-sm text-slate-500">
            {inlineReady
              ? "Flip through every cropped floor in the building. Pins align so plates overlap."
              : `Preloading cropped sheets…`}
          </span>
        </div>
        {controls}
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-slate-100">
        <CompareStack
          plan={plan}
          families={families}
          plans={plans}
          compareSheets={compareSheets}
          neighbors={neighbors}
          registrationPlanId={registrationPlanId}
          scale={layoutScale}
          onionOpacity={onionOpacity}
          {...overlayProps}
          onReadyChange={(ready) => setInlineReady(ready)}
        />
        {!inlineReady ? (
          <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2">
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
              Preloading cropped sheets for instant switching…
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type PinViewportAnchor = { x: number; y: number };

function CompareSession({
  plan,
  family,
  families,
  plans,
  compareSheets,
  registrationPlanId,
  onionOpacity,
  neighbors,
  markupSet,
  allPlans,
  allFamilies,
  colorFilter,
  linesVisible,
  showRiserLabels,
  onSelectPlan,
  onClose,
  controls,
  navButtons,
}: {
  plan: FloorPlanDto;
  family: FloorPlanFamilyDto;
  families: FloorPlanFamilyDto[];
  plans: FloorPlanDto[];
  compareSheets: FloorPlanDto[];
  registrationPlanId: string | null;
  onionOpacity: number;
  neighbors: { prevId: string | null; nextId: string | null };
  markupSet?: MechanicalMarkupSet;
  allPlans: FloorPlanDto[];
  allFamilies: FloorPlanFamilyDto[];
  colorFilter: StrokeColorFilter;
  linesVisible: boolean;
  showRiserLabels: boolean;
  onSelectPlan: (id: string) => void;
  onClose: () => void;
  controls: ReactNode;
  navButtons: (ready: boolean) => ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pinAnchorRef = useRef<HTMLDivElement>(null);
  const pendingPinAnchorRef = useRef<PinViewportAnchor | null>(null);
  const compareDataRef = useRef({
    compareSheets,
    families,
    registrationPlanId,
  });
  compareDataRef.current = {
    compareSheets,
    families,
    registrationPlanId,
  };
  const sessionUrls = useMemo(
    () => compareSheets.map((sheet) => croppedUrl(sheet)),
    [compareSheets],
  );
  usePdfSession(true, sessionUrls);
  const [baseSessionScale, setBaseSessionScale] = useState<number | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [allReady, setAllReady] = useState(false);
  const [readyCount, setReadyCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scaleDisplaySettings, setScaleDisplaySettings] =
    useState<CompareScaleDisplaySettings>(() =>
      loadCompareScaleDisplaySettings(),
    );

  const planLabel = floorPlanLabel(plan);
  const familyBadgeColor = familyBadgeColorForId(family.id, families);

  const sessionScale =
    baseSessionScale != null ? baseSessionScale * zoom : null;

  const stackLayout = useMemo(() => {
    if (sessionScale == null) return null;
    return resolveCompareStackLayout(
      compareSheets,
      families,
      registrationPlanId,
      sessionScale,
    );
  }, [sessionScale, compareSheets, families, registrationPlanId]);

  const referenceDenominator = useMemo(
    () =>
      resolveCompareReferenceDenominator(
        compareSheets,
        families,
        registrationPlanId,
      ),
    [compareSheets, families, registrationPlanId],
  );

  const compareFamilies = useMemo(() => {
    const seen = new Set<string>();
    return compareSheets.flatMap((sheet) => {
      const sheetFamily = familyForPlan(families, sheet);
      if (!sheetFamily || seen.has(sheetFamily.id)) return [];
      seen.add(sheetFamily.id);
      return [sheetFamily];
    });
  }, [compareSheets, families]);

  const compareScaleDenominators = useMemo(
    () => uniqueCompareScaleDenominators(compareFamilies),
    [compareFamilies],
  );

  const activeScaleFitFactor = useMemo(
    () =>
      resolveCompareScaleFitFactor(
        family.scaleDenominator,
        scaleDisplaySettings,
      ),
    [family.scaleDenominator, scaleDisplaySettings],
  );

  const activeScaleOffset = useMemo(
    () =>
      resolveCompareScaleOffset(
        family.scaleDenominator,
        scaleDisplaySettings,
      ),
    [family.scaleDenominator, scaleDisplaySettings],
  );

  const activeViewport = useMemo(() => {
    if (!stackLayout || sessionScale == null || viewportSize.width < 2) {
      return null;
    }
    const size = compareSheetRenderSize(
      sessionScale,
      family,
      referenceDenominator,
    );
    if (size.width <= 0 || size.height <= 0) return null;

    const pinOrigin = { x: stackLayout.pinX, y: stackLayout.pinY };
    const pinScreenX = viewportSize.width / 2;
    const pinScreenY = viewportSize.height / 2;
    // Symmetric fit per family crop size — pin-anchored fit varies when pins
    // drift slightly between floors in the same family (e.g. floor 10 vs 11).
    const autoFitScale = fitScaleForBox(
      viewportSize.width,
      viewportSize.height,
      size.width,
      size.height,
      SESSION_FIT_SCALE_MAX,
    );
    const displayScale = autoFitScale * activeScaleFitFactor;

    return {
      layoutOrigin: pinOrigin,
      containerSize: {
        width: stackLayout.width,
        height: stackLayout.height,
      },
      pinScreenX,
      pinScreenY,
      autoFitScale,
      displayScale,
      offsetX: activeScaleOffset.x,
      offsetY: activeScaleOffset.y,
    };
  }, [
    stackLayout,
    sessionScale,
    plan.id,
    family,
    referenceDenominator,
    viewportSize.width,
    viewportSize.height,
    activeScaleFitFactor,
    activeScaleOffset.x,
    activeScaleOffset.y,
  ]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateViewport = () => {
      if (viewport.clientWidth < 2 || viewport.clientHeight < 160) return;
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
      const { compareSheets, families, registrationPlanId } =
        compareDataRef.current;
      setBaseSessionScale((current) =>
        current ??
        sessionRasterScale(
          viewport,
          compareSheets,
          families,
          registrationPlanId,
        ),
      );
    };

    updateViewport();

    const observer = new ResizeObserver(updateViewport);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [compareSheets, families, registrationPlanId]);

  useEffect(() => {
    setZoom(1);
  }, [plan.id]);

  const applyZoom = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      const pinAnchor = pinAnchorRef.current;
      if (!viewport || !pinAnchor) return;
      const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
      if (nextZoom === zoom) return;

      const viewportRect = viewport.getBoundingClientRect();
      const pinRect = pinAnchor.getBoundingClientRect();
      pendingPinAnchorRef.current = {
        x: pinRect.left + pinRect.width / 2 - viewportRect.left,
        y: pinRect.top + pinRect.height / 2 - viewportRect.top,
      };
      setZoom(nextZoom);
    },
    [zoom],
  );

  const resetZoom = useCallback(() => {
    const viewport = viewportRef.current;
    const pinAnchor = pinAnchorRef.current;
    if (!viewport || !pinAnchor || zoom === 1) return;

    const viewportRect = viewport.getBoundingClientRect();
    const pinRect = pinAnchor.getBoundingClientRect();
    pendingPinAnchorRef.current = {
      x: pinRect.left + pinRect.width / 2 - viewportRect.left,
      y: pinRect.top + pinRect.height / 2 - viewportRect.top,
    };
    setZoom(1);
  }, [zoom]);

  useLayoutEffect(() => {
    const pending = pendingPinAnchorRef.current;
    const viewport = viewportRef.current;
    const pinAnchor = pinAnchorRef.current;
    if (!pending || !viewport || !pinAnchor) return;
    pendingPinAnchorRef.current = null;

    const viewportRect = viewport.getBoundingClientRect();
    const pinRect = pinAnchor.getBoundingClientRect();
    const nextPinViewportX =
      pinRect.left + pinRect.width / 2 - viewportRect.left;
    const nextPinViewportY =
      pinRect.top + pinRect.height / 2 - viewportRect.top;
    viewport.scrollLeft += nextPinViewportX - pending.x;
    viewport.scrollTop += nextPinViewportY - pending.y;
  }, [zoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    function onWheel(event: WheelEvent) {
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      applyZoom(event.deltaY > 0 ? 1 / 1.1 : 1.1);
    }

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        onClose();
        return;
      }
      if (!allReady) return;
      if (event.key === "ArrowLeft" && neighbors.prevId) {
        event.preventDefault();
        onSelectPlan(neighbors.prevId);
      }
      if (event.key === "ArrowRight" && neighbors.nextId) {
        event.preventDefault();
        onSelectPlan(neighbors.nextId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    allReady,
    neighbors.prevId,
    neighbors.nextId,
    onSelectPlan,
    onClose,
    settingsOpen,
  ]);

  const handleReadyChange = useCallback((ready: boolean, count: number) => {
    setAllReady(ready);
    setReadyCount(count);
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="floor-plan-compare-fullscreen-title"
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 px-4 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="min-w-0 flex-1">
                <p
                  id="floor-plan-compare-fullscreen-title"
                  className="truncate text-sm font-semibold text-slate-900"
                >
                  Compare building
                </p>
                <p className="truncate text-xs text-slate-500">
                  {allReady
                    ? `${planLabel} · arrow keys flip floors`
                    : `Preloading cropped sheets ${readyCount} of ${compareSheets.length}…`}
                </p>
              </div>
              <FloorPlanFamilyBadge
                name={family.name}
                colorClass={familyBadgeColor}
              />
            </div>
            {navButtons(allReady)}
            <FloorPlanZoomToolbar
              zoom={zoom}
              onZoomBy={applyZoom}
              onReset={resetZoom}
              resetLabel="100%"
            />
            <FloorPlanCompareDisplaySettingsButton
              onClick={() => setSettingsOpen(true)}
            />
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              aria-label="Exit full screen"
            >
              Close
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-2">
            {controls}
          </div>
        </div>
        <FloorPlanCompareDisplaySettingsDialog
          open={settingsOpen}
          scaleDenominators={compareScaleDenominators}
          activeScaleDenominator={family.scaleDenominator}
          activeAutoFitScale={activeViewport?.autoFitScale ?? null}
          activeAppliedScale={activeViewport?.displayScale ?? null}
          activeOffsetX={activeViewport?.offsetX ?? 0}
          activeOffsetY={activeViewport?.offsetY ?? 0}
          onClose={() => setSettingsOpen(false)}
          onChange={setScaleDisplaySettings}
        />
        <div
          ref={viewportRef}
          className="relative min-h-0 flex-1 overflow-hidden bg-slate-100"
        >
          {sessionScale != null && stackLayout && activeViewport ? (
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{
                transform: `translate(${activeViewport.pinScreenX}px, ${activeViewport.pinScreenY}px) scale(${activeViewport.displayScale * zoom})`,
                transformOrigin: "0 0",
              }}
            >
              <div className="relative">
                <div
                  style={{
                    transform: `translate(${activeViewport.offsetX / (activeViewport.displayScale * zoom)}px, ${activeViewport.offsetY / (activeViewport.displayScale * zoom)}px)`,
                  }}
                >
                  <CompareStack
                    plan={plan}
                    families={families}
                    plans={plans}
                    compareSheets={compareSheets}
                    neighbors={neighbors}
                    registrationPlanId={registrationPlanId}
                    scale={sessionScale}
                    onionOpacity={onionOpacity}
                    showRegistrationMark={false}
                    layoutOrigin={activeViewport.layoutOrigin}
                    containerSize={activeViewport.containerSize}
                    pinAnchoredLayout
                    displayZoom={activeViewport.displayScale * zoom}
                    markupSet={markupSet}
                    allPlans={allPlans}
                    allFamilies={allFamilies}
                    colorFilter={colorFilter}
                    linesVisible={linesVisible}
                    showRiserLabels={showRiserLabels}
                    onReadyChange={handleReadyChange}
                  />
                  {allReady ? (
                    <FloorPlanRegistrationMark
                      x={0}
                      y={0}
                      color={REGISTRATION_MARK_THIS}
                      className="z-30"
                      inverseScale={1 / (activeViewport.displayScale * zoom)}
                    />
                  ) : null}
                  <div
                    ref={pinAnchorRef}
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0"
                    style={{ width: 1, height: 1 }}
                  />
                </div>
              </div>
            </div>
          ) : null}
          {!allReady ? (
            <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2">
              <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
                Preloading cropped sheets {readyCount} of {compareSheets.length}…
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
