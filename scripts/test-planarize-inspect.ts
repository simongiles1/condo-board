process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const { parseFloorPlanAnnotations } = await import('../lib/building/floor-plan-annotations.js');
  const { pdfPointToWorldMetres, wallTouchesUnit } = await import('../lib/building/building-geometry.js');

  const res = await pool.query("select annotations_json, pin_x_pt, pin_y_pt from floor_plans where name = 'Ac208'");
  const row = res.rows[0];
  const famRes = await pool.query("select scale_m_per_pt from floor_plan_families limit 1");
  const scale = famRes.rows[0].scale_m_per_pt;
  const pin = { x: row.pin_x_pt, y: row.pin_y_pt };

  const annotations = parseFloorPlanAnnotations(JSON.parse(row.annotations_json || '[]'));
  const u822 = annotations.find(a => a.type === 'room' && a.label === '822');
  const u822WorldPoly = u822.points.map(pt => pdfPointToWorldMetres(pt, pin, scale));

  // Let's inspect planarizeWalls from floor-plan-rooms by reading it or writing the helper
  // Or we can import from floor-plan-rooms.ts
  const fs = require('fs');
  const code = fs.readFileSync('lib/building/floor-plan-rooms.ts', 'utf8');
  // Check if planarizeWalls is exported or can be called via a temporary export
}

run().catch(console.error).finally(() => pool.end());
