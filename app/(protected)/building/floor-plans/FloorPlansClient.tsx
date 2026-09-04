"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";

import {
  buildingComparePlans,
  buildingHasPin,
  globalPlanNeighbors,
  planHasPin,
  type PdfPoint,
  type PdfRect,
} from "@/lib/building/floor-plan-align";
import {
  familiesOfDrawingSet,
  floorPlanFileUrl,
  floorPlanLabel,
  parseFloorNumber,
  parseFloorPlanName,
  planNeedsMerge,
  plansOfDrawingSet,
  planForDrawingSetFloor,
  type FloorPlanDrawingSet,
  type FloorPlanDto,
  type FloorPlanFamilyDto,
  type FloorPlanSettingsDto,
  type FloorPlansPayload,
} from "@/lib/building/floor-plan-shared";
import type { DrawColorPreset, FloorPlanAnnotation } from "@/lib/building/floor-plan-annotations";
import type { MechanicalRiserDto, RiserIdRewrite } from "@/lib/building/floor-plan-mechanical-risers";
import type { RiserTypeTemplate } from "@/lib/building/floor-plan-riser-templates";
import { FloorPlanCompareViewer } from "@/components/building/FloorPlanCompareViewer";
import {
  familyBadgeColor,
  FloorPlanFamilyBadge,
} from "@/components/building/FloorPlanFamilyBadge";
import {
  FloorPlanCropEditor,
  FloorPlanExpandIcon,
} from "@/components/building/FloorPlanCropEditor";
import { FloorPlanExpandedShell } from "@/components/building/FloorPlanExpandedShell";
import { FloorPlanSplitAlignEditor } from "@/components/building/FloorPlanSplitAlignEditor";
import {
  resolvedEastOffset,
  splitCanvasLayout,
  splitSheetSizes,
  type SplitAlignDraft,
} from "@/lib/building/floor-plan-split";
import { assertFileLooksLikePdf } from "@/lib/pdf/pdf-bytes";
import { clearPdfBufferCache } from "@/lib/pdf/pdfjs-browser";

type Mode = "edit" | "compare";

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(data && "error" in data && data.error ? data.error : "Request failed.");
  }
  return data as T;
}

function isBuildingPinSource(
  plan: FloorPlanDto,
  settings: FloorPlanSettingsDto,
): boolean {
  return (
    buildingHasPin(settings) && settings.registrationPlanId === plan.id
  );
}

export function FloorPlansClient({ initial }: { initial: FloorPlansPayload }) {
  const [payload, setPayload] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(
    initial.plans[0]?.id ?? null,
  );
  const [mode, setMode] = useState<Mode>("edit");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [familyName, setFamilyName] = useState("");
  const [uploadFamilyId, setUploadFamilyId] = useState(
    initial.families[0]?.id ?? "",
  );
  const [uploadName, setUploadName] = useState("");
  const [uploadFloor, setUploadFloor] = useState("");
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadWestFile, setUploadWestFile] = useState<File | null>(null);
  const [uploadEastFile, setUploadEastFile] = useState<File | null>(null);
  const [splitUploadBySet, setSplitUploadBySet] = useState<
    Record<FloorPlanDrawingSet, boolean>
  >({
    architectural: false,
    mechanical: true,
  });
  const [onionOpacity, setOnionOpacity] = useState(0);
  const [editExpanded, setEditExpanded] = useState(false);
  const [selectedRegistrationMark, setSelectedRegistrationMark] = useState<
    "building" | "reference" | null
  >(null);
  const [compareExpanded, setCompareExpanded] = useState(false);

  useEffect(() => {
    setSelectedRegistrationMark(null);
  }, [selectedId]);
  const [registrationDraft, setRegistrationDraft] = useState(
    initial.settings.registrationLabel,
  );
  const [dragPlanId, setDragPlanId] = useState<string | null>(null);
  const [dropFamilyId, setDropFamilyId] = useState<string | null>(null);
  const [folderView, setFolderView] = useState(true);
  const [drawingSet, setDrawingSet] =
    useState<FloorPlanDrawingSet>("architectural");
  const splitUpload = splitUploadBySet[drawingSet];

  useEffect(() => {
    return () => clearPdfBufferCache();
  }, []);

  const visibleFamilies = useMemo(
    () => familiesOfDrawingSet(payload.families, drawingSet),
    [payload.families, drawingSet],
  );
  const visiblePlans = useMemo(
    () => plansOfDrawingSet(payload.plans, payload.families, drawingSet),
    [payload.plans, payload.families, drawingSet],
  );

  const selected = visiblePlans.find((plan) => plan.id === selectedId) ?? null;
  const selectedFamily = selected
    ? visibleFamilies.find((family) => family.id === selected.familyId) ?? null
    : null;

  const needsMerge = selected ? planNeedsMerge(selected) : false;

  const scale = useMemo(() => {
    if (!selected || !selectedFamily) return 1;
    if (needsMerge) {
      const sheets = splitSheetSizes(selected);
      if (sheets) {
        const offset = resolvedEastOffset(sheets.west, sheets.east, {
          x: selected.eastOffsetXPt,
          y: selected.eastOffsetYPt,
        });
        const canvas = splitCanvasLayout(sheets.west, sheets.east, offset);
        if (canvas.width > 0) {
          return Math.min(1.4, Math.max(0.35, 900 / canvas.width));
        }
      }
    }
    const pageWidth =
      mode === "edit"
        ? selected.originalPageWidthPt
        : selectedFamily.cropWidthPt ?? selected.originalPageWidthPt;
    if (pageWidth <= 0) return 1;
    return Math.min(1.4, Math.max(0.45, 900 / pageWidth));
  }, [selected, selectedFamily, mode, needsMerge]);

  const reloadGenerationRef = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++reloadGenerationRef.current;
    const next = await readJson<FloorPlansPayload>(
      await fetch("/api/building/floor-plans"),
    );
    if (generation === reloadGenerationRef.current) {
      setPayload(next);
    }
    return next;
  }, []);

  const mergePlan = useCallback((updated: FloorPlanDto) => {
    setPayload((current) => ({
      ...current,
      plans: current.plans.map((plan) =>
        plan.id === updated.id ? updated : plan,
      ),
    }));
  }, []);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  const createFamily = () =>
    run(async () => {
      const family = await readJson<FloorPlanFamilyDto>(
        await fetch("/api/building/floor-plan-families", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: familyName, kind: drawingSet }),
        }),
      );
      setFamilyName("");
      setUploadFamilyId(family.id);
      await reload();
    });

  const upload = (file = uploadFile) =>
    run(async () => {
      if (!uploadFamilyId) throw new Error("Create a family first.");
      if (splitUpload) {
        if (!uploadWestFile || !uploadEastFile) {
          throw new Error("Choose west and east PDF files.");
        }
        await assertFileLooksLikePdf(uploadWestFile, "West");
        await assertFileLooksLikePdf(uploadEastFile, "East");
        const stem =
          uploadName ||
          uploadWestFile.name.replace(/\.pdf$/i, "") ||
          uploadEastFile.name.replace(/\.pdf$/i, "");
        const parsed = parseFloorPlanName(stem);
        const floorNumber =
          parseFloorNumber(uploadFloor) ?? parsed.floorNumber;
        if (floorNumber == null) {
          throw new Error("Floor number is required.");
        }
        const form = new FormData();
        form.set("familyId", uploadFamilyId);
        form.set("name", parsed.name || stem);
        form.set("floorNumber", String(floorNumber));
        form.set("notes", uploadNotes);
        form.set("westFile", uploadWestFile);
        form.set("eastFile", uploadEastFile);
        const plan = await readJson<FloorPlanDto>(
          await fetch("/api/building/floor-plans", { method: "POST", body: form }),
        );
        setUploadName("");
        setUploadFloor("");
        setUploadNotes("");
        setUploadWestFile(null);
        setUploadEastFile(null);
        await reload();
        setSelectedId(plan.id);
        setMode("edit");
        return;
      }
      if (!file) throw new Error("Choose a PDF file.");
      await assertFileLooksLikePdf(file, "PDF");
      const stem = uploadName || file.name.replace(/\.pdf$/i, "");
      const parsed = parseFloorPlanName(stem);
      const floorNumber =
        parseFloorNumber(uploadFloor) ?? parsed.floorNumber;
      if (floorNumber == null) {
        throw new Error("Floor number is required.");
      }
      const form = new FormData();
      form.set("familyId", uploadFamilyId);
      form.set("name", parsed.name || stem);
      form.set("floorNumber", String(floorNumber));
      form.set("notes", uploadNotes);
      form.set("file", file);
      const plan = await readJson<FloorPlanDto>(
        await fetch("/api/building/floor-plans", { method: "POST", body: form }),
      );
      setUploadName("");
      setUploadFloor("");
      setUploadNotes("");
      setUploadFile(null);
      await reload();
      setSelectedId(plan.id);
      setMode("edit");
    });

  const movePlanToNewFamily = async (name: string) => {
    if (!selected) return;
    setError(null);
    try {
      const result = await readJson<{ plan: FloorPlanDto; family: FloorPlanFamilyDto }>(
        await fetch(`/api/building/floor-plans/${selected.id}/new-family`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }),
      );
      await reload();
      setSelectedId(result.plan.id);
      setMode("edit");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Request failed.";
      setError(message);
      throw caught;
    }
  };

  const saveMeta = (
    plan: FloorPlanDto,
    patch: { name?: string; notes?: string; floorNumber?: number },
  ) =>
    run(async () => {
      await readJson(
        await fetch(`/api/building/floor-plans/${plan.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }),
      );
      await reload();
    });

  const saveCrop = (crop: PdfRect) =>
    run(async () => {
      if (!selected) return;
      await readJson(
        await fetch(`/api/building/floor-plans/${selected.id}/crop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(crop),
        }),
      );
      await reload();
    });

  const savePin = (pin: PdfPoint) =>
    run(async () => {
      if (!selected) return;
      await readJson(
        await fetch(`/api/building/floor-plans/${selected.id}/pin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pin),
        }),
      );
      const hadCrop = selected.hasCropped;
      await reload();
      if (!hadCrop) setMode("edit");
    });

  const saveReferenceAnchor = (anchor: PdfPoint) =>
    run(async () => {
      if (!selected) return;
      await readJson(
        await fetch(`/api/building/floor-plans/${selected.id}/reference-anchor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(anchor),
        }),
      );
      await reload();
    });

  const setPinReferencePlan = (planId: string) =>
    run(async () => {
      await readJson(
        await fetch("/api/building/floor-plan-settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinReferencePlanId: planId }),
        }),
      );
      await reload();
    });

  const saveSplitAlign = async (draft: SplitAlignDraft) => {
    if (!selected) return;
    try {
      const updated = await readJson<FloorPlanDto>(
        await fetch(`/api/building/floor-plans/${selected.id}/split-align`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            x: draft.offset.x,
            y: draft.offset.y,
            westCrop: draft.westCrop,
            eastCrop: draft.eastCrop,
          }),
        }),
      );
      mergePlan(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save alignment.");
    }
  };

  const mergeSplit = (draft: SplitAlignDraft) =>
    run(async () => {
      if (!selected) return;
      const updated = await readJson<FloorPlanDto>(
        await fetch(`/api/building/floor-plans/${selected.id}/merge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            x: draft.offset.x,
            y: draft.offset.y,
            westCrop: draft.westCrop,
            eastCrop: draft.eastCrop,
          }),
        }),
      );
      mergePlan(updated);
      setMode("edit");
    });

  const saveAnnotations = async (annotations: FloorPlanAnnotation[]) => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await readJson<FloorPlanDto>(
        await fetch(`/api/building/floor-plans/${selectedId}/annotations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ annotations }),
        }),
      );
      mergePlan(updated);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Request failed.";
      setError(message);
      throw caught;
    } finally {
      setBusy(false);
    }
  };

  const setRegistrationPlan = (planId: string) =>
    run(async () => {
      await readJson(
        await fetch("/api/building/floor-plan-settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ registrationPlanId: planId }),
        }),
      );
      await reload();
    });

  const saveRegistration = () =>
    run(async () => {
      await readJson(
        await fetch("/api/building/floor-plan-settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ registrationLabel: registrationDraft }),
        }),
      );
      await reload();
    });

  const saveDrawColorPresets = useCallback(async (presets: DrawColorPreset[]) => {
    try {
      const updated = await readJson<FloorPlanSettingsDto>(
        await fetch("/api/building/floor-plan-settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ drawColorPresets: presets }),
        }),
      );
      setPayload((current) => ({ ...current, settings: updated }));
      setError(null);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not save color presets.";
      setError(message);
      throw caught;
    }
  }, []);

  const ensureMechanicalRiser = useCallback(
    async (typeId: string, label: string) => {
      try {
        const result = await readJson<{
          riser: { id: string; typeId: string; label: string };
          risers: FloorPlanSettingsDto["mechanicalRisers"];
        }>(
          await fetch("/api/building/mechanical-risers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ typeId, label }),
          }),
        );
        setPayload((current) => ({
          ...current,
          settings: {
            ...current.settings,
            mechanicalRisers: result.risers,
          },
        }));
        setError(null);
        return result;
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "Could not save riser.";
        setError(message);
        throw caught;
      }
    },
    [],
  );

  const updateMechanicalRiser = useCallback(
    async (id: string, completed: boolean) => {
      try {
        const result = await readJson<{
          riser: FloorPlanSettingsDto["mechanicalRisers"][number];
          risers: FloorPlanSettingsDto["mechanicalRisers"];
        }>(
          await fetch("/api/building/mechanical-risers", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, completed }),
          }),
        );
        setPayload((current) => ({
          ...current,
          settings: {
            ...current.settings,
            mechanicalRisers: result.risers,
          },
        }));
        setError(null);
        return result;
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "Could not update riser.";
        setError(message);
        throw caught;
      }
    },
    [],
  );

  const reclassifyMechanicalRisers = useCallback(
    async (ids: string[], typeId: string) => {
      try {
        const result = await readJson<{
          risers: MechanicalRiserDto[];
          rewrite: RiserIdRewrite;
          updatedPlans: FloorPlanDto[];
        }>(
          await fetch("/api/building/mechanical-risers", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids, typeId }),
          }),
        );
        setPayload((current) => ({
          ...current,
          settings: {
            ...current.settings,
            mechanicalRisers: result.risers,
          },
          plans: current.plans.map(
            (plan) =>
              result.updatedPlans.find((updated) => updated.id === plan.id) ??
              plan,
          ),
        }));
        setError(null);
        return result;
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : "Could not reclassify riser.";
        setError(message);
        throw caught;
      }
    },
    [],
  );

  const standardizeMechanicalRisers = useCallback(
    async (params: {
      typeId: string;
      template: RiserTypeTemplate;
      planIds?: string[];
      autoOrient?: boolean;
    }) => {
      try {
        const result = await readJson<{
          ok: boolean;
          replacedCount: number;
          affectedPlanIds: string[];
          templates: Record<string, RiserTypeTemplate>;
          updatedPlans: FloorPlanDto[];
        }>(
          await fetch("/api/building/mechanical-risers/standardize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          }),
        );
        setPayload((current) => ({
          ...current,
          settings: {
            ...current.settings,
            riserTemplates: result.templates,
          },
          plans: current.plans.map(
            (plan) =>
              result.updatedPlans.find((updated) => updated.id === plan.id) ??
              plan,
          ),
        }));
        setError(null);
        return result;
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : "Could not standardize risers.";
        setError(message);
        throw caught;
      }
    },
    [],
  );

  const removePlan = (plan: FloorPlanDto) =>
    run(async () => {
      await readJson(
        await fetch(`/api/building/floor-plans/${plan.id}`, { method: "DELETE" }),
      );
      const next = await reload();
      setSelectedId((current) =>
        current === plan.id ? next.plans[0]?.id ?? null : current,
      );
    });

  const removeFamily = (family: FloorPlanFamilyDto) =>
    run(async () => {
      await readJson(
        await fetch(`/api/building/floor-plan-families/${family.id}`, {
          method: "DELETE",
        }),
      );
      const next = await reload();
      setUploadFamilyId(next.families[0]?.id ?? "");
      setSelectedId(next.plans[0]?.id ?? null);
    });

  const moveFamily = (family: FloorPlanFamilyDto, direction: -1 | 1) =>
    run(async () => {
      // Reorder within the active drawing set only — global sort_order is shared
      // across architectural and mechanical families.
      const sorted = [...visibleFamilies].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      );
      const index = sorted.findIndex((item) => item.id === family.id);
      const neighbor = sorted[index + direction];
      if (!neighbor) return;

      const familySortOrder = family.sortOrder;
      const neighborSortOrder = neighbor.sortOrder;
      if (familySortOrder === neighborSortOrder) {
        await readJson(
          await fetch(`/api/building/floor-plan-families/${family.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sortOrder: neighborSortOrder + direction,
            }),
          }),
        );
      } else {
        await readJson(
          await fetch(`/api/building/floor-plan-families/${family.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sortOrder: neighborSortOrder }),
          }),
        );
        await readJson(
          await fetch(`/api/building/floor-plan-families/${neighbor.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sortOrder: familySortOrder }),
          }),
        );
      }
      await reload();
    });

  const changePlanFamily = useCallback(
    async (planId: string, familyId: string) => {
      const plan = payload.plans.find((item) => item.id === planId);
      if (!plan || plan.familyId === familyId) return;
      try {
        const updated = await readJson<FloorPlanDto>(
          await fetch(`/api/building/floor-plans/${planId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ familyId }),
          }),
        );
        mergePlan(updated);
        setError(null);
        setMode("edit");
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "Request failed.";
        setError(message);
        throw caught;
      }
    },
    [mergePlan, payload.plans],
  );

  const movePlanToFamily = useCallback(
    (plan: FloorPlanDto, familyId: string) => {
      void run(async () => {
        await changePlanFamily(plan.id, familyId);
      });
    },
    [changePlanFamily, run],
  );

  const preventDragDefaults = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const beginPlanDrag = useCallback(
    (planId: string, event: DragEvent) => {
      if (busy) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", planId);
      setDragPlanId(planId);
    },
    [busy],
  );

  const endPlanDrag = useCallback(() => {
    setDragPlanId(null);
    setDropFamilyId(null);
  }, []);

  const acceptPlanDrop = useCallback(
    (familyId: string, event: DragEvent) => {
      preventDragDefaults(event);
      const planId = event.dataTransfer.getData("text/plain") || dragPlanId;
      const plan = payload.plans.find((item) => item.id === planId);
      endPlanDrag();
      if (!plan || plan.familyId === familyId) return;
      void movePlanToFamily(plan, familyId);
    },
    [dragPlanId, endPlanDrag, movePlanToFamily, payload.plans, preventDragDefaults],
  );

  const compareReady =
    buildingComparePlans(visiblePlans, visibleFamilies).length > 0;

  const selectedCompareable =
    !!selected &&
    selected.hasCropped &&
    planHasPin(selected) &&
    !planNeedsMerge(selected);

  const effectiveMode: Mode = (() => {
    if (!selected) return mode;
    if (needsMerge) return "edit";
    if (mode === "compare" && !compareReady) return "edit";
    return mode;
  })();

  const editNeighbors = selected
    ? globalPlanNeighbors(visiblePlans, selected.id)
    : { prevId: null, nextId: null };

  const switchDrawingSet = (
    next: FloorPlanDrawingSet,
    options?: { preserveModal?: boolean; matchFloorNumber?: number | null },
  ) => {
    if (next === drawingSet) return;
    const nextFamilies = familiesOfDrawingSet(payload.families, next);
    const nextPlans = plansOfDrawingSet(payload.plans, payload.families, next);
    setDrawingSet(next);
    if (!options?.preserveModal) {
      setEditExpanded(false);
      setCompareExpanded(false);
    }
    setMode("edit");
    setUploadFamilyId(nextFamilies[0]?.id ?? "");
    const floorNumber =
      options?.matchFloorNumber ?? selected?.floorNumber ?? null;
    let nextSelectedId = nextPlans[0]?.id ?? null;
    if (floorNumber != null) {
      const matching = planForDrawingSetFloor(
        payload.plans,
        payload.families,
        next,
        floorNumber,
        selected ? { preferName: selected.name } : undefined,
      );
      if (matching) nextSelectedId = matching.id;
    }
    setSelectedId(nextSelectedId);
  };

  const switchDrawingSetInModal = (next: FloorPlanDrawingSet) => {
    switchDrawingSet(next, {
      preserveModal: true,
      matchFloorNumber: selected?.floorNumber ?? null,
    });
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="shrink-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Building model
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">Floor plans</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Upload one PDF per level. Place the building pin, crop to the plate,
          and compare floors — toggle architectural or mechanical drawings, then
          pin and crop. Split floors (common on parking levels) upload as east +
          west sheets: overlap until the cores line up, crop each sheet to
          building content, and merge into one drawing.
        </p>
      </div>

      {error ? (
        <p className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        <aside className="flex min-h-0 w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-anchor-none p-3">
          <div className="flex flex-wrap items-center gap-2">
            <ModeButton
              active={effectiveMode === "edit"}
              disabled={!selected}
              onClick={() => {
                setCompareExpanded(false);
                setMode("edit");
              }}
            >
              Edit
            </ModeButton>
            <ModeButton
              active={effectiveMode === "compare"}
              disabled={!compareReady}
              onClick={() => {
                setEditExpanded(false);
                setCompareExpanded(false);
                setMode("compare");
                if (!selectedCompareable) {
                  const first = buildingComparePlans(
                    visiblePlans,
                    visibleFamilies,
                  )[0];
                  if (first) setSelectedId(first.id);
                }
              }}
            >
              Compare
            </ModeButton>
            {effectiveMode === "compare" ? (
              <button
                type="button"
                disabled={!compareReady}
                onClick={() => setCompareExpanded(true)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                aria-label="Open compare session"
                title="Full screen"
              >
                <FloorPlanExpandIcon />
                Expand
              </button>
            ) : effectiveMode === "edit" ? (
              <button
                type="button"
                disabled={!selected}
                onClick={() => setEditExpanded(true)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                aria-label="Expand editor"
                title="Full screen"
              >
                <FloorPlanExpandIcon />
                Expand
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ModeButton
              active={drawingSet === "architectural"}
              onClick={() => switchDrawingSet("architectural")}
            >
              Architectural
            </ModeButton>
            <ModeButton
              active={drawingSet === "mechanical"}
              onClick={() => switchDrawingSet("mechanical")}
            >
              Mechanical
            </ModeButton>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              Registration point
            </label>
            <input
              value={registrationDraft}
              onChange={(event) => setRegistrationDraft(event.target.value)}
              onBlur={() => {
                if (registrationDraft !== payload.settings.registrationLabel) {
                  void saveRegistration();
                }
              }}
              placeholder="NW corner of Elevator A"
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Families
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={folderView}
                  onChange={(event) => {
                    setFolderView(event.target.checked);
                  }}
                  className="rounded border-slate-300"
                />
                Folder view
              </label>
            </div>
            <div className="flex gap-2">
              <input
                value={familyName}
                onChange={(event) => setFamilyName(event.target.value)}
                placeholder={
                  drawingSet === "mechanical"
                    ? "New family (e.g. Mechanical tower)"
                    : "New family (e.g. Parking)"
                }
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={busy || !familyName.trim()}
                onClick={() => void createFamily()}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {visibleFamilies.length === 0 ? (
            <p className="text-sm text-slate-500">
              {splitUpload
                ? drawingSet === "mechanical"
                  ? "Add a mechanical family, then upload east and west PDFs for split floors."
                  : "Add a family, then upload east and west PDFs for split floors."
                : drawingSet === "mechanical"
                  ? "Add a mechanical family, then upload one PDF per floor."
                  : "Add a family, then upload one PDF per floor."}
            </p>
          ) : null}

          {folderView ? (
            [...visibleFamilies]
            .sort(
              (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
            )
            .map((family, familyIndex, sortedFamilies) => {
            const plans = payload.plans
              .filter((plan) => plan.familyId === family.id)
              .sort(
                (a, b) =>
                  a.floorNumber - b.floorNumber ||
                  a.name.localeCompare(b.name),
              );
            const canMoveFamilyUp = familyIndex > 0;
            const canMoveFamilyDown = familyIndex < sortedFamilies.length - 1;
            const isDropTarget =
              dropFamilyId === family.id &&
              dragPlanId != null &&
              payload.plans.find((plan) => plan.id === dragPlanId)?.familyId !==
                family.id;
            return (
              <div
                key={family.id}
                className={`space-y-2 rounded-lg transition ${
                  isDropTarget ? "bg-sky-50 ring-2 ring-sky-400 ring-inset" : ""
                }`}
                onDragEnter={(event) => {
                  preventDragDefaults(event);
                  if (
                    dragPlanId &&
                    payload.plans.find((plan) => plan.id === dragPlanId)?.familyId !==
                      family.id
                  ) {
                    setDropFamilyId(family.id);
                  }
                }}
                onDragOver={(event) => {
                  preventDragDefaults(event);
                  if (
                    dragPlanId &&
                    payload.plans.find((plan) => plan.id === dragPlanId)?.familyId !==
                      family.id
                  ) {
                    event.dataTransfer.dropEffect = "move";
                    setDropFamilyId(family.id);
                  }
                }}
                onDragLeave={(event) => {
                  preventDragDefaults(event);
                  const next = event.currentTarget;
                  if (!next.contains(event.relatedTarget as Node)) {
                    setDropFamilyId((current) =>
                      current === family.id ? null : current,
                    );
                  }
                }}
                onDrop={(event) => acceptPlanDrop(family.id, event)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    defaultValue={family.name}
                    key={family.name}
                    onBlur={(event) => {
                      const name = event.target.value.trim();
                      if (!name || name === family.name) return;
                      void run(async () => {
                        await readJson(
                          await fetch(
                            `/api/building/floor-plan-families/${family.id}`,
                            {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ name }),
                            },
                          ),
                        );
                        await reload();
                      });
                    }}
                    className="min-w-0 flex-1 rounded border border-transparent px-1 text-sm font-semibold text-slate-900 hover:border-slate-300"
                  />
                  <label
                    className="flex shrink-0 items-center gap-1 text-xs text-slate-500"
                    title="Architectural drawing scale for this family (e.g. 150 for 1:150 podium, 50 for 1:50 tower)"
                  >
                    <span>1:</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      defaultValue={family.scaleDenominator ?? ""}
                      key={`${family.id}-scale-${family.scaleDenominator ?? "none"}`}
                      placeholder="—"
                      onBlur={(event) => {
                        const raw = event.target.value.trim();
                        const next =
                          raw === "" ? null : Number.parseInt(raw, 10);
                        if (
                          raw !== "" &&
                          (next == null || !Number.isFinite(next) || next <= 0)
                        ) {
                          return;
                        }
                        if (next === family.scaleDenominator) return;
                        void run(async () => {
                          await readJson(
                            await fetch(
                              `/api/building/floor-plan-families/${family.id}`,
                              {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ scaleDenominator: next }),
                              },
                            ),
                          );
                          await reload();
                        });
                      }}
                      className="w-14 rounded border border-slate-200 px-1 py-0.5 text-xs text-slate-700"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || !canMoveFamilyUp}
                    className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-30"
                    onClick={() => void moveFamily(family, -1)}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    disabled={busy || !canMoveFamilyDown}
                    className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-30"
                    onClick={() => void moveFamily(family, 1)}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    className="text-xs text-slate-400 hover:text-red-700"
                    onClick={() => void removeFamily(family)}
                  >
                    Delete
                  </button>
                </div>
                {plans.length === 0 && isDropTarget ? (
                  <p className="px-2 py-3 text-center text-xs text-sky-700">
                    Drop here to move into {family.name}
                  </p>
                ) : null}
                {plans.map((plan) => (
                  <FloorPlanRow
                    key={plan.id}
                    plan={plan}
                    settings={payload.settings}
                    selectedId={selectedId}
                    busy={busy}
                    dragPlanId={dragPlanId}
                    draggable={!busy}
                    onSelect={() => {
                      setSelectedId(plan.id);
                      setEditExpanded(false);
                      setCompareExpanded(false);
                    }}
                    onDragStart={(event) => beginPlanDrag(plan.id, event)}
                    onDragEnd={endPlanDrag}
                    onSaveMeta={saveMeta}
                    onRemove={() => void removePlan(plan)}
                  />
                ))}
              </div>
            );
          })
          ) : (
            <FlatFloorPlanList
              payload={{
                ...payload,
                families: visibleFamilies,
                plans: visiblePlans,
              }}
              selectedId={selectedId}
              busy={busy}
              dragPlanId={dragPlanId}
              onSelect={(planId) => {
                setSelectedId(planId);
                setEditExpanded(false);
                setCompareExpanded(false);
              }}
              onSaveMeta={saveMeta}
              onRemovePlan={(plan) => void removePlan(plan)}
              onMoveFamily={(family, direction) => void moveFamily(family, direction)}
              onRemoveFamily={(family) => void removeFamily(family)}
              onRun={run}
              onReload={reload}
              onChangePlanFamily={changePlanFamily}
            />
          )}
          </div>

          <div className="shrink-0 space-y-2 border-t border-slate-200 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {splitUpload ? "Upload east + west PDFs" : "Upload PDF"}
            </p>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={splitUpload}
                onChange={(event) => {
                  const split = event.target.checked;
                  setSplitUploadBySet((current) => ({
                    ...current,
                    [drawingSet]: split,
                  }));
                  if (split) {
                    setUploadFile(null);
                  } else {
                    setUploadWestFile(null);
                    setUploadEastFile(null);
                  }
                }}
                className="rounded border-slate-300"
              />
              East + west sheets per floor
            </label>
            <select
              value={uploadFamilyId}
              onChange={(event) => setUploadFamilyId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Select family</option>
              {visibleFamilies.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                value={uploadName}
                onChange={(event) => setUploadName(event.target.value)}
                placeholder={
                  drawingSet === "mechanical"
                    ? "Drawing name (M212)"
                    : "Drawing name (An212)"
                }
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
              <input
                value={uploadFloor}
                onChange={(event) => setUploadFloor(event.target.value)}
                inputMode="numeric"
                placeholder="Floor"
                aria-label="Floor number"
                className="w-16 shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm tabular-nums"
              />
            </div>
            <textarea
              value={uploadNotes}
              onChange={(event) => setUploadNotes(event.target.value)}
              placeholder="Notes (optional)"
              rows={1}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            {splitUpload ? (
              <div className="grid grid-cols-2 gap-2">
                <PdfDropZone
                  file={uploadWestFile}
                  label="West PDF"
                  disabled={busy}
                  onFile={(file) => {
                    setUploadWestFile(file);
                    const stem = file.name.replace(/\.pdf$/i, "");
                    const parsed = parseFloorPlanName(stem);
                    if (!uploadName.trim()) setUploadName(parsed.name);
                    if (!uploadFloor.trim() && parsed.floorNumber != null) {
                      setUploadFloor(String(parsed.floorNumber));
                    }
                  }}
                />
                <PdfDropZone
                  file={uploadEastFile}
                  label="East PDF"
                  disabled={busy}
                  onFile={(file) => {
                    setUploadEastFile(file);
                    const stem = file.name.replace(/\.pdf$/i, "");
                    const parsed = parseFloorPlanName(stem);
                    if (!uploadName.trim()) setUploadName(parsed.name);
                    if (!uploadFloor.trim() && parsed.floorNumber != null) {
                      setUploadFloor(String(parsed.floorNumber));
                    }
                  }}
                />
              </div>
            ) : (
              <PdfDropZone
                file={uploadFile}
                disabled={busy}
                onFile={(file) => {
                  setUploadFile(file);
                  const stem = file.name.replace(/\.pdf$/i, "");
                  const parsed = parseFloorPlanName(stem);
                  if (!uploadName.trim()) {
                    setUploadName(parsed.name);
                  }
                  if (!uploadFloor.trim() && parsed.floorNumber != null) {
                    setUploadFloor(String(parsed.floorNumber));
                  }
                }}
              />
            )}
            <button
              type="button"
              disabled={
                busy ||
                !uploadFamilyId ||
                (splitUpload
                  ? !uploadWestFile ||
                    !uploadEastFile ||
                    (parseFloorNumber(uploadFloor) == null &&
                      parseFloorPlanName(
                        uploadName ||
                          uploadWestFile.name.replace(/\.pdf$/i, ""),
                      ).floorNumber == null)
                  : !uploadFile ||
                    (parseFloorNumber(uploadFloor) == null &&
                      parseFloorPlanName(
                        uploadName || uploadFile.name.replace(/\.pdf$/i, ""),
                      ).floorNumber == null))
              }
              onClick={() => void upload()}
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {busy ? "Working…" : "Upload"}
            </button>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
          {!selected || !selectedFamily ? (
            <p className="m-auto text-sm text-slate-500">
              {splitUpload
                ? "Select or upload east and west sheets to align, merge, pin, and compare."
                : drawingSet === "mechanical"
                  ? "Select or upload a mechanical floor plan to crop, pin, and compare."
                  : "Select or upload a floor plan to crop, pin, and compare."}
            </p>
          ) : (
            <>
              {effectiveMode === "edit" && needsMerge ? (
                <FloorPlanExpandedShell
                  mounted={editExpanded}
                  planName={floorPlanLabel(selected)}
                  familyName={selectedFamily.name}
                  drawingSet={drawingSet}
                  onDrawingSetChange={switchDrawingSetInModal}
                  prevPlanId={editNeighbors.prevId}
                  nextPlanId={editNeighbors.nextId}
                  onSelectPlan={setSelectedId}
                  onClose={() => setEditExpanded(false)}
                  enableFloorKeys={false}
                >
                  <FloorPlanSplitAlignEditor
                    key={`${selected.id}-split`}
                    plan={selected}
                    scale={scale}
                    saving={busy}
                    expanded={editExpanded}
                    embeddedExpanded={editExpanded}
                    onExpandedChange={setEditExpanded}
                    onSaveAlign={saveSplitAlign}
                    onMerge={mergeSplit}
                  />
                </FloorPlanExpandedShell>
              ) : null}
              {effectiveMode === "edit" && !needsMerge ? (
                <FloorPlanExpandedShell
                  mounted={editExpanded}
                  planName={floorPlanLabel(selected)}
                  familyName={selectedFamily.name}
                  drawingSet={drawingSet}
                  onDrawingSetChange={switchDrawingSetInModal}
                  prevPlanId={editNeighbors.prevId}
                  nextPlanId={editNeighbors.nextId}
                  onSelectPlan={setSelectedId}
                  onClose={() => setEditExpanded(false)}
                  enableFloorKeys={!selectedRegistrationMark}
                >
                  <FloorPlanCropEditor
                    key={`${selected.id}-edit`}
                    plan={selected}
                    family={selectedFamily}
                    settings={payload.settings}
                    plans={visiblePlans}
                    families={visibleFamilies}
                    allPlans={payload.plans}
                    allFamilies={payload.families}
                    drawingSet={drawingSet}
                    scale={scale}
                    onSave={saveCrop}
                    onSavePin={savePin}
                    onSaveReferenceAnchor={saveReferenceAnchor}
                    onSaveAnnotations={saveAnnotations}
                    onSaveDrawColorPresets={saveDrawColorPresets}
                    onEnsureMechanicalRiser={ensureMechanicalRiser}
                    onUpdateMechanicalRiser={updateMechanicalRiser}
                    onReclassifyMechanicalRisers={reclassifyMechanicalRisers}
                    onStandardizeMechanicalRisers={standardizeMechanicalRisers}
                    onSetRegistrationPlan={setRegistrationPlan}
                    onSetPinReferencePlan={setPinReferencePlan}
                    onMoveToNewFamily={movePlanToNewFamily}
                    onSelectPlan={setSelectedId}
                    saving={busy}
                    expanded={editExpanded}
                    embeddedExpanded={editExpanded}
                    onExpandedChange={setEditExpanded}
                    onSelectedMarkChange={setSelectedRegistrationMark}
                  />
                </FloorPlanExpandedShell>
              ) : null}
              {effectiveMode === "compare" && selectedCompareable && selectedFamily ? (
                <FloorPlanCompareViewer
                  plan={selected}
                  family={selectedFamily}
                  plans={visiblePlans}
                  families={visibleFamilies}
                  allPlans={payload.plans}
                  allFamilies={payload.families}
                  colorPresets={payload.settings.drawColorPresets}
                  registrationPlanId={payload.settings.registrationPlanId}
                  onionOpacity={onionOpacity}
                  onOnionOpacity={setOnionOpacity}
                  expanded={compareExpanded}
                  onExpandedChange={setCompareExpanded}
                  onSelectPlan={(id) => {
                    setSelectedId(id);
                    setMode("compare");
                  }}
                />
              ) : null}
              {effectiveMode === "compare" && !selectedCompareable ? (
                <p className="m-auto text-sm text-slate-500">
                  {compareReady
                    ? selected && planNeedsMerge(selected)
                      ? "Select a merged floor with a pin and crop, or use Previous / Next."
                      : "Select a cropped floor with a pin, or use Previous / Next to flip through the building."
                    : "Merge, pin, and crop at least one floor to start comparing."}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function FloorPlanStatusBadges({
  plan,
  settings,
}: {
  plan: FloorPlanDto;
  settings: FloorPlanSettingsDto;
}) {
  const pinned = planHasPin(plan);
  const cropped = plan.hasCropped;
  const unmerged = planNeedsMerge(plan);
  const buildingPinSource = isBuildingPinSource(plan, settings);

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {unmerged ? (
        <FloorPlanStatusIcon
          title="East/west not merged"
          done={false}
          icon={<MergeIcon className="h-3 w-3" />}
        />
      ) : (
        <>
          {buildingPinSource ? (
            <span
              title="Building pin location"
              className="inline-flex rounded-full bg-amber-50 p-0.5 text-amber-700"
            >
              <BuildingPinIcon className="h-3 w-3" />
            </span>
          ) : null}
          <FloorPlanStatusIcon
            title={pinned ? "Pin saved" : "Pin not saved"}
            done={pinned}
            icon={<PlanPinIcon className="h-3 w-3" />}
          />
          <FloorPlanStatusIcon
            title={cropped ? "Crop saved" : "Crop not saved"}
            done={cropped}
            icon={<CropIcon className="h-3 w-3" />}
          />
        </>
      )}
    </div>
  );
}

function FloorPlanStatusIcon({
  title,
  done,
  icon,
}: {
  title: string;
  done: boolean;
  icon: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex rounded-full p-0.5 ${
        done
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-400"
      }`}
    >
      {icon}
    </span>
  );
}

function FloorPlanRow({
  plan,
  settings,
  selectedId,
  busy,
  dragPlanId,
  draggable,
  familyBadge,
  onSelect,
  onDragStart,
  onDragEnd,
  onSaveMeta,
  onRemove,
  familySelector,
}: {
  plan: FloorPlanDto;
  settings: FloorPlanSettingsDto;
  selectedId: string | null;
  busy: boolean;
  dragPlanId: string | null;
  draggable: boolean;
  familyBadge?: ReactNode;
  onSelect: () => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  onSaveMeta: (
    plan: FloorPlanDto,
    patch: { name?: string; notes?: string; floorNumber?: number },
  ) => void;
  onRemove: () => void;
  familySelector?: ReactNode;
}) {
  const buildingPinSource = isBuildingPinSource(plan, settings);
  const selected = plan.id === selectedId;

  return (
    <div
      className={`rounded-lg border px-2 py-2 ${
        selected ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-white"
      } ${buildingPinSource ? "border-l-2 border-l-amber-400" : ""} ${
        dragPlanId === plan.id ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-start gap-1">
        {draggable ? (
          <button
            type="button"
            draggable={!busy}
            aria-label={`Drag ${floorPlanLabel(plan)}`}
            title="Drag to move family"
            className="mt-0.5 shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
            disabled={busy}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={(event) => event.stopPropagation()}
          >
            <PlanDragIcon />
          </button>
        ) : null}
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onSelect}
        >
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium text-slate-900">
              {plan.name}
            </span>
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-slate-600">
              Floor {plan.floorNumber}
            </span>
            {familyBadge}
            <span className="ml-auto">
              <FloorPlanStatusBadges plan={plan} settings={settings} />
            </span>
          </div>
        </button>
      </div>
      {selected ? (
        <div className="mt-2 space-y-2">
          {familySelector}
          <div className="flex gap-2">
            <input
              defaultValue={plan.name}
              key={`${plan.id}-name-${plan.updatedAt}`}
              placeholder="Drawing name"
              aria-label="Drawing name"
              onBlur={(event) => {
                const name = event.target.value.trim();
                if (name && name !== plan.name) {
                  void onSaveMeta(plan, { name });
                }
              }}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
            <input
              type="number"
              step={1}
              defaultValue={plan.floorNumber}
              key={`${plan.id}-floor-${plan.updatedAt}`}
              placeholder="Floor"
              aria-label="Floor number"
              onBlur={(event) => {
                const next = parseFloorNumber(event.target.value);
                if (next == null || next === plan.floorNumber) {
                  event.target.value = String(plan.floorNumber);
                  return;
                }
                void onSaveMeta(plan, { floorNumber: next });
              }}
              className="w-16 shrink-0 rounded-lg border border-slate-300 px-2 py-1 text-sm tabular-nums"
            />
          </div>
          <textarea
            defaultValue={plan.notes}
            key={`${plan.id}-notes-${plan.updatedAt}`}
            rows={2}
            placeholder="Notes"
            onBlur={(event) => {
              if (event.target.value !== plan.notes) {
                void onSaveMeta(plan, { notes: event.target.value });
              }
            }}
            className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            {plan.hasCropped ? (
              <a
                href={floorPlanFileUrl(plan.id, "cropped", plan.updatedAt)}
                className="text-xs text-sky-700 hover:underline"
              >
                Cropped PDF
              </a>
            ) : null}
            <button
              type="button"
              className="ml-auto text-xs text-red-600 hover:underline"
              onClick={onRemove}
            >
              Remove
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FlatFloorPlanList({
  payload,
  selectedId,
  busy,
  dragPlanId,
  onSelect,
  onSaveMeta,
  onRemovePlan,
  onMoveFamily,
  onRemoveFamily,
  onRun,
  onReload,
  onChangePlanFamily,
}: {
  payload: FloorPlansPayload;
  selectedId: string | null;
  busy: boolean;
  dragPlanId: string | null;
  onSelect: (planId: string) => void;
  onSaveMeta: (
    plan: FloorPlanDto,
    patch: { name?: string; notes?: string; floorNumber?: number },
  ) => void;
  onRemovePlan: (plan: FloorPlanDto) => void;
  onMoveFamily: (family: FloorPlanFamilyDto, direction: -1 | 1) => void;
  onRemoveFamily: (family: FloorPlanFamilyDto) => void;
  onRun: (action: () => Promise<void>) => void;
  onReload: () => Promise<FloorPlansPayload>;
  onChangePlanFamily: (planId: string, familyId: string) => Promise<void>;
}) {
  const sortedFamilies = [...payload.families].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
  const familyColorMap = new Map(
    sortedFamilies.map((family, index) => [family.id, familyBadgeColor(index)]),
  );
  const orderedPlans = [...payload.plans].sort(
    (a, b) =>
      a.floorNumber - b.floorNumber || a.name.localeCompare(b.name),
  );

  return (
    <div className="space-y-3">
      <details className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
        <summary className="cursor-pointer text-xs font-medium text-slate-600">
          Manage families ({sortedFamilies.length})
        </summary>
        <div className="mt-2 space-y-2">
          {sortedFamilies.map((family, familyIndex, allFamilies) => (
            <div key={family.id} className="flex flex-wrap items-center gap-2">
              <FloorPlanFamilyBadge
                name={family.name}
                colorClass={familyColorMap.get(family.id) ?? familyBadgeColor(0)}
              />
              <input
                defaultValue={family.name}
                key={family.name}
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (!name || name === family.name) return;
                  void onRun(async () => {
                    await readJson(
                      await fetch(
                        `/api/building/floor-plan-families/${family.id}`,
                        {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ name }),
                        },
                      ),
                    );
                    await onReload();
                  });
                }}
                className="min-w-0 flex-1 rounded border border-slate-200 px-1 py-0.5 text-xs text-slate-700"
              />
              <label className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
                <span>1:</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={family.scaleDenominator ?? ""}
                  key={`${family.id}-scale-${family.scaleDenominator ?? "none"}`}
                  placeholder="—"
                  onBlur={(event) => {
                    const raw = event.target.value.trim();
                    const next = raw === "" ? null : Number.parseInt(raw, 10);
                    if (
                      raw !== "" &&
                      (next == null || !Number.isFinite(next) || next <= 0)
                    ) {
                      return;
                    }
                    if (next === family.scaleDenominator) return;
                    void onRun(async () => {
                      await readJson(
                        await fetch(
                          `/api/building/floor-plan-families/${family.id}`,
                          {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ scaleDenominator: next }),
                          },
                        ),
                      );
                      await onReload();
                    });
                  }}
                  className="w-12 rounded border border-slate-200 px-1 py-0.5 text-xs"
                />
              </label>
              <button
                type="button"
                disabled={busy || familyIndex === 0}
                className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-30"
                onClick={() => onMoveFamily(family, -1)}
              >
                Up
              </button>
              <button
                type="button"
                disabled={busy || familyIndex === allFamilies.length - 1}
                className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-30"
                onClick={() => onMoveFamily(family, 1)}
              >
                Down
              </button>
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-red-700"
                onClick={() => onRemoveFamily(family)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </details>

      <div className="space-y-2">
        {orderedPlans.length === 0 ? (
          <p className="text-sm text-slate-500">Upload floor plans to get started.</p>
        ) : null}
        {orderedPlans.map((plan) => {
          const family = payload.families.find((item) => item.id === plan.familyId);
          const badgeColor =
            familyColorMap.get(plan.familyId) ?? familyBadgeColor(0);
          return (
            <FloorPlanRow
              key={plan.id}
              plan={plan}
              settings={payload.settings}
              selectedId={selectedId}
              busy={busy}
              dragPlanId={dragPlanId}
              draggable={false}
              familyBadge={
                family ? (
                  <FloorPlanFamilyBadge name={family.name} colorClass={badgeColor} />
                ) : null
              }
              onSelect={() => onSelect(plan.id)}
              onDragStart={() => {}}
              onDragEnd={() => {}}
              onSaveMeta={onSaveMeta}
              onRemove={() => onRemovePlan(plan)}
              familySelector={
                <FloorPlanFamilySelect
                  planId={plan.id}
                  familyId={plan.familyId}
                  families={sortedFamilies}
                  onChange={onChangePlanFamily}
                />
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function FloorPlanFamilySelect({
  planId,
  familyId,
  families,
  onChange,
}: {
  planId: string;
  familyId: string;
  families: FloorPlanFamilyDto[];
  onChange: (planId: string, familyId: string) => Promise<void>;
}) {
  const [value, setValue] = useState(familyId);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setValue(familyId);
  }, [familyId, planId]);

  return (
    <select
      value={value}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value;
        if (next === value) return;
        setValue(next);
        setPending(true);
        void onChange(planId, next)
          .catch(() => {
            setValue(familyId);
          })
          .finally(() => {
            setPending(false);
          });
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:opacity-60"
    >
      {families.map((family) => (
        <option key={family.id} value={family.id}>
          {family.name}
        </option>
      ))}
    </select>
  );
}

function MergeIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="1.5" y="3" width="6" height="10" rx="1" />
      <rect x="8.5" y="3" width="6" height="10" rx="1" />
    </svg>
  );
}

function BuildingPinIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={className}
      fill="currentColor"
    >
      <path d="M8 1.25a3.25 3.25 0 0 0-3.25 3.25c0 2.44 3.25 6.5 3.25 6.5s3.25-4.06 3.25-6.5A3.25 3.25 0 0 0 8 1.25Zm0 4.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" />
    </svg>
  );
}

function PlanPinIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="6" r="2.5" />
      <path d="M8 8.5V14" strokeLinecap="round" />
    </svg>
  );
}

function CropIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M2.5 5.5h10M2.5 10.5h10M5.5 2.5v10M10.5 2.5v10" strokeLinecap="round" />
    </svg>
  );
}

function PlanDragIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={className}
      fill="currentColor"
    >
      <circle cx="5" cy="4" r="1.25" />
      <circle cx="11" cy="4" r="1.25" />
      <circle cx="5" cy="8" r="1.25" />
      <circle cx="11" cy="8" r="1.25" />
      <circle cx="5" cy="12" r="1.25" />
      <circle cx="11" cy="12" r="1.25" />
    </svg>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
        active
          ? "bg-slate-900 text-white"
          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function isPdfFile(file: File): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

function PdfDropZone({
  file,
  disabled,
  onFile,
  label = "Drop PDF here",
}: {
  file: File | null;
  disabled: boolean;
  onFile: (file: File) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const preventDefaults = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const takeFile = useCallback(
    (next: File | undefined) => {
      if (!next || disabled) return;
      if (!isPdfFile(next)) return;
      onFile(next);
    },
    [disabled, onFile],
  );

  const openPicker = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label={`${label}. Drop a PDF or activate to browse files.`}
        className={`flex cursor-pointer flex-col rounded-lg border-2 border-dashed px-3 py-4 text-center text-sm transition ${
          dragOver
            ? "border-sky-400 bg-sky-50"
            : "border-slate-300 bg-slate-50 hover:border-sky-400 hover:bg-sky-50/60"
        } ${disabled ? "pointer-events-none opacity-60" : ""}`}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        onClick={openPicker}
        onDragEnter={(event) => {
          preventDefaults(event);
          setDragOver(true);
        }}
        onDragOver={(event) => {
          preventDefaults(event);
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          preventDefaults(event);
          setDragOver(false);
        }}
        onDrop={(event) => {
          preventDefaults(event);
          setDragOver(false);
          takeFile(event.dataTransfer.files?.[0]);
        }}
      >
        <span className="font-medium text-slate-800">{label}</span>
        <span className="mt-1 text-xs text-slate-500">or click to browse</span>
        {file ? (
          <span className="mt-2 truncate rounded bg-white px-2 py-1 font-mono text-xs text-slate-700 ring-1 ring-slate-200">
            {file.name}
          </span>
        ) : (
          <span className="mt-2 text-xs text-slate-400">PDF only</span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none fixed h-0 w-0 opacity-0"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          takeFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
