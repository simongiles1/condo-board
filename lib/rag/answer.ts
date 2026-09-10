import { generateWithSystemPrompt } from "@/lib/gemini/client";
import { estimateCostUsd } from "@/lib/gemini/usage";
import { isFileSeekingQuery } from "@/lib/rag/filename-match";
import type { MatchedRegistryEntity } from "@/lib/rag/registry-boost";
import {
  ASK_RETRIEVAL_LIMIT,
  searchCorpus,
  type CorpusSearchOptions,
  type CorpusSearchResult,
  type CorpusSearchUsage,
} from "@/lib/rag/search";
import {
  buildCorpusAskPipeline,
  type CorpusAskPipeline,
} from "@/lib/rag/pipeline-debug";
import {
  loadAttachmentFileCards,
  type AttachmentFileCardLookup,
} from "@/lib/rag/file-card-runs";
import type {
  CorpusQueryRewrite,
  CorpusRewriteUsage,
} from "@/lib/rag/query-rewrite";
import {
  rerankCorpusResults,
  type CorpusRerankUsage,
} from "@/lib/rag/rerank";
import {
  DEFAULT_CORPUS_ANSWER_MODEL,
  MAX_ANSWER_CHUNK_CHARS,
  MAX_ANSWER_CONTEXT_CHUNKS,
  type CorpusAnswerCitation,
  type CorpusAnswerConfidence,
  type CorpusAnswerUsage,
  type CorpusGroundedAnswer,
} from "@/lib/rag/answer-shared";

export {
  DEFAULT_CORPUS_ANSWER_MODEL,
  MAX_ANSWER_CHUNK_CHARS,
  MAX_ANSWER_CONTEXT_CHUNKS,
  type CorpusAnswerCitation,
  type CorpusAnswerConfidence,
  type CorpusAnswerUsage,
  type CorpusGroundedAnswer,
};

export function resolveCorpusAnswerModel(): string {
  return (
    process.env.GEMINI_MODEL_CORPUS?.trim() ||
    process.env.GEMINI_MODEL_EMAIL_ANALYSIS?.trim() ||
    DEFAULT_CORPUS_ANSWER_MODEL
  );
}

export type CorpusAskResponse = {
  results: CorpusSearchResult[];
  matchedEntities: MatchedRegistryEntity[];
  searchUsage: CorpusSearchUsage;
  answer: CorpusGroundedAnswer;
  rewrite?: CorpusQueryRewrite;
  rewriteUsage?: CorpusRewriteUsage;
  rerankUsage?: CorpusRerankUsage;
  pipeline?: CorpusAskPipeline;
};

export type PackedAnswerSource = {
  chunkId: string;
  sourceKind: CorpusSearchResult["sourceKind"];
  label: string;
  pageNo: number | null;
  similarity: number;
  text: string;
  emailLink: string | null;
  sourceLink: string | null;
  filenameHit: boolean;
  documentType?: string;
};

export type CorpusAnswerReview = {
  chunkId: string;
  relevant: boolean;
  why: string;
};

export function sourceLabel(result: CorpusSearchResult): string {
  return (
    result.metadata.filename ||
    result.metadata.subject ||
    (result.sourceKind === "email_body" ? "Email" : "Attachment")
  );
}

export function packAnswerSources(
  results: CorpusSearchResult[],
  limit = MAX_ANSWER_CONTEXT_CHUNKS,
  fileCards?: Map<string, AttachmentFileCardLookup>,
): PackedAnswerSource[] {
  return results.slice(0, limit).map((result) => {
    const filename =
      typeof result.metadata.filename === "string"
        ? result.metadata.filename
        : "";
    const card =
      result.contentHash ? fileCards?.get(result.contentHash) : undefined;
    let cardPrefix = "";
    if (card && card.status === "ready") {
      const parts = [
        `Document Type: ${card.documentType}`,
        `Summary: ${card.summary}`,
      ];
      if (card.coveringEmailContext) {
        parts.push(`Covering Email Context: ${card.coveringEmailContext}`);
      }
      cardPrefix = `[File Card: ${parts.join(" | ")}]\n`;
    }

    const header =
      filename && !result.chunkText.toLowerCase().startsWith("file:")
        ? `File: ${filename}\n`
        : "";
    const totalPrefix = `${header}${cardPrefix}`;
    const budget = Math.max(80, MAX_ANSWER_CHUNK_CHARS - totalPrefix.length);
    const body =
      result.chunkText.length > budget
        ? `${result.chunkText.slice(0, budget).trimEnd()}…`
        : result.chunkText;
    return {
      chunkId: result.id,
      sourceKind: result.sourceKind,
      label: sourceLabel(result),
      pageNo: result.pageNo,
      similarity: result.similarity,
      text: `${totalPrefix}${body}`,
      emailLink: result.emailLink,
      sourceLink: result.sourceLink,
      filenameHit:
        result.metadata.filenameMatch === true ||
        result.metadata.filenameAlias === true,
      documentType: card?.documentType,
    };
  });
}

export const CORPUS_ANSWER_SYSTEM_PROMPT = `You are the condo board archive assistant.
Answer ONLY from the numbered SOURCE excerpts. Do not use outside knowledge.
If the excerpts do not contain the answer, say so clearly and set notInArchive to true.
Never invent filenames, dates, amounts, or vendors that are not in the excerpts.
Registry entities are ranking hints, not facts, unless the same name appears in an excerpt.
Read EVERY numbered source before answering. Do not stop at the first few.
FILE INDEX lists every source filename. When the question asks to find a file or document, treat that index as evidence alongside the excerpts. A filename can be sufficient evidence even when the excerpt is a table, signature page, or boilerplate. Decide from the question which files and emails actually answer it. Do not prefer a document type (draft, proposal, signed, final, update) unless the question asks for that. An excerpt that merely discusses a topic is weaker than a filename that is the document.
If the question names several parties, name a file for each when the sources include them.
Return JSON only with this shape:
{
  "review": [{ "chunkId": "<exact chunk id from sources>", "relevant": true, "why": "one short reason" }],
  "answer": "prose answer. Mark supporting claims with [S1], [S2], …",
  "citations": [{ "chunkId": "<exact chunk id from sources>", "why": "one short reason" }],
  "confidence": "high" | "medium" | "low" | "none",
  "notInArchive": boolean
}
review must include every SOURCE chunkId exactly once. citations must include every review row with relevant true. Use only chunk ids listed in SOURCES.`;

export function buildCorpusAnswerUserText(params: {
  query: string;
  sources: PackedAnswerSource[];
  matchedEntities: MatchedRegistryEntity[];
}): string {
  const entityLines =
    params.matchedEntities.length === 0
      ? "None."
      : params.matchedEntities
          .map((entity) => `- ${entity.kind}: ${entity.name} (matched via "${entity.surface}")`)
          .join("\n");

  const fileIndex =
    params.sources.length === 0
      ? "None."
      : params.sources
          .map((source, index) => `[S${index + 1}] ${source.label}`)
          .join("\n");

  const sourceBlocks = params.sources
    .map((source, index) => {
      const page = source.pageNo != null ? ` page ${source.pageNo}` : "";
      return [
        `[S${index + 1}]`,
        `chunkId: ${source.chunkId}`,
        `kind: ${source.sourceKind}${page}`,
        `label: ${source.label}`,
        `similarity: ${Math.round(source.similarity * 100)}%`,
        "text:",
        source.text,
      ].join("\n");
    })
    .join("\n\n");

  return [
    `QUESTION\n${params.query}`,
    `FILE INDEX\n${fileIndex}`,
    `REGISTRY HINTS\n${entityLines}`,
    `SOURCES\n${sourceBlocks || "(none)"}`,
  ].join("\n\n");
}

export function emptyCorpusAnswer(modelName: string): CorpusGroundedAnswer {
  return {
    answer:
      "No matching excerpts were found in the indexed archive for this question.",
    citations: [],
    confidence: "none",
    notInArchive: true,
    modelName,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
}

export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*)\r?\n```\s*$/i.exec(trimmed);
  if (fenced) return fenced[1].trim();
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseConfidence(value: unknown): CorpusAnswerConfidence {
  if (
    value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "none"
  ) {
    return value;
  }
  return "medium";
}

export function parseSourceReviews(
  raw: unknown,
  allowedChunkIds: Set<string>,
): CorpusAnswerReview[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const reviews: CorpusAnswerReview[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const chunkId = typeof rec.chunkId === "string" ? rec.chunkId.trim() : "";
    if (!allowedChunkIds.has(chunkId) || seen.has(chunkId)) continue;
    seen.add(chunkId);
    reviews.push({
      chunkId,
      relevant: rec.relevant === true,
      why: typeof rec.why === "string" ? rec.why.trim() : "",
    });
  }
  return reviews;
}

/**
 * Union model citations with explicit reviews. On file-seeking questions,
 * also cite packed attachments that were found by filename — omitting those
 * is a skip, not a judgment the caller can see.
 */
export function mergeAnswerCitations(params: {
  sources: PackedAnswerSource[];
  citations: CorpusAnswerCitation[];
  reviews: CorpusAnswerReview[];
  fileSeeking: boolean;
}): CorpusAnswerCitation[] {
  const allowed = new Set(params.sources.map((source) => source.chunkId));
  const byId = new Map<string, CorpusAnswerCitation>();
  for (const citation of params.citations) {
    if (!allowed.has(citation.chunkId) || byId.has(citation.chunkId)) continue;
    byId.set(citation.chunkId, citation);
  }
  for (const review of params.reviews) {
    if (!review.relevant || !allowed.has(review.chunkId) || byId.has(review.chunkId)) {
      continue;
    }
    byId.set(review.chunkId, {
      chunkId: review.chunkId,
      why: review.why || "Marked relevant in source review.",
    });
  }
  if (params.fileSeeking) {
    for (const source of params.sources) {
      if (source.sourceKind === "email_body") continue;
      if (!source.filenameHit || byId.has(source.chunkId)) continue;
      byId.set(source.chunkId, {
        chunkId: source.chunkId,
        why: "Filename matched the question.",
      });
    }
  }
  return params.sources
    .filter((source) => byId.has(source.chunkId))
    .map((source) => byId.get(source.chunkId)!);
}

export function parseGroundedAnswerJson(
  text: string,
  allowedChunkIds: Set<string>,
): Pick<
  CorpusGroundedAnswer,
  "answer" | "citations" | "confidence" | "notInArchive"
> & { reviews: CorpusAnswerReview[] } {
  const stripped = stripJsonFence(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return {
      answer: text.trim() || "The model returned an unreadable answer.",
      citations: [],
      reviews: [],
      confidence: "low",
      notInArchive: false,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      answer: text.trim(),
      citations: [],
      reviews: [],
      confidence: "low",
      notInArchive: false,
    };
  }

  const obj = parsed as Record<string, unknown>;
  const answer =
    typeof obj.answer === "string" && obj.answer.trim()
      ? obj.answer.trim()
      : "The model did not return an answer.";

  const citations = Array.isArray(obj.citations)
    ? obj.citations
        .flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const rec = row as Record<string, unknown>;
          const chunkId =
            typeof rec.chunkId === "string" ? rec.chunkId.trim() : "";
          if (!allowedChunkIds.has(chunkId)) return [];
          return [
            {
              chunkId,
              why: typeof rec.why === "string" ? rec.why.trim() : "",
            },
          ];
        })
    : [];

  return {
    answer,
    citations,
    reviews: parseSourceReviews(obj.review, allowedChunkIds),
    confidence: parseConfidence(obj.confidence),
    notInArchive: obj.notInArchive === true,
  };
}

export async function generateCorpusAnswer(params: {
  query: string;
  results: CorpusSearchResult[];
  matchedEntities: MatchedRegistryEntity[];
  fileSeeking?: boolean;
  fileCards?: Map<string, AttachmentFileCardLookup>;
}): Promise<CorpusGroundedAnswer> {
  const modelName = resolveCorpusAnswerModel();
  if (params.results.length === 0) {
    return emptyCorpusAnswer(modelName);
  }

  let fileCards = params.fileCards;
  if (!fileCards) {
    const hashes = Array.from(
      new Set(
        params.results
          .map((r) => r.contentHash)
          .filter((h): h is string => Boolean(h)),
      ),
    );
    if (hashes.length > 0) {
      try {
        fileCards = await loadAttachmentFileCards(hashes);
      } catch (err) {
        console.warn("[corpus-ask] Failed to load file cards for answer:", err);
      }
    }
  }

  const sources = packAnswerSources(
    params.results,
    MAX_ANSWER_CONTEXT_CHUNKS,
    fileCards,
  );
  const allowed = new Set(sources.map((source) => source.chunkId));
  const fileSeeking =
    params.fileSeeking === true || isFileSeekingQuery(params.query);
  const generated = await generateWithSystemPrompt({
    systemInstruction: CORPUS_ANSWER_SYSTEM_PROMPT,
    userText: buildCorpusAnswerUserText({
      query: params.query,
      sources,
      matchedEntities: params.matchedEntities,
    }),
    modelName,
    maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS_CORPUS ?? 4096),
  });

  const parsed = parseGroundedAnswerJson(generated.text, allowed);
  const citations = mergeAnswerCitations({
    sources,
    citations: parsed.citations,
    reviews: parsed.reviews,
    fileSeeking,
  });
  return {
    ...parsed,
    citations,
    modelName,
    usage: {
      inputTokens: generated.usage.inputTokens,
      outputTokens: generated.usage.outputTokens,
      costUsd: estimateCostUsd(modelName, generated.usage),
    },
  };
}

export async function answerCorpusQuestion(
  options: CorpusSearchOptions,
): Promise<CorpusAskResponse> {
  const { results, matchedEntities, usage, rewrite, rewriteUsage } =
    await searchCorpus({
      ...options,
      limit: Math.max(options.limit ?? 10, ASK_RETRIEVAL_LIMIT),
    });

  const hashes = Array.from(
    new Set(
      results
        .map((r) => r.contentHash)
        .filter((h): h is string => Boolean(h)),
    ),
  );
  let fileCards: Map<string, AttachmentFileCardLookup> | undefined;
  if (hashes.length > 0) {
    try {
      fileCards = await loadAttachmentFileCards(hashes);
    } catch (err) {
      console.warn("[corpus-ask] Failed to load file cards for ask:", err);
    }
  }

  const reranked = await rerankCorpusResults({
    query: options.query,
    results,
    limit: MAX_ANSWER_CONTEXT_CHUNKS,
    fileCards,
  });
  const answer = await generateCorpusAnswer({
    query: options.query,
    results: reranked.ordered,
    matchedEntities,
    fileSeeking: rewrite?.fileSeeking,
    fileCards,
  });
  return {
    results: reranked.ordered,
    matchedEntities,
    searchUsage: usage,
    answer,
    rewrite,
    rewriteUsage,
    rerankUsage: reranked.usage,
    pipeline: buildCorpusAskPipeline({
      query: options.query,
      rewrite,
      retrieval: results,
      reranked: reranked.ordered,
      selectedIds: reranked.selectedIds,
      packedLimit: MAX_ANSWER_CONTEXT_CHUNKS,
      citedChunkIds: answer.citations.map((citation) => citation.chunkId),
      fileCards,
    }),
  };
}
