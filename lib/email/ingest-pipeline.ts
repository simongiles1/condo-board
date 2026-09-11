/**
 * Gated ingest orchestrator: A catch-up → B/C allowlist HITL → D full history → E stages.
 */

import { randomUUID } from "crypto";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  emailAttachments,
  emailIngestRuns,
  emailIngestSenderReviews,
  emails,
  gmailConnections,
  senderAllowlist,
  senderBlocklist,
} from "@/lib/db/schema";
import {
  collectParticipantEmails,
  filterAllowlistCandidates,
  shouldRemindAllowlistTimeout,
} from "@/lib/email/ingest-candidates";
import { shouldSendOauthRelinkRemind } from "@/lib/email/ingest-oauth-remind";
import {
  ingestStageLabel,
  nextIngestStage,
  shouldResumeIdleIngestRun,
  type IngestStage,
  type IngestWaitKind,
} from "@/lib/email/ingest-stages";
import { getEmailSyncSettings, updateEmailSyncSettings } from "@/lib/email/settings";
import { backfillPersonalAccount } from "@/lib/gmail/backfill";
import { getGmailClient } from "@/lib/gmail/client";
import { buildSenderBackfillQuery, getAllowlistEmails } from "@/lib/gmail/queries";
import { syncPersonalAccount, type SyncTrigger } from "@/lib/gmail/sync";
import { getQueryMatchCounts } from "@/lib/gmail/thread-search";
import {
  allowlistReviewKeyboard,
  ingestContinueKeyboard,
  type TelegramCallbackAction,
} from "@/lib/telegram/format";
import {
  editTelegramMessage,
  sendTelegramMessage,
  type TelegramInlineKeyboard,
} from "@/lib/telegram/api";
import {
  insertIngestReviewItem,
  markTelegramReviewResolved,
  markTelegramReviewSent,
  updateTelegramReviewPayload,
} from "@/lib/telegram/store";
import { isTelegramHitlReady, listTelegramChatIds } from "@/lib/telegram/recipients";

export type IngestSenderReview = {
  id: string;
  email: string;
  status: "pending" | "approved" | "denied";
  sortIndex: number;
  estimatedThreadCount: number | null;
  estimatedEmailCount: number | null;
};

export type IngestRunRecord = {
  id: string;
  trigger: "cron" | "manual";
  status: "running" | "waiting_allowlist" | "waiting_continue" | "completed" | "failed";
  stage: IngestStage;
  waitKind: IngestWaitKind | null;
  lastSuccessfulSyncAt: string | null;
  newEmailIds: string[];
  counts: Record<string, unknown>;
  cursorIndex: number;
  reminderSentAt: string | null;
  lastError: string | null;
  telegramReviewItemId: string | null;
  telegramChatId: string | null;
  telegramMessageId: number | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  senders: IngestSenderReview[];
};

type RunRow = typeof emailIngestRuns.$inferSelect;

let pipelineBusy = false;

function resumeIdleIngestRun(run: IngestRunRecord): void {
  if (!shouldResumeIdleIngestRun({ status: run.status, pipelineBusy })) {
    return;
  }
  console.info("[ingest] resuming idle running pipeline", run.id);
  scheduleIngestPipelineWork(run.id);
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function parseCounts(raw: string | null | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mapRun(row: RunRow, senders: IngestSenderReview[]): IngestRunRecord {
  return {
    id: row.id,
    trigger: row.trigger === "cron" ? "cron" : "manual",
    status: row.status as IngestRunRecord["status"],
    stage: row.stage as IngestStage,
    waitKind:
      row.waitKind === "allowlist" || row.waitKind === "continue"
        ? row.waitKind
        : null,
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
    newEmailIds: parseJsonArray(row.newEmailIdsJson),
    counts: parseCounts(row.countsJson),
    cursorIndex: row.cursorIndex,
    reminderSentAt: row.reminderSentAt,
    lastError: row.lastError,
    telegramReviewItemId: row.telegramReviewItemId,
    telegramChatId: row.telegramChatId,
    telegramMessageId: row.telegramMessageId,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
    senders,
  };
}

async function loadSenders(runId: string): Promise<IngestSenderReview[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(emailIngestSenderReviews)
    .where(eq(emailIngestSenderReviews.runId, runId))
    .orderBy(asc(emailIngestSenderReviews.sortIndex));
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    status: row.status as IngestSenderReview["status"],
    sortIndex: row.sortIndex,
    estimatedThreadCount: row.estimatedThreadCount,
    estimatedEmailCount: row.estimatedEmailCount,
  }));
}

export async function getIngestRun(
  id: string,
  options?: { resumeIfIdle?: boolean },
): Promise<IngestRunRecord | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(emailIngestRuns)
    .where(eq(emailIngestRuns.id, id))
    .limit(1);
  if (!row) return null;
  const run = mapRun(row, await loadSenders(id));
  if (options?.resumeIfIdle) resumeIdleIngestRun(run);
  return run;
}

export async function getActiveIngestRun(
  options?: { resumeIfIdle?: boolean },
): Promise<IngestRunRecord | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(emailIngestRuns)
    .where(
      inArray(emailIngestRuns.status, [
        "running",
        "waiting_allowlist",
        "waiting_continue",
      ]),
    )
    .orderBy(desc(emailIngestRuns.startedAt))
    .limit(1);
  if (!row) return null;
  const run = mapRun(row, await loadSenders(row.id));
  if (options?.resumeIfIdle) resumeIdleIngestRun(run);
  return run;
}

async function patchRun(
  id: string,
  patch: Partial<typeof emailIngestRuns.$inferInsert>,
): Promise<void> {
  const db = getDb();
  await db
    .update(emailIngestRuns)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(emailIngestRuns.id, id));
}

async function emailIdsForSyncRun(syncRunId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ id: emails.id })
    .from(emails)
    .where(eq(emails.syncRunId, syncRunId));
  return rows.map((row) => row.id);
}

function mergeIds(current: string[], extra: string[]): string[] {
  return [...new Set([...current, ...extra])];
}

function formatAllowlistMessage(run: IngestRunRecord): {
  text: string;
  showBack: boolean;
} | null {
  const pending = run.senders.filter((row) => row.status === "pending");
  const decided = run.senders.filter((row) => row.status !== "pending");
  const sender =
    pending.find((row) => row.sortIndex >= run.cursorIndex) ?? pending[0];
  if (!sender) return null;
  const page = decided.length + 1;
  const total = run.senders.length;
  const threads = sender.estimatedThreadCount ?? 0;
  const msgs = sender.estimatedEmailCount ?? 0;
  const text = [
    "New allowlist sender",
    `${page} of ${total}`,
    "",
    sender.email,
    `Gmail estimate: ${msgs.toLocaleString()} messages / ${threads.toLocaleString()} threads (full history if approved).`,
    "",
    "Approve adds them to the allowlist and later imports their full history.",
    "Deny blocks them from being asked again.",
  ].join("\n");
  return { text, showBack: decided.length > 0 };
}

function formatContinueMessage(run: IngestRunRecord): string {
  const counts = run.counts;
  const lines = [
    "Email ingest pipeline",
    ingestStageLabel(run.stage),
    "",
    `New emails so far: ${run.newEmailIds.length.toLocaleString()}`,
  ];
  if (typeof counts.messagesAdded === "number") {
    lines.push(`Last ingest added: ${counts.messagesAdded}`);
  }
  if (typeof counts.stageNote === "string" && counts.stageNote) {
    lines.push("", counts.stageNote);
  }
  lines.push("", "Tap Continue to run the next stage.");
  return lines.join("\n");
}

async function upsertTelegramMessage(runId: string): Promise<void> {
  const run = await getIngestRun(runId);
  if (!run) return;
  if (!(await isTelegramHitlReady())) return;

  const chatIds = await listTelegramChatIds();
  if (chatIds.length === 0) return;

  let text: string;
  let replyMarkup: TelegramInlineKeyboard;
  const reviewId = run.telegramReviewItemId;

  if (run.status === "waiting_allowlist") {
    const formatted = formatAllowlistMessage(run);
    if (!formatted) return;
    text = formatted.text;
    const itemId = reviewId ?? randomUUID();
    replyMarkup = allowlistReviewKeyboard(itemId, {
      showBack: formatted.showBack,
    });
  } else if (run.status === "waiting_continue") {
    text = formatContinueMessage(run);
    const itemId = reviewId ?? randomUUID();
    replyMarkup = ingestContinueKeyboard(itemId);
  } else if (run.status === "completed" || run.status === "failed") {
    text =
      run.status === "completed"
        ? `Email ingest pipeline complete.\n${run.newEmailIds.length.toLocaleString()} new emails processed.`
        : `Email ingest pipeline failed.\n${run.lastError ?? "Unknown error."}`;
    replyMarkup = { inline_keyboard: [] };
  } else {
    return;
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(emailIngestRuns)
    .where(eq(emailIngestRuns.id, runId))
    .limit(1);
  if (!row) return;

  let itemId = row.telegramReviewItemId;
  const kind =
    run.status === "waiting_allowlist" ? "allowlist_sender" : "ingest_stage";
  if (!itemId) {
    const item = await insertIngestReviewItem({
      kind,
      holdReason: run.status,
      payload: { runId, text },
    });
    itemId = item.id;
    await patchRun(runId, { telegramReviewItemId: itemId });
  } else {
    await updateTelegramReviewPayload({
      id: itemId,
      kind,
      holdReason: run.status,
      payload: { runId, text },
      status: run.status === "completed" || run.status === "failed" ? "approved" : "pending",
    });
  }

  if (run.status === "waiting_allowlist") {
    replyMarkup = allowlistReviewKeyboard(itemId, {
      showBack: Boolean(formatAllowlistMessage(run)?.showBack),
    });
  } else if (run.status === "waiting_continue") {
    replyMarkup = ingestContinueKeyboard(itemId);
  }

  const chatId = row.telegramChatId ?? chatIds[0]!;
  if (row.telegramMessageId) {
    await editTelegramMessage({
      chatId,
      messageId: row.telegramMessageId,
      text,
      replyMarkup,
    });
    return;
  }

  let last: { chatId: string; messageId: number } | null = null;
  for (const id of chatIds) {
    last = await sendTelegramMessage({ chatId: id, text, replyMarkup });
  }
  if (last) {
    await patchRun(runId, {
      telegramChatId: last.chatId,
      telegramMessageId: last.messageId,
    });
    await markTelegramReviewSent({
      id: itemId,
      chatId: last.chatId,
      messageId: last.messageId,
    });
  }
}

async function waitOrAdvance(runId: string, nextStage: IngestStage): Promise<void> {
  const settings = await getEmailSyncSettings();
  const run = await getIngestRun(runId);
  const sameStage = run?.stage === nextStage;
  if ((settings.pauseBetweenPipelineStages || sameStage) && nextStage !== "done") {
    await patchRun(runId, {
      status: "waiting_continue",
      stage: nextStage,
      waitKind: "continue",
    });
    await upsertTelegramMessage(runId);
    return;
  }
  await patchRun(runId, {
    status: "running",
    stage: nextStage,
    waitKind: null,
  });
  await runCurrentStage(runId);
}

async function completeRun(runId: string, error?: string): Promise<void> {
  await patchRun(runId, {
    status: error ? "failed" : "completed",
    stage: "done",
    waitKind: null,
    lastError: error ?? null,
    finishedAt: new Date().toISOString(),
  });
  if (error) {
    const item = (await getIngestRun(runId))?.telegramReviewItemId;
    if (item) {
      await markTelegramReviewResolved({
        id: item,
        status: "denied",
        via: "ui",
      }).catch(() => undefined);
    }
  }
  await upsertTelegramMessage(runId);
}

async function runStageA(runId: string): Promise<void> {
  const run = await getIngestRun(runId);
  if (!run) return;
  const sync = await syncPersonalAccount(run.trigger);
  const addedIds = await emailIdsForSyncRun(sync.syncRunId);
  await patchRun(runId, {
    newEmailIdsJson: JSON.stringify(mergeIds(run.newEmailIds, addedIds)),
    countsJson: JSON.stringify({
      ...run.counts,
      messagesAdded: sync.messagesAdded,
      messagesSkipped: sync.messagesSkipped,
      ingestErrors: sync.errors,
    }),
  });
  if (sync.errors.length > 0 && sync.messagesAdded === 0) {
    await completeRun(runId, sync.errors.join("\n"));
    return;
  }
  await patchRun(runId, { stage: "b_discover", status: "running" });
  await runStageB(runId);
}

async function runStageB(runId: string): Promise<void> {
  const run = await getIngestRun(runId);
  if (!run) return;
  const db = getDb();
  const emailRows =
    run.newEmailIds.length === 0
      ? []
      : await db
          .select({
            fromAddress: emails.fromAddress,
            toAddresses: emails.toAddresses,
            ccAddresses: emails.ccAddresses,
          })
          .from(emails)
          .where(inArray(emails.id, run.newEmailIds));

  const [allowRows, blockRows] = await Promise.all([
    db.select({ email: senderAllowlist.email }).from(senderAllowlist),
    db.select({ email: senderBlocklist.email }).from(senderBlocklist),
  ]);

  const candidates = filterAllowlistCandidates({
    participants: collectParticipantEmails(emailRows),
    allowlist: allowRows.map((row) => row.email),
    blocklist: blockRows.map((row) => row.email),
  });

  let estimates = new Map<string, { emailCount: number; threadCount: number }>();
  if (candidates.length > 0) {
    try {
      const { gmail } = await getGmailClient("personal_backfill");
      for (const address of candidates) {
        try {
          estimates.set(
            address,
            await getQueryMatchCounts(gmail, buildSenderBackfillQuery(address)),
          );
        } catch (error) {
          console.warn("[ingest] estimate failed", address, error);
        }
      }
    } catch (error) {
      console.warn("[ingest] Gmail estimates unavailable", error);
    }
  }

  if (candidates.length > 0) {
    await db.insert(emailIngestSenderReviews).values(
      candidates.map((email, index) => ({
        id: randomUUID(),
        runId,
        email,
        status: "pending" as const,
        sortIndex: index,
        estimatedThreadCount: estimates.get(email)?.threadCount ?? null,
        estimatedEmailCount: estimates.get(email)?.emailCount ?? null,
        decidedAt: null,
      })),
    );
    await patchRun(runId, {
      status: "waiting_allowlist",
      stage: "c_allowlist",
      waitKind: "allowlist",
      cursorIndex: 0,
      countsJson: JSON.stringify({
        ...run.counts,
        allowlistWaitStartedAt: new Date().toISOString(),
      }),
    });
    await upsertTelegramMessage(runId);
    return;
  }

  await waitOrAdvance(runId, "d_expand");
}

async function runStageD(runId: string): Promise<void> {
  const run = await getIngestRun(runId);
  if (!run) return;
  const approved = run.senders.filter((row) => row.status === "approved");
  let added = 0;
  const extraIds: string[] = [];
  for (const sender of approved) {
    const result = await backfillPersonalAccount({ senderEmail: sender.email });
    added += result.messagesAdded;
    extraIds.push(...(await emailIdsForSyncRun(result.syncRunId)));
  }
  await patchRun(runId, {
    newEmailIdsJson: JSON.stringify(mergeIds(run.newEmailIds, extraIds)),
    countsJson: JSON.stringify({
      ...run.counts,
      expandAdded: added,
      approvedSenders: approved.length,
      stageNote:
        approved.length === 0
          ? "No new senders approved; skipping full-history pull."
          : `Imported ${added} messages from ${approved.length} approved sender(s).`,
    }),
  });
  await waitOrAdvance(runId, "e1_docling");
}

async function downloadAttachmentsForEmails(emailIds: string[]): Promise<number> {
  if (emailIds.length === 0) return 0;
  const db = getDb();
  const pending = await db
    .select({
      id: emailAttachments.id,
      emailId: emailAttachments.emailId,
    })
    .from(emailAttachments)
    .where(inArray(emailAttachments.emailId, emailIds));

  const { downloadEmailAttachment } = await import("@/lib/gmail/attachments");
  let downloaded = 0;
  for (const row of pending) {
    try {
      await downloadEmailAttachment({
        attachmentId: row.id,
        emailId: row.emailId,
      });
      downloaded += 1;
    } catch (error) {
      console.warn(
        "[ingest] attachment download",
        row.id,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return downloaded;
}

async function runStageE1(runId: string): Promise<void> {
  const run = await getIngestRun(runId);
  if (!run) return;
  const { listRunningDoclingBackfillRuns, createDoclingBackfillRun } =
    await import("@/lib/email/docling-backfill-runs");
  const running = await listRunningDoclingBackfillRuns();
  if (running.length > 0) {
    await patchRun(runId, {
      countsJson: JSON.stringify({
        ...run.counts,
        stageNote:
          "Docling lab already has a running extraction. Finish or cancel it, then Continue.",
      }),
    });
    await waitOrAdvance(runId, "e1_docling");
    return;
  }

  const downloaded = await downloadAttachmentsForEmails(run.newEmailIds);
  const db = getDb();
  const hashRows =
    run.newEmailIds.length === 0
      ? []
      : await db
          .select({ contentHash: emailAttachments.contentHash })
          .from(emailAttachments)
          .where(inArray(emailAttachments.emailId, run.newEmailIds));
  const hashes = [
    ...new Set(
      hashRows
        .map((row) => row.contentHash)
        .filter((hash): hash is string => Boolean(hash)),
    ),
  ];

  if (hashes.length > 0) {
    const { DEFAULT_DOCLING_PROVIDER } = await import(
      "@/lib/email/docling-provider"
    );
    const extraction = await createDoclingBackfillRun({
      mode: "full",
      doclingProvider: DEFAULT_DOCLING_PROVIDER,
      docLimit: null,
      plannedHashes: hashes,
      totalDoclingPages: 0,
      totalVisionPages: 0,
      corpusUncachedPages: 0,
      corpusPendingDocs: hashes.length,
      corpusPendingVisionPages: 0,
      corpusPendingVisionDocs: 0,
    });
    const { waitForDoclingBackfillWorker } = await import(
      "@/lib/email/docling-backfill-worker"
    );
    await waitForDoclingBackfillWorker(extraction.id);
  }

  await patchRun(runId, {
    countsJson: JSON.stringify({
      ...run.counts,
      attachmentsDownloaded: downloaded,
      extractionHashes: hashes.length,
      stageNote: `Downloaded ${downloaded} attachments; queued ${hashes.length} documents for Docling/vision.`,
    }),
  });
  await waitOrAdvance(runId, "e2_file_cards");
}

async function runStageE2(runId: string): Promise<void> {
  const run = await getIngestRun(runId);
  if (!run) return;
  const { createFileCardRun, planFileCardTargets } = await import(
    "@/lib/rag/file-card-runs"
  );
  const planned = await planFileCardTargets({
    scope: "target_emails",
    emailIds: run.newEmailIds,
  });
  if (planned.length > 0) {
    const cardRun = await createFileCardRun({
      scope: "target_emails",
      plannedDocs: planned,
      emailIds: run.newEmailIds,
    });
    const { waitForFileCardWorker } = await import("@/lib/rag/file-card-worker");
    await waitForFileCardWorker(cardRun.id);
  }
  await patchRun(runId, {
    countsJson: JSON.stringify({
      ...run.counts,
      fileCards: planned.length,
      stageNote: `File cards: ${planned.length} document(s).`,
    }),
  });
  await waitOrAdvance(runId, "e3_embed");
}

async function runStageE3(runId: string): Promise<void> {
  const run = await getIngestRun(runId);
  if (!run) return;
  const { runIncrementalIndexSlice } = await import("@/lib/rag/indexer");
  let slices = 0;
  let chunks = 0;
  if (run.newEmailIds.length > 0) {
    for (let i = 0; i < 200; i += 1) {
      const slice = await runIncrementalIndexSlice({
        emailIds: run.newEmailIds,
        batchSize: 25,
        mode: "all",
      });
      slices += 1;
      chunks += slice.chunksCreated;
      if (
        slice.emailsProcessed +
          slice.attachmentsProcessed +
          slice.visionPagesProcessed ===
        0
      ) {
        break;
      }
    }
  }
  const settings = await getEmailSyncSettings();
  await patchRun(runId, {
    countsJson: JSON.stringify({
      ...run.counts,
      embedSlices: slices,
      embedChunks: chunks,
      stageNote: `Embedded ${chunks} chunks across ${slices} slice(s).`,
    }),
  });
  const next = nextIngestStage("e3_embed", {
    harvestEnabled: settings.harvestAfterSyncEnabled,
  });
  if (next === "done") {
    await completeRun(runId);
    return;
  }
  await waitOrAdvance(runId, next);
}

async function runStageE4(runId: string): Promise<void> {
  const { runHarvestMissingAfterSync, formatHarvestAfterSyncMessage } =
    await import("@/lib/email/ingest-harvest");
  const startedAt = new Date().toISOString();
  const harvest = await runHarvestMissingAfterSync();
  const note = formatHarvestAfterSyncMessage(harvest);
  if (harvest.status === "ran") {
    try {
      const { runTelegramHitlAfterHarvest } = await import(
        "@/lib/telegram/after-harvest"
      );
      await runTelegramHitlAfterHarvest({ startedAt, harvest });
    } catch (error) {
      console.error("[ingest] harvest telegram", error);
    }
  }
  const run = await getIngestRun(runId);
  await patchRun(runId, {
    countsJson: JSON.stringify({
      ...(run?.counts ?? {}),
      harvest: harvest.status,
      stageNote: note ?? "Harvest complete.",
    }),
  });
  await completeRun(runId);
}

async function runIngestPipelineWork(runId: string): Promise<void> {
  if (pipelineBusy) {
    console.warn("[ingest] pipeline already busy; skipping work for", runId);
    return;
  }
  pipelineBusy = true;
  try {
    await runCurrentStage(runId);
  } catch (error) {
    console.error("[ingest] pipeline work failed", runId, error);
    await completeRun(
      runId,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    pipelineBusy = false;
  }
}

function scheduleIngestPipelineWork(runId: string): void {
  void runIngestPipelineWork(runId);
}

async function runCurrentStage(runId: string): Promise<void> {
  const run = await getIngestRun(runId);
  if (!run) return;
  try {
    switch (run.stage) {
      case "a_ingest":
        await runStageA(runId);
        break;
      case "b_discover":
        await runStageB(runId);
        break;
      case "c_allowlist":
        break;
      case "d_expand":
        await runStageD(runId);
        break;
      case "e1_docling":
        await runStageE1(runId);
        break;
      case "e2_file_cards":
        await runStageE2(runId);
        break;
      case "e3_embed":
        await runStageE3(runId);
        break;
      case "e4_harvest":
        await runStageE4(runId);
        break;
      case "done":
        await completeRun(runId);
        break;
    }
  } catch (error) {
    await completeRun(
      runId,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function startIngestPipeline(
  trigger: SyncTrigger,
  options?: { runInBackground?: boolean },
): Promise<IngestRunRecord> {
  const active = await getActiveIngestRun();
  if (active) {
    // A crashed or lock-skipped start leaves status=running with no worker.
    resumeIdleIngestRun(active);
    return active;
  }
  if (pipelineBusy) {
    throw new Error(
      "An ingest pipeline is already running. Wait for it to finish.",
    );
  }

  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  const [connection] = await db
    .select({ lastSyncAt: gmailConnections.lastSyncAt })
    .from(gmailConnections)
    .where(eq(gmailConnections.accountType, "personal_backfill"))
    .limit(1);

  await db.insert(emailIngestRuns).values({
    id,
    trigger,
    status: "running",
    stage: "a_ingest",
    waitKind: null,
    lastSuccessfulSyncAt: connection?.lastSyncAt ?? null,
    newEmailIdsJson: "[]",
    countsJson: "{}",
    cursorIndex: 0,
    reminderSentAt: null,
    telegramChatId: null,
    telegramMessageId: null,
    telegramReviewItemId: null,
    lastError: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
  });

  if (options?.runInBackground === false) {
    await runIngestPipelineWork(id);
  } else {
    scheduleIngestPipelineWork(id);
  }
  const created = await getIngestRun(id);
  if (!created) throw new Error("Ingest run was created but could not be loaded.");
  return created;
}

export async function continueIngestRun(runId: string): Promise<IngestRunRecord> {
  const run = await getIngestRun(runId);
  if (!run) throw new Error("Ingest run not found.");
  if (run.status !== "waiting_continue") {
    throw new Error("This run is not waiting to continue.");
  }
  if (pipelineBusy) {
    throw new Error("Pipeline is busy.");
  }
  await patchRun(runId, { status: "running", waitKind: null });
  scheduleIngestPipelineWork(runId);
  return (await getIngestRun(runId))!;
}

export async function decideAllowlistSender(input: {
  runId: string;
  action: "approved" | "denied" | "back";
  via: "telegram" | "ui";
}): Promise<IngestRunRecord> {
  const run = await getIngestRun(input.runId);
  if (!run) throw new Error("Ingest run not found.");
  if (run.status !== "waiting_allowlist") {
    throw new Error("This run is not waiting on allowlist review.");
  }

  const db = getDb();
  const pending = run.senders.filter((row) => row.status === "pending");
  const decided = run.senders.filter((row) => row.status !== "pending");

  if (input.action === "back") {
    const last = [...decided].sort((a, b) => b.sortIndex - a.sortIndex)[0];
    if (!last) return run;
    if (last.status === "approved") {
      await db.delete(senderAllowlist).where(eq(senderAllowlist.email, last.email));
    } else if (last.status === "denied") {
      await db.delete(senderBlocklist).where(eq(senderBlocklist.email, last.email));
    }
    await db
      .update(emailIngestSenderReviews)
      .set({ status: "pending", decidedAt: null })
      .where(eq(emailIngestSenderReviews.id, last.id));
    await patchRun(input.runId, { cursorIndex: last.sortIndex });
    await upsertTelegramMessage(input.runId);
    return (await getIngestRun(input.runId))!;
  }

  const current =
    pending.find((row) => row.sortIndex >= run.cursorIndex) ?? pending[0];
  if (!current) {
    await waitOrAdvance(input.runId, "d_expand");
    return (await getIngestRun(input.runId))!;
  }

  if (input.action === "approved") {
    const allow = await getAllowlistEmails();
    if (!allow.includes(current.email)) {
      await db.insert(senderAllowlist).values({
        id: randomUUID(),
        email: current.email,
        displayName: null,
        notes: "Added from ingest pipeline",
        addedAt: new Date().toISOString(),
      });
    }
    await db.delete(senderBlocklist).where(eq(senderBlocklist.email, current.email));
  } else {
    await db
      .insert(senderBlocklist)
      .values({
        email: current.email,
        blockedAt: new Date().toISOString(),
        ingestRunId: input.runId,
      })
      .onConflictDoUpdate({
        target: senderBlocklist.email,
        set: {
          blockedAt: new Date().toISOString(),
          ingestRunId: input.runId,
        },
      });
  }

  await db
    .update(emailIngestSenderReviews)
    .set({
      status: input.action,
      decidedAt: new Date().toISOString(),
    })
    .where(eq(emailIngestSenderReviews.id, current.id));

  const remaining = (await loadSenders(input.runId)).filter(
    (row) => row.status === "pending",
  );
  if (remaining.length === 0) {
    await waitOrAdvance(input.runId, "d_expand");
  } else {
    await patchRun(input.runId, { cursorIndex: current.sortIndex + 1 });
    await upsertTelegramMessage(input.runId);
  }

  return (await getIngestRun(input.runId))!;
}

export async function handleIngestTelegramCallback(input: {
  reviewItemId: string;
  action: TelegramCallbackAction;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(emailIngestRuns)
    .where(eq(emailIngestRuns.telegramReviewItemId, input.reviewItemId))
    .limit(1);
  if (!row) return { ok: false, error: "Ingest run not found for this review." };

  try {
    if (input.action === "continue") {
      await continueIngestRun(row.id);
      return { ok: true };
    }
    if (
      input.action === "approved" ||
      input.action === "denied" ||
      input.action === "back"
    ) {
      await decideAllowlistSender({
        runId: row.id,
        action: input.action,
        via: "telegram",
      });
      return { ok: true };
    }
    return { ok: false, error: "Unsupported action." };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function remindStaleAllowlistReviews(): Promise<void> {
  const settings = await getEmailSyncSettings();
  const active = await getActiveIngestRun();
  if (!active || active.status !== "waiting_allowlist") return;
  const waitingSince =
    typeof active.counts.allowlistWaitStartedAt === "string"
      ? active.counts.allowlistWaitStartedAt
      : active.updatedAt;
  if (
    !shouldRemindAllowlistTimeout({
      waitingSinceIso: waitingSince,
      timeoutHours: settings.allowlistReviewTimeoutHours,
      reminderSentAt: active.reminderSentAt,
    })
  ) {
    return;
  }
  if (!(await isTelegramHitlReady())) return;
  const chatIds = await listTelegramChatIds();
  const text = `Allowlist review still waiting (${settings.allowlistReviewTimeoutHours}h). Open Email Settings or the previous Telegram card. Nothing was auto-approved.`;
  for (const chatId of chatIds) {
    await sendTelegramMessage({ chatId, text });
  }
  await patchRun(active.id, { reminderSentAt: new Date().toISOString() });
}

export async function maybeSendOauthRelinkReminder(): Promise<void> {
  const settings = await getEmailSyncSettings();
  const db = getDb();
  const [connection] = await db
    .select({ connectedAt: gmailConnections.connectedAt })
    .from(gmailConnections)
    .where(eq(gmailConnections.accountType, "personal_backfill"))
    .limit(1);
  if (
    !shouldSendOauthRelinkRemind({
      connectedAt: connection?.connectedAt ?? null,
      remindAfterDays: settings.oauthRelinkRemindAfterDays,
      lastRemindedAt: settings.lastOauthRelinkRemindedAt,
    })
  ) {
    return;
  }
  if (!(await isTelegramHitlReady())) return;
  const chatIds = await listTelegramChatIds();
  const text = `Personal Gmail OAuth is ${settings.oauthRelinkRemindAfterDays}+ days old. Relink in Email Settings — Google Testing tokens expire around day 7.`;
  for (const chatId of chatIds) {
    await sendTelegramMessage({ chatId, text });
  }
  await updateEmailSyncSettings({
    lastOauthRelinkRemindedAt: new Date().toISOString(),
  });
}
