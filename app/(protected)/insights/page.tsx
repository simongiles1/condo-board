export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { asc, desc, eq } from "drizzle-orm";

import { BudgetYoYChart } from "@/components/BudgetYoYChart";
import { EquipmentTimeline } from "@/components/EquipmentTimeline";
import { EntityReviewPanel } from "@/components/EntityReviewPanel";
import { ApprovedEntitiesList } from "@/components/NamedEntitiesList";
import { organizationRoleLabel } from "@/lib/vendors/organization-roles";
import { fetchCustomOrganizationRoles } from "@/lib/vendors/fetch-organization-roles";
import { getDb } from "@/lib/db";
import {
  actionItems,
  budgetLineItems,
  entityMentions,
  extractedActionItems,
  maintenanceEvents,
  meetings,
  vendors,
} from "@/lib/db/schema";
import {
  buildApprovedOrganizationOptions,
  buildEntityReviewGroups,
  splitGroupsForReview,
  type EntityMentionRow,
} from "@/lib/entities/entity-review";
import { enrichEntityReviewGroupsWithThreadContext } from "@/lib/entities/entity-context-enrichment";

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

  const entityRows = await db
    .select({
      id: entityMentions.id,
      entityType: entityMentions.entityType,
      entityValue: entityMentions.entityValue,
      context: entityMentions.context,
      reviewStatus: entityMentions.reviewStatus,
      organizationRole: entityMentions.organizationRole,
      vendorCandidate: entityMentions.vendorCandidate,
      dedupKey: entityMentions.dedupKey,
      personTitle: entityMentions.personTitle,
      linkedOrganizationName: entityMentions.linkedOrganizationName,
      contactEmail: entityMentions.contactEmail,
      sourceId: entityMentions.sourceId,
    })
    .from(entityMentions)
    .orderBy(asc(entityMentions.entityType), asc(entityMentions.entityValue));

  const mentionRows = entityRows as EntityMentionRow[];
  const pendingGroups = await enrichEntityReviewGroupsWithThreadContext(
    splitGroupsForReview(
      buildEntityReviewGroups(
        mentionRows.filter((row) => row.reviewStatus === "pending"),
      ),
    ),
    mentionRows.filter((row) => row.reviewStatus === "pending"),
  );
  const approvedGroups = await enrichEntityReviewGroupsWithThreadContext(
    buildEntityReviewGroups(
      mentionRows.filter((row) => row.reviewStatus === "approved"),
    ),
    mentionRows.filter((row) => row.reviewStatus === "approved"),
  );

  const approvedVendors = await db
    .select({
      id: vendors.id,
      name: vendors.name,
      organizationRole: vendors.organizationRole,
    })
    .from(vendors)
    .where(eq(vendors.reviewStatus, "approved"))
    .orderBy(asc(vendors.name));

  const approvedOrganizations = buildApprovedOrganizationOptions(
    mentionRows,
    approvedVendors,
  );

  const customOrganizationRoles = await fetchCustomOrganizationRoles();

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

      <EntityReviewPanel
        pendingGroups={pendingGroups}
        approvedOrganizations={approvedOrganizations}
        customOrganizationRoles={customOrganizationRoles}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Approved entities ({approvedGroups.length})
        </h2>
        <ApprovedEntitiesList groups={approvedGroups} />
      </section>

      {approvedOrganizations.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Approved organizations ({approvedOrganizations.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {approvedOrganizations.map((org) => (
              <div
                key={org.name}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <h3 className="font-semibold text-slate-900">{org.name}</h3>
                {org.organizationRole ? (
                  <p className="mt-1 text-sm text-slate-600">
                    {organizationRoleLabel(org.organizationRole, customOrganizationRoles)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

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
