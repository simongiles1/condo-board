import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  emailAttachments,
  extractionSources,
} from "@/lib/db/schema";
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

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export async function getCostSummary(): Promise<CostSummary> {
  const db = getDb();
  const processedEmailCount = await countProcessedEmails();
  const unprocessedEmailCount = await countUnprocessedEmails();

  const sources = await db
    .select()
    .from(extractionSources)
    .where(sql`${extractionSources.sourceType} = 'email_message'`)
    .orderBy(sql`${extractionSources.processedAt} DESC`);

  const costs = sources.map((s) => Number(s.totalCostUsd));
  const avgCost = costs.length
    ? costs.reduce((a, b) => a + b, 0) / costs.length
    : 0;

  const last = sources[0] ?? null;

  const perEmailCosts = sources.map((s) => ({
    emailId: s.sourceId,
    costUsd: Number(s.totalCostUsd),
    modelName: s.modelName,
    processedAt: s.processedAt,
    inputTokens: s.totalInputTokens,
    outputTokens: s.totalOutputTokens,
  }));

  const withAttachmentCosts: number[] = [];
  const withoutAttachmentCosts: number[] = [];

  for (const source of sources) {
    const attachmentCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(emailAttachments)
      .where(sql`${emailAttachments.emailId} = ${source.sourceId}`);
    const count = attachmentCount[0]?.count ?? 0;
    const cost = Number(source.totalCostUsd);
    if (count > 0) withAttachmentCosts.push(cost);
    else withoutAttachmentCosts.push(cost);
  }

  const estimatedRemaining = avgCost * unprocessedEmailCount;
  const estimatedTotal = avgCost * (processedEmailCount + unprocessedEmailCount);

  return {
    processedEmailCount,
    unprocessedEmailCount,
    totalAnalyses: sources.length,
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
      inputTokens: sources.length
        ? sources.reduce((s, r) => s + r.totalInputTokens, 0) / sources.length
        : 0,
      outputTokens: sources.length
        ? sources.reduce((s, r) => s + r.totalOutputTokens, 0) / sources.length
        : 0,
      medianCostUsd: median(costs),
      p95CostUsd: percentile(costs, 95),
      withAttachmentsCostUsd: withAttachmentCosts.length
        ? withAttachmentCosts.reduce((a, b) => a + b, 0) /
          withAttachmentCosts.length
        : null,
      withoutAttachmentsCostUsd: withoutAttachmentCosts.length
        ? withoutAttachmentCosts.reduce((a, b) => a + b, 0) /
          withoutAttachmentCosts.length
        : null,
    },
    extrapolation: {
      estimatedRemainingCostUsd: estimatedRemaining,
      estimatedTotalCostUsd: estimatedTotal,
      formattedRemaining: formatCostUsd(estimatedRemaining),
      formattedTotal: formatCostUsd(estimatedTotal),
    },
    perEmailCosts,
  };
}

export async function getAnalysisStatus() {
  const db = getDb();
  const [withAttachments] = await db
    .select({ count: sql<number>`count(distinct ${emailAttachments.emailId})` })
    .from(emailAttachments);

  return {
    processedEmailCount: await countProcessedEmails(),
    unprocessedEmailCount: await countUnprocessedEmails(),
    emailsWithAttachments: withAttachments?.count ?? 0,
  };
}
