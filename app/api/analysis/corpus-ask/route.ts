export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { formatGeminiApiErrorMessage } from "@/lib/gemini/client";
import { generateCorpusAnswer, MAX_ANSWER_CONTEXT_CHUNKS } from "@/lib/rag/answer";
import { buildCorpusAskPipeline } from "@/lib/rag/pipeline-debug";
import { rerankCorpusResults } from "@/lib/rag/rerank";
import {
  ASK_RETRIEVAL_LIMIT,
  searchCorpus,
  type CorpusSearchOptions,
} from "@/lib/rag/search";

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

    const displayLimit = typeof body.limit === "number" ? body.limit : 10;
    const generateAnswer = body.generateAnswer !== false;
    const options: CorpusSearchOptions = {
      query,
      limit: generateAnswer
        ? Math.max(displayLimit, ASK_RETRIEVAL_LIMIT)
        : displayLimit,
      minSimilarity:
        typeof body.minSimilarity === "number" ? body.minSimilarity : 0.2,
      sourceKind: body.sourceKind,
    };

    const { results, matchedEntities, usage, rewrite, rewriteUsage } =
      await searchCorpus(options);

    if (!generateAnswer) {
      return NextResponse.json({
        query,
        count: results.length,
        results,
        matchedEntities,
        searchUsage: usage,
        rewrite,
        rewriteUsage,
        answer: null,
        pipeline: buildCorpusAskPipeline({
          query,
          rewrite,
          retrieval: results,
          packedLimit: results.length,
        }),
      });
    }

    try {
      const reranked = await rerankCorpusResults({
        query,
        results,
        limit: MAX_ANSWER_CONTEXT_CHUNKS,
      });
      const answer = await generateCorpusAnswer({
        query,
        results: reranked.ordered,
        matchedEntities,
        fileSeeking: rewrite?.fileSeeking,
      });
      return NextResponse.json({
        query,
        count: reranked.ordered.length,
        results: reranked.ordered,
        matchedEntities,
        searchUsage: usage,
        rewrite,
        rewriteUsage,
        rerankUsage: reranked.usage,
        answer,
        pipeline: buildCorpusAskPipeline({
          query,
          rewrite,
          retrieval: results,
          reranked: reranked.ordered,
          selectedIds: reranked.selectedIds,
          packedLimit: MAX_ANSWER_CONTEXT_CHUNKS,
          citedChunkIds: answer.citations.map((citation) => citation.chunkId),
        }),
      });
    } catch (genErr) {
      console.error("[corpus-ask] generation error:", genErr);
      const friendly = formatGeminiApiErrorMessage(genErr);
      return NextResponse.json({
        query,
        count: results.length,
        results,
        matchedEntities,
        searchUsage: usage,
        rewrite,
        rewriteUsage,
        answer: null,
        pipeline: buildCorpusAskPipeline({
          query,
          rewrite,
          retrieval: results,
          packedLimit: results.length,
        }),
        answerError:
          friendly ??
          (genErr instanceof Error ? genErr.message : "Answer generation failed"),
      });
    }
  } catch (err) {
    console.error("[corpus-ask] error:", err);
    const friendly = formatGeminiApiErrorMessage(err);
    const billingBlocked =
      friendly?.includes("credits") || friendly?.includes("spending cap");
    return NextResponse.json(
      {
        error: friendly ?? (err instanceof Error ? err.message : "Ask failed"),
      },
      { status: billingBlocked ? 402 : 500 },
    );
  }
}
