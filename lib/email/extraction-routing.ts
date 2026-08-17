/** Where each AI extraction field is routed after email analysis. */

export type ExtractionDestination = {
  id: string;
  title: string;
  description: string;
  /** App routes where persisted data appears. */
  appPages: Array<{ href: string; label: string }>;
  /** Database tables written by persistExtractionDocument (or related workers). */
  dbTables: string[];
  /** Extraction document keys grouped under this destination. */
  fields: string[];
  /** Extra notes keyed by extraction field name. */
  fieldNotes?: Record<string, string>;
};

export type ExtractionFieldMeta = {
  key: string;
  label: string;
  destinationId: string;
  /** False when the field is only kept in extraction_sources.raw_extraction_json. */
  persisted: boolean;
};

const ROUTE_LABELS: Record<string, string> = {
  document_type: "Document type",
  summary: "Summary",
  urgency: "Urgency",
  tags: "Tags",
  equipment_mentions: "Equipment mentions",
  maintenance_events: "Maintenance events",
  warranty_mentions: "Warranty mentions",
  budget_line_items: "Budget line items",
  reserve_fund_mentions: "Reserve fund mentions",
  special_assessments: "Special assessments",
  invoices: "Invoices",
  insurance_premiums: "Insurance premiums",
  vendors: "Vendors",
  quotes: "Quotes",
  contracts: "Contracts",
  meetings: "Meetings",
  meeting_cancellations: "Meeting cancellations",
  meeting_reschedules: "Meeting reschedules",
  motions: "Motions",
  board_changes: "Board changes",
  deadlines: "Deadlines",
  resident_issues: "Resident issues",
  bylaw_mentions: "Bylaw mentions",
  access_incidents: "Access incidents",
  capital_projects: "Capital projects",
  inspections: "Inspections",
  permits: "Permits",
  action_items: "Action items",
  entities: "Entities",
  discovered_facts: "Discovered facts",
  proposed_new_concepts: "Proposed new concepts",
};

export const EXTRACTION_DESTINATIONS: ExtractionDestination[] = [
  {
    id: "metadata",
    title: "Email summary metadata",
    description:
      "High-level classification shown in inbox extraction badges. Stored only in the extraction archive, not as separate database rows.",
    appPages: [{ href: "/knowledge/emails", label: "Emails processed panel" }],
    dbTables: [],
    fields: ["document_type", "summary", "urgency", "tags"],
  },
  {
    id: "calendar",
    title: "Calendar",
    description:
      "Confirmed meetings, hard external deadlines, dated inspections, and dated maintenance. Cancellations come off the calendar; reschedules move the same event.",
    appPages: [{ href: "/operations/calendar", label: "Calendar" }],
    dbTables: ["calendar_events"],
    fields: ["meetings", "deadlines", "meeting_cancellations", "meeting_reschedules", "inspections"],
    fieldNotes: {
      meetings:
        "Tier-1 exact dedup (same date + identical source_quote, or same calendar day) runs at merge and persist. Tier-2 AI thread reconciliation merges semantic duplicates with different wording.",
      deadlines:
        "Tier-1 exact dedup (same date + identical source_quote) runs at merge and persist. Tier-2 AI thread reconciliation merges semantic duplicates when quotes differ but the thread shows one real deadline.",
      meeting_cancellations:
        "Does not insert a calendar row — pulls the matching meeting off the calendar (status=cancelled), like Google Calendar.",
      meeting_reschedules:
        "Moves the existing calendar event to the new date (same id). A Teams cancel plus a later new invite is cancel then insert, not a reschedule.",
      inspections:
        "Dated inspections persist as calendar_events with event_type=inspection.",
    },
  },
  {
    id: "action_items",
    title: "Action items (email tasks)",
    description:
      "Internal asks, requests, and follow-ups. These are not meeting to-dos and are not added to the global to-do list.",
    appPages: [
      { href: "/", label: "Dashboard task radar" },
      { href: "/insights/analytics", label: "Insights analytics" },
      { href: "/operations/todos", label: "Global to-dos" },
    ],
    dbTables: ["extracted_action_items"],
    fields: ["action_items"],
    fieldNotes: {
      action_items:
        "Distinct from meeting To-dos (/todos) and global todos. Soft deadlines on action items are not promoted to the calendar. Before insert, new items are semantically deduplicated against open thread tasks (AI obligation matching, not fuzzy text). After each email analysis, open items in the same thread are reconciled against analyzed messages only (oldest-first) to supersede duplicates and close resolved asks. Send-calendar-invite tasks are excluded from thread reconciliation and close only when a separate meeting-invite email (e.g. Teams) is analyzed.",
    },
  },
  {
    id: "maintenance",
    title: "Maintenance & equipment",
    description: "Equipment registry and maintenance history for building insights.",
    appPages: [
      { href: "/insights/analytics", label: "Insights equipment timeline" },
      { href: "/building/maintenance", label: "Building maintenance" },
    ],
    dbTables: ["maintenance_events", "equipment_assets", "calendar_events"],
    fields: ["maintenance_events", "equipment_mentions"],
    fieldNotes: {
      maintenance_events:
        "Saved to maintenance_events with free-text equipment names (no equipment_assets insert). Also creates a calendar_events row when a date is present.",
      equipment_mentions:
        "Saved to equipment_assets and as a mentioned maintenance event on Insights when no dated maintenance_events exist for the same equipment.",
    },
  },
  {
    id: "financial",
    title: "Financial records",
    description: "Budget figures and invoices extracted from email and attachments.",
    appPages: [{ href: "/building/budget", label: "Building budget charts" }],
    dbTables: ["budget_line_items", "budget_categories", "invoices"],
    fields: [
      "budget_line_items",
      "invoices",
      "reserve_fund_mentions",
      "special_assessments",
      "insurance_premiums",
      "quotes",
    ],
    fieldNotes: {
      reserve_fund_mentions: "Extracted only — not persisted to a dedicated table yet.",
      special_assessments: "Extracted only — not persisted to a dedicated table yet.",
      insurance_premiums: "Extracted only — not persisted to a dedicated table yet.",
      quotes: "Extracted only — not persisted to a dedicated table yet.",
    },
  },
  {
    id: "vendors",
    title: "Vendors & contracts",
    description: "Vendor directory entries and contract records.",
    appPages: [
      { href: "/insights/queue", label: "Insights review queue" },
      { href: "/knowledge/entities", label: "Entities registry" },
    ],
    dbTables: ["vendors", "contracts"],
    fields: ["vendors", "contracts"],
    fieldNotes: {
      vendors:
        "Flagged for entity review — not added to the vendor directory until a board member approves the contact on Insights.",
    },
  },
  {
    id: "capital",
    title: "Capital projects",
    description: "Major building projects and their phases.",
    appPages: [{ href: "/building/overview", label: "Building" }],
    dbTables: ["capital_projects"],
    fields: ["capital_projects"],
  },
  {
    id: "resident",
    title: "Resident issues",
    description: "Unit-level complaints, requests, and resolutions.",
    appPages: [{ href: "/building/overview", label: "Building" }],
    dbTables: ["resident_issues"],
    fields: ["resident_issues", "bylaw_mentions", "access_incidents"],
    fieldNotes: {
      bylaw_mentions: "Extracted only — not persisted to a dedicated table yet.",
      access_incidents: "Extracted only — not persisted to a dedicated table yet.",
    },
  },
  {
    id: "governance",
    title: "Governance mentions",
    description: "Board motions and membership changes mentioned in email.",
    appPages: [],
    dbTables: [],
    fields: ["motions", "board_changes", "permits"],
    fieldNotes: {
      motions: "Extracted only — not persisted to a dedicated table yet.",
      board_changes: "Extracted only — not persisted to a dedicated table yet.",
      permits: "Extracted only — not persisted to a dedicated table yet.",
    },
  },
  {
    id: "entities",
    title: "Named entities",
    description:
      "All people and organizations mentioned in the thread. Vendor-flagged orgs also appear under Vendors & contracts for review.",
    appPages: [{ href: "/insights/queue", label: "Insights named entities" }],
    dbTables: ["entity_mentions"],
    fields: ["entities"],
  },
  {
    id: "skill",
    title: "Extraction skill learning",
    description:
      "Facts matched to learned concepts and proposals for new reusable extraction concepts.",
    appPages: [{ href: "/admin/concepts", label: "Concepts" }],
    dbTables: ["discovered_facts", "extraction_skill_entries"],
    fields: ["discovered_facts", "proposed_new_concepts"],
    fieldNotes: {
      proposed_new_concepts:
        "Merged into extraction_skill_entries when genuinely new; not a standalone fact table.",
    },
  },
];

const PERSISTED_FIELDS = new Set<string>([
  "equipment_mentions",
  "maintenance_events",
  "budget_line_items",
  "invoices",
  "contracts",
  "resident_issues",
  "capital_projects",
  "action_items",
  "entities",
  "discovered_facts",
  "meetings",
  "deadlines",
  "meeting_cancellations",
  "meeting_reschedules",
  "inspections",
]);

export function formatExtractionFieldKeyLabel(key: string): string {
  return ROUTE_LABELS[key] ?? key.replace(/_/g, " ");
}

export function isExtractionFieldPersisted(key: string): boolean {
  if (PERSISTED_FIELDS.has(key)) return true;
  if (key === "proposed_new_concepts") return true;
  return false;
}

export function getDestinationForField(key: string): ExtractionDestination | undefined {
  return EXTRACTION_DESTINATIONS.find((destination) =>
    destination.fields.includes(key),
  );
}

export function getAllRoutedFieldKeys(): string[] {
  return EXTRACTION_DESTINATIONS.flatMap((destination) => destination.fields);
}

export function getExtractionFieldMeta(key: string): ExtractionFieldMeta {
  const destination = getDestinationForField(key);
  return {
    key,
    label: formatExtractionFieldKeyLabel(key),
    destinationId: destination?.id ?? "unknown",
    persisted: isExtractionFieldPersisted(key),
  };
}

/** Maps persist.ts count keys and DB tables to destination ids for saved-row summaries. */
export const PERSISTED_TABLE_LABELS: Record<string, string> = {
  maintenance_events: "Maintenance events",
  equipment_mentions: "Equipment mentions",
  budget_line_items: "Budget line items",
  invoices: "Invoices",
  vendors: "Vendor upserts",
  contracts: "Contracts",
  resident_issues: "Resident issues",
  capital_projects: "Capital projects",
  action_items: "Action items",
  entities: "Entity mentions",
  calendar_events: "Calendar events",
  discovered_facts: "Discovered facts",
  meeting_cancellations: "Meeting cancellations processed",
  meeting_reschedules: "Meeting reschedules processed",
};
