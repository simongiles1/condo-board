process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function run() {
  const { loadFloorPlansPayload } = await import('../lib/building/floor-plans.js');
  const payload = await loadFloorPlansPayload();
  const plan = payload.plans.find(p => p.name === 'Ac208');

  // Let's import planarizeWalls or inspect edges
  const { listEnclosedRoomFaces } = await import('../lib/building/floor-plan-rooms.js');
  const faces = listEnclosedRoomFaces(plan.annotations);
  console.log('Enclosed room faces found:', faces.length);

  // Let's see what edges are around Unit 822
  const u822 = plan.annotations.find(a => a.type === 'room' && a.label.includes('822'));
  console.log('Unit 822 annotation:', u822.label, 'points:', u822.points.length);
}

run().catch(console.error);
