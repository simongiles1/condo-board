process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const { parseFloorPlanAnnotations } = await import('../lib/building/floor-plan-annotations.js');
  const { pdfPointToWorldMetres, wallTouchesUnit, metresPerPdfPoint } = await import('../lib/building/building-geometry.js');
  const { listEnclosedRoomFaces } = await import('../lib/building/floor-plan-rooms.js');

  const res = await pool.query("select annotations_json, pin_x_pt, pin_y_pt from floor_plans where name = 'Ac208'");
  const row = res.rows[0];
  const famRes = await pool.query("select scale_denominator from floor_plan_families limit 1");
  const scale = metresPerPdfPoint(famRes.rows[0].scale_denominator);
  const pin = { x: row.pin_x_pt, y: row.pin_y_pt };

  const annotations = parseFloorPlanAnnotations(JSON.parse(row.annotations_json || '[]'));
  const u822Ann = annotations.find(a => a.type === 'room' && a.label === '822');
  const u822WorldPoly = u822Ann.points.map(pt => pdfPointToWorldMetres(pt, pin, scale));

  // Let's write the planarize function right here and test it
  const EPS = 1e-9;
  const joinEps = 2; // PT

  function distSq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function nearestPointOnSegment(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq < EPS) return { x: a.x, y: a.y };
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
    return { x: a.x + t * abx, y: a.y + t * aby };
  }

  function properIntersection(a, b, c, d) {
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

  const vertices = [];
  const edges = new Set();
  const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const parseEdgeKey = (key) => key.split('-').map(Number);
  const findOrAddVertex = (pt) => {
    const epsSq = joinEps * joinEps;
    for (let i = 0; i < vertices.length; i++) {
      if (distSq(vertices[i], pt) <= epsSq) return i;
    }
    vertices.push({ x: pt.x, y: pt.y });
    return vertices.length - 1;
  };

  const polylineSegments = [];
  for (const item of annotations) {
    if (item.type !== 'polyline') continue;
    for (let i = 1; i < item.points.length; i++) {
      polylineSegments.push({ a: item.points[i - 1], b: item.points[i] });
    }
  }

  for (const seg of polylineSegments) {
    if (distSq(seg.a, seg.b) <= joinEps * joinEps) continue;
    const a = findOrAddVertex(seg.a);
    const b = findOrAddVertex(seg.b);
    if (a !== b) edges.add(edgeKey(a, b));
  }

  function splitEdgeAtPoints(a, b, splitVertexIds) {
    const start = vertices[a];
    const end = vertices[b];
    const scored = [];
    const abx = end.x - start.x;
    const aby = end.y - start.y;
    const lenSq = abx * abx + aby * aby;
    for (const vId of splitVertexIds) {
      const v = vertices[vId];
      const t = lenSq < EPS ? 0 : ((v.x - start.x) * abx + (v.y - start.y) * aby) / lenSq;
      scored.push({ vId, t });
    }
    scored.sort((x, y) => x.t - y.t);
    const chain = [a, ...scored.map(s => s.vId), b];
    const pieces = [];
    for (let i = 1; i < chain.length; i++) {
      if (chain[i - 1] !== chain[i]) pieces.push([chain[i - 1], chain[i]]);
    }
    return pieces;
  }

  let changed = true;
  let guard = 0;
  while (changed && guard < 32) {
    changed = false;
    guard++;
    const current = [...edges].map(parseEdgeKey);
    for (const [a, b] of current) {
      const start = vertices[a];
      const end = vertices[b];
      if (!start || !end) continue;
      const splitIds = [];
      for (let c = 0; c < vertices.length; c++) {
        if (c === a || c === b) continue;
        const nearest = nearestPointOnSegment(vertices[c], start, end);
        if (distSq(vertices[c], nearest) <= joinEps * joinEps) {
          splitIds.push(c);
        }
      }
      for (const [c, d] of current) {
        if (edgeKey(a, b) === edgeKey(c, d)) continue;
        const hit = properIntersection(start, end, vertices[c], vertices[d]);
        if (!hit) continue;
        splitIds.push(findOrAddVertex(hit));
      }
      if (splitIds.length === 0) continue;
      const pieces = splitEdgeAtPoints(a, b, splitIds);
      if (pieces.length <= 1) continue;
      edges.delete(edgeKey(a, b));
      for (const [from, to] of pieces) edges.add(edgeKey(from, to));
      changed = true;
    }
  }

  console.log(`Planarized into ${vertices.length} vertices and ${edges.size} edges (guard=${guard})`);

  // Now let's convert each edge to world metres and check touching Unit 822
  const worldEdges = [];
  for (const key of edges) {
    const [a, b] = parseEdgeKey(key);
    const startPt = vertices[a];
    const endPt = vertices[b];
    const start = pdfPointToWorldMetres(startPt, pin, scale);
    const end = pdfPointToWorldMetres(endPt, pin, scale);
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const len = Math.hypot(dx, dz);
    worldEdges.push({
      start,
      end,
      len,
      touches822: wallTouchesUnit(start, end, u822WorldPoly),
      startPt,
      endPt,
    });
  }

  const touching822 = worldEdges.filter(e => e.touches822);
  console.log(`\nEdges touching 822: ${touching822.length}`);
  for (const e of touching822) {
    console.log(`  len=${e.len.toFixed(2)}m: start=(${e.start.x.toFixed(2)}, ${e.start.z.toFixed(2)}) -> end=(${e.end.x.toFixed(2)}, ${e.end.z.toFixed(2)}) | PDF: (${e.startPt.x.toFixed(1)}, ${e.startPt.y.toFixed(1)}) -> (${e.endPt.x.toFixed(1)}, ${e.endPt.y.toFixed(1)})`);
  }
}

run().catch(console.error).finally(() => pool.end());
