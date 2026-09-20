import { randomUUID } from "crypto";

import { and, asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  meetingsV2,
  meetingsV2AgendaItemContexts,
  meetingsV2AgendaItemEvidence,
  meetingsV2AgendaItems,
  meetingsV2DocumentChunks,
  meetingsV2DocumentPages,
  meetingsV2ItemDebugRuns,
  meetingsV2TranscriptSegments,
} from "@/lib/db/schema";
import { generateGeminiStructuredJson } from "@/lib/gemini/client";
import type { TokenUsage } from "@/lib/gemini/usage";
import { buildMeetingFrame } from "@/lib/meeting-v2/draft-builder";
import {
  FACT_RESOLUTION_PROMPT,
  type EvidenceSource,
  type FactResolution,
} from "@/lib/meeting-v2/evidence-contract";
import { resolveAgendaFacts } from "@/lib/meeting-v2/fact-resolution";
import { parseInvestigation, type InvestigationDocument } from "@/lib/meeting-v2/investigation-contract";
import { AGENDA_ITEM_INVESTIGATION_PROMPT } from "@/lib/meeting-v2/investigation-prompts";
import {
  loadInvestigationToolRuntime,
  runToolEnabledInvestigation,
} from "@/lib/meeting-v2/investigation-tools";
import {
  ITEM_DEBUG_MODELS,
  ITEM_DEBUG_STEPS,
  emptyItemDebugUsage,
  isItemDebugModelId,
  isItemDebugStepKey,
  itemDebugStepMeta,
  missingPrerequisite,
  recomputeItemDebugRunTotals,
  summarizeItemDebugRun,
  type ItemDebugModelId,
  type ItemDebugRun,
  type ItemDebugRunSummary,
  type ItemDebugStep,
  type ItemDebugStepKey,
} from "@/lib/meeting-v2/item-debug-models";
import { estimateSegmentCompareCostUsd, segmentCompareModel } from "@/lib/meeting-v2/segment-compare-models";
import {
  createSegmentationJsonFn,
  thinkingAwareMaxOutputTokens,
} from "@/lib/meeting-v2/segment-json";
import { AGENDA_ITEM_VALIDATION_PROMPT } from "@/lib/meeting-v2/validation-prompts";

const DEFAULT_MODEL_ID: ItemDebugModelId = "deepseek-v4-flash";

function nowIso(): string {
  return new Date().toISOString();
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Expected a JSON object.");
  return JSON.parse(trimmed.slice(start, end + 1));
}

function parseStoredRun(row: typeof meetingsV2ItemDebugRuns.$inferSelect): ItemDebugRun {
  const steps = Array.isArray(row.stepsJson) ? (row.stepsJson as ItemDebugStep[]) : [];
  return {
    id: row.id,
    meetingId: row.meetingV2Id,
    agendaItemId: row.agendaItemId,
    status: row.status,
    error: row.error,
    steps,
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    totalCostUsd: Number(row.totalCostUsd) || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function persistRun(run: ItemDebugRun): Promise<ItemDebugRun> {
  const db = getDb();
  const totals = recomputeItemDebugRunTotals(run.steps);
  const next: ItemDebugRun = {
    ...run,
    ...totals,
    updatedAt: nowIso(),
  };
  await db
    .update(meetingsV2ItemDebugRuns)
    .set({
      status: next.status,
      error: next.error,
      stepsJson: next.steps,
      totalInputTokens: next.totalInputTokens,
      totalOutputTokens: next.totalOutputTokens,
      totalCostUsd: String(next.totalCostUsd),
      updatedAt: next.updatedAt,
    })
    .where(eq(meetingsV2ItemDebugRuns.id, next.id));
  return next;
}

type PreparedContext = {
  sources?: EvidenceSource[];
  fingerprint?: string;
  pipelineVersion?: string;
  sourcePages?: number[];
  sourceChunkIds?: string[];
  sourceTranscriptRanges?: Array<[number, number]>;
  aliases?: string[];
  notes?: string[];
  buildNotes?: string[];
};

export type ItemDebugWorkspace = {
  item: {
    id: string;
    title: string;
    itemNumber: string | null;
    itemType: string;
    sectionLabel: string | null;
  };
  models: typeof ITEM_DEBUG_MODELS;
  steps: typeof ITEM_DEBUG_STEPS;
  runs: ItemDebugRunSummary[];
};

async function loadAgendaItem(meetingId: string, agendaItemId: string) {
  const db = getDb();
  const [item] = await db
    .select()
    .from(meetingsV2AgendaItems)
    .where(
      and(
        eq(meetingsV2AgendaItems.meetingV2Id, meetingId),
        eq(meetingsV2AgendaItems.id, agendaItemId),
      ),
    );
  if (!item) throw new Error("Agenda item was not found.");
  return item;
}

async function loadPreparedBundle(meetingId: string, agendaItemId: string) {
  const db = getDb();
  const [item, contextRow, evidenceRows, meetingRec, pages, chunks, transcriptSegments] =
    await Promise.all([
      loadAgendaItem(meetingId, agendaItemId),
      db.query.meetingsV2AgendaItemContexts.findFirst({
        where: and(
          eq(meetingsV2AgendaItemContexts.meetingV2Id, meetingId),
          eq(meetingsV2AgendaItemContexts.agendaItemId, agendaItemId),
        ),
      }),
      db
        .select()
        .from(meetingsV2AgendaItemEvidence)
        .where(
          and(
            eq(meetingsV2AgendaItemEvidence.meetingV2Id, meetingId),
            eq(meetingsV2AgendaItemEvidence.agendaItemId, agendaItemId),
          ),
        ),
      db.query.meetingsV2.findFirst({ where: eq(meetingsV2.id, meetingId) }),
      db
        .select()
        .from(meetingsV2DocumentPages)
        .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId))
        .orderBy(asc(meetingsV2DocumentPages.pageNumber)),
      db
        .select()
        .from(meetingsV2DocumentChunks)
        .where(eq(meetingsV2DocumentChunks.meetingV2Id, meetingId))
        .orderBy(asc(meetingsV2DocumentChunks.sortOrder)),
      db
        .select()
        .from(meetingsV2TranscriptSegments)
        .where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId))
        .orderBy(asc(meetingsV2TranscriptSegments.sequence)),
    ]);

  if (!meetingRec) throw new Error("Meeting was not found.");

  const meetingSettings =
    (meetingRec.settings as {
      userClarifications?: Record<string, Record<string, string>>;
      segmentGoldStandard?: { spans?: Array<{ agendaItemId: string }> };
    } | null) ?? {};
  const goldSpans = meetingSettings.segmentGoldStandard?.spans;
  const isGoldStandard = Array.isArray(goldSpans) && goldSpans.some((s) => s.agendaItemId === agendaItemId);

  const prepared = safeJsonParse<PreparedContext | null>(contextRow?.contextJson, null);
  let sources: EvidenceSource[] = Array.isArray(prepared?.sources) ? prepared.sources : [];
  if (isGoldStandard) {
    sources = sources.filter((s) => s.kind !== "transcript" || s.association === "direct");
  }
  const ranges = prepared?.sourceTranscriptRanges ?? [];
  const transcriptCues = transcriptSegments.filter((segment) =>
    ranges.some(([start, end]) => segment.sequence >= start && segment.sequence <= end),
  );

  const sourcePages = safeJsonParse<number[]>(item.sourcePagesJson, []);
  let packagePages = pages
    .filter((page) => sourcePages.includes(page.pageNumber))
    .map((page) => ({
      pageNumber: page.pageNumber,
      pageHeading: page.pageHeading,
      extractedText: page.extractedText,
    }));
  if (packagePages.length === 0 && sourcePages.length > 0) {
    const docChunks = chunks.filter(
      (c) =>
        c.chunkKind === "document" &&
        c.pageRange?.some((p) => sourcePages.includes(p)),
    );
    if (docChunks.length > 0) {
      packagePages = docChunks.map((c) => ({
        pageNumber: c.pageRange?.[0] ?? 0,
        pageHeading: c.chunkLabel ?? `Chunk ${c.chunkId}`,
        extractedText: c.text,
      }));
    }
  }

  const frame = buildMeetingFrame(meetingRec, pages, chunks);
  const directorsPromptLines = frame.attendanceCandidates.present.map(
    (director) => `- ${director.name} (${director.title_or_role})`,
  );
  const userAnswers = meetingSettings.userClarifications?.[agendaItemId] ?? {};
  const answerText = Object.values(userAnswers).filter(Boolean).join("\n").trim() || null;

  return {
    item,
    contextRow,
    prepared,
    sources,
    packagePages,
    isGoldStandard,
    evidenceRows,
    transcriptCues,
    directorsPromptLines,
    userAnswers,
    answerText,
    assembledContextText: contextRow?.assembledContextText ?? null,
  };
}

function investigationUserPrompt(options: {
  item: typeof meetingsV2AgendaItems.$inferSelect;
  directorsPromptLines: string[];
  sources: EvidenceSource[];
  answerText: string | null;
  facts: FactResolution | null;
}): string {
  return [
    `Agenda item title: ${options.item.title}`,
    `Item number: ${options.item.itemNumber ?? "Unknown"}`,
    `Item type: ${options.item.itemType}`,
    `Section label: ${options.item.sectionLabel ?? "Unknown"}`,
    "",
    "Attending Voting Directors:",
    ...(options.directorsPromptLines.length ? options.directorsPromptLines : ["- None listed"]),
    "",
    "Prepared evidence (direct, neighboring, and related sources are explicitly labeled)",
    JSON.stringify(options.sources, null, 2),
    "",
    "Additional user clarification",
    options.answerText ?? "None",
    "",
    "Resolved facts (preserve temporal scope and rejected alternatives):",
    JSON.stringify(options.facts ?? { facts: [], unresolvedQuestions: [] }, null, 2),
  ].join("\n");
}

function seedSteps(
  prompts: Record<ItemDebugStepKey, { systemPrompt: string; userPrompt: string }>,
): ItemDebugStep[] {
  return ITEM_DEBUG_STEPS.map((meta) => ({
    key: meta.key,
    status: "idle",
    modelId: meta.kind === "llm" ? DEFAULT_MODEL_ID : null,
    thinking: false,
    systemPrompt: prompts[meta.key].systemPrompt,
    userPrompt: prompts[meta.key].userPrompt,
    outputText: null,
    parsedOutput: null,
    usage: meta.kind === "llm" ? emptyItemDebugUsage(DEFAULT_MODEL_ID, false) : null,
    durationMs: null,
    error: null,
    ranAt: null,
  }));
}

async function buildDefaultPrompts(meetingId: string, agendaItemId: string) {
  const bundle = await loadPreparedBundle(meetingId, agendaItemId);
  const evidencePayload = {
    agendaItem: {
      id: bundle.item.id,
      title: bundle.item.title,
      itemNumber: bundle.item.itemNumber,
      itemType: bundle.item.itemType,
      sectionLabel: bundle.item.sectionLabel,
      sourcePages: safeJsonParse<number[]>(bundle.item.sourcePagesJson, []),
      sourceText: bundle.item.sourceText,
    },
    context: {
      fingerprint: bundle.prepared?.fingerprint ?? null,
      pipelineVersion: bundle.prepared?.pipelineVersion ?? null,
      sourceTranscriptRanges: bundle.prepared?.sourceTranscriptRanges ?? [],
      sourceChunkIds: bundle.prepared?.sourceChunkIds ?? [],
      aliases: bundle.prepared?.aliases ?? [],
      notes: bundle.prepared?.notes ?? [],
      buildNotes: bundle.prepared?.buildNotes ?? [],
      assembledContextText: bundle.assembledContextText,
    },
    sources: bundle.sources,
    packagePages: bundle.packagePages,
    isGoldStandard: bundle.isGoldStandard,
    transcriptCues: bundle.transcriptCues.map((cue) => ({
      sequence: cue.sequence,
      startTimestamp: cue.startTimestamp,
      endTimestamp: cue.endTimestamp,
      speakerLabel: cue.speakerLabel,
      text: cue.text,
    })),
    evidenceRows: bundle.evidenceRows.map((row) => ({
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      rationale: row.rationale,
      snippet: row.snippet,
    })),
    note: bundle.sources.length
      ? "Sandbox only. This does not rewrite production evidence rows."
      : "No prepared evidence context is stored for this item yet. Run evidence gathering in the main pipeline first.",
  };

  const factRequest = {
    agenda: {
      title: bundle.item.title,
      itemNumber: bundle.item.itemNumber,
      itemType: bundle.item.itemType,
    },
    sources: bundle.sources,
  };

  return {
    prompts: {
      evidence: {
        systemPrompt:
          "Deterministic evidence load. No model is called. Review the assembled transcript and package sources for this agenda item.",
        userPrompt: JSON.stringify(evidencePayload, null, 2),
      },
      facts: {
        systemPrompt: FACT_RESOLUTION_PROMPT,
        userPrompt: JSON.stringify(factRequest, null, 2),
      },
      investigate: {
        systemPrompt: AGENDA_ITEM_INVESTIGATION_PROMPT,
        userPrompt: investigationUserPrompt({
          item: bundle.item,
          directorsPromptLines: bundle.directorsPromptLines,
          sources: bundle.sources,
          answerText: bundle.answerText,
          facts: null,
        }),
      },
      validate: {
        systemPrompt: AGENDA_ITEM_VALIDATION_PROMPT,
        userPrompt:
          "Validation runs after investigation. The live payload (investigation + evidence) is assembled when you run this step.",
      },
      draft: {
        systemPrompt:
          "Deterministic minutes snippet from this debug run's investigation JSON. No model is called.",
        userPrompt: "The snippet is rendered from the completed investigation step.",
      },
    } satisfies Record<ItemDebugStepKey, { systemPrompt: string; userPrompt: string }>,
  };
}

function parseValidationDocument(value: unknown) {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  if (
    !["pass", "review_required", "fail"].includes(String(record.verdict)) ||
    !Array.isArray(record.issues) ||
    typeof record.needs_human_review !== "boolean"
  ) {
    throw new Error("Validator returned an incomplete review.");
  }
  return record;
}

function renderMinutesSnippet(
  item: typeof meetingsV2AgendaItems.$inferSelect,
  investigation: InvestigationDocument,
): string {
  const motion = investigation.motion;
  const lines = [
    `### ${item.itemNumber ? `${item.itemNumber} — ` : ""}${item.title}`,
    "",
    `**Outcome:** ${investigation.outcome}  `,
    `**Confidence:** ${investigation.confidence}  `,
    `**Visibility:** ${investigation.visibility}`,
    "",
    investigation.discussion_summary,
  ];
  if (investigation.decisions.length) {
    lines.push("", "**Decisions**");
    for (const decision of investigation.decisions) lines.push(`- ${decision}`);
  }
  if (motion) {
    lines.push(
      "",
      "**Motion**",
      `- Moved by: ${motion.moved_by ?? "—"}`,
      `- Seconded by: ${motion.seconded_by ?? "—"}`,
      `- Result: ${motion.result}`,
    );
    if (motion.resolution_text) lines.push(`- ${motion.resolution_text}`);
  }
  if (investigation.actions.length) {
    lines.push("", "**Actions**");
    for (const action of investigation.actions) {
      const owner = action.owner ? `${action.owner}: ` : "";
      const due = action.due_date ? ` (due ${action.due_date})` : "";
      lines.push(`- ${owner}${action.description}${due}`);
    }
  }
  if (investigation.open_questions.length) {
    lines.push("", "**Open questions**");
    for (const question of investigation.open_questions) {
      lines.push(`- ${question.question}`);
    }
  }
  return lines.join("\n");
}

async function completeDebugJson(options: {
  modelId: ItemDebugModelId;
  thinking: boolean;
  systemInstruction: string;
  userText: string;
  maxOutputTokens?: number;
  temperature?: number;
}) {
  const catalog = segmentCompareModel(options.modelId);
  const complete = createSegmentationJsonFn({
    modelId: options.modelId,
    thinking: options.thinking,
  });
  const result = await complete({
    systemInstruction: options.systemInstruction,
    userText: options.userText,
    maxOutputTokens: options.maxOutputTokens ?? 8192,
    temperature: options.temperature ?? 0,
  });
  return {
    text: result.text,
    modelName: result.modelName,
    apiModel: catalog.apiModel,
    usage: result.usage,
    finishReason: result.finishReason,
    costUsd: estimateSegmentCompareCostUsd(catalog.apiModel, result.usage, Date.now()),
  };
}

export async function listItemDebugWorkspace(
  meetingId: string,
  agendaItemId: string,
): Promise<ItemDebugWorkspace> {
  const item = await loadAgendaItem(meetingId, agendaItemId);
  const db = getDb();
  const rows = await db
    .select()
    .from(meetingsV2ItemDebugRuns)
    .where(
      and(
        eq(meetingsV2ItemDebugRuns.meetingV2Id, meetingId),
        eq(meetingsV2ItemDebugRuns.agendaItemId, agendaItemId),
      ),
    )
    .orderBy(desc(meetingsV2ItemDebugRuns.createdAt));
  return {
    item: {
      id: item.id,
      title: item.title,
      itemNumber: item.itemNumber,
      itemType: item.itemType,
      sectionLabel: item.sectionLabel,
    },
    models: ITEM_DEBUG_MODELS,
    steps: ITEM_DEBUG_STEPS,
    runs: rows.map((row) => summarizeItemDebugRun(parseStoredRun(row))),
  };
}

export async function loadItemDebugRun(
  meetingId: string,
  agendaItemId: string,
  runId: string,
): Promise<ItemDebugRun> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(meetingsV2ItemDebugRuns)
    .where(
      and(
        eq(meetingsV2ItemDebugRuns.id, runId),
        eq(meetingsV2ItemDebugRuns.meetingV2Id, meetingId),
        eq(meetingsV2ItemDebugRuns.agendaItemId, agendaItemId),
      ),
    );
  if (!row) throw new Error("Debug run was not found.");
  return parseStoredRun(row);
}

export async function createItemDebugRun(meetingId: string, agendaItemId: string): Promise<ItemDebugRun> {
  await loadAgendaItem(meetingId, agendaItemId);
  const { prompts } = await buildDefaultPrompts(meetingId, agendaItemId);
  const now = nowIso();
  const run: ItemDebugRun = {
    id: randomUUID(),
    meetingId,
    agendaItemId,
    status: "idle",
    error: null,
    steps: seedSteps(prompts),
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    createdAt: now,
    updatedAt: now,
  };
  const db = getDb();
  await db.insert(meetingsV2ItemDebugRuns).values({
    id: run.id,
    meetingV2Id: meetingId,
    agendaItemId,
    status: run.status,
    error: null,
    stepsJson: run.steps,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: "0",
    createdAt: now,
    updatedAt: now,
  });
  return run;
}

export async function saveItemDebugPrompts(options: {
  meetingId: string;
  agendaItemId: string;
  runId: string;
  steps: Array<{
    key: ItemDebugStepKey;
    modelId?: ItemDebugModelId | null;
    thinking?: boolean;
    systemPrompt?: string;
    userPrompt?: string;
  }>;
}): Promise<ItemDebugRun> {
  const run = await loadItemDebugRun(options.meetingId, options.agendaItemId, options.runId);
  for (const patch of options.steps) {
    const step = run.steps.find((entry) => entry.key === patch.key);
    if (!step) continue;
    if (patch.systemPrompt !== undefined) step.systemPrompt = patch.systemPrompt;
    if (patch.userPrompt !== undefined) step.userPrompt = patch.userPrompt;
    if (patch.thinking !== undefined) step.thinking = patch.thinking;
    if (patch.modelId !== undefined) {
      step.modelId = itemDebugStepMeta(patch.key).kind === "llm" ? patch.modelId : null;
    }
  }
  return persistRun(run);
}

export async function runItemDebugStep(options: {
  meetingId: string;
  agendaItemId: string;
  runId: string;
  stepKey: ItemDebugStepKey;
  modelId?: ItemDebugModelId | null;
  thinking?: boolean;
  systemPrompt?: string;
  userPrompt?: string;
}): Promise<ItemDebugRun> {
  let run = await loadItemDebugRun(options.meetingId, options.agendaItemId, options.runId);
  const stepIndex = run.steps.findIndex((entry) => entry.key === options.stepKey);
  if (stepIndex < 0) throw new Error("Unknown debug step.");
  const missing = missingPrerequisite(run.steps, options.stepKey);
  if (missing) {
    throw new Error(
      `Run ${itemDebugStepMeta(missing).shortLabel} before ${itemDebugStepMeta(options.stepKey).shortLabel}.`,
    );
  }

  const step = run.steps[stepIndex];
  if (options.systemPrompt !== undefined) step.systemPrompt = options.systemPrompt;
  if (options.userPrompt !== undefined) step.userPrompt = options.userPrompt;
  if (options.thinking !== undefined) step.thinking = options.thinking;
  if (options.modelId !== undefined && itemDebugStepMeta(options.stepKey).kind === "llm") {
    step.modelId = options.modelId;
  }

  step.status = "running";
  step.error = null;
  run.status = "running";
  run.error = null;
  run = await persistRun(run);

  const started = Date.now();
  try {
    const result = await executeStep(run, options.stepKey);
    const latest = run.steps.find((entry) => entry.key === options.stepKey)!;
    latest.status = "completed";
    latest.outputText = result.outputText;
    latest.parsedOutput = result.parsedOutput;
    latest.usage = result.usage;
    latest.durationMs = Date.now() - started;
    latest.error = null;
    latest.ranAt = nowIso();
    if (result.userPrompt) latest.userPrompt = result.userPrompt;
    if (result.systemPrompt) latest.systemPrompt = result.systemPrompt;
    const remaining = run.steps.some(
      (entry) => entry.status === "idle" || entry.status === "failed",
    );
    run.status = remaining ? "idle" : "completed";
    run.error = null;
    return persistRun(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const latest = run.steps.find((entry) => entry.key === options.stepKey)!;
    latest.status = "failed";
    latest.error = message;
    latest.durationMs = Date.now() - started;
    latest.ranAt = nowIso();
    run.status = "failed";
    run.error = message;
    return persistRun(run);
  }
}

async function executeStep(
  run: ItemDebugRun,
  stepKey: ItemDebugStepKey,
): Promise<{
  outputText: string;
  parsedOutput: unknown;
  usage: ItemDebugStep["usage"];
  userPrompt?: string;
  systemPrompt?: string;
}> {
  const bundle = await loadPreparedBundle(run.meetingId, run.agendaItemId);
  const step = run.steps.find((entry) => entry.key === stepKey)!;
  const modelId = step.modelId && isItemDebugModelId(step.modelId) ? step.modelId : DEFAULT_MODEL_ID;

  if (stepKey === "evidence") {
    const parsed = parseJsonObject(step.userPrompt);
    return {
      outputText: JSON.stringify(parsed, null, 2),
      parsedOutput: parsed,
      usage: emptyItemDebugUsage(null, false),
    };
  }

  if (stepKey === "facts") {
    const completion = await resolveAgendaFacts(
      {
        agenda: {
          title: bundle.item.title,
          itemNumber: bundle.item.itemNumber,
          itemType: bundle.item.itemType,
        },
        sources: bundle.sources,
      },
      async (opts) => {
        const result = await completeDebugJson({
          modelId,
          thinking: step.thinking,
          systemInstruction: step.systemPrompt || opts.systemInstruction,
          userText: step.userPrompt?.trim() ? step.userPrompt : opts.userText,
          maxOutputTokens: opts.maxOutputTokens,
          temperature: opts.temperature,
        });
        return {
          text: result.text,
          modelName: result.modelName,
          usage: result.usage,
          finishReason: result.finishReason,
        };
      },
    );
    const catalog = segmentCompareModel(modelId);
    const allUsage = completion.attempts.reduce(
      (acc, attempt) => {
        const usage = (attempt.usage ?? {}) as TokenUsage;
        acc.inputTokens += usage.inputTokens ?? 0;
        acc.outputTokens += usage.outputTokens ?? 0;
        acc.totalTokens += usage.totalTokens ?? 0;
        acc.cacheHitTokens += usage.cacheHitTokens ?? 0;
        acc.cacheMissTokens += usage.cacheMissTokens ?? 0;
        return acc;
      },
      { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 },
    );
    return {
      outputText: JSON.stringify(completion.facts, null, 2),
      parsedOutput: completion.facts,
      usage: {
        modelId,
        apiModel: catalog.apiModel,
        thinking: step.thinking,
        inputTokens: allUsage.inputTokens,
        outputTokens: allUsage.outputTokens,
        totalTokens: allUsage.totalTokens,
        cacheHitTokens: allUsage.cacheHitTokens,
        cacheMissTokens: allUsage.cacheMissTokens,
        costUsd: estimateSegmentCompareCostUsd(catalog.apiModel, allUsage, Date.now()),
      },
    };
  }

  if (stepKey === "investigate") {
    const factsStep = run.steps.find((entry) => entry.key === "facts");
    const facts = (factsStep?.parsedOutput as FactResolution | null) ?? {
      facts: [],
      unresolvedQuestions: [],
    };
    const userText = investigationUserPrompt({
      item: bundle.item,
      directorsPromptLines: bundle.directorsPromptLines,
      sources: bundle.sources,
      answerText: bundle.answerText,
      facts,
    });
    const systemInstruction = step.systemPrompt || AGENDA_ITEM_INVESTIGATION_PROMPT;
    const catalog = segmentCompareModel(modelId);
    const maxOutputTokens = thinkingAwareMaxOutputTokens({
      requested: 8192,
      thinking: step.thinking,
      provider: catalog.provider,
    });
    const liveUserText = step.userPrompt.includes("Resolved facts") ? step.userPrompt : userText;

    if (catalog.provider === "deepseek") {
      const runtime = await loadInvestigationToolRuntime({ meetingId: run.meetingId });
      const aiResult = await runToolEnabledInvestigation({
        systemInstruction,
        userText: liveUserText,
        runtime,
        modelName: catalog.apiModel,
        maxOutputTokens,
        thinking: step.thinking,
      });
      const parsed = parseInvestigation(parseJsonObject(aiResult.text));
      return {
        outputText: JSON.stringify(parsed, null, 2),
        parsedOutput: parsed,
        usage: {
          modelId,
          apiModel: catalog.apiModel,
          thinking: step.thinking,
          inputTokens: aiResult.usage.inputTokens,
          outputTokens: aiResult.usage.outputTokens,
          totalTokens: aiResult.usage.totalTokens,
          cacheHitTokens: aiResult.usage.cacheHitTokens,
          cacheMissTokens: aiResult.usage.cacheMissTokens,
          costUsd: estimateSegmentCompareCostUsd(catalog.apiModel, aiResult.usage, Date.now()),
        },
        userPrompt: userText,
        systemPrompt: systemInstruction,
      };
    }

    const geminiPrompt = `${systemInstruction}\n\nYou cannot call tools in this debug session. Use only the prepared evidence and resolved facts. Return the investigation JSON now.`;
    const result = await generateGeminiStructuredJson({
      systemInstruction: geminiPrompt,
      userText: liveUserText,
      modelName: catalog.apiModel,
      maxOutputTokens,
      temperature: 0.1,
      thinking: step.thinking,
    });
    const parsed = parseInvestigation(parseJsonObject(result.text));
    return {
      outputText: JSON.stringify(parsed, null, 2),
      parsedOutput: parsed,
      usage: {
        modelId,
        apiModel: catalog.apiModel,
        thinking: step.thinking,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        costUsd: estimateSegmentCompareCostUsd(catalog.apiModel, result.usage, Date.now()),
      },
      userPrompt: userText,
      systemPrompt: geminiPrompt,
    };
  }

  if (stepKey === "validate") {
    const investigation = run.steps.find((entry) => entry.key === "investigate")?.parsedOutput as
      | InvestigationDocument
      | undefined;
    if (!investigation) throw new Error("Investigation output is missing.");
    const facts = run.steps.find((entry) => entry.key === "facts")?.parsedOutput ?? null;
    const validationInput = {
      agendaItem: {
        id: bundle.item.id,
        title: bundle.item.title,
        sectionLabel: bundle.item.sectionLabel,
        itemNumber: bundle.item.itemNumber,
        itemType: bundle.item.itemType,
        sourcePages: safeJsonParse<number[]>(bundle.item.sourcePagesJson, []),
        sourceText: bundle.item.sourceText,
      },
      investigation,
      evidence: {
        sources: bundle.sources,
        assembledContextText: bundle.sources.length ? undefined : bundle.assembledContextText ?? "",
        notes: bundle.prepared?.notes ?? [],
        buildNotes: bundle.prepared?.buildNotes ?? [],
      },
      factResolution: facts,
      userClarifications: bundle.userAnswers,
    };
    const userText = JSON.stringify(validationInput, null, 2);
    const result = await completeDebugJson({
      modelId,
      thinking: step.thinking,
      systemInstruction: step.systemPrompt || AGENDA_ITEM_VALIDATION_PROMPT,
      userText: step.userPrompt.includes("agendaItem") ? step.userPrompt : userText,
      maxOutputTokens: 8192,
      temperature: 0,
    });
    const parsed = parseValidationDocument(parseJsonObject(result.text));
    return {
      outputText: JSON.stringify(parsed, null, 2),
      parsedOutput: parsed,
      usage: {
        modelId,
        apiModel: result.apiModel,
        thinking: step.thinking,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        cacheHitTokens: result.usage.cacheHitTokens,
        cacheMissTokens: result.usage.cacheMissTokens,
        costUsd: result.costUsd,
      },
      userPrompt: userText,
    };
  }

  const investigation = run.steps.find((entry) => entry.key === "investigate")?.parsedOutput as
    | InvestigationDocument
    | undefined;
  if (!investigation) throw new Error("Investigation output is missing.");
  const markdown = renderMinutesSnippet(bundle.item, investigation);
  return {
    outputText: markdown,
    parsedOutput: { markdown, investigation },
    usage: emptyItemDebugUsage(null, false),
    userPrompt: markdown,
  };
}

export type { ItemDebugAgentBundle } from "@/lib/meeting-v2/item-debug-agent-bundle";
export { buildItemDebugAgentBundleFromRun } from "@/lib/meeting-v2/item-debug-agent-bundle";

/** Compact sandbox bundle for agent analysis (no auth cookie required). */
export async function buildItemDebugAgentBundle(
  meetingId: string,
  agendaItemId: string,
  runId: string,
): Promise<import("@/lib/meeting-v2/item-debug-agent-bundle").ItemDebugAgentBundle> {
  const run = await loadItemDebugRun(meetingId, agendaItemId, runId);
  const item = await loadAgendaItem(meetingId, agendaItemId);
  let bundleRun = run;
  const evidenceStep = run.steps.find((step) => step.key === "evidence");
  if (evidenceStep?.parsedOutput == null && !evidenceStep?.userPrompt) {
    const { prompts } = await buildDefaultPrompts(meetingId, agendaItemId);
    try {
      const seeded = parseJsonObject(prompts.evidence.userPrompt);
      bundleRun = {
        ...run,
        steps: run.steps.map((step) =>
          step.key === "evidence" ? { ...step, parsedOutput: seeded } : step,
        ),
      };
    } catch {
      // Leave evidence null; bundle still exports step metadata.
    }
  }
  const { buildItemDebugAgentBundleFromRun } = await import("@/lib/meeting-v2/item-debug-agent-bundle");
  return buildItemDebugAgentBundleFromRun({
    meetingId,
    agendaItemId,
    exportedAt: nowIso(),
    item: {
      id: item.id,
      title: item.title,
      itemNumber: item.itemNumber,
      itemType: item.itemType,
      sectionLabel: item.sectionLabel,
    },
    run: bundleRun,
  });
}

export async function loadLatestItemDebugRunId(
  meetingId: string,
  agendaItemId: string,
): Promise<string | null> {
  const workspace = await listItemDebugWorkspace(meetingId, agendaItemId);
  return workspace.runs[0]?.id ?? null;
}

export function parseItemDebugStepKey(value: unknown): ItemDebugStepKey {
  if (typeof value !== "string" || !isItemDebugStepKey(value)) {
    throw new Error("Unknown debug step.");
  }
  return value;
}

export function parseItemDebugModelId(value: unknown): ItemDebugModelId | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !isItemDebugModelId(value)) {
    throw new Error("Unsupported model.");
  }
  return value;
}
