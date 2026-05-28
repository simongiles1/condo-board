export const runtime = "nodejs";

import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { equipmentAssets, maintenanceEvents } from "@/lib/db/schema";

export async function GET() {
  const db = getDb();
  const events = await db
    .select({
      id: maintenanceEvents.id,
      equipmentName: maintenanceEvents.equipmentName,
      eventType: maintenanceEvents.eventType,
      occurredAt: maintenanceEvents.occurredAt,
      occurredTime: maintenanceEvents.occurredTime,
      vendorName: maintenanceEvents.vendorName,
      cost: maintenanceEvents.cost,
      description: maintenanceEvents.description,
      confidence: maintenanceEvents.confidence,
      equipmentLocation: equipmentAssets.location,
    })
    .from(maintenanceEvents)
    .leftJoin(
      equipmentAssets,
      eq(maintenanceEvents.equipmentId, equipmentAssets.id),
    )
    .orderBy(desc(maintenanceEvents.occurredAt));

  return NextResponse.json({ events });
}
