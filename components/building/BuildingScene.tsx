"use client";

import {
  GizmoHelper,
  GizmoViewcube,
  GizmoViewport,
  OrbitControls,
} from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { MOUSE } from "three";

import {
  BuildingShell,
  type BlueprintOverlayOptions,
  type BuildingStructureOptions,
} from "@/components/building/BuildingShell";
import { EquipmentMarker } from "@/components/building/EquipmentMarker";
import {
  RiserPipes,
  type RiserPipesOptions,
} from "@/components/building/RiserPipes";
import {
  modelBounds,
  orbitLimitsFromBounds,
  type BuildingGeometryModel,
} from "@/lib/building/building-geometry";
import type { BuildingRiserGeometryModel } from "@/lib/building/riser-geometry";
import {
  EQUIPMENT,
  getBuildingOrbitDistanceLimits,
  getBuildingVerticalExtent,
  type EquipmentCategory,
  type EquipmentItem,
} from "@/lib/building/fixtures";

type BuildingSceneProps = {
  visibleCategories: Set<EquipmentCategory>;
  equipment?: EquipmentItem[];
  structure?: BuildingGeometryModel;
  structureOptions?: BuildingStructureOptions;
  blueprintOverlay?: BlueprintOverlayOptions;
  risers?: BuildingRiserGeometryModel;
  riserOptions?: RiserPipesOptions;
};

export function BuildingScene({
  visibleCategories,
  equipment = EQUIPMENT,
  structure,
  structureOptions,
  blueprintOverlay,
  risers,
  riserOptions,
}: BuildingSceneProps) {
  const visibleEquipment = equipment.filter((item) =>
    visibleCategories.has(item.category),
  );

  const bounds = useMemo(
    () => (structure ? modelBounds(structure) : null),
    [structure],
  );
  const hasModel = Boolean(structure && structure.levels.length > 0);
  const fixtureExtent = getBuildingVerticalExtent();
  const minY = hasModel && bounds ? bounds.min[1] : fixtureExtent.minY;
  const maxY = hasModel && bounds ? bounds.max[1] : fixtureExtent.maxY;
  const center = hasModel && bounds ? bounds.center : ([0, (minY + maxY) / 2, 0] as const);
  const { minDistance, maxDistance } = hasModel
    ? orbitLimitsFromBounds(bounds)
    : getBuildingOrbitDistanceLimits();

  const footprint = hasModel && bounds
    ? Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2], 20)
    : 100;
  const gridSize = Math.ceil(footprint * 1.4);
  const cameraOffset = Math.max(footprint * 0.7, 20);

  return (
    <Canvas
      shadows
      onPointerMissed={() => {
        riserOptions?.onSelectRiser?.(null);
        riserOptions?.onSelectEquipment?.(null);
      }}
      camera={{
        position: [
          center[0] + cameraOffset,
          center[1] + Math.max(20, (maxY - minY) * 0.35),
          center[2] + cameraOffset,
        ],
        fov: 45,
        near: 0.1,
        far: maxDistance * 2,
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#0f172a"]} />
      <fog attach="fog" args={["#0f172a", 60, maxDistance * 1.15]} />

      <ambientLight intensity={0.45} />
      <directionalLight
        castShadow
        intensity={1.1}
        position={[center[0] + 15, center[1] + 25, center[2] + 12]}
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight
        intensity={0.35}
        position={[center[0] - 12, center[1] + 10, center[2] - 8]}
        color="#38bdf8"
      />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        zoomToCursor
        target={[center[0], center[1], center[2]]}
        minDistance={minDistance}
        maxDistance={maxDistance}
        maxPolarAngle={Math.PI / 2.05}
        mouseButtons={{
          LEFT: MOUSE.PAN,
          MIDDLE: MOUSE.ROTATE,
          RIGHT: MOUSE.PAN,
        }}
      />

      <GizmoHelper alignment="bottom-right" margin={[72, 20]}>
        <GizmoViewport
          hideNegativeAxes
          axisColors={["#ef4444", "#22c55e", "#3b82f6"]}
          labelColor="#f8fafc"
        />
        <group scale={0.55}>
          <GizmoViewcube
            opacity={0.95}
            color="#e2e8f0"
            hoverColor="#38bdf8"
            textColor="#0f172a"
            strokeColor="#64748b"
          />
        </group>
      </GizmoHelper>

      <gridHelper
        args={[gridSize, 50, "#334155", "#1e293b"]}
        position={[center[0], minY - 0.01, center[2]]}
      />

      {structure ? (
        <BuildingShell
          model={structure}
          blueprintOverlay={blueprintOverlay}
          structureOptions={structureOptions}
        />
      ) : null}

      {risers ? <RiserPipes model={risers} options={riserOptions} /> : null}

      {visibleEquipment.map((item) => (
        <EquipmentMarker key={item.id} item={item} />
      ))}
    </Canvas>
  );
}
