export type EquipmentCategory =
  | "pump"
  | "airHandler"
  | "boiler"
  | "elevator"
  | "electrical"
  | "chiller"
  | "fan"
  | "generator";

export type EquipmentCategoryMeta = {
  label: string;
  color: string;
};

export const EQUIPMENT_CATEGORIES: Record<EquipmentCategory, EquipmentCategoryMeta> = {
  pump: { label: "Pumps", color: "#38bdf8" },
  airHandler: { label: "Air handlers", color: "#34d399" },
  boiler: { label: "Boilers", color: "#f97316" },
  elevator: { label: "Elevators", color: "#a78bfa" },
  electrical: { label: "Electrical", color: "#facc15" },
  chiller: { label: "Chillers", color: "#22d3ee" },
  fan: { label: "Exhaust fans", color: "#fb7185" },
  generator: { label: "Generator", color: "#e879f9" },
};

export type BuildingMass = {
  floorCount: number;
  width: number;
  depth: number;
};

/** Temporary stand-in until real building drawings are uploaded. */
export type BuildingConfig = {
  floorHeight: number;
  parking: BuildingMass;
  podium: BuildingMass;
  tower: BuildingMass;
};

const PODIUM_FOOTPRINT = {
  width: 64,
  depth: 22,
} as const;

export const BUILDING: BuildingConfig = {
  floorHeight: 3.5,
  parking: { floorCount: 6, ...PODIUM_FOOTPRINT },
  podium: { floorCount: 9, ...PODIUM_FOOTPRINT },
  tower: {
    floorCount: 15,
    width: 14,
    depth: PODIUM_FOOTPRINT.depth,
  },
};

export function getAboveGroundFloorCount(): number {
  return BUILDING.podium.floorCount + BUILDING.tower.floorCount;
}

export function getBuildingVerticalExtent(): { minY: number; maxY: number } {
  const fh = BUILDING.floorHeight;
  return {
    minY: -BUILDING.parking.floorCount * fh,
    maxY: getAboveGroundFloorCount() * fh,
  };
}

/** Orbit zoom limits scaled to the building mass so the full model can fit in frame. */
export function getBuildingOrbitDistanceLimits(): {
  minDistance: number;
  maxDistance: number;
} {
  const { minY, maxY } = getBuildingVerticalExtent();
  const height = maxY - minY;
  const footprint = Math.max(
    BUILDING.parking.width,
    BUILDING.parking.depth,
    BUILDING.tower.width,
  );
  const maxExtent = Math.max(height, footprint);
  return {
    minDistance: 15,
    maxDistance: Math.ceil(maxExtent * 2.75),
  };
}

/** Y coordinate for placing equipment on a numbered floor (negative = parking). */
export function equipmentY(floor: number): number {
  const fh = BUILDING.floorHeight;
  if (floor < 0) {
    return (floor + 0.5) * fh;
  }
  return (floor - 0.5) * fh;
}

export function formatFloorLabel(floor: number): string {
  if (floor < 0) {
    return `P${-floor}`;
  }
  return String(floor);
}

export type EquipmentItem = {
  id: string;
  name: string;
  category: EquipmentCategory;
  floor: number;
  /** Position in building-local coordinates: x (width), y (height), z (depth). */
  position: [number, number, number];
  lastServiced?: string;
};

/** Fixture equipment placed across the temporary building model. */
export const EQUIPMENT: EquipmentItem[] = [
  // Underground parking (P6–P1)
  {
    id: "pump-1",
    name: "Primary circulation pump",
    category: "pump",
    floor: -2,
    position: [-16, equipmentY(-2), -10],
    lastServiced: "2025-11-14",
  },
  {
    id: "pump-2",
    name: "Backup circulation pump",
    category: "pump",
    floor: -2,
    position: [-12, equipmentY(-2), -10],
    lastServiced: "2025-08-22",
  },
  {
    id: "boiler-1",
    name: "Main boiler #1",
    category: "boiler",
    floor: -1,
    position: [14, equipmentY(-1), -9],
    lastServiced: "2026-01-05",
  },
  {
    id: "boiler-2",
    name: "Main boiler #2",
    category: "boiler",
    floor: -1,
    position: [18, equipmentY(-1), -9],
    lastServiced: "2026-01-05",
  },
  {
    id: "gen-1",
    name: "Emergency generator",
    category: "generator",
    floor: -1,
    position: [-20, equipmentY(-1), 9],
    lastServiced: "2025-12-01",
  },
  {
    id: "elec-1",
    name: "Main electrical panel",
    category: "electrical",
    floor: -1,
    position: [20, equipmentY(-1), 0],
    lastServiced: "2025-07-18",
  },
  {
    id: "fan-1",
    name: "Parking exhaust fan",
    category: "fan",
    floor: -3,
    position: [-22, equipmentY(-3), 0],
    lastServiced: "2025-06-03",
  },
  // Podium (floors 1–9)
  {
    id: "ah-1",
    name: "AHU — Podium L2 east",
    category: "airHandler",
    floor: 2,
    position: [24, equipmentY(2), -9],
    lastServiced: "2025-10-12",
  },
  {
    id: "elec-2",
    name: "Podium L1 sub-panel",
    category: "electrical",
    floor: 1,
    position: [-24, equipmentY(1), 9],
    lastServiced: "2025-04-15",
  },
  {
    id: "ah-2",
    name: "AHU — Podium L5 west",
    category: "airHandler",
    floor: 5,
    position: [-24, equipmentY(5), -9],
    lastServiced: "2025-11-28",
  },
  {
    id: "ah-3",
    name: "AHU — Podium L5 east",
    category: "airHandler",
    floor: 5,
    position: [24, equipmentY(5), -9],
    lastServiced: "2025-11-28",
  },
  {
    id: "fan-2",
    name: "Stairwell pressurization fan",
    category: "fan",
    floor: 8,
    position: [0, equipmentY(8), 9],
    lastServiced: "2025-03-20",
  },
  // Tower (floors 10–24)
  {
    id: "ah-4",
    name: "AHU — Tower L12",
    category: "airHandler",
    floor: 12,
    position: [0, equipmentY(12), -4],
    lastServiced: "2026-02-10",
  },
  {
    id: "pump-3",
    name: "Domestic hot water pump",
    category: "pump",
    floor: 15,
    position: [-5, equipmentY(15), 2],
    lastServiced: "2025-12-18",
  },
  {
    id: "chiller-1",
    name: "Rooftop chiller",
    category: "chiller",
    floor: 24,
    position: [0, equipmentY(24), 0],
    lastServiced: "2025-09-30",
  },
  {
    id: "elev-1",
    name: "Passenger elevator #1",
    category: "elevator",
    floor: 12,
    position: [5, equipmentY(12), 2],
    lastServiced: "2026-01-22",
  },
  {
    id: "elev-2",
    name: "Passenger elevator #2",
    category: "elevator",
    floor: 12,
    position: [5, equipmentY(12), -1],
    lastServiced: "2026-01-22",
  },
];

export const ALL_EQUIPMENT_CATEGORIES = Object.keys(
  EQUIPMENT_CATEGORIES,
) as EquipmentCategory[];
