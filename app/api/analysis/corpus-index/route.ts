export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  getCorpusIndexStatus,
  runIncrementalIndexSlice,
  type CorpusIndexStatus,
  type IndexSliceOptions,
} from "@/lib/rag/indexer";
import { getCorpusEmbeddingCostSummary } from "@/lib/rag/cost";
import { withCorpusIndexDbLock } from "@/lib/rag/corpus-index-lock";
import { getEmbedCostRollingSnapshot } from "@/lib/rag/embed-cost-live";

export async function GET() {
  try {
    const { status, costs, liveEmbedCost } = await withCorpusIndexDbLock(async () => {
      const status = await getCorpusIndexStatus();
      const [costs, liveEmbedCost] = await Promise.all([
        getCorpusEmbeddingCostSummary(status),
        Promise.resolve(getEmbedCostRollingSnapshot()),
      ]);
      return { status, costs, liveEmbedCost };
    });
    return NextResponse.json({ status, costs, liveEmbedCost });
  } catch (err) {
    console.error("[corpus-index] GET status error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load index status" },
      { status: 500 },
    );
  }
}

type IndexSliceRequest = IndexSliceOptions & {
  /** When false, skip expensive dashboard status/cost queries (continuous runs). */
  refreshDashboard?: boolean;
};

export async function POST(request: Request) {
  try {
    let body: Partial<IndexSliceRequest> = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional
    }

    const options: IndexSliceOptions = {
      batchSize: typeof body.batchSize === "number" ? body.batchSize : 25,
      mode: body.mode ?? "all",
      priorRemaining: body.priorRemaining,
    };
    const refreshDashboard = body.refreshDashboard !== false;

    const result = await withCorpusIndexDbLock(() =>
      runIncrementalIndexSlice(options),
    );

    let status: CorpusIndexStatus | undefined;
    let costs: Awaited<ReturnType<typeof getCorpusEmbeddingCostSummary>> | undefined;

    if (refreshDashboard) {
      const dashboard = await withCorpusIndexDbLock(async () => {
        const status = await getCorpusIndexStatus();
        if (result.chunksCreated > 0) {
          status.lastIndexedAt = new Date().toISOString();
        }
        const costs = await getCorpusEmbeddingCostSummary(status);
        return { status, costs };
      });
      status = dashboard.status;
      costs = dashboard.costs;
    }

    const liveEmbedCost = getEmbedCostRollingSnapshot();

    return NextResponse.json({
      result,
      status,
      costs,
      liveEmbedCost,
    });
  } catch (err) {
    console.error("[corpus-index] POST run error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Indexing slice failed" },
      { status: 500 },
    );
  }
}
