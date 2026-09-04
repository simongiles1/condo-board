process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const { parseFloorPlanAnnotations } = await import('../lib/building/floor-plan-annotations.js');
  const { pdfPointToWorldMetres, wallTouchesUnit } = await import('../lib/building/building-geometry.js');

  const res = await pool.query("select annotations_json, pin_x_pt, pin_y_pt, scale_m_per_pt from floor_plans where name = 'Ac208'");
  const row = res.rows[0];
  const annotations = parseFloorPlanAnnotations(JSON.parse(row.annotations_json || '[]'));
  const pin = { x: row.pin_x_pt, y: row.pin_y_pt };
  const scale = row.scale_m_per_pt;

  // Let's get units
  const rooms = annotations.filter(a => a.type === 'room');
  const u822Ann = rooms.find(r => r.label === '822');
  const u822Poly = u822Ann.points.map(pt => pdfPointToWorldMetres(pt, pin, scale));

  console.log('Unit 822 bbox in PDF:', {
    minX: Math.min(...u822Ann.points.map(p => p.x)),
    maxX: Math.max(...u822Ann.points.map(p => p.x)),
    minY: Math.min(...u822Ann.points.map(p => p.y)),
    maxY: Math.max(...u822Ann.points.map(p => p.y)),
  });

  // Let's inspect planarized edges from listEnclosedRoomFaces or planarizeWalls
  // Let's import planarizeWalls
  // In floor-plan-rooms.ts, let's see how edges are formed
  // We can test splitting all polyline segments at intersections and T-junctions
}

run().catch(console.error).finally(() => pool.end());
