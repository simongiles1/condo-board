import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  meetingsV2AgendaChunkSnapshots,
  meetingsV2AgendaItemContexts,
  meetingsV2AgendaItemInvestigations,
  meetingsV2AgendaItems,
  meetingsV2DocumentChunks,
  meetingsV2ValidationResults,
} from "@/lib/db/schema-v2";

export type PipelineTransitionStep = {
  id: string;
  label: string;
  subtitle?: string;
  noChange?: boolean;
  before?: unknown;
  after?: unknown;
  response?: unknown;
  delta?: PipelineTransitionDelta;
  data?: unknown;
};

export type PipelineTransitionDelta = {
  topicsBefore: number;
  topicsAfter: number;
  addedTitles: string[];
  removedTitles: string[];
  changedTitles: string[];
};

export type PipelineTransitionPhase = {
  key: "extract" | "agenda_items" | "evidence" | "investigate" | "validate";
  label: string;
  description: string;
  steps: PipelineTransitionStep[];
};

export type PipelineTransitionsPayload = {
  meetingId: string;
  phases: PipelineTransitionPhase[];
};

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function topicTitles(state: unknown): string[] {
  if (!state || typeof state !== "object") return [];
  const record = state as Record<string, unknown>;
  const documentTopics = Array.isArray(record.documentTopics) ? record.documentTopics : [];
  const extraTopics = Array.isArray(record.extraTopics) ? record.extraTopics : [];
  return [...documentTopics, ...extraTopics]
    .map((topic) => {
      if (!topic || typeof topic !== "object") return null;
      const title = (topic as Record<string, unknown>).title;
      return typeof title === "string" ? title.trim() : null;
    })
    .filter((title): title is string => Boolean(title));
}

function computeDelta(before: unknown, after: unknown): PipelineTransitionDelta {
  const beforeTitles = new Set(topicTitles(before));
  const afterTitles = new Set(topicTitles(after));
  const addedTitles = [...afterTitles].filter((title) => !beforeTitles.has(title));
  const removedTitles = [...beforeTitles].filter((title) => !afterTitles.has(title));
  const changedTitles = [...afterTitles].filter((title) => {
    if (!beforeTitles.has(title)) return false;
    return JSON.stringify(findTopic(before, title)) !== JSON.stringify(findTopic(after, title));
  });
  return {
    topicsBefore: beforeTitles.size,
    topicsAfter: afterTitles.size,
    addedTitles,
    removedTitles,
    changedTitles,
  };
}

function findTopic(state: unknown, title: string): unknown {
  if (!state || typeof state !== "object") return null;
  const record = state as Record<string, unknown>;
  const topics = [
    ...(Array.isArray(record.documentTopics) ? record.documentTopics : []),
    ...(Array.isArray(record.extraTopics) ? record.extraTopics : []),
  ];
  return topics.find((topic) => {
    if (!topic || typeof topic !== "object") return false;
    return (topic as Record<string, unknown>).title === title;
  }) ?? null;
}

function summarizeContextJson(contextJson: string): unknown {
  const parsed = safeJsonParse<Record<string, unknown> | null>(contextJson, null);
  if (!parsed) return null;
  const chunksById = parsed.chunksById;
  const chunkSummaries: Record<string, unknown> = {};
  if (chunksById && typeof chunksById === "object") {
    for (const [chunkId, chunk] of Object.entries(chunksById)) {
      if (!chunk || typeof chunk !== "object") continue;
      const entry = chunk as Record<string, unknown>;
      chunkSummaries[chunkId] = {
        chunkKind: entry.chunkKind ?? null,
        pageRange: entry.pageRange ?? null,
        sequenceRange: entry.sequenceRange ?? null,
        startTimestamp: entry.startTimestamp ?? null,
        endTimestamp: entry.endTimestamp ?? null,
        textPreview:
          typeof entry.text === "string"
            ? entry.text.slice(0, 240)
            : null,
      };
    }
  }
  return {
    agendaItemId: parsed.agendaItemId ?? null,
    title: parsed.title ?? null,
    sectionLabel: parsed.sectionLabel ?? null,
    itemType: parsed.itemType ?? null,
    sourcePages: parsed.sourcePages ?? [],
    sourceChunkIds: parsed.sourceChunkIds ?? [],
    sourceTranscriptRanges: parsed.sourceTranscriptRanges ?? [],
    aliases: parsed.aliases ?? [],
    notes: parsed.notes ?? [],
    anchorChunkIds: parsed.anchorChunkIds ?? [],
    buildNotes: parsed.buildNotes ?? [],
    chunksById: chunkSummaries,
  };
}

function buildExtractStepLabel(
  chunkKind: string,
  sortOrder: number,
  requestMeta: Record<string, unknown>,
): string {
  if (chunkKind === "document") {
    const pages = Array.isArray(requestMeta.pageNumbers) ? requestMeta.pageNumbers : [];
    const pageLabel = pages.length > 0 ? `pages ${pages.join(", ")}` : "document";
    return `Document chunk ${sortOrder + 1} (${pageLabel})`;
  }
  const range = Array.isArray(requestMeta.sequenceRange) ? requestMeta.sequenceRange : null;
  const rangeLabel =
    range && range.length === 2 ? `segments ${range[0]}-${range[1]}` : "transcript";
  return `Transcript chunk ${sortOrder + 1} (${rangeLabel})`;
}

export async function loadMeetingV2PipelineTransitions(
  meetingId: string,
): Promise<PipelineTransitionsPayload> {
  const db = getDb();

  const [snapshots, chunks, agendaItems, contexts, investigations, validations] =
    await Promise.all([
      db
        .select()
        .from(meetingsV2AgendaChunkSnapshots)
        .where(eq(meetingsV2AgendaChunkSnapshots.meetingV2Id, meetingId))
        .orderBy(asc(meetingsV2AgendaChunkSnapshots.sortOrder)),
      db
        .select({
          id: meetingsV2DocumentChunks.id,
          chunkKey: meetingsV2DocumentChunks.chunkKey,
        })
        .from(meetingsV2DocumentChunks)
        .where(eq(meetingsV2DocumentChunks.meetingV2Id, meetingId)),
      db
        .select()
        .from(meetingsV2AgendaItems)
        .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId))
        .orderBy(asc(meetingsV2AgendaItems.sortOrder)),
      db
        .select()
        .from(meetingsV2AgendaItemContexts)
        .where(eq(meetingsV2AgendaItemContexts.meetingV2Id, meetingId)),
      db
        .select()
        .from(meetingsV2AgendaItemInvestigations)
        .where(eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meetingId)),
      db
        .select()
        .from(meetingsV2ValidationResults)
        .where(eq(meetingsV2ValidationResults.meetingV2Id, meetingId)),
    ]);

  const chunkKeyById = new Map(chunks.map((chunk) => [chunk.id, chunk.chunkKey] as const));
  const agendaTitleById = new Map(agendaItems.map((item) => [item.id, item.title] as const));

  const extractSteps: PipelineTransitionStep[] = snapshots.map((snapshot) => {
    const requestMeta = safeJsonParse<Record<string, unknown>>(snapshot.requestJson, {});
    const before = safeJsonParse(snapshot.beforeStateJson, null);
    const after = safeJsonParse(snapshot.afterStateJson, null);
    const response = safeJsonParse(snapshot.parsedJson, null);
    const chunkKey = chunkKeyById.get(snapshot.chunkId) ?? null;
    return {
      id: snapshot.id,
      label: buildExtractStepLabel(
        snapshot.chunkKind,
        snapshot.sortOrder,
        requestMeta,
      ),
      subtitle: chunkKey ? `Chunk key: ${chunkKey}` : undefined,
      noChange: snapshot.noChange,
      before,
      after,
      response,
      delta: computeDelta(before, after),
    };
  });

  const agendaItemSteps: PipelineTransitionStep[] =
    agendaItems.length > 0
      ? [
          {
            id: "final-agenda-items",
            label: `Final agenda items (${agendaItems.length})`,
            subtitle: "Topics written to meetings_v2_agenda_items after extraction completes.",
            data: agendaItems.map((item) => ({
              id: item.id,
              sortOrder: item.sortOrder,
              title: item.title,
              sectionLabel: item.sectionLabel,
              itemType: item.itemType,
              sourcePages: safeJsonParse<number[]>(item.sourcePagesJson, []),
              sourceText: item.sourceText,
            })),
          },
        ]
      : [];

  const contextByAgendaId = new Map(
    contexts.map((context) => [context.agendaItemId, context] as const),
  );
  const evidenceSteps: PipelineTransitionStep[] = agendaItems
    .map((item) => {
      const context = contextByAgendaId.get(item.id);
      if (!context) return null;
      return {
        id: context.id,
        label: item.title,
        subtitle: item.sectionLabel ?? undefined,
        data: summarizeContextJson(context.contextJson),
      } satisfies PipelineTransitionStep;
    })
    .filter((step): step is PipelineTransitionStep => Boolean(step));

  const investigationByAgendaId = new Map(
    investigations.map((investigation) => [investigation.agendaItemId, investigation] as const),
  );
  const investigateSteps: PipelineTransitionStep[] = agendaItems
    .map((item) => {
      const investigation = investigationByAgendaId.get(item.id);
      if (!investigation) return null;
      return {
        id: investigation.id,
        label: item.title,
        subtitle: `${investigation.outcome} · ${investigation.confidence} confidence`,
        data: {
          discussionSummary: investigation.discussionSummary,
          outcome: investigation.outcome,
          confidence: investigation.confidence,
          visibility: investigation.visibility,
          decisions: safeJsonParse(investigation.decisionsJson, []),
          motion: safeJsonParse(investigation.motionJson, null),
          actions: safeJsonParse(investigation.actionsJson, []),
          openQuestions: safeJsonParse(investigation.openQuestionsJson, []),
          modelName: investigation.modelName,
        },
      } satisfies PipelineTransitionStep;
    })
    .filter((step): step is PipelineTransitionStep => Boolean(step));

  const validateSteps: PipelineTransitionStep[] =
    validations.length > 0
      ? [
          {
            id: "validation-results",
            label: `Validation findings (${validations.length})`,
            subtitle: "Per-agenda-item validator output from the validate stage.",
            data: validations.map((row) => ({
              agendaItemTitle: agendaTitleById.get(row.agendaItemId) ?? row.agendaItemId,
              validationType: row.validationType,
              severity: row.severity,
              code: row.code,
              message: row.message,
              details: safeJsonParse(row.detailsJson, null),
            })),
          },
        ]
      : [];

  const phases: PipelineTransitionPhase[] = [
    {
      key: "extract",
      label: "Extract",
      description:
        "Incremental DeepSeek extraction across board-package and transcript chunks. Each step shows cumulative topic state before and after the chunk.",
      steps: extractSteps,
    },
    {
      key: "agenda_items",
      label: "Agenda items",
      description:
        "Final extracted topics persisted as agenda rows, including provenance metadata embedded in source_text.",
      steps: agendaItemSteps,
    },
    {
      key: "evidence",
      label: "Evidence",
      description:
        "Context JSON assembled per agenda item before investigation — anchor chunks, transcript ranges, and build notes.",
      steps: evidenceSteps,
    },
    {
      key: "investigate",
      label: "Investigate",
      description:
        "Structured investigation output per agenda item — summary, outcome, decisions, and actions.",
      steps: investigateSteps,
    },
    {
      key: "validate",
      label: "Validate",
      description: "Validator findings raised during the validate stage.",
      steps: validateSteps,
    },
  ];

  return { meetingId, phases };
}
