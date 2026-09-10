/** Client-safe corpus answer types and constants (no DB / Node imports). */

export const DEFAULT_CORPUS_ANSWER_MODEL = "gemini-3.7-flash";
/** After rerank, pack this many unique files into the grounded answer. */
export const MAX_ANSWER_CONTEXT_CHUNKS = 15;
export const MAX_ANSWER_CHUNK_CHARS = 900;

export type CorpusAnswerCitation = {
  chunkId: string;
  why: string;
};

export type CorpusAnswerConfidence = "high" | "medium" | "low" | "none";

export type CorpusAnswerUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type CorpusGroundedAnswer = {
  answer: string;
  citations: CorpusAnswerCitation[];
  confidence: CorpusAnswerConfidence;
  notInArchive: boolean;
  modelName: string;
  usage: CorpusAnswerUsage;
};
