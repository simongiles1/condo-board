"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";

import { BuildingShell } from "@/components/building/BuildingShell";
import { EquipmentMarker } from "@/components/building/EquipmentMarker";
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
};

export function BuildingScene({
  visibleCategories,
  equipment = EQUIPMENT,
}: BuildingSceneProps) {
  const visibleEquipment = equipment.filter((item) =>
    visibleCategories.has(item.category),
  );

  const { minY, maxY } = getBuildingVerticalExtent();
  const cameraTargetY = (minY + maxY) / 2;
  const { minDistance, maxDistance } = getBuildingOrbitDistanceLimits();

  return (
    <Canvas
      shadows
      camera={{
        position: [55, cameraTargetY + 20, 55],
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
        position={[15, 25, 12]}
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight intensity={0.35} position={[-12, 10, -8]} color="#38bdf8" />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        target={[0, cameraTargetY, 0]}
        minDistance={minDistance}
        maxDistance={maxDistance}
        maxPolarAngle={Math.PI / 2.05}
      />

      <gridHelper
        args={[100, 50, "#334155", "#1e293b"]}
        position={[0, minY - 0.01, 0]}
      />

      <BuildingShell />

      {visibleEquipment.map((item) => (
        <EquipmentMarker key={item.id} item={item} />
      ))}
    </Canvas>
  );
}
