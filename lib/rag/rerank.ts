import { generateWithSystemPrompt } from "@/lib/gemini/client";
import { estimateCostUsd } from "@/lib/gemini/usage";
import {
  loadAttachmentFileCards,
  type AttachmentFileCardLookup,
} from "@/lib/rag/file-card-runs";
import type { CorpusSearchResult } from "@/lib/rag/search";

export const DEFAULT_CORPUS_RERANK_MAX_TOKENS = 2048;

export type CorpusRerankUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type CorpusRerankResult = {
  ordered: CorpusSearchResult[];
  selectedIds: string[];
  usage: CorpusRerankUsage;
};

const DEFAULT_RERANK_MODEL = "gemini-3.7-flash";

function resolveCorpusRerankModel(): string {
  return (
    process.env.GEMINI_MODEL_CORPUS?.trim() ||
    process.env.GEMINI_MODEL_EMAIL_ANALYSIS?.trim() ||
    DEFAULT_RERANK_MODEL
  );
}

export function resolveCorpusRerankMaxTokens(): number {
  const raw = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS_CORPUS_RERANK);
  if (Number.isFinite(raw) && raw > 0) return Math.min(4096, raw);
  return DEFAULT_CORPUS_RERANK_MAX_TOKENS;
}

export const CORPUS_RERANK_SYSTEM_PROMPT = `You reorder retrieved archive hits so the best answers come first.

Return JSON only:
{
  "chunkIds": ["id", "..."]
}

Rules:
- chunkIds is CANDIDATES reordered best-first. Copy every candidate chunkId exactly once when possible.
- Retrieval rank and similarity are hints only. A later hit can be the file or email the user wants.
- Judge each candidate against the question. Use the filename/subject and the excerpt. Do not prefer a document type (draft, proposal, signed, final, update, tables) unless the question asks for that.
- An excerpt that discusses a topic is weaker evidence than a filename that is the document.
- If the question names several parties, put a matching source for each near the top when present.
- Do not invent ids. Do not answer the question.`;

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*)\r?\n```\s*$/i.exec(trimmed);
  if (fenced) return fenced[1].trim();
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const stripped = stripJsonFence(text);
  const attempts = [stripped];
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    attempts.push(stripped.slice(start, end + 1));
  }
  for (const attempt of attempts) {
    try {
      const parsed: unknown = JSON.parse(attempt);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next
    }
  }
  return null;
}

export function parseRerankJson(
  text: string,
  allowedIds: string[],
): string[] {
  const allowed = new Set(allowedIds);
  const parsed = extractJsonObject(text);
  if (!parsed) return [];
  const raw = parsed.chunkIds ?? parsed.ids;
  if (!Array.isArray(raw)) return [];

  const selected: string[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (typeof row !== "string") continue;
    const id = row.trim();
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    selected.push(id);
  }
  return selected;
}

export function uniqueResultsByFile(
  results: CorpusSearchResult[],
): CorpusSearchResult[] {
  const seen = new Set<string>();
  const out: CorpusSearchResult[] = [];
  for (const row of results) {
    const attachmentId =
      typeof row.metadata.attachmentId === "string"
        ? row.metadata.attachmentId
        : null;
    const filename =
      typeof row.metadata.filename === "string" ? row.metadata.filename : null;
    const key =
      row.sourceKind === "email_body"
        ? `email:${row.emailId ?? row.id}`
        : row.contentHash ||
          (attachmentId ? `att:${attachmentId}` : null) ||
          (filename ? `file:${filename}` : row.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function applyRerankOrder(
  results: CorpusSearchResult[],
  selectedIds: string[],
): CorpusSearchResult[] {
  const byId = new Map(results.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const ordered: CorpusSearchResult[] = [];

  for (const id of selectedIds) {
    const row = byId.get(id);
    if (!row || seen.has(id)) continue;
    seen.add(id);
    ordered.push(row);
  }
  for (const row of results) {
    if (seen.has(row.id)) continue;
    ordered.push(row);
  }
  return ordered;
}

export function buildRerankUserText(params: {
  query: string;
  results: CorpusSearchResult[];
  limit: number;
  fileCards?: Map<string, AttachmentFileCardLookup>;
}): string {
  const candidates = params.results.map((result, index) => {
    const label =
      result.metadata.filename ||
      result.metadata.subject ||
      (result.sourceKind === "email_body" ? "Email" : "Attachment");
    const page = result.pageNo != null ? ` page ${result.pageNo}` : "";
    const card =
      result.contentHash ? params.fileCards?.get(result.contentHash) : undefined;
    const excerpt =
      card && card.status === "ready"
        ? `[${card.documentType}] ${card.summary}`
        : result.excerpt.replace(/\s+/g, " ").trim();

    return [
      `${index + 1}. chunkId: ${result.id}`,
      `   rank: ${index + 1}`,
      `   kind: ${result.sourceKind}${page}`,
      `   label: ${label}`,
      `   similarity: ${Math.round(result.similarity * 100)}%`,
      result.metadata.filenameMatch ? "   filenameMatch: yes" : null,
      result.metadata.filenameAlias ? "   filenameAlias: yes" : null,
      `   excerpt: ${excerpt}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  });

  return [
    `QUESTION\n${params.query}`,
    `LIMIT\n${params.limit}`,
    `CANDIDATES\n${candidates.join("\n")}`,
  ].join("\n\n");
}

const EMPTY_RERANK_USAGE: CorpusRerankUsage = {
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
};

export async function rerankCorpusResults(params: {
  query: string;
  results: CorpusSearchResult[];
  limit: number;
  fileCards?: Map<string, AttachmentFileCardLookup>;
}): Promise<CorpusRerankResult> {
  const results = uniqueResultsByFile(params.results);
  if (results.length <= 1) {
    return {
      ordered: results,
      selectedIds: results.map((row) => row.id),
      usage: EMPTY_RERANK_USAGE,
    };
  }

  let fileCards = params.fileCards;
  if (!fileCards) {
    const hashes = Array.from(
      new Set(
        results
          .map((r) => r.contentHash)
          .filter((h): h is string => Boolean(h)),
      ),
    );
    if (hashes.length > 0) {
      try {
        fileCards = await loadAttachmentFileCards(hashes);
      } catch (err) {
        console.warn("[corpus-ask] Failed to load file cards for rerank:", err);
      }
    }
  }

  const allowedIds = results.map((row) => row.id);
  const modelName = resolveCorpusRerankModel();
  try {
    const generated = await generateWithSystemPrompt({
      systemInstruction: CORPUS_RERANK_SYSTEM_PROMPT,
      userText: buildRerankUserText({
        query: params.query,
        results,
        limit: Math.min(params.limit, results.length),
        fileCards,
      }),
      modelName,
      maxOutputTokens: resolveCorpusRerankMaxTokens(),
    });
    const selectedIds = parseRerankJson(generated.text, allowedIds);
    if (generated.truncated && selectedIds.length === 0) {
      console.error(
        "[corpus-ask] rerank JSON missing after truncation; using unique-file retrieval order",
      );
    }
    return {
      ordered: applyRerankOrder(results, selectedIds),
      selectedIds,
      usage: {
        inputTokens: generated.usage.inputTokens,
        outputTokens: generated.usage.outputTokens,
        costUsd: estimateCostUsd(modelName, generated.usage),
      },
    };
  } catch (err) {
    console.error("[corpus-ask] rerank failed; using unique-file retrieval order:", err);
    return {
      ordered: results,
      selectedIds: [],
      usage: EMPTY_RERANK_USAGE,
    };
  }
}
