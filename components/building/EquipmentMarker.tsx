"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import { AdditiveBlending, type Mesh } from "three";

import {
  EQUIPMENT_CATEGORIES,
  formatFloorLabel,
  type EquipmentItem,
} from "@/lib/building/fixtures";

type EquipmentMarkerProps = {
  item: EquipmentItem;
};

export function EquipmentMarker({ item }: EquipmentMarkerProps) {
  const coreRef = useRef<Mesh>(null);
  const haloRef = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [selected, setSelected] = useState(false);

  const { color } = EQUIPMENT_CATEGORIES[item.category];
  const showTooltip = hovered || selected;

  useFrame(({ clock }) => {
    const pulse = 1 + Math.sin(clock.elapsedTime * 2.5 + item.position[0]) * 0.12;
    if (haloRef.current) {
      haloRef.current.scale.setScalar(pulse);
    }
    if (coreRef.current) {
      coreRef.current.scale.setScalar(hovered || selected ? 1.35 : 1);
    }
  });

  return (
    <group position={item.position}>
      <mesh
        ref={haloRef}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(event) => {
          event.stopPropagation();
          setSelected((prev) => !prev);
        }}
      >
        <sphereGeometry args={[0.55, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.22}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      <mesh ref={coreRef}>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered || selected ? 2.2 : 1.4}
          toneMapped={false}
        />
      </mesh>

      {showTooltip ? (
        <Html
          distanceFactor={18}
          position={[0, 0.9, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div className="w-52 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
            <p className="font-semibold text-slate-900">{item.name}</p>
            <p className="mt-0.5 text-teal-700">
              {EQUIPMENT_CATEGORIES[item.category].label}
            </p>
            <p className="mt-1 text-slate-600">
              Floor {formatFloorLabel(item.floor)}
            </p>
            {item.lastServiced ? (
              <p className="mt-1 text-slate-500">
                Last serviced: {item.lastServiced}
              </p>
            ) : null}
          </div>
        </Html>
      ) : null}
    </group>
  );
}
