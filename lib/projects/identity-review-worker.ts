/**
 * Two-pass AI project identity review worker.
 * Pass 1 clusters all registry cards by type of work; pass 2 reads emails
 * per cluster and decides spanning vs yearly vs separate.
 */

import { inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emails } from "@/lib/db/schema";
import { generateDeepSeekJson } from "@/lib/deepseek/client";
import {
  getProjectHighlightModelMeta,
  getProjectHighlightPassConfig,
  resolveProjectHighlightModel,
  type ProjectHighlightModelId,
} from "@/lib/email-analysis/project-highlight-models";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { estimateCostUsd } from "@/lib/gemini/usage";
import {
  loadProjectFingerprintSummaries,
  snapshotProjectSourceEmailIds,
  type ProjectFingerprintSummary,
} from "@/lib/projects/fingerprint-list";
import {
  createIdentityReviewRun,
  getIdentityReviewRun,
  insertIdentityReviewDecision,
  listRunningIdentityReviewRuns,
  markIdentityReviewDecisionStatus,
  replaceIdentityReviewClusters,
  updateIdentityReviewRun,
  upsertProjectIdentityPolicies,
} from "@/lib/projects/identity-review";
import { manualMergeManyProjects } from "@/lib/projects/manual-merge";
import {
  buildIdentityReviewPass1SystemPrompt,
  buildIdentityReviewPass1UserPrompt,
  buildIdentityReviewPass2SystemPrompt,
  buildIdentityReviewPass2UserPrompt,
  IDENTITY_REVIEW_PASS1_MAX_OUTPUT_TOKENS,
  IDENTITY_REVIEW_PASS2_MAX_CHARS,
  IDENTITY_REVIEW_PASS2_MAX_OUTPUT_TOKENS,
  parseIdentityReviewPass1Clusters,
  parseIdentityReviewPass2Decision,
  parseJsonObjectText,
  planIdentityReviewDecision,
  type IdentityReviewPass1Row,
} from "@/lib/projects/identity-review-shared";

const activeWorkers = new Map<string, Promise<void>>();

function pass2MaxChars(): number {
  const raw = process.env.PROJECT_IDENTITY_REVIEW_PASS2_MAX_CHARS?.trim();
  if (!raw) return IDENTITY_REVIEW_PASS2_MAX_CHARS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 20_000) return IDENTITY_REVIEW_PASS2_MAX_CHARS;
  return Math.min(600_000, Math.floor(n));
}

function truncateField(value: string | null | undefined, max = 80): string | null {
  const trimmed = value?.trim() || null;
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function toPass1Row(project: ProjectFingerprintSummary): IdentityReviewPass1Row {
  return {
    id: project.id,
    name: project.name,
    aliases: (project.aliases ?? []).slice(0, 8),
    yearHint: project.year_hint,
    phase: project.phase,
    contractor: truncateField(project.contractor),
    location: truncateField(project.location),
    scope: project.scope,
    sourceEmailCount: project.sourceEmailCount,
  };
}

async function runIdentityReviewLlm(params: {
  modelId: ProjectHighlightModelId;
  systemInstruction: string;
  userText: string;
  maxOutputTokens: number;
  step: string;
}): Promise<{ text: string; modelName: string; costUsd: number }> {
  const meta = getProjectHighlightModelMeta(params.modelId);
  const passConfig = getProjectHighlightPassConfig(params.modelId, 4);
  const result =
    meta.provider === "deepseek"
      ? await generateDeepSeekJson({
          systemInstruction: params.systemInstruction,
          userText: params.userText,
          modelName: passConfig.apiModelName,
          maxOutputTokens: params.maxOutputTokens,
          thinking: passConfig.thinking,
        })
      : await generateEmailExtraction({
          systemInstruction: params.systemInstruction,
          userText: params.userText,
          modelName: passConfig.apiModelName,
          maxOutputTokens: params.maxOutputTokens,
          step: params.step,
        });
  return {
    text: result.text,
    modelName: result.modelName,
    costUsd: estimateCostUsd(result.modelName, result.usage),
  };
}

function truncateAroundNeedle(
  text: string,
  needle: string | null,
  maxChars: number,
): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  const hay = trimmed.toLowerCase();
  const n = needle?.trim().toLowerCase() ?? "";
  let start = 0;
  if (n.length >= 3) {
    const idx = hay.indexOf(n);
    if (idx >= 0) start = Math.max(0, idx - Math.floor(maxChars / 4));
  }
  const slice = trimmed.slice(start, start + maxChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = start + maxChars < trimmed.length ? "…" : "";
  return `${prefix}${slice}${suffix}`;
}

async function packClusterEmails(params: {
  members: ProjectFingerprintSummary[];
  maxChars: number;
  emailIdsByProjectId: Record<string, string[]>;
}): Promise<
  Array<{
    projectIds: string[];
    subject: string;
    from: string;
    at: string;
    excerpt: string;
  }>
> {
  const emailToProjects = new Map<string, Set<string>>();
  for (const member of params.members) {
    const ids = params.emailIdsByProjectId[member.id] ?? [];
    for (const emailId of ids) {
      const set = emailToProjects.get(emailId) ?? new Set<string>();
      set.add(member.id);
      emailToProjects.set(emailId, set);
    }
  }
  const emailIds = [...emailToProjects.keys()];
  if (emailIds.length === 0) return [];

  const db = getDb();
  const rows: Array<{
    id: string;
    subject: string;
    fromAddress: string;
    receivedAt: string;
    bodyText: string;
    bodyTextUnique: string | null;
    bodyTextStrictUnique: string | null;
  }> = [];
  const chunkSize = 200;
  for (let i = 0; i < emailIds.length; i += chunkSize) {
    const chunk = emailIds.slice(i, i + chunkSize);
    const part = await db
      .select({
        id: emails.id,
        subject: emails.subject,
        fromAddress: emails.fromAddress,
        receivedAt: emails.receivedAt,
        bodyText: emails.bodyText,
        bodyTextUnique: emails.bodyTextUnique,
        bodyTextStrictUnique: emails.bodyTextStrictUnique,
      })
      .from(emails)
      .where(inArray(emails.id, chunk));
    rows.push(...part);
  }

  rows.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

  const needle =
    params.members.find((m) => m.name?.trim())?.name?.trim() ?? null;
  const packed: Array<{
    projectIds: string[];
    subject: string;
    from: string;
    at: string;
    excerpt: string;
  }> = [];
  const seen = new Set<string>();
  let used = 0;
  const perEmailCap = Math.min(8_000, Math.max(1_200, Math.floor(params.maxChars / 8)));

  for (const row of rows) {
    const body =
      row.bodyTextStrictUnique?.trim() ||
      row.bodyTextUnique?.trim() ||
      row.bodyText;
    const excerpt = truncateAroundNeedle(body, needle, perEmailCap);
    if (!excerpt) continue;
    const dedupeKey = `${row.subject.trim().toLowerCase()}|${excerpt.slice(0, 180).toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    const nextLen = excerpt.length + row.subject.length + 40;
    if (packed.length > 0 && used + nextLen > params.maxChars) break;
    seen.add(dedupeKey);
    used += nextLen;
    packed.push({
      projectIds: [...(emailToProjects.get(row.id) ?? [])],
      subject: row.subject,
      from: row.fromAddress,
      at: row.receivedAt.slice(0, 10),
      excerpt,
    });
  }
  return packed;
}

async function applyIdentityReviewMerges(
  merges: Array<{ targetId: string; sourceIds: string[] }>,
): Promise<{ applied: number; errors: string[] }> {
  let applied = 0;
  const errors: string[] = [];
  for (const merge of merges) {
    if (merge.sourceIds.length === 0) continue;
    const result = await manualMergeManyProjects({
      sourceProjectIds: merge.sourceIds,
      targetProjectId: merge.targetId,
      refreshRegistry: false,
    });
    if (!result.ok) {
      errors.push(result.error);
      continue;
    }
    applied += result.merged;
  }
  return { applied, errors };
}

async function isRunStillActive(runId: string): Promise<boolean> {
  const run = await getIdentityReviewRun(runId);
  return run?.status === "running";
}

const registryRefreshByRun = new Map<string, Promise<void>>();

/** One fingerprint+mention rebuild per run. Safe to call from cancel and worker. */
export function refreshRegistryAfterIdentityReview(runId: string): Promise<void> {
  const existing = registryRefreshByRun.get(runId);
  if (existing) return existing;
  console.info("[project-identity-review] Refreshing registry after run", {
    runId,
  });
  const promise = (async () => {
    const { refreshProjectEntitiesAndResolveMentions } = await import(
      "@/lib/projects/mention-resolve"
    );
    await refreshProjectEntitiesAndResolveMentions();
  })()
    .catch((error: unknown) => {
      console.error("[project-mentions] resolve after identity review failed", {
        runId,
        error:
          error instanceof Error ? error.message : "Project mention resolve failed",
      });
    })
    .finally(() => {
      registryRefreshByRun.delete(runId);
    });
  registryRefreshByRun.set(runId, promise);
  return promise;
}

export function identityReviewWorkerIsActive(runId: string): boolean {
  return activeWorkers.has(runId);
}

async function stopIfInactive(
  runId: string,
  needsRegistryRefresh: boolean,
): Promise<boolean> {
  if (await isRunStillActive(runId)) return false;
  if (needsRegistryRefresh) await refreshRegistryAfterIdentityReview(runId);
  return true;
}

async function executeIdentityReviewRun(runId: string): Promise<void> {
  const run = await getIdentityReviewRun(runId);
  if (!run || run.status !== "running") return;

  const modelId = resolveProjectHighlightModel(run.modelId);
  const { projects } = await loadProjectFingerprintSummaries({
    sort: "mentions-desc",
  });
  const emailIdsByProjectId = await snapshotProjectSourceEmailIds();
  const knownIds = new Set(projects.map((project) => project.id));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  await updateIdentityReviewRun(runId, { projectCount: projects.length });

  let totalCostUsd = 0;

  await updateIdentityReviewRun(runId, { currentPass: 1 });
  const pass1 = await runIdentityReviewLlm({
    modelId,
    systemInstruction: buildIdentityReviewPass1SystemPrompt(),
    userText: buildIdentityReviewPass1UserPrompt(projects.map(toPass1Row)),
    maxOutputTokens: IDENTITY_REVIEW_PASS1_MAX_OUTPUT_TOKENS,
    step: "project_identity_review_pass1",
  });
  totalCostUsd += pass1.costUsd;

  if (await stopIfInactive(runId, false)) return;

  let clusters;
  try {
    clusters = parseIdentityReviewPass1Clusters(
      parseJsonObjectText(pass1.text),
      knownIds,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Pass 1 JSON could not be parsed.";
    await updateIdentityReviewRun(runId, {
      status: "failed",
      lastError: message,
      totalCostUsd,
      finishedAt: new Date().toISOString(),
    });
    return;
  }

  const storedClusters = await replaceIdentityReviewClusters({
    runId,
    clusters,
  });
  await updateIdentityReviewRun(runId, {
    currentPass: 2,
    clusterTotal: storedClusters.length,
    clusterCompleted: 0,
    totalCostUsd,
  });

  let highApplied = 0;
  let proposedCount = 0;
  const maxChars = pass2MaxChars();

  for (let i = 0; i < storedClusters.length; i++) {
    if (await stopIfInactive(runId, highApplied > 0)) return;
    const cluster = storedClusters[i]!;
    const members = cluster.memberIds
      .map((id) => projectById.get(id))
      .filter((row): row is ProjectFingerprintSummary => Boolean(row));
    if (members.length < 2) {
      await updateIdentityReviewRun(runId, {
        clusterCompleted: i + 1,
        totalCostUsd,
      });
      continue;
    }

    try {
      const packStarted = Date.now();
      const emailPack = await packClusterEmails({
        members,
        maxChars,
        emailIdsByProjectId,
      });
      const packMs = Date.now() - packStarted;
      const llmStarted = Date.now();
      const pass2 = await runIdentityReviewLlm({
        modelId,
        systemInstruction: buildIdentityReviewPass2SystemPrompt(),
        userText: buildIdentityReviewPass2UserPrompt({
          label: cluster.label,
          members: members.map(toPass1Row),
          emails: emailPack,
        }),
        maxOutputTokens: IDENTITY_REVIEW_PASS2_MAX_OUTPUT_TOKENS,
        step: "project_identity_review_pass2",
      });
      const llmMs = Date.now() - llmStarted;
      totalCostUsd += pass2.costUsd;
      console.info("[project-identity-review] Pass 2 cluster", {
        runId,
        index: i + 1,
        of: storedClusters.length,
        label: cluster.label,
        members: members.length,
        emails: emailPack.length,
        packMs,
        llmMs,
      });
      const decision = parseIdentityReviewPass2Decision(
        parseJsonObjectText(pass2.text),
        cluster.memberIds,
      );
      const snapshots = members.map((member) => ({
        id: member.id,
        name: member.name,
        displayName: member.displayName,
        yearHint: member.year_hint,
        sourceEmailCount: member.sourceEmailCount,
        aliases: member.aliases ?? [],
      }));
      const plan = planIdentityReviewDecision({
        clusterLabel: cluster.label,
        clusterMemberIds: cluster.memberIds,
        members: snapshots,
        decision,
      });

      const decisionId = await insertIdentityReviewDecision({
        runId,
        clusterId: cluster.id,
        decision,
        status: "proposed",
      });

      if (plan.apply) {
        const mergeResult = await applyIdentityReviewMerges(plan.merges);
        if (mergeResult.errors.length > 0 && mergeResult.applied === 0) {
          await markIdentityReviewDecisionStatus({
            decisionId,
            status: "failed",
            error: mergeResult.errors.join("; "),
          });
        } else {
          await upsertProjectIdentityPolicies({
            runId,
            drafts: plan.policies,
          });
          await markIdentityReviewDecisionStatus({
            decisionId,
            status: "applied",
          });
          highApplied += 1;
        }
      } else if (plan.proposedGroups.length > 0) {
        proposedCount += 1;
      } else {
        await markIdentityReviewDecisionStatus({
          decisionId,
          status: "skipped",
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Pass 2 failed for this cluster.";
      await insertIdentityReviewDecision({
        runId,
        clusterId: cluster.id,
        decision: {
          kind: "keep_separate",
          confidence: "low",
          rationale: message,
          workLabel: cluster.label,
          subgroups: [],
        },
        status: "failed",
        error: message,
      });
    }

    await updateIdentityReviewRun(runId, {
      clusterCompleted: i + 1,
      highApplied,
      proposedCount,
      totalCostUsd,
    });
  }

  if (await stopIfInactive(runId, highApplied > 0)) return;

  await refreshRegistryAfterIdentityReview(runId);
  await updateIdentityReviewRun(runId, {
    status: "completed",
    currentPass: 2,
    highApplied,
    proposedCount,
    totalCostUsd,
    lastError: null,
    finishedAt: new Date().toISOString(),
  });
}

export function kickIdentityReviewWorker(runId: string): void {
  void runIdentityReviewWorker(runId);
}

export function runIdentityReviewWorker(runId: string): Promise<void> {
  const existing = activeWorkers.get(runId);
  if (existing) return existing;

  console.info("[project-identity-review] Starting run", { runId });
  const promise = executeIdentityReviewRun(runId)
    .catch((error) => {
      console.error("[project-identity-review] Run failed:", { runId, error });
      void updateIdentityReviewRun(runId, {
        status: "failed",
        lastError:
          error instanceof Error
            ? error.message
            : "Identity review worker crashed.",
        finishedAt: new Date().toISOString(),
      });
      void refreshRegistryAfterIdentityReview(runId);
    })
    .finally(() => {
      activeWorkers.delete(runId);
    });
  activeWorkers.set(runId, promise);
  return promise;
}

export async function startIdentityReviewRun(params?: {
  modelId?: string | null;
}): Promise<{ runId: string }> {
  const { projects } = await loadProjectFingerprintSummaries();
  const modelId = resolveProjectHighlightModel(params?.modelId);
  const run = await createIdentityReviewRun({
    modelId,
    projectCount: projects.length,
  });
  kickIdentityReviewWorker(run.id);
  return { runId: run.id };
}

export async function resumeIdentityReviewWorkersOnStartup(): Promise<void> {
  const runs = await listRunningIdentityReviewRuns();
  if (runs.length === 0) return;
  console.info(
    `[project-identity-review] Resuming ${runs.length} running identity review run(s)`,
  );
  for (const run of runs) {
    kickIdentityReviewWorker(run.id);
  }
}
