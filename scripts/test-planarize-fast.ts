process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const { parseFloorPlanAnnotations } = await import('../lib/building/floor-plan-annotations.js');
  const { listEnclosedRoomFaces } = await import('../lib/building/floor-plan-rooms.js');

  const res = await pool.query("select annotations_json from floor_plans where name = 'Ac208'");
  const annotations = parseFloorPlanAnnotations(JSON.parse(res.rows[0].annotations_json || '[]'));
  console.log('Total annotations on Ac208:', annotations.length);

  const t0 = Date.now();
  const faces = listEnclosedRoomFaces(annotations);
  console.log(`listEnclosedRoomFaces took ${Date.now() - t0}ms, found ${faces.length} faces`);
}

run().catch(console.error).finally(() => pool.end());
