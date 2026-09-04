process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const { parseFloorPlanAnnotations } = await import('../lib/building/floor-plan-annotations.js');
  const { pdfPointToWorldMetres, wallTouchesUnit } = await import('../lib/building/building-geometry.js');

  const res = await pool.query("select annotations_json from floor_plans where name = 'Ac208'");
  const row = res.rows[0];
  const annotations = parseFloorPlanAnnotations(JSON.parse(row.annotations_json || '[]'));

  const polylines = annotations.filter(a => a.type === 'polyline');
  console.log(`Original polylines: ${polylines.length}`);

  // Let's import planarizeWalls from floor-plan-rooms.js
  // planarizeWalls is not exported from floor-plan-rooms.ts right now, but we can inspect it or test the logic
  const roomsModule = await import('../lib/building/floor-plan-rooms.js');
  console.log('Exports from floor-plan-rooms:', Object.keys(roomsModule));
}

run().catch(console.error).finally(() => pool.end());
