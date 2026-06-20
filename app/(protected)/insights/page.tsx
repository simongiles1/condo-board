export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { asc, desc, eq } from "drizzle-orm";

import { InsightsPageClient } from "@/components/InsightsPageClient";
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
  attachContactEmailsToGroups,
  buildApprovedOrganizationCards,
  buildApprovedOrganizationOptions,
  buildEntityReviewGroups,
  splitGroupsForReview,
  type EntityMentionRow,
} from "@/lib/entities/entity-review";
import { enrichEntityReviewGroupsWithThreadContext } from "@/lib/entities/entity-context-enrichment";
import {
  loadApprovedEmailsByPersonDedupKey,
  loadPendingAdditionalEmails,
} from "@/lib/entities/contact-emails";
import { fetchCustomOrganizationRoles } from "@/lib/vendors/fetch-organization-roles";

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
  const budgetSeries = budgetRows.map((row) => ({
    fiscalYear: row.fiscalYear ?? 0,
    category: row.categoryName ?? "Uncategorized",
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
  const approvedEmailsByPerson = await loadApprovedEmailsByPersonDedupKey();
  const pendingAdditionalEmails = await loadPendingAdditionalEmails();
  const pendingGroups = attachContactEmailsToGroups(
    await enrichEntityReviewGroupsWithThreadContext(
      splitGroupsForReview(
        buildEntityReviewGroups(
          mentionRows.filter((row) => row.reviewStatus === "pending"),
        ),
      ),
      mentionRows.filter((row) => row.reviewStatus === "pending"),
    ),
    mentionRows.filter((row) => row.reviewStatus === "pending"),
    approvedEmailsByPerson,
  );
  const approvedGroups = attachContactEmailsToGroups(
    await enrichEntityReviewGroupsWithThreadContext(
      buildEntityReviewGroups(
        mentionRows.filter((row) => row.reviewStatus === "approved"),
      ),
      mentionRows.filter((row) => row.reviewStatus === "approved"),
    ),
    mentionRows.filter((row) => row.reviewStatus === "approved"),
    approvedEmailsByPerson,
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
  const approvedOrganizationCards = buildApprovedOrganizationCards(
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
    <InsightsPageClient
      events={events.map((event) => ({
        ...event,
        equipmentName: event.equipmentName ?? "Unknown equipment",
        eventType: event.eventType ?? "maintenance",
      }))}
      budgetSeries={budgetSeries}
      pendingGroups={pendingGroups}
      approvedGroups={approvedGroups}
      approvedOrganizations={approvedOrganizations}
      approvedOrganizationCards={approvedOrganizationCards}
      pendingAdditionalEmails={pendingAdditionalEmails}
      actionItems={actionItemRows}
      customOrganizationRoles={customOrganizationRoles}
    />
  );
}
