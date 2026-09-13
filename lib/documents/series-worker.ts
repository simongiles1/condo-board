/**
 * Discover recurring document series from file cards: catalog types, then assign.
 */

import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { estimateDeepSeekCostBreakdown } from "@/lib/deepseek/pricing";
import {
  clusterLooksRecurring,
  DOCUMENT_SERIES_ASSIGN_BATCH_SIZE,
  DOCUMENT_SERIES_ASSIGN_SYSTEM_PROMPT,
  DOCUMENT_SERIES_CATALOG_SYSTEM_PROMPT,
  parseJsonObjectText,
  parseSeriesAssignments,
  parseSeriesCatalog,
  sampleSeriesDiscoveryDocs,
  seriesKeyFromTitle,
  type SeriesCatalogEntry,
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

const SERIES_MODEL = "deepseek-v4-flash";

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

function formatCardLine(doc: SeriesDiscoveryDoc, index: number): string {
  const date = doc.documentDate || doc.receivedAt.slice(0, 10);
  const summary = doc.summary.replace(/\s+/g, " ").trim().slice(0, 220);
  const covering = doc.coveringEmailContext.replace(/\s+/g, " ").trim().slice(0, 120);
  const cover = covering ? ` | email: ${covering}` : "";
  return `  ${index}. ${doc.filename} [${doc.documentType}] (${date}) — ${summary}${cover}`;
}

function catalogFromExisting(
  existing: Array<{
    id: string;
    title: string;
    description: string;
    usage: SeriesCatalogEntry["usage"];
  }>,
): Map<string, SeriesCatalogEntry> {
  const catalog = new Map<string, SeriesCatalogEntry>();
  for (const row of existing) {
    let key = seriesKeyFromTitle(row.title);
    if (catalog.has(key)) {
      let n = 2;
      while (catalog.has(`${key}-${n}`)) n += 1;
      key = `${key}-${n}`;
    }
    catalog.set(key, {
      key,
      title: row.title,
      description: row.description,
      usage: row.usage,
      existingId: row.id,
    });
  }
  return catalog;
}

function mergeCatalogEntry(
  catalog: Map<string, SeriesCatalogEntry>,
  entry: SeriesCatalogEntry,
): void {
  if (entry.existingId) {
    for (const [key, current] of catalog) {
      if (current.existingId === entry.existingId) {
        catalog.set(key, { ...current, ...entry, key, existingId: entry.existingId });
        return;
      }
    }
  }
  if (catalog.has(entry.key)) {
    const current = catalog.get(entry.key)!;
    catalog.set(entry.key, {
      ...current,
      title: entry.title || current.title,
      description: entry.description || current.description,
      usage: entry.usage ?? current.usage,
      existingId: entry.existingId ?? current.existingId,
    });
    return;
  }
  catalog.set(entry.key, entry);
}

async function proposeCatalog(params: {
  samples: SeriesDiscoveryDoc[];
  existing: Array<{
    id: string;
    title: string;
    description: string;
    usage: SeriesCatalogEntry["usage"];
  }>;
}): Promise<{
  entries: SeriesCatalogEntry[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}> {
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
  const sampleBlock = params.samples
    .map((doc, index) => formatCardLine(doc, index + 1))
    .join("\n");

  const result = await generateDeepSeekJson({
    systemInstruction: DOCUMENT_SERIES_CATALOG_SYSTEM_PROMPT,
    userText: `Existing series (reuse existingId when the role already exists):
${existingBlock}

Diverse file-card sample:
${sampleBlock}`,
    modelName: SERIES_MODEL,
    maxOutputTokens: 4096,
    thinking: false,
  });

  const existingIds = new Set(params.existing.map((row) => row.id));
  return {
    entries: parseSeriesCatalog(parseJsonObjectText(result.text), existingIds),
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: estimateDeepSeekCostBreakdown({
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    }).totalCostUsd,
  };
}

function formatCatalogBlock(catalog: Map<string, SeriesCatalogEntry>): string {
  if (catalog.size === 0) return "None yet. You may introduce keys via newTitle when a role clearly repeats.";
  return [...catalog.values()]
    .map(
      (entry) =>
        `- ${entry.key} | ${entry.title}${entry.usage ? ` [${entry.usage}]` : ""}${
          entry.description ? ` — ${entry.description}` : ""
        }`,
    )
    .join("\n");
}

async function assignBatch(params: {
  docs: SeriesDiscoveryDoc[];
  catalog: Map<string, SeriesCatalogEntry>;
  onBatch?: (done: number, total: number) => Promise<void>;
  shouldContinue?: () => Promise<boolean>;
}): Promise<{
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  byHash: Map<string, string>;
}> {
  const byHash = new Map<string, string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  const totalBatches = Math.max(
    1,
    Math.ceil(params.docs.length / DOCUMENT_SERIES_ASSIGN_BATCH_SIZE),
  );

  for (
    let offset = 0;
    offset < params.docs.length;
    offset += DOCUMENT_SERIES_ASSIGN_BATCH_SIZE
  ) {
    const batchIndex = Math.floor(offset / DOCUMENT_SERIES_ASSIGN_BATCH_SIZE) + 1;
    if (params.shouldContinue && !(await params.shouldContinue())) {
      break;
    }
    if (params.onBatch) await params.onBatch(batchIndex, totalBatches);
    const batch = params.docs.slice(offset, offset + DOCUMENT_SERIES_ASSIGN_BATCH_SIZE);
    const knownIndexes = new Set(batch.map((_, index) => index));
    const userText = `Catalog:
${formatCatalogBlock(params.catalog)}

File cards (assign every id):
${batch.map((doc, index) => formatCardLine(doc, index)).join("\n")}`;

    const result = await generateDeepSeekJson({
      systemInstruction: DOCUMENT_SERIES_ASSIGN_SYSTEM_PROMPT,
      userText,
      modelName: SERIES_MODEL,
      maxOutputTokens: 2048,
      thinking: false,
    });
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;
    costUsd += estimateDeepSeekCostBreakdown({
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    }).totalCostUsd;

    const parsed = parseSeriesAssignments(
      parseJsonObjectText(result.text),
      knownIndexes,
    );
    for (const assignment of parsed) {
      const doc = batch[assignment.index];
      if (!doc) continue;
      let key = assignment.seriesKey;
      if (assignment.newTitle) {
        key = assignment.seriesKey || seriesKeyFromTitle(assignment.newTitle);
        if (!params.catalog.has(key)) {
          params.catalog.set(key, {
            key,
            title: assignment.newTitle,
            description: "",
            usage: null,
            existingId: null,
          });
        }
      }
      if (!key || !params.catalog.has(key)) continue;
      byHash.set(doc.contentHash, key);
    }
  }

  return { inputTokens, outputTokens, costUsd, byHash };
}

export async function runDocumentSeriesWorker(runId: string): Promise<void> {
  const initial = await getDocumentSeriesRun(runId);
  if (!initial || initial.status !== "running") return;

  const docs = await loadSeriesDiscoveryDocs();
  await updateDocumentSeriesRun(runId, {
    totalDocs: docs.length,
    currentLabel: `Classifying ${docs.length} file card(s)…`,
  });

  if (docs.length === 0) {
    await updateDocumentSeriesRun(runId, {
      status: "completed",
      seriesCount: 0,
      clusteredDocs: 0,
      currentLabel: "No eligible file cards to classify.",
      completedAt: new Date().toISOString(),
    });
    return;
  }

  const freeDocs = docs.filter((doc) => !doc.locked);
  const lockedHashes = new Set(
    docs.filter((doc) => doc.locked).map((doc) => doc.contentHash),
  );

  const existing = await listExistingSeriesForDiscovery();
  const catalog = catalogFromExisting(existing);

  await updateDocumentSeriesRun(runId, {
    currentLabel: "Proposing recurring types from a diverse sample…",
  });

  const samples = sampleSeriesDiscoveryDocs(freeDocs);
  const named =
    samples.length === 0
      ? { entries: [] as SeriesCatalogEntry[], inputTokens: 0, outputTokens: 0, costUsd: 0 }
      : await proposeCatalog({ samples, existing });

  if (!(await stillRunning(runId))) return;

  for (const entry of named.entries) {
    mergeCatalogEntry(catalog, entry);
  }

  await updateDocumentSeriesRun(runId, {
    currentLabel: "Assigning file cards to types…",
    llmInputTokens: named.inputTokens,
    llmOutputTokens: named.outputTokens,
    totalCostUsd: named.costUsd.toFixed(6),
  });

  const assigned = await assignBatch({
    docs: freeDocs,
    catalog,
    shouldContinue: () => stillRunning(runId),
    onBatch: async (done, total) => {
      if (!(await stillRunning(runId))) return;
      await updateDocumentSeriesRun(runId, {
        currentLabel: `Assigning file cards to types (${done}/${total})…`,
      });
    },
  });
  if (!(await stillRunning(runId))) return;

  const hashesByKey = new Map<string, string[]>();
  for (const [contentHash, key] of assigned.byHash) {
    const list = hashesByKey.get(key);
    if (list) list.push(contentHash);
    else hashesByKey.set(key, [contentHash]);
  }
  const docByHash = new Map(freeDocs.map((doc) => [doc.contentHash, doc]));

  const seriesForWrite = [...catalog.values()]
    .map((entry) => {
      const hashes = hashesByKey.get(entry.key) ?? [];
      const dates = hashes.map((hash) => {
        const doc = docByHash.get(hash);
        return doc?.documentDate || doc?.receivedAt || null;
      });
      if (!clusterLooksRecurring(dates) && !entry.existingId) {
        return null;
      }
      if (hashes.length === 0 && !entry.existingId) return null;
      if (!clusterLooksRecurring(dates)) {
        return null;
      }
      return {
        existingId: entry.existingId,
        title: entry.title,
        description: entry.description,
        usage: entry.usage,
        contentHashes: hashes,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const clusteredDocs = seriesForWrite.reduce(
    (sum, row) => sum + row.contentHashes.length,
    0,
  );

  const seriesCount = await replaceDiscoveryMembership({
    runId,
    series: seriesForWrite,
    lockedHashes,
  });

  const totalCost = named.costUsd + assigned.costUsd;
  await updateDocumentSeriesRun(runId, {
    status: "completed",
    seriesCount,
    clusteredDocs,
    llmInputTokens: named.inputTokens + assigned.inputTokens,
    llmOutputTokens: named.outputTokens + assigned.outputTokens,
    totalCostUsd: totalCost.toFixed(6),
    currentLabel: `Found ${seriesCount} recurring type(s).`,
    completedAt: new Date().toISOString(),
  });
}
