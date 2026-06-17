/** Email/attachment extraction schema — all 7 domains in one pass. */

import { dedupeEntities } from "@/lib/email/entity-dedup";
import { filterAuditEntities } from "@/lib/email/entity-grouping";

export type ExtractionConfidence = "high" | "medium" | "low";
export type ExtractionUrgency = "low" | "normal" | "high" | "urgent";

export type MaintenanceEventExtraction = {
  equipment: string;
  action: string;
  date?: string;
  time?: string;
  vendor?: string;
  cost?: number;
  work_order?: string;
  status?: string;
  description?: string;
  source_quote?: string;
  confidence?: ExtractionConfidence;
};

export type BudgetLineItemExtraction = {
  period?: string;
  fiscal_year?: number;
  category: string;
  subcategory?: string;
  budgeted_amount?: number;
  actual_amount?: number;
  variance?: number;
  currency?: string;
  source_quote?: string;
  confidence?: ExtractionConfidence;
};

export type InvoiceExtraction = {
  vendor?: string;
  amount?: number;
  date?: string;
  invoice_number?: string;
  category?: string;
  paid?: boolean;
  source_quote?: string;
};

export type VendorExtraction = {
  name: string;
  contact?: string;
  email?: string;
  phone?: string;
  services?: string[];
  contract_start?: string;
  contract_end?: string;
  auto_renew?: boolean;
  source_quote?: string;
};

export type ContractExtraction = {
  vendor?: string;
  type?: string;
  value?: number;
  term?: string;
  start_date?: string;
  end_date?: string;
  source_quote?: string;
};

export type MeetingExtraction = {
  type?: string;
  date?: string;
  time?: string;
  location?: string;
  agenda_items?: string[];
  source_quote?: string;
};

/**
 * A previously-scheduled meeting being cancelled or postponed.
 * The persistence layer uses (date, time) to find and delete the matching
 * calendar event, and to suppress any meeting on the same slot extracted
 * from the same document (e.g. .ics attachment that still describes the
 * original invite alongside a cancellation body).
 */
export type MeetingCancellationExtraction = {
  date: string;
  time?: string;
  type?: string;
  reason?: string;
  source_quote?: string;
};

export type MotionExtraction = {
  text?: string;
  moved_by?: string;
  seconded_by?: string;
  outcome?: string;
  meeting_date?: string;
  source_quote?: string;
};

export type DeadlineExtraction = {
  description: string;
  date?: string;
  assignee?: string;
  regulatory?: boolean;
  source_quote?: string;
};

export type ResidentIssueExtraction = {
  unit?: string;
  category?: string;
  description: string;
  status?: string;
  resolution?: string;
  source_quote?: string;
};

export type CapitalProjectExtraction = {
  name: string;
  phase?: string;
  budget?: number;
  contractor?: string;
  start_date?: string;
  completion_date?: string;
  source_quote?: string;
};

export type InspectionExtraction = {
  type?: string;
  date?: string;
  result?: string;
  next_due?: string;
  source_quote?: string;
};

export type ActionItemExtraction = {
  assignee: string;
  task: string;
  deadline?: string;
  source_quote?: string;
};

export type EntityExtraction = {
  type: string;
  value: string;
  context?: string;
};

export type DiscoveredFactExtraction = {
  concept_name: string;
  fields: Record<string, unknown>;
  source_quote?: string;
  confidence?: ExtractionConfidence;
};

export type ProposedNewConceptExtraction = {
  name: string;
  description: string;
  suggested_fields?: Array<{
    name: string;
    type?: string;
    description?: string;
  }>;
  source_quote?: string;
};

export type EmailExtractionDocument = {
  document_type?: string;
  summary?: string;
  urgency?: ExtractionUrgency;
  /** Attachment-only: false for logos, tracking pixels, decorative images. */
  has_value?: boolean;
  /** Attachment-only: e.g. logo, tracking_pixel, document, invoice. */
  attachment_role?: string;
  tags?: string[];
  equipment_mentions?: string[];
  maintenance_events?: MaintenanceEventExtraction[];
  warranty_mentions?: string[];
  budget_line_items?: BudgetLineItemExtraction[];
  reserve_fund_mentions?: string[];
  special_assessments?: Array<{
    amount?: number;
    purpose?: string;
    approval_status?: string;
    source_quote?: string;
  }>;
  invoices?: InvoiceExtraction[];
  insurance_premiums?: Array<{
    carrier?: string;
    premium?: number;
    renewal_date?: string;
    source_quote?: string;
  }>;
  vendors?: VendorExtraction[];
  quotes?: Array<{
    vendor?: string;
    amount?: number;
    scope?: string;
    valid_until?: string;
    selected?: boolean;
    source_quote?: string;
  }>;
  contracts?: ContractExtraction[];
  meetings?: MeetingExtraction[];
  meeting_cancellations?: MeetingCancellationExtraction[];
  motions?: MotionExtraction[];
  board_changes?: Array<{
    name?: string;
    role?: string;
    change_type?: string;
    date?: string;
    source_quote?: string;
  }>;
  deadlines?: DeadlineExtraction[];
  resident_issues?: ResidentIssueExtraction[];
  bylaw_mentions?: Array<{
    rule?: string;
    violation?: string;
    action?: string;
    source_quote?: string;
  }>;
  access_incidents?: Array<{
    type?: string;
    description?: string;
    date?: string;
    source_quote?: string;
  }>;
  capital_projects?: CapitalProjectExtraction[];
  inspections?: InspectionExtraction[];
  permits?: Array<{
    number?: string;
    status?: string;
    description?: string;
    source_quote?: string;
  }>;
  action_items?: ActionItemExtraction[];
  entities?: EntityExtraction[];
  discovered_facts?: DiscoveredFactExtraction[];
  proposed_new_concepts?: ProposedNewConceptExtraction[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/[$,]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((s) => s.trim());
}

function parseSuggestedFields(
  value: unknown,
): ProposedNewConceptExtraction["suggested_fields"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((item) => ({
      name: asString(item.name) ?? "",
      type: asString(item.type),
      description: asString(item.description),
    }))
    .filter((item) => item.name);
}

function parseMaintenanceEvents(value: unknown): MaintenanceEventExtraction[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((item) => ({
      equipment: asString(item.equipment) ?? "Unknown",
      action: asString(item.action) ?? "unknown",
      date: asString(item.date),
      time: asString(item.time),
      vendor: asString(item.vendor),
      cost: asNumber(item.cost),
      work_order: asString(item.work_order),
      status: asString(item.status),
      description: asString(item.description),
      source_quote: asString(item.source_quote),
      confidence: asString(item.confidence) as ExtractionConfidence | undefined,
    }))
    .filter((e) => e.equipment !== "Unknown" || e.description);
}

function parseBudgetLineItems(value: unknown): BudgetLineItemExtraction[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((item) => ({
    period: asString(item.period),
    fiscal_year: asNumber(item.fiscal_year),
    category: asString(item.category) ?? "Uncategorized",
    subcategory: asString(item.subcategory),
    budgeted_amount: asNumber(item.budgeted_amount),
    actual_amount: asNumber(item.actual_amount),
    variance: asNumber(item.variance),
    currency: asString(item.currency) ?? "CAD",
    source_quote: asString(item.source_quote),
    confidence: asString(item.confidence) as ExtractionConfidence | undefined,
  }));
}

function parseActionItems(value: unknown): ActionItemExtraction[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((item) => ({
      assignee: asString(item.assignee) ?? "Unassigned",
      task: asString(item.task) ?? asString(item.task_description) ?? "",
      deadline: asString(item.deadline),
      source_quote: asString(item.source_quote),
    }))
    .filter((item) => item.task);
}

function parseDiscoveredFacts(value: unknown): DiscoveredFactExtraction[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((item) => ({
      concept_name: asString(item.concept_name) ?? "",
      fields: isObject(item.fields) ? item.fields : {},
      source_quote: asString(item.source_quote),
      confidence: asString(item.confidence) as ExtractionConfidence | undefined,
    }))
    .filter((item) => item.concept_name);
}

function parseProposedNewConcepts(value: unknown): ProposedNewConceptExtraction[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((item) => ({
      name: asString(item.name) ?? "",
      description: asString(item.description) ?? "",
      suggested_fields: parseSuggestedFields(item.suggested_fields),
      source_quote: asString(item.source_quote),
    }))
    .filter((item) => item.name && item.description);
}

export function validateEmailExtraction(
  raw: unknown,
): { document: EmailExtractionDocument; errors: string[] } {
  const errors: string[] = [];
  if (!isObject(raw)) {
    return { document: {}, errors: ["Extraction root must be an object."] };
  }

  const document: EmailExtractionDocument = {
    document_type: asString(raw.document_type),
    summary: asString(raw.summary),
    urgency: asString(raw.urgency) as ExtractionUrgency | undefined,
    has_value: asBool(raw.has_value),
    attachment_role: asString(raw.attachment_role),
    tags: asStringArray(raw.tags),
    equipment_mentions: asStringArray(raw.equipment_mentions),
    maintenance_events: parseMaintenanceEvents(raw.maintenance_events),
    warranty_mentions: asStringArray(raw.warranty_mentions),
    budget_line_items: parseBudgetLineItems(raw.budget_line_items),
    reserve_fund_mentions: asStringArray(raw.reserve_fund_mentions),
    invoices: Array.isArray(raw.invoices)
      ? raw.invoices.filter(isObject).map((item) => ({
          vendor: asString(item.vendor),
          amount: asNumber(item.amount),
          date: asString(item.date),
          invoice_number: asString(item.invoice_number),
          category: asString(item.category),
          paid: asBool(item.paid),
          source_quote: asString(item.source_quote),
        }))
      : [],
    vendors: Array.isArray(raw.vendors)
      ? raw.vendors.filter(isObject).map((item) => ({
          name: asString(item.name) ?? "Unknown vendor",
          contact: asString(item.contact),
          email: asString(item.email),
          phone: asString(item.phone),
          services: asStringArray(item.services),
          contract_start: asString(item.contract_start),
          contract_end: asString(item.contract_end),
          auto_renew: asBool(item.auto_renew),
          source_quote: asString(item.source_quote),
        }))
      : [],
    contracts: Array.isArray(raw.contracts)
      ? raw.contracts.filter(isObject).map((item) => ({
          vendor: asString(item.vendor),
          type: asString(item.type),
          value: asNumber(item.value),
          term: asString(item.term),
          start_date: asString(item.start_date),
          end_date: asString(item.end_date),
          source_quote: asString(item.source_quote),
        }))
      : [],
    meetings: Array.isArray(raw.meetings)
      ? raw.meetings.filter(isObject).map((item) => ({
          type: asString(item.type),
          date: asString(item.date),
          time: asString(item.time),
          location: asString(item.location),
          agenda_items: asStringArray(item.agenda_items),
          source_quote: asString(item.source_quote),
        }))
      : [],
    meeting_cancellations: Array.isArray(raw.meeting_cancellations)
      ? raw.meeting_cancellations
          .filter(isObject)
          .map((item) => ({
            date: asString(item.date) ?? "",
            time: asString(item.time),
            type: asString(item.type),
            reason: asString(item.reason),
            source_quote: asString(item.source_quote),
          }))
          .filter((item) => item.date)
      : [],
    motions: Array.isArray(raw.motions)
      ? raw.motions.filter(isObject).map((item) => ({
          text: asString(item.text),
          moved_by: asString(item.moved_by),
          seconded_by: asString(item.seconded_by),
          outcome: asString(item.outcome),
          meeting_date: asString(item.meeting_date),
          source_quote: asString(item.source_quote),
        }))
      : [],
    deadlines: Array.isArray(raw.deadlines)
      ? raw.deadlines.filter(isObject).map((item) => ({
          description: asString(item.description) ?? "",
          date: asString(item.date),
          assignee: asString(item.assignee),
          regulatory: asBool(item.regulatory),
          source_quote: asString(item.source_quote),
        }))
      : [],
    resident_issues: Array.isArray(raw.resident_issues)
      ? raw.resident_issues.filter(isObject).map((item) => ({
          unit: asString(item.unit),
          category: asString(item.category),
          description: asString(item.description) ?? "",
          status: asString(item.status),
          resolution: asString(item.resolution),
          source_quote: asString(item.source_quote),
        }))
      : [],
    capital_projects: Array.isArray(raw.capital_projects)
      ? raw.capital_projects.filter(isObject).map((item) => ({
          name: asString(item.name) ?? "Unknown project",
          phase: asString(item.phase),
          budget: asNumber(item.budget),
          contractor: asString(item.contractor),
          start_date: asString(item.start_date),
          completion_date: asString(item.completion_date),
          source_quote: asString(item.source_quote),
        }))
      : [],
    inspections: Array.isArray(raw.inspections)
      ? raw.inspections.filter(isObject).map((item) => ({
          type: asString(item.type),
          date: asString(item.date),
          result: asString(item.result),
          next_due: asString(item.next_due),
          source_quote: asString(item.source_quote),
        }))
      : [],
    action_items: parseActionItems(raw.action_items),
    entities: Array.isArray(raw.entities)
      ? raw.entities.filter(isObject).map((item) => ({
          type: asString(item.type) ?? "unknown",
          value: asString(item.value) ?? "",
          context: asString(item.context),
        }))
      : [],
    discovered_facts: parseDiscoveredFacts(raw.discovered_facts),
    proposed_new_concepts: parseProposedNewConcepts(raw.proposed_new_concepts),
  };

  return { document, errors };
}

export function mergeExtractionDocuments(
  docs: EmailExtractionDocument[],
): EmailExtractionDocument {
  const merged: EmailExtractionDocument = {};
  const arrayKeys = [
    "equipment_mentions",
    "maintenance_events",
    "warranty_mentions",
    "budget_line_items",
    "reserve_fund_mentions",
    "invoices",
    "vendors",
    "contracts",
    "meetings",
    "meeting_cancellations",
    "motions",
    "deadlines",
    "resident_issues",
    "capital_projects",
    "inspections",
    "action_items",
    "entities",
    "tags",
    "discovered_facts",
    "proposed_new_concepts",
  ] as const;

  for (const doc of docs) {
    if (!merged.summary && doc.summary) merged.summary = doc.summary;
    if (!merged.document_type && doc.document_type)
      merged.document_type = doc.document_type;
    if (!merged.urgency && doc.urgency) merged.urgency = doc.urgency;

    for (const key of arrayKeys) {
      const existing = (merged[key] as unknown[] | undefined) ?? [];
      const incoming = (doc[key] as unknown[] | undefined) ?? [];
      (merged as Record<string, unknown>)[key] = [...existing, ...incoming];
    }
  }

  if (merged.entities?.length) {
    merged.entities = dedupeEntities(
      filterAuditEntities(
        merged.entities.map((entity) => ({
          type: entity.type,
          value: entity.value,
          context: entity.context,
        })),
      ),
    ).map((entity) => ({
      type: entity.type,
      value: entity.value,
      context: entity.contexts[0],
    }));
  }

  return merged;
}
