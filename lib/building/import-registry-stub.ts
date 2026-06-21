/**
 * Stub for importing building drawings and equipment specs into the registry.
 * Full document parsing (PDF/OCR/drawing extraction) is out of scope — this module
 * defines the ingestion shape and upserts structured rows for downstream AI matching.
 */

import { randomUUID } from "crypto";

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { buildingEquipmentRegistry } from "@/lib/db/schema";

export type RegistryImportRow = {
  canonicalName: string;
  manufacturer?: string;
  model?: string;
  floor?: number;
  location?: string;
  drawingReference?: string;
  category?: string;
  specs?: Record<string, unknown>;
  position?: [number, number, number];
};

export type RegistryImportResult = {
  inserted: number;
  skipped: number;
};

export async function importBuildingEquipmentRegistryRows(
  rows: RegistryImportRow[],
): Promise<RegistryImportResult> {
  const db = getDb();
  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const canonicalName = row.canonicalName.trim();
    if (!canonicalName) {
      skipped += 1;
      continue;
    }

    const existing = await db
      .select({ id: buildingEquipmentRegistry.id })
      .from(buildingEquipmentRegistry)
      .where(eq(buildingEquipmentRegistry.canonicalName, canonicalName));

    if (existing.length) {
      skipped += 1;
      continue;
    }

    await db.insert(buildingEquipmentRegistry).values({
      id: randomUUID(),
      canonicalName,
      manufacturer: row.manufacturer?.trim() ?? null,
      model: row.model?.trim() ?? null,
      floor: row.floor ?? null,
      location: row.location?.trim() ?? null,
      drawingReference: row.drawingReference?.trim() ?? null,
      category: row.category?.trim() ?? null,
      specsJson: row.specs ? JSON.stringify(row.specs) : null,
      positionJson: row.position ? JSON.stringify(row.position) : null,
      createdAt: new Date().toISOString(),
    });
    inserted += 1;
  }

  return { inserted, skipped };
}
