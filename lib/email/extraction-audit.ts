import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

import { resolveExtractionSourceEmails } from "@/lib/building/resolve-source-email";
import { getDb } from "@/lib/db";
import {
  appUsers,
  budgetLineItems,
  calendarEvents,
  capitalProjects,
  contracts,
  discoveredFacts,
  emailThreads,
  emails,
  entityMentions,
  extractedActionItems,
  extractionSources,
  invoices,
  maintenanceEvents,
  residentIssues,
} from "@/lib/db/schema";
import type { DedupedEntity } from "@/lib/email/entity-dedup";
import { buildNamedEntityAuditRecords } from "@/lib/email/named-entity-audit";
import type { ThreadEntityReviewGroup } from "@/lib/entities/entity-review";
import { buildThreadEntityReviewGroups } from "@/lib/entities/entity-review-server";
import {
  filterVendorDestinationGroups,
  loadApprovedOrganizationRoles,
} from "@/lib/email/vendor-audit-filter";
import {
  countExtractionFields,
  formatExtractionFieldItem,
} from "@/lib/email/extraction-display";
import {
  EXTRACTION_DESTINATIONS,
  formatExtractionFieldKeyLabel,
  getDestinationForField,
  isExtractionFieldPersisted,
  type ExtractionDestination,
} from "@/lib/email/extraction-routing";
import {
  validateEmailExtraction,
  type EmailExtractionDocument,
} from "@/lib/email-analysis/schema";

export type ExtractionAuditItem = {
  fieldKey: string;
  fieldLabel: string;
  summary: string;
  sourceQuote?: string;
  persisted: boolean;
  entity?: DedupedEntity & { vendorCandidate?: boolean };
  sourceEmailId?: string | null;
  sourceEmailFrom?: string | null;
  sourceEmailSubject?: string | null;
};

export type ExtractionAuditDestinationGroup = {
  destination: ExtractionDestination;
  items: ExtractionAuditItem[];
};

export type ExtractionAuditRecord = {
  id: string;
  processedAt: string;
  modelName: string;
  sourceType: string;
  emailId: string | null;
  emailSubject: string | null;
  emailFrom: string | null;
  emailReceivedAt: string | null;
  emailThreadId: string | null;
  documentType?: string;
  summary?: string;
  urgency?: string;
  tags: string[];
  destinationGroups: ExtractionAuditDestinationGroup[];
  savedRowCounts: Record<string, number>;
  totalExtractedItems: number;
  /** Email of the app user who triggered this analysis run, when recorded. */
  triggeredByEmail?: string | null;
};

export type ExtractionAuditThreadGroup = {
  groupKey: string;
  emailThreadId: string | null;
  emailSubject: string | null;
  latestProcessedAt: string;
  records: ExtractionAuditRecord[];
  /** Reviewed entity contacts from entity_mentions (approved + pending). */
  threadEntityGroups?: ThreadEntityReviewGroup[];
};

const PAGE_SIZE = 20;

const extractionGroupKey = sql<string>`COALESCE(${extractionSources.emailThreadId}, ${extractionSources.id})`;

export type ExtractionAuditPagination = {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

function fieldString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function scalarItems(
  fieldKey: string,
  document: EmailExtractionDocument,
): ExtractionAuditItem[] {
  switch (fieldKey) {
    case "document_type":
      return document.document_type
        ? [
            {
              fieldKey,
              fieldLabel: formatExtractionFieldKeyLabel(fieldKey),
              summary: document.document_type.replace(/_/g, " "),
              persisted: false,
            },
          ]
        : [];
    case "summary":
      return document.summary
        ? [
            {
              fieldKey,
              fieldLabel: formatExtractionFieldKeyLabel(fieldKey),
              summary: document.summary,
              persisted: false,
            },
          ]
        : [];
    case "urgency":
      return document.urgency
        ? [
            {
              fieldKey,
              fieldLabel: formatExtractionFieldKeyLabel(fieldKey),
              summary: document.urgency,
              persisted: false,
            },
          ]
        : [];
    case "tags":
      return (document.tags ?? []).map((tag) => ({
        fieldKey,
        fieldLabel: formatExtractionFieldKeyLabel(fieldKey),
        summary: tag,
        persisted: false,
      }));
    default:
      return [];
  }
}

function annotateEntityProvenance(
  destinationGroups: ExtractionAuditDestinationGroup[],
  emailId: string | null,
  emailFrom: string | null,
  emailSubject: string | null,
): void {
  for (const group of destinationGroups) {
    if (group.destination.id !== "entities") continue;
    for (const item of group.items) {
      item.sourceEmailId = emailId;
      item.sourceEmailFrom = emailFrom;
      item.sourceEmailSubject = emailSubject;
    }
  }
}

function entityItems(
  fieldKey: string,
  document: EmailExtractionDocument,
): ExtractionAuditItem[] {
  const records = buildNamedEntityAuditRecords(document);
  if (records.length === 0) return [];

  return records.map((entity) => ({
    fieldKey,
    fieldLabel: formatExtractionFieldKeyLabel(fieldKey),
    summary: entity.contexts.length
      ? `${entity.type}: ${entity.value} — ${entity.contexts[0]}`
      : `${entity.type}: ${entity.value}`,
    sourceQuote: entity.contexts[0],
    persisted: isExtractionFieldPersisted(fieldKey),
    entity,
  }));
}

function arrayItems(
  fieldKey: string,
  document: EmailExtractionDocument,
): ExtractionAuditItem[] {
  if (fieldKey === "entities") {
    return entityItems(fieldKey, document);
  }

  const value = document[fieldKey as keyof EmailExtractionDocument];
  if (!Array.isArray(value) || value.length === 0) return [];

  const items: ExtractionAuditItem[] = [];

  for (const item of value) {
    const summary = formatExtractionFieldItem(fieldKey, item);
    if (!summary) continue;

    const sourceQuote =
      item && typeof item === "object"
        ? fieldString((item as Record<string, unknown>).source_quote)
        : undefined;

    items.push({
      fieldKey,
      fieldLabel: formatExtractionFieldKeyLabel(fieldKey),
      summary,
      sourceQuote,
      persisted: isExtractionFieldPersisted(fieldKey),
    });
  }

  return items;
}

function buildDestinationGroups(
  document: EmailExtractionDocument,
): ExtractionAuditDestinationGroup[] {
  const itemsByDestination = new Map<string, ExtractionAuditItem[]>();

  for (const destination of EXTRACTION_DESTINATIONS) {
    itemsByDestination.set(destination.id, []);
  }

  for (const destination of EXTRACTION_DESTINATIONS) {
    for (const fieldKey of destination.fields) {
      const items = [
        ...scalarItems(fieldKey, document),
        ...arrayItems(fieldKey, document),
      ];
      if (!items.length) continue;

      const bucket = itemsByDestination.get(destination.id) ?? [];
      bucket.push(...items);
      itemsByDestination.set(destination.id, bucket);
    }
  }

  return EXTRACTION_DESTINATIONS.map((destination) => ({
    destination,
    items: itemsByDestination.get(destination.id) ?? [],
  })).filter((group) => group.items.length > 0);
}

async function loadSavedRowCounts(
  sourceId: string,
): Promise<Record<string, number>> {
  const db = getDb();
  const tables = [
    ["maintenance_events", maintenanceEvents],
    ["budget_line_items", budgetLineItems],
    ["invoices", invoices],
    ["contracts", contracts],
    ["resident_issues", residentIssues],
    ["capital_projects", capitalProjects],
    ["action_items", extractedActionItems],
    ["entities", entityMentions],
    ["calendar_events", calendarEvents],
    ["discovered_facts", discoveredFacts],
  ] as const;

  const entries = await Promise.all(
    tables.map(async ([key, table]) => {
      const [row] = await db
        .select({ total: count() })
        .from(table)
        .where(eq(table.sourceId, sourceId));
      return [key, row?.total ?? 0] as const;
    }),
  );

  return Object.fromEntries(entries.filter(([, total]) => total > 0));
}

function buildAuditRecord(input: {
  id: string;
  processedAt: string;
  modelName: string;
  sourceType: string;
  rawExtractionJson: string;
  emailId: string | null;
  emailSubject: string | null;
  emailFrom: string | null;
  emailReceivedAt: string | null;
  emailThreadId: string | null;
  savedRowCounts: Record<string, number>;
  triggeredByEmail?: string | null;
}): ExtractionAuditRecord {
  const { document } = validateEmailExtraction(JSON.parse(input.rawExtractionJson));
  const destinationGroups = buildDestinationGroups(document);
  annotateEntityProvenance(
    destinationGroups,
    input.emailId,
    input.emailFrom,
    input.emailSubject,
  );
  const fieldCounts = countExtractionFields(document);
  const totalExtractedItems = Object.values(fieldCounts).reduce(
    (sum, count) => sum + count,
    0,
  );

  return {
    id: input.id,
    processedAt: input.processedAt,
    modelName: input.modelName,
    sourceType: input.sourceType,
    emailId: input.emailId,
    emailSubject: input.emailSubject,
    emailFrom: input.emailFrom,
    emailReceivedAt: input.emailReceivedAt,
    emailThreadId: input.emailThreadId,
    documentType: document.document_type,
    summary: document.summary,
    urgency: document.urgency,
    tags: document.tags ?? [],
    destinationGroups,
    savedRowCounts: input.savedRowCounts,
    totalExtractedItems,
    triggeredByEmail: input.triggeredByEmail ?? null,
  };
}

async function loadAuditRecordsForSources(
  sources: Array<{
    id: string;
    processedAt: string;
    modelName: string;
    sourceType: string;
    sourceId: string;
    emailThreadId: string | null;
    rawExtractionJson: string;
    emailSubject: string | null;
    emailFrom: string | null;
    emailReceivedAt: string | null;
    triggeredByEmail?: string | null;
  }>,
): Promise<ExtractionAuditRecord[]> {
  const emailRefs = await resolveExtractionSourceEmails(
    sources.map((source) => source.id),
  );
  const approvedOrgRoles = await loadApprovedOrganizationRoles();

  return Promise.all(
    sources.map(async (source) => {
      const emailRef = emailRefs.get(source.id);

      const record = buildAuditRecord({
        id: source.id,
        processedAt: source.processedAt,
        modelName: source.modelName,
        sourceType: source.sourceType,
        rawExtractionJson: source.rawExtractionJson,
        emailId:
          emailRef?.emailId ??
          (source.sourceType === "email_message" ? source.sourceId : null),
        emailSubject: emailRef?.subject ?? source.emailSubject,
        emailFrom: emailRef?.fromAddress ?? source.emailFrom,
        emailReceivedAt: emailRef?.receivedAt ?? source.emailReceivedAt,
        emailThreadId: emailRef?.threadId ?? source.emailThreadId,
        savedRowCounts: await loadSavedRowCounts(source.id),
        triggeredByEmail: source.triggeredByEmail ?? null,
      });

      return {
        ...record,
        destinationGroups: filterVendorDestinationGroups(
          record.destinationGroups,
          approvedOrgRoles,
        ),
      };
    }),
  );
}

export async function fetchExtractionAuditPage(page = 1): Promise<{
  records: ExtractionAuditRecord[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}> {
  const db = getDb();
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(extractionSources);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const offset = (currentPage - 1) * PAGE_SIZE;

  const sources = await db
    .select({
      id: extractionSources.id,
      processedAt: extractionSources.processedAt,
      modelName: extractionSources.modelName,
      sourceType: extractionSources.sourceType,
      sourceId: extractionSources.sourceId,
      emailThreadId: extractionSources.emailThreadId,
      rawExtractionJson: extractionSources.rawExtractionJson,
      emailSubject: emails.subject,
      emailFrom: emails.fromAddress,
      emailReceivedAt: emails.receivedAt,
      triggeredByEmail: appUsers.email,
    })
    .from(extractionSources)
    .leftJoin(emails, eq(extractionSources.sourceId, emails.id))
    .leftJoin(appUsers, eq(extractionSources.triggeredByUserId, appUsers.id))
    .orderBy(desc(extractionSources.processedAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  const records = await loadAuditRecordsForSources(sources);

  return {
    records,
    pagination: {
      page: currentPage,
      pageSize: PAGE_SIZE,
      totalCount,
      totalPages,
    },
  };
}

export async function fetchExtractionAuditThreadPage(page = 1): Promise<{
  threadGroups: ExtractionAuditThreadGroup[];
  pagination: ExtractionAuditPagination;
}> {
  const db = getDb();

  const [{ totalCount }] = await db
    .select({ totalCount: count(sql`DISTINCT ${extractionGroupKey}`) })
    .from(extractionSources);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const offset = (currentPage - 1) * PAGE_SIZE;

  const groupRows = await db
    .select({
      groupKey: extractionGroupKey.as("group_key"),
      latestProcessedAt: sql<string>`MAX(${extractionSources.processedAt})`.as(
        "latest_processed_at",
      ),
    })
    .from(extractionSources)
    .groupBy(extractionGroupKey)
    .orderBy(desc(sql`MAX(${extractionSources.processedAt})`))
    .limit(PAGE_SIZE)
    .offset(offset);

  if (groupRows.length === 0) {
    return {
      threadGroups: [],
      pagination: {
        page: currentPage,
        pageSize: PAGE_SIZE,
        totalCount,
        totalPages,
      },
    };
  }

  const groupKeys = groupRows.map((row) => row.groupKey);

  const sources = await db
    .select({
      id: extractionSources.id,
      processedAt: extractionSources.processedAt,
      modelName: extractionSources.modelName,
      sourceType: extractionSources.sourceType,
      sourceId: extractionSources.sourceId,
      emailThreadId: extractionSources.emailThreadId,
      rawExtractionJson: extractionSources.rawExtractionJson,
      emailSubject: emails.subject,
      emailFrom: emails.fromAddress,
      emailReceivedAt: emails.receivedAt,
      triggeredByEmail: appUsers.email,
      groupKey: extractionGroupKey.as("group_key"),
    })
    .from(extractionSources)
    .leftJoin(emails, eq(extractionSources.sourceId, emails.id))
    .leftJoin(appUsers, eq(extractionSources.triggeredByUserId, appUsers.id))
    .where(inArray(extractionGroupKey, groupKeys))
    .orderBy(desc(extractionSources.processedAt));

  const records = await loadAuditRecordsForSources(sources);
  const recordsByGroupKey = new Map<string, ExtractionAuditRecord[]>();

  for (const source of sources) {
    const record = records.find((entry) => entry.id === source.id);
    if (!record) continue;

    const bucket = recordsByGroupKey.get(source.groupKey) ?? [];
    bucket.push(record);
    recordsByGroupKey.set(source.groupKey, bucket);
  }

  const threadIds = [
    ...new Set(
      sources
        .map((source) => source.emailThreadId)
        .filter((threadId): threadId is string => Boolean(threadId)),
    ),
  ];

  const threadSubjects = new Map<string, string>();
  if (threadIds.length > 0) {
    const threads = await db
      .select({ id: emailThreads.id, subject: emailThreads.subject })
      .from(emailThreads)
      .where(inArray(emailThreads.id, threadIds));

    for (const thread of threads) {
      threadSubjects.set(thread.id, thread.subject);
    }
  }

  const threadGroups = await Promise.all(
    groupRows.map(async (groupRow) => {
      const groupRecords = recordsByGroupKey.get(groupRow.groupKey) ?? [];
      const emailThreadId = groupRecords[0]?.emailThreadId ?? null;
      const emailSubject =
        (emailThreadId ? threadSubjects.get(emailThreadId) : null) ??
        groupRecords[0]?.emailSubject ??
        null;

      const threadEntityGroups = emailThreadId
        ? await buildThreadEntityReviewGroups(emailThreadId)
        : [];

      return {
        groupKey: groupRow.groupKey,
        emailThreadId,
        emailSubject,
        latestProcessedAt: groupRow.latestProcessedAt,
        records: groupRecords,
        threadEntityGroups:
          threadEntityGroups.length > 0 ? threadEntityGroups : undefined,
      };
    }),
  );

  return {
    threadGroups,
    pagination: {
      page: currentPage,
      pageSize: PAGE_SIZE,
      totalCount,
      totalPages,
    },
  };
}

/** Paginated extraction runs for one destination, plus per-destination item counts. */
export async function fetchExtractionByTypePage(
  destinationId: string,
  page = 1,
): Promise<{
  records: ExtractionAuditRecord[];
  pagination: ExtractionAuditPagination;
  destinationCounts: Record<string, number>;
}> {
  const db = getDb();

  const sources = await db
    .select({
      id: extractionSources.id,
      processedAt: extractionSources.processedAt,
      modelName: extractionSources.modelName,
      sourceType: extractionSources.sourceType,
      sourceId: extractionSources.sourceId,
      emailThreadId: extractionSources.emailThreadId,
      rawExtractionJson: extractionSources.rawExtractionJson,
      emailSubject: emails.subject,
      emailFrom: emails.fromAddress,
      emailReceivedAt: emails.receivedAt,
      triggeredByEmail: appUsers.email,
    })
    .from(extractionSources)
    .leftJoin(emails, eq(extractionSources.sourceId, emails.id))
    .leftJoin(appUsers, eq(extractionSources.triggeredByUserId, appUsers.id))
    .orderBy(desc(extractionSources.processedAt));

  const destinationCounts: Record<string, number> = Object.fromEntries(
    EXTRACTION_DESTINATIONS.map((destination) => [destination.id, 0]),
  );
  const matchingRecords: ExtractionAuditRecord[] = [];
  const approvedOrgRoles = await loadApprovedOrganizationRoles();

  for (const source of sources) {
    const record = buildAuditRecord({
      id: source.id,
      processedAt: source.processedAt,
      modelName: source.modelName,
      sourceType: source.sourceType,
      rawExtractionJson: source.rawExtractionJson,
      emailId:
        source.sourceType === "email_message" ? source.sourceId : null,
      emailSubject: source.emailSubject,
      emailFrom: source.emailFrom,
      emailReceivedAt: source.emailReceivedAt,
      emailThreadId: source.emailThreadId,
      savedRowCounts: {},
      triggeredByEmail: source.triggeredByEmail ?? null,
    });

    const filteredGroups = filterVendorDestinationGroups(
      record.destinationGroups,
      approvedOrgRoles,
    );
    const filteredRecord = { ...record, destinationGroups: filteredGroups };

    for (const group of filteredRecord.destinationGroups) {
      if (group.items.length > 0) {
        destinationCounts[group.destination.id] =
          (destinationCounts[group.destination.id] ?? 0) + group.items.length;
      }
    }

    const hasDestination = filteredRecord.destinationGroups.some(
      (group) =>
        group.destination.id === destinationId && group.items.length > 0,
    );
    if (hasDestination) {
      matchingRecords.push(filteredRecord);
    }
  }

  const totalCount = matchingRecords.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const offset = (currentPage - 1) * PAGE_SIZE;

  return {
    records: matchingRecords.slice(offset, offset + PAGE_SIZE),
    pagination: {
      page: currentPage,
      pageSize: PAGE_SIZE,
      totalCount,
      totalPages,
    },
    destinationCounts,
  };
}

export function describeFieldRouting(fieldKey: string): {
  destination: ExtractionDestination | undefined;
  note?: string;
} {
  const destination = getDestinationForField(fieldKey);
  const note = destination?.fieldNotes?.[fieldKey];
  return { destination, note };
}

const extractionSourceSelect = {
  id: extractionSources.id,
  processedAt: extractionSources.processedAt,
  modelName: extractionSources.modelName,
  sourceType: extractionSources.sourceType,
  sourceId: extractionSources.sourceId,
  emailThreadId: extractionSources.emailThreadId,
  rawExtractionJson: extractionSources.rawExtractionJson,
  emailSubject: emails.subject,
  emailFrom: emails.fromAddress,
  emailReceivedAt: emails.receivedAt,
  triggeredByEmail: appUsers.email,
};

/** Full extraction audit records for one email message. */
export async function fetchExtractionAuditForEmail(emailId: string): Promise<{
  records: ExtractionAuditRecord[];
}> {
  const db = getDb();
  const sources = await db
    .select(extractionSourceSelect)
    .from(extractionSources)
    .leftJoin(emails, eq(extractionSources.sourceId, emails.id))
    .leftJoin(appUsers, eq(extractionSources.triggeredByUserId, appUsers.id))
    .where(
      and(
        eq(extractionSources.sourceId, emailId),
        eq(extractionSources.sourceType, "email_message"),
      ),
    )
    .orderBy(desc(extractionSources.processedAt));

  const records = await loadAuditRecordsForSources(sources);
  return { records };
}

/** Merged extraction audit data for all emails in a thread. */
export async function fetchExtractionAuditForThread(threadId: string): Promise<{
  records: ExtractionAuditRecord[];
  emailSubject: string | null;
  threadEntityGroups: ThreadEntityReviewGroup[];
}> {
  const db = getDb();

  const [thread] = await db
    .select({ subject: emailThreads.subject })
    .from(emailThreads)
    .where(eq(emailThreads.id, threadId));

  const sources = await db
    .select(extractionSourceSelect)
    .from(extractionSources)
    .leftJoin(emails, eq(extractionSources.sourceId, emails.id))
    .leftJoin(appUsers, eq(extractionSources.triggeredByUserId, appUsers.id))
    .where(eq(extractionSources.emailThreadId, threadId))
    .orderBy(desc(extractionSources.processedAt));

  const records = await loadAuditRecordsForSources(sources);
  const threadEntityGroups = await buildThreadEntityReviewGroups(threadId);

  return {
    records,
    emailSubject: thread?.subject ?? null,
    threadEntityGroups,
  };
}
