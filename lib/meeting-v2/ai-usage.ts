import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetings } from "@/lib/db/schema";
import {
  meetingsV2AgendaChunkSnapshots,
  meetingsV2AgendaItemInvestigations,
} from "@/lib/db/schema-v2";
import {
  flattenAiUsageToStages,
  parseStoredAiUsage,
  type AiUsageStageRow,
  type TokenUsage,
} from "@/lib/gemini/usage";

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
}): AiUsageStageRow {
  return {
    id: options.id,
    label: options.label,
    modelName: options.modelName,
    inputTokens: options.usage.inputTokens,
    outputTokens: options.usage.outputTokens,
    totalTokens: options.usage.totalTokens,
  };
}

export async function loadMeetingV2AiUsageStages(
  meetingId: string,
): Promise<AiUsageStageRow[]> {
  const db = getDb();
  const [legacyMeeting, chunkSnapshots, investigations] = await Promise.all([
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
  ]);

  const stages: AiUsageStageRow[] = [];

  const initialStages = flattenAiUsageToStages(
    parseStoredAiUsage(legacyMeeting[0]?.aiUsageJson),
  );
  if (initialStages.length > 0) {
    stages.push(...initialStages);
  }

  const extractionUsages = chunkSnapshots
    .map((row) => readTokenUsage(safeJsonParse(row.usageJson, null)))
    .filter((usage): usage is TokenUsage => usage !== null);

  if (extractionUsages.length > 0) {
    const usage = sumTokenUsages(extractionUsages);
    stages.push(
      buildStageRow({
        id: "agenda-extraction",
        label: "Agenda extraction",
        modelName: "deepseek-v4-flash",
        usage,
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
    stages.push(
      buildStageRow({
        id: "item-investigation",
        label: "Item investigation",
        modelName: investigationModel,
        usage: sumTokenUsages(investigationUsages),
      }),
    );
  }

  return stages;
}
