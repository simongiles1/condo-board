/** Load + manually merge equipment assets for Entities → Equipment from canonical building_equipment_registry. */

import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  buildingEquipmentRegistry,
  equipmentMentions,
  maintenanceEvents,
} from "@/lib/db/schema";
import { validateCanonicalAlias } from "./mention-resolve-shared";

export type EquipmentRegistrySummary = {
  id: string;
  displayName: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  floor: number | null;
  category: string | null;
  location: string | null;
  drawingReference: string | null;
  aliases: string[];
  componentKeywords: string[];
  status: "active" | "provisional" | "decommissioned";
  kind: string;
  significance: string;
  notes: string | null;
  eventCount: number;
  mentionCount: number;
};

export type EquipmentRegistryStats = {
  equipmentCount: number;
  eventCount: number;
  mentionCount: number;
  provisionalCount: number;
};

function preferString(a: string | null, b: string | null): string | null {
  const left = a?.trim() || null;
  const right = b?.trim() || null;
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // fallback
  }
  return [];
}

export async function loadEquipmentRegistry(params?: {
  limit?: number;
  offset?: number;
}): Promise<{
  equipment: EquipmentRegistrySummary[];
  stats: EquipmentRegistryStats;
}> {
  const db = getDb();
  const offset = Math.max(0, params?.offset ?? 0);

  const baseQuery = db
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
      aliasesJson: buildingEquipmentRegistry.aliasesJson,
      componentKeywordsJson: buildingEquipmentRegistry.componentKeywordsJson,
      status: buildingEquipmentRegistry.status,
    })
    .from(buildingEquipmentRegistry)
    .where(ne(buildingEquipmentRegistry.status, "decommissioned"))
    .orderBy(asc(buildingEquipmentRegistry.canonicalName));

  const [rows, [{ equipmentCount }], [{ totalEvents }], [{ totalMentions }], [{ provisionalCount }]] =
    await Promise.all([
      params?.limit == null
        ? baseQuery
        : baseQuery.limit(params.limit).offset(offset),
      db
        .select({ equipmentCount: count() })
        .from(buildingEquipmentRegistry)
        .where(ne(buildingEquipmentRegistry.status, "decommissioned")),
      db.select({ totalEvents: count() }).from(maintenanceEvents),
      db.select({ totalMentions: count() }).from(equipmentMentions),
      db
        .select({ provisionalCount: count() })
        .from(buildingEquipmentRegistry)
        .where(eq(buildingEquipmentRegistry.status, "provisional")),
    ]);

  const ids = rows.map((row) => row.id);
  const eventCounts = new Map<string, number>();
  const mentionCounts = new Map<string, number>();

  if (ids.length > 0) {
    const [eventCountRows, mentionCountRows] = await Promise.all([
      db
        .select({
          equipmentId: maintenanceEvents.equipmentId,
          eventCount: count(),
        })
        .from(maintenanceEvents)
        .where(inArray(maintenanceEvents.equipmentId, ids))
        .groupBy(maintenanceEvents.equipmentId),
      db
        .select({
          equipmentId: equipmentMentions.resolvedEquipmentId,
          mentionCount: count(),
        })
        .from(equipmentMentions)
        .where(inArray(equipmentMentions.resolvedEquipmentId, ids))
        .groupBy(equipmentMentions.resolvedEquipmentId),
    ]);

    for (const row of eventCountRows) {
      if (row.equipmentId) eventCounts.set(row.equipmentId, Number(row.eventCount));
    }
    for (const row of mentionCountRows) {
      if (row.equipmentId) mentionCounts.set(row.equipmentId, Number(row.mentionCount));
    }
  }

  const equipment: EquipmentRegistrySummary[] = rows.map((row) => ({
    id: row.id,
    displayName: row.canonicalName,
    name: row.canonicalName,
    manufacturer: row.manufacturer,
    model: row.model,
    floor: row.floor,
    category: row.category,
    location: row.location,
    drawingReference: row.drawingReference,
    aliases: parseJsonArray(row.aliasesJson),
    componentKeywords: parseJsonArray(row.componentKeywordsJson),
    status: (row.status as EquipmentRegistrySummary["status"]) || "active",
    kind: "equipment",
    significance: "major",
    notes: row.specsJson,
    eventCount: eventCounts.get(row.id) ?? 0,
    mentionCount: mentionCounts.get(row.id) ?? 0,
  }));

  return {
    equipment,
    stats: {
      equipmentCount: Number(equipmentCount ?? 0),
      eventCount: Number(totalEvents ?? 0),
      mentionCount: Number(totalMentions ?? 0),
      provisionalCount: Number(provisionalCount ?? 0),
    },
  };
}

/**
 * Absorb source equipment into target: merge aliases, component keywords,
 * re-point mentions and events, and decommission source.
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
      .from(buildingEquipmentRegistry)
      .where(eq(buildingEquipmentRegistry.id, sourceId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select()
      .from(buildingEquipmentRegistry)
      .where(
        and(
          eq(buildingEquipmentRegistry.id, targetId),
          ne(buildingEquipmentRegistry.status, "decommissioned"),
        ),
      )
      .limit(1)
      .then((r) => r[0]),
  ]);

  if (!source) return { ok: false, error: "Source equipment not found." };
  if (!target) {
    return {
      ok: false,
      error: "Target equipment not found (or is decommissioned).",
    };
  }
  if (source.status === "decommissioned") {
    return { ok: false, error: "Source equipment is already merged or decommissioned." };
  }

  // Merge aliases and component keywords
  const sourceAliases = parseJsonArray(source.aliasesJson);
  const targetAliases = parseJsonArray(target.aliasesJson);
  const combinedAliases = [
    ...new Set([
      ...targetAliases,
      ...sourceAliases,
      source.canonicalName,
    ]),
  ].filter((a) => validateCanonicalAlias(a).valid);

  const sourceComponents = parseJsonArray(source.componentKeywordsJson);
  const targetComponents = parseJsonArray(target.componentKeywordsJson);
  const combinedComponents = [
    ...new Set([...targetComponents, ...sourceComponents]),
  ];

  const now = new Date().toISOString();

  // Enrich target
  await db
    .update(buildingEquipmentRegistry)
    .set({
      canonicalName: preferString(target.canonicalName, source.canonicalName) ?? target.canonicalName,
      manufacturer: preferString(target.manufacturer, source.manufacturer),
      model: preferString(target.model, source.model),
      category: preferString(target.category, source.category),
      location: preferString(target.location, source.location),
      drawingReference: preferString(target.drawingReference, source.drawingReference),
      aliasesJson: JSON.stringify(combinedAliases),
      componentKeywordsJson: JSON.stringify(combinedComponents),
      updatedAt: now,
    })
    .where(eq(buildingEquipmentRegistry.id, targetId));

  // Mark source as decommissioned absorbed by target
  await db
    .update(buildingEquipmentRegistry)
    .set({
      status: "decommissioned",
      parentEquipmentId: targetId,
      updatedAt: now,
    })
    .where(eq(buildingEquipmentRegistry.id, sourceId));

  // Re-point equipment mentions
  await db
    .update(equipmentMentions)
    .set({
      resolvedEquipmentId: targetId,
      updatedAt: now,
    })
    .where(eq(equipmentMentions.resolvedEquipmentId, sourceId));

  // Re-point maintenance events
  await db
    .update(maintenanceEvents)
    .set({
      equipmentId: targetId,
      equipmentName: target.canonicalName,
    })
    .where(eq(maintenanceEvents.equipmentId, sourceId));

  return { ok: true, survivorId: targetId };
}
