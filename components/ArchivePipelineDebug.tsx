"use client";

import React, { useMemo, useState } from "react";

import type { CorpusAskPipeline, CorpusPipelineHit } from "@/lib/rag/pipeline-debug";

function kindLabel(kind: CorpusPipelineHit["sourceKind"]): string {
  if (kind === "email_body") return "Email";
  if (kind === "attachment_markdown") return "Attachment";
  return "Vision page";
}

function howFoundLabel(howFound: CorpusPipelineHit["howFound"]): string {
  if (howFound === "filename") return "Name match";
  if (howFound === "filename-needle") return "Name needle";
  return "Semantic";
}

function hitMatches(hit: CorpusPipelineHit, find: string): boolean {
  const needle = find.trim().toLowerCase();
  if (!needle) return false;
  return (
    hit.label.toLowerCase().includes(needle) ||
    hit.excerpt.toLowerCase().includes(needle)
  );
}

function presenceLabel(
  pipeline: CorpusAskPipeline,
  find: string,
): string | null {
  const needle = find.trim().toLowerCase();
  if (!needle) return null;
  const inRetrieval = pipeline.retrieval.hits.some((hit) =>
    hitMatches(hit, find),
  );
  const inPacked = pipeline.packed?.hits.some((hit) => hitMatches(hit, find)) ?? false;
  const inCited = pipeline.citedChunkIds.some((id) => {
    const hit =
      pipeline.packed?.hits.find((row) => row.chunkId === id) ??
      pipeline.rerank?.hits.find((row) => row.chunkId === id) ??
      pipeline.retrieval.hits.find((row) => row.chunkId === id);
    return hit ? hitMatches(hit, find) : false;
  });
  if (!inRetrieval) return "Not in retrieval pool — the later stages never saw it.";
  if (pipeline.packed && !inPacked) {
    return "In retrieval, but not packed into the answer prompt.";
  }
  if (pipeline.packed && inPacked && pipeline.citedChunkIds.length > 0 && !inCited) {
    return "Packed into the answer prompt, but not cited as a source.";
  }
  if (inCited) return "Retrieved, packed, and cited.";
  return "In the retrieval pool.";
}

function HitRows({
  hits,
  find,
  citedIds,
  packedIds,
}: {
  hits: CorpusPipelineHit[];
  find: string;
  citedIds?: Set<string>;
  packedIds?: Set<string>;
}) {
  if (hits.length === 0) {
    return <p className="text-xs text-slate-500">No hits.</p>;
  }
  return (
    <ol className="max-h-80 space-y-1 overflow-auto text-xs">
      {hits.map((hit) => {
        const highlight = hitMatches(hit, find);
        const cited = citedIds?.has(hit.chunkId) ?? false;
        const packed = packedIds?.has(hit.chunkId) ?? false;
        return (
          <li
            key={`${hit.rank}:${hit.chunkId}`}
            className={`rounded-md border px-2 py-1.5 ${
              highlight
                ? "border-amber-300 bg-amber-50"
                : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-semibold tabular-nums text-slate-500">
                #{hit.rank}
              </span>
              <span className="font-medium text-slate-900">{hit.label}</span>
              {hit.pageNo != null ? (
                <span className="text-slate-500">p.{hit.pageNo}</span>
              ) : null}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-slate-600">
              <span>{Math.round(hit.similarity * 100)}% match</span>
              <span>{kindLabel(hit.sourceKind)}</span>
              <span>{howFoundLabel(hit.howFound)}</span>
              {hit.documentType ? (
                <span className="rounded bg-sky-100 px-1 font-medium text-sky-800">
                  {hit.documentType}
                </span>
              ) : null}
              {packed ? (
                <span className="font-medium text-teal-800">Packed</span>
              ) : null}
              {cited ? (
                <span className="font-medium text-teal-800">Cited</span>
              ) : null}
            </div>
            {hit.excerpt ? (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">
                {hit.excerpt}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Stage({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details open className="rounded-lg border border-slate-200 bg-slate-50/80">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-800">
        {n}. {title}
      </summary>
      <div className="space-y-2 border-t border-slate-200 px-3 py-3 text-sm text-slate-700">
        {children}
      </div>
    </details>
  );
}

export function ArchivePipelineDebug({
  pipeline,
}: {
  pipeline: CorpusAskPipeline;
}) {
  const [find, setFind] = useState("");
  const citedIds = useMemo(
    () => new Set(pipeline.citedChunkIds),
    [pipeline.citedChunkIds],
  );
  const packedIds = useMemo(
    () => new Set(pipeline.packed?.hits.map((hit) => hit.chunkId) ?? []),
    [pipeline.packed],
  );
  const status = presenceLabel(pipeline, find);

  return (
    <div className="mb-4 rounded-xl border border-slate-300 bg-white p-4 shadow-xs">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-slate-800 uppercase">
            Pipeline
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-600">
            Rewrite expands the question. Retrieval mixes filename matches with
            embeddings (not embeddings alone). Rerank reorders unique files.
            The answerer only reads the packed files; Sources are what it cited,
            not the full pool.
          </p>
        </div>
        <label className="block min-w-[16rem] flex-1 text-xs text-slate-600">
          Find a filename
          <input
            type="search"
            value={find}
            onChange={(event) => setFind(event.target.value)}
            placeholder="e.g. RFS Signed.pdf"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 shadow-xs placeholder:text-slate-400 focus:border-teal-500 focus:outline-hidden"
          />
        </label>
      </div>

      {status ? (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          {status}
        </p>
      ) : null}

      <div className="space-y-2">
        <Stage n={1} title="Query rewrite">
          <p>
            <span className="font-medium text-slate-500">Input · </span>
            {pipeline.rewrite.originalQuery || "—"}
          </p>
          <p>
            <span className="font-medium text-slate-500">
              Output · retrieval query ·{" "}
            </span>
            {pipeline.rewrite.retrievalQuery || "—"}
          </p>
          <p>
            <span className="font-medium text-slate-500">
              Output · filename/email needles ·{" "}
            </span>
            {pipeline.rewrite.lexicalNeedles.length > 0
              ? pipeline.rewrite.lexicalNeedles.join(", ")
              : "none"}
          </p>
          <p>
            <span className="font-medium text-slate-500">
              Output · looking for a file ·{" "}
            </span>
            {pipeline.rewrite.fileSeeking ? "yes" : "no"}
          </p>
        </Stage>

        <Stage n={2} title="Retrieval pool">
          <p className="text-xs text-slate-600">
            Input: rewritten query + needles. Output:{" "}
            {pipeline.retrieval.count} excerpts (
            {pipeline.retrieval.uniqueFileCount} unique files,{" "}
            {pipeline.retrieval.filenameHits} filename hits). Embeddings are
            only one source — filenames and covering emails also contribute.
          </p>
          <HitRows hits={pipeline.retrieval.hits} find={find} />
        </Stage>

        {pipeline.rerank ? (
          <Stage n={3} title="Rerank unique files">
            <p className="text-xs text-slate-600">
              Input: unique files from retrieval. Output: model reorder (
              {pipeline.rerank.uniqueCount} files
              {pipeline.rerank.selectedIds.length === 0
                ? "; used retrieval order"
                : ""}
              ).
            </p>
            <HitRows
              hits={pipeline.rerank.hits}
              find={find}
              packedIds={packedIds}
            />
          </Stage>
        ) : null}

        {pipeline.packed ? (
          <Stage n={4} title="Answer prompt and citations">
            <p className="text-xs text-slate-600">
              Input: top {pipeline.packed.count} reranked files packed into the
              answer prompt. Output: cited sources, including packed attachments
              found by filename on file-seeking questions even if the prose
              skipped them.
            </p>
            <HitRows
              hits={pipeline.packed.hits}
              find={find}
              packedIds={packedIds}
              citedIds={citedIds}
            />
          </Stage>
        ) : null}
      </div>
    </div>
  );
}
