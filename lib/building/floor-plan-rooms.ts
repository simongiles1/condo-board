/**
 * Closed-room detection from polyline walls. Hover finds the smallest
 * enclosing face; click stores that polygon as a unit.
 *
 * Riser rectangles and circles are not walls. A box inside a unit must not
 * steal the hover face.
 */

import type { PdfPoint } from "@/lib/building/floor-plan-align";
import type { FloorPlanAnnotation } from "@/lib/building/floor-plan-annotations";

const EPS = 1e-9;
/** Default endpoint-join radius in PDF points (closes hairline gaps). */
export const DEFAULT_ROOM_JOIN_EPS_PT = 2;
/**
 * Default max near-miss length treated as a leak. Doorways and the gap
 * between a structural wall and an outer wall are larger than this.
 */
export const DEFAULT_ROOM_LEAK_MAX_GAP_PT = 12;
export const MIN_ROOM_LEAK_MAX_GAP_PT = 3;
export const MAX_ROOM_LEAK_MAX_GAP_PT = 48;
/** Skip leftover-face locality when the sealed room is smaller than this. */
const ROOM_LEAK_HUGE_FACE_AREA = 80_000;
/** PDF-point radius for leaks on a leftover (lobby-sized) sealed face. */
const ROOM_LEAK_LOCAL_PT = 220;

/** Distinct fill/stroke colors cycled per unit on a floor. */
export const ROOM_FILL_COLORS = [
  "#0ea5e9",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#84cc16",
  "#06b6d4",
] as const;

/** Screen px for room unit labels (PH101, etc.) before zoom scaling. */
export const ROOM_LABEL_FONT_PX = 22;

function roomOrdinalAtIndex(
  annotations: FloorPlanAnnotation[],
  annotationIndex: number,
): number {
  let ordinal = 0;
  for (let i = 0; i < annotationIndex; i++) {
    if (annotations[i]?.type === "room") ordinal++;
  }
  return ordinal;
}

/** Display color for a room by its order among rooms on this floor. */
export function roomDisplayColor(
  annotations: FloorPlanAnnotation[],
  annotationIndex: number,
): string {
  return ROOM_FILL_COLORS[
    roomOrdinalAtIndex(annotations, annotationIndex) % ROOM_FILL_COLORS.length
  ]!;
}

/** Color to assign when creating the next room annotation. */
export function nextRoomColor(annotations: FloorPlanAnnotation[]): string {
  const roomCount = annotations.filter((item) => item.type === "room").length;
  return ROOM_FILL_COLORS[roomCount % ROOM_FILL_COLORS.length]!;
}

export type FloorPlanRoomListEntry = {
  /** Annotation index for this unit on the current floor. */
  index: number;
  label: string;
  color: string;
};

/** Rooms on a floor for the ribbon list (sorted by unit label). */
export function listFloorPlanRooms(
  annotations: FloorPlanAnnotation[],
): FloorPlanRoomListEntry[] {
  const entries: FloorPlanRoomListEntry[] = [];
  for (let index = 0; index < annotations.length; index++) {
    const item = annotations[index];
    if (item.type !== "room") continue;
    entries.push({
      index,
      label: item.label,
      color: roomDisplayColor(annotations, index),
    });
  }
  return entries.sort((left, right) => {
    const leftKey = left.label.trim() || "\uffff";
    const rightKey = right.label.trim() || "\uffff";
    return leftKey.localeCompare(rightKey, undefined, { numeric: true });
  });
}

export function shiftRoomUiIndexAfterRemoval(
  index: number | null,
  removedIndex: number,
): number | null {
  if (index == null) return null;
  if (index === removedIndex) return null;
  if (index > removedIndex) return index - 1;
  return index;
}

export type RoomFace = {
  points: PdfPoint[];
  area: number;
};

/** A near-miss between wall pieces that would close a room if joined. */
export type RoomLeak = {
  a: PdfPoint;
  b: PdfPoint;
  width: number;
};

type SealedRoomFace = RoomFace & { leakIds: number[] };

/** Precomputed real faces plus virtual-gap seals for hover leak hints. */
export type RoomLeakIndex = {
  realFaces: RoomFace[];
  sealedFaces: SealedRoomFace[];
  leaks: RoomLeak[];
};

export function clampRoomLeakMaxGapPt(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ROOM_LEAK_MAX_GAP_PT;
  return Math.min(
    MAX_ROOM_LEAK_MAX_GAP_PT,
    Math.max(MIN_ROOM_LEAK_MAX_GAP_PT, Math.round(value)),
  );
}

type Vertex = PdfPoint;

function distSq(a: PdfPoint, b: PdfPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function nearestPointOnSegment(
  p: PdfPoint,
  a: PdfPoint,
  b: PdfPoint,
): PdfPoint {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < EPS) return { ...a };
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq),
  );
  return { x: a.x + abx * t, y: a.y + aby * t };
}

function almostEqual(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

export function polygonArea(points: PdfPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonCentroid(points: PdfPoint[]): PdfPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length < 3) {
    let x = 0;
    let y = 0;
    for (const point of points) {
      x += point.x;
      y += point.y;
    }
    return { x: x / points.length, y: y / points.length };
  }
  const area = polygonArea(points);
  if (Math.abs(area) < EPS) {
    let x = 0;
    let y = 0;
    for (const point of points) {
      x += point.x;
      y += point.y;
    }
    return { x: x / points.length, y: y / points.length };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  const scale = 1 / (6 * area);
  return { x: cx * scale, y: cy * scale };
}

/** Even-odd ray test. Boundary points count as inside. */
export function pointInPolygon(point: PdfPoint, polygon: PdfPoint[]): boolean {
  if (polygon.length < 3) return false;
  if (pointOnPolygonBoundary(point, polygon, 1e-6)) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + EPS) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointOnPolygonBoundary(
  point: PdfPoint,
  polygon: PdfPoint[],
  eps: number,
): boolean {
  const epsSq = eps * eps;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const nearest = nearestPointOnSegment(point, a, b);
    if (distSq(point, nearest) <= epsSq) return true;
  }
  return false;
}

function dropClosingDuplicate(points: PdfPoint[]): PdfPoint[] {
  if (points.length < 2) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (distSq(first, last) <= EPS) return points.slice(0, -1);
  return points;
}

function dropConsecutiveDuplicates(points: PdfPoint[], eps: number): PdfPoint[] {
  const epsSq = eps * eps;
  const next: PdfPoint[] = [];
  for (const point of points) {
    const prev = next[next.length - 1];
    if (prev && distSq(prev, point) <= epsSq) continue;
    next.push(point);
  }
  return next;
}

/**
 * Canonical ring: no closing duplicate, CCW, rotated so the lexicographically
 * smallest vertex is first. Used to compare hover faces to saved rooms.
 */
export function normalizeRoomPolygon(
  points: PdfPoint[],
  eps = EPS,
): PdfPoint[] {
  let ring = dropClosingDuplicate(dropConsecutiveDuplicates(points, eps));
  if (ring.length < 3) return ring;
  if (polygonArea(ring) < 0) ring = [...ring].reverse();
  let start = 0;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[start]!;
    if (a.x < b.x - eps || (almostEqual(a.x, b.x, eps) && a.y < b.y - eps)) {
      start = i;
    }
  }
  if (start === 0) return ring;
  return [...ring.slice(start), ...ring.slice(0, start)];
}

export function roomPolygonsEqual(
  a: PdfPoint[],
  b: PdfPoint[],
  eps = 0.05,
): boolean {
  const left = normalizeRoomPolygon(a, eps);
  const right = normalizeRoomPolygon(b, eps);
  if (left.length !== right.length) return false;
  return left.every((point, index) => distSq(point, right[index]!) <= eps * eps);
}

export function findMatchingRoomIndex(
  annotations: FloorPlanAnnotation[],
  face: PdfPoint[],
  eps = 0.05,
): number | null {
  for (let i = 0; i < annotations.length; i++) {
    const item = annotations[i];
    if (item.type !== "room") continue;
    if (roomPolygonsEqual(item.points, face, eps)) return i;
  }
  return null;
}

function polylineWallSegments(annotations: FloorPlanAnnotation[]): {
  a: PdfPoint;
  b: PdfPoint;
}[] {
  const segments: { a: PdfPoint; b: PdfPoint }[] = [];
  for (const item of annotations) {
    if (item.type !== "polyline") continue;
    for (let i = 1; i < item.points.length; i++) {
      segments.push({ a: item.points[i - 1]!, b: item.points[i]! });
    }
  }
  return segments;
}

function findOrAddVertex(
  vertices: Vertex[],
  point: PdfPoint,
  eps: number,
): number {
  const epsSq = eps * eps;
  for (let i = 0; i < vertices.length; i++) {
    if (distSq(vertices[i]!, point) <= epsSq) return i;
  }
  vertices.push({ x: point.x, y: point.y });
  return vertices.length - 1;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function parseEdgeKey(key: string): [number, number] {
  const [a, b] = key.split("-").map((part) => Number(part));
  return [a!, b!];
}

function segmentParam(point: PdfPoint, a: PdfPoint, b: PdfPoint): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < EPS) return 0;
  return ((point.x - a.x) * abx + (point.y - a.y) * aby) / lenSq;
}

function properIntersection(
  a: PdfPoint,
  b: PdfPoint,
  c: PdfPoint,
  d: PdfPoint,
): PdfPoint | null {
  const dx1 = b.x - a.x;
  const dy1 = b.y - a.y;
  const dx2 = d.x - c.x;
  const dy2 = d.y - c.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < EPS) return null;
  const t = ((c.x - a.x) * dy2 - (c.y - a.y) * dx2) / denom;
  const u = ((c.x - a.x) * dy1 - (c.y - a.y) * dx1) / denom;
  const pad = 1e-6;
  if (t <= pad || t >= 1 - pad || u <= pad || u >= 1 - pad) return null;
  return { x: a.x + dx1 * t, y: a.y + dy1 * t };
}

function splitEdgeAtPoints(
  vertices: Vertex[],
  a: number,
  b: number,
  splitIds: number[],
): [number, number][] {
  const start = vertices[a]!;
  const end = vertices[b]!;
  const unique = [...new Set(splitIds)].filter((id) => id !== a && id !== b);
  const ordered = unique
    .map((id) => ({ id, t: segmentParam(vertices[id]!, start, end) }))
    .filter((entry) => entry.t > 1e-6 && entry.t < 1 - 1e-6)
    .sort((left, right) => left.t - right.t);
  const chain = [a, ...ordered.map((entry) => entry.id), b];
  const next: [number, number][] = [];
  for (let i = 1; i < chain.length; i++) {
    const from = chain[i - 1]!;
    const to = chain[i]!;
    if (from !== to) next.push([from, to]);
  }
  return next;
}

export function planarizeWalls(
  annotations: FloorPlanAnnotation[],
  joinEps: number,
): { vertices: Vertex[]; edges: Set<string> } {
  const vertices: Vertex[] = [];
  const edges = new Set<string>();

  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    edges.add(edgeKey(a, b));
  };

  for (const segment of polylineWallSegments(annotations)) {
    if (distSq(segment.a, segment.b) <= joinEps * joinEps) continue;
    const a = findOrAddVertex(vertices, segment.a, joinEps);
    const b = findOrAddVertex(vertices, segment.b, joinEps);
    addEdge(a, b);
  }

  let changed = true;
  let guard = 0;
  while (changed && guard < 32) {
    changed = false;
    guard += 1;
    const current = [...edges].map(parseEdgeKey);
    for (const [a, b] of current) {
      const start = vertices[a];
      const end = vertices[b];
      if (!start || !end) continue;
      const splitIds: number[] = [];
      for (let c = 0; c < vertices.length; c++) {
        if (c === a || c === b) continue;
        const nearest = nearestPointOnSegment(vertices[c]!, start, end);
        if (distSq(vertices[c]!, nearest) <= joinEps * joinEps) {
          splitIds.push(c);
        }
      }
      for (const [c, d] of current) {
        if (edgeKey(a, b) === edgeKey(c, d)) continue;
        const hit = properIntersection(
          start,
          end,
          vertices[c]!,
          vertices[d]!,
        );
        if (!hit) continue;
        splitIds.push(findOrAddVertex(vertices, hit, joinEps));
      }
      if (splitIds.length === 0) continue;
      const pieces = splitEdgeAtPoints(vertices, a, b, splitIds);
      if (pieces.length <= 1) continue;
      edges.delete(edgeKey(a, b));
      for (const [from, to] of pieces) addEdge(from, to);
      changed = true;
    }
  }

  return { vertices, edges };
}

function adjacencyFromEdges(
  vertexCount: number,
  edges: Set<string>,
): number[][] {
  const adj: number[][] = Array.from({ length: vertexCount }, () => []);
  for (const key of edges) {
    const [a, b] = parseEdgeKey(key);
    adj[a]!.push(b);
    adj[b]!.push(a);
  }
  return adj;
}

function sortNeighborsCcw(
  vertices: Vertex[],
  origin: number,
  neighbors: number[],
): number[] {
  const o = vertices[origin]!;
  return [...neighbors].sort((a, b) => {
    const pa = vertices[a]!;
    const pb = vertices[b]!;
    return (
      Math.atan2(pa.y - o.y, pa.x - o.x) - Math.atan2(pb.y - o.y, pb.x - o.x)
    );
  });
}

function nextOutgoing(
  adj: number[][],
  from: number,
  to: number,
): number | null {
  const neighbors = adj[to];
  if (!neighbors || neighbors.length === 0) return null;
  const reverseIndex = neighbors.indexOf(from);
  if (reverseIndex < 0) return neighbors[0] ?? null;
  return neighbors[(reverseIndex - 1 + neighbors.length) % neighbors.length] ?? null;
}

function walkFaces(vertices: Vertex[], edges: Set<string>): RoomFace[] {
  const adj = adjacencyFromEdges(vertices.length, edges).map((neighbors, i) =>
    sortNeighborsCcw(vertices, i, neighbors),
  );
  const used = new Set<string>();
  const faces: RoomFace[] = [];

  const mark = (from: number, to: number) => `${from}>${to}`;

  for (const key of edges) {
    const [u, v] = parseEdgeKey(key);
    for (const [startFrom, startTo] of [
      [u, v],
      [v, u],
    ] as const) {
      if (used.has(mark(startFrom, startTo))) continue;
      const ids: number[] = [startFrom];
      let from = startFrom;
      let to = startTo;
      let steps = 0;
      const maxSteps = vertices.length * 4 + 8;
      while (steps < maxSteps) {
        steps += 1;
        used.add(mark(from, to));
        ids.push(to);
        const next = nextOutgoing(adj, from, to);
        if (next == null) break;
        from = to;
        to = next;
        if (from === startFrom && to === startTo) break;
      }
      if (ids.length < 4) continue;
      if (ids[ids.length - 1] === ids[0]) ids.pop();
      const points = ids.map((id) => vertices[id]!);
      const area = polygonArea(points);
      if (area <= EPS) continue;
      faces.push({ points: normalizeRoomPolygon(points), area });
    }
  }

  return faces;
}

function pickContainingFace(point: PdfPoint, faces: RoomFace[]): RoomFace | null {
  let best: RoomFace | null = null;
  for (const face of faces) {
    if (!pointInPolygon(point, face.points)) continue;
    if (!best || face.area < best.area) best = face;
  }
  return best;
}

/**
 * Every bounded polyline face. Used to cache enclosure while walls are still.
 */
export function listEnclosedRoomFaces(
  annotations: FloorPlanAnnotation[],
  joinEps = DEFAULT_ROOM_JOIN_EPS_PT,
): RoomFace[] {
  const { vertices, edges } = planarizeWalls(annotations, joinEps);
  if (edges.size < 3) return [];
  return walkFaces(vertices, edges);
}

/**
 * Smallest bounded polyline face that contains `point`, or null when the
 * walls around it are not closed.
 */
export function enclosingRoomFace(
  point: PdfPoint,
  annotations: FloorPlanAnnotation[],
  joinEps = DEFAULT_ROOM_JOIN_EPS_PT,
): RoomFace | null {
  return pickContainingFace(point, listEnclosedRoomFaces(annotations, joinEps));
}

export function enclosingRoomFaceFromCache(
  point: PdfPoint,
  faces: RoomFace[],
): RoomFace | null {
  return pickContainingFace(point, faces);
}

function copyPoint(point: PdfPoint): PdfPoint {
  return { x: point.x, y: point.y };
}

function segmentOnRing(
  a: PdfPoint,
  b: PdfPoint,
  ring: PdfPoint[],
  eps: number,
): boolean {
  const epsSq = eps * eps;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const same =
      (distSq(p, a) <= epsSq && distSq(q, b) <= epsSq) ||
      (distSq(p, b) <= epsSq && distSq(q, a) <= epsSq);
    if (same) return true;
  }
  return false;
}

/**
 * Bridge dangling wall ends that sit closer than `maxGap` to another wall.
 * Dangling-to-dangling wins over T-junctions so a 4pt corner miss is not
 * swallowed by a parallel wall a few points away (double-line thickness).
 */
function addNearMissBridges(
  vertices: Vertex[],
  edges: Set<string>,
  joinEps: number,
  maxGap: number,
): RoomLeak[] {
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    edges.add(edgeKey(a, b));
  };
  const adj = adjacencyFromEdges(vertices.length, edges);
  const dangling: number[] = [];
  for (let i = 0; i < adj.length; i++) {
    if (adj[i]!.length === 1) dangling.push(i);
  }

  type Pending =
    | { from: number; toId: number }
    | { from: number; hit: PdfPoint };

  const pending: Pending[] = [];
  const paired = new Set<number>();

  for (const from of dangling) {
    if (paired.has(from)) continue;
    let bestId: number | null = null;
    let bestDist = maxGap;
    for (const to of dangling) {
      if (to === from || paired.has(to)) continue;
      if (adj[from]!.includes(to)) continue;
      const dist = Math.sqrt(distSq(vertices[from]!, vertices[to]!));
      if (dist <= joinEps || dist > maxGap) continue;
      if (dist < bestDist) {
        bestDist = dist;
        bestId = to;
      }
    }
    if (bestId == null) continue;
    paired.add(from);
    paired.add(bestId);
    pending.push({ from, toId: bestId });
  }

  for (const from of dangling) {
    if (paired.has(from)) continue;
    let bestDist = maxGap;
    let bestHit: PdfPoint | null = null;
    for (const key of edges) {
      const [c, d] = parseEdgeKey(key);
      if (c === from || d === from) continue;
      const nearest = nearestPointOnSegment(
        vertices[from]!,
        vertices[c]!,
        vertices[d]!,
      );
      const dist = Math.sqrt(distSq(vertices[from]!, nearest));
      if (dist <= joinEps || dist > maxGap) continue;
      if (dist < bestDist) {
        bestDist = dist;
        bestHit = nearest;
      }
    }
    if (bestHit) pending.push({ from, hit: bestHit });
  }

  const leaks: RoomLeak[] = [];
  for (const bridge of pending) {
    const fromPt = vertices[bridge.from]!;
    if ("toId" in bridge) {
      const toPt = vertices[bridge.toId]!;
      addEdge(bridge.from, bridge.toId);
      leaks.push({
        a: copyPoint(fromPt),
        b: copyPoint(toPt),
        width: Math.sqrt(distSq(fromPt, toPt)),
      });
      continue;
    }
    const hitId = findOrAddVertex(vertices, bridge.hit, joinEps);
    const hitPt = vertices[hitId]!;
    for (const key of [...edges]) {
      const [c, d] = parseEdgeKey(key);
      if (c === hitId || d === hitId) continue;
      const nearest = nearestPointOnSegment(hitPt, vertices[c]!, vertices[d]!);
      if (distSq(hitPt, nearest) > joinEps * joinEps) continue;
      edges.delete(key);
      addEdge(c, hitId);
      addEdge(hitId, d);
      break;
    }
    if (hitId === bridge.from) continue;
    addEdge(bridge.from, hitId);
    leaks.push({
      a: copyPoint(fromPt),
      b: copyPoint(hitPt),
      width: Math.sqrt(distSq(fromPt, hitPt)),
    });
  }
  return leaks;
}

/**
 * Faces as drawn, plus the same graph with small dangling gaps sealed.
 * Hover then asks {@link roomLeaksAtPoint} which seals belong to this room.
 */
export function buildRoomLeakIndex(
  annotations: FloorPlanAnnotation[],
  joinEps = DEFAULT_ROOM_JOIN_EPS_PT,
  maxGap = DEFAULT_ROOM_LEAK_MAX_GAP_PT,
): RoomLeakIndex {
  const { vertices, edges } = planarizeWalls(annotations, joinEps);
  const realFaces = edges.size < 3 ? [] : walkFaces(vertices, edges);
  if (maxGap <= joinEps) {
    return { realFaces, sealedFaces: [], leaks: [] };
  }
  const sealedVertices = vertices.map(copyPoint);
  const sealedEdges = new Set(edges);
  const leaks = addNearMissBridges(
    sealedVertices,
    sealedEdges,
    joinEps,
    maxGap,
  );
  const sealedRaw =
    sealedEdges.size < 3 ? [] : walkFaces(sealedVertices, sealedEdges);
  const matchEps = joinEps + 1e-3;
  const sealedFaces: SealedRoomFace[] = sealedRaw.map((face) => ({
    ...face,
    leakIds: leaks.flatMap((leak, i) =>
      segmentOnRing(leak.a, leak.b, face.points, matchEps) ? [i] : [],
    ),
  }));
  return { realFaces, sealedFaces, leaks };
}

/**
 * Leaks whose virtual seal shrinks the enclosure under `point`. Large leftover
 * faces (a lobby that several units leaked into) only show nearby leaks.
 */
export function roomLeaksAtPoint(
  point: PdfPoint,
  index: RoomLeakIndex,
): RoomLeak[] {
  const real = pickContainingFace(point, index.realFaces);
  let sealed: SealedRoomFace | null = null;
  for (const face of index.sealedFaces) {
    if (!pointInPolygon(point, face.points)) continue;
    if (!sealed || face.area < sealed.area) sealed = face;
  }
  if (!sealed || sealed.leakIds.length === 0) return [];
  if (real && sealed.area >= real.area * 0.98) return [];
  const leaks = sealed.leakIds.map((id) => index.leaks[id]!);
  if (sealed.area <= ROOM_LEAK_HUGE_FACE_AREA || leaks.length <= 2) {
    return leaks;
  }
  const localSq = ROOM_LEAK_LOCAL_PT * ROOM_LEAK_LOCAL_PT;
  const nearby = leaks.filter((leak) => {
    const mid = {
      x: (leak.a.x + leak.b.x) / 2,
      y: (leak.a.y + leak.b.y) / 2,
    };
    return distSq(point, mid) <= localSq;
  });
  if (nearby.length > 0) return nearby;
  let nearest = leaks[0]!;
  let nearestDist = Infinity;
  for (const leak of leaks) {
    const mid = {
      x: (leak.a.x + leak.b.x) / 2,
      y: (leak.a.y + leak.b.y) / 2,
    };
    const d = distSq(point, mid);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = leak;
    }
  }
  return [nearest];
}
