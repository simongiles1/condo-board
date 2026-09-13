/**
 * Discover recurring document series from file cards: embed, cluster, LLM name/merge.
 */

import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { estimateDeepSeekCostBreakdown } from "@/lib/deepseek/pricing";
import {
  clusterByCosine,
  clusterLooksRecurring,
  DOCUMENT_SERIES_NAME_SYSTEM_PROMPT,
  parseJsonObjectText,
  parseSeriesNameProposals,
  buildSeriesIdentityText,
  type SeriesNameProposal,
} from "@/lib/documents/series-shared";
import {
  createDocumentSeriesRun,
  getDocumentSeriesRun,
  listExistingSeriesForDiscovery,
  listRunningDocumentSeriesRuns,
  loadSeriesDiscoveryDocs,
  replaceDiscoveryMembership,
  updateDocumentSeriesRun,
  type SeriesDiscoveryDoc,
} from "@/lib/documents/series";
import { EMBEDDING_MODEL, embedTexts } from "@/lib/rag/embed";
import { estimateCostUsd } from "@/lib/gemini/usage";

const SERIES_NAME_MODEL = "deepseek-v4-flash";
const SAMPLES_PER_CLUSTER = 6;
const CLUSTERS_PER_LLM_CALL = 28;

const activeWorkers = new Map<string, Promise<void>>();

export function isDocumentSeriesWorkerAlive(runId: string): boolean {
  return activeWorkers.has(runId);
}

export function kickDocumentSeriesWorker(runId: string): void {
  void waitForDocumentSeriesWorker(runId);
}

export function waitForDocumentSeriesWorker(runId: string): Promise<void> {
  const existing = activeWorkers.get(runId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      await runDocumentSeriesWorker(runId);
    } catch (err) {
      console.error(`[document-series] unhandled failure for run ${runId}:`, err);
      try {
        await updateDocumentSeriesRun(runId, {
          status: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
          completedAt: new Date().toISOString(),
        });
      } catch {
        // ignore secondary error
      }
    } finally {
      activeWorkers.delete(runId);
    }
  })();

  activeWorkers.set(runId, promise);
  return promise;
}

export async function startDocumentSeriesDiscovery(): Promise<{ runId: string }> {
  const running = await listRunningDocumentSeriesRuns();
  if (running[0]) {
    kickDocumentSeriesWorker(running[0].id);
    return { runId: running[0].id };
  }
  const run = await createDocumentSeriesRun();
  kickDocumentSeriesWorker(run.id);
  return { runId: run.id };
}

export async function resumeDocumentSeriesWorkersOnStartup(): Promise<void> {
  const running = await listRunningDocumentSeriesRuns();
  for (const run of running) {
    kickDocumentSeriesWorker(run.id);
  }
}

async function stillRunning(runId: string): Promise<boolean> {
  const run = await getDocumentSeriesRun(runId);
  return run?.status === "running";
}

type RecurringCluster = {
  clusterId: number;
  docs: SeriesDiscoveryDoc[];
};

function buildNameUserPrompt(params: {
  clusters: RecurringCluster[];
  existing: Array<{
    id: string;
    title: string;
    description: string;
    usage: string | null;
  }>;
}): string {
  const clusterBlocks = params.clusters.map((cluster) => {
    const samples = cluster.docs.slice(0, SAMPLES_PER_CLUSTER).map((doc, index) => {
      const date = doc.documentDate || doc.receivedAt.slice(0, 10);
      return `  ${index + 1}. ${doc.filename} (${date}) — ${doc.summary.slice(0, 220)}`;
    });
    return `Cluster ${cluster.clusterId} (${cluster.docs.length} files)\n${samples.join("\n")}`;
  });

  const existingBlock =
    params.existing.length === 0
      ? "None yet."
      : params.existing
          .map(
            (row) =>
              `- ${row.id} | ${row.title}${row.usage ? ` [${row.usage}]` : ""}${
                row.description ? ` — ${row.description}` : ""
              }`,
          )
          .join("\n");

  return `Existing series (reuse existingId when the role already exists):
${existingBlock}

Candidate clusters:
${clusterBlocks.join("\n\n")}`;
}

async function nameClusters(params: {
  clusters: RecurringCluster[];
  existing: Array<{
    id: string;
    title: string;
    description: string;
    usage: string | null;
  }>;
}): Promise<{
  proposals: SeriesNameProposal[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}> {
  const knownIds = new Set(params.clusters.map((c) => c.clusterId));
  const existingIds = new Set(params.existing.map((row) => row.id));
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  const proposals: SeriesNameProposal[] = [];

  for (let offset = 0; offset < params.clusters.length; offset += CLUSTERS_PER_LLM_CALL) {
    const batch = params.clusters.slice(offset, offset + CLUSTERS_PER_LLM_CALL);
    const result = await generateDeepSeekJson({
      systemInstruction: DOCUMENT_SERIES_NAME_SYSTEM_PROMPT,
      userText: buildNameUserPrompt({ clusters: batch, existing: params.existing }),
      modelName: SERIES_NAME_MODEL,
      maxOutputTokens: 4096,
      thinking: false,
    });
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;
    costUsd += estimateDeepSeekCostBreakdown({
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    }).totalCostUsd;

    const parsed = parseSeriesNameProposals(
      parseJsonObjectText(result.text),
      new Set(batch.map((c) => c.clusterId)),
      existingIds,
    );
    proposals.push(...parsed);
  }

  const seen = new Set<number>();
  const deduped: SeriesNameProposal[] = [];
  for (const proposal of proposals) {
    proposal.clusterIds = proposal.clusterIds.filter((id) => {
      if (!knownIds.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (proposal.clusterIds.length === 0 && !proposal.existingId) continue;
    deduped.push(proposal);
  }
  return { proposals: deduped, inputTokens, outputTokens, costUsd };
}

export async function runDocumentSeriesWorker(runId: string): Promise<void> {
  const initial = await getDocumentSeriesRun(runId);
  if (!initial || initial.status !== "running") return;

  const docs = await loadSeriesDiscoveryDocs();
  await updateDocumentSeriesRun(runId, {
    totalDocs: docs.length,
    currentLabel: `Embedding ${docs.length} file card(s)…`,
  });

  if (docs.length === 0) {
    await updateDocumentSeriesRun(runId, {
      status: "completed",
      seriesCount: 0,
      clusteredDocs: 0,
      currentLabel: "No file cards to cluster.",
      completedAt: new Date().toISOString(),
    });
    return;
  }

  const freeDocs = docs.filter((doc) => !doc.locked);
  const lockedHashes = new Set(
    docs.filter((doc) => doc.locked).map((doc) => doc.contentHash),
  );

  const identityTexts = freeDocs.map((doc) =>
    buildSeriesIdentityText({
      filename: doc.filename,
      documentType: doc.documentType,
      documentDate: doc.documentDate,
      coveringEmailContext: doc.coveringEmailContext,
      summary: doc.summary,
    }),
  );

  const embedded = await embedTexts(identityTexts);
  if (!(await stillRunning(runId))) return;

  const embedCost = estimateCostUsd(EMBEDDING_MODEL, {
    inputTokens: embedded.usage.inputTokens,
    outputTokens: 0,
  });

  await updateDocumentSeriesRun(runId, {
    embedTokens: embedded.usage.inputTokens,
    currentLabel: "Clustering similar documents…",
    totalCostUsd: embedCost.toFixed(6),
  });

  const groups = clusterByCosine(embedded.vectors);
  const recurring: RecurringCluster[] = [];
  let nextId = 0;
  let clusteredDocs = 0;
  for (const indexes of groups) {
    const clusterDocs = indexes
      .map((index) => freeDocs[index])
      .filter((doc): doc is SeriesDiscoveryDoc => Boolean(doc));
    const dates = clusterDocs.map((doc) => doc.documentDate || doc.receivedAt);
    if (!clusterLooksRecurring(dates)) continue;
    clusteredDocs += clusterDocs.length;
    recurring.push({ clusterId: nextId, docs: clusterDocs });
    nextId += 1;
  }

  await updateDocumentSeriesRun(runId, {
    clusteredDocs,
    currentLabel: `Naming ${recurring.length} recurring cluster(s)…`,
  });

  const existing = await listExistingSeriesForDiscovery();
  const named =
    recurring.length === 0
      ? { proposals: [] as SeriesNameProposal[], inputTokens: 0, outputTokens: 0, costUsd: 0 }
      : await nameClusters({ clusters: recurring, existing });

  if (!(await stillRunning(runId))) return;

  const clusterById = new Map(recurring.map((c) => [c.clusterId, c]));
  const seriesForWrite = named.proposals
    .filter((proposal) => !proposal.drop)
    .map((proposal) => {
      const hashes = proposal.clusterIds.flatMap((id) =>
        (clusterById.get(id)?.docs ?? []).map((doc) => doc.contentHash),
      );
      return {
        existingId: proposal.existingId,
        title: proposal.title,
        description: proposal.description,
        usage: proposal.usage,
        contentHashes: [...new Set(hashes)],
      };
    })
    .filter((row) => row.contentHashes.length >= 2 || row.existingId);

  const seriesCount = await replaceDiscoveryMembership({
    runId,
    series: seriesForWrite,
    lockedHashes,
  });

  const totalCost = embedCost + named.costUsd;
  await updateDocumentSeriesRun(runId, {
    status: "completed",
    seriesCount,
    clusteredDocs,
    embedTokens: embedded.usage.inputTokens,
    llmInputTokens: named.inputTokens,
    llmOutputTokens: named.outputTokens,
    totalCostUsd: totalCost.toFixed(6),
    currentLabel: `Found ${seriesCount} recurring type(s).`,
    completedAt: new Date().toISOString(),
  });
}
