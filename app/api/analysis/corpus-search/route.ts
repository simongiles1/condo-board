export const runtime = "nodejs";

import { NextResponse } from "next/server";

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

    const results = await searchCorpus(options);
    return NextResponse.json({
      query,
      count: results.length,
      results,
    });
  } catch (err) {
    console.error("[corpus-search] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 500 },
    );
  }
}
