import { RESOLVED_FACTS_MARKER } from "@/lib/meeting-v2/investigation-prompts";
import type {
  ItemDebugModelId,
  ItemDebugRun,
  ItemDebugRunStatus,
  ItemDebugStep,
  ItemDebugStepKey,
  ItemDebugStepStatus,
  ItemDebugUsage,
} from "@/lib/meeting-v2/item-debug-models";

export const ITEM_DEBUG_AGENT_BUNDLE_REF_HINTS = {
  evidence: "Top-level `evidence` object (sources, transcript cues, package context).",
  factRequest:
    "Facts step user input: `{ agenda: { title, itemNumber, itemType }, sources: evidence.sources }`.",
  investigationRequest:
    "Investigation user input: item metadata, `evidence.sources`, user clarifications, and `steps` entry with key `facts` parsedOutput.",
} as const;

export type ItemDebugAgentBundleRef = keyof typeof ITEM_DEBUG_AGENT_BUNDLE_REF_HINTS;

export type ItemDebugAgentBundleItem = {
  id: string;
  title: string;
  itemNumber: string | null;
  itemType: string;
  sectionLabel: string | null;
};

export type ItemDebugAgentBundleStep = {
  key: ItemDebugStepKey;
  status: ItemDebugStepStatus;
  modelId: ItemDebugModelId | null;
  thinking: boolean;
  systemPrompt?: string;
  userPromptRef?: ItemDebugAgentBundleRef;
  userPrompt?: string;
  parsedOutput?: unknown;
  usage: ItemDebugUsage | null;
  durationMs: number | null;
  error: string | null;
  ranAt: string | null;
};

export type ItemDebugAgentBundle = {
  schemaVersion: 2;
  exportedAt: string;
  meetingId: string;
  agendaItemId: string;
  item: ItemDebugAgentBundleItem;
  refHints: typeof ITEM_DEBUG_AGENT_BUNDLE_REF_HINTS;
  evidence: unknown;
  steps: ItemDebugAgentBundleStep[];
  run: {
    id: string;
    status: ItemDebugRunStatus;
    error: string | null;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    createdAt: string;
    updatedAt: string;
  };
};

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function jsonStableEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveEvidence(run: ItemDebugRun): unknown {
  const evidenceStep = run.steps.find((step) => step.key === "evidence");
  if (evidenceStep?.parsedOutput != null) return evidenceStep.parsedOutput;
  if (evidenceStep?.userPrompt) {
    const parsed = tryParseJson(evidenceStep.userPrompt);
    if (parsed !== null) return parsed;
  }
  return null;
}

function factRequestPayload(
  item: ItemDebugAgentBundleItem,
  evidence: unknown,
): { agenda: { title: string; itemNumber: string | null; itemType: string }; sources: unknown } {
  const sources =
    evidence && typeof evidence === "object" && "sources" in evidence
      ? (evidence as { sources: unknown }).sources
      : [];
  return {
    agenda: {
      title: item.title,
      itemNumber: item.itemNumber,
      itemType: item.itemType,
    },
    sources,
  };
}

function evidenceUserPromptMatches(evidence: unknown, userPrompt: string): boolean {
  const parsed = tryParseJson(userPrompt);
  return parsed !== null && jsonStableEqual(parsed, evidence);
}

function factRequestUserPromptMatches(
  item: ItemDebugAgentBundleItem,
  evidence: unknown,
  userPrompt: string,
): boolean {
  const parsed = tryParseJson(userPrompt);
  if (parsed === null) return false;
  return jsonStableEqual(parsed, factRequestPayload(item, evidence));
}

function evidenceSources(evidence: unknown): unknown {
  if (!evidence || typeof evidence !== "object" || !("sources" in evidence)) return [];
  return (evidence as { sources: unknown }).sources;
}

function extractInvestigationSourcesFromPrompt(userPrompt: string): unknown | null {
  const marker =
    "Prepared evidence (direct, neighboring, and related sources are explicitly labeled)";
  const idx = userPrompt.indexOf(marker);
  if (idx < 0) return null;
  const rest = userPrompt.slice(idx + marker.length).trim();
  const jsonStart = rest.indexOf("[");
  if (jsonStart < 0) return null;
  const endMarker = "\n\nAdditional user clarification";
  const end = rest.indexOf(endMarker);
  if (end <= jsonStart) return null;
  return tryParseJson(rest.slice(jsonStart, end).trim());
}

function extractInvestigationFactsFromPrompt(userPrompt: string): unknown | null {
  const markers = [
    RESOLVED_FACTS_MARKER,
    "Resolved facts (preserve temporal scope and rejected alternatives):",
  ];
  const marker = markers.find((candidate) => userPrompt.includes(candidate));
  if (!marker) return null;
  const idx = userPrompt.indexOf(marker);
  if (idx < 0) return null;
  const rest = userPrompt.slice(idx + marker.length).trim();
  const jsonStart = rest.indexOf("{");
  if (jsonStart < 0) return null;
  return tryParseJson(rest.slice(jsonStart));
}

function investigationUserPromptMatches(
  userPrompt: string,
  evidence: unknown,
  factsParsed: unknown,
): boolean {
  const sources = extractInvestigationSourcesFromPrompt(userPrompt);
  const facts = extractInvestigationFactsFromPrompt(userPrompt);
  if (sources === null || facts === null) return false;
  return (
    jsonStableEqual(sources, evidenceSources(evidence)) &&
    jsonStableEqual(facts, factsParsed ?? { facts: [], unresolvedQuestions: [] })
  );
}

function compactStepExport(
  step: ItemDebugStep,
  item: ItemDebugAgentBundleItem,
  evidence: unknown,
  factsParsed: unknown,
): ItemDebugAgentBundleStep {
  const base: ItemDebugAgentBundleStep = {
    key: step.key,
    status: step.status,
    modelId: step.modelId,
    thinking: step.thinking,
    usage: step.usage,
    durationMs: step.durationMs,
    error: step.error,
    ranAt: step.ranAt,
  };

  if (step.status === "idle") {
    return base;
  }

  base.systemPrompt = step.systemPrompt;

  if (step.key === "evidence") {
    base.userPromptRef = "evidence";
    if (!evidenceUserPromptMatches(evidence, step.userPrompt)) {
      base.userPrompt = step.userPrompt;
    }
    return base;
  }

  if (step.key === "facts") {
    if (factRequestUserPromptMatches(item, evidence, step.userPrompt)) {
      base.userPromptRef = "factRequest";
    } else {
      base.userPrompt = step.userPrompt;
    }
    if (step.parsedOutput != null) {
      base.parsedOutput = step.parsedOutput;
    }
    return base;
  }

  if (step.key === "investigate") {
    base.userPromptRef = "investigationRequest";
    if (!investigationUserPromptMatches(step.userPrompt, evidence, factsParsed)) {
      base.userPrompt = step.userPrompt;
    }
    if (step.parsedOutput != null) {
      base.parsedOutput = step.parsedOutput;
    }
    return base;
  }

  if (step.userPrompt.trim()) {
    base.userPrompt = step.userPrompt;
  }
  if (step.parsedOutput != null) {
    base.parsedOutput = step.parsedOutput;
  }
  return base;
}

export function buildItemDebugAgentBundleFromRun(params: {
  meetingId: string;
  agendaItemId: string;
  item: ItemDebugAgentBundleItem;
  run: ItemDebugRun;
  exportedAt?: string;
}): ItemDebugAgentBundle {
  const evidence = resolveEvidence(params.run);
  const factsParsed = params.run.steps.find((step) => step.key === "facts")?.parsedOutput ?? null;
  return {
    schemaVersion: 2,
    exportedAt: params.exportedAt ?? new Date().toISOString(),
    meetingId: params.meetingId,
    agendaItemId: params.agendaItemId,
    item: params.item,
    refHints: ITEM_DEBUG_AGENT_BUNDLE_REF_HINTS,
    evidence,
    steps: params.run.steps.map((step) =>
      compactStepExport(step, params.item, evidence, factsParsed),
    ),
    run: {
      id: params.run.id,
      status: params.run.status,
      error: params.run.error,
      totalInputTokens: params.run.totalInputTokens,
      totalOutputTokens: params.run.totalOutputTokens,
      totalCostUsd: params.run.totalCostUsd,
      createdAt: params.run.createdAt,
      updatedAt: params.run.updatedAt,
    },
  };
}
