import { count, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  budgetLineItems,
  calendarEvents,
  capitalProjects,
  contracts,
  discoveredFacts,
  emails,
  entityMentions,
  extractedActionItems,
  extractionSources,
  invoices,
  maintenanceEvents,
  residentIssues,
} from "@/lib/db/schema";
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
};

const PAGE_SIZE = 20;

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

function arrayItems(
  fieldKey: string,
  document: EmailExtractionDocument,
): ExtractionAuditItem[] {
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
}): ExtractionAuditRecord {
  const { document } = validateEmailExtraction(JSON.parse(input.rawExtractionJson));
  const destinationGroups = buildDestinationGroups(document);
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
  };
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
    })
    .from(extractionSources)
    .leftJoin(emails, eq(extractionSources.sourceId, emails.id))
    .orderBy(desc(extractionSources.processedAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  const records = await Promise.all(
    sources.map(async (source) =>
      buildAuditRecord({
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
        savedRowCounts: await loadSavedRowCounts(source.id),
      }),
    ),
  );

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

export function describeFieldRouting(fieldKey: string): {
  destination: ExtractionDestination | undefined;
  note?: string;
} {
  const destination = getDestinationForField(fieldKey);
  const note = destination?.fieldNotes?.[fieldKey];
  return { destination, note };
}
