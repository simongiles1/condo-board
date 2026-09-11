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
import { formatFileCardAskParts } from "@/lib/rag/file-card-pack";
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

export const MAX_NEAR_MISS_CITATIONS = 3;
const NEAR_MISS_PREFERRED_TYPES = new Set([
  "study",
  "tables",
  "signed_report",
]);

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

export type CorpusAnswerMatch = "direct" | "near" | "no";

export type CorpusAnswerReview = {
  chunkId: string;
  match: CorpusAnswerMatch;
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
      cardPrefix = `[File Card: ${formatFileCardAskParts(card).join(" | ")}]\n`;
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
If the question names parties or a count of documents, treat a packed source as a near miss when it is the same kind of document (for example another reserve fund study) but the letterhead or parties do not match a named company. Do not claim that firm is the named company. After the named matches, add one short "Related, not a name match:" sentence citing those [SN] sources (at most 3). Prefer study, signed_report, and tables over sample or proposal for near matches. If there is no coverage gap, do not list extra similar files. Never use outside knowledge to equate company names.
Return JSON only (no markdown fences) with this shape — put answer first:
{
  "answer": "prose answer. Mark supporting claims with [S1], [S2], … only",
  "review": [{ "source": 1, "match": "direct" | "near" | "no", "why": "one short reason" }],
  "confidence": "high" | "medium" | "low" | "none",
  "notInArchive": boolean
}
Use source numbers 1..N matching [S1]..[SN] in SOURCES. review must include every source number exactly once. Keep why lines short. Do not emit chunk ids or a citations array.`;

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
    nearMisses: [],
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

function parseReviewSourceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

export function resolveReviewRowChunkId(
  rec: Record<string, unknown>,
  sources: PackedAnswerSource[],
  allowedChunkIds: Set<string>,
): string | null {
  const sourceNum =
    parseReviewSourceNumber(rec.source) ?? parseReviewSourceNumber(rec.s);
  if (
    sourceNum != null &&
    sourceNum >= 1 &&
    sourceNum <= sources.length
  ) {
    return sources[sourceNum - 1]!.chunkId;
  }
  const chunkId = typeof rec.chunkId === "string" ? rec.chunkId.trim() : "";
  if (chunkId && allowedChunkIds.has(chunkId)) return chunkId;
  return null;
}

function parseReviewMatch(rec: Record<string, unknown>): CorpusAnswerMatch {
  const raw = typeof rec.match === "string" ? rec.match.toLowerCase().trim() : "";
  if (raw === "direct" || raw === "near" || raw === "no") return raw;
  if (rec.relevant === true) return "direct";
  return "no";
}

export function parseSourceReviews(
  raw: unknown,
  sources: PackedAnswerSource[],
): CorpusAnswerReview[] {
  const allowedChunkIds = new Set(sources.map((source) => source.chunkId));
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const reviews: CorpusAnswerReview[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const chunkId = resolveReviewRowChunkId(rec, sources, allowedChunkIds);
    if (!chunkId || seen.has(chunkId)) continue;
    seen.add(chunkId);
    const match = parseReviewMatch(rec);
    reviews.push({
      chunkId,
      match,
      relevant: match !== "no",
      why: typeof rec.why === "string" ? rec.why.trim() : "",
    });
  }
  return reviews;
}

export function selectNearMisses(
  reviews: CorpusAnswerReview[],
  sources: PackedAnswerSource[],
  limit = MAX_NEAR_MISS_CITATIONS,
): CorpusAnswerCitation[] {
  const byId = new Map(sources.map((source) => [source.chunkId, source]));
  const near = reviews.filter((review) => review.match === "near");
  near.sort((a, b) => {
    const aType = byId.get(a.chunkId)?.documentType || "";
    const bType = byId.get(b.chunkId)?.documentType || "";
    const aPref = NEAR_MISS_PREFERRED_TYPES.has(aType) ? 0 : 1;
    const bPref = NEAR_MISS_PREFERRED_TYPES.has(bType) ? 0 : 1;
    return aPref - bPref;
  });
  return near.slice(0, limit).map((review) => ({
    chunkId: review.chunkId,
    why: review.why || "Same document kind, different named party.",
  }));
}

/** Normalize legacy @cite:N@ markers from the model into [SN] for the answer UI. */
export function normalizeAnswerSourceMarkers(answer: string): string {
  return answer.replace(/@cite:(\d+)@/g, (_, index) => `[S${index}]`);
}

function stripTrailingCommas(text: string): string {
  return text.replace(/,\s*([\]}])/g, "$1");
}

/** Extract a JSON string field value even when the outer object is truncated. */
export function extractJsonStringField(
  text: string,
  fieldName: string,
): string | null {
  const keyPattern = new RegExp(`"${fieldName}"\\s*:\\s*"`, "u");
  const match = keyPattern.exec(text);
  if (!match || match.index == null) return null;
  let i = match.index + match[0].length;
  let value = "";
  let escape = false;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) {
      if (ch === "n") value += "\n";
      else if (ch === "r") value += "\r";
      else if (ch === "t") value += "\t";
      else value += ch;
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') return value;
    value += ch;
  }
  return value.length > 0 ? value : null;
}

function tryParseRepairedCorpusAnswerJson(
  text: string,
): Record<string, unknown> | null {
  let candidate = stripTrailingCommas(text.trim());
  const repairStack: string[] = [];
  let inString = false;
  let escape = false;
  for (const char of candidate) {
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") repairStack.push("}");
    else if (char === "[") repairStack.push("]");
    else if ((char === "}" || char === "]") && repairStack.at(-1) === char) {
      repairStack.pop();
    }
  }
  if (inString) candidate += '"';
  candidate += repairStack.reverse().join("");
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export function salvageGroundedAnswerFromText(
  text: string,
  sources: PackedAnswerSource[],
): Pick<
  CorpusGroundedAnswer,
  "answer" | "citations" | "confidence" | "notInArchive"
> & { reviews: CorpusAnswerReview[] } | null {
  const stripped = stripJsonFence(text);
  const repaired = tryParseRepairedCorpusAnswerJson(stripped);
  if (repaired) {
    return parseGroundedAnswerObject(repaired, sources);
  }

  const answerRaw = extractJsonStringField(stripped, "answer");
  if (!answerRaw?.trim()) return null;

  let reviewRows: unknown[] = [];
  const reviewIdx = stripped.indexOf('"review"');
  if (reviewIdx >= 0) {
    const arrayStart = stripped.indexOf("[", reviewIdx);
    if (arrayStart >= 0) {
      const slice = stripped.slice(arrayStart);
      const closed = tryParseRepairedCorpusAnswerJson(`{"review":${slice}`);
      if (closed && Array.isArray(closed.review)) {
        reviewRows = closed.review;
      }
    }
  }

  const reviews = parseSourceReviews(reviewRows, sources);
  const confidenceMatch = /"confidence"\s*:\s*"(high|medium|low|none)"/u.exec(
    stripped,
  );
  const notInArchive = /"notInArchive"\s*:\s*true/u.test(stripped);

  return {
    answer: normalizeAnswerSourceMarkers(answerRaw.trim()),
    citations: [],
    reviews,
    confidence: parseConfidence(confidenceMatch?.[1]),
    notInArchive,
  };
}

function parseGroundedAnswerObject(
  obj: Record<string, unknown>,
  sources: PackedAnswerSource[],
): Pick<
  CorpusGroundedAnswer,
  "answer" | "citations" | "confidence" | "notInArchive"
> & { reviews: CorpusAnswerReview[] } {
  const answerRaw =
    typeof obj.answer === "string" && obj.answer.trim()
      ? obj.answer.trim()
      : "The model did not return an answer.";

  return {
    answer: normalizeAnswerSourceMarkers(answerRaw),
    citations: [],
    reviews: parseSourceReviews(obj.review, sources),
    confidence: parseConfidence(obj.confidence),
    notInArchive: obj.notInArchive === true,
  };
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
    if (
      review.match !== "direct" ||
      !allowed.has(review.chunkId) ||
      byId.has(review.chunkId)
    ) {
      continue;
    }
    byId.set(review.chunkId, {
      chunkId: review.chunkId,
      why: review.why || "Marked relevant in source review.",
    });
  }
  const nearIds = new Set(
    params.reviews
      .filter((review) => review.match === "near")
      .map((review) => review.chunkId),
  );
  if (params.fileSeeking) {
    for (const source of params.sources) {
      if (source.sourceKind === "email_body") continue;
      if (!source.filenameHit || byId.has(source.chunkId)) continue;
      if (nearIds.has(source.chunkId)) continue;
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

const UNREADABLE_ANSWER_MESSAGE =
  "The model returned an answer we could not read. Try the search again.";

export function parseGroundedAnswerJson(
  text: string,
  sources: PackedAnswerSource[],
): Pick<
  CorpusGroundedAnswer,
  "answer" | "citations" | "confidence" | "notInArchive"
> & { reviews: CorpusAnswerReview[] } {
  const stripped = stripJsonFence(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const salvaged = salvageGroundedAnswerFromText(text, sources);
    if (salvaged) return salvaged;
    return {
      answer: UNREADABLE_ANSWER_MESSAGE,
      citations: [],
      reviews: [],
      confidence: "low",
      notInArchive: false,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    const salvaged = salvageGroundedAnswerFromText(text, sources);
    if (salvaged) return salvaged;
    return {
      answer: UNREADABLE_ANSWER_MESSAGE,
      citations: [],
      reviews: [],
      confidence: "low",
      notInArchive: false,
    };
  }

  return parseGroundedAnswerObject(parsed as Record<string, unknown>, sources);
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

  if (generated.truncated) {
    console.warn("[corpus-ask] answer output truncated", {
      finishReason: generated.finishReason,
      outputTokens: generated.usage.outputTokens,
      modelName,
    });
  }

  const parsed = parseGroundedAnswerJson(generated.text, sources);
  const citations = mergeAnswerCitations({
    sources,
    citations: [],
    reviews: parsed.reviews,
    fileSeeking,
  });
  const nearMisses = selectNearMisses(parsed.reviews, sources);
  return {
    answer: parsed.answer,
    citations,
    nearMisses,
    confidence: parsed.confidence,
    notInArchive: parsed.notInArchive,
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
