import { desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emailAttachments, extractionSources } from "@/lib/db/schema";
import { formatCostUsd } from "@/lib/gemini/usage";

import {
  countProcessedEmails,
  countUnprocessedEmails,
} from "./preprocess";

export type CostSummary = {
  processedEmailCount: number;
  unprocessedEmailCount: number;
  totalAnalyses: number;
  lastRun: {
    costUsd: number;
    modelName: string;
    processedAt: string;
    inputTokens: number;
    outputTokens: number;
  } | null;
  averages: {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    medianCostUsd: number;
    p95CostUsd: number;
    withAttachmentsCostUsd: number | null;
    withoutAttachmentsCostUsd: number | null;
  };
  extrapolation: {
    estimatedRemainingCostUsd: number;
    estimatedTotalCostUsd: number;
    formattedRemaining: string;
    formattedTotal: string;
  };
  perEmailCosts: Array<{
    emailId: string;
    costUsd: number;
    modelName: string;
    processedAt: string;
    inputTokens: number;
    outputTokens: number;
  }>;
};

export async function getCostSummary(): Promise<CostSummary> {
  const db = getDb();
  const processedEmailCount = await countProcessedEmails();
  const unprocessedEmailCount = await countUnprocessedEmails();

  const [aggregates] = await db
    .select({
      totalAnalyses: sql<number>`count(*)::int`,
      avgCost: sql<number>`coalesce(avg(cast(${extractionSources.totalCostUsd} as double precision)), 0)`,
      avgInput: sql<number>`coalesce(avg(${extractionSources.totalInputTokens}), 0)`,
      avgOutput: sql<number>`coalesce(avg(${extractionSources.totalOutputTokens}), 0)`,
    })
    .from(extractionSources)
    .where(eq(extractionSources.sourceType, "email_message"));

  const [last] = await db
    .select({
      totalCostUsd: extractionSources.totalCostUsd,
      modelName: extractionSources.modelName,
      processedAt: extractionSources.processedAt,
      totalInputTokens: extractionSources.totalInputTokens,
      totalOutputTokens: extractionSources.totalOutputTokens,
    })
    .from(extractionSources)
    .where(eq(extractionSources.sourceType, "email_message"))
    .orderBy(desc(extractionSources.processedAt))
    .limit(1);

  const totalAnalyses = Number(aggregates?.totalAnalyses ?? 0);
  const avgCost = Number(aggregates?.avgCost ?? 0);
  const estimatedRemaining = avgCost * unprocessedEmailCount;
  const estimatedTotal = avgCost * (processedEmailCount + unprocessedEmailCount);

  return {
    processedEmailCount,
    unprocessedEmailCount,
    totalAnalyses,
    lastRun: last
      ? {
          costUsd: Number(last.totalCostUsd),
          modelName: last.modelName,
          processedAt: last.processedAt,
          inputTokens: last.totalInputTokens,
          outputTokens: last.totalOutputTokens,
        }
      : null,
    averages: {
      costUsd: avgCost,
      inputTokens: Number(aggregates?.avgInput ?? 0),
      outputTokens: Number(aggregates?.avgOutput ?? 0),
      medianCostUsd: avgCost,
      p95CostUsd: avgCost,
      withAttachmentsCostUsd: null,
      withoutAttachmentsCostUsd: null,
    },
    extrapolation: {
      estimatedRemainingCostUsd: estimatedRemaining,
      estimatedTotalCostUsd: estimatedTotal,
      formattedRemaining: formatCostUsd(estimatedRemaining),
      formattedTotal: formatCostUsd(estimatedTotal),
    },
    perEmailCosts: [],
  };
}

export async function getAnalysisStatus() {
  const db = getDb();
  const [withAttachments] = await db
    .select({
      count: sql<number>`count(distinct ${emailAttachments.emailId})`,
    })
    .from(emailAttachments);

  return {
    processedEmailCount: await countProcessedEmails(),
    unprocessedEmailCount: await countUnprocessedEmails(),
    emailsWithAttachments: withAttachments?.count ?? 0,
  };
}
