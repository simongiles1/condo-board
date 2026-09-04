process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function run() {
  const { loadFloorPlansPayload } = await import('../lib/building/floor-plans.js');
  const { buildBuildingGeometry, extrudeWalls } = await import('../lib/building/building-geometry.js');

  const payload = await loadFloorPlansPayload();
  console.log(`Loaded payload with ${payload.plans.length} plans and ${payload.families.length} families`);

  const model = buildBuildingGeometry(payload);
  console.log(`Model built: ${model.levels.length} levels, ${model.units.length} units`);

  const floor8 = model.levels.find(l => l.floorNumber === 8);
  if (!floor8) {
    console.log('Floor 8 not found in model!');
    return;
  }
  console.log('Floor 8 plan:', floor8.planName, 'units:', floor8.units.map(u => u.label));

  const walls = extrudeWalls(model);
  const floor8Walls = walls.filter(w => w.floorNumber === 8);
  console.log('Total walls on floor 8:', floor8Walls.length);

  const u822Walls = floor8Walls.filter(w => w.touchingUnitIds.includes('8:822'));
  console.log('Walls touching 8:822 count:', u822Walls.length);
  for (const w of u822Walls) {
    console.log(`Wall key=${w.key}, start=(${w.start.x.toFixed(2)}, ${w.start.z.toFixed(2)}), end=(${w.end.x.toFixed(2)}, ${w.end.z.toFixed(2)}), len=${w.length.toFixed(2)}, touching=${w.touchingUnitIds.join(',')}`);
  }

  const u813Walls = floor8Walls.filter(w => w.touchingUnitIds.includes('8:813'));
  console.log('Walls touching 8:813 count:', u813Walls.length);
  for (const w of u813Walls) {
    console.log(`Wall key=${w.key}, start=(${w.start.x.toFixed(2)}, ${w.start.z.toFixed(2)}), end=(${w.end.x.toFixed(2)}, ${w.end.z.toFixed(2)}), len=${w.length.toFixed(2)}, touching=${w.touchingUnitIds.join(',')}`);
  }
}

run().catch(console.error);
