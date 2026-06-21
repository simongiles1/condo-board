import { randomUUID } from "crypto";

import { and, eq, like } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  budgetCategories,
  budgetLineItems,
  calendarEvents,
  capitalProjects,
  contracts,
  entityMentions,
  equipmentAssets,
  extractedActionItems,
  extractionSources,
  invoices,
  maintenanceEvents,
  residentIssues,
  vendors,
} from "@/lib/db/schema";
import {
  calendarDeadlineDedupKey,
  calendarMeetingDedupKey,
} from "@/lib/email-analysis/calendar-dedup";
import { persistDiscoveredFacts } from "@/lib/email-analysis/extraction-skill";
import {
  dedupeEntities,
  entitiesMatch,
} from "@/lib/email/entity-dedup";
import { collectNamedEntitySources } from "@/lib/email/named-entity-audit";
import {
  buildEntityDedupKey,
  findApprovedEntityMatch,
  parseStructuredContactContext,
  type EntityMentionRow,
} from "@/lib/entities/entity-review";
import {
  isEntityExcluded,
  loadEntityExclusions,
} from "@/lib/entities/entity-exclusions";

import type {
  EmailExtractionDocument,
  EquipmentMentionExtraction,
} from "./schema";

type EquipmentUpsertInput = {
  name: string;
  kind?: string;
  significance?: string;
  manufacturer?: string;
  category?: string;
  confidence?: string;
  location?: string;
  registryId?: string;
  source?: string;
};

function dedupKey(...parts: (string | number | undefined | null)[]): string {
  return parts
    .filter((p) => p != null && String(p).trim())
    .map((p) => String(p).trim().toLowerCase())
    .join("|");
}

async function upsertBudgetCategory(name: string): Promise<string> {
  const db = getDb();
  const normalized = name.trim();
  const [existing] = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.name, normalized));

  if (existing) return existing.id;

  const id = randomUUID();
  await db.insert(budgetCategories).values({ id, name: normalized });
  return id;
}

async function upsertEquipment(input: EquipmentUpsertInput): Promise<string> {
  const db = getDb();
  const normalized = input.name.trim();
  const [existing] = await db
    .select()
    .from(equipmentAssets)
    .where(eq(equipmentAssets.name, normalized));

  const classification = {
    kind: input.kind ?? "equipment",
    significance: input.significance ?? "major",
    manufacturer: input.manufacturer ?? null,
    category: input.category ?? null,
    confidence: input.confidence ?? null,
    location: input.location ?? null,
    registryId: input.registryId ?? null,
    source: input.source ?? "extracted",
  };

  if (existing) {
    await db
      .update(equipmentAssets)
      .set({
        kind: classification.kind,
        significance: classification.significance,
        manufacturer: classification.manufacturer ?? existing.manufacturer,
        category: classification.category ?? existing.category,
        confidence: classification.confidence ?? existing.confidence,
        location: classification.location ?? existing.location,
        registryId: classification.registryId ?? existing.registryId,
      })
      .where(eq(equipmentAssets.id, existing.id));
    return existing.id;
  }

  const id = randomUUID();
  await db.insert(equipmentAssets).values({
    id,
    name: normalized,
    kind: classification.kind,
    significance: classification.significance,
    manufacturer: classification.manufacturer,
    category: classification.category,
    confidence: classification.confidence,
    location: classification.location,
    registryId: classification.registryId,
    source: classification.source,
    createdAt: new Date().toISOString(),
  });
  return id;
}

function buildMentionLookup(
  mentions: EquipmentMentionExtraction[] | undefined,
): Map<string, EquipmentMentionExtraction> {
  const lookup = new Map<string, EquipmentMentionExtraction>();
  for (const mention of mentions ?? []) {
    lookup.set(mention.name.trim().toLowerCase(), mention);
  }
  return lookup;
}

function mentionFieldsForName(
  lookup: Map<string, EquipmentMentionExtraction>,
  name: string,
): EquipmentUpsertInput {
  const mention = lookup.get(name.trim().toLowerCase());
  return {
    name,
    kind: mention?.kind,
    significance: mention?.significance,
    manufacturer: mention?.manufacturer,
    category: mention?.category,
    confidence: mention?.confidence,
    registryId: mention?.registry_id,
    source: mention?.is_existing ? "registry_match" : "extracted",
  };
}

async function persistEquipmentMentions(input: {
  sourceId: string;
  document: EmailExtractionDocument;
  now: string;
  counts: Record<string, number>;
  skipEquipmentNames?: Set<string>;
}): Promise<void> {
  const db = getDb();
  const seenMentions = new Set<string>();

  for (const mention of input.document.equipment_mentions ?? []) {
    const normalized = mention.name.trim();
    if (!normalized) continue;

    const mentionKey = normalized.toLowerCase();
    if (seenMentions.has(mentionKey)) continue;
    seenMentions.add(mentionKey);

    if (input.skipEquipmentNames?.has(mentionKey)) continue;

    const equipmentId = await upsertEquipment({
      name: normalized,
      kind: mention.kind,
      significance: mention.significance,
      manufacturer: mention.manufacturer,
      category: mention.category,
      confidence: mention.confidence,
      registryId: mention.registry_id,
      source: mention.is_existing ? "registry_match" : "extracted",
    });
    const key = dedupKey("equipment_mention", normalized, input.sourceId);

    const existing = key
      ? await db
          .select()
          .from(maintenanceEvents)
          .where(eq(maintenanceEvents.dedupKey, key))
          .limit(1)
      : [];

    if (existing.length) continue;

    await db.insert(maintenanceEvents).values({
      id: randomUUID(),
      equipmentId,
      equipmentName: normalized,
      eventType: "mentioned",
      occurredAt: null,
      occurredTime: null,
      vendorId: null,
      vendorName: null,
      cost: null,
      workOrder: null,
      status: null,
      description: mention.source_quote
        ? `Mentioned in email analysis — ${mention.source_quote}`
        : "Mentioned in email analysis",
      sourceQuote: mention.source_quote ?? null,
      confidence: mention.confidence ?? null,
      sourceId: input.sourceId,
      dedupKey: key || null,
      createdAt: input.now,
    });
    input.counts.maintenance_events = (input.counts.maintenance_events ?? 0) + 1;
    input.counts.equipment_mentions = (input.counts.equipment_mentions ?? 0) + 1;
  }
}

async function upsertVendor(name: string, contactJson?: string): Promise<string> {
  const db = getDb();
  const normalized = name.trim();
  const [exactMatch] = await db
    .select()
    .from(vendors)
    .where(eq(vendors.name, normalized));

  if (exactMatch) return exactMatch.id;

  const existingVendors = await db.select().from(vendors);
  const fuzzyMatch = existingVendors.find((vendor) =>
    entitiesMatch(
      { type: "org", value: vendor.name },
      { type: "org", value: normalized },
    ),
  );
  if (fuzzyMatch) return fuzzyMatch.id;

  const id = randomUUID();
  await db.insert(vendors).values({
    id,
    name: normalized,
    contactJson: contactJson ?? null,
    reviewStatus: "pending",
    organizationRole: null,
    createdAt: new Date().toISOString(),
  });
  return id;
}

export async function persistExtractionDocument(input: {
  sourceId: string;
  emailThreadId?: string | null;
  document: EmailExtractionDocument;
}): Promise<{ counts: Record<string, number> }> {
  const db = getDb();
  const now = new Date().toISOString();
  const counts: Record<string, number> = {};

  /**
   * Pre-process meeting cancellations FIRST so we (a) know which (date,time)
   * slots to suppress when creating events from the same document's meetings[]
   * array (cancellation emails often still describe the original invite, esp.
   * via .ics attachments), and (b) actively remove any previously-persisted
   * calendar event for the cancelled slot.
   *
   * Cancellations without a time match any same-day meeting, since the
   * cancellation notice rarely repeats the original start time verbatim.
   */
  const cancelledMeetingKeys = new Set<string>();
  for (const cancel of input.document.meeting_cancellations ?? []) {
    if (!cancel.date) continue;
    counts.meeting_cancellations = (counts.meeting_cancellations ?? 0) + 1;

    const exactKey = dedupKey("meeting", cancel.date, cancel.time);
    if (exactKey) cancelledMeetingKeys.add(exactKey);

    cancelledMeetingKeys.add(dedupKey("meeting", cancel.date));

    if (!cancel.time) {
      const dayPrefix = dedupKey("meeting", cancel.date);
      const dayMatches = await db
        .select({ dedupKey: calendarEvents.dedupKey })
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.eventType, "meeting"),
            like(calendarEvents.dedupKey, `${dayPrefix}%`),
          ),
        );
      for (const row of dayMatches) {
        if (row.dedupKey) cancelledMeetingKeys.add(row.dedupKey);
      }
    }
  }

  for (const key of cancelledMeetingKeys) {
    await db.delete(calendarEvents).where(eq(calendarEvents.dedupKey, key));
  }

  const mentionLookup = buildMentionLookup(input.document.equipment_mentions);

  for (const event of input.document.maintenance_events ?? []) {
    const equipmentId = await upsertEquipment(
      mentionFieldsForName(mentionLookup, event.equipment),
    );
    let vendorId: string | undefined;
    if (event.vendor) {
      vendorId = await upsertVendor(event.vendor);
    }

    const key = dedupKey(
      event.equipment,
      event.action,
      event.date,
      event.vendor,
      event.description,
    );

    const inserted = key
      ? await db
          .select()
          .from(maintenanceEvents)
          .where(eq(maintenanceEvents.dedupKey, key))
          .limit(1)
      : [];

    if (!inserted.length) {
      await db.insert(maintenanceEvents).values({
        id: randomUUID(),
        equipmentId,
        equipmentName: event.equipment,
        eventType: event.action,
        occurredAt: event.date ?? null,
        occurredTime: event.time ?? null,
        vendorId: vendorId ?? null,
        vendorName: event.vendor ?? null,
        cost: event.cost != null ? String(event.cost) : null,
        workOrder: event.work_order ?? null,
        status: event.status ?? null,
        description: event.description ?? null,
        sourceQuote: event.source_quote ?? null,
        confidence: event.confidence ?? null,
        sourceId: input.sourceId,
        dedupKey: key || null,
        createdAt: now,
      });
      counts.maintenance_events = (counts.maintenance_events ?? 0) + 1;

      if (event.date) {
        const calKey = dedupKey("maintenance", event.equipment, event.date, event.time);
        const calExisting = calKey
          ? await db
              .select()
              .from(calendarEvents)
              .where(eq(calendarEvents.dedupKey, calKey))
              .limit(1)
          : [];

        if (!calExisting.length) {
          await db.insert(calendarEvents).values({
            id: randomUUID(),
            title: `${event.action}: ${event.equipment}`,
            eventType: "maintenance",
            startAt: event.time ? `${event.date}T${event.time}:00` : event.date,
            description: event.description ?? null,
            sourceId: input.sourceId,
            dedupKey: calKey || null,
            createdAt: now,
          });
          counts.calendar_events = (counts.calendar_events ?? 0) + 1;
        }
      }
    }
  }

  const maintenanceEquipmentNames = new Set(
    (input.document.maintenance_events ?? [])
      .map((event) => event.equipment?.trim().toLowerCase())
      .filter((name): name is string => Boolean(name)),
  );

  await persistEquipmentMentions({
    sourceId: input.sourceId,
    document: input.document,
    now,
    counts,
    skipEquipmentNames: maintenanceEquipmentNames,
  });

  for (const item of input.document.budget_line_items ?? []) {
    const categoryId = await upsertBudgetCategory(item.category);
    const key = dedupKey(
      item.category,
      item.subcategory,
      item.fiscal_year,
      item.period,
      item.budgeted_amount,
      item.actual_amount,
    );

    const existing = key
      ? await db
          .select()
          .from(budgetLineItems)
          .where(eq(budgetLineItems.dedupKey, key))
          .limit(1)
      : [];

    if (!existing.length) {
      await db.insert(budgetLineItems).values({
        id: randomUUID(),
        categoryId,
        categoryName: item.category,
        subcategory: item.subcategory ?? null,
        fiscalYear: item.fiscal_year ?? null,
        periodStart: item.period ?? null,
        budgetedAmount:
          item.budgeted_amount != null ? String(item.budgeted_amount) : null,
        actualAmount:
          item.actual_amount != null ? String(item.actual_amount) : null,
        variance: item.variance != null ? String(item.variance) : null,
        currency: item.currency ?? "CAD",
        sourceQuote: item.source_quote ?? null,
        confidence: item.confidence ?? null,
        sourceId: input.sourceId,
        dedupKey: key || null,
        createdAt: now,
      });
      counts.budget_line_items = (counts.budget_line_items ?? 0) + 1;
    }
  }

  for (const invoice of input.document.invoices ?? []) {
    let vendorId: string | undefined;
    if (invoice.vendor) vendorId = await upsertVendor(invoice.vendor);
    const key = dedupKey(
      invoice.vendor,
      invoice.invoice_number,
      invoice.date,
      invoice.amount,
    );
    const existing = key
      ? await db
          .select()
          .from(invoices)
          .where(eq(invoices.dedupKey, key))
          .limit(1)
      : [];
    if (!existing.length) {
      await db.insert(invoices).values({
        id: randomUUID(),
        vendorId: vendorId ?? null,
        vendorName: invoice.vendor ?? null,
        amount: invoice.amount != null ? String(invoice.amount) : "0",
        invoiceDate: invoice.date ?? null,
        invoiceNumber: invoice.invoice_number ?? null,
        categoryName: invoice.category ?? null,
        paid: invoice.paid ?? null,
        sourceQuote: invoice.source_quote ?? null,
        sourceId: input.sourceId,
        dedupKey: key || null,
        createdAt: now,
      });
      counts.invoices = (counts.invoices ?? 0) + 1;
    }
  }

  for (const vendor of input.document.vendors ?? []) {
    if (vendor.name) {
      counts.vendors = (counts.vendors ?? 0) + 1;
    }
  }

  for (const contract of input.document.contracts ?? []) {
    let vendorId: string | undefined;
    if (contract.vendor) {
      const [existingVendor] = await db
        .select({ id: vendors.id })
        .from(vendors)
        .where(eq(vendors.name, contract.vendor.trim()))
        .limit(1);
      vendorId = existingVendor?.id;
    }
    const key = dedupKey(contract.vendor, contract.type, contract.start_date);
    const existing = key
      ? await db
          .select()
          .from(contracts)
          .where(eq(contracts.dedupKey, key))
          .limit(1)
      : [];
    if (!existing.length) {
      await db.insert(contracts).values({
        id: randomUUID(),
        vendorId: vendorId ?? null,
        vendorName: contract.vendor ?? null,
        contractType: contract.type ?? null,
        startDate: contract.start_date ?? null,
        endDate: contract.end_date ?? null,
        value: contract.value != null ? String(contract.value) : null,
        sourceQuote: contract.source_quote ?? null,
        sourceId: input.sourceId,
        dedupKey: key || null,
        createdAt: now,
      });
      counts.contracts = (counts.contracts ?? 0) + 1;
    }
  }

  for (const issue of input.document.resident_issues ?? []) {
    const key = dedupKey(issue.unit, issue.category, issue.description);
    const existing = key
      ? await db
          .select()
          .from(residentIssues)
          .where(eq(residentIssues.dedupKey, key))
          .limit(1)
      : [];
    if (!existing.length) {
      await db.insert(residentIssues).values({
        id: randomUUID(),
        unit: issue.unit ?? null,
        category: issue.category ?? null,
        description: issue.description,
        status: issue.status ?? null,
        resolution: issue.resolution ?? null,
        sourceQuote: issue.source_quote ?? null,
        sourceId: input.sourceId,
        dedupKey: key || null,
        createdAt: now,
      });
      counts.resident_issues = (counts.resident_issues ?? 0) + 1;
    }
  }

  for (const project of input.document.capital_projects ?? []) {
    const key = dedupKey(project.name, project.phase, project.start_date);
    const existing = key
      ? await db
          .select()
          .from(capitalProjects)
          .where(eq(capitalProjects.dedupKey, key))
          .limit(1)
      : [];
    if (!existing.length) {
      await db.insert(capitalProjects).values({
        id: randomUUID(),
        name: project.name,
        phase: project.phase ?? null,
        budget: project.budget != null ? String(project.budget) : null,
        contractor: project.contractor ?? null,
        startDate: project.start_date ?? null,
        completionDate: project.completion_date ?? null,
        sourceQuote: project.source_quote ?? null,
        sourceId: input.sourceId,
        dedupKey: key || null,
        createdAt: now,
      });
      counts.capital_projects = (counts.capital_projects ?? 0) + 1;
    }
  }

  for (const item of input.document.action_items ?? []) {
    // Exact dedupKey only — semantic obligation matching runs before insert
    // (action-item-dedup) and after insert (action-item-reconciliation).
    const key = dedupKey(item.assignee, item.task, item.deadline);
    const existing = key
      ? await db
          .select()
          .from(extractedActionItems)
          .where(eq(extractedActionItems.dedupKey, key))
          .limit(1)
      : [];
    if (!existing.length) {
      await db.insert(extractedActionItems).values({
        id: randomUUID(),
        assignee: item.assignee,
        description: item.task,
        deadline: item.deadline ?? null,
        emailThreadId: input.emailThreadId ?? null,
        sourceQuote: item.source_quote ?? null,
        sourceId: input.sourceId,
        dedupKey: key || null,
        createdAt: now,
      });
      counts.action_items = (counts.action_items ?? 0) + 1;
    }
    /*
     * Intentionally do NOT promote action_items to calendar_events. The LLM
     * frequently assigns a "deadline" to soft asks ("share thoughts before
     * the meeting"), which polluted the calendar with non-events. Hard
     * deadlines belong in the deadlines[] array — they get their own
     * calendar entry below.
     */
  }

  for (const meeting of input.document.meetings ?? []) {
    if (!meeting.date) continue;
    /**
     * Dedup on calendar day — the LLM is inconsistent about `type` ("Board"
     * vs "Board Meeting") and often omits `time` in one email while another
     * includes it, which would fragment one real meeting into two events.
     */
    const calKey = calendarMeetingDedupKey(meeting);
    if (!calKey) continue;
    if (cancelledMeetingKeys.has(calKey)) continue;
    const timedCancelKey = meeting.time
      ? dedupKey("meeting", meeting.date, meeting.time)
      : null;
    if (timedCancelKey && cancelledMeetingKeys.has(timedCancelKey)) continue;

    const calExisting = await db
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.eventType, "meeting"),
          like(calendarEvents.dedupKey, `${calKey}%`),
        ),
      )
      .limit(1);
    if (calExisting.length) continue;

    const normalizedType = meeting.type?.replace(/\s*meeting\s*$/i, "").trim();
    const title = normalizedType ? `${normalizedType} meeting` : "Meeting";

    await db.insert(calendarEvents).values({
      id: randomUUID(),
      title,
      eventType: "meeting",
      startAt: meeting.time
        ? `${meeting.date}T${meeting.time}:00`
        : meeting.date,
      description: meeting.location ?? null,
      sourceId: input.sourceId,
      dedupKey: calKey,
      createdAt: now,
    });
    counts.calendar_events = (counts.calendar_events ?? 0) + 1;
  }

  for (const deadline of input.document.deadlines ?? []) {
    if (deadline.date) {
      const calKey = calendarDeadlineDedupKey(deadline);
      if (!calKey) continue;
      const calExisting = await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.dedupKey, calKey))
        .limit(1);
      if (!calExisting.length) {
        await db.insert(calendarEvents).values({
          id: randomUUID(),
          title: deadline.description,
          eventType: "deadline",
          startAt: deadline.date,
          description: deadline.assignee ?? null,
          sourceId: input.sourceId,
          dedupKey: calKey,
          createdAt: now,
        });
        counts.calendar_events = (counts.calendar_events ?? 0) + 1;
      }
    }
  }

  const namedSources = collectNamedEntitySources(input.document);
  const dedupedEntities = dedupeEntities(
    namedSources.map((entity) => ({
      type: entity.type,
      value: entity.value,
      context: entity.context,
    })),
  );

  const exclusions = await loadEntityExclusions();

  const approvedEntityRows = await db
    .select({
      id: entityMentions.id,
      entityType: entityMentions.entityType,
      entityValue: entityMentions.entityValue,
      context: entityMentions.context,
      reviewStatus: entityMentions.reviewStatus,
      organizationRole: entityMentions.organizationRole,
      vendorCandidate: entityMentions.vendorCandidate,
      dedupKey: entityMentions.dedupKey,
    })
    .from(entityMentions)
    .where(eq(entityMentions.reviewStatus, "approved"));

  for (const entity of dedupedEntities) {
    if (!entity.value) continue;
    if (isEntityExcluded(entity, exclusions)) continue;

    const vendorCandidate = namedSources.some(
      (source) =>
        source.vendorCandidate &&
        entitiesMatch(source, { type: entity.type, value: entity.value }),
    );

    const [existing] = await db
      .select({ id: entityMentions.id })
      .from(entityMentions)
      .where(
        and(
          eq(entityMentions.sourceId, input.sourceId),
          eq(entityMentions.entityType, entity.type),
          eq(entityMentions.entityValue, entity.value),
        ),
      )
      .limit(1);
    if (existing) continue;

    const approvedMatch = findApprovedEntityMatch(
      approvedEntityRows as EntityMentionRow[],
      entity,
    );
    const dedupKey = approvedMatch?.dedupKey ?? buildEntityDedupKey(entity);
    const context = entity.contexts[0] ?? null;
    const parsedPersonContext =
      entity.type === "person" && context
        ? parseStructuredContactContext(context, entity.value)
        : {};

    await db.insert(entityMentions).values({
      id: randomUUID(),
      entityType: entity.type,
      entityValue: approvedMatch?.entityValue ?? entity.value,
      context,
      reviewStatus: approvedMatch ? "approved" : "pending",
      organizationRole: approvedMatch?.organizationRole ?? null,
      vendorCandidate,
      dedupKey,
      personTitle: parsedPersonContext.title ?? null,
      linkedOrganizationName: parsedPersonContext.org ?? null,
      sourceId: input.sourceId,
      createdAt: now,
    });
    counts.entities = (counts.entities ?? 0) + 1;
  }

  const discoveredFactCount = await persistDiscoveredFacts({
    sourceId: input.sourceId,
    facts: input.document.discovered_facts,
  });
  if (discoveredFactCount) {
    counts.discovered_facts = discoveredFactCount;
  }

  return { counts };
}

/** Backfill equipment mentions for one extraction source without re-persisting other fields. */
export async function backfillEquipmentMentionsForSource(input: {
  sourceId: string;
  document: EmailExtractionDocument;
}): Promise<number> {
  const now = new Date().toISOString();
  const counts: Record<string, number> = {};
  const maintenanceEquipmentNames = new Set(
    (input.document.maintenance_events ?? [])
      .map((event) => event.equipment?.trim().toLowerCase())
      .filter((name): name is string => Boolean(name)),
  );

  await persistEquipmentMentions({
    sourceId: input.sourceId,
    document: input.document,
    now,
    counts,
    skipEquipmentNames: maintenanceEquipmentNames,
  });

  return counts.equipment_mentions ?? 0;
}

export async function deleteExtractionEntities(sourceId: string): Promise<void> {
  const db = getDb();
  const tables = [
    maintenanceEvents,
    budgetLineItems,
    invoices,
    contracts,
    residentIssues,
    capitalProjects,
    extractedActionItems,
    entityMentions,
    calendarEvents,
  ] as const;

  for (const table of tables) {
    await db.delete(table).where(eq(table.sourceId, sourceId));
  }

  await db
    .delete(extractionSources)
    .where(eq(extractionSources.id, sourceId));
}
