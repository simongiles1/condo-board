import { count, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetings } from "@/lib/db/schema";
import {
  meetingsV2,
  meetingsV2AgendaChunkSnapshots,
  meetingsV2AgendaItemInvestigations,
  meetingsV2DocumentPages,
  meetingsV2MinutesDrafts,
  meetingsV2ValidationResults,
} from "@/lib/db/schema-v2";
import {
  collectGoldStandardValidationRuns,
  flattenAiUsageToStages,
  goldStandardValidationRunsToStages,
  parseStoredAiUsage,
  type AiUsageStageRow,
  type TokenUsage,
} from "@/lib/gemini/usage";
import {
  estimateDeepSeekCostBreakdown,
  type DeepSeekBillableUsage,
  type DeepSeekPricingTier,
} from "@/lib/deepseek/pricing";
import {
  readMeetingV2Settings,
  type MeetingV2Settings,
} from "@/lib/meeting-v2/extraction-diagnostics";
import { isLikelyDoclingMarkdown } from "@/lib/meeting-v2/pdf";
import { MEETING_V2_USAGE_STAGE_DEFINITIONS } from "@/lib/meeting-v2/workflow-progress";

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function readTokenUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;

  if (typeof record.inputTokens === "number") {
    const inputTokens = record.inputTokens;
    const outputTokens =
      typeof record.outputTokens === "number" ? record.outputTokens : 0;
    const totalTokens =
      typeof record.totalTokens === "number"
        ? record.totalTokens
        : inputTokens + outputTokens;

    return { inputTokens, outputTokens, totalTokens };
  }

  if (typeof record.prompt_tokens === "number") {
    const inputTokens = record.prompt_tokens;
    const outputTokens =
      typeof record.completion_tokens === "number"
        ? record.completion_tokens
        : 0;
    const totalTokens =
      typeof record.total_tokens === "number"
        ? record.total_tokens
        : inputTokens + outputTokens;

    return { inputTokens, outputTokens, totalTokens };
  }

  return null;
}

type DeepSeekUsageRecord = DeepSeekBillableUsage & TokenUsage;

function readDeepSeekUsageRecord(value: unknown): DeepSeekUsageRecord | null {
  const usage = readTokenUsage(value);
  if (!usage) return null;

  const record = value as Record<string, unknown>;
  const cacheHitTokens =
    typeof record.cacheHitTokens === "number"
      ? record.cacheHitTokens
      : typeof record.prompt_cache_hit_tokens === "number"
        ? record.prompt_cache_hit_tokens
        : undefined;
  const cacheMissTokens =
    typeof record.cacheMissTokens === "number"
      ? record.cacheMissTokens
      : typeof record.prompt_cache_miss_tokens === "number"
        ? record.prompt_cache_miss_tokens
        : undefined;

  return {
    ...usage,
    cacheHitTokens,
    cacheMissTokens,
  };
}

function parseBilledAtMs(value: string | null | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sumDeepSeekUsageRecords(
  records: Array<DeepSeekUsageRecord & { billedAtMs?: number }>,
): {
  usage: TokenUsage;
  cacheHitTokens: number;
  cacheMissTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  pricingTier: DeepSeekPricingTier | "mixed";
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let cacheHitTokens = 0;
  let cacheMissTokens = 0;
  let inputCostUsd = 0;
  let outputCostUsd = 0;
  let totalCostUsd = 0;
  let pricingTier: DeepSeekPricingTier | "mixed" | null = null;

  for (const record of records) {
    inputTokens += record.inputTokens;
    outputTokens += record.outputTokens;
    totalTokens += record.totalTokens;

    const breakdown = estimateDeepSeekCostBreakdown(record, record.billedAtMs);
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

  return {
    usage: { inputTokens, outputTokens, totalTokens },
    cacheHitTokens,
    cacheMissTokens,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd,
    pricingTier: pricingTier ?? "off_peak",
  };
}

function readNestedUsageRecord(
  value: unknown,
): DeepSeekUsageRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.usage && typeof record.usage === "object") {
    return readDeepSeekUsageRecord(record.usage);
  }
  return readDeepSeekUsageRecord(record);
}

function isReEvaluateInvestigationUsage(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as Record<string, unknown>).reEvaluate === true;
}

function buildStageRow(options: {
  id: string;
  label: string;
  modelName: string;
  usage: TokenUsage;
  stageKind?: "pipeline" | "user";
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  billedAtMs?: number;
  inputCostUsd?: number;
  outputCostUsd?: number;
  totalCostUsd?: number;
  pricingTier?: DeepSeekPricingTier | "mixed";
  usageDetail?: string;
}): AiUsageStageRow {
  return {
    id: options.id,
    label: options.label,
    modelName: options.modelName,
    inputTokens: options.usage.inputTokens,
    outputTokens: options.usage.outputTokens,
    totalTokens: options.usage.totalTokens,
    stageKind: options.stageKind ?? "pipeline",
    cacheHitTokens: options.cacheHitTokens,
    cacheMissTokens: options.cacheMissTokens,
    billedAtMs: options.billedAtMs,
    inputCostUsd: options.inputCostUsd,
    outputCostUsd: options.outputCostUsd,
    totalCostUsd: options.totalCostUsd,
    pricingTier: options.pricingTier,
    usageDetail: options.usageDetail,
  };
}

function buildNotApplicableStage(options: {
  id: string;
  label: string;
  stageKind: "pipeline" | "user";
  modelName?: string;
  usageDetail?: string;
}): AiUsageStageRow {
  return {
    id: options.id,
    label: options.label,
    modelName: options.modelName ?? "N/A",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    notApplicable: true,
    stageKind: options.stageKind,
    usageDetail: options.usageDetail,
  };
}

export async function loadMeetingV2AiUsageStages(
  meetingId: string,
): Promise<AiUsageStageRow[]> {
  const db = getDb();
  const [legacyMeeting, v2Meeting, chunkSnapshots, investigations, documentPages, drafts, validationCountRow] =
    await Promise.all([
      db
        .select({ aiUsageJson: meetings.aiUsageJson })
        .from(meetings)
        .where(eq(meetings.id, meetingId)),
      db
        .select({
          settings: meetingsV2.settings,
          updatedAt: meetingsV2.updatedAt,
        })
        .from(meetingsV2)
        .where(eq(meetingsV2.id, meetingId)),
      db
        .select({
          usageJson: meetingsV2AgendaChunkSnapshots.usageJson,
          createdAt: meetingsV2AgendaChunkSnapshots.createdAt,
        })
        .from(meetingsV2AgendaChunkSnapshots)
        .where(eq(meetingsV2AgendaChunkSnapshots.meetingV2Id, meetingId)),
      db
        .select({
          modelName: meetingsV2AgendaItemInvestigations.modelName,
          usageJson: meetingsV2AgendaItemInvestigations.usageJson,
          createdAt: meetingsV2AgendaItemInvestigations.createdAt,
        })
        .from(meetingsV2AgendaItemInvestigations)
        .where(eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meetingId)),
      db
        .select({
          extractedText: meetingsV2DocumentPages.extractedText,
        })
        .from(meetingsV2DocumentPages)
        .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId)),
      db
        .select({
          modelName: meetingsV2MinutesDrafts.modelName,
          usageJson: meetingsV2MinutesDrafts.usageJson,
        })
        .from(meetingsV2MinutesDrafts)
        .where(eq(meetingsV2MinutesDrafts.meetingV2Id, meetingId))
        .orderBy(desc(meetingsV2MinutesDrafts.createdAt))
        .limit(1),
      db
        .select({ value: count() })
        .from(meetingsV2ValidationResults)
        .where(eq(meetingsV2ValidationResults.meetingV2Id, meetingId)),
    ]);

  const usageByStageId = new Map<string, AiUsageStageRow>();

  const initialStages = flattenAiUsageToStages(
    parseStoredAiUsage(legacyMeeting[0]?.aiUsageJson),
  );
  for (const stage of initialStages) {
    usageByStageId.set(stage.id, stage);
  }

  const doclingPageCount = documentPages.filter((page) =>
    isLikelyDoclingMarkdown(page.extractedText),
  ).length;

  if (doclingPageCount > 0) {
    usageByStageId.set(
      "ingest",
      buildNotApplicableStage({
        id: "ingest",
        label: "Ingest",
        stageKind: "pipeline",
        modelName: "IBM Docling",
        usageDetail: `${doclingPageCount} page${doclingPageCount === 1 ? "" : "s"} processed`,
      }),
    );
  }

  const extractionRecords = chunkSnapshots
    .map((row) => {
      const usage = readDeepSeekUsageRecord(safeJsonParse(row.usageJson, null));
      if (!usage) return null;
      return {
        ...usage,
        billedAtMs: parseBilledAtMs(row.createdAt),
      };
    })
    .filter((record): record is DeepSeekUsageRecord & { billedAtMs?: number } => record !== null);

  if (extractionRecords.length > 0) {
    const billed = sumDeepSeekUsageRecords(extractionRecords);
    usageByStageId.set(
      "extract",
      buildStageRow({
        id: "extract",
        label: "Extract",
        modelName: "deepseek-v4-flash",
        usage: billed.usage,
        stageKind: "pipeline",
        cacheHitTokens: billed.cacheHitTokens,
        cacheMissTokens: billed.cacheMissTokens,
        inputCostUsd: billed.inputCostUsd,
        outputCostUsd: billed.outputCostUsd,
        totalCostUsd: billed.totalCostUsd,
        pricingTier: billed.pricingTier,
      }),
    );
  }

  const pipelineInvestigationRecords: Array<DeepSeekUsageRecord & { billedAtMs?: number }> = [];
  const reEvaluateInvestigationRecords: Array<DeepSeekUsageRecord & { billedAtMs?: number }> = [];
  let investigationModel = "deepseek-v4-flash";

  for (const investigation of investigations) {
    const parsed = safeJsonParse<Record<string, unknown>>(investigation.usageJson, {});
    const usage = readNestedUsageRecord(parsed);
    if (!usage) continue;

    const record = {
      ...usage,
      billedAtMs: parseBilledAtMs(investigation.createdAt),
    };
    if (isReEvaluateInvestigationUsage(parsed)) {
      reEvaluateInvestigationRecords.push(record);
    } else {
      pipelineInvestigationRecords.push(record);
    }
    if (investigation.modelName?.trim()) {
      investigationModel = investigation.modelName.trim();
    }
  }

  if (pipelineInvestigationRecords.length > 0) {
    const billed = sumDeepSeekUsageRecords(pipelineInvestigationRecords);
    usageByStageId.set(
      "investigate",
      buildStageRow({
        id: "investigate",
        label: "Investigate",
        modelName: investigationModel,
        usage: billed.usage,
        stageKind: "pipeline",
        cacheHitTokens: billed.cacheHitTokens,
        cacheMissTokens: billed.cacheMissTokens,
        inputCostUsd: billed.inputCostUsd,
        outputCostUsd: billed.outputCostUsd,
        totalCostUsd: billed.totalCostUsd,
        pricingTier: billed.pricingTier,
      }),
    );
  }

  const settings = readMeetingV2Settings(v2Meeting[0]?.settings ?? null);
  if (settings.validationUsage && settings.validationUsage.totalTokens > 0) {
    const validationSegments = settings.validationUsage.segments ?? [];
    const pipelineValidationSegments = validationSegments.filter(
      (segment) => segment.source !== "re_evaluate",
    );
    const reEvaluateValidationSegments = validationSegments.filter(
      (segment) => segment.source === "re_evaluate",
    );
    const validationRecords =
      pipelineValidationSegments.length > 0
        ? pipelineValidationSegments
            .map((segment) => ({
              inputTokens: segment.inputTokens,
              outputTokens: segment.outputTokens,
              totalTokens: segment.totalTokens,
              cacheHitTokens: segment.cacheHitTokens,
              cacheMissTokens: segment.cacheMissTokens,
              billedAtMs: segment.billedAtMs,
            }))
            .filter((segment) => segment.totalTokens > 0)
        : validationSegments.length === 0
          ? [
              {
                inputTokens: settings.validationUsage.inputTokens,
                outputTokens: settings.validationUsage.outputTokens,
                totalTokens: settings.validationUsage.totalTokens,
                billedAtMs: parseBilledAtMs(v2Meeting[0]?.updatedAt ?? null),
              },
            ]
          : [];

    if (validationRecords.length > 0) {
      const billed = sumDeepSeekUsageRecords(validationRecords);
      usageByStageId.set(
        "validate",
        buildStageRow({
          id: "validate",
          label: "Validate",
          modelName: settings.validationUsage.modelName,
          usage: billed.usage,
          stageKind: "pipeline",
          cacheHitTokens: billed.cacheHitTokens,
          cacheMissTokens: billed.cacheMissTokens,
          inputCostUsd: billed.inputCostUsd,
          outputCostUsd: billed.outputCostUsd,
          totalCostUsd: billed.totalCostUsd,
          pricingTier: billed.pricingTier,
        }),
      );
    }

    const reEvaluateValidationRecords = reEvaluateValidationSegments
      .map((segment) => ({
        inputTokens: segment.inputTokens,
        outputTokens: segment.outputTokens,
        totalTokens: segment.totalTokens,
        cacheHitTokens: segment.cacheHitTokens,
        cacheMissTokens: segment.cacheMissTokens,
        billedAtMs: segment.billedAtMs,
      }))
      .filter((segment) => segment.totalTokens > 0);
    const reEvaluateRecords = [
      ...reEvaluateInvestigationRecords,
      ...reEvaluateValidationRecords,
    ];
    if (reEvaluateRecords.length > 0) {
      const billed = sumDeepSeekUsageRecords(reEvaluateRecords);
      const runCount = Math.max(
        reEvaluateInvestigationRecords.length,
        reEvaluateValidationSegments.length,
      );
      usageByStageId.set(
        "agenda_review",
        buildStageRow({
          id: "agenda_review",
          label: "Agenda review",
          modelName: settings.validationUsage.modelName || investigationModel,
          usage: billed.usage,
          stageKind: "user",
          cacheHitTokens: billed.cacheHitTokens,
          cacheMissTokens: billed.cacheMissTokens,
          inputCostUsd: billed.inputCostUsd,
          outputCostUsd: billed.outputCostUsd,
          totalCostUsd: billed.totalCostUsd,
          pricingTier: billed.pricingTier,
          usageDetail: `${runCount} re-evaluation${runCount === 1 ? "" : "s"}`,
        }),
      );
    }
  } else if (reEvaluateInvestigationRecords.length > 0) {
    const billed = sumDeepSeekUsageRecords(reEvaluateInvestigationRecords);
    usageByStageId.set(
      "agenda_review",
      buildStageRow({
        id: "agenda_review",
        label: "Agenda review",
        modelName: investigationModel,
        usage: billed.usage,
        stageKind: "user",
        cacheHitTokens: billed.cacheHitTokens,
        cacheMissTokens: billed.cacheMissTokens,
        inputCostUsd: billed.inputCostUsd,
        outputCostUsd: billed.outputCostUsd,
        totalCostUsd: billed.totalCostUsd,
        pricingTier: billed.pricingTier,
        usageDetail: `${reEvaluateInvestigationRecords.length} re-evaluation${reEvaluateInvestigationRecords.length === 1 ? "" : "s"}`,
      }),
    );
  }

  const latestDraft = drafts[0];
  if (latestDraft?.usageJson) {
    const draftUsage = readTokenUsage(safeJsonParse(latestDraft.usageJson, null));
    if (draftUsage && draftUsage.totalTokens > 0) {
      usageByStageId.set(
        "draft_generated",
        buildStageRow({
          id: "draft_generated",
          label: "Draft generated",
          modelName: latestDraft.modelName?.trim() || "deepseek-v4-flash",
          usage: draftUsage,
          stageKind: "user",
        }),
      );
    }
  }

  const validationResultCount = Number(validationCountRow[0]?.value ?? 0);
  const v2Settings = (v2Meeting[0]?.settings as MeetingV2Settings | null) ?? null;

  const workflowStages = MEETING_V2_USAGE_STAGE_DEFINITIONS.map((stage) => {
    const recorded = usageByStageId.get(stage.id);
    if (recorded && !recorded.notApplicable) {
      return {
        ...recorded,
        id: stage.id,
        label: stage.label,
        stageKind: stage.kind,
      };
    }
    if (recorded?.notApplicable) {
      return {
        ...recorded,
        id: stage.id,
        label: stage.label,
        stageKind: stage.kind,
      };
    }
    return buildNotApplicableStage({
      id: stage.id,
      label: stage.label,
      stageKind: stage.kind,
      modelName:
        stage.id === "validate" && validationResultCount > 0
          ? "deepseek-v4-flash"
          : undefined,
      usageDetail:
        stage.id === "evidence"
          ? "No LLM usage"
          : stage.id === "validate" && validationResultCount > 0
            ? "DeepSeek ran for this stage — token counts were not stored for this meeting"
            : stage.kind === "user"
              ? "Manual step — no API usage"
              : undefined,
    });
  });

  const goldStandardStages = goldStandardValidationRunsToStages(
    collectGoldStandardValidationRuns({
      aiUsageJson: legacyMeeting[0]?.aiUsageJson,
      settingsRuns: v2Settings?.goldStandardValidationRuns,
    }),
  );

  return [...workflowStages, ...goldStandardStages];
}
