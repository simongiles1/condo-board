/** Load + manually merge equipment assets for Entities → Equipment. */

import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { equipmentAssets, maintenanceEvents } from "@/lib/db/schema";

export type EquipmentRegistrySummary = {
  id: string;
  displayName: string;
  name: string;
  manufacturer: string | null;
  category: string | null;
  location: string | null;
  kind: string | null;
  significance: string | null;
  notes: string | null;
  eventCount: number;
};

export type EquipmentRegistryStats = {
  equipmentCount: number;
  eventCount: number;
};

function preferString(a: string | null, b: string | null): string | null {
  const left = a?.trim() || null;
  const right = b?.trim() || null;
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

export async function loadEquipmentRegistry(params?: {
  limit?: number;
}): Promise<{
  equipment: EquipmentRegistrySummary[];
  stats: EquipmentRegistryStats;
}> {
  const limit = params?.limit ?? 500;
  const db = getDb();

  const rows = await db
    .select({
      id: equipmentAssets.id,
      name: equipmentAssets.name,
      manufacturer: equipmentAssets.manufacturer,
      category: equipmentAssets.category,
      location: equipmentAssets.location,
      kind: equipmentAssets.kind,
      significance: equipmentAssets.significance,
      notes: equipmentAssets.notes,
    })
    .from(equipmentAssets)
    .where(isNull(equipmentAssets.canonicalId))
    .orderBy(asc(equipmentAssets.name))
    .limit(limit);

  const ids = rows.map((row) => row.id);
  const eventCounts = new Map<string, number>();
  if (ids.length > 0) {
    const countRows = await db
      .select({
        equipmentId: maintenanceEvents.equipmentId,
        eventCount: count(),
      })
      .from(maintenanceEvents)
      .where(inArray(maintenanceEvents.equipmentId, ids))
      .groupBy(maintenanceEvents.equipmentId);
    for (const row of countRows) {
      if (row.equipmentId) eventCounts.set(row.equipmentId, Number(row.eventCount));
    }
  }

  const [{ totalEvents }] = await db
    .select({ totalEvents: count() })
    .from(maintenanceEvents);

  const equipment: EquipmentRegistrySummary[] = rows.map((row) => ({
    id: row.id,
    displayName: row.name,
    name: row.name,
    manufacturer: row.manufacturer,
    category: row.category,
    location: row.location,
    kind: row.kind,
    significance: row.significance,
    notes: row.notes,
    eventCount: eventCounts.get(row.id) ?? 0,
  }));

  return {
    equipment,
    stats: {
      equipmentCount: equipment.length,
      eventCount: Number(totalEvents ?? 0),
    },
  };
}

/**
 * Absorb source equipment into target: set canonicalId, re-point events,
 * and enrich target fields.
 */
export async function manualMergeEquipment(params: {
  sourceId: string;
  targetId: string;
}): Promise<{ ok: true; survivorId: string } | { ok: false; error: string }> {
  const sourceId = params.sourceId.trim();
  const targetId = params.targetId.trim();
  if (!sourceId || !targetId) {
    return { ok: false, error: "Both source and target equipment ids are required." };
  }
  if (sourceId === targetId) {
    return { ok: false, error: "Cannot merge equipment into itself." };
  }

  const db = getDb();
  const [source, target] = await Promise.all([
    db
      .select()
      .from(equipmentAssets)
      .where(eq(equipmentAssets.id, sourceId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select()
      .from(equipmentAssets)
      .where(and(eq(equipmentAssets.id, targetId), isNull(equipmentAssets.canonicalId)))
      .limit(1)
      .then((r) => r[0]),
  ]);

  if (!source) return { ok: false, error: "Source equipment not found." };
  if (!target) {
    return {
      ok: false,
      error: "Target equipment not found (or is already merged away).",
    };
  }
  if (source.canonicalId) {
    return { ok: false, error: "Source equipment is already merged into another asset." };
  }

  await db
    .update(equipmentAssets)
    .set({
      name: preferString(target.name, source.name) ?? target.name,
      manufacturer: preferString(target.manufacturer, source.manufacturer),
      category: preferString(target.category, source.category),
      location: preferString(target.location, source.location),
      notes: preferString(target.notes, source.notes),
      kind: preferString(target.kind, source.kind) ?? target.kind,
      significance:
        preferString(target.significance, source.significance) ??
        target.significance,
      aliasesJson: preferString(target.aliasesJson, source.aliasesJson),
    })
    .where(eq(equipmentAssets.id, targetId));

  await db
    .update(equipmentAssets)
    .set({ canonicalId: targetId })
    .where(eq(equipmentAssets.id, sourceId));

  // Anything that pointed at the source as canonical now points at the target.
  await db
    .update(equipmentAssets)
    .set({ canonicalId: targetId })
    .where(eq(equipmentAssets.canonicalId, sourceId));

  await db
    .update(maintenanceEvents)
    .set({
      equipmentId: targetId,
      equipmentName: preferString(target.name, source.name) ?? target.name,
    })
    .where(eq(maintenanceEvents.equipmentId, sourceId));

  return { ok: true, survivorId: targetId };
}
