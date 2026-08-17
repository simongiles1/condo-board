/**
 * Bulk extract server worker (Tier A + Tier B + deferred ingest).
 *
 * Tier A — Within each thread, passes 1–3 run emails concurrently
 *   (bulk-extract-highlight CONCURRENCY).
 *
 * Tier B — Multiple threads run LLM passes in parallel:
 *   - Claim: next free thread index (in-process cursor).
 *   - Lease: thread stays in-flight until its result is ordered-committed.
 *   - Ordered commit: completedThreads advances as a contiguous prefix so
 *     resume-from-completedThreads stays correct under out-of-order finish.
 *
 * Deferred ingest — Contact pass 4 saves the merge, schedules registry ingest
 *   on the process-wide serial queue, and returns immediately so thread workers
 *   stay on LLM work. Pending ingest promises drain before the run is marked
 *   completed. Crash mid-drain is recoverable via processPendingRegistryIngests
 *   (merge row exists; ingest not completed).
 *
 * Events calendar — LLM harvest JSON is saved per thread; calendar rows are
 *   applied once at the end in email receivedAt order, then cancel/reschedule
 *   mutations are replayed so cross-thread Teams mail still closes/moves.
 *
 * To-dos — Same apply-at-end pattern: harvest JSON per thread, then product
 *   rows in receivedAt order. Emails older than the working window persist as
 *   stale (Archive); every thread still runs close-out so resolved historical
 *   asks land on Archive / Done.
 */

import {
  prepareContactExtractItemsForEmails,
  prepareContactExtractItemsForThread,
} from "@/lib/email-analysis/contact-highlight-prepare";
import {
  prepareEventExtractItemsForEmails,
  prepareEventExtractItemsForThread,
} from "@/lib/email-analysis/event-highlight-prepare";
import {
  prepareOrgExtractItemsForEmails,
  prepareOrgExtractItemsForThread,
} from "@/lib/email-analysis/org-highlight-prepare";
import { runBulkHighlightPass } from "@/lib/email-analysis/bulk-extract-highlight";
import { listBulkExtractTargets, listMissingExtractTargets } from "@/lib/email-analysis/bulk-extract-targets";
import {
  getBulkExtractRun,
  listRunningBulkExtractRuns,
  updateBulkExtractRun,
  type BulkExtractKind,
  type BulkExtractTarget,
  type BulkExtractTargetScope,
} from "@/lib/email-analysis/bulk-extract-runs";
import { persistEventHarvestsAfterBulkRun } from "@/lib/email-analysis/event-highlight-persist";
import { resolveEventHighlightModel } from "@/lib/email-analysis/event-highlight-models";
import {
  prepareTodoExtractItemsForEmails,
  prepareTodoExtractItemsForThread,
} from "@/lib/email-analysis/todo-highlight-prepare";
import { persistTodoHarvestsAfterBulkRun } from "@/lib/email-analysis/todo-highlight-persist";
import { resolveTodoHighlightModel } from "@/lib/email-analysis/todo-highlight-models";

const activeWorkers = new Map<string, Promise<void>>();

/** Parallel threads doing LLM work. Override with BULK_EXTRACT_THREAD_CONCURRENCY. */
const DEFAULT_THREAD_CONCURRENCY = 5;

function threadConcurrency(): number {
  const raw = process.env.BULK_EXTRACT_THREAD_CONCURRENCY?.trim();
  if (!raw) return DEFAULT_THREAD_CONCURRENCY;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_THREAD_CONCURRENCY;
  return Math.min(16, Math.floor(n));
}

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

async function prepareTargetItems(
  target: BulkExtractTarget,
  kind: BulkExtractKind,
  targetScope: BulkExtractTargetScope,
) {
  const useEmailIds = targetScope === "missing" || !target.threadId;
  if (kind === "organizations") {
    if (!useEmailIds && target.threadId) {
      return prepareOrgExtractItemsForThread(target.threadId);
    }
    return prepareOrgExtractItemsForEmails(target.emailIds);
  }
  if (kind === "events") {
    if (!useEmailIds && target.threadId) {
      return prepareEventExtractItemsForThread(target.threadId);
    }
    return prepareEventExtractItemsForEmails(target.emailIds);
  }
  if (kind === "todos") {
    if (!useEmailIds && target.threadId) {
      return prepareTodoExtractItemsForThread(target.threadId);
    }
    return prepareTodoExtractItemsForEmails(target.emailIds);
  }
  if (!useEmailIds && target.threadId) {
    return prepareContactExtractItemsForThread(target.threadId);
  }
  return prepareContactExtractItemsForEmails(target.emailIds);
}

async function isRunStillActive(runId: string): Promise<boolean> {
  const run = await getBulkExtractRun(runId);
  return run?.status === "running";
}

type ThreadSuccess = {
  ok: true;
  emailCount: number;
  costUsd: number;
  subject: string;
  registryIngestPromise: Promise<unknown> | null;
};

type ThreadFailure = {
  ok: false;
  error: string;
  subject: string;
  registryIngestPromise: Promise<unknown> | null;
};

type ThreadOutcome = ThreadSuccess | ThreadFailure;

async function processOneThread(params: {
  runId: string;
  kind: BulkExtractKind;
  modelId: string;
  target: BulkExtractTarget;
  targetScope: BulkExtractTargetScope;
  threadIndex: number;
  totalThreads: number;
  poolSize: number;
}): Promise<ThreadOutcome> {
  const {
    runId,
    kind,
    modelId,
    target,
    targetScope,
    threadIndex,
    totalThreads,
    poolSize,
  } = params;

  try {
    await updateBulkExtractRun(runId, {
      currentThreadIndex: threadIndex + 1,
      currentThreadId: target.threadId ?? target.progressKey,
      currentThreadSubject: target.subject,
      currentEmailId: null,
      currentEmailLabel: `Thread pool ×${poolSize} · preparing…`,
      currentPass: null,
      currentEmailIndex: null,
      currentEmailTotal: target.emailIds.length,
    });

    if (!(await isRunStillActive(runId))) {
      return {
        ok: false,
        error: "Run cancelled.",
        subject: target.subject,
        registryIngestPromise: null,
      };
    }

    const items = await prepareTargetItems(target, kind, targetScope);
    if (items.length === 0) {
      throw new Error("No emails found for this thread.");
    }

    let costUsd = 0;
    let registryIngestPromise: Promise<unknown> | null = null;

    const passes =
      kind === "events" || kind === "todos" ? ([1] as const) : ([1, 2, 3] as const);

    for (const pass of passes) {
      if (!(await isRunStillActive(runId))) {
        return {
          ok: false,
          error: "Run cancelled.",
          subject: target.subject,
          registryIngestPromise: null,
        };
      }

      await updateBulkExtractRun(runId, {
        currentThreadIndex: threadIndex + 1,
        currentThreadId: target.threadId ?? target.progressKey,
        currentThreadSubject: target.subject,
        currentEmailId: null,
        currentEmailLabel:
          items.length === 1
            ? items[0]!.label || items[0]!.subject || items[0]!.emailId
            : `Pool ×${poolSize} · pass ${pass} · ${items.length} emails`,
        currentPass: pass,
        currentEmailIndex: items.length,
        currentEmailTotal: items.length,
      });

      const passResult = await runBulkHighlightPass({
        kind,
        items,
        modelId,
        pass,
      });
      costUsd += passResult.costUsd;
    }

    if (kind === "events" || kind === "todos") {
      console.info("[bulk-extract-worker] Thread done", {
        runId,
        threadIndex: threadIndex + 1,
        totalThreads,
        emailCount: items.length,
        ingestDeferred: false,
      });

      return {
        ok: true,
        emailCount: items.length,
        costUsd,
        subject: target.subject,
        registryIngestPromise: null,
      };
    }

    if (!(await isRunStillActive(runId))) {
      return {
        ok: false,
        error: "Run cancelled.",
        subject: target.subject,
        registryIngestPromise: null,
      };
    }

    await updateBulkExtractRun(runId, {
      currentThreadIndex: threadIndex + 1,
      currentThreadId: target.threadId ?? target.progressKey,
      currentThreadSubject: target.subject,
      currentEmailId: null,
      currentEmailLabel:
        kind === "contacts"
          ? `Pool ×${poolSize} · pass 4 (ingest deferred)…`
          : `Pool ×${poolSize} · merging fingerprints (pass 4)…`,
      currentPass: 4,
      currentEmailIndex: items.length,
      currentEmailTotal: items.length,
    });

    const pass4 = await runBulkHighlightPass({
      kind,
      items,
      modelId,
      pass: 4,
      deferRegistryIngest: kind === "contacts",
    });
    costUsd += pass4.costUsd;
    registryIngestPromise = pass4.registryIngestPromise;

    console.info("[bulk-extract-worker] Thread done", {
      runId,
      threadIndex: threadIndex + 1,
      totalThreads,
      emailCount: items.length,
      ingestDeferred: Boolean(registryIngestPromise),
    });

    return {
      ok: true,
      emailCount: items.length,
      costUsd,
      subject: target.subject,
      registryIngestPromise,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Bulk extraction failed.";
    console.error("[bulk-extract-worker] Thread failed", {
      runId,
      threadIndex: threadIndex + 1,
      error: message,
    });
    return {
      ok: false,
      error: message,
      subject: target.subject,
      registryIngestPromise: null,
    };
  }
}

async function executeBulkExtractRun(runId: string): Promise<void> {
  const initial = await getBulkExtractRun(runId);
  if (!initial || initial.status !== "running") return;

  const kind = initial.kind;
  const modelId = initial.modelId;
  const targetScope = initial.targetScope;

  const listed =
    targetScope === "missing"
      ? await listMissingExtractTargets(kind)
      : await listBulkExtractTargets();
  const { targets } = listed;

  if (targets.length === 0) {
    if (targetScope === "missing") {
      await updateBulkExtractRun(runId, {
        status: "completed",
        totalThreads: 0,
        totalEmails: 0,
        completedThreads: 0,
        completedEmails: 0,
        currentEmailLabel: "Nothing missing.",
      });
      return;
    }
    await updateBulkExtractRun(runId, {
      status: "failed",
      lastError: "No emails to extract.",
    });
    return;
  }

  let completedThreads = initial.completedThreads;
  let completedEmails = initial.completedEmails;
  let failedThreads = initial.failedThreads;
  let totalCostUsd = initial.totalCostUsd;
  let lastError: string | null = initial.lastError;

  if (targetScope === "missing") {
    completedThreads = 0;
    completedEmails = 0;
    await updateBulkExtractRun(runId, {
      totalThreads: listed.totalThreads,
      totalEmails: listed.totalEmails,
      completedThreads: 0,
      completedEmails: 0,
    });
  }

  const startIndex =
    targetScope === "missing"
      ? 0
      : Math.min(initial.completedThreads, targets.length);
  let nextClaimIndex = startIndex;
  /** Ordered commit cursor — only advances contiguous finished indices. */
  let commitIndex = startIndex;
  const pendingOutcomes = new Map<number, ThreadOutcome>();
  const withCommitLock = createAsyncMutex();
  const pendingIngests: Promise<unknown>[] = [];
  const harvestedEmailIds: string[] = [];

  const poolSize = Math.min(
    threadConcurrency(),
    Math.max(1, targets.length - startIndex),
  );

  console.info("[bulk-extract-worker] Tier B pool", {
    runId,
    poolSize,
    startIndex,
    totalThreads: targets.length,
    kind,
    deferRegistryIngest: kind === "contacts",
  });

  async function flushOrderedCommits(): Promise<void> {
    await withCommitLock(async () => {
      while (pendingOutcomes.has(commitIndex)) {
        const outcome = pendingOutcomes.get(commitIndex)!;
        pendingOutcomes.delete(commitIndex);
        commitIndex += 1;

        if (outcome.registryIngestPromise) {
          pendingIngests.push(outcome.registryIngestPromise);
        }

        if (outcome.ok) {
          completedThreads += 1;
          completedEmails += outcome.emailCount;
          totalCostUsd += outcome.costUsd;
        } else if (outcome.error !== "Run cancelled.") {
          failedThreads += 1;
          lastError = outcome.error;
        }

        await updateBulkExtractRun(runId, {
          completedThreads,
          completedEmails,
          failedThreads,
          totalCostUsd,
          lastError,
          currentThreadIndex: completedThreads,
          currentThreadSubject: outcome.subject,
          currentEmailLabel:
            outcome.ok
              ? `Committed ${completedThreads}/${targets.length} · pool ×${poolSize}`
              : `Failed thread · ${outcome.error}`,
        });
      }
    });
  }

  async function workerLoop(): Promise<void> {
    while (true) {
      if (!(await isRunStillActive(runId))) return;

      // Claim is sync — safe in single-threaded Node between await points.
      if (nextClaimIndex >= targets.length) return;
      const threadIndex = nextClaimIndex;
      nextClaimIndex += 1;

      const target = targets[threadIndex]!;
      const outcome = await processOneThread({
        runId,
        kind,
        modelId,
        target,
        targetScope,
        threadIndex,
        totalThreads: targets.length,
        poolSize,
      });

      // Cancelled mid-flight: do not commit this index (avoids skipping work on
      // resume). Higher indices may sit uncommitted until process exit — OK.
      if (!outcome.ok && outcome.error === "Run cancelled.") {
        if (outcome.registryIngestPromise) {
          pendingIngests.push(outcome.registryIngestPromise);
        }
        return;
      }

      pendingOutcomes.set(threadIndex, outcome);
      if ((kind === "events" || kind === "todos") && outcome.ok) {
        harvestedEmailIds.push(...target.emailIds);
      }
      await flushOrderedCommits();
    }
  }

  await Promise.all(
    Array.from({ length: poolSize }, () => workerLoop()),
  );

  if (pendingIngests.length > 0) {
    console.info("[bulk-extract-worker] Draining registry ingest queue", {
      runId,
      pending: pendingIngests.length,
    });
    await updateBulkExtractRun(runId, {
      currentEmailLabel: `Draining registry ingest (${pendingIngests.length} queued)…`,
      currentPass: 4,
    });
    await Promise.all(pendingIngests);
  }

  if (kind === "events") {
    await updateBulkExtractRun(runId, {
      currentEmailLabel: "Applying calendar in email order…",
      currentPass: 1,
    });
    try {
      await persistEventHarvestsAfterBulkRun(
        resolveEventHighlightModel(modelId),
        harvestedEmailIds,
      );
      console.info("[bulk-extract-worker] Calendar apply done", {
        runId,
        emailCount: harvestedEmailIds.length,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Calendar apply failed.";
      console.error("[bulk-extract-worker] Calendar apply failed", {
        runId,
        error: message,
      });
      lastError = message;
      failedThreads = Math.max(failedThreads, 1);
    }
  }

  if (kind === "todos") {
    await updateBulkExtractRun(runId, {
      currentEmailLabel: "Saving to-dos in email order…",
      currentPass: 1,
    });
    try {
      await persistTodoHarvestsAfterBulkRun(
        resolveTodoHighlightModel(modelId),
        harvestedEmailIds,
      );
      console.info("[bulk-extract-worker] To-do apply done", {
        runId,
        emailCount: harvestedEmailIds.length,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "To-do apply failed.";
      console.error("[bulk-extract-worker] To-do apply failed", {
        runId,
        error: message,
      });
      lastError = message;
      failedThreads = Math.max(failedThreads, 1);
    }
  }

  if (!(await isRunStillActive(runId))) return;

  const finalRun = await getBulkExtractRun(runId);
  if (!finalRun || finalRun.status !== "running") return;

  const failureCountLabel = `${failedThreads} thread${failedThreads === 1 ? "" : "s"} failed`;
  await updateBulkExtractRun(runId, {
    status:
      failedThreads > 0 && completedThreads === 0 ? "failed" : "completed",
    completedThreads,
    completedEmails,
    failedThreads,
    totalCostUsd,
    lastError:
      failedThreads > 0
        ? lastError?.trim()
          ? `${failureCountLabel}. Latest error: ${lastError.trim()}`
          : failureCountLabel
        : null,
  });
}

/** Start (or noop if already running) the server worker for a bulk extract run. */
export function kickBulkExtractWorker(runId: string): void {
  void runBulkExtractWorker(runId);
}

/** Await the worker for `runId` (used by harvest-after-sync so kinds stay serial). */
export function runBulkExtractWorker(runId: string): Promise<void> {
  const existing = activeWorkers.get(runId);
  if (existing) return existing;

  console.info("[bulk-extract-worker] Starting run", { runId });

  const promise = executeBulkExtractRun(runId)
    .catch((error) => {
      console.error("[bulk-extract-worker] Run failed:", { runId, error });
      void updateBulkExtractRun(runId, {
        status: "failed",
        lastError:
          error instanceof Error
            ? error.message
            : "Bulk extraction worker crashed.",
      }).catch((patchError) => {
        console.error("[bulk-extract-worker] Could not mark run failed:", {
          runId,
          patchError,
        });
      });
    })
    .finally(() => {
      activeWorkers.delete(runId);
    });

  activeWorkers.set(runId, promise);
  return promise;
}

/** Resume any runs left in `running` after a dev-server restart. */
export async function resumeBulkExtractWorkersOnStartup(): Promise<void> {
  const runs = await listRunningBulkExtractRuns();
  if (runs.length === 0) return;

  console.info(
    `[bulk-extract-worker] Resuming ${runs.length} running bulk extract run(s)`,
  );
  for (const run of runs) {
    kickBulkExtractWorker(run.id);
  }
}
