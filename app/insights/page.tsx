export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { asc, desc, eq } from "drizzle-orm";

import { BudgetYoYChart } from "@/components/BudgetYoYChart";
import { EquipmentTimeline } from "@/components/EquipmentTimeline";
import { getDb } from "@/lib/db";
import {
  actionItems,
  budgetLineItems,
  extractedActionItems,
  maintenanceEvents,
  meetings,
  vendors,
} from "@/lib/db/schema";

export default async function InsightsPage() {
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
    })
    .from(maintenanceEvents)
    .orderBy(desc(maintenanceEvents.occurredAt));

  const budgetRows = await db.select().from(budgetLineItems);
  const series = budgetRows.map((row) => ({
    fiscalYear: row.fiscalYear ?? 0,
    category: row.categoryName,
    budgeted: Number(row.budgetedAmount ?? 0),
    actual: Number(row.actualAmount ?? 0),
  }));

  const vendorRows = await db.select().from(vendors).orderBy(asc(vendors.name));

  const meetingItems = await db
    .select({
      id: actionItems.id,
      assignee: actionItems.assignee,
      description: actionItems.description,
      deadline: actionItems.deadline,
      meetingTitle: meetings.title,
    })
    .from(actionItems)
    .innerJoin(meetings, eq(actionItems.meetingId, meetings.id))
    .where(eq(actionItems.completed, false));

  const emailItems = await db
    .select()
    .from(extractedActionItems)
    .where(eq(extractedActionItems.completed, false));

  const actionItemRows = [
    ...meetingItems.map((item) => ({
      id: item.id,
      source: "meeting" as const,
      assignee: item.assignee,
      description: item.description,
      deadline: item.deadline,
      context: item.meetingTitle,
    })),
    ...emailItems.map((item) => ({
      id: item.id,
      source: "email" as const,
      assignee: item.assignee,
      description: item.description,
      deadline: item.deadline,
      context: "Email extraction",
    })),
  ];

  return (
    <section className="min-h-0 flex-1 space-y-8 overflow-y-auto">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Knowledge base</p>
        <h1 className="text-2xl font-semibold text-slate-900">Insights</h1>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Equipment & maintenance</h2>
        <EquipmentTimeline events={events} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Budget year-over-year</h2>
        <BudgetYoYChart series={series} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Vendors ({vendorRows.length})
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {vendorRows.map((vendor) => (
            <div
              key={vendor.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h3 className="font-semibold text-slate-900">{vendor.name}</h3>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Unified action items ({actionItemRows.length})
        </h2>
        <div className="space-y-2">
          {actionItemRows.map((item) => (
            <div
              key={`${item.source}-${item.id}`}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="text-sm font-semibold text-slate-900">{item.description}</p>
              <p className="mt-1 text-sm text-slate-600">
                {item.assignee} · {item.source} · {item.context}
                {item.deadline ? ` · due ${item.deadline}` : ""}
              </p>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
