import {
  EXTRACTION_DESTINATIONS,
  type ExtractionDestination,
} from "@/lib/email/extraction-routing";

/** Default — facts stay in discovered_facts / skill audit only. */
export const SKILL_ONLY_DESTINATION_ID = "skill_only";

export type ConceptFieldMapping = {
  date?: string;
  title?: string;
  description?: string;
};

export type ConceptRoutingConfig = {
  destinationId: string;
  fieldMapping: ConceptFieldMapping;
  options: Record<string, unknown>;
  configuredAt: string | null;
};

export type RoutableConceptDestination = {
  id: string;
  title: string;
  description: string;
  appPages: ExtractionDestination["appPages"];
  previewSupported: boolean;
  /** Phase 2 — auto-promote facts into destination tables. */
  executionSupported: boolean;
  executionNote?: string;
};

export type DiscoveredFactPayload = {
  id: string;
  payload: Record<string, unknown>;
  sourceQuote: string | null;
  confidence: string | null;
  createdAt: string;
};

export type FactRoutingTransparency = {
  factId: string;
  currentStorage: "discovered_facts";
  configuredDestinationId: string;
  configuredDestinationTitle: string;
  promoted: boolean;
  promotionNote: string;
};

export type FactPromotionPreview = {
  factId: string;
  promotable: boolean;
  reason: string;
  proposedTitle?: string;
  proposedDate?: string;
  proposedDescription?: string;
};

export type ConceptRoutingPreview = {
  destinationId: string;
  destinationTitle: string;
  previewSupported: boolean;
  executionSupported: boolean;
  fieldMapping: ConceptFieldMapping;
  inferredFieldMapping: ConceptFieldMapping;
  totalFacts: number;
  promotableCount: number;
  blockedCount: number;
  facts: Array<
    FactRoutingTransparency &
      FactPromotionPreview & {
        payload: Record<string, unknown>;
        sourceQuote: string | null;
        confidence: string | null;
        createdAt: string;
      }
  >;
};

const DATE_FIELD_CANDIDATES = [
  "date",
  "effective_date",
  "start_date",
  "occurred_at",
  "occurred_on",
  "event_date",
  "promotion_date",
  "change_date",
  "meeting_date",
];

const TITLE_FIELD_CANDIDATES = [
  "title",
  "name",
  "person_name",
  "employee_name",
  "subject",
  "summary",
  "label",
  "role",
  "description",
];

const DESCRIPTION_FIELD_CANDIDATES = [
  "description",
  "role",
  "change_type",
  "details",
  "notes",
  "context",
];

const ROUTABLE_DESTINATION_IDS = [
  "calendar",
  "maintenance",
  "action_items",
  "financial",
  "vendors",
  "capital",
  "resident",
  "governance",
  "entities",
] as const;

function destinationById(id: string): ExtractionDestination | undefined {
  return EXTRACTION_DESTINATIONS.find((destination) => destination.id === id);
}

export function getRoutableConceptDestinations(): RoutableConceptDestination[] {
  const skillOnly: RoutableConceptDestination = {
    id: SKILL_ONLY_DESTINATION_ID,
    title: "Skill only",
    description:
      "Facts are stored for audit and future extraction prompts. They are not promoted elsewhere.",
    appPages: [{ href: "/admin/concepts", label: "Concepts" }],
    previewSupported: true,
    executionSupported: true,
  };

  const routed = ROUTABLE_DESTINATION_IDS.map((id): RoutableConceptDestination => {
    const destination = destinationById(id);
    const hasPersistTables = Boolean(destination?.dbTables.length);
    return {
      id,
      title: destination?.title ?? id,
      description: destination?.description ?? "",
      appPages: destination?.appPages ?? [],
      previewSupported: id === "calendar",
      executionSupported: false,
      executionNote: hasPersistTables
        ? "Intent can be saved now. Automatic promotion arrives in a later phase."
        : "Destination tables are not wired yet. Intent is recorded for transparency.",
    };
  });

  return [skillOnly, ...routed];
}

export function getRoutableDestination(
  id: string,
): RoutableConceptDestination | undefined {
  return getRoutableConceptDestinations().find((destination) => destination.id === id);
}

export function parseConceptRoutingConfig(input: {
  routingDestinationId?: string | null;
  fieldMappingJson?: string | null;
  routingOptionsJson?: string | null;
  routingConfiguredAt?: string | null;
}): ConceptRoutingConfig {
  const destinationId =
    input.routingDestinationId?.trim() || SKILL_ONLY_DESTINATION_ID;

  return {
    destinationId,
    fieldMapping: parseJsonObject<ConceptFieldMapping>(input.fieldMappingJson),
    options: parseJsonObject<Record<string, unknown>>(input.routingOptionsJson),
    configuredAt: input.routingConfiguredAt ?? null,
  };
}

function parseJsonObject<T extends Record<string, unknown>>(
  value: string | null | undefined,
): T {
  if (!value) return {} as T;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : ({} as T);
  } catch {
    return {} as T;
  }
}

function fieldString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function payloadFieldNames(payloads: Record<string, unknown>[]): string[] {
  const names = new Set<string>();
  for (const payload of payloads) {
    for (const key of Object.keys(payload)) {
      names.add(key);
    }
  }
  return [...names];
}

function pickField(
  candidates: string[],
  available: string[],
  suggested: string[],
): string | undefined {
  for (const name of candidates) {
    if (available.includes(name)) return name;
  }
  for (const name of suggested) {
    const normalized = name.toLowerCase();
    if (
      candidates.some((candidate) => normalized.includes(candidate)) &&
      available.includes(name)
    ) {
      return name;
    }
  }
  return undefined;
}

export function inferConceptFieldMapping(input: {
  suggestedFieldNames: string[];
  payloads: Record<string, unknown>[];
  existingMapping?: ConceptFieldMapping;
}): ConceptFieldMapping {
  const available = payloadFieldNames(input.payloads);
  const suggested = input.suggestedFieldNames.map((name) => name.trim()).filter(Boolean);

  return {
    date:
      input.existingMapping?.date ??
      pickField(DATE_FIELD_CANDIDATES, available, suggested),
    title:
      input.existingMapping?.title ??
      pickField(TITLE_FIELD_CANDIDATES, available, suggested),
    description:
      input.existingMapping?.description ??
      pickField(DESCRIPTION_FIELD_CANDIDATES, available, suggested),
  };
}

function resolveConfiguredDestinationTitle(destinationId: string): string {
  return getRoutableDestination(destinationId)?.title ?? destinationId;
}

function buildTransparency(input: {
  factId: string;
  destinationId: string;
  promotable: boolean;
  reason: string;
}): Pick<
  FactRoutingTransparency,
  "currentStorage" | "configuredDestinationId" | "configuredDestinationTitle" | "promoted" | "promotionNote"
> {
  const destinationTitle = resolveConfiguredDestinationTitle(input.destinationId);

  if (input.destinationId === SKILL_ONLY_DESTINATION_ID) {
    return {
      currentStorage: "discovered_facts",
      configuredDestinationId: SKILL_ONLY_DESTINATION_ID,
      configuredDestinationTitle: destinationTitle,
      promoted: false,
      promotionNote:
        "Stored in discovered_facts only. No destination routing configured.",
    };
  }

  return {
    currentStorage: "discovered_facts",
    configuredDestinationId: input.destinationId,
    configuredDestinationTitle: destinationTitle,
    promoted: false,
    promotionNote: input.promotable
      ? `Would promote to ${destinationTitle} when execution is enabled. ${input.reason}`
      : `Configured for ${destinationTitle}, but not promotable yet. ${input.reason}`,
  };
}

function previewCalendarFact(input: {
  fact: DiscoveredFactPayload;
  conceptName: string;
  fieldMapping: ConceptFieldMapping;
}): FactPromotionPreview {
  const dateField = input.fieldMapping.date;
  const titleField = input.fieldMapping.title;
  const descriptionField = input.fieldMapping.description;

  const proposedDate = dateField
    ? fieldString(input.fact.payload[dateField])
    : undefined;
  const proposedTitle =
    (titleField ? fieldString(input.fact.payload[titleField]) : undefined) ??
    fieldString(input.fact.payload.title) ??
    fieldString(input.fact.payload.name) ??
    input.conceptName;
  const proposedDescription = descriptionField
    ? fieldString(input.fact.payload[descriptionField])
    : input.fact.sourceQuote ?? undefined;

  if (!dateField) {
    return {
      factId: input.fact.id,
      promotable: false,
      reason: "No date field mapped for this concept.",
      proposedTitle,
      proposedDescription,
    };
  }

  if (!proposedDate) {
    return {
      factId: input.fact.id,
      promotable: false,
      reason: `Mapped date field "${dateField}" is empty on this fact.`,
      proposedTitle,
      proposedDescription,
    };
  }

  if (!/^\d{4}-\d{2}-\d{2}/.test(proposedDate)) {
    return {
      factId: input.fact.id,
      promotable: false,
      reason: `Date value "${proposedDate}" is not ISO format (YYYY-MM-DD).`,
      proposedTitle,
      proposedDate,
      proposedDescription,
    };
  }

  return {
    factId: input.fact.id,
    promotable: true,
    reason: "Ready for calendar promotion preview.",
    proposedTitle,
    proposedDate: proposedDate.slice(0, 10),
    proposedDescription,
  };
}

function previewSkillOnlyFact(fact: DiscoveredFactPayload): FactPromotionPreview {
  return {
    factId: fact.id,
    promotable: false,
    reason: "Skill-only routing — fact stays in discovered_facts.",
  };
}

function previewGenericDestinationFact(input: {
  fact: DiscoveredFactPayload;
  destinationId: string;
}): FactPromotionPreview {
  const destination = getRoutableDestination(input.destinationId);
  return {
    factId: input.fact.id,
    promotable: false,
    reason: destination?.previewSupported
      ? "Preview not available for this destination yet."
      : `Intent saved for ${destination?.title ?? input.destinationId}. Detailed preview arrives in a later phase.`,
  };
}

export function buildConceptRoutingPreview(input: {
  conceptName: string;
  config: ConceptRoutingConfig;
  suggestedFieldNames: string[];
  facts: DiscoveredFactPayload[];
}): ConceptRoutingPreview {
  const destination =
    getRoutableDestination(input.config.destinationId) ??
    getRoutableDestination(SKILL_ONLY_DESTINATION_ID)!;

  const payloads = input.facts.map((fact) => fact.payload);
  const inferredFieldMapping = inferConceptFieldMapping({
    suggestedFieldNames: input.suggestedFieldNames,
    payloads,
    existingMapping: input.config.fieldMapping,
  });

  const effectiveMapping =
    input.config.destinationId === "calendar"
      ? {
          ...inferredFieldMapping,
          ...input.config.fieldMapping,
        }
      : input.config.fieldMapping;

  const facts = input.facts.map((fact) => {
    let preview: FactPromotionPreview;

    if (input.config.destinationId === SKILL_ONLY_DESTINATION_ID) {
      preview = previewSkillOnlyFact(fact);
    } else if (input.config.destinationId === "calendar") {
      preview = previewCalendarFact({
        fact,
        conceptName: input.conceptName,
        fieldMapping: effectiveMapping,
      });
    } else {
      preview = previewGenericDestinationFact({
        fact,
        destinationId: input.config.destinationId,
      });
    }

    const transparency = buildTransparency({
      factId: fact.id,
      destinationId: input.config.destinationId,
      promotable: preview.promotable,
      reason: preview.reason,
    });

    return {
      ...fact,
      ...preview,
      ...transparency,
    };
  });

  const promotableCount = facts.filter((fact) => fact.promotable).length;

  return {
    destinationId: input.config.destinationId,
    destinationTitle: destination.title,
    previewSupported: destination.previewSupported,
    executionSupported: destination.executionSupported,
    fieldMapping: input.config.fieldMapping,
    inferredFieldMapping,
    totalFacts: facts.length,
    promotableCount,
    blockedCount: facts.length - promotableCount,
    facts,
  };
}

export function serializeConceptRoutingPatch(input: {
  destinationId: string;
  fieldMapping?: ConceptFieldMapping;
  options?: Record<string, unknown>;
}): {
  routingDestinationId: string | null;
  fieldMappingJson: string;
  routingOptionsJson: string;
  routingConfiguredAt: string;
} {
  const destinationId =
    input.destinationId === SKILL_ONLY_DESTINATION_ID
      ? null
      : input.destinationId.trim();

  return {
    routingDestinationId: destinationId,
    fieldMappingJson: JSON.stringify(input.fieldMapping ?? {}),
    routingOptionsJson: JSON.stringify(input.options ?? {}),
    routingConfiguredAt: new Date().toISOString(),
  };
}
