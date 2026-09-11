import { DEFAULT_CONTACT_HIGHLIGHT_MODEL } from "@/lib/email-analysis/contact-highlight-models";
import { DEFAULT_EVENT_HIGHLIGHT_MODEL } from "@/lib/email-analysis/event-highlight-models";
import { DEFAULT_ORG_HIGHLIGHT_MODEL } from "@/lib/email-analysis/org-highlight-models";
import { DEFAULT_PROJECT_HIGHLIGHT_MODEL } from "@/lib/email-analysis/project-highlight-models";
import { DEFAULT_TODO_HIGHLIGHT_MODEL } from "@/lib/email-analysis/todo-highlight-models";
import {
  createBulkExtractRun,
  getBulkExtractRun,
  getLatestCompletedModelId,
  listRunningBulkExtractRuns,
  type BulkExtractKind,
} from "@/lib/email-analysis/bulk-extract-runs";
import { listMissingExtractTargets } from "@/lib/email-analysis/bulk-extract-targets";
import { runBulkExtractWorker } from "@/lib/email-analysis/bulk-extract-worker";
import { startIngestPipeline } from "@/lib/email/ingest-pipeline";
import type { IngestRunRecord } from "@/lib/email/ingest-pipeline";
import { getEmailSyncSettings } from "@/lib/email/settings";
import { type SyncResult, type SyncTrigger } from "@/lib/gmail/sync";

export { formatHarvestAfterSyncMessage } from "@/lib/email/ingest-stages";

export const HARVEST_AFTER_SYNC_KINDS: BulkExtractKind[] = [
  "contacts",
  "organizations",
  "events",
  "todos",
];

export type HarvestAfterSyncKindResult = {
  kind: BulkExtractKind;
  status: "skipped_empty" | "skipped_busy" | "completed" | "failed";
  runId: string | null;
  totalEmails: number;
  completedEmails: number;
  failedThreads: number;
  error: string | null;
};

export type HarvestAfterSyncResult = {
  status: "disabled" | "skipped_busy" | "ran";
  kinds: HarvestAfterSyncKindResult[];
};

export type IngestThenHarvestResult = SyncResult & {
  harvest: HarvestAfterSyncResult;
  ingest: IngestRunRecord;
};

export function shouldSkipHarvestAfterSync(input: {
  enabled: boolean;
  runningBulkCount: number;
}): "disabled" | "skipped_busy" | "run" {
  if (!input.enabled) return "disabled";
  if (input.runningBulkCount > 0) return "skipped_busy";
  return "run";
}

export function defaultHarvestModelId(kind: BulkExtractKind): string {
  switch (kind) {
    case "contacts":
      return DEFAULT_CONTACT_HIGHLIGHT_MODEL;
    case "organizations":
      return DEFAULT_ORG_HIGHLIGHT_MODEL;
    case "projects":
      return DEFAULT_PROJECT_HIGHLIGHT_MODEL;
    case "events":
      return DEFAULT_EVENT_HIGHLIGHT_MODEL;
    case "todos":
      return DEFAULT_TODO_HIGHLIGHT_MODEL;
  }
}

export async function runIngestThenHarvest(
  trigger: SyncTrigger,
): Promise<IngestThenHarvestResult> {
  const run = await startIngestPipeline(trigger, { runInBackground: false });
  const sync: SyncResult = {
    syncRunId: run.id,
    messagesAdded:
      typeof run.counts.messagesAdded === "number" ? run.counts.messagesAdded : 0,
    messagesSkipped:
      typeof run.counts.messagesSkipped === "number"
        ? run.counts.messagesSkipped
        : 0,
    errors:
      typeof run.counts.ingestErrors === "string"
        ? [run.counts.ingestErrors]
        : Array.isArray(run.counts.ingestErrors)
          ? (run.counts.ingestErrors as string[])
          : run.lastError
            ? [run.lastError]
            : [],
  };
  return {
    ...sync,
    harvest: { status: "disabled", kinds: [] },
    ingest: run,
  };
}

export async function runHarvestMissingAfterSync(): Promise<HarvestAfterSyncResult> {
  const settings = await getEmailSyncSettings();
  const running = await listRunningBulkExtractRuns();
  const gate = shouldSkipHarvestAfterSync({
    enabled: settings.harvestAfterSyncEnabled,
    runningBulkCount: running.length,
  });

  if (gate === "disabled") {
    return { status: "disabled", kinds: [] };
  }
  if (gate === "skipped_busy") {
    console.info(
      "[harvest-after-sync] Skipped: a bulk extract run is already running",
    );
    return { status: "skipped_busy", kinds: [] };
  }

  const kinds: HarvestAfterSyncKindResult[] = [];

  for (const kind of HARVEST_AFTER_SYNC_KINDS) {
    const stillRunning = await listRunningBulkExtractRuns();
    if (stillRunning.length > 0) {
      kinds.push({
        kind,
        status: "skipped_busy",
        runId: null,
        totalEmails: 0,
        completedEmails: 0,
        failedThreads: 0,
        error: null,
      });
      continue;
    }

    const listed = await listMissingExtractTargets(kind);
    if (listed.totalEmails === 0) {
      kinds.push({
        kind,
        status: "skipped_empty",
        runId: null,
        totalEmails: 0,
        completedEmails: 0,
        failedThreads: 0,
        error: null,
      });
      continue;
    }

    const modelId =
      (await getLatestCompletedModelId(kind)) ?? defaultHarvestModelId(kind);
    const run = await createBulkExtractRun({
      kind,
      modelId,
      totalThreads: listed.totalThreads,
      totalEmails: listed.totalEmails,
      targetScope: "missing",
      cancelOthers: false,
    });

    console.info("[harvest-after-sync] Starting missing harvest", {
      kind,
      runId: run.id,
      totalEmails: listed.totalEmails,
      totalThreads: listed.totalThreads,
      modelId,
    });

    await runBulkExtractWorker(run.id);
    const finished = await getBulkExtractRun(run.id);
    const ok = finished?.status === "completed";

    kinds.push({
      kind,
      status: ok ? "completed" : "failed",
      runId: run.id,
      totalEmails: finished?.totalEmails ?? listed.totalEmails,
      completedEmails: finished?.completedEmails ?? 0,
      failedThreads: finished?.failedThreads ?? 0,
      error: ok ? null : finished?.lastError ?? "Harvest run did not finish.",
    });
  }

  return { status: "ran", kinds };
}
