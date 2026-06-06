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
  highlights: string[];
};

export type InboxExtractionSummary = {
  totalFacts: number;
  documentType?: string;
  summary?: string;
  urgency?: ExtractionUrgency;
  tags?: string[];
  counts: Record<string, number>;
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
    highlights: buildHighlights(document),
  };
}

export function buildInboxExtractionSummary(
  previews: EmailExtractionPreview[],
): InboxExtractionSummary | null {
  if (previews.length === 0) return null;

  let counts: Record<string, number> = {};
  let totalFacts = 0;
  const highlights: string[] = [];
  const tags = new Set<string>();

  for (const preview of previews) {
    counts = mergeCounts(counts, preview.counts);
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
