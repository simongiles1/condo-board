export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { formatGeminiApiErrorMessage } from "@/lib/gemini/client";
import { searchCorpus, type CorpusSearchOptions } from "@/lib/rag/search";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const query = typeof body.query === "string" ? body.query.trim() : "";

    if (!query) {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400 },
      );
    }

    const options: CorpusSearchOptions = {
      query,
      limit: typeof body.limit === "number" ? body.limit : 10,
      minSimilarity:
        typeof body.minSimilarity === "number" ? body.minSimilarity : 0.2,
      sourceKind: body.sourceKind,
    };

    const { results, matchedEntities, usage } = await searchCorpus(options);
    return NextResponse.json({
      query,
      count: results.length,
      results,
      matchedEntities,
      usage,
    });
  } catch (err) {
    console.error("[corpus-search] error:", err);
    const friendly = formatGeminiApiErrorMessage(err);
    const billingBlocked =
      friendly?.includes("credits") || friendly?.includes("spending cap");
    return NextResponse.json(
      { error: friendly ?? (err instanceof Error ? err.message : "Search failed") },
      { status: billingBlocked ? 402 : 500 },
    );
  }
}
