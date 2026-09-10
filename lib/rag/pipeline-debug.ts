import type { CorpusQueryRewrite } from "@/lib/rag/query-rewrite";
import { uniqueResultsByFile } from "@/lib/rag/rerank";
import type { CorpusSearchResult } from "@/lib/rag/search";

export type CorpusPipelineHowFound =
  | "filename"
  | "filename-needle"
  | "semantic";

export type CorpusPipelineHit = {
  rank: number;
  chunkId: string;
  label: string;
  sourceKind: CorpusSearchResult["sourceKind"];
  similarity: number;
  howFound: CorpusPipelineHowFound;
  pageNo: number | null;
  excerpt: string;
  documentType?: string | null;
};

export type CorpusAskPipeline = {
  rewrite: {
    originalQuery: string;
    retrievalQuery: string;
    lexicalNeedles: string[];
    fileSeeking: boolean;
  };
  retrieval: {
    count: number;
    uniqueFileCount: number;
    filenameHits: number;
    hits: CorpusPipelineHit[];
  };
  rerank: {
    uniqueCount: number;
    selectedIds: string[];
    hits: CorpusPipelineHit[];
  } | null;
  packed: {
    count: number;
    hits: CorpusPipelineHit[];
  } | null;
  citedChunkIds: string[];
};

function howFound(result: CorpusSearchResult): CorpusPipelineHowFound {
  if (result.metadata.filenameMatch === true) return "filename";
  if (result.metadata.filenameAlias === true) return "filename-needle";
  return "semantic";
}

export function compactPipelineHit(
  result: CorpusSearchResult,
  rank: number,
  fileCards?: Map<string, { documentType: string }>,
): CorpusPipelineHit {
  const filename =
    typeof result.metadata.filename === "string" ? result.metadata.filename : "";
  const excerpt = result.excerpt.replace(/\s+/g, " ").trim().slice(0, 180);
  const card = result.contentHash ? fileCards?.get(result.contentHash) : undefined;
  return {
    rank,
    chunkId: result.id,
    label:
      filename ||
      result.metadata.subject ||
      (result.sourceKind === "email_body" ? "Email" : "Attachment"),
    sourceKind: result.sourceKind,
    similarity: result.similarity,
    howFound: howFound(result),
    pageNo: result.pageNo,
    excerpt,
    documentType: card?.documentType ?? null,
  };
}

export function buildCorpusAskPipeline(params: {
  query: string;
  rewrite?: CorpusQueryRewrite;
  retrieval: CorpusSearchResult[];
  reranked?: CorpusSearchResult[];
  selectedIds?: string[];
  packedLimit: number;
  citedChunkIds?: string[];
  fileCards?: Map<string, { documentType: string }>;
}): CorpusAskPipeline {
  const rewrite = params.rewrite ?? {
    originalQuery: params.query,
    retrievalQuery: params.query,
    lexicalNeedles: [],
    fileSeeking: false,
  };
  const uniqueRetrieval = uniqueResultsByFile(params.retrieval);
  const packedHits = params.reranked
    ? params.reranked
        .slice(0, params.packedLimit)
        .map((result, index) =>
          compactPipelineHit(result, index + 1, params.fileCards),
        )
    : null;

  return {
    rewrite: {
      originalQuery: rewrite.originalQuery,
      retrievalQuery: rewrite.retrievalQuery,
      lexicalNeedles: rewrite.lexicalNeedles,
      fileSeeking: rewrite.fileSeeking,
    },
    retrieval: {
      count: params.retrieval.length,
      uniqueFileCount: uniqueRetrieval.length,
      filenameHits: params.retrieval.filter(
        (row) =>
          row.metadata.filenameMatch === true ||
          row.metadata.filenameAlias === true,
      ).length,
      hits: params.retrieval.map((result, index) =>
        compactPipelineHit(result, index + 1, params.fileCards),
      ),
    },
    rerank: params.reranked
      ? {
          uniqueCount: params.reranked.length,
          selectedIds: params.selectedIds ?? [],
          hits: params.reranked.map((result, index) =>
            compactPipelineHit(result, index + 1, params.fileCards),
          ),
        }
      : null,
    packed: packedHits
      ? { count: packedHits.length, hits: packedHits }
      : null,
    citedChunkIds: params.citedChunkIds ?? [],
  };
}
