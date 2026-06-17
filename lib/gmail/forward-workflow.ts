import { randomUUID } from "crypto";

import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  emailForwardQueue,
  emailForwardRuns,
  gmailConnections,
  personalForwardedMessages,
} from "@/lib/db/schema";

import { getGmailClient } from "./client";
import {
  cancelForwardChunkTimer,
  scheduleForwardChunk,
} from "./forward-scheduler";
import { forwardGmailMessageTo } from "./forward";
import {
  buildAllowlistQuery,
  buildSenderBackfillQuery,
  getAllowlistEmails,
} from "./queries";
import { listMessageIdsInMatchingThreads } from "./thread-search";

export const FORWARD_CHUNK_SIZE = 50;
export const FORWARD_CHUNK_DELAY_MS = 2 * 60 * 1000;

export type ForwardRunStatus = {
  id: string;
  status: typeof emailForwardRuns.$inferSelect.status;
  targetEmail: string;
  sourceQuery: string;
  totalQueued: number;
  forwardedCount: number;
  skippedCount: number;
  failedCount: number;
  pendingCount: number;
  chunkSize: number;
  chunkDelayMs: number;
  nextChunkAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  isActive: boolean;
  phase:
    | "idle"
    | "forwarding"
    | "waiting"
    | "completed"
    | "failed"
    | "cancelled";
  lastProcessedAt: string | null;
  progressPercent: number;
  recentActivity: Array<{
    gmailMessageId: string;
    status: typeof emailForwardQueue.$inferSelect.status;
    processedAt: string | null;
    error: string | null;
  }>;
  messagesMatched: number;
  threadsMatched: number | null;
};

function getForwardTargetEmail(): string {
  const fromEnv = process.env.GMAIL_DEDICATED_EMAIL?.trim().toLowerCase();
  if (fromEnv) return fromEnv;
  throw new Error(
    "GMAIL_DEDICATED_EMAIL is not set. Add the dedicated condo mailbox address to .env.local.",
  );
}

async function getThreadForwardContext(gmailThreadId: string): Promise<{
  inReplyTo: string;
  references: string;
} | null> {
  const db = getDb();
  const rows = await db
    .select({
      forwardMessageIdHeader: personalForwardedMessages.forwardMessageIdHeader,
    })
    .from(personalForwardedMessages)
    .where(eq(personalForwardedMessages.gmailThreadId, gmailThreadId))
    .orderBy(asc(personalForwardedMessages.forwardedAt));

  const headers = rows
    .map((row) => row.forwardMessageIdHeader)
    .filter((value): value is string => Boolean(value));

  if (headers.length === 0) return null;

  return {
    inReplyTo: headers[headers.length - 1]!,
    references: headers.join(" "),
  };
}

async function getAlreadyForwardedIdSet(): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ gmailMessageId: personalForwardedMessages.gmailMessageId })
    .from(personalForwardedMessages);

  return new Set(rows.map((row) => row.gmailMessageId));
}

const QUEUE_INSERT_BATCH = 500;

async function getActiveForwardRun() {
  const db = getDb();
  const [run] = await db
    .select()
    .from(emailForwardRuns)
    .where(inArray(emailForwardRuns.status, ["queued", "running", "paused"]))
    .orderBy(desc(emailForwardRuns.startedAt))
    .limit(1);

  return run ?? null;
}

function deriveForwardPhase(input: {
  status: typeof emailForwardRuns.$inferSelect.status;
  pendingCount: number;
  nextChunkAt: string | null;
}): ForwardRunStatus["phase"] {
  if (input.status === "completed") return "completed";
  if (input.status === "failed") return "failed";
  if (input.status === "cancelled") return "cancelled";
  if (input.status === "running" && input.nextChunkAt) return "waiting";
  if (input.status === "running" && input.pendingCount > 0) return "forwarding";
  if (input.status === "queued") return "forwarding";
  return "idle";
}

export async function getForwardRunStatus(
  runId?: string,
): Promise<ForwardRunStatus | null> {
  const db = getDb();
  const [run] = runId
    ? await db
        .select()
        .from(emailForwardRuns)
        .where(eq(emailForwardRuns.id, runId))
        .limit(1)
    : await db
        .select()
        .from(emailForwardRuns)
        .orderBy(desc(emailForwardRuns.startedAt))
        .limit(1);

  if (!run) return null;

  const [{ pendingCount }] = await db
    .select({ pendingCount: count() })
    .from(emailForwardQueue)
    .where(
      and(
        eq(emailForwardQueue.runId, run.id),
        eq(emailForwardQueue.status, "pending"),
      ),
    );

  const recentActivity = await db
    .select({
      gmailMessageId: emailForwardQueue.gmailMessageId,
      status: emailForwardQueue.status,
      processedAt: emailForwardQueue.processedAt,
      error: emailForwardQueue.error,
    })
    .from(emailForwardQueue)
    .where(eq(emailForwardQueue.runId, run.id))
    .orderBy(desc(emailForwardQueue.processedAt))
    .limit(8);

  const lastProcessedAt = recentActivity.find((row) => row.processedAt)?.processedAt ?? null;
  const phase = deriveForwardPhase({
    status: run.status,
    pendingCount,
    nextChunkAt: run.nextChunkAt,
  });
  const processedInRun = run.forwardedCount + run.failedCount;
  const progressPercent =
    run.totalQueued === 0
      ? 100
      : Math.min(100, Math.round((processedInRun / run.totalQueued) * 100));
  const isActive = phase === "forwarding" || phase === "waiting";

  return {
    id: run.id,
    status: run.status,
    targetEmail: run.targetEmail,
    sourceQuery: run.sourceQuery,
    totalQueued: run.totalQueued,
    forwardedCount: run.forwardedCount,
    skippedCount: run.skippedCount,
    failedCount: run.failedCount,
    pendingCount,
    chunkSize: run.chunkSize,
    chunkDelayMs: run.chunkDelayMs,
    nextChunkAt: run.nextChunkAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    lastError: run.lastError,
    isActive,
    phase,
    lastProcessedAt,
    progressPercent,
    recentActivity,
    messagesMatched: run.totalQueued + run.skippedCount,
    threadsMatched: run.threadsMatched,
  };
}

export async function startPersonalForwardWorkflow(options?: {
  senderEmails?: string[];
}): Promise<ForwardRunStatus> {
  const active = await getActiveForwardRun();
  if (active) {
    throw new Error(
      "A forward workflow is already in progress. Stop it before starting another.",
    );
  }

  const [personalConnection] = await getDb()
    .select({ id: gmailConnections.id })
    .from(gmailConnections)
    .where(eq(gmailConnections.accountType, "personal_backfill"))
    .limit(1);

  if (!personalConnection) {
    throw new Error(
      "Personal Gmail is not connected. Reconnect it in Email Settings before forwarding.",
    );
  }

  const senderEmails =
    options?.senderEmails?.map((email) => email.trim().toLowerCase()) ??
    (await getAllowlistEmails());

  if (senderEmails.length === 0) {
    throw new Error(
      "No sender addresses to forward. Save senders to the allowlist or select rows first.",
    );
  }

  const sourceQuery =
    senderEmails.length === 1
      ? buildSenderBackfillQuery(senderEmails[0]!)
      : buildAllowlistQuery(senderEmails);

  const targetEmail = getForwardTargetEmail();
  const { gmail } = await getGmailClient("personal_backfill");
  const {
    messageIds: matchingIds,
    threadsMatched,
    queryMatchedMessageCount,
  } = await listMessageIdsInMatchingThreads(gmail, sourceQuery);
  console.info(
    `[email-forward] Found ${queryMatchedMessageCount} allowlist-matching messages in ${threadsMatched} threads (${matchingIds.length} total messages including full threads) in personal Gmail`,
  );

  const alreadyForwarded = await getAlreadyForwardedIdSet();
  const queueIds = matchingIds.filter((id) => !alreadyForwarded.has(id));
  const skippedCount = matchingIds.length - queueIds.length;

  const db = getDb();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  await db.insert(emailForwardRuns).values({
    id: runId,
    status: queueIds.length === 0 ? "completed" : "running",
    targetEmail,
    sourceQuery,
    totalQueued: queueIds.length,
    threadsMatched,
    forwardedCount: 0,
    skippedCount,
    failedCount: 0,
    chunkSize: FORWARD_CHUNK_SIZE,
    chunkDelayMs: FORWARD_CHUNK_DELAY_MS,
    nextChunkAt: null,
    startedAt,
    finishedAt: queueIds.length === 0 ? startedAt : null,
    lastError: null,
  });

  if (queueIds.length > 0) {
    for (let index = 0; index < queueIds.length; index += QUEUE_INSERT_BATCH) {
      const batch = queueIds.slice(index, index + QUEUE_INSERT_BATCH);
      await db.insert(emailForwardQueue).values(
        batch.map((gmailMessageId) => ({
          id: randomUUID(),
          runId,
          gmailMessageId,
          status: "pending" as const,
          processedAt: null,
          error: null,
        })),
      );
    }

    console.info(
      `[email-forward] Run ${runId}: queued ${queueIds.length} messages to ${targetEmail} (${skippedCount} already forwarded)`,
    );

    void processForwardChunk(runId);
  } else {
    console.info(
      `[email-forward] Run ${runId}: nothing to queue (${skippedCount} already forwarded)`,
    );
  }

  const status = await getForwardRunStatus(runId);
  if (!status) {
    throw new Error("Forward workflow started but status could not be loaded.");
  }
  return status;
}

export async function processForwardChunk(runId: string): Promise<void> {
  const db = getDb();

  const [run] = await db
    .select()
    .from(emailForwardRuns)
    .where(eq(emailForwardRuns.id, runId))
    .limit(1);

  if (!run) return;

  if (
    run.status === "paused" ||
    run.status === "cancelled" ||
    run.status === "completed" ||
    run.status === "failed"
  ) {
    return;
  }

  await db
    .update(emailForwardRuns)
    .set({ status: "running", nextChunkAt: null, lastError: null })
    .where(eq(emailForwardRuns.id, runId));

  const pendingRows = await db
    .select()
    .from(emailForwardQueue)
    .where(
      and(
        eq(emailForwardQueue.runId, runId),
        eq(emailForwardQueue.status, "pending"),
      ),
    )
    .orderBy(asc(emailForwardQueue.id))
    .limit(run.chunkSize);

  if (pendingRows.length === 0) {
    await db
      .update(emailForwardRuns)
      .set({
        status: "completed",
        finishedAt: new Date().toISOString(),
        nextChunkAt: null,
      })
      .where(eq(emailForwardRuns.id, runId));
    cancelForwardChunkTimer();
    return;
  }

  const { gmail } = await getGmailClient("personal_backfill");
  let forwardedCount = run.forwardedCount;
  let failedCount = run.failedCount;
  let lastError: string | null = null;

  console.info(
    `[email-forward] Run ${runId}: processing batch of ${pendingRows.length} messages`,
  );

  for (const row of pendingRows) {
    const processedAt = new Date().toISOString();
    try {
      const meta = await gmail.users.messages.get({
        userId: "me",
        id: row.gmailMessageId,
        format: "minimal",
      });
      const gmailThreadId = meta.data.threadId ?? null;
      const { forwardMessageIdHeader } = await forwardGmailMessageTo(
        gmail,
        row.gmailMessageId,
        run.targetEmail,
        {
          threading: gmailThreadId
            ? await getThreadForwardContext(gmailThreadId)
            : null,
        },
      );

      await db.transaction(async (tx) => {
        await tx
          .update(emailForwardQueue)
          .set({ status: "forwarded", processedAt, error: null })
          .where(eq(emailForwardQueue.id, row.id));

        await tx
          .insert(personalForwardedMessages)
          .values({
            gmailMessageId: row.gmailMessageId,
            gmailThreadId,
            forwardRunId: runId,
            forwardMessageIdHeader,
            forwardedAt: processedAt,
          })
          .onConflictDoNothing();
      });

      forwardedCount += 1;
      console.info(
        `[email-forward] Run ${runId}: forwarded ${row.gmailMessageId} (${forwardedCount}/${run.totalQueued})`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not forward message.";
      lastError = message;

      await db
        .update(emailForwardQueue)
        .set({
          status: "failed",
          processedAt,
          error: message,
        })
        .where(eq(emailForwardQueue.id, row.id));

      failedCount += 1;
      console.error(
        `[email-forward] Run ${runId}: failed ${row.gmailMessageId}: ${message}`,
      );

      if (/insufficient|permission|scope|403/i.test(message)) {
        await db
          .update(emailForwardRuns)
          .set({
            status: "failed",
            finishedAt: processedAt,
            forwardedCount,
            failedCount,
            lastError:
              "Personal Gmail is missing send permission. Reconnect personal Gmail in Email Settings.",
            nextChunkAt: null,
          })
          .where(eq(emailForwardRuns.id, runId));
        cancelForwardChunkTimer();
        return;
      }
    }
  }

  const [{ pendingCount }] = await db
    .select({ pendingCount: count() })
    .from(emailForwardQueue)
    .where(
      and(
        eq(emailForwardQueue.runId, runId),
        eq(emailForwardQueue.status, "pending"),
      ),
    );

  if (pendingCount === 0) {
    await db
      .update(emailForwardRuns)
      .set({
        status: failedCount > 0 && forwardedCount === 0 ? "failed" : "completed",
        finishedAt: new Date().toISOString(),
        forwardedCount,
        failedCount,
        lastError,
        nextChunkAt: null,
      })
      .where(eq(emailForwardRuns.id, runId));
    cancelForwardChunkTimer();
    return;
  }

  const nextChunkAt = new Date(Date.now() + run.chunkDelayMs).toISOString();

  await db
    .update(emailForwardRuns)
    .set({
      status: "running",
      forwardedCount,
      failedCount,
      lastError,
      nextChunkAt,
    })
    .where(eq(emailForwardRuns.id, runId));

  scheduleForwardChunk(runId, run.chunkDelayMs);
  console.info(
    `[email-forward] Run ${runId}: waiting ${run.chunkDelayMs}ms before next batch (${pendingCount} pending)`,
  );
}

export async function stopPersonalForwardWorkflow(): Promise<ForwardRunStatus | null> {
  const active = await getActiveForwardRun();
  if (!active) return null;

  cancelForwardChunkTimer();

  const db = getDb();
  await db
    .update(emailForwardRuns)
    .set({
      status: "cancelled",
      finishedAt: new Date().toISOString(),
      nextChunkAt: null,
    })
    .where(eq(emailForwardRuns.id, active.id));

  return getForwardRunStatus(active.id);
}

export async function resumePersonalForwardWorkflow(): Promise<void> {
  const active = await getActiveForwardRun();
  if (!active) return;

  const db = getDb();
  const [{ pendingCount }] = await db
    .select({ pendingCount: count() })
    .from(emailForwardQueue)
    .where(
      and(
        eq(emailForwardQueue.runId, active.id),
        eq(emailForwardQueue.status, "pending"),
      ),
    );

  if (pendingCount === 0) {
    await db
      .update(emailForwardRuns)
      .set({
        status: "completed",
        finishedAt: new Date().toISOString(),
        nextChunkAt: null,
      })
      .where(eq(emailForwardRuns.id, active.id));
    return;
  }

  if (!active.nextChunkAt) {
    void processForwardChunk(active.id);
    return;
  }

  const delayMs = Math.max(
    0,
    new Date(active.nextChunkAt).getTime() - Date.now(),
  );
  scheduleForwardChunk(active.id, delayMs);
}
