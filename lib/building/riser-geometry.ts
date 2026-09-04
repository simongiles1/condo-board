/**
 * Parametric 3D riser sweep and terminal equipment geometry.
 *
 * Converts 2D mechanical riser nodes across floor plans into
 * continuous 3D volumetric pipe runs (Three.js TubeGeometry)
 * with smooth bend fillets at horizontal transfer jogs.
 */

import {
  CurvePath,
  LineCurve3,
  QuadraticBezierCurve3,
  TubeGeometry,
  Vector3,
} from "three";

import {
  DEFAULT_FLOOR_HEIGHT_M,
  metresPerPdfPoint,
  pdfPointToWorldMetres,
  slabElevationsByFloor,
} from "@/lib/building/building-geometry";
import {
  calloutRiserIds,
} from "@/lib/building/floor-plan-mechanical-risers";
import { boxCenter, isConnectableBox } from "@/lib/building/floor-plan-riser-links";
import type {
  FloorPlansPayload,
} from "@/lib/building/floor-plan-shared";

export const DEFAULT_PIPE_RADIUS_M = 0.06; // 120 mm diameter
export const DEFAULT_BEND_RADIUS_M = 0.25; // 250 mm fillet radius
export const DEFAULT_JOG_ELEVATION_OFFSET_M = 0.4; // 400 mm above slab level for horizontal offsets
export const DEFAULT_TUBULAR_SEGMENTS_PER_M = 4;
export const DEFAULT_RADIAL_SEGMENTS = 8;

export type Point3D = [number, number, number];

export type RawRiserNode = {
  riserId: string;
  floorNumber: number;
  planId: string;
  role?: "above" | "below";
  partnerId?: string;
  worldPosition: Point3D;
};

export type RiserDescriptor = {
  riserId: string;
  label: string;
  systemName: string;
  systemColor: string;
  typeId: string;
  completed: boolean;
  minFloor: number;
  maxFloor: number;
  connectedFloors: number[];
  nodeCount: number;
  pipeRadius: number;
  /** Sequential vertices along the 3D pipe run [x, y, z]. */
  points: Point3D[];
  /** Bottom terminal coordinate [x, y, z]. */
  bottomTerminal: Point3D;
  /** Top terminal coordinate [x, y, z]. */
  topTerminal: Point3D;
  totalLengthM: number;
};

export type TerminalEquipmentDescriptor = {
  key: string;
  riserId: string;
  label: string;
  systemName: string;
  systemColor: string;
  position: Point3D;
  kind: "box" | "cylinder";
  dimensions: [number, number, number]; // [w, h, d] or [radius, height, radius]
};

export type SystemTypeSummary = {
  id: string;
  name: string;
  color: string;
  count: number;
};

export type BuildingRiserGeometryModel = {
  risers: RiserDescriptor[];
  equipment: TerminalEquipmentDescriptor[];
  systemTypes: SystemTypeSummary[];
  totalRiserCount: number;
  totalPipeLengthM: number;
};

export type BuildRiserGeometryOptions = {
  floorHeightM?: number;
  pipeRadiusM?: number;
  bendRadiusM?: number;
  jogElevationOffsetM?: number;
  floorElevations?: Map<number, number>;
};

/**
 * Creates a Three.js CurvePath from sequential 3D points, filleting sharp
 * 90-degree corners with quadratic bezier curves to prevent pinched TubeGeometry miters.
 */
export function createFilletedCurve(
  points: Point3D[],
  bendRadiusM = DEFAULT_BEND_RADIUS_M,
): CurvePath<Vector3> {
  const curve = new CurvePath<Vector3>();
  if (points.length < 2) return curve;

  const pts = points.map((p) => new Vector3(p[0], p[1], p[2]));
  let lastPt = pts[0]!;

  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    const next = pts[i + 1]!;

    const d1 = new Vector3().subVectors(prev, cur);
    const d2 = new Vector3().subVectors(next, cur);
    const l1 = d1.length();
    const l2 = d2.length();

    // Limit bend radius to 40% of the adjacent segment lengths so bends don't overlap
    const maxRadius = Math.min(bendRadiusM, l1 * 0.4, l2 * 0.4);
    if (l1 > 1e-4) d1.normalize();
    if (l2 > 1e-4) d2.normalize();

    // If nearly collinear or radius too small, keep straight segment
    if (d1.dot(d2) > 0.999 || d1.dot(d2) < -0.999 || maxRadius < 0.01) {
      if (lastPt.distanceTo(cur) > 1e-4) {
        curve.add(new LineCurve3(lastPt, cur));
        lastPt = cur;
      }
      continue;
    }

    const pIn = new Vector3().copy(cur).addScaledVector(d1, maxRadius);
    const pOut = new Vector3().copy(cur).addScaledVector(d2, maxRadius);

    if (lastPt.distanceTo(pIn) > 1e-4) {
      curve.add(new LineCurve3(lastPt, pIn));
    }
    curve.add(new QuadraticBezierCurve3(pIn, cur, pOut));
    lastPt = pOut;
  }

  const endPt = pts[pts.length - 1]!;
  if (lastPt.distanceTo(endPt) > 1e-4) {
    curve.add(new LineCurve3(lastPt, endPt));
  }

  return curve;
}

/**
 * Creates a TubeGeometry for a riser run from its sequential 3D points.
 */
export function createRiserTubeGeometry(
  points: Point3D[],
  options?: {
    pipeRadiusM?: number;
    bendRadiusM?: number;
    radialSegments?: number;
  },
): TubeGeometry | null {
  if (points.length < 2) return null;
  const path = createFilletedCurve(points, options?.bendRadiusM ?? DEFAULT_BEND_RADIUS_M);
  if (path.curves.length === 0) return null;

  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]![0] - points[i - 1]![0];
    const dy = points[i]![1] - points[i - 1]![1];
    const dz = points[i]![2] - points[i - 1]![2];
    totalLength += Math.hypot(dx, dy, dz);
  }

  const tubularSegments = Math.max(
    8,
    Math.round(totalLength * DEFAULT_TUBULAR_SEGMENTS_PER_M) + path.curves.length * 3,
  );
  const pipeRadius = options?.pipeRadiusM ?? DEFAULT_PIPE_RADIUS_M;
  const radialSegments = options?.radialSegments ?? DEFAULT_RADIAL_SEGMENTS;

  return new TubeGeometry(path, tubularSegments, pipeRadius, radialSegments, false);
}

/**
 * Extracts and maps all labeled mechanical riser nodes from floor plan annotations
 * into 3D world coordinates.
 */
export function extractRawRiserNodes(
  payload: Pick<FloorPlansPayload, "families" | "plans">,
  elevations: Map<number, number>,
): RawRiserNode[] {
  const familyById = new Map(payload.families.map((f) => [f.id, f]));
  const nodes: RawRiserNode[] = [];

  for (const plan of payload.plans) {
    if (plan.pinXPt == null || plan.pinYPt == null) continue;
    const family = familyById.get(plan.familyId);
    const metresPerPoint = metresPerPdfPoint(family?.scaleDenominator);
    const elevationM = elevations.get(plan.floorNumber) ?? 0;
    const pin = { x: plan.pinXPt, y: plan.pinYPt };

    for (const item of plan.annotations) {
      if (!isConnectableBox(item) || !item.callout) continue;
      const rids = calloutRiserIds(item.callout);
      if (rids.length === 0) continue;

      const center = boxCenter(item);
      const world = pdfPointToWorldMetres(center, pin, metresPerPoint);
      const worldPosition: Point3D = [world.x, elevationM, world.z];

      for (const riserId of rids) {
        nodes.push({
          riserId,
          floorNumber: plan.floorNumber,
          planId: plan.id,
          role: item.riserRole,
          partnerId: item.riserPartnerId,
          worldPosition,
        });
      }
    }
  }

  return nodes;
}

/**
 * Groups and stitches 3D riser nodes into an ordered 3D path, correctly
 * routing through horizontal offset pairs ('below' -> 'above').
 */
function buildPathForRiser(
  riserNodes: RawRiserNode[],
  floorHeightM: number,
  jogOffsetM: number,
): Point3D[] {
  if (riserNodes.length === 0) return [];

  // Group nodes by floor number
  const nodesByFloor = new Map<number, RawRiserNode[]>();
  for (const node of riserNodes) {
    const list = nodesByFloor.get(node.floorNumber) ?? [];
    list.push(node);
    nodesByFloor.set(node.floorNumber, list);
  }

  const sortedFloors = [...nodesByFloor.keys()].sort((a, b) => a - b);
  const path: Point3D[] = [];

  for (let fi = 0; fi < sortedFloors.length; fi++) {
    const floor = sortedFloors[fi]!;
    const floorNodes = nodesByFloor.get(floor)!;

    // Check if floor has an offset pair ('below' and 'above')
    const belowNode = floorNodes.find((n) => n.role === "below");
    const aboveNode = floorNodes.find((n) => n.role === "above");

    if (belowNode && aboveNode) {
      const [bx, by, bz] = belowNode.worldPosition;
      const [ax, , az] = aboveNode.worldPosition;
      const jogElevation = by + jogOffsetM;

      // Pipe arrives at below box at slab level
      path.push([bx, by, bz]);
      // Rises to horizontal jog elevation
      path.push([bx, jogElevation, bz]);
      // Runs horizontally to above box
      path.push([ax, jogElevation, az]);
      // Continues through the above box upward
      path.push([ax, by + floorHeightM, az]);
    } else {
      // Single box (or deduplicated box)
      const primaryNode = belowNode ?? aboveNode ?? floorNodes[0]!;
      const [x, y, z] = primaryNode.worldPosition;

      // Add slab passage point
      path.push([x, y, z]);

      // If this is the last floor of a single-floor riser, extend to ceiling
      if (sortedFloors.length === 1) {
        path.push([x, y + floorHeightM, z]);
      }
    }
  }

  // Deduplicate consecutive identical points
  const cleanPath: Point3D[] = [];
  for (const pt of path) {
    if (cleanPath.length === 0) {
      cleanPath.push(pt);
      continue;
    }
    const prev = cleanPath[cleanPath.length - 1]!;
    const dist = Math.hypot(pt[0] - prev[0], pt[1] - prev[1], pt[2] - prev[2]);
    if (dist > 1e-4) {
      cleanPath.push(pt);
    }
  }

  return cleanPath;
}

/**
 * Builds the complete Phase 2 3D volumetric riser sweep and equipment model.
 */
export function buildRiserGeometry(
  payload: Pick<FloorPlansPayload, "families" | "plans" | "settings">,
  options?: BuildRiserGeometryOptions,
): BuildingRiserGeometryModel {
  const floorHeightM = options?.floorHeightM ?? DEFAULT_FLOOR_HEIGHT_M;
  const pipeRadiusM = options?.pipeRadiusM ?? DEFAULT_PIPE_RADIUS_M;
  const jogOffsetM = options?.jogElevationOffsetM ?? DEFAULT_JOG_ELEVATION_OFFSET_M;

  // Determine all distinct floor numbers to compute standard elevations
  const allFloors = [
    ...new Set(payload.plans.map((p) => p.floorNumber)),
  ].sort((a, b) => a - b);
  const elevations =
    options?.floorElevations ?? slabElevationsByFloor(allFloors, floorHeightM);

  // Extract all mechanical riser nodes
  const rawNodes = extractRawRiserNodes(payload, elevations);

  // Index catalog risers and system type presets
  const riserById = new Map(payload.settings.mechanicalRisers.map((r) => [r.id, r]));
  const typeById = new Map<string, { name: string; color: string }>();

  // Collect types from draw color presets
  for (const preset of payload.settings.drawColorPresets) {
    if (preset.family === "mechanical" && preset.typeId) {
      typeById.set(preset.typeId, { name: preset.label, color: preset.color });
    }
  }

  // Group raw nodes by riserId
  const nodesByRiser = new Map<string, RawRiserNode[]>();
  for (const node of rawNodes) {
    const list = nodesByRiser.get(node.riserId) ?? [];
    list.push(node);
    nodesByRiser.set(node.riserId, list);
  }

  const risers: RiserDescriptor[] = [];
  const equipment: TerminalEquipmentDescriptor[] = [];
  const typeCountMap = new Map<string, number>();
  let totalPipeLengthM = 0;

  for (const [riserId, nodes] of nodesByRiser.entries()) {
    const catalogRiser = riserById.get(riserId);
    const typeInfo = catalogRiser ? typeById.get(catalogRiser.typeId) : undefined;

    const label = catalogRiser?.label ?? riserId.slice(0, 6);
    const systemName = typeInfo?.name ?? "Mechanical";
    const systemColor = typeInfo?.color ?? "#0ea5e9";
    const typeId = catalogRiser?.typeId ?? "general";
    const completed = catalogRiser?.completed ?? false;

    // Increment type count
    typeCountMap.set(typeId, (typeCountMap.get(typeId) ?? 0) + 1);

    // Build the 3D path with jogs
    const path = buildPathForRiser(nodes, floorHeightM, jogOffsetM);
    if (path.length < 2) continue;

    // Calculate length
    let riserLength = 0;
    for (let i = 1; i < path.length; i++) {
      riserLength += Math.hypot(
        path[i]![0] - path[i - 1]![0],
        path[i]![1] - path[i - 1]![1],
        path[i]![2] - path[i - 1]![2],
      );
    }
    totalPipeLengthM += riserLength;

    const floors = nodes.map((n) => n.floorNumber);
    const connectedFloors = [...new Set(floors)].sort((a, b) => a - b);
    const minFloor = Math.min(...floors);
    const maxFloor = Math.max(...floors);
    const bottomTerminal = path[0]!;
    const topTerminal = path[path.length - 1]!;

    risers.push({
      riserId,
      label,
      systemName,
      systemColor,
      typeId,
      completed,
      minFloor,
      maxFloor,
      connectedFloors,
      nodeCount: nodes.length,
      pipeRadius: pipeRadiusM,
      points: path,
      bottomTerminal,
      topTerminal,
      totalLengthM: riserLength,
    });

    // Create terminal equipment primitive at endpoints
    // Bottom terminal: base collector/sump pit box
    equipment.push({
      key: `equip-base-${riserId}`,
      riserId,
      label: `${label} Base`,
      systemName,
      systemColor,
      position: [bottomTerminal[0], bottomTerminal[1] - 0.2, bottomTerminal[2]],
      kind: "cylinder",
      dimensions: [pipeRadiusM * 2.5, 0.4, pipeRadiusM * 2.5],
    });

    // Top terminal: vent cowl or air handler box
    equipment.push({
      key: `equip-top-${riserId}`,
      riserId,
      label: `${label} Vent/Cap`,
      systemName,
      systemColor,
      position: [topTerminal[0], topTerminal[1] + 0.15, topTerminal[2]],
      kind: "box",
      dimensions: [pipeRadiusM * 3.0, 0.3, pipeRadiusM * 3.0],
    });
  }

  // Sort risers by system name and label
  risers.sort((a, b) => {
    const comp = a.systemName.localeCompare(b.systemName);
    if (comp !== 0) return comp;
    return a.label.localeCompare(b.label, undefined, { numeric: true });
  });

  // Summary of system types
  const systemTypes: SystemTypeSummary[] = [];
  for (const [tid, info] of typeById.entries()) {
    const count = typeCountMap.get(tid) ?? 0;
    if (count > 0) {
      systemTypes.push({
        id: tid,
        name: info.name,
        color: info.color,
        count,
      });
    }
  }

  return {
    risers,
    equipment,
    systemTypes,
    totalRiserCount: risers.length,
    totalPipeLengthM,
  };
}
