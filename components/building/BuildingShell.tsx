"use client";

import { useEffect, useMemo, useState } from "react";
import { Html } from "@react-three/drei";
import {
  ExtrudeGeometry,
  LinearFilter,
  PlaneGeometry,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  Texture,
  TextureLoader,
} from "three";

import {
  buildSlabs,
  extrudeHighlightedUnitWalls,
  extrudeWalls,
  type BuildingGeometryModel,
  type SlabDescriptor,
  type UnitDescriptor,
  type WallSegmentDescriptor,
} from "@/lib/building/building-geometry";
import { getPdfjs, loadPdfBuffer } from "@/lib/pdf/pdfjs-browser";

export type BlueprintOverlayOptions = {
  visible?: boolean;
  opacity?: number;
  visibleFloors?: Set<number>;
  materialType?: "basic" | "standard";
};

export type BuildingStructureOptions = {
  visible?: boolean;
  showSlabs?: boolean;
  showWalls?: boolean;
  slabOpacity?: number;
  wallOpacity?: number;
  visibleFloors?: Set<number>;
  dimmed?: boolean;
  highlightedUnitIds?: Set<string>;
  onToggleUnit?: (unitId: string) => void;
};

type BuildingShellProps = {
  model: BuildingGeometryModel;
  blueprintOverlay?: BlueprintOverlayOptions;
  structureOptions?: BuildingStructureOptions;
};

const blueprintTextureCache = new Map<string, Promise<Texture | null>>();
const loadedTextures = new Map<string, Texture>();

async function loadBlueprintTexture(
  planId: string,
  url: string,
): Promise<Texture | null> {
  if (loadedTextures.has(planId)) {
    return loadedTextures.get(planId)!;
  }
  const inFlight = blueprintTextureCache.get(planId);
  if (inFlight) return inFlight;

  const promise = (async (): Promise<Texture | null> => {
    try {
      if (typeof window === "undefined") return null;

      const isImage = /\.(png|jpe?g|webp|svg)($|\?)/i.test(url);
      const loader = new TextureLoader();

      if (isImage) {
        return await new Promise<Texture | null>((resolve) => {
          loader.load(
            url,
            (tex) => {
              tex.colorSpace = SRGBColorSpace;
              tex.minFilter = LinearFilter;
              tex.generateMipmaps = true;
              loadedTextures.set(planId, tex);
              resolve(tex);
            },
            undefined,
            () => resolve(null),
          );
        });
      }

      // Cropped PDF drawing
      const buffer = await loadPdfBuffer(url);
      const pdfjs = await getPdfjs();
      const doc = await pdfjs.getDocument({ data: buffer.slice(0) }).promise;
      try {
        const page = await doc.getPage(1);
        const unscaled = page.getViewport({ scale: 1 });
        const maxDim = Math.max(unscaled.width, unscaled.height, 1);
        const scale = Math.min(2.5, Math.max(1.0, 2048 / maxDim));
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        await page.render({
          canvas,
          canvasContext: ctx,
          viewport,
          background: "#ffffff",
        }).promise;

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        canvas.width = 0;
        canvas.height = 0;

        if (!blob) return null;
        const objectUrl = URL.createObjectURL(blob);

        return await new Promise<Texture | null>((resolve) => {
          loader.load(
            objectUrl,
            (tex) => {
              URL.revokeObjectURL(objectUrl);
              tex.colorSpace = SRGBColorSpace;
              tex.minFilter = LinearFilter;
              tex.generateMipmaps = true;
              tex.needsUpdate = true;
              loadedTextures.set(planId, tex);
              resolve(tex);
            },
            undefined,
            () => {
              URL.revokeObjectURL(objectUrl);
              resolve(null);
            },
          );
        });
      } finally {
        if (typeof doc.destroy === "function") {
          await doc.destroy().catch(() => {});
        }
      }
    } catch (err) {
      console.warn(`Could not load blueprint texture for plan ${planId}:`, err);
      return null;
    }
  })();

  blueprintTextureCache.set(planId, promise);
  return promise;
}

function SlabBlueprintMesh({
  slab,
  visible,
  opacity,
  materialType = "basic",
}: {
  slab: SlabDescriptor;
  visible: boolean;
  opacity: number;
  materialType?: "basic" | "standard";
}) {
  const [texture, setTexture] = useState<Texture | null>(() =>
    loadedTextures.get(slab.planId) ?? null,
  );

  useEffect(() => {
    // Important: avoid decoding/loading blueprint textures unless the slab is
    // actually visible. Otherwise the 3D view stays "slow by default".
    if (!visible || opacity <= 0.001) return;
    let cancelled = false;
    if (loadedTextures.has(slab.planId)) {
      setTexture(loadedTextures.get(slab.planId)!);
      return;
    }
    loadBlueprintTexture(slab.planId, slab.textureUrl).then((tex) => {
      if (!cancelled && tex) {
        setTexture(tex);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [slab.planId, slab.textureUrl, visible, opacity]);

  const planeGeo = useMemo(
    () => new PlaneGeometry(slab.width, slab.depth),
    [slab.width, slab.depth],
  );

  useEffect(() => {
    return () => {
      planeGeo.dispose();
    };
  }, [planeGeo]);

  if (!visible || !texture || opacity <= 0.001) {
    return null;
  }

  return (
    <mesh
      position={slab.overlayPosition}
      rotation={[-Math.PI / 2, 0, 0]}
      geometry={planeGeo}
      renderOrder={1}
    >
      {materialType === "standard" ? (
        <meshStandardMaterial
          map={texture}
          transparent
          opacity={opacity}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
          roughness={0.8}
          metalness={0.05}
        />
      ) : (
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={opacity}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      )}
    </mesh>
  );
}

function wallGeometry(segment: WallSegmentDescriptor): ExtrudeGeometry {
  const shape = new Shape();
  const half = segment.thickness / 2;
  shape.moveTo(0, -half);
  shape.lineTo(segment.length, -half);
  shape.lineTo(segment.length, half);
  shape.lineTo(0, half);
  shape.closePath();
  return new ExtrudeGeometry(shape, {
    depth: segment.height,
    bevelEnabled: false,
    curveSegments: 1,
  });
}

function WallSegmentMesh({
  segment,
  opacity,
  isHighlighted = false,
}: {
  segment: WallSegmentDescriptor;
  opacity: number;
  isHighlighted?: boolean;
}) {
  const geometry = useMemo(() => wallGeometry(segment), [segment]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  if (opacity <= 0.001) return null;

  return (
    <group position={segment.position} rotation={[0, segment.headingY, 0]}>
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshStandardMaterial
            color={isHighlighted ? "#f8fafc" : "#cbd5e1"}
            transparent={opacity < 1}
            opacity={opacity}
            depthWrite={opacity >= 1}
          />
        </mesh>
      </group>
    </group>
  );
}

function UnitHighlightMesh({
  unit,
  onToggleUnit,
}: {
  unit: UnitDescriptor;
  onToggleUnit?: (unitId: string) => void;
}) {
  const shape = useMemo(() => {
    if (unit.polygon.length < 3) return null;
    const s = new Shape();
    s.moveTo(unit.polygon[0]!.x, -unit.polygon[0]!.z);
    for (let i = 1; i < unit.polygon.length; i++) {
      s.lineTo(unit.polygon[i]!.x, -unit.polygon[i]!.z);
    }
    s.closePath();
    return s;
  }, [unit.polygon]);

  const geometry = useMemo(() => {
    if (!shape) return null;
    return new ShapeGeometry(shape);
  }, [shape]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  if (!geometry) return null;

  return (
    <group name={`unit-highlight-${unit.key}`}>
      <mesh
        position={[0, unit.elevationM + 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        geometry={geometry}
        onClick={(e) => {
          e.stopPropagation();
          onToggleUnit?.(unit.unitId);
        }}
      >
        <meshStandardMaterial
          color={unit.color || "#0ea5e9"}
          transparent={false}
          opacity={1.0}
          roughness={0.4}
          metalness={0.1}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>

      <Html
        position={[unit.center.x, unit.elevationM + 1.2, unit.center.z]}
        center
        style={{ pointerEvents: "auto" }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleUnit?.(unit.unitId);
          }}
          className="cursor-pointer select-none whitespace-nowrap rounded-md bg-sky-700/95 px-3 py-1 text-sm font-bold text-white shadow-lg backdrop-blur-xs ring-1 ring-white/40 hover:bg-sky-600 transition"
          title={`Click to un-highlight Unit ${unit.label}`}
        >
          Unit {unit.label}
        </button>
      </Html>
    </group>
  );
}

export function BuildingShell({
  model,
  blueprintOverlay,
  structureOptions,
}: BuildingShellProps) {
  const isStructureVisible = structureOptions?.visible ?? true;
  const showSlabs = structureOptions?.showSlabs ?? true;
  const showWalls = structureOptions?.showWalls ?? true;
  const isDimmed = structureOptions?.dimmed ?? false;

  const baseSlabOpacity = structureOptions?.slabOpacity ?? 0.38;
  const baseWallOpacity = structureOptions?.wallOpacity ?? 0.42;

  const effectiveSlabOpacity = isDimmed ? baseSlabOpacity * 0.35 : baseSlabOpacity;
  const effectiveWallOpacity = isDimmed ? baseWallOpacity * 0.3 : baseWallOpacity;

  const visibleFloors = structureOptions?.visibleFloors;
  const highlightedUnitIds = structureOptions?.highlightedUnitIds;
  const hasHighlightedUnits = Boolean(
    highlightedUnitIds && highlightedUnitIds.size > 0,
  );
  const onToggleUnit = structureOptions?.onToggleUnit;

  const slabs = useMemo(() => buildSlabs(model), [model]);
  const walls = useMemo(() => extrudeWalls(model), [model]);
  const highlightedUnitWalls = useMemo(
    () =>
      hasHighlightedUnits
        ? extrudeHighlightedUnitWalls(model, highlightedUnitIds!)
        : [],
    [model, hasHighlightedUnits, highlightedUnitIds],
  );

  // Filter slabs and walls by visibleFloors if provided
  const filteredSlabs = useMemo(() => {
    if (!visibleFloors) return slabs;
    return slabs.filter((s) => visibleFloors.has(s.floorNumber));
  }, [slabs, visibleFloors]);

  const filteredWalls = useMemo(() => {
    if (!visibleFloors) return walls;
    return walls.filter((w) => visibleFloors.has(w.floorNumber));
  }, [walls, visibleFloors]);

  const filteredHighlightedUnitWalls = useMemo(() => {
    if (!visibleFloors) return highlightedUnitWalls;
    return highlightedUnitWalls.filter((w) => visibleFloors.has(w.floorNumber));
  }, [highlightedUnitWalls, visibleFloors]);

  const hasGrade = model.levels.some(
    (level) =>
      level.floorNumber >= 1 &&
      (visibleFloors == null || visibleFloors.has(level.floorNumber)),
  );

  const globalBlueprintVisible = blueprintOverlay?.visible !== false;
  const blueprintOpacity = blueprintOverlay?.opacity ?? 0.75;
  const visibleBlueprintFloors = blueprintOverlay?.visibleFloors;
  const blueprintMaterialType = blueprintOverlay?.materialType ?? "basic";

  if (model.levels.length === 0) return null;

  return (
    <group name="building-structure-shell">
      {/* Slabs */}
      {isStructureVisible && showSlabs && effectiveSlabOpacity > 0.001
        ? filteredSlabs.map((slab) => {
            const slabAlpha =
              slab.floorNumber < 1
                ? Math.min(1, effectiveSlabOpacity * 1.3)
                : effectiveSlabOpacity;

            return (
              <mesh key={slab.key} position={slab.position} receiveShadow>
                <boxGeometry args={[slab.width, slab.thickness, slab.depth]} />
                <meshStandardMaterial
                  color={slab.floorNumber < 1 ? "#64748b" : "#94a3b8"}
                  transparent={slabAlpha < 1}
                  opacity={slabAlpha}
                  depthWrite={false}
                />
              </mesh>
            );
          })
        : null}

      {/* Blueprint Texture Overlays on top of Slabs */}
      {globalBlueprintVisible
        ? filteredSlabs.map((slab) => {
            const isFloorVisible =
              visibleBlueprintFloors == null ||
              visibleBlueprintFloors.has(slab.floorNumber);
            return (
              <SlabBlueprintMesh
                key={`bp-${slab.key}`}
                slab={slab}
                visible={isFloorVisible}
                opacity={blueprintOpacity}
                materialType={blueprintMaterialType}
              />
            );
          })
        : null}

      {/* Highlighted Units */}
      {isStructureVisible && hasHighlightedUnits
        ? model.units
            .filter(
              (u) =>
                highlightedUnitIds!.has(u.unitId) &&
                (visibleFloors == null || visibleFloors.has(u.floorNumber)),
            )
            .map((unit) => (
              <UnitHighlightMesh
                key={`unit-highlight-${unit.key}`}
                unit={unit}
                onToggleUnit={onToggleUnit}
              />
            ))
        : null}

      {/* Extruded Walls — global building polylines */}
      {isStructureVisible && showWalls && (effectiveWallOpacity > 0.001 || hasHighlightedUnits)
        ? filteredWalls.map((segment) => {
            // When units are highlighted, background (drawn) walls use the shell
            // transparency slider. Opaque unit shells come from the filled room
            // silhouette, not from those polylines.
            const opacity = effectiveWallOpacity;
            if (opacity <= 0.001) return null;

            return (
              <WallSegmentMesh
                key={segment.key}
                segment={segment}
                opacity={opacity}
              />
            );
          })
        : null}

      {/* Unit enclosure walls — filled-unit 6-inch shell at full opacity */}
      {isStructureVisible &&
      showWalls &&
      hasHighlightedUnits &&
      filteredHighlightedUnitWalls.length > 0
        ? filteredHighlightedUnitWalls.map((segment) => (
            <WallSegmentMesh
              key={segment.key}
              segment={segment}
              opacity={1.0}
              isHighlighted
            />
          ))
        : null}

      {/* Grade Level Datum Ring */}
      {isStructureVisible && hasGrade ? (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.35, 0.55, 32]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.7} />
        </mesh>
      ) : null}
    </group>
  );
}
