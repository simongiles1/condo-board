export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  getCorpusIndexStatus,
  runIncrementalIndexSlice,
  type IndexSliceOptions,
} from "@/lib/rag/indexer";
import { getCorpusEmbeddingCostSummary } from "@/lib/rag/cost";
import { getEmbedCostRollingSnapshot } from "@/lib/rag/embed-cost-live";

export async function GET() {
  try {
    const status = await getCorpusIndexStatus();
    const [costs, liveEmbedCost] = await Promise.all([
      getCorpusEmbeddingCostSummary(status),
      Promise.resolve(getEmbedCostRollingSnapshot()),
    ]);
    return NextResponse.json({ status, costs, liveEmbedCost });
  } catch (err) {
    console.error("[corpus-index] GET status error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load index status" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    let body: Partial<IndexSliceOptions> = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional
    }

    const options: IndexSliceOptions = {
      batchSize: typeof body.batchSize === "number" ? body.batchSize : 25,
      mode: body.mode ?? "all",
    };

    const result = await runIncrementalIndexSlice(options);
    const status = await getCorpusIndexStatus();
    if (result.chunksCreated > 0) {
      status.lastIndexedAt = new Date().toISOString();
    }
    const [costs, liveEmbedCost] = await Promise.all([
      getCorpusEmbeddingCostSummary(status),
      Promise.resolve(getEmbedCostRollingSnapshot()),
    ]);

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
