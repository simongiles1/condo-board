import {
  mergeExtractionDocuments,
  validateEmailExtraction,
  type EmailExtractionDocument,
  type ExtractionUrgency,
} from "@/lib/email-analysis/schema";

const COUNTABLE_ARRAY_KEYS = [
  "equipment_mentions",
  "maintenance_events",
  "warranty_mentions",
  "budget_line_items",
  "reserve_fund_mentions",
  "special_assessments",
  "invoices",
  "insurance_premiums",
  "vendors",
  "quotes",
  "contracts",
  "meetings",
  "meeting_cancellations",
  "motions",
  "board_changes",
  "deadlines",
  "resident_issues",
  "bylaw_mentions",
  "access_incidents",
  "capital_projects",
  "inspections",
  "permits",
  "action_items",
  "entities",
  "discovered_facts",
  "proposed_new_concepts",
] as const;

export type EmailExtractionPreview = {
  emailId: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  documentType?: string;
  summary?: string;
  urgency?: ExtractionUrgency;
  tags?: string[];
  counts: Record<string, number>;
  fieldDetails: Record<string, string[]>;
  highlights: string[];
};

export type InboxExtractionSummary = {
  totalFacts: number;
  documentType?: string;
  summary?: string;
  urgency?: ExtractionUrgency;
  tags?: string[];
  counts: Record<string, number>;
  fieldDetails: Record<string, string[]>;
  highlights: string[];
  emails: EmailExtractionPreview[];
};

function parseExtractionDocument(rawJson: string): EmailExtractionDocument | null {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    const { document } = validateEmailExtraction(parsed);
    return document;
  } catch {
    return null;
  }
}

export function countExtractionFields(
  document: EmailExtractionDocument,
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const key of COUNTABLE_ARRAY_KEYS) {
    const value = document[key];
    if (Array.isArray(value) && value.length > 0) {
      counts[key] = value.length;
    }
  }

  if (document.tags?.length) {
    counts.tags = new Set(document.tags).size;
  }

  return counts;
}

function mergeCounts(
  target: Record<string, number>,
  incoming: Record<string, number>,
): Record<string, number> {
  const merged = { ...target };
  for (const [key, count] of Object.entries(incoming)) {
    merged[key] = (merged[key] ?? 0) + count;
  }
  return merged;
}

function formatLabel(key: string): string {
  return key.replace(/_/g, " ");
}

function fieldString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function formatExtractionFieldItem(key: string, item: unknown): string | null {
  if (typeof item === "string" && item.trim()) {
    return item.trim();
  }

  if (!item || typeof item !== "object") {
    return null;
  }

  const record = item as Record<string, unknown>;

  switch (key) {
    case "maintenance_events": {
      const label = [fieldString(record.action), fieldString(record.equipment)]
        .filter(Boolean)
        .join(": ");
      const date = fieldString(record.date) ? ` (${fieldString(record.date)})` : "";
      return label ? `${label}${date}` : null;
    }
    case "budget_line_items": {
      const category = fieldString(record.category) ?? "Budget item";
      const amount =
        record.budgeted_amount != null
          ? ` — $${Number(record.budgeted_amount).toLocaleString()}`
          : "";
      return `${category}${amount}`;
    }
    case "special_assessments": {
      const purpose = fieldString(record.purpose) ?? "Special assessment";
      const amount =
        record.amount != null ? ` — $${Number(record.amount).toLocaleString()}` : "";
      return `${purpose}${amount}`;
    }
    case "invoices": {
      const amount =
        record.amount != null ? ` — $${Number(record.amount).toLocaleString()}` : "";
      return `${fieldString(record.vendor) ?? "Invoice"}${amount}`;
    }
    case "insurance_premiums": {
      const premium =
        record.premium != null ? ` — $${Number(record.premium).toLocaleString()}` : "";
      return `${fieldString(record.carrier) ?? "Insurance"}${premium}`;
    }
    case "vendors":
      return fieldString(record.name) ?? null;
    case "quotes": {
      const amount =
        record.amount != null ? ` — $${Number(record.amount).toLocaleString()}` : "";
      const scope = fieldString(record.scope) ? ` (${fieldString(record.scope)})` : "";
      return `${fieldString(record.vendor) ?? "Quote"}${amount}${scope}`;
    }
    case "contracts": {
      const vendor = fieldString(record.vendor) ?? "Contract";
      const type = fieldString(record.type) ? ` (${fieldString(record.type)})` : "";
      return `${vendor}${type}`;
    }
    case "meetings": {
      const type = fieldString(record.type) ?? "Meeting";
      const when = [fieldString(record.date), fieldString(record.time)]
        .filter(Boolean)
        .join(" ");
      return when ? `${type} on ${when}` : type;
    }
    case "meeting_cancellations": {
      const when = [fieldString(record.date), fieldString(record.time)]
        .filter(Boolean)
        .join(" ");
      const reason = fieldString(record.reason) ? ` — ${fieldString(record.reason)}` : "";
      return when ? `Cancelled ${when}${reason}` : `Cancelled meeting${reason}`;
    }
    case "motions": {
      const text = fieldString(record.text) ?? "Motion";
      const outcome = fieldString(record.outcome) ? ` (${fieldString(record.outcome)})` : "";
      return `${text}${outcome}`;
    }
    case "board_changes": {
      const name = fieldString(record.name) ?? "Board change";
      const role = fieldString(record.role) ? ` — ${fieldString(record.role)}` : "";
      const changeType = fieldString(record.change_type)
        ? ` (${fieldString(record.change_type)})`
        : "";
      return `${name}${role}${changeType}`;
    }
    case "deadlines": {
      const when = fieldString(record.date) ? ` (${fieldString(record.date)})` : "";
      return `${fieldString(record.description) ?? "Deadline"}${when}`;
    }
    case "resident_issues": {
      const unit = fieldString(record.unit) ? `Unit ${fieldString(record.unit)}: ` : "";
      return `${unit}${fieldString(record.description) ?? "Resident issue"}`;
    }
    case "bylaw_mentions":
      return fieldString(record.rule) ?? null;
    case "access_incidents": {
      const type = fieldString(record.type) ? `${fieldString(record.type)}: ` : "";
      return `${type}${fieldString(record.description) ?? "Access incident"}`;
    }
    case "capital_projects": {
      const phase = fieldString(record.phase) ? ` (${fieldString(record.phase)})` : "";
      return `${fieldString(record.name) ?? "Capital project"}${phase}`;
    }
    case "inspections": {
      const type = fieldString(record.type) ?? "Inspection";
      const when = fieldString(record.date) ? ` on ${fieldString(record.date)}` : "";
      const result = fieldString(record.result) ? ` — ${fieldString(record.result)}` : "";
      return `${type}${when}${result}`;
    }
    case "permits": {
      const number = fieldString(record.number) ? `#${fieldString(record.number)}` : "Permit";
      const description = fieldString(record.description)
        ? ` — ${fieldString(record.description)}`
        : "";
      return `${number}${description}`;
    }
    case "action_items": {
      const assignee = fieldString(record.assignee) ?? "Unassigned";
      const task = fieldString(record.task) ?? "Task";
      const deadline = fieldString(record.deadline) ? ` (due ${fieldString(record.deadline)})` : "";
      return `${assignee}: ${task}${deadline}`;
    }
    case "entities": {
      const entityType = fieldString(record.type) ?? "Entity";
      const value = fieldString(record.value) ?? "Unknown";
      const context = fieldString(record.context) ? ` — ${fieldString(record.context)}` : "";
      return `${entityType}: ${value}${context}`;
    }
    case "discovered_facts":
      return fieldString(record.concept_name) ?? null;
    case "proposed_new_concepts":
      return fieldString(record.name) ?? null;
    default:
      return null;
  }
}

function buildFieldDetails(
  document: EmailExtractionDocument,
): Record<string, string[]> {
  const fieldDetails: Record<string, string[]> = {};

  for (const key of COUNTABLE_ARRAY_KEYS) {
    const value = document[key];
    if (!Array.isArray(value) || value.length === 0) continue;

    const items = value
      .map((item) => formatExtractionFieldItem(key, item))
      .filter((item): item is string => Boolean(item));

    if (items.length > 0) {
      fieldDetails[key] = items;
    }
  }

  return fieldDetails;
}

function mergeFieldDetails(
  target: Record<string, string[]>,
  incoming: Record<string, string[]>,
): Record<string, string[]> {
  const merged = { ...target };

  for (const [key, items] of Object.entries(incoming)) {
    merged[key] = [...(merged[key] ?? []), ...items];
  }

  return merged;
}

function buildHighlights(document: EmailExtractionDocument): string[] {
  const highlights: string[] = [];

  for (const event of document.maintenance_events ?? []) {
    const label = [event.action, event.equipment].filter(Boolean).join(": ");
    const date = event.date ? ` (${event.date})` : "";
    if (label) highlights.push(`${label}${date}`);
  }

  for (const item of document.action_items ?? []) {
    highlights.push(`${item.assignee}: ${item.task}`);
  }

  for (const meeting of document.meetings ?? []) {
    const type = meeting.type ?? "Meeting";
    const when = [meeting.date, meeting.time].filter(Boolean).join(" ");
    highlights.push(when ? `${type} on ${when}` : type);
  }

  for (const deadline of document.deadlines ?? []) {
    const when = deadline.date ? ` (${deadline.date})` : "";
    highlights.push(`${deadline.description}${when}`);
  }

  for (const invoice of document.invoices ?? []) {
    const amount =
      invoice.amount != null ? ` — $${invoice.amount.toLocaleString()}` : "";
    highlights.push(`${invoice.vendor ?? "Invoice"}${amount}`);
  }

  for (const issue of document.resident_issues ?? []) {
    const unit = issue.unit ? `Unit ${issue.unit}: ` : "";
    highlights.push(`${unit}${issue.description}`);
  }

  return highlights.slice(0, 8);
}

export function buildEmailExtractionPreview(input: {
  emailId: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  rawExtractionJson: string;
}): EmailExtractionPreview | null {
  const document = parseExtractionDocument(input.rawExtractionJson);
  if (!document) return null;

  const counts = countExtractionFields(document);

  return {
    emailId: input.emailId,
    subject: input.subject,
    fromAddress: input.fromAddress,
    receivedAt: input.receivedAt,
    documentType: document.document_type,
    summary: document.summary,
    urgency: document.urgency,
    tags: document.tags?.length ? [...new Set(document.tags)] : undefined,
    counts,
    fieldDetails: buildFieldDetails(document),
    highlights: buildHighlights(document),
  };
}

export function buildInboxExtractionSummary(
  previews: EmailExtractionPreview[],
): InboxExtractionSummary | null {
  if (previews.length === 0) return null;

  let counts: Record<string, number> = {};
  let fieldDetails: Record<string, string[]> = {};
  let totalFacts = 0;
  const highlights: string[] = [];
  const tags = new Set<string>();

  for (const preview of previews) {
    counts = mergeCounts(counts, preview.counts);
    fieldDetails = mergeFieldDetails(fieldDetails, preview.fieldDetails);
    totalFacts += Object.values(preview.counts).reduce((sum, count) => sum + count, 0);
    for (const highlight of preview.highlights) {
      if (highlights.length < 10) highlights.push(highlight);
    }
    for (const tag of preview.tags ?? []) {
      tags.add(tag);
    }
  }

  const primary = previews.find((preview) => preview.summary) ?? previews[0];

  return {
    totalFacts,
    documentType: primary?.documentType,
    summary: primary?.summary,
    urgency: primary?.urgency,
    tags: tags.size > 0 ? [...tags] : undefined,
    counts,
    fieldDetails,
    highlights,
    emails: previews,
  };
}

export function buildMessageExtractionSummary(input: {
  emailId: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  rawExtractionJson: string;
}): InboxExtractionSummary | null {
  const preview = buildEmailExtractionPreview(input);
  if (!preview) return null;
  return buildInboxExtractionSummary([preview]);
}

export function buildThreadExtractionSummary(
  previews: EmailExtractionPreview[],
): InboxExtractionSummary | null {
  return buildInboxExtractionSummary(previews);
}

export function mergeExtractionDocumentsFromJson(
  rawJsonList: string[],
): EmailExtractionDocument | null {
  const documents = rawJsonList
    .map(parseExtractionDocument)
    .filter((document): document is EmailExtractionDocument => document != null);

  if (documents.length === 0) return null;
  return mergeExtractionDocuments(documents);
}

export function formatExtractionFieldLabel(key: string): string {
  return formatLabel(key);
}
