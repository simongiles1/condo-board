"use client";

import React, { useCallback, useEffect, useId, useMemo, useState } from "react";

import type { PdfPoint, PdfRect } from "@/lib/building/floor-plan-align";
import {
  RiserTemplateClipPreview,
  riserTemplatePreviewScale,
} from "./RiserTemplateClipPreview";
import {
  pdfRectCenter,
  type FloorPlanAnnotation,
  type FloorPlanCircleAnnotation,
  type FloorPlanRectangleAnnotation,
  type ShapeCrossVariant,
} from "@/lib/building/floor-plan-annotations";
import type {
  MechanicalRiserDto,
  MechanicalRiserTypeDto,
} from "@/lib/building/floor-plan-mechanical-risers";
import {
  computeTemplateBounds,
  createEmptyTemplate,
  createTemplateFromAnnotations,
  findMatchingRiserRectangles,
  findSampleRiserIndexInClip,
  normalizeTemplateShapes,
  type RiserTemplateShape,
  type RiserTypeTemplate,
} from "@/lib/building/floor-plan-riser-templates";
import type { FloorPlanDto } from "@/lib/building/floor-plan-shared";

export function StandardizeRisersDialog({
  open,
  onClose,
  currentPlan,
  allPlans,
  riserTypes,
  risers,
  savedTemplates,
  annotations,
  selectedAnnotations,
  onSaveTemplate,
  onProceed,
  onPanToPoint,
  onStartPlanDrawing,
  pdfUrl,
  pageHeight,
  clipRect,
}: {
  open: boolean;
  onClose: () => void;
  currentPlan: FloorPlanDto;
  allPlans: FloorPlanDto[];
  riserTypes: MechanicalRiserTypeDto[];
  risers: MechanicalRiserDto[];
  savedTemplates?: Record<string, RiserTypeTemplate>;
  annotations: FloorPlanAnnotation[];
  selectedAnnotations: FloorPlanAnnotation[];
  onSaveTemplate: (template: RiserTypeTemplate) => Promise<void>;
  onProceed: (params: {
    typeId: string;
    template: RiserTypeTemplate;
    scope: "current" | "all";
    autoOrient: boolean;
  }) => Promise<{ count: number }>;
  onPanToPoint?: (point: PdfPoint) => void;
  onStartPlanDrawing?: (type: MechanicalRiserTypeDto) => void;
  pdfUrl: string;
  pageHeight: number;
  clipRect: PdfRect;
}) {
  const dialogTitleId = useId();
  const [selectedTypeId, setSelectedTypeId] = useState<string>(() => {
    // Default to Toilet or first type
    const toilet = riserTypes.find((t) => /toilet/i.test(t.name));
    return toilet?.id ?? riserTypes[0]?.id ?? "";
  });

  const selectedType = useMemo(
    () => riserTypes.find((t) => t.id === selectedTypeId) ?? riserTypes[0],
    [riserTypes, selectedTypeId],
  );

  // Find matching rectangles on current plan
  const matchingRectsOnCurrentPlan = useMemo(() => {
    if (!selectedType) return [];
    return findMatchingRiserRectangles(annotations, selectedType, risers);
  }, [annotations, selectedType, risers]);

  // Count matching rectangles across all plans
  const totalCountAcrossAllPlans = useMemo(() => {
    if (!selectedType) return 0;
    let count = 0;
    for (const p of allPlans) {
      if (p.id === currentPlan.id) {
        count += matchingRectsOnCurrentPlan.length;
      } else {
        const matches = findMatchingRiserRectangles(
          p.annotations || [],
          selectedType,
          risers,
        );
        count += matches.length;
      }
    }
    return count;
  }, [allPlans, currentPlan.id, matchingRectsOnCurrentPlan.length, selectedType, risers]);

  // Average size of existing rectangles on current plan
  const avgDimensions = useMemo(() => {
    if (matchingRectsOnCurrentPlan.length === 0) {
      return { width: 28, height: 14 };
    }
    let totalW = 0;
    let totalH = 0;
    for (const m of matchingRectsOnCurrentPlan) {
      totalW += m.annotation.rect.width;
      totalH += m.annotation.rect.height;
    }
    const len = matchingRectsOnCurrentPlan.length;
    return {
      width: Number((totalW / len).toFixed(1)),
      height: Number((totalH / len).toFixed(1)),
    };
  }, [matchingRectsOnCurrentPlan]);

  // Current working template (empty until user adds shapes or loads a saved/preset template)
  const [template, setTemplate] = useState<RiserTypeTemplate>(() => {
    const existing = selectedTypeId ? savedTemplates?.[selectedTypeId] : undefined;
    if (existing && existing.shapes.length > 0) return existing;
    return createEmptyTemplate(selectedTypeId);
  });

  // Track template changes when type changes
  const handleSelectType = useCallback(
    (typeId: string) => {
      setSelectedTypeId(typeId);
      const existing = savedTemplates?.[typeId];
      if (existing && existing.shapes.length > 0) {
        setTemplate(existing);
      } else {
        setTemplate(createEmptyTemplate(typeId));
      }
    },
    [savedTemplates],
  );

  const [scope, setScope] = useState<"current" | "all">("current");
  const [autoOrient, setAutoOrient] = useState(true);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [proceeding, setProceeding] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedShapeIndex, setSelectedShapeIndex] = useState<number | null>(null);
  const [drawTool, setDrawTool] = useState<"circle" | "rectangle" | null>(null);

  const sampleAnnotation = matchingRectsOnCurrentPlan[sampleIndex]?.annotation ?? null;
  const draftStrokeWidthPt = sampleAnnotation?.strokeWidthPt ?? 2;
  const previewScale = useMemo(
    () => riserTemplatePreviewScale(clipRect),
    [clipRect],
  );

  // Align sample riser with the clip the user drew (not always index 0).
  useEffect(() => {
    if (!open || matchingRectsOnCurrentPlan.length === 0) return;
    const idx = findSampleRiserIndexInClip(matchingRectsOnCurrentPlan, clipRect);
    setSampleIndex(idx);
    const target = matchingRectsOnCurrentPlan[idx]?.annotation;
    if (target && onPanToPoint) {
      onPanToPoint(pdfRectCenter(target.rect));
    }
  }, [open, clipRect, matchingRectsOnCurrentPlan, onPanToPoint]);

  // Jump to sample rectangle on plan
  const handlePanToSample = useCallback(
    (idx: number) => {
      if (matchingRectsOnCurrentPlan.length === 0) return;
      const safeIdx = (idx + matchingRectsOnCurrentPlan.length) % matchingRectsOnCurrentPlan.length;
      setSampleIndex(safeIdx);
      const target = matchingRectsOnCurrentPlan[safeIdx]?.annotation;
      if (target && onPanToPoint) {
        onPanToPoint(pdfRectCenter(target.rect));
      }
    },
    [matchingRectsOnCurrentPlan, onPanToPoint],
  );

  const applyTemplateEdits = (
    shapes: RiserTemplateShape[],
    patch?: Partial<RiserTypeTemplate>,
  ) => {
    const bounds = computeTemplateBounds(shapes);
    setTemplate((prev) => ({
      ...prev,
      ...patch,
      shapes,
      totalWidthPt: bounds.totalWidthPt,
      totalHeightPt: bounds.totalHeightPt,
    }));
  };

  const finalizeTemplateForApply = (
    draft: RiserTypeTemplate,
  ): RiserTypeTemplate => {
    const normalized = normalizeTemplateShapes(draft.shapes);
    return {
      ...draft,
      shapes: normalized.shapes,
      totalWidthPt: normalized.totalWidthPt,
      totalHeightPt: normalized.totalHeightPt,
    };
  };

  // Shape manipulations
  const updateShape = (index: number, patch: Partial<RiserTemplateShape>) => {
    const next = template.shapes.map((s, i) => (i === index ? { ...s, ...patch } : s));
    applyTemplateEdits(next);
  };

  const removeShape = (index: number) => {
    applyTemplateEdits(template.shapes.filter((_, i) => i !== index));
  };

  const selectTool = () => {
    setDrawTool(null);
    setStatusMessage("Click shapes in the clip to select them, then drag or use arrow keys to reposition.");
  };

  const addCircle = () => {
    setDrawTool("circle");
    setStatusMessage("Click and drag on the clip to draw a circle (hold Shift for a square bounding box).");
  };

  const addRectangle = () => {
    setDrawTool("rectangle");
    setStatusMessage("Click and drag on the clip to draw a rectangle (hold Shift for a square).");
  };

  const handleDrawShape = (shape: RiserTemplateShape) => {
    const next = [...template.shapes, shape];
    applyTemplateEdits(next);
    setSelectedShapeIndex(next.length - 1);
    setDrawTool(null);
  };

  const handleMoveShape = (index: number, offsetXPt: number, offsetYPt: number) => {
    updateShape(index, { offsetXPt, offsetYPt });
  };

  const setPresetToilet3Circles = () => {
    // Top circle: crosshair ring, middle: solid filled, bottom: solid filled
    const d = 7.5;
    const spacing = 10.5;
    const shapes: RiserTemplateShape[] = [
      {
        type: "circle",
        offsetXPt: 0,
        offsetYPt: spacing,
        widthPt: d,
        heightPt: d,
        variant: "cross",
        filled: false,
        strokeWidthPt: 2,
        primary: true,
      },
      {
        type: "circle",
        offsetXPt: 0,
        offsetYPt: 0,
        widthPt: d,
        heightPt: d,
        variant: "plain",
        filled: true,
        strokeWidthPt: 1,
        primary: false,
      },
      {
        type: "circle",
        offsetXPt: 0,
        offsetYPt: -spacing,
        widthPt: d,
        heightPt: d,
        variant: "plain",
        filled: true,
        strokeWidthPt: 1,
        primary: false,
      },
    ];
    const normalized = normalizeTemplateShapes(shapes);
    applyTemplateEdits(normalized.shapes, {
      totalWidthPt: normalized.totalWidthPt,
      totalHeightPt: normalized.totalHeightPt,
    });
  };

  const handleCaptureFromSelection = () => {
    const boxAnnotations = selectedAnnotations.filter(
      (a): a is FloorPlanRectangleAnnotation | FloorPlanCircleAnnotation =>
        a.type === "rectangle" || a.type === "circle",
    );
    if (boxAnnotations.length === 0) {
      setStatusMessage("Please select one or more shapes on the floor plan first.");
      return;
    }
    const captured = createTemplateFromAnnotations(selectedTypeId, boxAnnotations);
    setTemplate(captured);
    setStatusMessage(`Captured ${boxAnnotations.length} shape(s) from selection as template.`);
  };

  const handleSaveOnly = async () => {
    try {
      await onSaveTemplate(finalizeTemplateForApply(template));
      setStatusMessage("Template saved successfully.");
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : "Failed to save template.");
    }
  };

  const handleProceedClick = async () => {
    setProceeding(true);
    setStatusMessage(null);
    try {
      const result = await onProceed({
        typeId: selectedTypeId,
        template: finalizeTemplateForApply(template),
        scope,
        autoOrient,
      });
      setStatusMessage(
        `Standardized ${result.count} risers successfully!`,
      );
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : "Standardization failed.");
    } finally {
      setProceeding(false);
    }
  };

  useEffect(() => {
    if (!open || selectedShapeIndex == null) return;

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
      const step = (event.shiftKey ? 10 : 1) / previewScale;
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

      setTemplate((prev) => {
        const shape = prev.shapes[selectedShapeIndex];
        if (!shape) return prev;
        const next = prev.shapes.map((s, i) =>
          i === selectedShapeIndex
            ? {
                ...s,
                offsetXPt: Number((s.offsetXPt + dx).toFixed(3)),
                offsetYPt: Number((s.offsetYPt + dy).toFixed(3)),
              }
            : s,
        );
        const bounds = computeTemplateBounds(next);
        return {
          ...prev,
          shapes: next,
          totalWidthPt: bounds.totalWidthPt,
          totalHeightPt: bounds.totalHeightPt,
        };
      });
      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, previewScale, selectedShapeIndex]);

  if (!open) return null;

  const countForScope =
    scope === "current"
      ? matchingRectsOnCurrentPlan.length
      : totalCountAcrossAllPlans;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby={dialogTitleId}
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 id={dialogTitleId} className="text-lg font-bold text-slate-900">
              Standardize Riser Shapes
            </h2>
            <p className="text-xs text-slate-500">
              Draw your template shapes in the clip region. They are centered into each riser rectangle when you proceed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close dialog"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {/* Riser Type Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Riser Type
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {riserTypes.map((type) => {
                const isSelected = type.id === selectedTypeId;
                const count = annotations.filter(
                  (a) =>
                    a.type === "rectangle" &&
                    (a.color === type.color || a.callout?.typeId === type.id),
                ).length;
                return (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => handleSelectType(type.id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      isSelected
                        ? "border-slate-900 bg-slate-900 text-white shadow-xs"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-full border border-black/20"
                      style={{ backgroundColor: type.color }}
                    />
                    <span>{type.name}</span>
                    <span
                      className={`ml-1 rounded px-1.5 py-0.2 text-[10px] ${
                        isSelected ? "bg-slate-700 text-slate-200" : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Target Instances Info & Sample Navigation */}
          <div className="flex flex-wrap items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
            <div>
              <span className="font-semibold text-slate-900">
                {matchingRectsOnCurrentPlan.length} freehand rectangles
              </span>{" "}
              on this floor ({totalCountAcrossAllPlans} across all floors).
              <span className="ml-2 text-slate-500">
                Avg size: {avgDimensions.width} × {avgDimensions.height} pt
              </span>
            </div>
            {matchingRectsOnCurrentPlan.length > 0 && onPanToPoint && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500">
                  Sample {sampleIndex + 1}/{matchingRectsOnCurrentPlan.length}
                </span>
                <button
                  type="button"
                  onClick={() => handlePanToSample(sampleIndex - 1)}
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-50"
                  title="Previous sample rectangle"
                >
                  ◀
                </button>
                <button
                  type="button"
                  onClick={() => handlePanToSample(sampleIndex + 1)}
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-50"
                  title="Next sample rectangle"
                >
                  ▶
                </button>
              </div>
            )}
          </div>

          {/* Template Shape Designer */}
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Template Shape Definition
                </h3>
                <p className="text-xs text-slate-500">
                  {template.shapes.length === 0
                    ? "No shapes yet — add circles/rectangles or use a preset"
                    : template.shapes.length === 1
                      ? "Single standardized shape"
                      : `${template.shapes.length} shapes in template`}
                  {template.shapes.length > 0 ? (
                    <>
                      {" • "}
                      Total box: {template.totalWidthPt} × {template.totalHeightPt} pt
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {selectedType?.name.toLowerCase().includes("toilet") && (
                  <button
                    type="button"
                    onClick={setPresetToilet3Circles}
                    className="inline-flex items-center gap-1 rounded border border-purple-300 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-800 hover:bg-purple-100"
                    title="Load 3-circle toilet riser template (1 crosshair + 2 filled circles)"
                  >
                    Preset: 3 Toilet Circles
                  </button>
                )}
                {selectedAnnotations.length > 0 && (
                  <button
                    type="button"
                    onClick={handleCaptureFromSelection}
                    className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100"
                    title="Capture selected shapes from the main floor plan as the template"
                  >
                    Capture Selection ({selectedAnnotations.length})
                  </button>
                )}
              </div>
            </div>

            {/* Template Visual Preview — drawing clip at plan scale */}
            <div className="mt-3">
            <RiserTemplateClipPreview
              pdfUrl={pdfUrl}
              pageHeight={pageHeight}
              clipRect={clipRect}
              shapes={template.shapes}
              strokeColor={selectedType?.color || "#3b82f6"}
              draftStrokeWidthPt={draftStrokeWidthPt}
              selectedShapeIndex={selectedShapeIndex}
              onSelectShape={setSelectedShapeIndex}
              onMoveShape={handleMoveShape}
              onDrawShape={handleDrawShape}
              drawTool={drawTool}
            />
            <p className="mt-1.5 text-[11px] text-slate-500">
              Clip: {clipRect.width.toFixed(1)} × {clipRect.height.toFixed(1)} pt at 1:1 scale (preview zoomed for editing)
              {drawTool
                ? ` · Drag to draw ${drawTool} (Shift = square box)`
                : selectedShapeIndex != null
                  ? " · Drag to reposition · Arrow keys nudge 1 px (Shift 10 px)"
                  : " · Select tool: click a shape to select · Drag to reposition"}
            </p>
            </div>

            {/* Shape Tools & List */}
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">Shapes in Template</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={selectTool}
                    title="Select shapes — click to select, drag to move, arrow keys to nudge"
                    aria-label="Select"
                    aria-pressed={drawTool == null}
                    className={`inline-flex items-center rounded-md border p-1 ${
                      drawTool == null
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <PointerIcon />
                  </button>
                  <button
                    type="button"
                    onClick={addCircle}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${
                      drawTool === "circle"
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    + Add Circle
                  </button>
                  <button
                    type="button"
                    onClick={addRectangle}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${
                      drawTool === "rectangle"
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    + Add Rectangle
                  </button>
                </div>
              </div>

              {/* List of shapes */}
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {template.shapes.map((shape, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold capitalize text-slate-800">
                        #{i + 1} {shape.type}
                      </span>
                      {shape.primary ? (
                        <span className="rounded bg-sky-100 px-1 py-0.5 text-[10px] font-medium text-sky-800" title="Inherits callout & connection arrow">
                          ★ Primary
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => updateShape(i, { primary: true })}
                          className="text-[10px] text-slate-400 hover:text-slate-600 hover:underline"
                          title="Make this shape inherit the callout"
                        >
                          Set primary
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {shape.type === "circle" ? (
                        <label className="flex items-center gap-1 text-[11px] text-slate-600">
                          Ø (pt):
                          <input
                            type="number"
                            min="1"
                            max="100"
                            step="0.1"
                            value={shape.widthPt}
                            onChange={(e) => {
                              const val = Math.max(1, Number(e.target.value));
                              updateShape(i, { widthPt: val, heightPt: val });
                            }}
                            className="w-14 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
                          />
                        </label>
                      ) : (
                        <>
                          <label className="flex items-center gap-1 text-[11px] text-slate-600">
                            W:
                            <input
                              type="number"
                              min="1"
                              max="200"
                              step="0.5"
                              value={shape.widthPt}
                              onChange={(e) => updateShape(i, { widthPt: Math.max(1, Number(e.target.value)) })}
                              className="w-12 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
                            />
                          </label>
                          <label className="flex items-center gap-1 text-[11px] text-slate-600">
                            H:
                            <input
                              type="number"
                              min="1"
                              max="200"
                              step="0.5"
                              value={shape.heightPt}
                              onChange={(e) => updateShape(i, { heightPt: Math.max(1, Number(e.target.value)) })}
                              className="w-12 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
                            />
                          </label>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => updateShape(i, { variant: shape.variant === "cross" ? "plain" : "cross" })}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium border ${
                          shape.variant === "cross" ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-700"
                        }`}
                        title="Toggle crosshair (+/X)"
                      >
                        Cross
                      </button>

                      <button
                        type="button"
                        onClick={() => updateShape(i, { filled: !shape.filled })}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium border ${
                          shape.filled ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-700"
                        }`}
                        title="Toggle solid fill"
                      >
                        Filled
                      </button>

                      <button
                        type="button"
                        onClick={() => removeShape(i)}
                        className="rounded p-1 text-red-500 hover:bg-red-50"
                        title="Remove shape"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Options & Scope */}
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="standardize-auto-orient"
                checked={autoOrient}
                onChange={(e) => setAutoOrient(e.target.checked)}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <label htmlFor="standardize-auto-orient" className="font-medium text-slate-700 cursor-pointer">
                Auto-orient (rotate 90° if target rectangle is landscape vs portrait)
              </label>
            </div>

            <div className="border-t border-slate-200 pt-2.5">
              <span className="font-medium text-slate-700">Apply to:</span>
              <div className="mt-1.5 flex gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="scope"
                    value="current"
                    checked={scope === "current"}
                    onChange={() => setScope("current")}
                    className="text-slate-900 focus:ring-slate-900"
                  />
                  <span>
                    Current floor only (<strong>{matchingRectsOnCurrentPlan.length}</strong> risers on {currentPlan.name})
                  </span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="scope"
                    value="all"
                    checked={scope === "all"}
                    onChange={() => setScope("all")}
                    className="text-slate-900 focus:ring-slate-900"
                  />
                  <span>
                    All floors (<strong>{totalCountAcrossAllPlans}</strong> risers across {allPlans.length} floors)
                  </span>
                </label>
              </div>
            </div>
          </div>

          {statusMessage && (
            <div className="rounded-lg bg-blue-50 p-2.5 text-xs font-medium text-blue-900">
              {statusMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={handleSaveOnly}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            title="Save this template without applying to existing rectangles"
          >
            Save Template Only
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={proceeding}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleProceedClick}
              disabled={proceeding || countForScope === 0 || template.shapes.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50"
            >
              {proceeding ? "Standardizing…" : `Proceed (${countForScope} risers)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function PointerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4.5 2 3 13.5l2.2-2.2 2.5 4.8 1.7-0.9-2.5-4.8 3.1-0.1L4.5 2z" />
    </svg>
  );
}
