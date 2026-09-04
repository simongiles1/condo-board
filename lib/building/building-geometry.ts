/**
 * Pin-aligned 3D building massing from architectural floor-plan markup.
 *
 * PDF (x, y) with origin bottom-left maps to Three.js (X, Z) around that
 * floor’s saved building pin; Three.js Y is elevation. Missing floors are
 * not fabricated: existing basement levels stack down from grade, and
 * existing above-grade levels stack up from Y = 0.
 */

import { planHasPin } from "@/lib/building/floor-plan-align";
import type { PdfPoint, PdfRect } from "@/lib/building/floor-plan-align";
import type { FloorPlanAnnotation } from "@/lib/building/floor-plan-annotations";
import {
  familyCropSize,
  floorPlanFileUrl,
  planForDrawingSetFloor,
  planNeedsMerge,
  type FloorPlanDto,
  type FloorPlanFamilyDto,
  type FloorPlansPayload,
} from "@/lib/building/floor-plan-shared";
import { polygonCentroid } from "@/lib/building/floor-plan-rooms";
import {
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Texture,
  type TextureLoader,
} from "three";

export const DEFAULT_FLOOR_HEIGHT_M = 3.5;
export const DEFAULT_SLAB_THICKNESS_M = 0.2;
export const DEFAULT_WALL_THICKNESS_M = 0.15;
export const DEFAULT_SCALE_DENOMINATOR = 100;
export const BLUEPRINT_OVERLAY_ELEVATION_OFFSET_M = 0.01;

const PDF_POINTS_PER_INCH = 72;
const METRES_PER_INCH = 0.0254;
const MIN_WALL_LENGTH_M = 1e-4;
/** Collapse out-and-back T-stems that add no filled area (1 cm). */
const SHELL_SPIKE_EPS_M = 0.01;

export type SkipReason =
  | "needs-merge"
  | "not-cropped"
  | "no-pin"
  | "no-crop-origin"
  | "no-family-plate"
  | "duplicate-floor";

export type SkippedPlan = {
  planId: string;
  name: string;
  floorNumber: number;
  reason: SkipReason;
};

export type WorldPoint = {
  x: number;
  z: number;
};

export type UnitDescriptor = {
  key: string;
  unitId: string;
  label: string;
  floorNumber: number;
  planId: string;
  planName: string;
  color: string;
  polygon: WorldPoint[];
  center: WorldPoint;
  elevationM: number;
};

export type BuildingLevel = {
  floorNumber: number;
  planId: string;
  planName: string;
  elevationM: number;
  metresPerPoint: number;
  pin: PdfPoint;
  crop: PdfRect;
  slab: {
    centerX: number;
    centerZ: number;
    width: number;
    depth: number;
  };
  wallPaths: WorldPoint[][];
  units: UnitDescriptor[];
};

export type BuildingGeometryModel = {
  levels: BuildingLevel[];
  units: UnitDescriptor[];
  skipped: SkippedPlan[];
  floorHeightM: number;
  slabThicknessM: number;
  wallThicknessM: number;
};

export type SlabDescriptor = {
  key: string;
  floorNumber: number;
  planId: string;
  planName: string;
  /** BoxGeometry center. */
  position: [number, number, number];
  width: number;
  thickness: number;
  depth: number;
  /** Walking surface elevation. Top face of slab is at Y = elevationM. */
  elevationM: number;
  /** Metres per PDF point for this floor level. */
  metresPerPoint: number;
  /** URL for the 2D cropped floor plan drawing texture. */
  textureUrl: string;
  /** Center position for the 2D blueprint texture overlay plane (elevation offset +0.01m). */
  overlayPosition: [number, number, number];
  /** Blueprint material created via TextureLoader if provided. */
  blueprintMaterial?: MeshBasicMaterial | MeshStandardMaterial;
};

export type BuildSlabsOptions = {
  textureLoader?: TextureLoader;
  blueprintOpacity?: number;
  materialType?: "basic" | "standard";
};

export type WallSegmentDescriptor = {
  key: string;
  floorNumber: number;
  planId: string;
  /** Segment start at the walking surface. */
  position: [number, number, number];
  length: number;
  /** Yaw after rotating extrusion from +Z onto +Y. */
  headingY: number;
  height: number;
  thickness: number;
  start: WorldPoint;
  end: WorldPoint;
  touchingUnitIds: string[];
};

export type ModelBounds = {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
};

export type OrbitDistanceLimits = {
  minDistance: number;
  maxDistance: number;
};

export function metresPerPdfPoint(
  scaleDenominator: number | null | undefined,
): number {
  const denom =
    scaleDenominator != null &&
    Number.isFinite(scaleDenominator) &&
    scaleDenominator > 0
      ? scaleDenominator
      : DEFAULT_SCALE_DENOMINATOR;
  return (METRES_PER_INCH / PDF_POINTS_PER_INCH) * denom;
}

/** PDF +X → world +X; PDF +Y (up on the sheet) → world −Z. */
export function pdfPointToWorldMetres(
  point: PdfPoint,
  pin: PdfPoint,
  metresPerPoint: number,
): WorldPoint {
  return {
    x: (point.x - pin.x) * metresPerPoint,
    z: (pin.y - point.y) * metresPerPoint,
  };
}

export function slabElevationsByFloor(
  floorNumbers: number[],
  floorHeightM = DEFAULT_FLOOR_HEIGHT_M,
): Map<number, number> {
  const unique = [...new Set(floorNumbers)].sort((a, b) => a - b);
  const basement = unique.filter((n) => n < 1);
  const above = unique.filter((n) => n >= 1);
  const elevations = new Map<number, number>();
  above.forEach((floorNumber, index) => {
    elevations.set(floorNumber, index * floorHeightM);
  });
  [...basement].reverse().forEach((floorNumber, index) => {
    elevations.set(floorNumber, -(index + 1) * floorHeightM);
  });
  return elevations;
}

function skipReasonForArchitecturalPlan(
  plan: FloorPlanDto,
  family: FloorPlanFamilyDto | undefined,
): SkipReason | null {
  if (planNeedsMerge(plan)) return "needs-merge";
  if (!plan.hasCropped) return "not-cropped";
  if (!planHasPin(plan)) return "no-pin";
  if (plan.cropXPt == null || plan.cropYPt == null) return "no-crop-origin";
  if (!family || familyCropSize(family) == null) return "no-family-plate";
  return null;
}

function isModelReady(
  plan: FloorPlanDto,
  family: FloorPlanFamilyDto | undefined,
): family is FloorPlanFamilyDto {
  return skipReasonForArchitecturalPlan(plan, family) == null;
}

function cropRect(
  plan: FloorPlanDto,
  family: FloorPlanFamilyDto,
): PdfRect | null {
  const size = familyCropSize(family);
  if (!size || plan.cropXPt == null || plan.cropYPt == null) return null;
  return {
    x: plan.cropXPt,
    y: plan.cropYPt,
    width: size.width,
    height: size.height,
  };
}

function slabFromCrop(
  crop: PdfRect,
  pin: PdfPoint,
  metresPerPoint: number,
): BuildingLevel["slab"] {
  const corners = [
    pdfPointToWorldMetres({ x: crop.x, y: crop.y }, pin, metresPerPoint),
    pdfPointToWorldMetres(
      { x: crop.x + crop.width, y: crop.y },
      pin,
      metresPerPoint,
    ),
    pdfPointToWorldMetres(
      { x: crop.x + crop.width, y: crop.y + crop.height },
      pin,
      metresPerPoint,
    ),
    pdfPointToWorldMetres(
      { x: crop.x, y: crop.y + crop.height },
      pin,
      metresPerPoint,
    ),
  ];
  const xs = corners.map((c) => c.x);
  const zs = corners.map((c) => c.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: maxX - minX,
    depth: maxZ - minZ,
  };
}

function wallPathsFromAnnotations(
  annotations: FloorPlanAnnotation[],
  pin: PdfPoint,
  metresPerPoint: number,
): WorldPoint[][] {
  const paths: WorldPoint[][] = [];
  for (const item of annotations) {
    if (item.type !== "polyline" || item.points.length < 2) continue;
    paths.push(
      item.points.map((point) =>
        pdfPointToWorldMetres(point, pin, metresPerPoint),
      ),
    );
  }
  return paths;
}

function wallSegmentFromEndpoints(
  start: WorldPoint,
  end: WorldPoint,
  level: BuildingLevel,
  keyPrefix: string,
  segmentIndex: number,
  floorHeightM: number,
  wallThicknessM: number,
  unitId?: string,
): WallSegmentDescriptor | null {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < MIN_WALL_LENGTH_M) return null;
  return {
    key: `${keyPrefix}-${segmentIndex}`,
    floorNumber: level.floorNumber,
    planId: level.planId,
    position: [start.x, level.elevationM, start.z],
    length,
    headingY: Math.atan2(-dz, dx),
    height: floorHeightM,
    thickness: wallThicknessM,
    start,
    end,
    touchingUnitIds: unitId ? [unitId] : [],
  };
}

function distSqWorld(a: WorldPoint, b: WorldPoint): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/**
 * Filled-unit silhouette: drop consecutive duplicates and zero-area
 * out-and-back spikes (T-stems that enclose no floor). Drawn polylines
 * are not part of this ring.
 */
export function unitShellRing(polygon: WorldPoint[]): WorldPoint[] {
  if (polygon.length < 3) return polygon;
  const epsSq = SHELL_SPIKE_EPS_M * SHELL_SPIKE_EPS_M;
  let ring = polygon.map((p) => ({ x: p.x, z: p.z }));
  let changed = true;
  let guard = 0;
  while (changed && guard < 64) {
    changed = false;
    guard += 1;
    const n = ring.length;
    if (n < 3) break;
    const withoutTips: WorldPoint[] = [];
    for (let i = 0; i < n; i++) {
      const prev = ring[(i - 1 + n) % n]!;
      const curr = ring[i]!;
      const next = ring[(i + 1) % n]!;
      // Spike tip: previous and next vertices coincide, so curr is a zero-area stem.
      if (distSqWorld(prev, next) <= epsSq) {
        changed = true;
        continue;
      }
      withoutTips.push(curr);
    }
    const deduped: WorldPoint[] = [];
    for (const point of withoutTips) {
      const last = deduped[deduped.length - 1];
      if (last && distSqWorld(last, point) <= epsSq) {
        changed = true;
        continue;
      }
      deduped.push(point);
    }
    if (
      deduped.length >= 2 &&
      distSqWorld(deduped[0]!, deduped[deduped.length - 1]!) <= epsSq
    ) {
      deduped.pop();
      changed = true;
    }
    ring = deduped;
  }
  return ring.length >= 3 ? ring : polygon;
}

/**
 * Extrude a 6-inch shell along the filled unit silhouette up to the next slab.
 * Drawn wall polylines are not used (they stay on the faded global wall layer).
 */
export function extrudeUnitEnclosureWalls(
  unit: UnitDescriptor,
  level: BuildingLevel,
  floorHeightM: number,
  wallThicknessM: number,
): WallSegmentDescriptor[] {
  const walls: WallSegmentDescriptor[] = [];
  let segmentIndex = 0;
  const keyPrefix = `unit-wall-${unit.key}`;
  const ring = unitShellRing(unit.polygon);

  if (ring.length < 3) return walls;
  for (let i = 0; i < ring.length; i++) {
    const start = ring[i]!;
    const end = ring[(i + 1) % ring.length]!;
    const segment = wallSegmentFromEndpoints(
      start,
      end,
      level,
      keyPrefix,
      segmentIndex,
      floorHeightM,
      wallThicknessM,
      unit.unitId,
    );
    if (segment) {
      walls.push(segment);
      segmentIndex += 1;
    }
  }
  return walls;
}

/** Opaque 6-inch shell for highlighted units (filled silhouette only). */
export function extrudeHighlightedUnitWalls(
  model: BuildingGeometryModel,
  highlightedUnitIds: Set<string>,
): WallSegmentDescriptor[] {
  if (highlightedUnitIds.size === 0) return [];
  const walls: WallSegmentDescriptor[] = [];
  for (const level of model.levels) {
    for (const unit of level.units) {
      if (!highlightedUnitIds.has(unit.unitId)) continue;
      walls.push(
        ...extrudeUnitEnclosureWalls(
          unit,
          level,
          model.floorHeightM,
          model.wallThicknessM,
        ),
      );
    }
  }
  return walls;
}

function unitsFromAnnotations(
  annotations: FloorPlanAnnotation[],
  pin: PdfPoint,
  metresPerPoint: number,
  floorNumber: number,
  planId: string,
  planName: string,
  elevationM: number,
): UnitDescriptor[] {
  const units: UnitDescriptor[] = [];
  let unitIndex = 0;
  for (let idx = 0; idx < annotations.length; idx++) {
    const item = annotations[idx]!;
    if (item.type !== "room" || item.points.length < 3) continue;
    const label = item.label.trim() || `Unit ${unitIndex + 1}`;
    const worldPolygon = item.points.map((pt) =>
      pdfPointToWorldMetres(pt, pin, metresPerPoint),
    );
    const centerPdf = polygonCentroid(item.points);
    const center = pdfPointToWorldMetres(centerPdf, pin, metresPerPoint);
    const unitId = `${floorNumber}:${label}`;
    units.push({
      key: `unit-${planId}-${idx}`,
      unitId,
      label,
      floorNumber,
      planId,
      planName,
      color: item.color || "#0ea5e9",
      polygon: worldPolygon,
      center,
      elevationM,
    });
    unitIndex++;
  }
  return units.sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true }),
  );
}

function buildLevel(
  plan: FloorPlanDto,
  family: FloorPlanFamilyDto,
  elevationM: number,
): BuildingLevel | null {
  const crop = cropRect(plan, family);
  if (!crop || !planHasPin(plan)) return null;
  const pin = { x: plan.pinXPt!, y: plan.pinYPt! };
  const metresPerPoint = metresPerPdfPoint(family.scaleDenominator);
  return {
    floorNumber: plan.floorNumber,
    planId: plan.id,
    planName: plan.name,
    elevationM,
    metresPerPoint,
    pin,
    crop,
    slab: slabFromCrop(crop, pin, metresPerPoint),
    wallPaths: wallPathsFromAnnotations(
      plan.annotations,
      pin,
      metresPerPoint,
    ),
    units: unitsFromAnnotations(
      plan.annotations,
      pin,
      metresPerPoint,
      plan.floorNumber,
      plan.id,
      plan.name,
      elevationM,
    ),
  };
}

export function buildBuildingGeometry(
  payload: Pick<FloorPlansPayload, "families" | "plans">,
  options?: {
    floorHeightM?: number;
    slabThicknessM?: number;
    wallThicknessM?: number;
  },
): BuildingGeometryModel {
  const floorHeightM = options?.floorHeightM ?? DEFAULT_FLOOR_HEIGHT_M;
  const slabThicknessM = options?.slabThicknessM ?? DEFAULT_SLAB_THICKNESS_M;
  const wallThicknessM = options?.wallThicknessM ?? DEFAULT_WALL_THICKNESS_M;
  const familyById = new Map(payload.families.map((family) => [family.id, family]));
  const skipped: SkippedPlan[] = [];
  const architecturalPlans = payload.plans.filter((plan) => {
    const family = familyById.get(plan.familyId);
    return family?.kind === "architectural";
  });

  const readyPlans: FloorPlanDto[] = [];
  for (const plan of architecturalPlans) {
    const family = familyById.get(plan.familyId);
    const reason = skipReasonForArchitecturalPlan(plan, family);
    if (reason) {
      skipped.push({
        planId: plan.id,
        name: plan.name,
        floorNumber: plan.floorNumber,
        reason,
      });
      continue;
    }
    readyPlans.push(plan);
  }

  const readyFamilies = payload.families.filter(
    (family) => family.kind === "architectural",
  );
  const floorNumbers = [
    ...new Set(readyPlans.map((plan) => plan.floorNumber)),
  ].sort((a, b) => a - b);
  const chosenIds = new Set<string>();
  for (const floorNumber of floorNumbers) {
    const chosen = planForDrawingSetFloor(
      readyPlans,
      readyFamilies,
      "architectural",
      floorNumber,
    );
    if (chosen) chosenIds.add(chosen.id);
  }
  for (const plan of readyPlans) {
    if (chosenIds.has(plan.id)) continue;
    skipped.push({
      planId: plan.id,
      name: plan.name,
      floorNumber: plan.floorNumber,
      reason: "duplicate-floor",
    });
  }

  const elevations = slabElevationsByFloor(floorNumbers, floorHeightM);
  const levels: BuildingLevel[] = [];
  for (const floorNumber of floorNumbers) {
    const plan = planForDrawingSetFloor(
      readyPlans,
      readyFamilies,
      "architectural",
      floorNumber,
    );
    if (!plan) continue;
    const family = familyById.get(plan.familyId);
    if (!isModelReady(plan, family)) continue;
    const elevationM = elevations.get(floorNumber);
    if (elevationM == null) continue;
    const level = buildLevel(plan, family, elevationM);
    if (level) levels.push(level);
  }

  return {
    levels,
    units: levels.flatMap((l) => l.units),
    skipped,
    floorHeightM,
    slabThicknessM,
    wallThicknessM,
  };
}

export function createSlabBlueprintMaterial(
  texture?: Texture | null,
  options?: {
    opacity?: number;
    materialType?: "basic" | "standard";
    transparent?: boolean;
    polygonOffset?: boolean;
    polygonOffsetFactor?: number;
    polygonOffsetUnits?: number;
  },
): MeshBasicMaterial | MeshStandardMaterial {
  const materialType = options?.materialType ?? "basic";
  const params = {
    map: texture ?? null,
    transparent: options?.transparent ?? true,
    opacity: options?.opacity ?? 0.75,
    depthWrite: false,
    polygonOffset: options?.polygonOffset ?? true,
    polygonOffsetFactor: options?.polygonOffsetFactor ?? -1,
    polygonOffsetUnits: options?.polygonOffsetUnits ?? -1,
  };
  return materialType === "standard"
    ? new MeshStandardMaterial({ ...params, roughness: 0.8, metalness: 0.1 })
    : new MeshBasicMaterial(params);
}

export function buildSlabs(
  model: BuildingGeometryModel,
  options?: BuildSlabsOptions,
): SlabDescriptor[] {
  const loader = options?.textureLoader;
  const opacity = options?.blueprintOpacity ?? 0.75;
  const materialType = options?.materialType ?? "basic";

  return model.levels.map((level) => {
    const textureUrl = floorPlanFileUrl(level.planId, "cropped");
    let blueprintMaterial: MeshBasicMaterial | MeshStandardMaterial | undefined;

    if (loader) {
      const texture = loader.load(textureUrl);
      blueprintMaterial = createSlabBlueprintMaterial(texture, {
        opacity,
        materialType,
      });
    }

    return {
      key: `slab-${level.planId}`,
      floorNumber: level.floorNumber,
      planId: level.planId,
      planName: level.planName,
      position: [
        level.slab.centerX,
        level.elevationM - model.slabThicknessM / 2,
        level.slab.centerZ,
      ],
      width: level.slab.width,
      thickness: model.slabThicknessM,
      depth: level.slab.depth,
      elevationM: level.elevationM,
      metresPerPoint: level.metresPerPoint,
      textureUrl,
      overlayPosition: [
        level.slab.centerX,
        level.elevationM + BLUEPRINT_OVERLAY_ELEVATION_OFFSET_M,
        level.slab.centerZ,
      ],
      blueprintMaterial,
    };
  });
}

export function extrudeWalls(model: BuildingGeometryModel): WallSegmentDescriptor[] {
  const walls: WallSegmentDescriptor[] = [];
  for (const level of model.levels) {
    let segmentIndex = 0;
    for (const path of level.wallPaths) {
      for (let i = 1; i < path.length; i++) {
        const start = path[i - 1]!;
        const end = path[i]!;
        const segment = wallSegmentFromEndpoints(
          start,
          end,
          level,
          `wall-${level.planId}`,
          segmentIndex,
          model.floorHeightM,
          model.wallThicknessM,
        );
        if (segment) {
          walls.push(segment);
          segmentIndex += 1;
        }
      }
    }
  }
  return walls;
}

export function modelBounds(model: BuildingGeometryModel): ModelBounds | null {
  if (model.levels.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const include = (x: number, y: number, z: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  };

  for (const slab of buildSlabs(model)) {
    const [x, y, z] = slab.position;
    include(x - slab.width / 2, y - slab.thickness / 2, z - slab.depth / 2);
    include(x + slab.width / 2, y + slab.thickness / 2, z + slab.depth / 2);
  }
  for (const wall of extrudeWalls(model)) {
    const [x, y, z] = wall.position;
    include(x, y, z);
    include(x, y + wall.height, z);
  }
  for (const level of model.levels) {
    include(
      level.slab.centerX - level.slab.width / 2,
      level.elevationM,
      level.slab.centerZ - level.slab.depth / 2,
    );
    include(
      level.slab.centerX + level.slab.width / 2,
      level.elevationM + model.floorHeightM,
      level.slab.centerZ + level.slab.depth / 2,
    );
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  };
}

export function orbitLimitsFromBounds(bounds: ModelBounds | null): OrbitDistanceLimits {
  if (!bounds) {
    return { minDistance: 15, maxDistance: 160 };
  }
  const height = bounds.max[1] - bounds.min[1];
  const width = bounds.max[0] - bounds.min[0];
  const depth = bounds.max[2] - bounds.min[2];
  const maxExtent = Math.max(height, width, depth, 10);
  return {
    minDistance: Math.max(8, maxExtent * 0.15),
    maxDistance: Math.ceil(maxExtent * 2.75),
  };
}
