"use client";

import { BoxGeometry } from "three";

import { BUILDING } from "@/lib/building/fixtures";

const wallThickness = 0.15;

type MassSectionProps = {
  baseY: number;
  floorCount: number;
  width: number;
  depth: number;
  slabColor: string;
  slabOpacity: number;
  wallOpacity: number;
  edgeColor: string;
};

function MassSection({
  baseY,
  floorCount,
  width,
  depth,
  slabColor,
  slabOpacity,
  wallOpacity,
  edgeColor,
}: MassSectionProps) {
  const fh = BUILDING.floorHeight;
  const height = floorCount * fh;
  const halfW = width / 2;
  const halfD = depth / 2;
  const centerY = baseY + height / 2;
  const floors = Array.from({ length: floorCount + 1 }, (_, i) => i);

  return (
    <group>
      {floors.map((floorIndex) => {
        const y = baseY + floorIndex * fh;
        return (
          <mesh key={`slab-${baseY}-${floorIndex}`} position={[0, y, 0]} receiveShadow>
            <boxGeometry args={[width, 0.12, depth]} />
            <meshStandardMaterial
              color={slabColor}
              transparent
              opacity={slabOpacity}
              depthWrite={false}
            />
          </mesh>
        );
      })}

      <mesh position={[0, centerY, halfD]}>
        <boxGeometry args={[width, height, wallThickness]} />
        <meshStandardMaterial
          color="#cbd5e1"
          transparent
          opacity={wallOpacity}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, centerY, -halfD]}>
        <boxGeometry args={[width, height, wallThickness]} />
        <meshStandardMaterial
          color="#cbd5e1"
          transparent
          opacity={wallOpacity}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[-halfW, centerY, 0]}>
        <boxGeometry args={[wallThickness, height, depth]} />
        <meshStandardMaterial
          color="#cbd5e1"
          transparent
          opacity={wallOpacity}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[halfW, centerY, 0]}>
        <boxGeometry args={[wallThickness, height, depth]} />
        <meshStandardMaterial
          color="#cbd5e1"
          transparent
          opacity={wallOpacity}
          depthWrite={false}
        />
      </mesh>

      {floors.slice(1).map((floorIndex) => {
        const y = baseY + floorIndex * fh + 0.07;
        return (
          <lineSegments key={`edge-${baseY}-${floorIndex}`} position={[0, y, 0]}>
            <edgesGeometry args={[new BoxGeometry(width, 0.01, depth)]} />
            <lineBasicMaterial color={edgeColor} transparent opacity={0.5} />
          </lineSegments>
        );
      })}
    </group>
  );
}

export function BuildingShell() {
  const fh = BUILDING.floorHeight;
  const { parking, podium, tower } = BUILDING;

  const parkingBaseY = -parking.floorCount * fh;
  const podiumBaseY = 0;
  const towerBaseY = podium.floorCount * fh;
  const podiumWidth = podium.width;
  const podiumDepth = podium.depth;

  return (
    <group>
      <MassSection
        baseY={parkingBaseY}
        floorCount={parking.floorCount}
        width={parking.width}
        depth={parking.depth}
        slabColor="#64748b"
        slabOpacity={0.45}
        wallOpacity={0.14}
        edgeColor="#475569"
      />

      <MassSection
        baseY={podiumBaseY}
        floorCount={podium.floorCount}
        width={podiumWidth}
        depth={podiumDepth}
        slabColor="#94a3b8"
        slabOpacity={0.35}
        wallOpacity={0.18}
        edgeColor="#64748b"
      />

      <MassSection
        baseY={towerBaseY}
        floorCount={tower.floorCount}
        width={tower.width}
        depth={tower.depth}
        slabColor="#b8c5d6"
        slabOpacity={0.4}
        wallOpacity={0.22}
        edgeColor="#94a3b8"
      />

      {/* Street level highlight */}
      <lineSegments position={[0, 0.08, 0]}>
        <edgesGeometry args={[new BoxGeometry(podiumWidth, 0.01, podiumDepth)]} />
        <lineBasicMaterial color="#38bdf8" transparent opacity={0.75} />
      </lineSegments>
    </group>
  );
}
