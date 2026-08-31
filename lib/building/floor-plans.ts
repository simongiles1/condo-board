import { readFile, unlink } from "fs/promises";
import { eq, and, isNotNull, asc } from "drizzle-orm";
import { randomUUID } from "crypto";

import { getDb } from "@/lib/db";
import {
  FLOOR_PLAN_SETTINGS_ID,
  floorPlanFamilies,
  floorPlanSettings,
  floorPlans,
} from "@/lib/db/schema";

import {
  applyFamilyCropSize,
  familyCropFitsPage,
  clampPin,
  croppedSizeMatchesFamily,
  floorPlanStatus,
  planHasPin,
  planHasReferenceAnchor,
  type PdfRect,
  type PdfSize,
} from "./floor-plan-align";
import {
  cropFloorPlanPdf,
  readPdfPageSize,
  readPdfPageSizeFromPath,
  removeFloorPlanFiles,
  writeFloorPlanCropped,
  writeFloorPlanOriginal,
  writeFloorPlanWest,
  writeFloorPlanEast,
  floorPlanCroppedPath,
} from "./floor-plan-crop-pdf";
import type {
  FloorPlanDto,
  FloorPlanDrawingSet,
  FloorPlanFamilyDto,
  FloorPlanFileKind,
  FloorPlanSettingsDto,
  FloorPlansPayload,
} from "./floor-plan-shared";
import {
  parseFloorPlanDrawingSet,
  parseFloorPlanName,
  parseFloorPlanAnnotations,
  planNeedsMerge,
} from "./floor-plan-shared";
import { mergeSplitFloorPlanPdfs } from "./floor-plan-split-pdf";
import {
  clippedEastOffset,
  defaultEastOffset,
  defaultSheetCrop,
  requireSheetCrop,
  resolvedSheetCrop,
  splitCanvasLayout,
} from "./floor-plan-split";
import {
  parseDrawColorPresets,
  type DrawColorPreset,
  type FloorPlanAnnotation,
} from "./floor-plan-annotations";
import { assertLooksLikePdf } from "@/lib/pdf/pdf-bytes";

const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

function nowIso(): string {
  return new Date().toISOString();
}

function mapFamily(row: typeof floorPlanFamilies.$inferSelect): FloorPlanFamilyDto {
  return {
    id: row.id,
    name: row.name,
    kind: parseFloorPlanDrawingSet(row.kind),
    sortOrder: row.sortOrder,
    cropWidthPt: row.cropWidthPt,
    cropHeightPt: row.cropHeightPt,
    scaleDenominator: row.scaleDenominator,
    createdAt: row.createdAt,
  };
}

function mapSettings(row: typeof floorPlanSettings.$inferSelect): FloorPlanSettingsDto {
  return {
    registrationLabel: row.registrationLabel,
    pinXPt: row.pinXPt,
    pinYPt: row.pinYPt,
    registrationPlanId: row.registrationPlanId,
    pinReferencePlanId: row.pinReferencePlanId,
    drawColorPresets: parseDrawColorPresets(row.drawColorPresetsJson),
  };
}

function mapPlan(row: typeof floorPlans.$inferSelect): FloorPlanDto {
  const hasCropped = Boolean(row.croppedFilePath);
  const hasOriginal = Boolean(row.originalFilePath);
  const hasWest = Boolean(row.westFilePath);
  const hasEast = Boolean(row.eastFilePath);
  return {
    id: row.id,
    familyId: row.familyId,
    name: row.name,
    notes: row.notes,
    floorNumber: row.floorNumber,
    sortOrder: row.sortOrder,
    originalPageWidthPt: row.originalPageWidthPt,
    originalPageHeightPt: row.originalPageHeightPt,
    cropXPt: row.cropXPt,
    cropYPt: row.cropYPt,
    pinXPt: row.pinXPt,
    pinYPt: row.pinYPt,
    referenceAnchorXPt: row.referenceAnchorXPt,
    referenceAnchorYPt: row.referenceAnchorYPt,
    westPageWidthPt: row.westPageWidthPt,
    westPageHeightPt: row.westPageHeightPt,
    eastPageWidthPt: row.eastPageWidthPt,
    eastPageHeightPt: row.eastPageHeightPt,
    eastOffsetXPt: row.eastOffsetXPt,
    eastOffsetYPt: row.eastOffsetYPt,
    westCropXPt: row.westCropXPt,
    westCropYPt: row.westCropYPt,
    westCropWidthPt: row.westCropWidthPt,
    westCropHeightPt: row.westCropHeightPt,
    eastCropXPt: row.eastCropXPt,
    eastCropYPt: row.eastCropYPt,
    eastCropWidthPt: row.eastCropWidthPt,
    eastCropHeightPt: row.eastCropHeightPt,
    hasOriginal,
    hasCropped,
    hasWest,
    hasEast,
    status: floorPlanStatus({
      cropped: hasCropped,
      pinned: planHasPin(row),
      needsMerge: planNeedsMerge({ hasWest, hasEast, hasOriginal }),
    }),
    annotations: parseFloorPlanAnnotations(row.annotationsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function requireOriginalPath(row: typeof floorPlans.$inferSelect): string {
  if (!row.originalFilePath) {
    throw new Error("Merge the east and west sheets before cropping or pinning.");
  }
  return row.originalFilePath;
}

async function ensureSettings(): Promise<FloorPlanSettingsDto> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(floorPlanSettings)
    .where(eq(floorPlanSettings.id, FLOOR_PLAN_SETTINGS_ID));
  if (existing) {
    return mapSettings(existing);
  }
  const createdAt = nowIso();
  await db.insert(floorPlanSettings).values({
    id: FLOOR_PLAN_SETTINGS_ID,
    registrationLabel: "NW corner of Elevator A",
    drawColorPresetsJson: JSON.stringify(parseDrawColorPresets(null)),
    updatedAt: createdAt,
  });
  return {
    registrationLabel: "NW corner of Elevator A",
    pinXPt: null,
    pinYPt: null,
    registrationPlanId: null,
    pinReferencePlanId: null,
    drawColorPresets: parseDrawColorPresets(null),
  };
}

export async function loadFloorPlansPayload(): Promise<FloorPlansPayload> {
  const db = getDb();
  const [settings, families, plans] = await Promise.all([
    ensureSettings(),
    db.select().from(floorPlanFamilies).orderBy(asc(floorPlanFamilies.sortOrder)),
    db.select().from(floorPlans).orderBy(asc(floorPlans.floorNumber), asc(floorPlans.name)),
  ]);
  return {
    settings,
    families: families.map(mapFamily),
    plans: plans.map(mapPlan),
  };
}

export async function updateFloorPlanSettings(patch: {
  registrationLabel?: string;
  registrationPlanId?: string | null;
  pinReferencePlanId?: string | null;
  drawColorPresets?: DrawColorPreset[];
}): Promise<FloorPlanSettingsDto> {
  const db = getDb();
  const current = await ensureSettings();
  let registrationLabel = current.registrationLabel;
  let registrationPlanId = current.registrationPlanId;
  let pinReferencePlanId = current.pinReferencePlanId;
  let pinXPt = current.pinXPt;
  let pinYPt = current.pinYPt;
  let drawColorPresets = current.drawColorPresets;

  if (patch.registrationLabel != null) {
    registrationLabel = patch.registrationLabel.trim();
  }

  if (patch.drawColorPresets != null) {
    drawColorPresets = parseDrawColorPresets(patch.drawColorPresets);
  }

  if (patch.registrationPlanId !== undefined) {
    if (patch.registrationPlanId == null) {
      registrationPlanId = null;
      pinXPt = null;
      pinYPt = null;
    } else {
      const [plan] = await db
        .select()
        .from(floorPlans)
        .where(eq(floorPlans.id, patch.registrationPlanId));
      if (!plan) throw new Error("Registration floor not found.");
      if (!planHasPin(plan)) {
        throw new Error("Place the building pin on that floor first.");
      }
      registrationPlanId = plan.id;
      pinXPt = plan.pinXPt;
      pinYPt = plan.pinYPt;
    }
  }

  if (patch.pinReferencePlanId !== undefined) {
    if (patch.pinReferencePlanId == null) {
      pinReferencePlanId = null;
    } else {
      const [plan] = await db
        .select()
        .from(floorPlans)
        .where(eq(floorPlans.id, patch.pinReferencePlanId));
      if (!plan) throw new Error("Calibration floor not found.");
      if (!planHasPin(plan)) {
        throw new Error("Place the building pin on the calibration floor first.");
      }
      if (!planHasReferenceAnchor(plan)) {
        throw new Error(
          "Place a reference anchor on the calibration floor first.",
        );
      }
      pinReferencePlanId = plan.id;
    }
  }

  await db
    .update(floorPlanSettings)
    .set({
      registrationLabel,
      registrationPlanId,
      pinReferencePlanId,
      pinXPt,
      pinYPt,
      drawColorPresetsJson: JSON.stringify(drawColorPresets),
      updatedAt: nowIso(),
    })
    .where(eq(floorPlanSettings.id, FLOOR_PLAN_SETTINGS_ID));
  return {
    registrationLabel,
    pinXPt,
    pinYPt,
    registrationPlanId,
    pinReferencePlanId,
    drawColorPresets,
  };
}

export async function createFloorPlanFamily(
  name: string,
  kind: FloorPlanDrawingSet = "architectural",
): Promise<FloorPlanFamilyDto> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Family name is required.");
  const db = getDb();
  const existing = await db.select().from(floorPlanFamilies);
  const sortOrder =
    existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
  const row = {
    id: randomUUID(),
    name: trimmed,
    kind,
    sortOrder,
    cropWidthPt: null,
    cropHeightPt: null,
    scaleDenominator: null,
    createdAt: nowIso(),
  };
  await db.insert(floorPlanFamilies).values(row);
  return mapFamily(row);
}

export async function updateFloorPlanFamily(
  id: string,
  patch: {
    name?: string;
    sortOrder?: number;
    scaleDenominator?: number | null;
    kind?: FloorPlanDrawingSet;
  },
): Promise<FloorPlanFamilyDto> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(floorPlanFamilies)
    .where(eq(floorPlanFamilies.id, id));
  if (!row) throw new Error("Family not found.");

  let scaleDenominator = row.scaleDenominator;
  if (patch.scaleDenominator !== undefined) {
    if (patch.scaleDenominator == null) {
      scaleDenominator = null;
    } else if (
      !Number.isFinite(patch.scaleDenominator) ||
      patch.scaleDenominator <= 0
    ) {
      throw new Error("Scale denominator must be a positive number.");
    } else {
      scaleDenominator = patch.scaleDenominator;
    }
  }

  const next = {
    name: patch.name != null ? patch.name.trim() : row.name,
    sortOrder: patch.sortOrder ?? row.sortOrder,
    scaleDenominator,
    kind: patch.kind ?? parseFloorPlanDrawingSet(row.kind),
  };
  if (!next.name) throw new Error("Family name is required.");
  await db
    .update(floorPlanFamilies)
    .set(next)
    .where(eq(floorPlanFamilies.id, id));
  return mapFamily({ ...row, ...next });
}

export async function deleteFloorPlanFamily(id: string): Promise<void> {
  const db = getDb();
  const plans = await db
    .select({ id: floorPlans.id })
    .from(floorPlans)
    .where(eq(floorPlans.familyId, id));
  for (const plan of plans) {
    await removeFloorPlanFiles(plan.id);
  }
  await db.delete(floorPlanFamilies).where(eq(floorPlanFamilies.id, id));
  await syncBuildingRegistration();
}

function assertPdfBytes(bytes: Uint8Array, label: string): void {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`${label} PDF is larger than 80 MB.`);
  }
  assertLooksLikePdf(bytes, label);
}

export async function createFloorPlanFromUpload(input: {
  familyId: string;
  name: string;
  floorNumber: number;
  notes?: string;
  bytes: Uint8Array;
}): Promise<FloorPlanDto> {
  assertPdfBytes(input.bytes, "PDF");
  const parsedName = parseFloorPlanName(input.name);
  const name = parsedName.name.trim();
  if (!name) throw new Error("Drawing name is required.");
  if (!Number.isInteger(input.floorNumber)) {
    throw new Error("Floor number must be an integer.");
  }

  const db = getDb();
  const [family] = await db
    .select()
    .from(floorPlanFamilies)
    .where(eq(floorPlanFamilies.id, input.familyId));
  if (!family) throw new Error("Family not found.");

  const page = await readPdfPageSize(input.bytes);
  const siblings = await db
    .select({ sortOrder: floorPlans.sortOrder })
    .from(floorPlans)
    .where(eq(floorPlans.familyId, input.familyId));
  const sortOrder =
    siblings.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;

  const id = randomUUID();
  const originalFilePath = await writeFloorPlanOriginal(id, input.bytes);
  const createdAt = nowIso();
  const row = {
    id,
    familyId: input.familyId,
    name,
    notes: (input.notes ?? "").trim(),
    floorNumber: input.floorNumber,
    sortOrder,
    originalFilePath,
    croppedFilePath: null,
    westFilePath: null,
    eastFilePath: null,
    westPageWidthPt: null,
    westPageHeightPt: null,
    eastPageWidthPt: null,
    eastPageHeightPt: null,
    eastOffsetXPt: null,
    eastOffsetYPt: null,
    westCropXPt: null,
    westCropYPt: null,
    westCropWidthPt: null,
    westCropHeightPt: null,
    eastCropXPt: null,
    eastCropYPt: null,
    eastCropWidthPt: null,
    eastCropHeightPt: null,
    originalPageWidthPt: page.width,
    originalPageHeightPt: page.height,
    cropXPt: null,
    cropYPt: null,
    pinXPt: null,
    pinYPt: null,
    annotationsJson: "[]",
    createdAt,
    updatedAt: createdAt,
  };
  await db.insert(floorPlans).values(row);
  return mapPlan(row);
}

export async function createFloorPlanFromSplitUpload(input: {
  familyId: string;
  name: string;
  floorNumber: number;
  notes?: string;
  westBytes: Uint8Array;
  eastBytes: Uint8Array;
}): Promise<FloorPlanDto> {
  assertPdfBytes(input.westBytes, "West");
  assertPdfBytes(input.eastBytes, "East");
  const parsedName = parseFloorPlanName(input.name);
  const name = parsedName.name.trim();
  if (!name) throw new Error("Drawing name is required.");
  if (!Number.isInteger(input.floorNumber)) {
    throw new Error("Floor number must be an integer.");
  }

  const db = getDb();
  const [family] = await db
    .select()
    .from(floorPlanFamilies)
    .where(eq(floorPlanFamilies.id, input.familyId));
  if (!family) throw new Error("Family not found.");
  if (parseFloorPlanDrawingSet(family.kind) !== "mechanical") {
    throw new Error("East/west pairs can only be uploaded to a mechanical family.");
  }

  const westPage = await readPdfPageSize(input.westBytes);
  const eastPage = await readPdfPageSize(input.eastBytes);
  const westSize = { width: westPage.width, height: westPage.height };
  const eastSize = { width: eastPage.width, height: eastPage.height };
  const eastOffset = defaultEastOffset(westSize, eastSize);
  const westCrop = defaultSheetCrop(westSize);
  const eastCrop = defaultSheetCrop(eastSize);
  const canvas = splitCanvasLayout(
    { width: westCrop.width, height: westCrop.height },
    { width: eastCrop.width, height: eastCrop.height },
    clippedEastOffset(eastOffset, westCrop, eastCrop),
  );

  const siblings = await db
    .select({ sortOrder: floorPlans.sortOrder })
    .from(floorPlans)
    .where(eq(floorPlans.familyId, input.familyId));
  const sortOrder =
    siblings.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;

  const id = randomUUID();
  const [westFilePath, eastFilePath] = await Promise.all([
    writeFloorPlanWest(id, input.westBytes),
    writeFloorPlanEast(id, input.eastBytes),
  ]);
  const createdAt = nowIso();
  const row = {
    id,
    familyId: input.familyId,
    name,
    notes: (input.notes ?? "").trim(),
    floorNumber: input.floorNumber,
    sortOrder,
    originalFilePath: null,
    croppedFilePath: null,
    westFilePath,
    eastFilePath,
    westPageWidthPt: westSize.width,
    westPageHeightPt: westSize.height,
    eastPageWidthPt: eastSize.width,
    eastPageHeightPt: eastSize.height,
    eastOffsetXPt: eastOffset.x,
    eastOffsetYPt: eastOffset.y,
    westCropXPt: westCrop.x,
    westCropYPt: westCrop.y,
    westCropWidthPt: westCrop.width,
    westCropHeightPt: westCrop.height,
    eastCropXPt: eastCrop.x,
    eastCropYPt: eastCrop.y,
    eastCropWidthPt: eastCrop.width,
    eastCropHeightPt: eastCrop.height,
    originalPageWidthPt: canvas.width,
    originalPageHeightPt: canvas.height,
    cropXPt: null,
    cropYPt: null,
    pinXPt: null,
    pinYPt: null,
    annotationsJson: "[]",
    createdAt,
    updatedAt: createdAt,
  };
  await db.insert(floorPlans).values(row);
  return mapPlan(row);
}

export async function moveFloorPlanToFamily(
  planId: string,
  targetFamilyId: string,
): Promise<FloorPlanDto> {
  const db = getDb();
  const [row] = await db.select().from(floorPlans).where(eq(floorPlans.id, planId));
  if (!row) throw new Error("Floor plan not found.");
  if (row.familyId === targetFamilyId) return mapPlan(row);

  const [targetFamily] = await db
    .select()
    .from(floorPlanFamilies)
    .where(eq(floorPlanFamilies.id, targetFamilyId));
  if (!targetFamily) throw new Error("Family not found.");

  const [sourceFamily] = await db
    .select()
    .from(floorPlanFamilies)
    .where(eq(floorPlanFamilies.id, row.familyId));
  if (
    sourceFamily &&
    parseFloorPlanDrawingSet(sourceFamily.kind) !==
      parseFloorPlanDrawingSet(targetFamily.kind)
  ) {
    throw new Error(
      "Move drawings within Architectural or within Mechanical, not across.",
    );
  }

  const oldFamilyId = row.familyId;
  const updatedAt = nowIso();

  const siblings = await db
    .select({ sortOrder: floorPlans.sortOrder })
    .from(floorPlans)
    .where(eq(floorPlans.familyId, targetFamilyId));
  const nextSortOrder =
    siblings.length > 0 ? Math.max(...siblings.map((s) => s.sortOrder)) + 1 : 0;

  let croppedFilePath = row.croppedFilePath;
  let cropXPt = row.cropXPt;
  let cropYPt = row.cropYPt;

  const targetHasLockedCrop =
    targetFamily.cropWidthPt != null &&
    targetFamily.cropHeightPt != null &&
    targetFamily.cropWidthPt > 0 &&
    targetFamily.cropHeightPt > 0;

  if (row.croppedFilePath && row.cropXPt != null && row.cropYPt != null) {
    if (targetHasLockedCrop) {
      const familySize = {
        width: targetFamily.cropWidthPt!,
        height: targetFamily.cropHeightPt!,
      };
      const recropped = await recropPlanToFamilySize(row, familySize);
      croppedFilePath = recropped.croppedFilePath;
      cropXPt = recropped.crop.x;
      cropYPt = recropped.crop.y;
    } else {
      const croppedInTarget = await db
        .select({ id: floorPlans.id })
        .from(floorPlans)
        .where(
          and(
            eq(floorPlans.familyId, targetFamilyId),
            isNotNull(floorPlans.croppedFilePath),
          ),
        );
      if (croppedInTarget.length === 0) {
        const visual = await readPdfPageSizeFromPath(row.croppedFilePath);
        await db
          .update(floorPlanFamilies)
          .set({ cropWidthPt: visual.width, cropHeightPt: visual.height })
          .where(eq(floorPlanFamilies.id, targetFamilyId));
      }
    }
  }

  await db
    .update(floorPlans)
    .set({
      familyId: targetFamilyId,
      sortOrder: nextSortOrder,
      croppedFilePath,
      cropXPt,
      cropYPt,
      updatedAt,
    })
    .where(eq(floorPlans.id, planId));

  await maybeUnlockFamilyCrop(oldFamilyId);

  const [updated] = await db.select().from(floorPlans).where(eq(floorPlans.id, planId));
  if (!updated) throw new Error("Floor plan not found.");
  const synced = await ensureCroppedPdfMatchesFamily(updated);
  return mapPlan(synced);
}

export async function updateFloorPlan(
  id: string,
  patch: {
    name?: string;
    notes?: string;
    floorNumber?: number;
    sortOrder?: number;
    familyId?: string;
  },
): Promise<FloorPlanDto> {
  const db = getDb();
  const [row] = await db.select().from(floorPlans).where(eq(floorPlans.id, id));
  if (!row) throw new Error("Floor plan not found.");

  if (patch.familyId && patch.familyId !== row.familyId) {
    const moved = await moveFloorPlanToFamily(id, patch.familyId);
    if (
      patch.name == null &&
      patch.notes == null &&
      patch.floorNumber == null &&
      patch.sortOrder == null
    ) {
      return moved;
    }
    return updateFloorPlan(id, {
      name: patch.name,
      notes: patch.notes,
      floorNumber: patch.floorNumber,
      sortOrder: patch.sortOrder,
    });
  }

  let name = row.name;
  if (patch.name != null) {
    const parsed = parseFloorPlanName(patch.name);
    name = parsed.name.trim();
  }
  if (!name) throw new Error("Drawing name is required.");

  let floorNumber = row.floorNumber;
  if (patch.floorNumber !== undefined) {
    if (!Number.isInteger(patch.floorNumber)) {
      throw new Error("Floor number must be an integer.");
    }
    floorNumber = patch.floorNumber;
  }

  const next = {
    name,
    notes: patch.notes != null ? patch.notes.trim() : row.notes,
    floorNumber,
    sortOrder: patch.sortOrder ?? row.sortOrder,
    familyId: row.familyId,
    updatedAt: nowIso(),
  };
  await db.update(floorPlans).set(next).where(eq(floorPlans.id, id));
  return mapPlan({ ...row, ...next });
}

export async function deleteFloorPlan(id: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(floorPlans).where(eq(floorPlans.id, id));
  if (!row) throw new Error("Floor plan not found.");
  const familyId = row.familyId;
  await db.delete(floorPlans).where(eq(floorPlans.id, id));
  await removeFloorPlanFiles(id);
  await maybeUnlockFamilyCrop(familyId);
  await syncBuildingRegistration(id);
}

async function maybeUnlockFamilyCrop(familyId: string): Promise<void> {
  const db = getDb();
  const remaining = await db
    .select({ id: floorPlans.id })
    .from(floorPlans)
    .where(
      and(eq(floorPlans.familyId, familyId), isNotNull(floorPlans.croppedFilePath)),
    );
  if (remaining.length > 0) return;
  await db
    .update(floorPlanFamilies)
    .set({
      cropWidthPt: null,
      cropHeightPt: null,
    })
    .where(eq(floorPlanFamilies.id, familyId));
}

type FloorPlanRow = typeof floorPlans.$inferSelect;

async function syncBuildingRegistration(deletedPlanId?: string): Promise<void> {
  const db = getDb();
  const settings = await ensureSettings();
  if (
    settings.registrationPlanId &&
    settings.registrationPlanId !== deletedPlanId
  ) {
    const [current] = await db
      .select()
      .from(floorPlans)
      .where(eq(floorPlans.id, settings.registrationPlanId));
    if (current && planHasPin(current)) return;
  }

  const [next] = await db
    .select({
      id: floorPlans.id,
      pinXPt: floorPlans.pinXPt,
      pinYPt: floorPlans.pinYPt,
    })
    .from(floorPlans)
    .innerJoin(
      floorPlanFamilies,
      eq(floorPlans.familyId, floorPlanFamilies.id),
    )
    .where(and(isNotNull(floorPlans.pinXPt), isNotNull(floorPlans.pinYPt)))
    .orderBy(
      asc(floorPlanFamilies.sortOrder),
      asc(floorPlans.floorNumber),
      asc(floorPlans.name),
    )
    .limit(1);

  await db
    .update(floorPlanSettings)
    .set({
      registrationPlanId: next?.id ?? null,
      pinXPt: next?.pinXPt ?? null,
      pinYPt: next?.pinYPt ?? null,
      updatedAt: nowIso(),
    })
    .where(eq(floorPlanSettings.id, FLOOR_PLAN_SETTINGS_ID));
}

/**
 * Rewrite one sheet to the family plate, keeping that sheet's origin.
 * Compare / onion-skin assume every cropped sibling is the same W×H.
 */
async function recropPlanToFamilySize(
  row: FloorPlanRow,
  familySize: PdfSize,
): Promise<{ crop: PdfRect; croppedFilePath: string }> {
  if (row.cropXPt == null || row.cropYPt == null) {
    throw new Error("Crop origin is missing.");
  }
  const source = await readFile(requireOriginalPath(row));
  const pageInfo = await readPdfPageSize(source);
  const page = { width: pageInfo.width, height: pageInfo.height };
  if (!familyCropFitsPage(familySize, page)) {
    throw new Error("Crop is larger than the PDF page.");
  }
  const crop = applyFamilyCropSize(
    familySize,
    {
      x: row.cropXPt,
      y: row.cropYPt,
      width: familySize.width,
      height: familySize.height,
    },
    page,
  );
  const croppedBytes = await cropFloorPlanPdf(source, crop);
  const croppedFilePath = await writeFloorPlanCropped(row.id, croppedBytes);
  return { crop, croppedFilePath };
}

async function recropSiblingsToFamilySize(
  familyId: string,
  exceptId: string,
  familySize: PdfSize,
): Promise<void> {
  const db = getDb();
  const siblings = await db
    .select()
    .from(floorPlans)
    .where(
      and(
        eq(floorPlans.familyId, familyId),
        isNotNull(floorPlans.croppedFilePath),
      ),
    );
  for (const sibling of siblings) {
    if (sibling.id === exceptId) continue;
    if (sibling.cropXPt == null || sibling.cropYPt == null) continue;
    if (sibling.croppedFilePath) {
      try {
        const visual = await readPdfPageSizeFromPath(sibling.croppedFilePath);
        if (croppedSizeMatchesFamily(visual, familySize)) continue;
      } catch {
        /* rewrite from the original */
      }
    }
    const { crop, croppedFilePath } = await recropPlanToFamilySize(
      sibling,
      familySize,
    );
    await db
      .update(floorPlans)
      .set({
        croppedFilePath,
        cropXPt: crop.x,
        cropYPt: crop.y,
        updatedAt: nowIso(),
      })
      .where(eq(floorPlans.id, sibling.id));
  }
}

/**
 * Crop overlay uses family W×H; compare paints the cropped PDF. If a later
 * floor resized the plate, older sibling files are still the previous size
 * and look clipped until rewritten.
 */
async function ensureCroppedPdfMatchesFamily(
  row: FloorPlanRow,
): Promise<FloorPlanRow> {
  const db = getDb();
  const [family] = await db
    .select()
    .from(floorPlanFamilies)
    .where(eq(floorPlanFamilies.id, row.familyId));
  if (
    family?.cropWidthPt == null ||
    family.cropHeightPt == null ||
    row.cropXPt == null ||
    row.cropYPt == null ||
    !row.croppedFilePath
  ) {
    return row;
  }
  const familySize = {
    width: family.cropWidthPt,
    height: family.cropHeightPt,
  };
  try {
    const visual = await readPdfPageSizeFromPath(row.croppedFilePath);
    if (croppedSizeMatchesFamily(visual, familySize)) return row;
  } catch {
    /* rewrite from the original */
  }
  const { crop, croppedFilePath } = await recropPlanToFamilySize(
    row,
    familySize,
  );
  const updatedAt = nowIso();
  await db
    .update(floorPlans)
    .set({
      croppedFilePath,
      cropXPt: crop.x,
      cropYPt: crop.y,
      updatedAt,
    })
    .where(eq(floorPlans.id, row.id));
  return {
    ...row,
    croppedFilePath,
    cropXPt: crop.x,
    cropYPt: crop.y,
    updatedAt,
  };
}

export async function moveFloorPlanToNewFamily(
  planId: string,
  familyName: string,
): Promise<{ plan: FloorPlanDto; family: FloorPlanFamilyDto }> {
  const db = getDb();
  const [row] = await db.select().from(floorPlans).where(eq(floorPlans.id, planId));
  if (!row) throw new Error("Floor plan not found.");

  const [sourceFamily] = await db
    .select()
    .from(floorPlanFamilies)
    .where(eq(floorPlanFamilies.id, row.familyId));
  const family = await createFloorPlanFamily(
    familyName,
    sourceFamily ? parseFloorPlanDrawingSet(sourceFamily.kind) : "architectural",
  );
  const oldFamilyId = row.familyId;
  const updatedAt = nowIso();

  if (row.croppedFilePath) {
    try {
      await unlink(floorPlanCroppedPath(row.id));
    } catch {
      /* cropped file may already be missing */
    }
  }

  await db
    .update(floorPlans)
    .set({
      familyId: family.id,
      croppedFilePath: null,
      cropXPt: null,
      cropYPt: null,
      updatedAt,
    })
    .where(eq(floorPlans.id, planId));

  await maybeUnlockFamilyCrop(oldFamilyId);

  const [updated] = await db.select().from(floorPlans).where(eq(floorPlans.id, planId));
  if (!updated) throw new Error("Floor plan not found.");
  return {
    plan: mapPlan(updated),
    family,
  };
}

export async function saveFloorPlanCrop(
  id: string,
  proposed: PdfRect,
): Promise<FloorPlanDto> {
  const db = getDb();
  const [row] = await db.select().from(floorPlans).where(eq(floorPlans.id, id));
  if (!row) throw new Error("Floor plan not found.");

  const source = await readFile(requireOriginalPath(row));
  const pageInfo = await readPdfPageSize(source);
  const crop = applyFamilyCropSize(null, proposed, {
    width: pageInfo.width,
    height: pageInfo.height,
  });
  const croppedBytes = await cropFloorPlanPdf(source, crop);
  const croppedFilePath = await writeFloorPlanCropped(id, croppedBytes);
  const updatedAt = nowIso();

  const [family] = await db
    .select()
    .from(floorPlanFamilies)
    .where(eq(floorPlanFamilies.id, row.familyId));
  if (!family) throw new Error("Family not found.");

  await db
    .update(floorPlans)
    .set({
      croppedFilePath,
      cropXPt: crop.x,
      cropYPt: crop.y,
      originalPageWidthPt: pageInfo.width,
      originalPageHeightPt: pageInfo.height,
      updatedAt,
    })
    .where(eq(floorPlans.id, id));

  await db
    .update(floorPlanFamilies)
    .set({ cropWidthPt: crop.width, cropHeightPt: crop.height })
    .where(eq(floorPlanFamilies.id, row.familyId));

  await recropSiblingsToFamilySize(row.familyId, id, {
    width: crop.width,
    height: crop.height,
  });

  const [updated] = await db.select().from(floorPlans).where(eq(floorPlans.id, id));
  if (!updated) throw new Error("Floor plan not found.");
  return mapPlan(updated);
}

export async function saveFloorPlanPin(
  id: string,
  pin: { x: number; y: number },
): Promise<{ plan: FloorPlanDto; settings: FloorPlanSettingsDto }> {
  const db = getDb();
  const [row] = await db.select().from(floorPlans).where(eq(floorPlans.id, id));
  if (!row) throw new Error("Floor plan not found.");
  requireOriginalPath(row);
  const page = {
    width: row.originalPageWidthPt,
    height: row.originalPageHeightPt,
  };
  if (!(page.width > 0) || !(page.height > 0)) {
    throw new Error("Original page size is missing.");
  }
  const clamped = clampPin(pin, page);
  const updatedAt = nowIso();
  const settings = await ensureSettings();
  const becomesRegistration =
    settings.registrationPlanId == null || settings.registrationPlanId === id;

  await db
    .update(floorPlans)
    .set({
      pinXPt: clamped.x,
      pinYPt: clamped.y,
      updatedAt,
    })
    .where(eq(floorPlans.id, id));

  if (becomesRegistration) {
    await db
      .update(floorPlanSettings)
      .set({
        pinXPt: clamped.x,
        pinYPt: clamped.y,
        registrationPlanId: id,
        updatedAt,
      })
      .where(eq(floorPlanSettings.id, FLOOR_PLAN_SETTINGS_ID));
  }

  const nextSettings: FloorPlanSettingsDto = becomesRegistration
    ? {
        registrationLabel: settings.registrationLabel,
        pinXPt: clamped.x,
        pinYPt: clamped.y,
        registrationPlanId: id,
        pinReferencePlanId: settings.pinReferencePlanId,
        drawColorPresets: settings.drawColorPresets,
      }
    : settings;

  return {
    plan: mapPlan({
      ...row,
      pinXPt: clamped.x,
      pinYPt: clamped.y,
      updatedAt,
    }),
    settings: nextSettings,
  };
}

export async function saveFloorPlanReferenceAnchor(
  id: string,
  anchor: { x: number; y: number },
): Promise<{ plan: FloorPlanDto; settings: FloorPlanSettingsDto }> {
  const db = getDb();
  const [row] = await db.select().from(floorPlans).where(eq(floorPlans.id, id));
  if (!row) throw new Error("Floor plan not found.");
  requireOriginalPath(row);
  const page = {
    width: row.originalPageWidthPt,
    height: row.originalPageHeightPt,
  };
  if (!(page.width > 0) || !(page.height > 0)) {
    throw new Error("Original page size is missing.");
  }
  const clamped = clampPin(anchor, page);
  const updatedAt = nowIso();
  const settings = await ensureSettings();
  const becomesCalibration =
    settings.pinReferencePlanId == null &&
    planHasPin(row);

  await db
    .update(floorPlans)
    .set({
      referenceAnchorXPt: clamped.x,
      referenceAnchorYPt: clamped.y,
      updatedAt,
    })
    .where(eq(floorPlans.id, id));

  let nextSettings = settings;
  if (becomesCalibration) {
    await db
      .update(floorPlanSettings)
      .set({
        pinReferencePlanId: id,
        updatedAt,
      })
      .where(eq(floorPlanSettings.id, FLOOR_PLAN_SETTINGS_ID));
    nextSettings = {
      ...settings,
      pinReferencePlanId: id,
    };
  }

  return {
    plan: mapPlan({
      ...row,
      referenceAnchorXPt: clamped.x,
      referenceAnchorYPt: clamped.y,
      updatedAt,
    }),
    settings: nextSettings,
  };
}

export async function saveFloorPlanAnnotations(
  id: string,
  proposed: FloorPlanAnnotation[],
): Promise<FloorPlanDto> {
  const db = getDb();
  const [row] = await db.select().from(floorPlans).where(eq(floorPlans.id, id));
  if (!row) throw new Error("Floor plan not found.");

  const annotations = parseFloorPlanAnnotations(proposed);
  const updatedAt = nowIso();

  await db
    .update(floorPlans)
    .set({
      annotationsJson: JSON.stringify(annotations),
      updatedAt,
    })
    .where(eq(floorPlans.id, id));

  const [updated] = await db.select().from(floorPlans).where(eq(floorPlans.id, id));
  if (!updated) throw new Error("Floor plan not found.");
  return mapPlan(updated);
}

export async function saveFloorPlanSplitAlign(
  id: string,
  input: {
    offset: { x: number; y: number };
    westCrop?: PdfRect;
    eastCrop?: PdfRect;
  },
): Promise<FloorPlanDto> {
  const db = getDb();
  const [row] = await db.select().from(floorPlans).where(eq(floorPlans.id, id));
  if (!row) throw new Error("Floor plan not found.");
  if (!row.westFilePath || !row.eastFilePath) {
    throw new Error("This floor has no east/west pair to align.");
  }
  if (row.originalFilePath) {
    throw new Error("This pair is already merged.");
  }
  const offset = input.offset;
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) {
    throw new Error("East offset x and y are required.");
  }
  if (
    row.westPageWidthPt == null ||
    row.westPageHeightPt == null ||
    row.eastPageWidthPt == null ||
    row.eastPageHeightPt == null
  ) {
    throw new Error("East/west page sizes are missing.");
  }
  const westPage = { width: row.westPageWidthPt, height: row.westPageHeightPt };
  const eastPage = { width: row.eastPageWidthPt, height: row.eastPageHeightPt };
  const westCrop = requireSheetCrop(
    input.westCrop ??
      resolvedSheetCrop(westPage, {
        x: row.westCropXPt,
        y: row.westCropYPt,
        width: row.westCropWidthPt,
        height: row.westCropHeightPt,
      }),
    westPage,
    "West",
  );
  const eastCrop = requireSheetCrop(
    input.eastCrop ??
      resolvedSheetCrop(eastPage, {
        x: row.eastCropXPt,
        y: row.eastCropYPt,
        width: row.eastCropWidthPt,
        height: row.eastCropHeightPt,
      }),
    eastPage,
    "East",
  );
  const canvas = splitCanvasLayout(
    { width: westCrop.width, height: westCrop.height },
    { width: eastCrop.width, height: eastCrop.height },
    clippedEastOffset(offset, westCrop, eastCrop),
  );
  const updatedAt = nowIso();
  const next = {
    eastOffsetXPt: offset.x,
    eastOffsetYPt: offset.y,
    westCropXPt: westCrop.x,
    westCropYPt: westCrop.y,
    westCropWidthPt: westCrop.width,
    westCropHeightPt: westCrop.height,
    eastCropXPt: eastCrop.x,
    eastCropYPt: eastCrop.y,
    eastCropWidthPt: eastCrop.width,
    eastCropHeightPt: eastCrop.height,
    originalPageWidthPt: canvas.width,
    originalPageHeightPt: canvas.height,
    updatedAt,
  };
  await db.update(floorPlans).set(next).where(eq(floorPlans.id, id));
  return mapPlan({ ...row, ...next });
}

export async function mergeFloorPlanSplit(
  id: string,
  input: {
    offset: { x: number; y: number };
    westCrop: PdfRect;
    eastCrop: PdfRect;
  },
): Promise<FloorPlanDto> {
  const db = getDb();
  const [row] = await db.select().from(floorPlans).where(eq(floorPlans.id, id));
  if (!row) throw new Error("Floor plan not found.");
  if (!row.westFilePath || !row.eastFilePath) {
    throw new Error("This floor has no east/west pair to merge.");
  }
  if (row.originalFilePath) {
    throw new Error("This pair is already merged.");
  }
  const offset = input.offset;
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) {
    throw new Error("East offset x and y are required.");
  }
  if (
    row.westPageWidthPt == null ||
    row.westPageHeightPt == null ||
    row.eastPageWidthPt == null ||
    row.eastPageHeightPt == null
  ) {
    throw new Error("East/west page sizes are missing.");
  }
  const westPage = { width: row.westPageWidthPt, height: row.westPageHeightPt };
  const eastPage = { width: row.eastPageWidthPt, height: row.eastPageHeightPt };
  const westCrop = requireSheetCrop(input.westCrop, westPage, "West");
  const eastCrop = requireSheetCrop(input.eastCrop, eastPage, "East");

  const [westBytes, eastBytes] = await Promise.all([
    readFile(row.westFilePath),
    readFile(row.eastFilePath),
  ]);
  const [family] = await db
    .select({
      cropWidthPt: floorPlanFamilies.cropWidthPt,
      cropHeightPt: floorPlanFamilies.cropHeightPt,
    })
    .from(floorPlanFamilies)
    .where(eq(floorPlanFamilies.id, row.familyId));
  const familySize =
    family != null &&
    family.cropWidthPt != null &&
    family.cropHeightPt != null &&
    family.cropWidthPt > 0 &&
    family.cropHeightPt > 0
      ? { width: family.cropWidthPt, height: family.cropHeightPt }
      : null;
  const merged = await mergeSplitFloorPlanPdfs(
    westBytes,
    eastBytes,
    offset,
    westCrop,
    eastCrop,
    familySize,
  );
  const originalFilePath = await writeFloorPlanOriginal(id, merged.bytes);
  const updatedAt = nowIso();
  await db
    .update(floorPlans)
    .set({
      originalFilePath,
      eastOffsetXPt: offset.x,
      eastOffsetYPt: offset.y,
      westCropXPt: westCrop.x,
      westCropYPt: westCrop.y,
      westCropWidthPt: westCrop.width,
      westCropHeightPt: westCrop.height,
      eastCropXPt: eastCrop.x,
      eastCropYPt: eastCrop.y,
      eastCropWidthPt: eastCrop.width,
      eastCropHeightPt: eastCrop.height,
      originalPageWidthPt: merged.size.width,
      originalPageHeightPt: merged.size.height,
      updatedAt,
    })
    .where(eq(floorPlans.id, id));

  const [updated] = await db.select().from(floorPlans).where(eq(floorPlans.id, id));
  if (!updated) throw new Error("Floor plan not found.");
  return mapPlan(updated);
}

export async function getFloorPlanFile(
  id: string,
  kind: FloorPlanFileKind,
): Promise<{ path: string; filename: string }> {
  const db = getDb();
  const [row] = await db.select().from(floorPlans).where(eq(floorPlans.id, id));
  if (!row) throw new Error("Floor plan not found.");
  if (kind === "cropped") {
    if (!row.croppedFilePath) throw new Error("Cropped PDF is not ready.");
    const synced = await ensureCroppedPdfMatchesFamily(row);
    if (!synced.croppedFilePath) throw new Error("Cropped PDF is not ready.");
    return {
      path: synced.croppedFilePath,
      filename: `${synced.name}-F${synced.floorNumber}-cropped.pdf`,
    };
  }
  if (kind === "west") {
    if (!row.westFilePath) throw new Error("West PDF is not ready.");
    return {
      path: row.westFilePath,
      filename: `${row.name}-F${row.floorNumber}-west.pdf`,
    };
  }
  if (kind === "east") {
    if (!row.eastFilePath) throw new Error("East PDF is not ready.");
    return {
      path: row.eastFilePath,
      filename: `${row.name}-F${row.floorNumber}-east.pdf`,
    };
  }
  return {
    path: requireOriginalPath(row),
    filename: `${row.name}-F${row.floorNumber}.pdf`,
  };
}
