/** Persist identity-review runs, decisions, and going-forward policies. */

import { randomUUID } from "crypto";

import { desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  projectIdentityPolicies,
  projectIdentityReviewClusters,
  projectIdentityReviewDecisions,
  projectIdentityReviewRuns,
} from "@/lib/db/schema";
import {
  type IdentityReviewConfidence,
  type IdentityReviewDecisionKind,
  type IdentityReviewDecisionStatus,
  type IdentityReviewPass1Cluster,
  type IdentityReviewPass2Decision,
  type IdentityReviewPolicyDraft,
  type IdentityReviewRunRecord,
  type IdentityReviewRunStatus,
} from "@/lib/projects/identity-review-shared";
import type { ProjectIdentityPolicy } from "@/lib/projects/identity-match";

function parseCostUsd(value: string | null | undefined): number {
  if (!value?.trim()) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseRunStatus(value: string): IdentityReviewRunStatus {
  if (
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "failed";
}

function toRunRecord(
  row: typeof projectIdentityReviewRuns.$inferSelect,
): IdentityReviewRunRecord {
  return {
    id: row.id,
    modelId: row.modelId,
    status: parseRunStatus(row.status),
    currentPass: row.currentPass,
    clusterTotal: row.clusterTotal,
    clusterCompleted: row.clusterCompleted,
    projectCount: row.projectCount,
    highApplied: row.highApplied,
    proposedCount: row.proposedCount,
    totalCostUsd: parseCostUsd(row.totalCostUsd),
    lastError: row.lastError,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
  };
}

function parseAliasesJson(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function getIdentityReviewRun(
  runId: string,
): Promise<IdentityReviewRunRecord | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectIdentityReviewRuns)
    .where(eq(projectIdentityReviewRuns.id, runId))
    .limit(1);
  return rows[0] ? toRunRecord(rows[0]) : null;
}

export async function getLatestIdentityReviewRun(): Promise<IdentityReviewRunRecord | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectIdentityReviewRuns)
    .orderBy(desc(projectIdentityReviewRuns.startedAt))
    .limit(1);
  return rows[0] ? toRunRecord(rows[0]) : null;
}

export async function listRunningIdentityReviewRuns(): Promise<
  IdentityReviewRunRecord[]
> {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectIdentityReviewRuns)
    .where(eq(projectIdentityReviewRuns.status, "running"));
  return rows.map(toRunRecord);
}

export async function createIdentityReviewRun(params: {
  modelId: string;
  projectCount: number;
}): Promise<IdentityReviewRunRecord> {
  const db = getDb();
  const now = new Date().toISOString();
  const running = await listRunningIdentityReviewRuns();
  for (const run of running) {
    await db
      .update(projectIdentityReviewRuns)
      .set({
        status: "cancelled",
        lastError: "Superseded by a new identity review.",
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(projectIdentityReviewRuns.id, run.id));
  }

  const id = randomUUID();
  await db.insert(projectIdentityReviewRuns).values({
    id,
    modelId: params.modelId,
    status: "running",
    currentPass: 1,
    clusterTotal: 0,
    clusterCompleted: 0,
    projectCount: params.projectCount,
    highApplied: 0,
    proposedCount: 0,
    totalCostUsd: "0",
    lastError: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
  });
  const created = await getIdentityReviewRun(id);
  if (!created) throw new Error("Failed to create identity review run.");
  return created;
}

export async function updateIdentityReviewRun(
  runId: string,
  patch: Partial<{
    status: IdentityReviewRunStatus;
    currentPass: number | null;
    clusterTotal: number;
    clusterCompleted: number;
    projectCount: number;
    highApplied: number;
    proposedCount: number;
    totalCostUsd: number;
    lastError: string | null;
    finishedAt: string | null;
  }>,
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db
    .update(projectIdentityReviewRuns)
    .set({
      ...(patch.status != null ? { status: patch.status } : {}),
      ...(patch.currentPass !== undefined
        ? { currentPass: patch.currentPass }
        : {}),
      ...(patch.clusterTotal != null
        ? { clusterTotal: patch.clusterTotal }
        : {}),
      ...(patch.clusterCompleted != null
        ? { clusterCompleted: patch.clusterCompleted }
        : {}),
      ...(patch.projectCount != null
        ? { projectCount: patch.projectCount }
        : {}),
      ...(patch.highApplied != null ? { highApplied: patch.highApplied } : {}),
      ...(patch.proposedCount != null
        ? { proposedCount: patch.proposedCount }
        : {}),
      ...(patch.totalCostUsd != null
        ? { totalCostUsd: String(patch.totalCostUsd) }
        : {}),
      ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
      ...(patch.finishedAt !== undefined
        ? { finishedAt: patch.finishedAt }
        : {}),
      updatedAt: now,
    })
    .where(eq(projectIdentityReviewRuns.id, runId));
}

export async function replaceIdentityReviewClusters(params: {
  runId: string;
  clusters: IdentityReviewPass1Cluster[];
}): Promise<Array<IdentityReviewPass1Cluster & { id: string }>> {
  const db = getDb();
  await db
    .delete(projectIdentityReviewClusters)
    .where(eq(projectIdentityReviewClusters.runId, params.runId));
  const rows = params.clusters.map((cluster, index) => ({
    id: randomUUID(),
    runId: params.runId,
    label: cluster.label,
    memberIdsJson: JSON.stringify(cluster.memberIds),
    sortIndex: index,
  }));
  if (rows.length > 0) {
    await db.insert(projectIdentityReviewClusters).values(rows);
  }
  return rows.map((row, index) => ({
    id: row.id,
    label: params.clusters[index]!.label,
    memberIds: params.clusters[index]!.memberIds,
  }));
}

export async function insertIdentityReviewDecision(params: {
  runId: string;
  clusterId: string;
  decision: IdentityReviewPass2Decision;
  status: IdentityReviewDecisionStatus;
  error?: string | null;
}): Promise<string> {
  const db = getDb();
  const id = randomUUID();
  await db.insert(projectIdentityReviewDecisions).values({
    id,
    runId: params.runId,
    clusterId: params.clusterId,
    kind: params.decision.kind,
    confidence: params.decision.confidence,
    rationale: params.decision.rationale,
    workLabel: params.decision.workLabel,
    decisionJson: JSON.stringify(params.decision),
    status: params.status,
    appliedAt: params.status === "applied" ? new Date().toISOString() : null,
    error: params.error ?? null,
  });
  return id;
}

export async function markIdentityReviewDecisionStatus(params: {
  decisionId: string;
  status: IdentityReviewDecisionStatus;
  error?: string | null;
}): Promise<void> {
  const db = getDb();
  await db
    .update(projectIdentityReviewDecisions)
    .set({
      status: params.status,
      appliedAt:
        params.status === "applied" ? new Date().toISOString() : null,
      error: params.error ?? null,
    })
    .where(eq(projectIdentityReviewDecisions.id, params.decisionId));
}

export type StoredIdentityReviewProposal = {
  decisionId: string;
  clusterId: string;
  clusterLabel: string;
  memberIds: string[];
  kind: IdentityReviewDecisionKind;
  confidence: IdentityReviewConfidence;
  rationale: string;
  workLabel: string | null;
  decision: IdentityReviewPass2Decision;
};

function parseMemberIdsJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseStoredDecision(raw: string): IdentityReviewPass2Decision | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as IdentityReviewPass2Decision;
    if (!record.kind || !record.confidence) return null;
    return record;
  } catch {
    return null;
  }
}

/** Proposed (not auto-applied) decisions from the latest run. */
export async function loadLatestProposedIdentityReviewDecisions(): Promise<
  StoredIdentityReviewProposal[]
> {
  const latest = await getLatestIdentityReviewRun();
  if (!latest) return [];
  const db = getDb();
  const [decisionRows, clusterRows] = await Promise.all([
    db
      .select()
      .from(projectIdentityReviewDecisions)
      .where(eq(projectIdentityReviewDecisions.runId, latest.id)),
    db
      .select()
      .from(projectIdentityReviewClusters)
      .where(eq(projectIdentityReviewClusters.runId, latest.id)),
  ]);
  const clusterById = new Map(clusterRows.map((row) => [row.id, row]));
  const out: StoredIdentityReviewProposal[] = [];
  for (const row of decisionRows) {
    if (row.status !== "proposed") continue;
    const cluster = clusterById.get(row.clusterId);
    if (!cluster) continue;
    const decision = parseStoredDecision(row.decisionJson);
    if (!decision) continue;
    out.push({
      decisionId: row.id,
      clusterId: row.clusterId,
      clusterLabel: cluster.label,
      memberIds: parseMemberIdsJson(cluster.memberIdsJson),
      kind: decision.kind,
      confidence: decision.confidence,
      rationale: row.rationale,
      workLabel: row.workLabel,
      decision,
    });
  }
  return out;
}

export async function loadProjectIdentityPolicies(): Promise<
  ProjectIdentityPolicy[]
> {
  const db = getDb();
  const rows = await db.select().from(projectIdentityPolicies);
  return rows.map((row) => ({
    survivorKey: row.survivorKey,
    workLabel: row.workLabel,
    policy: row.policy === "recurring_year" ? "recurring_year" : "span",
    aliases: parseAliasesJson(row.aliasesJson),
    yearHint: row.yearHint,
  }));
}

export async function upsertProjectIdentityPolicies(params: {
  runId: string;
  drafts: IdentityReviewPolicyDraft[];
}): Promise<void> {
  if (params.drafts.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  const keys = params.drafts.map((draft) => draft.survivorKey);
  const existing =
    keys.length === 0
      ? []
      : await db
          .select({
            id: projectIdentityPolicies.id,
            survivorKey: projectIdentityPolicies.survivorKey,
          })
          .from(projectIdentityPolicies)
          .where(inArray(projectIdentityPolicies.survivorKey, keys));
  const byKey = new Map(existing.map((row) => [row.survivorKey, row.id]));

  for (const draft of params.drafts) {
    const priorId = byKey.get(draft.survivorKey);
    if (priorId) {
      await db
        .update(projectIdentityPolicies)
        .set({
          workLabel: draft.workLabel,
          policy: draft.policy,
          aliasesJson: JSON.stringify(draft.aliases),
          yearHint: draft.yearHint,
          reviewRunId: params.runId,
          updatedAt: now,
        })
        .where(eq(projectIdentityPolicies.id, priorId));
      continue;
    }
    await db.insert(projectIdentityPolicies).values({
      id: randomUUID(),
      survivorKey: draft.survivorKey,
      workLabel: draft.workLabel,
      policy: draft.policy,
      aliasesJson: JSON.stringify(draft.aliases),
      yearHint: draft.yearHint,
      reviewRunId: params.runId,
      updatedAt: now,
    });
  }
}

