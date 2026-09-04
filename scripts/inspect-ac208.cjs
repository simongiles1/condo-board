process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const res = await pool.query("select id, name, floor_number, annotations_json from floor_plans where name = 'Ac208'");
  const row = res.rows[0];
  if (!row) {
    console.log('No row found');
    return;
  }
  const annotations = JSON.parse(row.annotations_json || '[]');
  console.log('Total annotations:', annotations.length);
  const typeCounts = {};
  for (const a of annotations) {
    typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
  }
  console.log('Types:', typeCounts);
  const rooms = annotations.filter(a => a.type === 'room');
  console.log('Rooms:', rooms.map(r => ({ label: r.label, pointsCount: r.points?.length, color: r.color })));
  const settingsRes = await pool.query("select draw_color_presets_json from floor_plan_settings limit 1");
  console.log('Building settings presets:', JSON.parse(settingsRes.rows[0]?.draw_color_presets_json || '[]'));
  // Find unit 822
  const u822 = rooms.find(r => r.label.includes('822'));
  console.log('Unit 822:', JSON.stringify(u822, null, 2));

  console.log('Unit 822 points:');
  u822.points.forEach((pt, i) => console.log(`  pt ${i}: (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`));
  const rowInfo = await pool.query("select pin_x_pt, pin_y_pt from floor_plans where name = 'Ac208'");
  const pin = { x: rowInfo.rows[0].pin_x_pt, y: rowInfo.rows[0].pin_y_pt };
  const famRes = await pool.query("select scale_denominator from floor_plan_families limit 1");
  const scale = (0.0254 / 72) * famRes.rows[0].scale_denominator;

  function toWorld(pt) {
    return {
      x: (pt.x - pin.x) * scale,
      z: -(pt.y - pin.y) * scale,
    };
  }

  const { planarizeWalls } = await import('../lib/building/floor-plan-rooms.ts');
  const { vertices, edges } = planarizeWalls(annotations, 2);
  const adj = Array.from({ length: vertices.length }, () => []);
  for (const key of edges) {
    const [a, b] = key.split('-').map(Number);
    adj[a].push(b);
    adj[b].push(a);
  }
  const degrees = {};
  for (let i = 0; i < vertices.length; i++) {
    const d = adj[i].length;
    degrees[d] = (degrees[d] || 0) + 1;
  }
  console.log('Vertex degrees in planarized graph:', degrees);

  // Let's print vertices and edges of Ac209
  const res9 = await pool.query("select annotations_json from floor_plans where name = 'Ac209'");
  const ann9 = JSON.parse(res9.rows[0]?.annotations_json || '[]');
  const polys9 = ann9.filter(a => a.type === 'polyline');
  console.log('Ac209 polylines count:', polys9.length);
  const rooms9 = ann9.filter(a => a.type === 'room');
  console.log('Ac209 rooms count:', rooms9.length);
}

run().catch(console.error).finally(() => pool.end());
