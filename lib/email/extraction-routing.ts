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
    appPages: [{ href: "/emails", label: "Emails inbox badges" }],
    dbTables: [],
    fields: ["document_type", "summary", "urgency", "tags"],
  },
  {
    id: "calendar",
    title: "Calendar",
    description:
      "Confirmed meetings, hard external deadlines, and dated maintenance work.",
    appPages: [{ href: "/calendar", label: "Calendar" }],
    dbTables: ["calendar_events"],
    fields: ["meetings", "deadlines", "meeting_cancellations"],
    fieldNotes: {
      meeting_cancellations:
        "Does not insert rows — removes matching meeting events from calendar_events.",
    },
  },
  {
    id: "action_items",
    title: "Action items (email tasks)",
    description:
      "Internal asks, requests, and follow-ups. These are not meeting to-dos and are not added to the global to-do list.",
    appPages: [
      { href: "/", label: "Dashboard task radar" },
      { href: "/insights", label: "Insights" },
    ],
    dbTables: ["extracted_action_items"],
    fields: ["action_items"],
    fieldNotes: {
      action_items:
        "Distinct from meeting To-dos (/todos) and global todos. Soft deadlines on action items are not promoted to the calendar.",
    },
  },
  {
    id: "maintenance",
    title: "Maintenance & equipment",
    description: "Equipment registry and maintenance history for building insights.",
    appPages: [{ href: "/insights", label: "Insights equipment timeline" }],
    dbTables: ["maintenance_events", "equipment_assets", "calendar_events"],
    fields: ["maintenance_events", "equipment_mentions"],
    fieldNotes: {
      maintenance_events:
        "Saved to maintenance_events. Also creates a calendar_events row when a date is present.",
      equipment_mentions:
        "Not saved on its own — equipment names are upserted when maintenance_events are persisted.",
    },
  },
  {
    id: "financial",
    title: "Financial records",
    description: "Budget figures and invoices extracted from email and attachments.",
    appPages: [{ href: "/insights", label: "Insights budget charts" }],
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
    appPages: [{ href: "/insights", label: "Insights vendors" }],
    dbTables: ["vendors", "contracts"],
    fields: ["vendors", "contracts"],
    fieldNotes: {
      vendors:
        "Upserted into a shared vendor directory by name (not tied to a single email row).",
    },
  },
  {
    id: "capital",
    title: "Capital projects",
    description: "Major building projects and their phases.",
    appPages: [{ href: "/building", label: "Building" }],
    dbTables: ["capital_projects"],
    fields: ["capital_projects"],
  },
  {
    id: "resident",
    title: "Resident issues",
    description: "Unit-level complaints, requests, and resolutions.",
    appPages: [{ href: "/building", label: "Building" }],
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
    fields: ["motions", "board_changes", "inspections", "permits"],
    fieldNotes: {
      motions: "Extracted only — not persisted to a dedicated table yet.",
      board_changes: "Extracted only — not persisted to a dedicated table yet.",
      inspections: "Extracted only — not persisted to a dedicated table yet.",
      permits: "Extracted only — not persisted to a dedicated table yet.",
    },
  },
  {
    id: "entities",
    title: "Named entities",
    description: "People, organizations, and other entities mentioned in context.",
    appPages: [{ href: "/insights", label: "Insights" }],
    dbTables: ["entity_mentions"],
    fields: ["entities"],
  },
  {
    id: "skill",
    title: "Extraction skill learning",
    description:
      "Facts matched to learned concepts and proposals for new reusable extraction concepts.",
    appPages: [{ href: "/skill", label: "Skill" }],
    dbTables: ["discovered_facts", "extraction_skill_entries"],
    fields: ["discovered_facts", "proposed_new_concepts"],
    fieldNotes: {
      proposed_new_concepts:
        "Merged into extraction_skill_entries when genuinely new; not a standalone fact table.",
    },
  },
];

const PERSISTED_FIELDS = new Set<string>([
  "maintenance_events",
  "budget_line_items",
  "invoices",
  "vendors",
  "contracts",
  "resident_issues",
  "capital_projects",
  "action_items",
  "entities",
  "discovered_facts",
  "meetings",
  "deadlines",
  "meeting_cancellations",
]);

/** maintenance_events and equipment_mentions partially persist via maintenance_events path. */
const PARTIALLY_PERSISTED_FIELDS = new Set<string>(["equipment_mentions"]);

export function formatExtractionFieldKeyLabel(key: string): string {
  return ROUTE_LABELS[key] ?? key.replace(/_/g, " ");
}

export function isExtractionFieldPersisted(key: string): boolean {
  if (PERSISTED_FIELDS.has(key)) return true;
  if (PARTIALLY_PERSISTED_FIELDS.has(key)) return false;
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
};
