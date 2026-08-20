import { asc, desc, eq } from "drizzle-orm";

import type { MaintenanceEvent } from "@/components/EquipmentTimeline";
import type { BuildingEmailReference } from "@/lib/building/resolve-source-email";
import { loadBudgetPageData } from "@/lib/budget/load-budgets";
import { getDb } from "@/lib/db";
import {
  actionItems,
  entityMentions,
  equipmentAssets,
  maintenanceEvents,
  meetings,
  vendors,
} from "@/lib/db/schema";
import { loadWorkingEmailActionItems } from "@/lib/email-analysis/todo-working-list";
import {
  loadApprovedEmailsByPersonDedupKey,
  loadPendingAdditionalEmails,
  type PendingAdditionalEmail,
} from "@/lib/entities/contact-emails";
import { enrichEntityReviewGroupsWithThreadContext } from "@/lib/entities/entity-context-enrichment";
import {
  attachContactEmailsToGroups,
  buildApprovedOrganizationOptions,
  buildEntityReviewGroups,
  splitGroupsForReview,
  type EntityMentionRow,
  type EntityReviewGroup,
  type ApprovedOrganizationOption,
} from "@/lib/entities/entity-review";
import {
  collectUniqueSourceIds,
  emailsForMentionIds,
  emailsForSourceIds,
  loadEmailsBySourceId,
} from "@/lib/insights/enrich-source-emails";
import { fetchCustomOrganizationRoles } from "@/lib/vendors/fetch-organization-roles";
import type { OrganizationRoleOption } from "@/lib/vendors/organization-roles";

export type BudgetPoint = {
  fiscalYear: number;
  category: string;
  budgeted: number;
  actual: number;
};

export type EntityReviewGroupWithSources = EntityReviewGroup & {
  sourceEmails: BuildingEmailReference[];
};

export type ActionItemRow = {
  id: string;
  source: "meeting" | "email";
  assignee: string | null;
  description: string | null;
  deadline: string | null;
  context: string | null;
  sourceEmails: BuildingEmailReference[];
};

function enrichGroupsWithSourceEmails(
  groups: EntityReviewGroup[],
  mentionIdToSourceId: Map<string, string>,
  emailBySourceId: Map<string, BuildingEmailReference>,
): EntityReviewGroupWithSources[] {
  return groups.map((group) => ({
    ...group,
    sourceEmails: emailsForMentionIds(
      group.mentionIds,
      mentionIdToSourceId,
      emailBySourceId,
    ),
  }));
}

export async function loadBudgetSeries(): Promise<BudgetPoint[]> {
  const data = await loadBudgetPageData();
  const points: BudgetPoint[] = [];
  for (const line of data.lines) {
    for (const [yearStr, amounts] of Object.entries(line.byYear)) {
      points.push({
        fiscalYear: Number(yearStr),
        category: line.category,
        budgeted: amounts.budgeted ?? 0,
        actual: amounts.actual ?? 0,
      });
    }
  }
  return points;
}

export async function loadMaintenanceEventsWithSources(): Promise<
  MaintenanceEvent[]
> {
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
      equipmentKind: equipmentAssets.kind,
      equipmentSignificance: equipmentAssets.significance,
      equipmentManufacturer: equipmentAssets.manufacturer,
      equipmentCanonicalId: equipmentAssets.canonicalId,
      sourceId: maintenanceEvents.sourceId,
    })
    .from(maintenanceEvents)
    .leftJoin(
      equipmentAssets,
      eq(maintenanceEvents.equipmentId, equipmentAssets.id),
    )
    .orderBy(desc(maintenanceEvents.occurredAt));

  const emailBySourceId = await loadEmailsBySourceId(
    collectUniqueSourceIds(events.map((event) => event.sourceId)),
  );

  return events.map((event) => ({
    ...event,
    equipmentName: event.equipmentName ?? "Unknown equipment",
    eventType: event.eventType ?? "maintenance",
    equipmentKind: event.equipmentKind ?? "equipment",
    equipmentSignificance: event.equipmentSignificance ?? "major",
    equipmentManufacturer: event.equipmentManufacturer,
    equipmentCanonicalId: event.equipmentCanonicalId,
    sourceEmails: emailsForSourceIds([event.sourceId], emailBySourceId),
  }));
}

export async function loadOpenActionItems(): Promise<ActionItemRow[]> {
  const db = getDb();

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

  const emailItems = await loadWorkingEmailActionItems();

  const emailBySourceId = await loadEmailsBySourceId(
    collectUniqueSourceIds(emailItems.map((item) => item.sourceId)),
  );

  return [
    ...meetingItems.map((item) => ({
      id: item.id,
      source: "meeting" as const,
      assignee: item.assignee,
      description: item.description,
      deadline: item.deadline,
      context: item.meetingTitle,
      sourceEmails: [] as BuildingEmailReference[],
    })),
    ...emailItems.map((item) => ({
      id: item.id,
      source: "email" as const,
      assignee: item.assignee,
      description: item.description,
      deadline: item.deadline,
      context: "Email extraction",
      sourceEmails: emailsForSourceIds([item.sourceId], emailBySourceId),
    })),
  ];
}

export async function loadInsightsQueueData(): Promise<{
  pendingGroups: EntityReviewGroupWithSources[];
  pendingAdditionalEmails: PendingAdditionalEmail[];
  approvedOrganizations: ApprovedOrganizationOption[];
  customOrganizationRoles: OrganizationRoleOption[];
}> {
  const db = getDb();

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

  const mentionIdToSourceId = new Map<string, string>(
    mentionRows
      .filter((row): row is EntityMentionRow & { sourceId: string } =>
        Boolean(row.sourceId),
      )
      .map((row) => [row.id, row.sourceId]),
  );

  const emailBySourceId = await loadEmailsBySourceId(
    collectUniqueSourceIds(mentionRows.map((row) => row.sourceId)),
  );

  return {
    pendingGroups: enrichGroupsWithSourceEmails(
      pendingGroups,
      mentionIdToSourceId,
      emailBySourceId,
    ),
    pendingAdditionalEmails,
    approvedOrganizations,
    customOrganizationRoles,
  };
}
