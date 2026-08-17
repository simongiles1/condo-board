import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";

import { getDb } from "@/lib/db";
import { bulkExtractRuns } from "@/lib/db/schema";

export type BulkExtractKind = "contacts" | "organizations" | "events" | "todos";
export type BulkExtractTargetScope = "all" | "missing";
export type BulkExtractRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type BulkExtractRunRecord = {
  id: string;
  kind: BulkExtractKind;
  modelId: string;
  targetScope: BulkExtractTargetScope;
  status: BulkExtractRunStatus;
  totalThreads: number;
  totalEmails: number;
  completedThreads: number;
  completedEmails: number;
  failedThreads: number;
  currentThreadIndex: number;
  currentThreadId: string | null;
  currentThreadSubject: string | null;
  currentEmailId: string | null;
  currentEmailLabel: string | null;
  currentPass: number | null;
  currentEmailIndex: number | null;
  currentEmailTotal: number | null;
  totalCostUsd: number;
  stintStartedAt: string | null;
  completedEmailsAtStintStart: number;
  activeElapsedMs: number;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
};

export type BulkExtractTarget = {
  /** Thread id when grouped; otherwise the lone email id. */
  progressKey: string;
  threadId: string | null;
  subject: string;
  emailIds: string[];
  prepareQuery: string;
};

type BulkExtractRunRow = typeof bulkExtractRuns.$inferSelect;

function parseTargetScope(
  value: string | null | undefined,
): BulkExtractTargetScope {
  return value === "missing" ? "missing" : "all";
}

function parseCostUsd(value: string | null | undefined): number {
  if (!value?.trim()) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function stintDurationMs(row: BulkExtractRunRow, atMs: number): number {
  if (!row.stintStartedAt) return 0;
  const startMs = Date.parse(row.stintStartedAt);
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, atMs - startMs);
}

function accumulatedActiveMs(row: BulkExtractRunRow, atMs: number): number {
  return row.activeElapsedMs + stintDurationMs(row, atMs);
}

function rowToRecord(row: BulkExtractRunRow): BulkExtractRunRecord {
  return {
    id: row.id,
    kind: row.kind,
    modelId: row.modelId,
    targetScope: parseTargetScope(row.targetScope),
    status: row.status,
    totalThreads: row.totalThreads,
    totalEmails: row.totalEmails,
    completedThreads: row.completedThreads,
    completedEmails: row.completedEmails,
    failedThreads: row.failedThreads,
    currentThreadIndex: row.currentThreadIndex,
    currentThreadId: row.currentThreadId,
    currentThreadSubject: row.currentThreadSubject,
    currentEmailId: row.currentEmailId,
    currentEmailLabel: row.currentEmailLabel,
    currentPass: row.currentPass,
    currentEmailIndex: row.currentEmailIndex,
    currentEmailTotal: row.currentEmailTotal,
    totalCostUsd: parseCostUsd(row.totalCostUsd),
    stintStartedAt: row.stintStartedAt,
    completedEmailsAtStintStart: row.completedEmailsAtStintStart,
    activeElapsedMs: row.activeElapsedMs,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
    lastError: row.lastError,
  };
}

function beginStintUpdate(
  completedEmailsAtStart: number,
  now: string,
): Pick<
  BulkExtractRunRow,
  "stintStartedAt" | "completedEmailsAtStintStart"
> {
  return {
    stintStartedAt: now,
    completedEmailsAtStintStart: Math.max(0, completedEmailsAtStart),
  };
}

function endStintUpdate(
  row: BulkExtractRunRow,
  now: string,
): Pick<BulkExtractRunRow, "activeElapsedMs" | "stintStartedAt"> {
  const atMs = Date.parse(now);
  return {
    activeElapsedMs: Number.isFinite(atMs)
      ? accumulatedActiveMs(row, atMs)
      : row.activeElapsedMs,
    stintStartedAt: null,
  };
}

/**
 * Running rows created before stint columns existed, or resumed without a
 * baseline, would count all lifetime emails in the current stint.
 */
async function repairRunningRunStintIfNeeded(row: BulkExtractRunRow): Promise<void> {
  if (row.status !== "running") return;

  const now = new Date().toISOString();
  const atMs = Date.parse(now);
  const stintEmails = Math.max(
    0,
    row.completedEmails - row.completedEmailsAtStintStart,
  );
  const stintMs = stintDurationMs(row, atMs);

  const missingStintClock = !row.stintStartedAt;
  const baselineNeverSet =
    row.completedEmailsAtStintStart === 0 &&
    row.completedEmails > 0 &&
    row.activeElapsedMs > 0;
  const implausibleRate =
    stintEmails > 0 &&
    stintMs >= 1000 &&
    stintEmails / (stintMs / 1000) > 2;

  if (!missingStintClock && !baselineNeverSet && !implausibleRate) return;

  const db = getDb();
  await db
    .update(bulkExtractRuns)
    .set({
      ...beginStintUpdate(row.completedEmails, now),
      updatedAt: now,
    })
    .where(eq(bulkExtractRuns.id, row.id));
}

/** Mark orphaned browser runs as failed so history stays honest. */
async function failStaleRunningRuns(): Promise<void> {
  const db = getDb();
  const running = await db
    .select()
    .from(bulkExtractRuns)
    .where(eq(bulkExtractRuns.status, "running"));

  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const row of running) {
    const updatedMs = Date.parse(row.updatedAt);
    if (!Number.isFinite(updatedMs) || updatedMs >= cutoff) continue;
    const now = new Date().toISOString();
    await db
      .update(bulkExtractRuns)
      .set({
        status: "failed",
        finishedAt: now,
        updatedAt: now,
        lastError:
          row.lastError?.trim() ||
          "Interrupted (no progress for 10+ minutes — browser closed or tab slept).",
        ...endStintUpdate(row, now),
        currentThreadIndex: 0,
        currentThreadId: null,
        currentThreadSubject: null,
        currentEmailId: null,
        currentEmailLabel: null,
        currentPass: null,
        currentEmailIndex: null,
        currentEmailTotal: null,
      })
      .where(eq(bulkExtractRuns.id, row.id));
  }
}

export async function listRunningBulkExtractRuns(): Promise<BulkExtractRunRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(bulkExtractRuns)
    .where(eq(bulkExtractRuns.status, "running"));
  return rows.map(rowToRecord);
}

export async function getLatestCompletedModelId(
  kind: BulkExtractKind,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ modelId: bulkExtractRuns.modelId })
    .from(bulkExtractRuns)
    .where(
      and(
        eq(bulkExtractRuns.kind, kind),
        eq(bulkExtractRuns.status, "completed"),
      ),
    )
    .orderBy(desc(bulkExtractRuns.finishedAt), desc(bulkExtractRuns.startedAt))
    .limit(1);
  return row?.modelId?.trim() || null;
}

export async function listBulkExtractRuns(
  limit = 40,
): Promise<BulkExtractRunRecord[]> {
  await failStaleRunningRuns();
  const db = getDb();
  const rows = await db
    .select()
    .from(bulkExtractRuns)
    .orderBy(desc(bulkExtractRuns.startedAt))
    .limit(Math.min(Math.max(limit, 1), 100));

  for (const row of rows) {
    if (row.status === "running") {
      await repairRunningRunStintIfNeeded(row);
    }
  }

  const finalRows = await db
    .select()
    .from(bulkExtractRuns)
    .orderBy(desc(bulkExtractRuns.startedAt))
    .limit(Math.min(Math.max(limit, 1), 100));

  return finalRows.map(rowToRecord);
}

export async function getBulkExtractRun(
  id: string,
): Promise<BulkExtractRunRecord | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(bulkExtractRuns)
    .where(eq(bulkExtractRuns.id, id))
    .limit(1);
  if (!row) return null;

  if (row.status === "running") {
    await repairRunningRunStintIfNeeded(row);
    const [repaired] = await db
      .select()
      .from(bulkExtractRuns)
      .where(eq(bulkExtractRuns.id, id))
      .limit(1);
    return repaired ? rowToRecord(repaired) : rowToRecord(row);
  }

  return rowToRecord(row);
}

/** Only one inbox-wide run may be active; cancel others before start/resume. */
async function cancelOtherRunningRuns(
  exceptId: string | null,
  reason: string,
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const active = await db
    .select()
    .from(bulkExtractRuns)
    .where(eq(bulkExtractRuns.status, "running"));
  for (const row of active) {
    if (exceptId && row.id === exceptId) continue;
    await db
      .update(bulkExtractRuns)
      .set({
        status: "cancelled",
        finishedAt: now,
        updatedAt: now,
        lastError: row.lastError?.trim() || reason,
        ...endStintUpdate(row, now),
        currentThreadIndex: 0,
        currentThreadId: null,
        currentThreadSubject: null,
        currentEmailId: null,
        currentEmailLabel: null,
        currentPass: null,
        currentEmailIndex: null,
        currentEmailTotal: null,
      })
      .where(eq(bulkExtractRuns.id, row.id));
  }
}

export async function createBulkExtractRun(input: {
  kind: BulkExtractKind;
  modelId: string;
  totalThreads: number;
  totalEmails: number;
  targetScope?: BulkExtractTargetScope;
  cancelOthers?: boolean;
}): Promise<BulkExtractRunRecord> {
  const db = getDb();
  const now = new Date().toISOString();
  const targetScope = input.targetScope ?? "all";

  if (input.cancelOthers !== false) {
    await cancelOtherRunningRuns(null, "Superseded by a new bulk run.");
  }

  const id = randomUUID();
  await db.insert(bulkExtractRuns).values({
    id,
    kind: input.kind,
    modelId: input.modelId,
    targetScope,
    status: "running",
    totalThreads: input.totalThreads,
    totalEmails: input.totalEmails,
    completedThreads: 0,
    completedEmails: 0,
    failedThreads: 0,
    currentThreadIndex: 0,
    currentThreadId: null,
    currentThreadSubject: null,
    currentEmailId: null,
    currentEmailLabel: null,
    currentPass: null,
    currentEmailIndex: null,
    currentEmailTotal: null,
    totalCostUsd: "0",
    ...beginStintUpdate(0, now),
    activeElapsedMs: 0,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    lastError: null,
  });

  const created = await getBulkExtractRun(id);
  if (!created) {
    throw new Error("Bulk extract run created but could not be loaded.");
  }
  return created;
}

/** Re-open a failed/cancelled run so the client can continue from completedThreads. */
export async function resumeBulkExtractRun(
  id: string,
  totals?: { totalThreads: number; totalEmails: number },
): Promise<BulkExtractRunRecord> {
  const existing = await getBulkExtractRun(id);
  if (!existing) {
    throw new Error("Run not found.");
  }
  if (
    existing.status !== "failed" &&
    existing.status !== "cancelled" &&
    existing.status !== "completed"
  ) {
    throw new Error("Only failed, cancelled, or partially completed runs can be resumed.");
  }
  if (existing.completedThreads >= existing.totalThreads && !totals) {
    throw new Error("Run already finished all threads — nothing to resume.");
  }

  const totalThreads = totals?.totalThreads ?? existing.totalThreads;
  const totalEmails = totals?.totalEmails ?? existing.totalEmails;
  if (existing.completedThreads >= totalThreads) {
    throw new Error("Run already finished all threads — nothing to resume.");
  }

  await cancelOtherRunningRuns(id, "Superseded by a resumed bulk run.");

  const db = getDb();
  const now = new Date().toISOString();
  const [row] = await db
    .select()
    .from(bulkExtractRuns)
    .where(eq(bulkExtractRuns.id, id))
    .limit(1);
  if (!row) {
    throw new Error("Run not found.");
  }

  await db
    .update(bulkExtractRuns)
    .set({
      status: "running",
      totalThreads,
      totalEmails,
      failedThreads: 0,
      updatedAt: now,
      finishedAt: null,
      lastError: null,
      ...beginStintUpdate(row.completedEmails, now),
      currentThreadIndex: 0,
      currentThreadId: null,
      currentThreadSubject: null,
      currentEmailId: null,
      currentEmailLabel: null,
      currentPass: null,
      currentEmailIndex: null,
      currentEmailTotal: null,
    })
    .where(eq(bulkExtractRuns.id, id));

  const resumed = await getBulkExtractRun(id);
  if (!resumed) {
    throw new Error("Run resumed but could not be loaded.");
  }
  return resumed;
}

export type BulkExtractRunPatch = {
  status?: BulkExtractRunStatus;
  totalThreads?: number;
  totalEmails?: number;
  completedThreads?: number;
  completedEmails?: number;
  failedThreads?: number;
  currentThreadIndex?: number;
  currentThreadId?: string | null;
  currentThreadSubject?: string | null;
  currentEmailId?: string | null;
  currentEmailLabel?: string | null;
  currentPass?: number | null;
  currentEmailIndex?: number | null;
  currentEmailTotal?: number | null;
  /** Absolute cumulative cost for the run. */
  totalCostUsd?: number;
  lastError?: string | null;
};

export async function updateBulkExtractRun(
  id: string,
  patch: BulkExtractRunPatch,
): Promise<BulkExtractRunRecord | null> {
  const db = getDb();
  const [existingRow] = await db
    .select()
    .from(bulkExtractRuns)
    .where(eq(bulkExtractRuns.id, id))
    .limit(1);
  if (!existingRow) return null;

  const existing = rowToRecord(existingRow);
  const now = new Date().toISOString();
  const status = patch.status ?? existing.status;
  const terminal =
    status === "completed" || status === "failed" || status === "cancelled";
  const leavingRunning =
    existing.status === "running" && status !== "running";

  await db
    .update(bulkExtractRuns)
    .set({
      status,
      totalThreads: patch.totalThreads ?? existing.totalThreads,
      totalEmails: patch.totalEmails ?? existing.totalEmails,
      completedThreads: patch.completedThreads ?? existing.completedThreads,
      completedEmails: patch.completedEmails ?? existing.completedEmails,
      failedThreads: patch.failedThreads ?? existing.failedThreads,
      currentThreadIndex:
        patch.currentThreadIndex ?? existing.currentThreadIndex,
      currentThreadId:
        patch.currentThreadId !== undefined
          ? patch.currentThreadId
          : existing.currentThreadId,
      currentThreadSubject:
        patch.currentThreadSubject !== undefined
          ? patch.currentThreadSubject
          : existing.currentThreadSubject,
      currentEmailId:
        patch.currentEmailId !== undefined
          ? patch.currentEmailId
          : existing.currentEmailId,
      currentEmailLabel:
        patch.currentEmailLabel !== undefined
          ? patch.currentEmailLabel
          : existing.currentEmailLabel,
      currentPass:
        patch.currentPass !== undefined
          ? patch.currentPass
          : existing.currentPass,
      currentEmailIndex:
        patch.currentEmailIndex !== undefined
          ? patch.currentEmailIndex
          : existing.currentEmailIndex,
      currentEmailTotal:
        patch.currentEmailTotal !== undefined
          ? patch.currentEmailTotal
          : existing.currentEmailTotal,
      totalCostUsd:
        patch.totalCostUsd !== undefined
          ? String(patch.totalCostUsd)
          : String(existing.totalCostUsd),
      updatedAt: now,
      finishedAt: terminal ? (existing.finishedAt ?? now) : null,
      lastError:
        patch.lastError !== undefined ? patch.lastError : existing.lastError,
      ...(leavingRunning ? endStintUpdate(existingRow, now) : {}),
      ...(terminal
        ? {
            currentThreadIndex: 0,
            currentThreadId: null,
            currentThreadSubject: null,
            currentEmailId: null,
            currentEmailLabel: null,
            currentPass: null,
            currentEmailIndex: null,
            currentEmailTotal: null,
          }
        : {}),
    })
    .where(eq(bulkExtractRuns.id, id));

  return getBulkExtractRun(id);
}
