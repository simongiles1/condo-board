import { asc } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { buildingEquipmentRegistry } from "@/lib/db/schema";
import type { EquipmentCategory } from "@/lib/building/fixtures";
import { equipmentY } from "@/lib/building/fixtures";

const DEFAULT_REGISTRY_TOKEN_BUDGET = 4000;

export type RegistryEntry = {
  id: string;
  canonicalName: string;
  manufacturer: string | null;
  model: string | null;
  floor: number | null;
  location: string | null;
  drawingReference: string | null;
  category: string | null;
  specsJson: string | null;
  positionJson: string | null;
};

export type CompiledRegistryPrompt = {
  promptSection: string;
  tokenEstimate: number;
  includedEntryCount: number;
};

export type RegistryMapItem = {
  id: string;
  name: string;
  category: EquipmentCategory;
  floor: number;
  position: [number, number, number];
  manufacturer: string | null;
  location: string | null;
};

function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatRegistryEntry(entry: RegistryEntry): string {
  const parts = [`- ${entry.canonicalName} (id: ${entry.id})`];
  if (entry.manufacturer) parts.push(`manufacturer: ${entry.manufacturer}`);
  if (entry.model) parts.push(`model: ${entry.model}`);
  if (entry.location) parts.push(`location: ${entry.location}`);
  if (entry.floor != null) parts.push(`floor: ${entry.floor}`);
  if (entry.category) parts.push(`category: ${entry.category}`);
  return parts.join("; ");
}

export async function loadBuildingEquipmentRegistry(): Promise<RegistryEntry[]> {
  const db = getDb();
  return db
    .select({
      id: buildingEquipmentRegistry.id,
      canonicalName: buildingEquipmentRegistry.canonicalName,
      manufacturer: buildingEquipmentRegistry.manufacturer,
      model: buildingEquipmentRegistry.model,
      floor: buildingEquipmentRegistry.floor,
      location: buildingEquipmentRegistry.location,
      drawingReference: buildingEquipmentRegistry.drawingReference,
      category: buildingEquipmentRegistry.category,
      specsJson: buildingEquipmentRegistry.specsJson,
      positionJson: buildingEquipmentRegistry.positionJson,
    })
    .from(buildingEquipmentRegistry)
    .orderBy(asc(buildingEquipmentRegistry.canonicalName));
}

export async function compileRegistryPromptSection(input: {
  tokenBudget?: number;
} = {}): Promise<CompiledRegistryPrompt> {
  const budget = input.tokenBudget ?? DEFAULT_REGISTRY_TOKEN_BUDGET;
  const entries = await loadBuildingEquipmentRegistry();

  if (!entries.length) {
    return {
      promptSection: "",
      tokenEstimate: 0,
      includedEntryCount: 0,
    };
  }

  const header = `\n\nKNOWN BUILDING EQUIPMENT\nThese assets are registered from building drawings and equipment specs. When the email mentions equipment that matches an entry below, set is_existing: true and registry_id to the entry id. Use the registry canonical name. Only set is_existing: false for genuinely new equipment not listed here.\n\n`;
  const included: string[] = [];

  for (const entry of entries) {
    const candidate = [...included, formatRegistryEntry(entry)].join("\n");
    if (tokenEstimate(header + candidate) > budget) break;
    included.push(formatRegistryEntry(entry));
  }

  const promptSection = `${header}${included.join("\n")}`;

  return {
    promptSection,
    tokenEstimate: tokenEstimate(promptSection),
    includedEntryCount: included.length,
  };
}

function parseRegistryCategory(value: string | null): EquipmentCategory {
  const normalized = (value ?? "").trim().toLowerCase();
  const allowed: EquipmentCategory[] = [
    "pump",
    "airHandler",
    "boiler",
    "elevator",
    "electrical",
    "chiller",
    "fan",
    "generator",
  ];
  return (
    allowed.find((category) => category.toLowerCase() === normalized) ?? "pump"
  );
}

function parsePositionJson(
  positionJson: string | null,
  floor: number | null,
): [number, number, number] {
  if (positionJson) {
    try {
      const parsed = JSON.parse(positionJson) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.length === 3 &&
        parsed.every((value) => typeof value === "number")
      ) {
        return [parsed[0], parsed[1], parsed[2]];
      }
    } catch {
      // fall through to floor-based default
    }
  }

  const y = equipmentY(floor ?? 1);
  return [0, y, 0];
}

/** Registry rows with 3D placement for the Building render tab. */
export async function loadRegistryMapItems(): Promise<RegistryMapItem[]> {
  const entries = await loadBuildingEquipmentRegistry();
  return entries.map((entry, index) => ({
    id: entry.id,
    name: entry.canonicalName,
    category: parseRegistryCategory(entry.category),
    floor: entry.floor ?? 1,
    position: parsePositionJson(entry.positionJson, entry.floor),
    manufacturer: entry.manufacturer,
    location: entry.location,
  }));
}

export function registryEntriesForReconciliation(
  entries: RegistryEntry[],
): Array<{
  id: string;
  canonical_name: string;
  manufacturer: string | null;
  location: string | null;
  floor: number | null;
  category: string | null;
}> {
  return entries.map((entry) => ({
    id: entry.id,
    canonical_name: entry.canonicalName,
    manufacturer: entry.manufacturer,
    location: entry.location,
    floor: entry.floor,
    category: entry.category,
  }));
}
