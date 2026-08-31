/**
 * Scan monthly management reports (and board-package management-report
 * sections) and tag registry projects the PM briefed the Board on.
 */

import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { resolveProjectScope } from "@/lib/email-analysis/project-highlight-shared";
import {
  getProjectHighlightModelMeta,
  getProjectHighlightPassConfig,
  resolveProjectHighlightModel,
  type ProjectHighlightModelId,
} from "@/lib/email-analysis/project-highlight-models";
import { readAttachmentMarkdown } from "@/lib/email/attachment-markdown";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { estimateCostUsd } from "@/lib/gemini/usage";
import {
  BOARD_REPORT_MATCHING_STATUS,
  BOARD_REPORT_AI_HIGH_SCORE,
  BOARD_REPORT_AI_MEDIUM_SCORE,
  BOARD_REPORT_MATCH_MAX_OUTPUT_TOKENS,
  BOARD_REPORT_MATCH_TOPICS_PER_CALL,
  BOARD_REPORT_SCAN_MAX_CHARS,
  BOARD_REPORT_SCAN_MAX_OUTPUT_TOKENS,
  boardReportTopicMatchKey,
  buildBoardReportMatchSystemPrompt,
  buildBoardReportMatchUserPrompt,
  buildBoardReportScanSystemPrompt,
  buildBoardReportScanUserPrompt,
  isWaitingOnMarkdownDocument,
  matchBoardReportTopic,
  parseBoardReportAiMatchesFromModelText,
  parseBoardReportTopicsFromModelText,
  parseStoredBoardReportTopics,
  sliceManagementReportMarkdown,
  toBoardReportCatalogRow,
  type BoardReportMatchableProject,
  type BoardReportStoredTopic,
  type BoardReportTopic,
  type BoardReportTopicMatch,
} from "@/lib/projects/board-report-shared";
import {
  createBoardReportRun,
  getBoardReportRun,
  getLatestBoardReportRun,
  listBoardReportCandidates,
  listBoardReportDocuments,
  listRunningBoardReportRuns,
  replaceBoardReportMentions,
  updateBoardReportDocumentTopics,
  updateBoardReportRun,
  upsertBoardReportDocument,
} from "@/lib/projects/board-reports";
import {
  loadProjectFingerprintSummaries,
  markProjectFingerprintSummariesStale,
  type ProjectFingerprintSummary,
} from "@/lib/projects/fingerprint-list";

const activeWorkers = new Map<string, Promise<void>>();
const activeRematch = new Map<string, Promise<void>>();

function scanMaxChars(): number {
  const raw = process.env.BOARD_REPORT_SCAN_MAX_CHARS?.trim();
  if (!raw) return BOARD_REPORT_SCAN_MAX_CHARS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 8_000) return BOARD_REPORT_SCAN_MAX_CHARS;
  return Math.min(120_000, Math.floor(n));
}

function toMatchable(
  project: ProjectFingerprintSummary,
): BoardReportMatchableProject {
  return {
    id: project.id,
    name: project.name,
    aliases: project.aliases ?? [],
    yearHint: project.year_hint,
    phase: project.phase,
    contractor: project.contractor,
    location: project.location,
    equipmentMentions: project.equipment_mentions,
    scope: resolveProjectScope(project),
  };
}

async function runBoardReportLlm(params: {
  modelId: ProjectHighlightModelId;
  systemInstruction: string;
  userText: string;
  maxOutputTokens: number;
  step: string;
}): Promise<{ text: string; modelName: string; costUsd: number }> {
  const meta = getProjectHighlightModelMeta(params.modelId);
  const passConfig = getProjectHighlightPassConfig(params.modelId, 2);
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

async function isRunStillActive(runId: string): Promise<boolean> {
  const run = await getBoardReportRun(runId);
  return run?.status === "running";
}

function aiScore(confidence: "high" | "medium"): number {
  return confidence === "high"
    ? BOARD_REPORT_AI_HIGH_SCORE
    : BOARD_REPORT_AI_MEDIUM_SCORE;
}

async function loadMatchableProjects(): Promise<BoardReportMatchableProject[]> {
  const { projects } = await loadProjectFingerprintSummaries({
    sort: "mentions-desc",
  });
  return projects.map(toMatchable);
}

/**
 * Exact-match every extracted topic, then AI-match leftovers against
 * name + aliases + year + contractor + location + equipment.
 */
export async function matchAndPersistBoardReportTopics(runId: string): Promise<{
  matchedProjectCount: number;
  unmatchedTopicCount: number;
  costUsd: number;
}> {
  const run = await getBoardReportRun(runId);
  if (!run) {
    return { matchedProjectCount: 0, unmatchedTopicCount: 0, costUsd: 0 };
  }
  const modelId = resolveProjectHighlightModel(run.modelId);
  const documents = await listBoardReportDocuments(runId);
  const matchable = await loadMatchableProjects();
  const knownIds = new Set(matchable.map((project) => project.id));
  const catalog = matchable.map(toBoardReportCatalogRow);

  type UniqueTopic = {
    id: string;
    name: string;
    section: BoardReportTopic["section"];
    contractor: string | null;
    location: string | null;
    yearHint: string | null;
  };
  const uniqueByKey = new Map<string, UniqueTopic>();
  const parsedByReport = new Map<
    string,
    { waiting: boolean; topics: BoardReportTopic[] }
  >();

  for (const doc of documents) {
    const waiting = isWaitingOnMarkdownDocument(doc);
    let topics: BoardReportTopic[] = [];
    if (!waiting) {
      try {
        topics = parseStoredBoardReportTopics(
          JSON.parse(doc.topicsJson) as unknown,
        );
      } catch {
        topics = [];
      }
    }
    parsedByReport.set(doc.id, { waiting, topics });
    if (waiting) continue;
    for (const topic of topics) {
      const key = boardReportTopicMatchKey(topic.name, topic.yearHint);
      if (uniqueByKey.has(key)) continue;
      uniqueByKey.set(key, {
        id: `t${uniqueByKey.size}`,
        name: topic.name,
        section: topic.section,
        contractor: topic.contractor,
        location: topic.location,
        yearHint: topic.yearHint,
      });
    }
  }

  const exactByKey = new Map<string, BoardReportTopicMatch[]>();
  const unmatchedUnique: UniqueTopic[] = [];
  for (const [key, topic] of uniqueByKey) {
    const hits = matchBoardReportTopic(topic, matchable);
    if (hits.length > 0) {
      exactByKey.set(key, hits);
    } else {
      unmatchedUnique.push(topic);
    }
  }

  const aiByKey = new Map<
    string,
    { projectIds: string[]; confidence: "high" | "medium" }
  >();
  let costUsd = 0;
  const keyByTopicId = new Map(
    [...uniqueByKey.entries()].map(([key, topic]) => [topic.id, key]),
  );

  for (let i = 0; i < unmatchedUnique.length; i += BOARD_REPORT_MATCH_TOPICS_PER_CALL) {
    if (!(await isRunStillActive(runId))) {
      return {
        matchedProjectCount: 0,
        unmatchedTopicCount: unmatchedUnique.length,
        costUsd,
      };
    }
    const batch = unmatchedUnique.slice(i, i + BOARD_REPORT_MATCH_TOPICS_PER_CALL);
    try {
      const llm = await runBoardReportLlm({
        modelId,
        systemInstruction: buildBoardReportMatchSystemPrompt(),
        userText: buildBoardReportMatchUserPrompt({
          topics: batch,
          projects: catalog,
        }),
        maxOutputTokens: BOARD_REPORT_MATCH_MAX_OUTPUT_TOKENS,
        step: "project_board_report_match",
      });
      costUsd += llm.costUsd;
      const parsed = parseBoardReportAiMatchesFromModelText(
        llm.text,
        knownIds,
        batch,
      );
      for (const row of parsed) {
        const key = keyByTopicId.get(row.topicId);
        if (!key) continue;
        aiByKey.set(key, {
          projectIds: row.projectIds,
          confidence: row.confidence,
        });
      }
    } catch (caught) {
      console.error("[project-board-reports] Topic match batch failed:", caught);
    }
  }

  const matchedKeys = new Set<string>();
  let unmatchedTopicCount = 0;

  for (const doc of documents) {
    const parsed = parsedByReport.get(doc.id);
    if (!parsed || parsed.waiting) {
      await replaceBoardReportMentions({ reportId: doc.id, mentions: [] });
      continue;
    }
    const stored: BoardReportStoredTopic[] = [];
    const mentions: Array<{
      projectKey: string;
      topicName: string;
      confidence: "high" | "medium";
      score: number;
    }> = [];
    for (const topic of parsed.topics) {
      const key = boardReportTopicMatchKey(topic.name, topic.yearHint);
      const exact = exactByKey.get(key) ?? [];
      const ai = aiByKey.get(key);
      const hits: BoardReportTopicMatch[] =
        exact.length > 0
          ? exact
          : (ai?.projectIds ?? []).map((projectId) => ({
              projectId,
              score: aiScore(ai!.confidence),
              confidence: ai!.confidence,
            }));
      stored.push({
        ...topic,
        matchedProjectIds: hits.map((hit) => hit.projectId),
      });
      if (hits.length === 0) {
        unmatchedTopicCount += 1;
        continue;
      }
      for (const hit of hits) {
        matchedKeys.add(hit.projectId);
        mentions.push({
          projectKey: hit.projectId,
          topicName: topic.name,
          confidence: hit.confidence,
          score: hit.score,
        });
      }
    }
    await updateBoardReportDocumentTopics({ reportId: doc.id, topics: stored });
    await replaceBoardReportMentions({ reportId: doc.id, mentions });
  }

  return {
    matchedProjectCount: matchedKeys.size,
    unmatchedTopicCount,
    costUsd,
  };
}

async function executeBoardReportScan(runId: string): Promise<void> {
  const run = await getBoardReportRun(runId);
  if (!run || run.status !== "running") return;

  const modelId = resolveProjectHighlightModel(run.modelId);
  const maxChars = scanMaxChars();
  const candidates = await listBoardReportCandidates();
  await updateBoardReportRun(runId, { reportTotal: candidates.length });

  let totalCostUsd = 0;
  let skippedUnparsed = 0;

  for (let i = 0; i < candidates.length; i++) {
    if (!(await isRunStillActive(runId))) return;
    const candidate = candidates[i]!;

    if (candidate.parseStatus !== "parsed") {
      skippedUnparsed += 1;
      await upsertBoardReportDocument({
        candidate,
        runId,
        topics: [],
        extractionJson: null,
        error:
          candidate.parseStatus == null
            ? "Attachment markdown has not been converted yet."
            : `Attachment markdown is ${candidate.parseStatus}; skipped.`,
      });
      await updateBoardReportRun(runId, {
        reportCompleted: i + 1,
        skippedUnparsed,
        totalCostUsd,
      });
      continue;
    }

    const markdown = await readAttachmentMarkdown(candidate.contentHash);
    if (!markdown?.trim()) {
      skippedUnparsed += 1;
      await upsertBoardReportDocument({
        candidate,
        runId,
        topics: [],
        extractionJson: null,
        error: "Parsed markdown was empty or missing from storage.",
      });
      await updateBoardReportRun(runId, {
        reportCompleted: i + 1,
        skippedUnparsed,
        totalCostUsd,
      });
      continue;
    }

    const sliced = sliceManagementReportMarkdown(markdown, {
      kind: candidate.kind,
      pageCount: candidate.pageCount,
      maxChars,
    });

    let topics: ReturnType<typeof parseBoardReportTopicsFromModelText> = [];
    let extractionJson: string | null = null;
    let error: string | null = null;
    try {
      const llm = await runBoardReportLlm({
        modelId,
        systemInstruction: buildBoardReportScanSystemPrompt(),
        userText: buildBoardReportScanUserPrompt({
          filename: candidate.filename,
          reportDate: candidate.reportDate,
          kind: candidate.kind,
          markdown: sliced,
        }),
        maxOutputTokens: BOARD_REPORT_SCAN_MAX_OUTPUT_TOKENS,
        step: "project_board_report_scan",
      });
      totalCostUsd += llm.costUsd;
      extractionJson = llm.text;
      topics = parseBoardReportTopicsFromModelText(llm.text);
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message
          : "Management-report extraction failed.";
      topics = [];
    }

    await upsertBoardReportDocument({
      candidate,
      runId,
      topics,
      extractionJson,
      error,
    });

    await updateBoardReportRun(runId, {
      reportCompleted: i + 1,
      skippedUnparsed,
      totalCostUsd,
    });
  }

  if (!(await isRunStillActive(runId))) return;

  await updateBoardReportRun(runId, {
    lastError: BOARD_REPORT_MATCHING_STATUS,
    skippedUnparsed,
    totalCostUsd,
  });
  const matched = await matchAndPersistBoardReportTopics(runId);
  totalCostUsd += matched.costUsd;

  if (!(await isRunStillActive(runId))) return;

  await updateBoardReportRun(runId, {
    status: "completed",
    skippedUnparsed,
    unmatchedTopicCount: matched.unmatchedTopicCount,
    matchedProjectCount: matched.matchedProjectCount,
    totalCostUsd,
    finishedAt: new Date().toISOString(),
  });
  markProjectFingerprintSummariesStale();
}

export function kickBoardReportScanWorker(runId: string): void {
  void runBoardReportScanWorker(runId);
}

export function runBoardReportScanWorker(runId: string): Promise<void> {
  const existing = activeWorkers.get(runId);
  if (existing) return existing;

  console.info("[project-board-reports] Starting scan", { runId });
  const promise = executeBoardReportScan(runId)
    .catch((error) => {
      console.error("[project-board-reports] Scan failed:", { runId, error });
      void updateBoardReportRun(runId, {
        status: "failed",
        lastError:
          error instanceof Error
            ? error.message
            : "Management-report scan worker crashed.",
        finishedAt: new Date().toISOString(),
      });
    })
    .finally(() => {
      activeWorkers.delete(runId);
    });
  activeWorkers.set(runId, promise);
  return promise;
}

export async function startBoardReportScan(params?: {
  modelId?: string | null;
}): Promise<{ runId: string }> {
  const modelId = resolveProjectHighlightModel(params?.modelId);
  const run = await createBoardReportRun({ modelId });
  kickBoardReportScanWorker(run.id);
  return { runId: run.id };
}

/**
 * Re-run exact + AI matching on already-extracted topics (no PDF re-scan).
 * Sets the latest completed run back to running so the UI can poll.
 */
export async function startBoardReportRematch(): Promise<{ runId: string }> {
  const run = await getLatestBoardReportRun();
  if (!run) {
    throw new Error("No management-report scan to re-match.");
  }
  if (run.status === "running") {
    if (run.lastError !== BOARD_REPORT_MATCHING_STATUS) {
      throw new Error("A management-report scan is already running.");
    }
  } else {
    await updateBoardReportRun(run.id, {
      status: "running",
      lastError: BOARD_REPORT_MATCHING_STATUS,
      finishedAt: null,
    });
  }

  const existing = activeRematch.get(run.id);
  if (existing) return { runId: run.id };

  const promise = (async () => {
    try {
      const matched = await matchAndPersistBoardReportTopics(run.id);
      const latest = await getBoardReportRun(run.id);
      if (!latest || latest.status !== "running") return;
      await updateBoardReportRun(run.id, {
        status: "completed",
        unmatchedTopicCount: matched.unmatchedTopicCount,
        matchedProjectCount: matched.matchedProjectCount,
        totalCostUsd: (latest.totalCostUsd ?? 0) + matched.costUsd,
        lastError: null,
        finishedAt: new Date().toISOString(),
      });
      markProjectFingerprintSummariesStale();
    } catch (error) {
      console.error("[project-board-reports] Rematch failed:", {
        runId: run.id,
        error,
      });
      await updateBoardReportRun(run.id, {
        status: "failed",
        lastError:
          error instanceof Error
            ? error.message
            : "Topic matching failed.",
        finishedAt: new Date().toISOString(),
      });
    } finally {
      activeRematch.delete(run.id);
    }
  })();
  activeRematch.set(run.id, promise);
  return { runId: run.id };
}

export async function resumeBoardReportScanWorkersOnStartup(): Promise<void> {
  const runs = await listRunningBoardReportRuns();
  if (runs.length === 0) return;
  console.info(
    `[project-board-reports] Resuming ${runs.length} running management-report scan(s)`,
  );
  for (const run of runs) {
    if (run.lastError === BOARD_REPORT_MATCHING_STATUS) {
      void startBoardReportRematch();
      continue;
    }
    kickBoardReportScanWorker(run.id);
  }
}
