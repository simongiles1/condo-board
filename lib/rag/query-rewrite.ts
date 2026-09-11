import { generateWithSystemPrompt } from "@/lib/gemini/client";
import { estimateCostUsd } from "@/lib/gemini/usage";

const DEFAULT_REWRITE_MODEL = "gemini-3.7-flash";

function resolveCorpusRewriteModel(): string {
  return (
    process.env.GEMINI_MODEL_CORPUS?.trim() ||
    process.env.GEMINI_MODEL_EMAIL_ANALYSIS?.trim() ||
    DEFAULT_REWRITE_MODEL
  );
}

export const DEFAULT_CORPUS_REWRITE_MAX_TOKENS = 512;
export const MAX_LEXICAL_NEEDLES = 8;
export const MAX_RETRIEVAL_QUERY_CHARS = 500;

export type CorpusQueryRewrite = {
  originalQuery: string;
  retrievalQuery: string;
  lexicalNeedles: string[];
  fileSeeking: boolean;
};

export type CorpusRewriteUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type CorpusRewriteResult = {
  rewrite: CorpusQueryRewrite;
  usage: CorpusRewriteUsage;
};

const REWRITE_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "by",
  "from",
  "with",
  "pdf",
  "doc",
  "docx",
  "file",
  "files",
]);

export const CORPUS_QUERY_REWRITE_SYSTEM_PROMPT = `You rewrite search queries for a condo-board email and PDF attachment archive.

Return JSON only:
{
  "retrievalQuery": "one search string for vector retrieval",
  "lexicalNeedles": ["short", "tokens"],
  "fileSeeking": true
}

Rules:
- retrievalQuery keeps the user's meaning and adds synonyms, acronyms, and abbreviations that would appear in emails or filenames. Expand in BOTH directions when the question uses a full phrase or an acronym that commonly maps to the other form in business documents.
- Keep every proper name, date, unit number, and filename the user mentioned.
- For person names, add common alternate spellings and transliterations (one- or two-letter differences such as Hyder/Haider) to retrievalQuery and lexicalNeedles. Do not drop the user's spelling.
- Do not invent vendors, files, dates, or amounts that are not implied by the question.
- lexicalNeedles: 0-8 distinctive tokens for filename and email LIKE match (acronyms, person names, vendor names, distinctive filename fragments). 3-40 characters. No stopwords.
- fileSeeking is true when the user is looking for a file, PDF, or attachment rather than only asking a content question.
- Do not answer the question.`;

export function fallbackRewrite(query: string): CorpusQueryRewrite {
  const trimmed = query.trim();
  return {
    originalQuery: trimmed,
    retrievalQuery: trimmed,
    lexicalNeedles: [],
    fileSeeking: false,
  };
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*)\r?\n```\s*$/i.exec(trimmed);
  if (fenced) return fenced[1].trim();
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export function sanitizeLexicalNeedle(
  raw: string,
  minLen = 3,
): string | null {
  const cleaned = raw.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < minLen || cleaned.length > 40) return null;
  if (REWRITE_STOPWORDS.has(cleaned.toLowerCase())) return null;
  return cleaned;
}

/** All-caps tokens in the rewritten query (AGM, RFS, COI, PM) become LIKE needles. */
export function acronymNeedlesFromText(text: string): string[] {
  const matches = text.match(/\b[A-Z]{2,6}\b/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const needle = sanitizeLexicalNeedle(match, 2);
    if (!needle) continue;
    const key = needle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(needle);
  }
  return out;
}

export function parseQueryRewriteJson(
  originalQuery: string,
  text: string,
): CorpusQueryRewrite {
  const fallback = fallbackRewrite(originalQuery);
  const stripped = stripJsonFence(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== "object") return fallback;

  const obj = parsed as Record<string, unknown>;
  const retrievalRaw =
    typeof obj.retrievalQuery === "string" ? obj.retrievalQuery.trim() : "";
  const retrievalQuery = (
    retrievalRaw || fallback.retrievalQuery
  ).slice(0, MAX_RETRIEVAL_QUERY_CHARS);

  const fromModel = Array.isArray(obj.lexicalNeedles)
    ? obj.lexicalNeedles.flatMap((row) => {
        if (typeof row !== "string") return [];
        const needle = sanitizeLexicalNeedle(row);
        return needle ? [needle] : [];
      })
    : [];

  const needles: string[] = [];
  const seen = new Set<string>();
  for (const needle of [...fromModel, ...acronymNeedlesFromText(retrievalQuery)]) {
    const key = needle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    needles.push(needle);
    if (needles.length >= MAX_LEXICAL_NEEDLES) break;
  }

  return {
    originalQuery: fallback.originalQuery,
    retrievalQuery,
    lexicalNeedles: needles,
    fileSeeking: obj.fileSeeking === true,
  };
}

export function resolveCorpusRewriteMaxTokens(): number {
  const raw = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS_CORPUS_REWRITE);
  if (Number.isFinite(raw) && raw > 0) return Math.min(2048, raw);
  return DEFAULT_CORPUS_REWRITE_MAX_TOKENS;
}

export async function rewriteCorpusQuery(
  query: string,
): Promise<CorpusRewriteResult> {
  const originalQuery = query.trim();
  const fallback = fallbackRewrite(originalQuery);
  if (!originalQuery) {
    return {
      rewrite: fallback,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };
  }

  const modelName = resolveCorpusRewriteModel();
  const generated = await generateWithSystemPrompt({
    systemInstruction: CORPUS_QUERY_REWRITE_SYSTEM_PROMPT,
    userText: `QUESTION\n${originalQuery}`,
    modelName,
    maxOutputTokens: resolveCorpusRewriteMaxTokens(),
  });

  return {
    rewrite: parseQueryRewriteJson(originalQuery, generated.text),
    usage: {
      inputTokens: generated.usage.inputTokens,
      outputTokens: generated.usage.outputTokens,
      costUsd: estimateCostUsd(modelName, generated.usage),
    },
  };
}
