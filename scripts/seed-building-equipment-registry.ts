import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

import { seedBuildingEquipmentRegistry } from "../lib/equipment/seed-registry";

function ensureEnvLoaded() {
  if (process.env.DATABASE_URL || process.env.COND_BOARD_POSTGRES_URL) {
    return;
  }
  const envPath = resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

export type SeedEquipmentAsset = {
  id: string;
  canonicalName: string;
  category: string;
  manufacturer?: string | null;
  model?: string | null;
  floor?: number | null;
  location?: string | null;
  drawingReference?: string | null;
  aliases: string[];
  componentKeywords: string[];
  status?: "active" | "provisional" | "decommissioned";
  parentEquipmentId?: string | null;
};

export const TSCC_2517_CANONICAL_EQUIPMENT: SeedEquipmentAsset[] = [
  // Doors & Gates
  {
    id: "DOOR-PUBLIC-P1",
    canonicalName: "Public Parking Garage Overhead Door (P1)",
    category: "door",
    manufacturer: "TNR Doors",
    floor: -1,
    location: "P1 Parking / Commercial Entrance",
    drawingReference: "A-101 / M-201",
    aliases: [
      "public parking garage door",
      "public garage door",
      "P1 garage door",
      "P1 overhead door",
      "TNR rubber speed door",
      "commercial overhead door",
      "visitor parking garage door",
      "visitor gate",
    ],
    componentKeywords: [
      "photo-eye",
      "photo eye",
      "motion sensor",
      "counterweight",
      "rubber curtain",
      "breakaway bottom bar",
      "operator",
      "control station",
      "drive motor",
      "safety edge",
    ],
  },
  {
    id: "DOOR-RES-P2",
    canonicalName: "Residential Parking Garage Overhead Door (P2)",
    category: "door",
    floor: -2,
    location: "P2 Parking Entrance",
    drawingReference: "A-102",
    aliases: [
      "residential garage door",
      "residential overhead door",
      "P2 garage door",
      "P2 overhead door",
      "sectional residential garage door",
      "P2 residential door",
      "P2-Residential Garage Door",
    ],
    componentKeywords: [
      "torsion spring",
      "counterweight system",
      "door track",
      "rollers",
      "door hinges",
      "bottom rubber seal",
      "sectional panel",
      "operator",
      "drive chain",
    ],
  },
  {
    id: "DOOR-LOADING-BAY",
    canonicalName: "Loading Bay Commercial Overhead Door",
    category: "door",
    floor: 1,
    location: "Ground Floor Loading Bay",
    drawingReference: "A-100",
    aliases: [
      "loading bay door",
      "loading dock door",
      "west loading bay door",
      "loading zone overhead door",
      "commercial roll-up door",
    ],
    componentKeywords: [
      "guide track",
      "rolling steel curtain",
      "chain hoist",
      "interlock switch",
      "weatherstripping",
      "commercial operator",
    ],
  },
  {
    id: "DOOR-STAIR-A-EXT",
    canonicalName: "Stair A Exterior Gate & Auto-Opener",
    category: "door",
    floor: 1,
    location: "Ground Floor Stair A Exterior",
    aliases: [
      "stair a exterior gate",
      "stair a gate",
      "exterior gate",
      "stairwell a exit gate",
      "auto-opener gate",
    ],
    componentKeywords: [
      "auto-opener",
      "door closer",
      "gate hinge",
      "closer bracket",
      "strike plate",
      "push bar",
    ],
  },
  {
    id: "DOOR-FIRE-ROLLING",
    canonicalName: "Fire-Rated Rolling Steel Shutter Door",
    category: "door",
    floor: 1,
    location: "Ground Floor Corridor / Loading",
    aliases: [
      "fire door",
      "fire shutter",
      "fire-rated overhead door",
      "rolling fire steel door",
      "fire door guide track",
    ],
    componentKeywords: [
      "fusible link",
      "drop-release mechanism",
      "fire door guide track",
      "governor",
      "counterbalance spring",
    ],
  },

  // Elevators
  {
    id: "ELEV-HIGH-01",
    canonicalName: "High-Rise Passenger Elevator #1",
    category: "elevator",
    floor: 1,
    location: "High-Rise Elevator Bank",
    aliases: [
      "high-rise elevator 1",
      "high-rise elevator #1",
      "elevator 1",
      "car 1",
      "passenger elevator #1",
    ],
    componentKeywords: [
      "hoist ropes",
      "governor ropes",
      "traction motor",
      "drive sheave",
      "door operator",
      "cab door rollers",
      "traveling cable",
      "counterweight roller guides",
      "car station",
    ],
  },
  {
    id: "ELEV-HIGH-02",
    canonicalName: "High-Rise Passenger Elevator #2",
    category: "elevator",
    floor: 1,
    location: "High-Rise Elevator Bank",
    aliases: [
      "high-rise elevator 2",
      "high-rise elevator #2",
      "elevator 2",
      "car 2",
      "passenger elevator #2",
    ],
    componentKeywords: [
      "hoist ropes",
      "governor ropes",
      "traction motor",
      "drive sheave",
      "door operator",
      "cab door rollers",
      "traveling cable",
      "counterweight roller guides",
    ],
  },
  {
    id: "ELEV-LOW-01",
    canonicalName: "Low-Rise Passenger Elevator #3",
    category: "elevator",
    floor: 1,
    location: "Low-Rise Elevator Bank",
    aliases: [
      "low-rise elevator 1",
      "low-rise elevator #1",
      "elevator 3",
      "car 3",
      "low-rise elevator",
    ],
    componentKeywords: [
      "hoist ropes",
      "governor ropes",
      "door operator",
      "car door clutches",
      "door interlocks",
      "motor bearings",
    ],
  },
  {
    id: "ELEV-LOW-02",
    canonicalName: "Low-Rise Passenger Elevator #4",
    category: "elevator",
    floor: 1,
    location: "Low-Rise Elevator Bank",
    aliases: [
      "low-rise elevator 2",
      "low-rise elevator #2",
      "elevator 4",
      "car 4",
    ],
    componentKeywords: [
      "hoist ropes",
      "governor ropes",
      "door operator",
      "car door clutches",
      "door interlocks",
    ],
  },
  {
    id: "ELEV-PARKING-01",
    canonicalName: "Parking Shuttle Elevator (P6-Ground)",
    category: "elevator",
    floor: -1,
    location: "Parking Core",
    aliases: [
      "parking elevator",
      "shuttle elevator",
      "garage elevator",
      "P1-P6 elevator",
    ],
    componentKeywords: [
      "hydraulic piston",
      "sump pump float",
      "elevator pit pump",
      "packing seal",
      "hydraulic valve",
    ],
  },

  // Pumps & Plumbing
  {
    id: "PUMP-DOM-BOOST-DUP",
    canonicalName: "Domestic Cold Water Booster Pump Duplex System",
    category: "pump",
    manufacturer: "Bell & Gossett",
    floor: -1,
    location: "P1 Domestic Water Pump Room",
    drawingReference: "P-601",
    aliases: [
      "domestic booster pump duplex system",
      "domestic cold water booster pump",
      "DCW booster pump",
      "Bell & Gossett duplex booster pump system",
      "domestic booster pump",
      "booster pump duplex package",
      "booster pump",
    ],
    componentKeywords: [
      "booster pump 1",
      "booster pump 2",
      "pump motor",
      "mechanical seal",
      "pump impeller",
      "motor bearing",
      "triple-duty valve",
      "check valve",
      "pressure transducer",
      "VFD",
      "control panel",
      "flow switch",
    ],
  },
  {
    id: "PUMP-DOM-HW-P12A",
    canonicalName: "Domestic Hot Water Recirculation Pump P12A",
    category: "pump",
    floor: -1,
    location: "P1 Boiler / DHW Room",
    drawingReference: "P-601",
    aliases: [
      "domestic hot water pump p12a",
      "pump 12a",
      "DHW recirc pump",
      "hot water pump P12A",
    ],
    componentKeywords: [
      "bronze impeller",
      "flange gasket",
      "motor bearing",
      "inline circulation pump",
    ],
  },
  {
    id: "PUMP-FIRE-MAIN",
    canonicalName: "Fire Protection Main Sprinkler & Standpipe Pump",
    category: "pump",
    floor: -1,
    location: "P1 Fire Pump Room",
    drawingReference: "P-601",
    aliases: [
      "fire pump",
      "sprinkler fire pump",
      "main fire pump",
      "standpipe pump",
    ],
    componentKeywords: [
      "pump packing",
      "jockey pump",
      "sensing line",
      "casing relief valve",
      "test header",
      "fire pump controller",
    ],
  },
  {
    id: "PUMP-SUMP-SAN-P1",
    canonicalName: "Sanitary Pit Sump Pump System",
    category: "pump",
    floor: -1,
    location: "P1 Sump Pit",
    aliases: [
      "sanitary sump pump",
      "sanitary pit pumps",
      "sanitary sewage ejector",
      "ground floor sanitary pump",
    ],
    componentKeywords: [
      "pump float switch",
      "submersible motor",
      "grinder impeller",
      "check valve",
      "high water alarm float",
    ],
  },
  {
    id: "TANK-STORM-RET",
    canonicalName: "Stormwater Retention & Irrigation Tank System",
    category: "tank",
    floor: -2,
    location: "P2 Retention Chamber",
    aliases: [
      "storm retention tank",
      "stormwater retention tank",
      "storm water irrigation tank",
      "retention tank",
      "storm tank",
    ],
    componentKeywords: [
      "waterproofing membrane",
      "submersible irrigation pump",
      "float switches",
      "overflow weir",
      "tank drain valve",
    ],
  },

  // Central Plant & HVAC
  {
    id: "BOILER-01",
    canonicalName: "Main Hydronic Heating Boiler #1",
    category: "boiler",
    floor: -1,
    location: "P1 Central Boiler Plant",
    drawingReference: "M-601",
    aliases: [
      "boiler 1",
      "main boiler #1",
      "heating boiler 1",
      "hydronic boiler 1",
    ],
    componentKeywords: [
      "burner assembly",
      "flame sensor",
      "heat exchanger",
      "gas train",
      "safety relief valve",
      "low water cut-off",
      "blowdown valve",
    ],
  },
  {
    id: "BOILER-02",
    canonicalName: "Main Hydronic Heating Boiler #2",
    category: "boiler",
    floor: -1,
    location: "P1 Central Boiler Plant",
    drawingReference: "M-601",
    aliases: [
      "boiler 2",
      "main boiler #2",
      "heating boiler 2",
      "hydronic boiler 2",
    ],
    componentKeywords: [
      "burner assembly",
      "flame sensor",
      "heat exchanger",
      "gas train",
      "safety relief valve",
      "low water cut-off",
    ],
  },
  {
    id: "CHILLER-ROOF-01",
    canonicalName: "Rooftop Centrifugal Water Chiller",
    category: "chiller",
    floor: 32,
    location: "Roof Mechanical Penthouse",
    drawingReference: "M-601",
    aliases: [
      "rooftop chiller",
      "main chiller",
      "chiller #1",
      "central chiller plant",
    ],
    componentKeywords: [
      "refrigerant charge",
      "condenser bundle",
      "evaporator bundle",
      "compressor motor",
      "oil separator",
      "expansion valve",
      "chilled water loop",
    ],
  },
  {
    id: "COOLING-TOWER-01",
    canonicalName: "Rooftop Cooling Tower Unit",
    category: "cooling_tower",
    floor: 32,
    location: "Roof Mechanical Deck",
    drawingReference: "M-601",
    aliases: [
      "cooling tower",
      "rooftop cooling tower",
      "cooling tower fan",
    ],
    componentKeywords: [
      "basin heater",
      "drift eliminator",
      "spray nozzles",
      "tower fan motor",
      "gearbox",
      "fill media",
      "makeup water float valve",
    ],
  },
  {
    id: "MUA-ROOF-01",
    canonicalName: "Rooftop Make-Up Air Unit (MUA)",
    category: "ventilation",
    floor: 32,
    location: "Roof Mechanical Penthouse",
    drawingReference: "M-601",
    aliases: [
      "make up air system",
      "makeup air unit",
      "MUA unit",
      "corridor supply air unit",
      "MUA-1",
    ],
    componentKeywords: [
      "supply fan",
      "heating coil",
      "intake damper",
      "air filters",
      "VFD",
      "burner controller",
      "diffuser",
    ],
  },
  {
    id: "FAN-STAIR-PRESS-01",
    canonicalName: "Stairwell Smoke Control Pressurization Fan",
    category: "ventilation",
    floor: 32,
    location: "Penthouse Smoke Control Chamber",
    drawingReference: "M-601",
    aliases: [
      "stairwell smoke control system pressurization fan",
      "pressurization fan",
      "smoke control fan",
      "stairwell pressurization fan",
    ],
    componentKeywords: [
      "fire damper",
      "smoke damper actuator",
      "ductwork transition",
      "fan belts",
      "airflow switch",
    ],
  },
  {
    id: "GEN-EMERG-01",
    canonicalName: "Emergency Diesel Generator & Automatic Transfer Switch (ATS)",
    category: "generator",
    floor: -1,
    location: "P1 Generator Room",
    drawingReference: "E-601",
    aliases: [
      "emergency generator",
      "diesel generator",
      "generator and ats",
      "emergency power system",
      "generator",
    ],
    componentKeywords: [
      "automatic transfer switch",
      "ATS switches",
      "fuel day tank",
      "fuel supply line",
      "starting batteries",
      "block heater",
      "ULC exhaust piping",
      "radiator",
    ],
  },

  // Access Control & Security
  {
    id: "ACCESS-MAGLOCK-SYS",
    canonicalName: "Building Access Control Electromagnetic Locking System",
    category: "access_control",
    floor: 1,
    location: "Building-wide Access Portals",
    aliases: [
      "electromagnetic locking devices",
      "maglocks",
      "maglock system",
      "mag locks",
      "magnetic door locks",
    ],
    componentKeywords: [
      "maglock",
      "armature plate",
      "power supply board",
      "emergency fire release relay",
      "request-to-exit sensor",
    ],
  },
  {
    id: "ACCESS-FOB-SYS",
    canonicalName: "Fob Reader & Elevator Access Control System",
    category: "access_control",
    floor: 1,
    location: "Lobby & Elevator Core",
    aliases: [
      "elevator fob system",
      "fob readers",
      "access control system",
      "fob reader system",
      "elevator access control",
    ],
    componentKeywords: [
      "fob reader",
      "controller board",
      "door contact sensor",
      "door contactor",
      "credential scanner",
    ],
  },
];

if (process.argv[1] && process.argv[1].endsWith("seed-building-equipment-registry.ts")) {
  ensureEnvLoaded();
  seedBuildingEquipmentRegistry()
    .then((res) => {
      console.info("[seed-building-equipment-registry:success]", res);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[seed-building-equipment-registry:failed]", err);
      process.exit(1);
    });
}
