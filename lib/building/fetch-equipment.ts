import { asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  equipmentAssets,
  maintenanceEvents,
} from "@/lib/db/schema";

import {
  dedupeEmailReferences,
  resolveExtractionSourceEmails,
  type BuildingEmailReference,
} from "./resolve-source-email";

export type { BuildingEmailReference };

export type BuildingMaintenanceEventRow = {
  id: string;
  equipmentName: string;
  eventType: string;
  occurredAt: string | null;
  occurredTime: string | null;
  vendorName: string | null;
  cost: string | null;
  status: string | null;
  description: string | null;
  equipmentLocation: string | null;
  equipmentCategory: string | null;
  email: BuildingEmailReference | null;
};

export type BuildingEquipmentAssetRow = {
  id: string;
  name: string;
  location: string | null;
  category: string | null;
  installDate: string | null;
  notes: string | null;
  eventCount: number;
  lastEventAt: string | null;
  relatedEmails: BuildingEmailReference[];
};

export type BuildingEquipmentData = {
  events: BuildingMaintenanceEventRow[];
  assets: BuildingEquipmentAssetRow[];
};

export async function fetchBuildingEquipmentData(): Promise<BuildingEquipmentData> {
  const db = getDb();

  const eventRows = await db
    .select({
      id: maintenanceEvents.id,
      equipmentName: maintenanceEvents.equipmentName,
      eventType: maintenanceEvents.eventType,
      occurredAt: maintenanceEvents.occurredAt,
      occurredTime: maintenanceEvents.occurredTime,
      vendorName: maintenanceEvents.vendorName,
      cost: maintenanceEvents.cost,
      status: maintenanceEvents.status,
      description: maintenanceEvents.description,
      equipmentLocation: equipmentAssets.location,
      equipmentCategory: equipmentAssets.category,
      sourceId: maintenanceEvents.sourceId,
    })
    .from(maintenanceEvents)
    .leftJoin(
      equipmentAssets,
      eq(maintenanceEvents.equipmentId, equipmentAssets.id),
    )
    .orderBy(desc(maintenanceEvents.occurredAt));

  const sourceIds = eventRows.map((row) => row.sourceId);
  const emailBySourceId = await resolveExtractionSourceEmails(sourceIds);

  const events: BuildingMaintenanceEventRow[] = eventRows.map((row) => ({
    id: row.id,
    equipmentName: row.equipmentName,
    eventType: row.eventType,
    occurredAt: row.occurredAt,
    occurredTime: row.occurredTime,
    vendorName: row.vendorName,
    cost: row.cost,
    status: row.status,
    description: row.description,
    equipmentLocation: row.equipmentLocation,
    equipmentCategory: row.equipmentCategory,
    email: emailBySourceId.get(row.sourceId) ?? null,
  }));

  const assetRows = await db
    .select()
    .from(equipmentAssets)
    .orderBy(asc(equipmentAssets.name));

  const eventsByEquipment = new Map<
    string,
    {
      count: number;
      lastEventAt: string | null;
      emails: BuildingEmailReference[];
    }
  >();

  for (const event of events) {
    const key = event.equipmentName.trim().toLowerCase();
    const existing = eventsByEquipment.get(key) ?? {
      count: 0,
      lastEventAt: null,
      emails: [],
    };
    existing.count += 1;
    if (
      event.occurredAt &&
      (!existing.lastEventAt || event.occurredAt > existing.lastEventAt)
    ) {
      existing.lastEventAt = event.occurredAt;
    }
    if (event.email) {
      existing.emails.push(event.email);
    }
    eventsByEquipment.set(key, existing);
  }

  const assets: BuildingEquipmentAssetRow[] = assetRows.map((asset) => {
    const stats = eventsByEquipment.get(asset.name.trim().toLowerCase());
    return {
      id: asset.id,
      name: asset.name,
      location: asset.location,
      category: asset.category,
      installDate: asset.installDate,
      notes: asset.notes,
      eventCount: stats?.count ?? 0,
      lastEventAt: stats?.lastEventAt ?? null,
      relatedEmails: dedupeEmailReferences(stats?.emails ?? []),
    };
  });

  return { events, assets };
}
