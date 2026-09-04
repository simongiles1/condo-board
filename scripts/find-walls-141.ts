process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function run() {
  const { loadFloorPlansPayload } = await import('../lib/building/floor-plans.js');
  const { buildBuildingGeometry, extrudeWalls } = await import('../lib/building/building-geometry.js');

  const payload = await loadFloorPlansPayload();
  const model = buildBuildingGeometry(payload);
  const floor8 = model.levels.find(l => l.floorNumber === 8);
  const walls = extrudeWalls(model).filter(w => w.floorNumber === 8);

  const plan = payload.plans.find(p => p.name === 'Ac208');
  const polylines = plan.annotations.filter(a => a.type === 'polyline');
  const u822 = floor8.units.find(u => u.label === '822');
  console.log('Unit 822 polygon:');
  for (const pt of u822.polygon) {
    console.log(`  (${pt.x.toFixed(2)}, ${pt.z.toFixed(2)})`);
  }

  const u822Ann = plan.annotations.find(a => a.type === 'room' && a.label === '822');
  console.log('Unit 822 PDF points:');
  for (const pt of u822Ann.points) {
    console.log(`  (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`);
  }

  console.log('\nPolylines in Ac208 near 822:');
  for (let idx = 0; idx < polylines.length; idx++) {
    const p = polylines[idx];
    const minX = Math.min(...p.points.map(pt => pt.x));
    const maxX = Math.max(...p.points.map(pt => pt.x));
    const minY = Math.min(...p.points.map(pt => pt.y));
    const maxY = Math.max(...p.points.map(pt => pt.y));
    if (maxX >= 1600 && minX <= 1900 && maxY >= 1700 && minY <= 1920) {
      console.log(`Polyline #${idx}: color=${p.color}, pts=`, p.points);
    }
  }

  console.log('\nTouching unit 822 walls:');
  for (const w of walls) {
    if (w.touchingUnitIds.includes('8:822')) {
      console.log(`  Key=${w.key}: start=(${w.start.x.toFixed(2)}, ${w.start.z.toFixed(2)}), end=(${w.end.x.toFixed(2)}, ${w.end.z.toFixed(2)}), len=${w.length.toFixed(2)}`);
    }
  }
}

run().catch(console.error);
