import { getDb } from "@/lib/db";
import { buildingEquipmentRegistry } from "@/lib/db/schema";
import { TSCC_2517_CANONICAL_EQUIPMENT } from "../../scripts/seed-building-equipment-registry";

export async function seedBuildingEquipmentRegistry(): Promise<{
  insertedOrUpdated: number;
  total: number;
}> {
  const db = getDb();
  const now = new Date().toISOString();

  let count = 0;
  for (const asset of TSCC_2517_CANONICAL_EQUIPMENT) {
    await db
      .insert(buildingEquipmentRegistry)
      .values({
        id: asset.id,
        canonicalName: asset.canonicalName,
        category: asset.category,
        manufacturer: asset.manufacturer ?? null,
        model: asset.model ?? null,
        floor: asset.floor ?? null,
        location: asset.location ?? null,
        drawingReference: asset.drawingReference ?? null,
        aliasesJson: JSON.stringify(asset.aliases),
        componentKeywordsJson: JSON.stringify(asset.componentKeywords),
        status: asset.status ?? "active",
        parentEquipmentId: asset.parentEquipmentId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: buildingEquipmentRegistry.id,
        set: {
          canonicalName: asset.canonicalName,
          category: asset.category,
          manufacturer: asset.manufacturer ?? null,
          model: asset.model ?? null,
          floor: asset.floor ?? null,
          location: asset.location ?? null,
          drawingReference: asset.drawingReference ?? null,
          aliasesJson: JSON.stringify(asset.aliases),
          componentKeywordsJson: JSON.stringify(asset.componentKeywords),
          status: asset.status ?? "active",
          parentEquipmentId: asset.parentEquipmentId ?? null,
          updatedAt: now,
        },
      });
    count += 1;
  }

  return { insertedOrUpdated: count, total: TSCC_2517_CANONICAL_EQUIPMENT.length };
}
