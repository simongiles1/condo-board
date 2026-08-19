/**
 * Extraction backfill run persistence (Extraction lab modal).
 * Modes: docling_only | vision_only | full.
 */

import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";

import { getDb } from "@/lib/db";
import { doclingBackfillRuns } from "@/lib/db/schema";
import {
  errorGroupsFromHashCounts,
  listVisionErrorsForHashes,
  loadFailedVisionCountsByHash,
  type ExtractionBackfillMode,
  type ExtractionBackfillPageError,
  type ExtractionErrorGroup,
} from "@/lib/email/extraction-backfill-plan";
import { getActiveIbmAccountId } from "@/lib/email/ibm-docling-slots";
import {
  type DoclingProvider,
  normalizeDoclingProvider,
} from "@/lib/email/docling-provider";

export type DoclingBackfillRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type DoclingBackfillPhase = "docling" | "vision";

export type DoclingBackfillRunRecord = {
  id: string;
  status: DoclingBackfillRunStatus;
  mode: ExtractionBackfillMode;
  phase: DoclingBackfillPhase | null;
  docLimit: number | null;
  totalDocs: number;
  totalPages: number;
  totalDoclingPages: number;
  totalVisionPages: number;
  corpusUncachedPages: number;
  corpusPendingDocs: number;
  corpusPendingVisionPages: number;
  corpusPendingVisionDocs: number;
  completedDocs: number;
  completedPages: number;
  completedDoclingPages: number;
  completedVisionPages: number;
  failedDocs: number;
  doclingProvider: DoclingProvider;
  ibmAccountId: string | null;
  doclingCostUsd: number;
  visionCostUsd: number;
  plannedHashes: string[];
  currentDocIndex: number;
  currentContentHash: string | null;
  currentLabel: string | null;
  currentPagesInDoc: number | null;
  stintStartedAt: string | null;
  completedPagesAtStintStart: number;
  activeElapsedMs: number;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  visionErrors: ExtractionBackfillPageError[];
  errorGroups: ExtractionErrorGroup[];
};

type DoclingBackfillRunRow = typeof doclingBackfillRuns.$inferSelect;

function parsePlannedHashes(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((h) => (typeof h === "string" ? h.trim().toLowerCase() : ""))
      .filter((h) => /^[a-f0-9]{64}$/.test(h));
  } catch {
    return [];
  }
}

function parseCostUsd(value: string | null | undefined): number {
  if (!value?.trim()) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeMode(value: string | null | undefined): ExtractionBackfillMode {
  if (value === "vision_only" || value === "full") return value;
  return "docling_only";
}

function normalizePhase(
  value: string | null | undefined,
): DoclingBackfillPhase | null {
  if (value === "docling" || value === "vision") return value;
  return null;
}

function stintDurationMs(row: DoclingBackfillRunRow, atMs: number): number {
  if (!row.stintStartedAt) return 0;
  const startMs = Date.parse(row.stintStartedAt);
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, atMs - startMs);
}

function accumulatedActiveMs(row: DoclingBackfillRunRow, atMs: number): number {
  return row.activeElapsedMs + stintDurationMs(row, atMs);
}

function rowToRecord(row: DoclingBackfillRunRow): DoclingBackfillRunRecord {
  return {
    id: row.id,
    status: row.status,
    mode: normalizeMode(row.mode),
    phase: normalizePhase(row.phase),
    docLimit: row.docLimit,
    totalDocs: row.totalDocs,
    totalPages: row.totalPages,
    totalDoclingPages: row.totalDoclingPages,
    totalVisionPages: row.totalVisionPages,
    corpusUncachedPages: row.corpusUncachedPages,
    corpusPendingDocs: row.corpusPendingDocs,
    corpusPendingVisionPages: row.corpusPendingVisionPages,
    corpusPendingVisionDocs: row.corpusPendingVisionDocs,
    completedDocs: row.completedDocs,
    completedPages: row.completedPages,
    completedDoclingPages: row.completedDoclingPages,
    completedVisionPages: row.completedVisionPages,
    failedDocs: row.failedDocs,
    doclingProvider: normalizeDoclingProvider(row.doclingProvider),
    ibmAccountId: row.ibmAccountId ?? null,
    doclingCostUsd: parseCostUsd(row.doclingCostUsd),
    visionCostUsd: parseCostUsd(row.visionCostUsd),
    plannedHashes: parsePlannedHashes(row.plannedHashesJson),
    currentDocIndex: row.currentDocIndex,
    currentContentHash: row.currentContentHash,
    currentLabel: row.currentLabel,
    currentPagesInDoc: row.currentPagesInDoc,
    stintStartedAt: row.stintStartedAt,
    completedPagesAtStintStart: row.completedPagesAtStintStart,
    activeElapsedMs: row.activeElapsedMs,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
    lastError: row.lastError,
    visionErrors: [],
    errorGroups: [],
  };
}

function completedPagesBaseline(row: DoclingBackfillRunRow): number {
  return Math.max(
    0,
    row.completedPages,
    row.completedDoclingPages + row.completedVisionPages,
  );
}

function beginStintUpdate(
  completedPagesAtStart: number,
  now: string,
): Pick<
  DoclingBackfillRunRow,
  "stintStartedAt" | "completedPagesAtStintStart"
> {
  return {
    stintStartedAt: now,
    completedPagesAtStintStart: Math.max(0, completedPagesAtStart),
  };
}

function endStintUpdate(
  row: DoclingBackfillRunRow,
  now: string,
): Pick<DoclingBackfillRunRow, "activeElapsedMs" | "stintStartedAt"> {
  const atMs = Date.parse(now);
  return {
    activeElapsedMs: Number.isFinite(atMs)
      ? accumulatedActiveMs(row, atMs)
      : row.activeElapsedMs,
    stintStartedAt: null,
  };
}

function clearCurrentFields() {
  return {
    currentDocIndex: 0,
    currentContentHash: null as string | null,
    currentLabel: null as string | null,
    currentPagesInDoc: null as number | null,
    phase: null as DoclingBackfillPhase | null,
  };
}

const STALE_RUNNING_MS = 5 * 60 * 1000;

async function failStaleRunningRuns(): Promise<void> {
  const db = getDb();
  const running = await db
    .select()
    .from(doclingBackfillRuns)
    .where(eq(doclingBackfillRuns.status, "running"));

  const cutoff = Date.now() - STALE_RUNNING_MS;
  for (const row of running) {
    const updatedMs = Date.parse(row.updatedAt);
    if (!Number.isFinite(updatedMs) || updatedMs >= cutoff) continue;
    const now = new Date().toISOString();
    await db
      .update(doclingBackfillRuns)
      .set({
        status: "failed",
        finishedAt: now,
        updatedAt: now,
        lastError:
          row.lastError?.trim() ||
          "Interrupted (no heartbeat for 5+ minutes — worker stalled or the process exited).",
        ...endStintUpdate(row, now),
        ...clearCurrentFields(),
      })
      .where(eq(doclingBackfillRuns.id, row.id));
  }
}

async function cancelOtherRunningRuns(
  exceptId: string | null,
  reason: string,
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const active = await db
    .select()
    .from(doclingBackfillRuns)
    .where(eq(doclingBackfillRuns.status, "running"));
  for (const row of active) {
    if (exceptId && row.id === exceptId) continue;
    await db
      .update(doclingBackfillRuns)
      .set({
        status: "cancelled",
        finishedAt: now,
        updatedAt: now,
        lastError: row.lastError?.trim() || reason,
        ...endStintUpdate(row, now),
        ...clearCurrentFields(),
      })
      .where(eq(doclingBackfillRuns.id, row.id));
  }
}

export async function listRunningDoclingBackfillRuns(): Promise<
  DoclingBackfillRunRecord[]
> {
  const db = getDb();
  const rows = await db
    .select()
    .from(doclingBackfillRuns)
    .where(eq(doclingBackfillRuns.status, "running"));
  return rows.map(rowToRecord);
}

async function attachVisionErrors(
  runs: DoclingBackfillRunRecord[],
  options?: { includePageList?: boolean },
): Promise<DoclingBackfillRunRecord[]> {
  if (runs.length === 0) return runs;

  const counts = await loadFailedVisionCountsByHash();

  let pageErrors: ExtractionBackfillPageError[] = [];
  if (options?.includePageList) {
    pageErrors = await listVisionErrorsForHashes(
      runs.flatMap((run) => run.plannedHashes),
    );
  }
  const byHash = new Map<string, ExtractionBackfillPageError[]>();
  for (const error of pageErrors) {
    const list = byHash.get(error.contentHash) ?? [];
    list.push(error);
    byHash.set(error.contentHash, list);
  }

  return runs.map((run) => ({
    ...run,
    errorGroups: errorGroupsFromHashCounts(counts, run.plannedHashes),
    visionErrors: options?.includePageList
      ? run.plannedHashes.flatMap((hash) => byHash.get(hash) ?? [])
      : [],
  }));
}

export async function listDoclingBackfillRuns(
  limit = 40,
): Promise<DoclingBackfillRunRecord[]> {
  await failStaleRunningRuns();
  const db = getDb();
  const rows = await db
    .select()
    .from(doclingBackfillRuns)
    .orderBy(desc(doclingBackfillRuns.startedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return attachVisionErrors(rows.map(rowToRecord), { includePageList: false });
}

export async function getDoclingBackfillRun(
  id: string,
  options?: { includeVisionErrors?: boolean },
): Promise<DoclingBackfillRunRecord | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(doclingBackfillRuns)
    .where(eq(doclingBackfillRuns.id, id))
    .limit(1);
  if (!row) return null;
  const record = rowToRecord(row);
  const [withErrors] = await attachVisionErrors([record], {
    includePageList: options?.includeVisionErrors !== false,
  });
  return withErrors ?? record;
}

export async function createDoclingBackfillRun(input: {
  mode: ExtractionBackfillMode;
  doclingProvider: DoclingProvider;
  docLimit: number | null;
  plannedHashes: string[];
  totalDoclingPages: number;
  totalVisionPages: number;
  corpusUncachedPages: number;
  corpusPendingDocs: number;
  corpusPendingVisionPages: number;
  corpusPendingVisionDocs: number;
}): Promise<DoclingBackfillRunRecord> {
  const db = getDb();
  const now = new Date().toISOString();

  await cancelOtherRunningRuns(null, "Superseded by a new extraction backfill.");

  const id = randomUUID();
  const plannedHashes = input.plannedHashes.map((h) => h.toLowerCase());
  const totalPages = input.totalDoclingPages + input.totalVisionPages;
  const ibmAccountId =
    input.doclingProvider === "ibm" ? await getActiveIbmAccountId() : null;
  await db.insert(doclingBackfillRuns).values({
    id,
    status: "running",
    mode: input.mode,
    docLimit: input.docLimit,
    totalDocs: plannedHashes.length,
    totalPages,
    totalDoclingPages: input.totalDoclingPages,
    totalVisionPages: input.totalVisionPages,
    corpusUncachedPages: input.corpusUncachedPages,
    corpusPendingDocs: input.corpusPendingDocs,
    corpusPendingVisionPages: input.corpusPendingVisionPages,
    corpusPendingVisionDocs: input.corpusPendingVisionDocs,
    completedDocs: 0,
    completedPages: 0,
    completedDoclingPages: 0,
    completedVisionPages: 0,
    failedDocs: 0,
    doclingProvider: input.doclingProvider,
    ibmAccountId,
    doclingCostUsd: "0",
    visionCostUsd: "0",
    plannedHashesJson: JSON.stringify(plannedHashes),
    ...clearCurrentFields(),
    ...beginStintUpdate(0, now),
    activeElapsedMs: 0,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    lastError: null,
  });

  const created = await getDoclingBackfillRun(id);
  if (!created) {
    throw new Error("Extraction backfill run created but could not be loaded.");
  }
  return created;
}

export async function resumeDoclingBackfillRun(
  id: string,
): Promise<DoclingBackfillRunRecord> {
  const existing = await getDoclingBackfillRun(id);
  if (!existing) {
    throw new Error("Run not found.");
  }
  if (
    existing.status !== "failed" &&
    existing.status !== "cancelled" &&
    existing.status !== "completed"
  ) {
    throw new Error(
      "Only failed, cancelled, or partially completed runs can be resumed.",
    );
  }
  if (existing.completedDocs >= existing.totalDocs) {
    throw new Error("Run already finished all planned docs — nothing to resume.");
  }

  await cancelOtherRunningRuns(id, "Superseded by a resumed extraction backfill.");

  const db = getDb();
  const now = new Date().toISOString();
  const [row] = await db
    .select()
    .from(doclingBackfillRuns)
    .where(eq(doclingBackfillRuns.id, id))
    .limit(1);
  if (!row) {
    throw new Error("Run not found.");
  }

  await db
    .update(doclingBackfillRuns)
    .set({
      status: "running",
      failedDocs: 0,
      updatedAt: now,
      finishedAt: null,
      lastError: null,
      ...beginStintUpdate(completedPagesBaseline(row), now),
      ...clearCurrentFields(),
    })
    .where(eq(doclingBackfillRuns.id, id));

  const resumed = await getDoclingBackfillRun(id);
  if (!resumed) {
    throw new Error("Run resumed but could not be loaded.");
  }
  return resumed;
}

export type DoclingBackfillRunPatch = {
  status?: DoclingBackfillRunStatus;
  phase?: DoclingBackfillPhase | null;
  completedDocs?: number;
  completedPages?: number;
  completedDoclingPages?: number;
  completedVisionPages?: number;
  failedDocs?: number;
  doclingCostUsd?: number;
  visionCostUsd?: number;
  currentDocIndex?: number;
  currentContentHash?: string | null;
  currentLabel?: string | null;
  currentPagesInDoc?: number | null;
  lastError?: string | null;
};

export async function updateDoclingBackfillRun(
  id: string,
  patch: DoclingBackfillRunPatch,
): Promise<DoclingBackfillRunRecord | null> {
  const db = getDb();
  const [existingRow] = await db
    .select()
    .from(doclingBackfillRuns)
    .where(eq(doclingBackfillRuns.id, id))
    .limit(1);
  if (!existingRow) return null;

  const existing = rowToRecord(existingRow);
  const now = new Date().toISOString();
  const status = patch.status ?? existing.status;
  const terminal =
    status === "completed" || status === "failed" || status === "cancelled";
  const leavingRunning =
    existing.status === "running" && status !== "running";

  const completedDocling =
    patch.completedDoclingPages ?? existing.completedDoclingPages;
  const completedVision =
    patch.completedVisionPages ?? existing.completedVisionPages;
  const completedPages =
    patch.completedPages ?? completedDocling + completedVision;

  await db
    .update(doclingBackfillRuns)
    .set({
      status,
      phase:
        patch.phase !== undefined
          ? patch.phase
          : terminal
            ? null
            : existing.phase,
      completedDocs: patch.completedDocs ?? existing.completedDocs,
      completedPages,
      completedDoclingPages: completedDocling,
      completedVisionPages: completedVision,
      failedDocs: patch.failedDocs ?? existing.failedDocs,
      doclingCostUsd:
        patch.doclingCostUsd !== undefined
          ? String(patch.doclingCostUsd)
          : String(existing.doclingCostUsd),
      visionCostUsd:
        patch.visionCostUsd !== undefined
          ? String(patch.visionCostUsd)
          : String(existing.visionCostUsd),
      currentDocIndex: patch.currentDocIndex ?? existing.currentDocIndex,
      currentContentHash:
        patch.currentContentHash !== undefined
          ? patch.currentContentHash
          : existing.currentContentHash,
      currentLabel:
        patch.currentLabel !== undefined
          ? patch.currentLabel
          : existing.currentLabel,
      currentPagesInDoc:
        patch.currentPagesInDoc !== undefined
          ? patch.currentPagesInDoc
          : existing.currentPagesInDoc,
      updatedAt: now,
      finishedAt: terminal ? (existing.finishedAt ?? now) : null,
      lastError:
        patch.lastError !== undefined ? patch.lastError : existing.lastError,
      ...(leavingRunning ? endStintUpdate(existingRow, now) : {}),
      ...(terminal ? clearCurrentFields() : {}),
    })
    .where(eq(doclingBackfillRuns.id, id));

  return getDoclingBackfillRun(id);
}

/** Keep `updatedAt` fresh while a worker is blocked on IBM/Gemini. */
export async function touchDoclingBackfillRun(id: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db
    .update(doclingBackfillRuns)
    .set({ updatedAt: now })
    .where(
      and(
        eq(doclingBackfillRuns.id, id),
        eq(doclingBackfillRuns.status, "running"),
      ),
    );
}
