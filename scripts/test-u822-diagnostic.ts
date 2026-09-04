process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function run() {
  const { loadFloorPlansPayload } = await import("../lib/building/floor-plans.js");
  const {
    buildBuildingGeometry,
    extrudeUnitEnclosureWalls,
  } = await import("../lib/building/building-geometry.js");
  const { pointInPolygon } = await import("../lib/building/floor-plan-rooms.js");

  const payload = await loadFloorPlansPayload();
  const model = buildBuildingGeometry(payload);
  const floor8 = model.levels.find((l) => l.floorNumber === 8);
  if (!floor8) throw new Error("no floor 8");
  const u822 = floor8.units.find((u) => u.label === "822");
  if (!u822) throw new Error("no unit 822");
  const plan = payload.plans.find((p) => p.id === floor8.planId);
  if (!plan) throw new Error("no plan");
  const room = plan.annotations.find(
    (a) => a.type === "room" && String(a.label).includes("822"),
  );
  if (!room || room.type !== "room") throw new Error("no room annotation");

  console.log("PDF points", room.points.length);
  for (let i = 0; i < room.points.length; i++) {
    const p = room.points[i]!;
    const n = room.points[(i + 1) % room.points.length]!;
    const len = Math.hypot(n.x - p.x, n.y - p.y);
    console.log(
      `${i} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) -> (${n.x.toFixed(2)}, ${n.y.toFixed(2)}) len=${len.toFixed(1)}`,
    );
  }

  const xs = room.points.map((p) => p.x);
  const ys = room.points.map((p) => p.y);
  console.log(
    "pdf bbox",
    Math.min(...xs).toFixed(1),
    Math.max(...xs).toFixed(1),
    Math.min(...ys).toFixed(1),
    Math.max(...ys).toFixed(1),
  );

  const walls = extrudeUnitEnclosureWalls(
    u822,
    floor8,
    model.floorHeightM,
    model.wallThicknessM,
  );
  const poly = u822.polygon.map((p) => ({ x: p.x, y: p.z }));
  const polyMaxX = Math.max(...u822.polygon.map((p) => p.x));
  const polyMinX = Math.min(...u822.polygon.map((p) => p.x));
  const polyMaxZ = Math.max(...u822.polygon.map((p) => p.z));
  const polyMinZ = Math.min(...u822.polygon.map((p) => p.z));
  console.log("world bbox", polyMinX.toFixed(2), polyMaxX.toFixed(2), polyMinZ.toFixed(2), polyMaxZ.toFixed(2));
  console.log("extruded walls", walls.length);

  for (const w of walls) {
    const mid = { x: (w.start.x + w.end.x) / 2, y: (w.start.z + w.end.z) / 2 };
    const pip = pointInPolygon(mid, poly);
    const startIn = pointInPolygon({ x: w.start.x, y: w.start.z }, poly);
    const endIn = pointInPolygon({ x: w.end.x, y: w.end.z }, poly);
    const maxX = Math.max(w.start.x, w.end.x);
    const minX = Math.min(w.start.x, w.end.x);
    const maxZ = Math.max(w.start.z, w.end.z);
    const minZ = Math.min(w.start.z, w.end.z);
    const outside =
      maxX > polyMaxX + 0.05 ||
      minX < polyMinX - 0.05 ||
      maxZ > polyMaxZ + 0.05 ||
      minZ < polyMinZ - 0.05;
    if (outside || !startIn || !endIn) {
      console.log(
        "SPUR",
        w.key,
        "len",
        w.length.toFixed(2),
        "start",
        w.start.x.toFixed(2),
        w.start.z.toFixed(2),
        "end",
        w.end.x.toFixed(2),
        w.end.z.toFixed(2),
        "midIn",
        pip,
        "startIn",
        startIn,
        "endIn",
        endIn,
        "outsideBBox",
        outside,
      );
    }
  }

  const polylines = plan.annotations.filter((a) => a.type === "polyline");
  console.log("--- wall paths with midpoint inside but endpoint outside ---");
  for (let pi = 0; pi < floor8.wallPaths.length; pi++) {
    const path = floor8.wallPaths[pi]!;
    for (let i = 1; i < path.length; i++) {
      const start = path[i - 1]!;
      const end = path[i]!;
      const mid = { x: (start.x + end.x) / 2, y: (start.z + end.z) / 2 };
      if (!pointInPolygon(mid, poly)) continue;
      const startIn = pointInPolygon({ x: start.x, y: start.z }, poly);
      const endIn = pointInPolygon({ x: end.x, y: end.z }, poly);
      if (startIn && endIn) continue;
      const pdf = polylines[pi];
      console.log(
        `path ${pi} seg ${i - 1}`,
        "start",
        start.x.toFixed(2),
        start.z.toFixed(2),
        "end",
        end.x.toFixed(2),
        end.z.toFixed(2),
        "startIn",
        startIn,
        "endIn",
        endIn,
        "len",
        Math.hypot(end.x - start.x, end.z - start.z).toFixed(2),
        "color",
        pdf && pdf.type === "polyline" ? pdf.color : "?",
        "pdfPts",
        pdf && pdf.type === "polyline"
          ? pdf.points.map((p) => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`).join(" ")
          : "",
      );
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
