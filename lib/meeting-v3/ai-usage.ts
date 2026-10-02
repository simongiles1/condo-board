/**
 * V3 meeting AI cost by wizard stage (ingest, correction, agenda, attachments, facts, transcript, sources).
 */

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2DocumentPages } from "@/lib/db/schema-v2";
import type { DeepSeekGenerationResult } from "@/lib/deepseek/client";
import { estimateDeepSeekCostBreakdown } from "@/lib/deepseek/pricing";
import type { GeminiUsageCall } from "@/lib/gemini/usage";
import {
  estimateCostBreakdown,
  estimateCostUsdForCalls,
  sumTokenUsage,
  sumUsageCalls,
  type AiUsageStageRow,
  type TokenUsage,
} from "@/lib/gemini/usage";
import { readMeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { isLikelyDoclingMarkdown } from "@/lib/meeting-v2/pdf";
import {
  isMeetingsV3Workspace,
  meetingsV3FactGrouping,
  meetingsV3MeetingReconciliation,
  meetingsV3MinutesDraft,
  meetingsV3MinutesValidation,
  meetingsV3PackageStage,
  meetingsV3TranscriptSegmentation,
  type MeetingsV3AiUsageSettings,
  type MeetingsV3AiUsageStageRecord,
  type MeetingsV3PackageSettings,
} from "@/lib/meeting-v3/workspace";

/** Stored stage ids for the V3 package wizard. */
export const MEETINGS_V3_AI_USAGE_STAGE_IDS = [
  "v3_ingest",
  "v3_correct",
  "v3_agenda",
  "v3_attachments",
  "v3_facts",
  "v3_transcript",
  "v3_sources",
] as const;

/** One V3 pipeline stage in the AI usage breakdown. */
export type MeetingsV3AiUsageStageId = (typeof MEETINGS_V3_AI_USAGE_STAGE_IDS)[number];

const STAGE_LABELS: Record<MeetingsV3AiUsageStageId, string> = {
  v3_ingest: "Docling extract",
  v3_correct: "Agenda page correction",
  v3_agenda: "Build agenda",
  v3_attachments: "Link attachments",
  v3_facts: "Resolve facts",
  v3_transcript: "Segment transcript",
  v3_sources: "Group sources",
};

function primaryGeminiModel(calls: GeminiUsageCall[]): string {
  if (!calls.length) {
    return (
      process.env.GEMINI_MODEL_PAGE_VISION?.trim() ||
      process.env.GEMINI_MODEL_MINUTES?.trim() ||
      "gemini-3.7-flash"
    );
  }
  const counts = new Map<string, number>();
  for (const call of calls) {
    counts.set(call.modelName, (counts.get(call.modelName) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0];
}

function readStoredAiUsage(
  settings: { v3Package?: MeetingsV3PackageSettings | null } | null | undefined,
): MeetingsV3AiUsageSettings {
  const stages = settings?.v3Package?.aiUsage?.stages;
  if (!Array.isArray(stages)) return { stages: [] };
  const valid = stages.filter(
    (stage): stage is MeetingsV3AiUsageStageRecord =>
      stage != null
      && typeof stage === "object"
      && typeof stage.id === "string"
      && typeof stage.label === "string"
      && typeof stage.modelName === "string"
      && typeof stage.inputTokens === "number"
      && typeof stage.outputTokens === "number"
      && typeof stage.totalTokens === "number",
  );
  return { stages: valid };
}

function stageRecordToRow(record: MeetingsV3AiUsageStageRecord): AiUsageStageRow {
  return {
    id: record.id,
    label: record.label,
    modelName: record.modelName,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    totalTokens: record.totalTokens,
    notApplicable: record.notApplicable,
    usageDetail: record.usageDetail,
    cacheHitTokens: record.cacheHitTokens,
    cacheMissTokens: record.cacheMissTokens,
    billedAtMs: record.billedAtMs,
    inputCostUsd: record.inputCostUsd,
    outputCostUsd: record.outputCostUsd,
    totalCostUsd: record.totalCostUsd,
    pricingTier: record.pricingTier,
    stageKind: "pipeline",
  };
}

function rowToStageRecord(row: AiUsageStageRow, recordedAt: string): MeetingsV3AiUsageStageRecord {
  const breakdown = row.notApplicable
    ? null
    : estimateCostBreakdown(row.modelName, row);
  return {
    id: row.id,
    label: row.label,
    modelName: row.modelName,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    notApplicable: row.notApplicable,
    usageDetail: row.usageDetail,
    cacheHitTokens: row.cacheHitTokens,
    cacheMissTokens: row.cacheMissTokens,
    billedAtMs: row.billedAtMs,
    inputCostUsd: breakdown?.inputCostUsd ?? row.inputCostUsd,
    outputCostUsd: breakdown?.outputCostUsd ?? row.outputCostUsd,
    totalCostUsd: breakdown?.totalCostUsd ?? row.totalCostUsd,
    pricingTier: breakdown?.deepSeekTier ?? row.pricingTier,
    recordedAt,
  };
}

/**
 * Builds a billable stage row from Gemini page-vision calls.
 */
export function buildMeetingsV3GeminiStageRow(
  id: MeetingsV3AiUsageStageId,
  calls: GeminiUsageCall[],
): AiUsageStageRow {
  const usage = sumUsageCalls(calls);
  const modelName = primaryGeminiModel(calls);
  const breakdown = estimateCostBreakdown(modelName, usage);
  return {
    id,
    label: STAGE_LABELS[id],
    modelName,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    stageKind: "pipeline",
    inputCostUsd: breakdown.inputCostUsd,
    outputCostUsd: breakdown.outputCostUsd,
    totalCostUsd: estimateCostUsdForCalls(calls),
  };
}

/**
 * Builds a billable stage row from one or more DeepSeek completions.
 */
export function buildMeetingsV3DeepSeekStageRow(
  id: MeetingsV3AiUsageStageId,
  results: DeepSeekGenerationResult[],
  billedAtMs = Date.now(),
): AiUsageStageRow {
  const usages: TokenUsage[] = [];
  let cacheHitTokens = 0;
  let cacheMissTokens = 0;
  let inputCostUsd = 0;
  let outputCostUsd = 0;
  let totalCostUsd = 0;
  let modelName = "deepseek-v4-flash";
  let pricingTier: "peak" | "off_peak" | "mixed" | null = null;

  for (const result of results) {
    usages.push(result.usage);
    if (result.modelName.trim()) modelName = result.modelName.trim();
    const breakdown = estimateDeepSeekCostBreakdown(
      {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheHitTokens: result.usage.cacheHitTokens,
        cacheMissTokens: result.usage.cacheMissTokens,
        billedAtMs,
      },
      billedAtMs,
    );
    cacheHitTokens += breakdown.cacheHitTokens;
    cacheMissTokens += breakdown.cacheMissTokens;
    inputCostUsd += breakdown.inputCostUsd;
    outputCostUsd += breakdown.outputCostUsd;
    totalCostUsd += breakdown.totalCostUsd;
    if (pricingTier === null) {
      pricingTier = breakdown.tier;
    } else if (pricingTier !== breakdown.tier) {
      pricingTier = "mixed";
    }
  }

  const usage = sumTokenUsage(usages);
  return {
    id,
    label: STAGE_LABELS[id],
    modelName,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    stageKind: "pipeline",
    cacheHitTokens,
    cacheMissTokens,
    billedAtMs,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd,
    pricingTier: pricingTier ?? undefined,
  };
}

/**
 * Builds a non-token stage row (for example Docling ingest).
 */
export function buildMeetingsV3NotApplicableStageRow(
  id: MeetingsV3AiUsageStageId,
  options: { modelName: string; usageDetail: string },
): AiUsageStageRow {
  return {
    id,
    label: STAGE_LABELS[id],
    modelName: options.modelName,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    notApplicable: true,
    stageKind: "pipeline",
    usageDetail: options.usageDetail,
  };
}

/**
 * Replaces one stage in the meeting's stored V3 AI usage log.
 */
export async function persistMeetingsV3AiUsageStage(
  meetingId: string,
  row: AiUsageStageRow,
): Promise<void> {
  const db = getDb();
  const [row_] = await db
    .select({ settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = readMeetingV2Settings(row_?.settings);
  if (!isMeetingsV3Workspace(settings)) return;

  const recordedAt = new Date().toISOString();
  const prior = readStoredAiUsage(settings);
  const nextRecord = rowToStageRecord(row, recordedAt);
  const stages = [
    ...prior.stages.filter((stage) => stage.id !== row.id),
    nextRecord,
  ].sort(
    (left, right) =>
      MEETINGS_V3_AI_USAGE_STAGE_IDS.indexOf(left.id as MeetingsV3AiUsageStageId)
      - MEETINGS_V3_AI_USAGE_STAGE_IDS.indexOf(right.id as MeetingsV3AiUsageStageId),
  );

  const v3Package: MeetingsV3PackageSettings = {
    workspace: true,
    stage: meetingsV3PackageStage(settings),
    error: settings.v3Package?.error ?? null,
    updatedAt: recordedAt,
    attachmentLink: settings.v3Package?.attachmentLink ?? null,
    factResolution: settings.v3Package?.factResolution ?? null,
    transcriptSegmentation: meetingsV3TranscriptSegmentation(settings),
    factGrouping: meetingsV3FactGrouping(settings),
    meetingReconciliation: meetingsV3MeetingReconciliation(settings),
    minutesValidation: meetingsV3MinutesValidation(settings),
    minutesDraft: meetingsV3MinutesDraft(settings),
    aiUsage: { stages },
  };

  await db
    .update(meetingsV2)
    .set({
      settings: { ...settings, v3Package },
      updatedAt: recordedAt,
    })
    .where(eq(meetingsV2.id, meetingId));
}

function buildIngestStageRow(
  settings: ReturnType<typeof readMeetingV2Settings>,
  documentPages: Array<{ extractedText: string | null }>,
): AiUsageStageRow | null {
  const inferredDoclingPageCount = documentPages.filter((page) =>
    isLikelyDoclingMarkdown(page.extractedText),
  ).length;
  const storedIngestUsage = settings.ingestUsage;
  const totalIngestPages =
    storedIngestUsage?.totalPages ?? documentPages.length;
  if (totalIngestPages <= 0) return null;

  const doclingPageCount = Math.min(
    Math.max(storedIngestUsage?.doclingPages ?? 0, inferredDoclingPageCount),
    totalIngestPages,
  );
  const pdfJsPages = Math.max(0, totalIngestPages - doclingPageCount);
  const modelName =
    doclingPageCount > 0
      ? pdfJsPages > 0
        ? "IBM Docling + pdf.js"
        : "IBM Docling"
      : "pdf.js";
  const usageDetail =
    doclingPageCount > 0
      ? pdfJsPages > 0
        ? `${doclingPageCount} Docling page${doclingPageCount === 1 ? "" : "s"}, ${pdfJsPages} pdf.js page${pdfJsPages === 1 ? "" : "s"}`
        : `${doclingPageCount} page${doclingPageCount === 1 ? "" : "s"} processed`
      : `${totalIngestPages} page${totalIngestPages === 1 ? "" : "s"} ingested (Docling not used)`;

  return buildMeetingsV3NotApplicableStageRow("v3_ingest", { modelName, usageDetail });
}

/**
 * Returns V3 AI usage rows in wizard order, including live Docling ingest stats.
 */
export async function loadMeetingsV3AiUsageStages(
  meetingId: string,
): Promise<AiUsageStageRow[]> {
  const db = getDb();
  const [meeting, documentPages] = await Promise.all([
    db
      .select({ settings: meetingsV2.settings })
      .from(meetingsV2)
      .where(eq(meetingsV2.id, meetingId)),
    db
      .select({ extractedText: meetingsV2DocumentPages.extractedText })
      .from(meetingsV2DocumentPages)
      .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId)),
  ]);

  const settings = readMeetingV2Settings(meeting[0]?.settings);
  if (!isMeetingsV3Workspace(settings)) return [];

  const storedById = new Map(
    readStoredAiUsage(settings).stages.map((stage) => [stage.id, stageRecordToRow(stage)]),
  );
  const ingest = buildIngestStageRow(settings, documentPages);
  if (ingest) storedById.set(ingest.id, ingest);

  const rows: AiUsageStageRow[] = [];
  for (const id of MEETINGS_V3_AI_USAGE_STAGE_IDS) {
    const row = storedById.get(id);
    if (row) rows.push(row);
  }
  return rows;
}
