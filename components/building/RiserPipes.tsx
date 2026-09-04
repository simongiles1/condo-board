"use client";

import { useEffect, useMemo, useState } from "react";
import type { TubeGeometry } from "three";

import {
  createRiserTubeGeometry,
  type BuildingRiserGeometryModel,
  type RiserDescriptor,
  type TerminalEquipmentDescriptor,
} from "@/lib/building/riser-geometry";

export type RiserSelectOptions = {
  shiftKey?: boolean;
};

export type RiserPipesOptions = {
  visible?: boolean;
  visibleRiserIds?: ReadonlySet<string>;
  opacity?: number;
  showEquipment?: boolean;
  highlightRiserIds?: ReadonlySet<string>;
  selectedEquipmentKey?: string | null;
  onSelectRiser?: (
    riser: RiserDescriptor | null,
    options?: RiserSelectOptions,
  ) => void;
  onSelectEquipment?: (item: TerminalEquipmentDescriptor | null) => void;
  visibleFloors?: Set<number>;
  dimNonHighlighted?: boolean;
};

type RiserPipesProps = {
  model: BuildingRiserGeometryModel;
  options?: RiserPipesOptions;
};

type RiserMeshItemProps = {
  riser: RiserDescriptor;
  opacity: number;
  isHighlighted: boolean;
  isDimmed: boolean;
  onSelect?: (riser: RiserDescriptor, options: RiserSelectOptions) => void;
};

function RiserMeshItem({
  riser,
  opacity,
  isHighlighted,
  isDimmed,
  onSelect,
}: RiserMeshItemProps) {
  const [hovered, setHovered] = useState(false);

  const geometry = useMemo<TubeGeometry | null>(() => {
    return createRiserTubeGeometry(riser.points, {
      pipeRadiusM: riser.pipeRadius,
    });
  }, [riser.points, riser.pipeRadius]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  useEffect(() => {
    return () => {
      if (hovered) {
        document.body.style.cursor = "auto";
      }
    };
  }, [hovered]);

  if (!geometry) return null;

  const color = isHighlighted
    ? "#38bdf8"
    : isDimmed
      ? "#64748b"
      : hovered
        ? "#7dd3fc"
        : riser.systemColor;

  const emissive = isHighlighted ? "#0284c7" : hovered ? "#0369a1" : "#000000";
  const emissiveIntensity = isHighlighted ? 0.85 : hovered ? 0.45 : 0;
  const effectiveOpacity = isHighlighted ? 1.0 : isDimmed ? Math.max(0.12, opacity * 0.18) : opacity;

  return (
    <mesh
      geometry={geometry}
      castShadow
      receiveShadow
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "auto";
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(riser, { shiftKey: e.nativeEvent.shiftKey });
      }}
    >
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        roughness={0.35}
        metalness={0.3}
        transparent={effectiveOpacity < 1}
        opacity={effectiveOpacity}
      />
    </mesh>
  );
}

type EquipmentMeshItemProps = {
  item: TerminalEquipmentDescriptor;
  opacity: number;
  isHighlighted: boolean;
  isDimmed: boolean;
  onSelect?: (item: TerminalEquipmentDescriptor) => void;
};

function EquipmentMeshItem({
  item,
  opacity,
  isHighlighted,
  isDimmed,
  onSelect,
}: EquipmentMeshItemProps) {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    return () => {
      if (hovered) {
        document.body.style.cursor = "auto";
      }
    };
  }, [hovered]);

  const color = isHighlighted
    ? "#38bdf8"
    : isDimmed
      ? "#64748b"
      : hovered
        ? "#7dd3fc"
        : item.systemColor;

  const emissive = isHighlighted ? "#0284c7" : hovered ? "#0369a1" : "#000000";
  const emissiveIntensity = isHighlighted ? 0.85 : hovered ? 0.4 : 0;
  const effectiveOpacity = isHighlighted
    ? 1.0
    : isDimmed
      ? Math.max(0.1, opacity * 0.15)
      : opacity * 0.85;

  return (
    <mesh
      position={item.position}
      castShadow
      receiveShadow
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "auto";
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(item);
      }}
    >
      {item.kind === "cylinder" ? (
        <cylinderGeometry
          args={[
            item.dimensions[0],
            item.dimensions[0],
            item.dimensions[1],
            12,
          ]}
        />
      ) : (
        <boxGeometry args={item.dimensions} />
      )}
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        roughness={0.5}
        metalness={0.2}
        transparent={effectiveOpacity < 1}
        opacity={effectiveOpacity}
      />
    </mesh>
  );
}

export function RiserPipes({ model, options }: RiserPipesProps) {
  const isVisible = options?.visible ?? true;
  const opacity = options?.opacity ?? 1.0;
  const showEquipment = options?.showEquipment ?? true;
  const visibleRiserIds = options?.visibleRiserIds;
  const highlightIds = options?.highlightRiserIds;
  const selectedEquipKey = options?.selectedEquipmentKey;
  const visibleFloors = options?.visibleFloors;

  const hasSelection = Boolean(
    (highlightIds && highlightIds.size > 0) || selectedEquipKey,
  );

  const filteredRisers = useMemo(() => {
    if (!isVisible) return [];
    let list = model.risers;
    if (visibleRiserIds) {
      list = list.filter((r) => visibleRiserIds.has(r.riserId));
    }
    if (visibleFloors && visibleFloors.size > 0) {
      list = list.filter((r) =>
        r.connectedFloors
          ? r.connectedFloors.some((f) => visibleFloors.has(f))
          : (r.minFloor <= Math.max(...visibleFloors) && r.maxFloor >= Math.min(...visibleFloors)),
      );
    }
    return list;
  }, [isVisible, visibleRiserIds, visibleFloors, model.risers]);

  const filteredEquipment = useMemo(() => {
    if (!isVisible || !showEquipment) return [];
    const visibleRiserIds = new Set(filteredRisers.map((r) => r.riserId));
    return model.equipment.filter((e) => visibleRiserIds.has(e.riserId));
  }, [isVisible, showEquipment, filteredRisers, model.equipment]);

  if (!isVisible || filteredRisers.length === 0) {
    return null;
  }

  return (
    <group name="mechanical-riser-pipes">
      {filteredRisers.map((riser) => {
        const isHighlighted = highlightIds?.has(riser.riserId) ?? false;
        const isDimmed = hasSelection && !isHighlighted;

        return (
          <RiserMeshItem
            key={riser.riserId}
            riser={riser}
            opacity={opacity}
            isHighlighted={isHighlighted}
            isDimmed={isDimmed}
            onSelect={
              options?.onSelectRiser
                ? (riser, selectOptions) =>
                    options.onSelectRiser?.(riser, selectOptions)
                : undefined
            }
          />
        );
      })}

      {filteredEquipment.map((item) => {
        const isHighlighted =
          selectedEquipKey === item.key ||
          (highlightIds?.has(item.riserId) ?? false);
        const isDimmed = hasSelection && !isHighlighted;

        return (
          <EquipmentMeshItem
            key={item.key}
            item={item}
            opacity={opacity}
            isHighlighted={isHighlighted}
            isDimmed={isDimmed}
            onSelect={options?.onSelectEquipment}
          />
        );
      })}
    </group>
  );
}
