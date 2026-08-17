/**
 * In-process extraction backfill worker (Docling and/or Gemini vision).
 * Planned hash list is the resume cursor; page caches/status are durable.
 */

import {
  getDoclingBackfillRun,
  listRunningDoclingBackfillRuns,
  touchDoclingBackfillRun,
  updateDoclingBackfillRun,
} from "@/lib/email/docling-backfill-runs";
import {
  requeueFailedVisionPagesForHash,
  requeueFailedVisionPagesForHashes,
  formatErrorGroupSummary,
  formatVisionErrorSummary,
  listVisionErrorsForHashes,
  summarizeVisionErrorGroupsForHashes,
  type ExtractionBackfillPageError,
} from "@/lib/email/extraction-backfill-plan";
import {
  ibmJobConcurrencyFromEnv,
  isFatalIbmDoclingError,
} from "@/lib/email/docling-ibm";
import {
  checkDoclingProviderHealth,
  convertDoclingPages,
  listUncachedTextRoutePages,
} from "@/lib/email/docling-lab";
import { promoteParsedIfExtractionComplete } from "@/lib/email/extraction-parse-promote";
import { processVisionForDocument } from "@/lib/email/page-vision";
import {
  geminiBillingHaltMessage,
  isFatalGeminiVisionError,
  type GeminiBillingHaltKind,
} from "@/lib/email/page-vision-shared";
import type { DoclingProvider } from "@/lib/email/docling-provider";

const SIDECAR_PAGE_CHUNK = 5;
const VISION_MAX_PAGES_PER_DOC = 2000;
const HEARTBEAT_MS = 15_000;
const activeWorkers = new Map<string, Promise<void>>();

function createAsyncMutex() {
  let tail: Promise<void> = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 12)}…`;
}

function chunkPages(pages: number[], size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < pages.length; i += size) {
    out.push(pages.slice(i, i + size));
  }
  return out;
}

async function isRunStillActive(runId: string): Promise<boolean> {
  const run = await getDoclingBackfillRun(runId);
  return run?.status === "running";
}

type DocOutcome = {
  cancelled: boolean;
  fatal: boolean;
  visionQuota: boolean;
  visionHaltKind?: GeminiBillingHaltKind;
  failed: boolean;
  contentHash: string;
  docIndex: number;
  doclingPages: number;
  visionPages: number;
  doclingCostUsd: number;
  visionCostUsd: number;
  lastError?: string;
  visionErrors: ExtractionBackfillPageError[];
};

async function processOneDoc(options: {
  runId: string;
  contentHash: string;
  docIndex: number;
  poolSize: number;
  provider: DoclingProvider;
  needsDocling: boolean;
  needsVision: boolean;
}): Promise<DocOutcome> {
  const {
    runId,
    contentHash,
    docIndex,
    poolSize,
    provider,
    needsDocling,
    needsVision,
  } = options;
  const label = `Pool ×${poolSize} · ${shortHash(contentHash)}`;
  const base: DocOutcome = {
    cancelled: false,
    fatal: false,
    visionQuota: false,
    failed: false,
    contentHash,
    docIndex,
    doclingPages: 0,
    visionPages: 0,
    doclingCostUsd: 0,
    visionCostUsd: 0,
    visionErrors: [],
  };

  try {
    if (!(await isRunStillActive(runId))) {
      return { ...base, cancelled: true };
    }

    const runDocling = async (): Promise<{
      pages: number;
      costUsd: number;
    }> => {
      if (!needsDocling) return { pages: 0, costUsd: 0 };
      const uncached = await listUncachedTextRoutePages(contentHash);
      if (!(await isRunStillActive(runId))) {
        throw new Error("Run cancelled.");
      }
      if (uncached.length === 0) return { pages: 0, costUsd: 0 };

      await updateDoclingBackfillRun(runId, {
        phase: "docling",
        currentDocIndex: docIndex,
        currentContentHash: contentHash,
        currentLabel: label,
        currentPagesInDoc: uncached.length,
      });

      const pageGroups =
        provider === "ibm"
          ? [uncached]
          : chunkPages(uncached, SIDECAR_PAGE_CHUNK);
      let pages = 0;
      let costUsd = 0;
      for (const group of pageGroups) {
        if (!(await isRunStillActive(runId))) {
          throw new Error("Run cancelled.");
        }
        const result = await convertDoclingPages({
          contentHash,
          pages: group,
          provider,
        });
        pages += result.pages.length;
        costUsd += result.costUsd;
      }
      return { pages, costUsd };
    };

    const runVision = async (): Promise<{
      pages: number;
      costUsd: number;
      billingHalt?: { kind: GeminiBillingHaltKind; error: string };
    }> => {
      if (!needsVision) return { pages: 0, costUsd: 0 };
      await requeueFailedVisionPagesForHash(contentHash);
      if (!(await isRunStillActive(runId))) {
        throw new Error("Run cancelled.");
      }
      await updateDoclingBackfillRun(runId, {
        phase: needsDocling ? "docling" : "vision",
        currentDocIndex: docIndex,
        currentContentHash: contentHash,
        currentLabel: label,
      });
      const vision = await processVisionForDocument({
        contentHash,
        maxPages: VISION_MAX_PAGES_PER_DOC,
      });
      return {
        pages: vision.done + vision.skipped,
        costUsd: vision.costUsd,
        billingHalt: vision.billingHalt,
      };
    };

    const [doclingResult, visionResult] = await Promise.allSettled([
      runDocling(),
      runVision(),
    ]);

    if (!(await isRunStillActive(runId))) {
      return { ...base, cancelled: true };
    }

    const leftoverVisionErrors = needsVision
      ? await listVisionErrorsForHashes([contentHash])
      : [];
    const visionErrorSummary = formatVisionErrorSummary(leftoverVisionErrors);

    if (doclingResult.status === "rejected") {
      const error = doclingResult.reason;
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Run cancelled.") {
        return { ...base, cancelled: true };
      }
      const prefix = `${shortHash(contentHash)}: ${message}`;
      const visionHalt =
        visionResult.status === "fulfilled"
          ? visionResult.value.billingHalt
          : undefined;
      const visionQuota =
        Boolean(visionHalt) ||
        (visionResult.status === "rejected" &&
          isFatalGeminiVisionError(visionResult.reason));
      const haltKind: GeminiBillingHaltKind =
        visionHalt?.kind ?? "gemini_spend_cap";
      return {
        ...base,
        fatal: isFatalIbmDoclingError(error),
        failed: true,
        visionQuota,
        visionHaltKind: visionQuota ? haltKind : undefined,
        lastError: visionQuota
          ? `${prefix} · ${geminiBillingHaltMessage(haltKind)}`
          : visionErrorSummary
            ? `${prefix} · ${visionErrorSummary}`
            : prefix,
        visionErrors: leftoverVisionErrors,
        ...(visionResult.status === "fulfilled"
          ? {
              visionPages: visionResult.value.pages,
              visionCostUsd: visionResult.value.costUsd,
            }
          : {}),
      };
    }

    if (visionResult.status === "rejected") {
      const error = visionResult.reason;
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Run cancelled.") {
        return { ...base, cancelled: true };
      }
      const quota = isFatalGeminiVisionError(error);
      return {
        ...base,
        failed: true,
        visionQuota: quota,
        visionHaltKind: quota ? "gemini_spend_cap" : undefined,
        doclingPages: doclingResult.value.pages,
        doclingCostUsd: doclingResult.value.costUsd,
        lastError: quota
          ? geminiBillingHaltMessage("gemini_spend_cap")
          : `${shortHash(contentHash)}: ${message}`,
        visionErrors: leftoverVisionErrors,
      };
    }

    const docling = doclingResult.value;
    const vision = visionResult.value;
    const visionFailed = leftoverVisionErrors.some(
      (item) => item.status === "failed",
    );
    if (!visionFailed && !vision.billingHalt) {
      await promoteParsedIfExtractionComplete(contentHash);
    }
    return {
      ...base,
      failed: visionFailed,
      visionQuota: Boolean(vision.billingHalt),
      visionHaltKind: vision.billingHalt?.kind,
      doclingPages: docling.pages,
      visionPages: vision.pages,
      doclingCostUsd: docling.costUsd,
      visionCostUsd: vision.costUsd,
      lastError: vision.billingHalt
        ? geminiBillingHaltMessage(vision.billingHalt.kind)
        : visionErrorSummary ?? undefined,
      visionErrors: leftoverVisionErrors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Run cancelled.") {
      return { ...base, cancelled: true };
    }
    if (isFatalIbmDoclingError(error)) {
      return {
        ...base,
        fatal: true,
        failed: true,
        lastError: `${shortHash(contentHash)}: ${message}`,
      };
    }
    return {
      ...base,
      failed: true,
      lastError: `${shortHash(contentHash)}: ${message}`,
    };
  }
}

async function executeDoclingBackfillRun(runId: string): Promise<void> {
  const initial = await getDoclingBackfillRun(runId);
  if (!initial || initial.status !== "running") return;

  const mode = initial.mode;
  const provider: DoclingProvider = initial.doclingProvider;
  const needsDocling = mode === "docling_only" || mode === "full";
  const needsVision = mode === "vision_only" || mode === "full";

  if (needsDocling) {
    const health = await checkDoclingProviderHealth(provider);
    if (!health.ok) {
      await updateDoclingBackfillRun(runId, {
        status: "failed",
        lastError:
          provider === "ibm"
            ? `IBM Docling not ready${health.url ? ` at ${health.url}` : ""}. ${health.detail ?? "Set DOCLING_IBM_URL and DOCLING_IBM_API_KEY (plus _2 / _3 / _4)."}`
            : `Docling sidecar not reachable at ${health.url}. ` +
              `Run \`npm run docling:sidecar\`.` +
              (health.detail ? ` (${health.detail})` : ""),
      });
      return;
    }
  }

  const planned = initial.plannedHashes;
  if (needsVision && planned.length > 0) {
    const requeued = await requeueFailedVisionPagesForHashes(planned);
    if (requeued > 0) {
      console.info("[extraction-backfill-worker] Requeued failed vision pages", {
        runId,
        pages: requeued,
      });
    }
  }
  let completedDocs = initial.completedDocs;
  let completedDoclingPages = initial.completedDoclingPages;
  let completedVisionPages = initial.completedVisionPages;
  let failedDocs = initial.failedDocs;
  let doclingCostUsd = initial.doclingCostUsd;
  let visionCostUsd = initial.visionCostUsd;
  let lastError: string | null = initial.lastError;
  const collectedVisionErrors: ExtractionBackfillPageError[] = [];
  let skipVision = false;
  let visionHaltKind: GeminiBillingHaltKind | null = null;

  const startIndex = Math.min(completedDocs, planned.length);
  let nextClaimIndex = startIndex;
  let commitIndex = startIndex;
  const pendingOutcomes = new Map<number, DocOutcome>();
  const withCommitLock = createAsyncMutex();

  const remaining = Math.max(0, planned.length - startIndex);
  const poolSize = Math.min(
    provider === "ibm" || (needsVision && !needsDocling)
      ? ibmJobConcurrencyFromEnv()
      : 1,
    Math.max(1, remaining),
  );

  console.info("[extraction-backfill-worker] Starting run", {
    runId,
    mode,
    provider,
    poolSize,
    fromDoc: completedDocs,
    totalDocs: planned.length,
    totalPages: initial.totalPages,
  });

  async function persistCounters(extra?: {
    status?: "failed";
    currentDocIndex?: number;
    currentContentHash?: string;
    currentLabel?: string;
    lastError?: string | null;
  }): Promise<void> {
    await updateDoclingBackfillRun(runId, {
      completedDocs,
      completedDoclingPages,
      completedVisionPages,
      failedDocs,
      doclingCostUsd,
      visionCostUsd,
      lastError: extra?.lastError === undefined ? lastError : extra.lastError,
      ...(extra?.status ? { status: extra.status } : {}),
      ...(extra?.currentDocIndex != null
        ? { currentDocIndex: extra.currentDocIndex }
        : {}),
      ...(extra?.currentContentHash
        ? { currentContentHash: extra.currentContentHash }
        : {}),
      ...(extra?.currentLabel ? { currentLabel: extra.currentLabel } : {}),
    });
  }

  async function flushOrderedCommits(): Promise<void> {
    await withCommitLock(async () => {
      while (pendingOutcomes.has(commitIndex)) {
        const outcome = pendingOutcomes.get(commitIndex)!;
        pendingOutcomes.delete(commitIndex);
        commitIndex += 1;

        if (outcome.cancelled) return;

        completedDocs = outcome.docIndex;
        await persistCounters({
          currentDocIndex: outcome.docIndex,
          currentContentHash: outcome.contentHash,
          currentLabel: `Pool ×${poolSize} · ${shortHash(outcome.contentHash)}`,
          lastError: outcome.lastError ?? lastError,
          ...(outcome.fatal ? { status: "failed" as const } : {}),
        });

        if (outcome.fatal) {
          console.error("[extraction-backfill-worker] Fatal IBM request error", {
            runId,
            contentHash: shortHash(outcome.contentHash),
            error: outcome.lastError,
          });
          return;
        }

        console.info("[extraction-backfill-worker] Doc done", {
          runId,
          mode,
          contentHash: shortHash(outcome.contentHash),
          docIndex: outcome.docIndex,
          poolSize,
          completedDoclingPages,
          completedVisionPages,
          doclingCostUsd,
          visionCostUsd,
        });
      }
    });
  }

  async function workerLoop(): Promise<void> {
    while (true) {
      if (!(await isRunStillActive(runId))) return;
      if (nextClaimIndex >= planned.length) return;
      const index = nextClaimIndex;
      nextClaimIndex += 1;
      const contentHash = planned[index]!;
      const outcome = await processOneDoc({
        runId,
        contentHash,
        docIndex: index + 1,
        poolSize,
        provider,
        needsDocling,
        needsVision: needsVision && !skipVision,
      });

      if (outcome.cancelled) return;

      await withCommitLock(async () => {
        completedDoclingPages += outcome.doclingPages;
        completedVisionPages += outcome.visionPages;
        doclingCostUsd += outcome.doclingCostUsd;
        visionCostUsd += outcome.visionCostUsd;
        if (outcome.failed) failedDocs += 1;
        collectedVisionErrors.push(...outcome.visionErrors);
        if (outcome.visionQuota) {
          skipVision = true;
          visionHaltKind = outcome.visionHaltKind ?? "gemini_spend_cap";
          lastError =
            outcome.lastError ?? geminiBillingHaltMessage(visionHaltKind);
        } else if (!skipVision) {
          const visionSummary = formatVisionErrorSummary(collectedVisionErrors);
          if (outcome.lastError && !visionSummary) lastError = outcome.lastError;
          else if (visionSummary) lastError = visionSummary;
        }
        await persistCounters({
          currentDocIndex: outcome.docIndex,
          currentContentHash: outcome.contentHash,
          currentLabel: `Pool ×${poolSize} · ${shortHash(outcome.contentHash)}`,
        });
      });

      if (outcome.fatal) {
        pendingOutcomes.set(index, outcome);
        await flushOrderedCommits();
        return;
      }

      pendingOutcomes.set(index, outcome);
      await flushOrderedCommits();
    }
  }

  const heartbeat = setInterval(() => {
    void touchDoclingBackfillRun(runId).catch(() => undefined);
  }, HEARTBEAT_MS);

  try {
    await Promise.all(Array.from({ length: poolSize }, () => workerLoop()));

    const finalRun = await getDoclingBackfillRun(runId);
    if (!finalRun || finalRun.status !== "running") return;

    const leftoverGroups = await summarizeVisionErrorGroupsForHashes(planned);
    const visionSummary = formatErrorGroupSummary(leftoverGroups);
    const doclingIncomplete = Math.max(
      0,
      initial.totalDoclingPages - completedDoclingPages,
    );
    const parts: string[] = [];
    if (skipVision) {
      parts.push(
        geminiBillingHaltMessage(visionHaltKind ?? "gemini_spend_cap"),
      );
    }
    if (doclingIncomplete > 0) {
      parts.push(
        `${doclingIncomplete.toLocaleString()} Docling page${doclingIncomplete === 1 ? "" : "s"} not completed`,
      );
    }
    if (visionSummary) parts.push(visionSummary);
    const finalError =
      parts.join(" · ") ||
      (failedDocs > 0
        ? lastError ?? `${failedDocs} document(s) failed.`
        : null);

    await persistCounters({ lastError: finalError });
    await updateDoclingBackfillRun(runId, {
      status: "completed",
      completedDocs,
      completedDoclingPages,
      completedVisionPages,
      failedDocs,
      doclingCostUsd,
      visionCostUsd,
      lastError: finalError,
    });

    console.info("[extraction-backfill-worker] Run finished", {
      runId,
      mode,
      poolSize,
      completedDocs,
      completedDoclingPages,
      completedVisionPages,
      failedDocs,
      doclingCostUsd,
      visionCostUsd,
    });
  } finally {
    clearInterval(heartbeat);
  }
}

export function isDoclingBackfillWorkerActive(runId: string): boolean {
  return activeWorkers.has(runId);
}

export function withWorkerAlive<T extends { id: string; status: string }>(
  run: T,
): T & { workerAlive: boolean } {
  return {
    ...run,
    workerAlive: run.status === "running" && activeWorkers.has(run.id),
  };
}

export function kickDoclingBackfillWorker(runId: string): void {
  if (activeWorkers.has(runId)) return;

  console.info("[extraction-backfill-worker] Kick", { runId });
  const promise = executeDoclingBackfillRun(runId)
    .catch(async (error) => {
      console.error("[extraction-backfill-worker] Run failed:", {
        runId,
        error,
      });
      try {
        await updateDoclingBackfillRun(runId, {
          status: "failed",
          lastError:
            error instanceof Error
              ? error.message
              : "Extraction backfill failed.",
        });
      } catch (updateError) {
        console.error(
          "[extraction-backfill-worker] Could not mark run failed:",
          { runId, updateError },
        );
      }
    })
    .finally(() => {
      activeWorkers.delete(runId);
    });

  activeWorkers.set(runId, promise);
}

export async function resumeDoclingBackfillWorkersOnStartup(): Promise<void> {
  const runs = await listRunningDoclingBackfillRuns();
  if (runs.length === 0) return;
  console.info(
    `[extraction-backfill-worker] Resuming ${runs.length} running extraction backfill run(s)`,
  );
  for (const run of runs) {
    kickDoclingBackfillWorker(run.id);
  }
}
