export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export type CorpusAskPhase = "rewrite" | "retrieve" | "rerank" | "answer";

const ASK_PHASE_LABEL: Record<CorpusAskPhase, string> = {
  rewrite: "Understanding the question…",
  retrieve: "Searching emails and files…",
  rerank: "Ranking the best sources…",
  answer: "Writing the answer…",
};

type AskSuccess = {
  query: string;
  count: number;
  results: unknown;
  matchedEntities: unknown;
  searchUsage: unknown;
  rewrite: unknown;
  rewriteUsage: unknown;
  rerankUsage?: unknown;
  answer: unknown;
  pipeline: unknown;
  answerError?: string;
};

async function runCorpusAsk(
  query: string,
  displayLimit: number,
  generateAnswer: boolean,
  minSimilarity: number | undefined,
  sourceKind: CorpusSearchOptions["sourceKind"],
  onPhase: (phase: CorpusAskPhase, label: string) => void,
): Promise<AskSuccess> {
  const options: CorpusSearchOptions = {
    query,
    limit: generateAnswer
      ? Math.max(displayLimit, ASK_RETRIEVAL_LIMIT)
      : displayLimit,
    minSimilarity: typeof minSimilarity === "number" ? minSimilarity : 0.2,
    sourceKind,
    onPhase: (phase) => onPhase(phase, ASK_PHASE_LABEL[phase]),
  };

  const { results, matchedEntities, usage, rewrite, rewriteUsage } =
    await searchCorpus(options);

  if (!generateAnswer) {
    return {
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
    };
  }

  try {
    onPhase("rerank", ASK_PHASE_LABEL.rerank);
    const reranked = await rerankCorpusResults({
      query,
      results,
      limit: MAX_ANSWER_CONTEXT_CHUNKS,
    });
    onPhase("answer", ASK_PHASE_LABEL.answer);
    const answer = await generateCorpusAnswer({
      query,
      results: reranked.ordered,
      matchedEntities,
      fileSeeking: rewrite?.fileSeeking,
    });
    return {
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
    };
  } catch (genErr) {
    console.error("[corpus-ask] generation error:", genErr);
    const friendly = formatGeminiApiErrorMessage(genErr);
    return {
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
    };
  }
}

function sseChunk(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

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
    const stream = body.stream === true;

    if (!stream) {
      const payload = await runCorpusAsk(
        query,
        displayLimit,
        generateAnswer,
        body.minSimilarity,
        body.sourceKind,
        () => {},
      );
      return NextResponse.json(payload);
    }

    const readable = new ReadableStream({
      async start(controller) {
        try {
          const payload = await runCorpusAsk(
            query,
            displayLimit,
            generateAnswer,
            body.minSimilarity,
            body.sourceKind,
            (phase, label) => {
              controller.enqueue(sseChunk("phase", { phase, label }));
            },
          );
          controller.enqueue(sseChunk("result", payload));
        } catch (err) {
          console.error("[corpus-ask] error:", err);
          const friendly = formatGeminiApiErrorMessage(err);
          controller.enqueue(
            sseChunk("error", {
              error: friendly ?? (err instanceof Error ? err.message : "Ask failed"),
            }),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
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
