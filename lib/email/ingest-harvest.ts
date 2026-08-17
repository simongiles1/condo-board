import { DEFAULT_CONTACT_HIGHLIGHT_MODEL } from "@/lib/email-analysis/contact-highlight-models";
import { DEFAULT_EVENT_HIGHLIGHT_MODEL } from "@/lib/email-analysis/event-highlight-models";
import { DEFAULT_ORG_HIGHLIGHT_MODEL } from "@/lib/email-analysis/org-highlight-models";
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
import { getEmailSyncSettings } from "@/lib/email/settings";
import {
  syncPersonalAccount,
  type SyncResult,
  type SyncTrigger,
} from "@/lib/gmail/sync";

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
};

let pipelineInProgress = false;

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
    case "events":
      return DEFAULT_EVENT_HIGHLIGHT_MODEL;
    case "todos":
      return DEFAULT_TODO_HIGHLIGHT_MODEL;
  }
}

export function formatHarvestAfterSyncMessage(
  harvest: HarvestAfterSyncResult,
): string | null {
  if (harvest.status === "disabled") return null;
  if (harvest.status === "skipped_busy") {
    return "Harvest skipped: a bulk extract is already running.";
  }

  const ran = harvest.kinds.filter(
    (row) => row.status === "completed" && row.totalEmails > 0,
  );
  const failed = harvest.kinds.filter((row) => row.status === "failed");
  const skippedBusy = harvest.kinds.filter(
    (row) => row.status === "skipped_busy",
  );

  if (failed.length > 0) {
    const names = failed.map((row) => row.kind).join(", ");
    return `Harvest finished with errors (${names}).`;
  }
  if (skippedBusy.length > 0 && ran.length === 0) {
    return "Harvest skipped: a bulk extract is already running.";
  }
  if (ran.length === 0) {
    return "No missing harvests.";
  }
  const parts = ran.map(
    (row) =>
      `${row.kind} ${row.completedEmails}/${row.totalEmails}`,
  );
  return `Harvested missing ${parts.join("; ")}.`;
}

export async function runIngestThenHarvest(
  trigger: SyncTrigger,
): Promise<IngestThenHarvestResult> {
  if (pipelineInProgress) {
    throw new Error(
      "A personal Gmail sync is already running. Wait for it to finish before starting another.",
    );
  }

  pipelineInProgress = true;
  try {
    const sync = await syncPersonalAccount(trigger);
    const startedAt = new Date().toISOString();
    const harvest = await runHarvestMissingAfterSync();
    if (harvest.status === "ran") {
      try {
        const { runTelegramHitlAfterHarvest } = await import(
          "@/lib/telegram/after-harvest"
        );
        const digest = await runTelegramHitlAfterHarvest({
          startedAt,
          harvest,
        });
        if (digest.sent > 0 || digest.error) {
          console.info("[telegram] Harvest digest", digest);
        }
      } catch (error) {
        console.error("[telegram] Harvest digest failed", error);
      }
    }
    return { ...sync, harvest };
  } finally {
    pipelineInProgress = false;
  }
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
