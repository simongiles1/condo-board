process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const { parseFloorPlanAnnotations } = await import('../lib/building/floor-plan-annotations.js');
  const { pdfPointToWorldMetres, metresPerPdfPoint } = await import('../lib/building/building-geometry.js');
  const { planarizeWalls, DEFAULT_ROOM_JOIN_EPS_PT, pointInPolygon } = await import('../lib/building/floor-plan-rooms.js');

  const res = await pool.query("select annotations_json, pin_x_pt, pin_y_pt from floor_plans where name = 'Ac208'");
  const row = res.rows[0];
  const famRes = await pool.query("select scale_denominator from floor_plan_families limit 1");
  const scale = metresPerPdfPoint(famRes.rows[0].scale_denominator);
  const pin = { x: row.pin_x_pt, y: row.pin_y_pt };

  const annotations = parseFloorPlanAnnotations(JSON.parse(row.annotations_json || '[]'));
  const u822Ann = annotations.find(a => a.type === 'room' && a.label === '822');
  const u822Poly = u822Ann.points.map(pt => pdfPointToWorldMetres(pt, pin, scale));

  function wallTouchesUnit(s1, s2, polygon, toleranceM = 0.25) {
    if (polygon.length < 3) return false;
    const poly2D = polygon.map(p => ({ x: p.x, y: p.z }));

    // Check interior midpoint
    const mid = { x: (s1.x + s2.x) / 2, z: (s1.z + s2.z) / 2 };
    if (pointInPolygon({ x: mid.x, y: mid.z }, poly2D)) {
      return true;
    }

    const sdx = s2.x - s1.x;
    const sdz = s2.z - s1.z;
    const sLenSq = sdx * sdx + sdz * sdz;
    if (sLenSq < 1e-9) return false;

    // Check each edge of the unit polygon
    for (let i = 0; i < polygon.length; i++) {
      const e1 = polygon[i];
      const e2 = polygon[(i + 1) % polygon.length];
      const edx = e2.x - e1.x;
      const edz = e2.z - e1.z;
      const eLenSq = edx * edx + edz * edz;
      if (eLenSq < 1e-9) continue;

      // Check parallelism
      const dot = Math.abs(sdx * edx + sdz * edz);
      const mag = Math.hypot(sdx, sdz) * Math.hypot(edx, edz);
      if (mag < 1e-9 || dot / mag < 0.85) continue;

      // Project s1 and s2 onto the line through e1 and e2
      const u1 = ((s1.x - e1.x) * edx + (s1.z - e1.z) * edz) / eLenSq;
      const u2 = ((s2.x - e1.x) * edx + (s2.z - e1.z) * edz) / eLenSq;

      const overlapMin = Math.max(0, Math.min(u1, u2));
      const overlapMax = Math.min(1, Math.max(u1, u2));
      const overlapLen = (overlapMax - overlapMin) * Math.hypot(edx, edz);

      // Require meaningful overlap along the edge (at least 5cm)
      if (overlapLen < 0.05) continue;

      // Check perpendicular distance from the midpoint of the overlapping section
      const midU = (overlapMin + overlapMax) / 2;
      const projX = e1.x + midU * edx;
      const projZ = e1.z + midU * edz;
      // Midpoint on wall segment corresponding to midU
      // parameter t on wall segment:
      const t = Math.abs(u2 - u1) < 1e-9 ? 0.5 : (midU - u1) / (u2 - u1);
      const wallMidX = s1.x + t * sdx;
      const wallMidZ = s1.z + t * sdz;

      const dist = Math.hypot(wallMidX - projX, wallMidZ - projZ);
      if (dist <= toleranceM) {
        return true;
      }
    }
    return false;
  }

  const { vertices, edges } = planarizeWalls(annotations, DEFAULT_ROOM_JOIN_EPS_PT);

  const worldEdges = [];
  for (const key of edges) {
    const [a, b] = key.split('-').map(Number);
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
      touches822: wallTouchesUnit(start, end, u822Poly),
      startPt,
      endPt,
    });
  }

  const touching822 = worldEdges.filter(e => e.touches822);
  console.log(`\nOverlapping edges touching 822: ${touching822.length}`);
  for (const e of touching822) {
    console.log(`  len=${e.len.toFixed(2)}m: start=(${e.start.x.toFixed(2)}, ${e.start.z.toFixed(2)}) -> end=(${e.end.x.toFixed(2)}, ${e.end.z.toFixed(2)}) | PDF: (${e.startPt.x.toFixed(1)}, ${e.startPt.y.toFixed(1)}) -> (${e.endPt.x.toFixed(1)}, ${e.endPt.y.toFixed(1)})`);
  }
}

run().catch(console.error).finally(() => pool.end());
