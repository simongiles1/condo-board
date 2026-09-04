process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function run() {
  const { loadFloorPlansPayload } = await import('../lib/building/floor-plans.js');
  const { buildBuildingGeometry } = await import('../lib/building/building-geometry.js');

  const payload = await loadFloorPlansPayload();
  const plan = payload.plans.find(p => p.name === 'Ac208');
  const fam = payload.families.find(f => f.id === plan.familyId);

  // Unit 822 in PDF coordinates:
  // x: [1630, 1850], y: [1750, 1890]
  console.log('Polylines near Unit 822:');
  const polylines = plan.annotations.filter(a => a.type === 'polyline');
  for (let idx = 0; idx < polylines.length; idx++) {
    const p = polylines[idx];
    const minX = Math.min(...p.points.map(pt => pt.x));
    const maxX = Math.max(...p.points.map(pt => pt.x));
    const minY = Math.min(...p.points.map(pt => pt.y));
    const maxY = Math.max(...p.points.map(pt => pt.y));

    // check if it overlaps or is near Unit 822 bbox [1620, 1850] x [1740, 1900]
    if (maxX >= 1600 && minX <= 1900 && maxY >= 1700 && minY <= 1920) {
      console.log(`Polyline #${idx}: color=${p.color}, ptsCount=${p.points.length}`);
      for (const pt of p.points) {
        console.log(`    (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`);
      }
    }
  }
}

run().catch(console.error);
