import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetings } from "@/lib/db/schema";
import {
  meetingsV2AgendaChunkSnapshots,
  meetingsV2AgendaItemInvestigations,
  meetingsV2DocumentPages,
} from "@/lib/db/schema-v2";
import {
  flattenAiUsageToStages,
  parseStoredAiUsage,
  type AiUsageStageRow,
  type TokenUsage,
} from "@/lib/gemini/usage";
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

function sumTokenUsages(usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (acc, usage) => ({
      inputTokens: acc.inputTokens + usage.inputTokens,
      outputTokens: acc.outputTokens + usage.outputTokens,
      totalTokens: acc.totalTokens + usage.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
}

function buildStageRow(options: {
  id: string;
  label: string;
  modelName: string;
  usage: TokenUsage;
  stageKind?: "pipeline" | "user";
}): AiUsageStageRow {
  return {
    id: options.id,
    label: options.label,
    modelName: options.modelName,
    inputTokens: options.usage.inputTokens,
    outputTokens: options.usage.outputTokens,
    totalTokens: options.usage.totalTokens,
    stageKind: options.stageKind ?? "pipeline",
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
  const [legacyMeeting, chunkSnapshots, investigations, documentPages] =
    await Promise.all([
      db
        .select({ aiUsageJson: meetings.aiUsageJson })
        .from(meetings)
        .where(eq(meetings.id, meetingId)),
      db
        .select({
          usageJson: meetingsV2AgendaChunkSnapshots.usageJson,
        })
        .from(meetingsV2AgendaChunkSnapshots)
        .where(eq(meetingsV2AgendaChunkSnapshots.meetingV2Id, meetingId)),
      db
        .select({
          modelName: meetingsV2AgendaItemInvestigations.modelName,
          usageJson: meetingsV2AgendaItemInvestigations.usageJson,
        })
        .from(meetingsV2AgendaItemInvestigations)
        .where(eq(meetingsV2AgendaItemInvestigations.meetingV2Id, meetingId)),
      db
        .select({
          extractedText: meetingsV2DocumentPages.extractedText,
        })
        .from(meetingsV2DocumentPages)
        .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId)),
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

  const extractionUsages = chunkSnapshots
    .map((row) => readTokenUsage(safeJsonParse(row.usageJson, null)))
    .filter((usage): usage is TokenUsage => usage !== null);

  if (extractionUsages.length > 0) {
    const usage = sumTokenUsages(extractionUsages);
    usageByStageId.set(
      "extract",
      buildStageRow({
        id: "extract",
        label: "Extract",
        modelName: "deepseek-v4-flash",
        usage,
        stageKind: "pipeline",
      }),
    );
  }

  const investigationUsages: TokenUsage[] = [];
  let investigationModel = "deepseek-v4-flash";

  for (const investigation of investigations) {
    const parsed = safeJsonParse<Record<string, unknown>>(
      investigation.usageJson,
      {},
    );
    const usage = readTokenUsage(parsed.usage ?? parsed);
    if (!usage) continue;

    investigationUsages.push(usage);
    if (investigation.modelName?.trim()) {
      investigationModel = investigation.modelName.trim();
    }
  }

  if (investigationUsages.length > 0) {
    usageByStageId.set(
      "investigate",
      buildStageRow({
        id: "investigate",
        label: "Investigate",
        modelName: investigationModel,
        usage: sumTokenUsages(investigationUsages),
        stageKind: "pipeline",
      }),
    );
  }

  return MEETING_V2_USAGE_STAGE_DEFINITIONS.map((stage) => {
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
      usageDetail:
        stage.kind === "user" ? "Manual step — no API usage" : undefined,
    });
  });
}
