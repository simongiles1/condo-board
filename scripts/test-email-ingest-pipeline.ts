/**
 * Catch-up query, allowlist candidates, OAuth remind, Telegram callbacks.
 * Run: npx tsx --test scripts/test-email-ingest-pipeline.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectParticipantEmails,
  filterAllowlistCandidates,
  shouldRemindAllowlistTimeout,
} from "../lib/email/ingest-candidates";
import { shouldSendOauthRelinkRemind } from "../lib/email/ingest-oauth-remind";
import {
  formatHarvestAfterSyncMessage,
  ingestRunSummaryRows,
  ingestStageMeterSegments,
  nextIngestStage,
  shouldResumeIdleIngestRun,
} from "../lib/email/ingest-stages";
import {
  appendCatchupAfterToQuery,
  gmailAfterDateInclusive,
  resolveCatchupSinceIso,
} from "../lib/gmail/queries";
import {
  parseTelegramCallbackData,
  telegramCallbackData,
} from "../lib/telegram/format";

describe("gmail catch-up query", () => {
  it("uses after: the UTC day before last success so same-day mail is included", () => {
    assert.equal(gmailAfterDateInclusive("2026-08-23T15:00:00.000Z"), "2026/08/22");
    const q = appendCatchupAfterToQuery("(from:a@x.com)", "2026-08-23T15:00:00.000Z");
    assert.match(q, /after:2026\/08\/22/);
    assert.doesNotMatch(q, /newer_than:2d/);
  });

  it("fills a mailbox hole instead of using a reconnect lastSyncAt of now", () => {
    const since = resolveCatchupSinceIso({
      lastSyncAt: "2026-09-11T16:22:08.419Z",
      lastCompletedSyncAt: "2026-09-11T16:22:08.506Z",
      newestReceivedAt: "2026-09-10T19:38:44.000Z",
      previousReceivedAt: "2026-08-21T19:00:22.227Z",
    });
    assert.equal(since, "2026-08-21T19:00:22.227Z");
  });

  it("does not use an in-progress sync as the catch-up origin", () => {
    const since = resolveCatchupSinceIso({
      lastSyncAt: null,
      lastCompletedSyncAt: "2026-08-23T19:00:05.971Z",
      newestReceivedAt: "2026-08-21T18:00:00.000Z",
      previousReceivedAt: "2026-08-21T12:00:00.000Z",
    });
    assert.equal(since, "2026-08-23T19:00:05.971Z");
  });
});

describe("allowlist candidates", () => {
  it("collects From, To, and CC then subtracts allowlist and blocklist", () => {
    const participants = collectParticipantEmails([
      {
        fromAddress: "PM <pm@board.com>",
        toAddresses: ["Dad <dad@law.com>", "me@gmail.com"],
        ccAddresses: '["cc@vendor.com"]',
      },
    ]);
    assert.deepEqual(participants, [
      "cc@vendor.com",
      "dad@law.com",
      "me@gmail.com",
      "pm@board.com",
    ]);
    assert.deepEqual(
      filterAllowlistCandidates({
        participants,
        allowlist: ["pm@board.com"],
        blocklist: ["me@gmail.com"],
      }),
      ["cc@vendor.com", "dad@law.com"],
    );
  });
});

describe("telegram ingest callbacks", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  it("parses ok/no/bk/go", () => {
    assert.deepEqual(parseTelegramCallbackData(telegramCallbackData(id, "approved")), {
      id,
      action: "approved",
    });
    assert.deepEqual(parseTelegramCallbackData(`no:${id}`), {
      id,
      action: "denied",
    });
    assert.deepEqual(parseTelegramCallbackData(`bk:${id}`), {
      id,
      action: "back",
    });
    assert.deepEqual(parseTelegramCallbackData(`go:${id}`), {
      id,
      action: "continue",
    });
    assert.deepEqual(parseTelegramCallbackData(`ld:${id}`), {
      id,
      action: "loading",
    });
    assert.deepEqual(
      parseTelegramCallbackData(telegramCallbackData(id, "loading")),
      { id, action: "loading" },
    );
  });
});

describe("timeout and oauth remind", () => {
  const now = Date.parse("2026-09-11T12:00:00.000Z");

  it("does not auto-approve; reminds once after N hours", () => {
    assert.equal(
      shouldRemindAllowlistTimeout({
        waitingSinceIso: "2026-09-10T11:00:00.000Z",
        timeoutHours: 24,
        reminderSentAt: null,
        nowMs: now,
      }),
      true,
    );
    assert.equal(
      shouldRemindAllowlistTimeout({
        waitingSinceIso: "2026-09-10T11:00:00.000Z",
        timeoutHours: 24,
        reminderSentAt: "2026-09-11T11:00:00.000Z",
        nowMs: now,
      }),
      false,
    );
  });

  it("sends oauth relink after 6 days from connect, once per connect", () => {
    assert.equal(
      shouldSendOauthRelinkRemind({
        connectedAt: "2026-09-04T12:00:00.000Z",
        remindAfterDays: 6,
        lastRemindedAt: null,
        nowMs: now,
      }),
      true,
    );
    assert.equal(
      shouldSendOauthRelinkRemind({
        connectedAt: "2026-09-10T12:00:00.000Z",
        remindAfterDays: 6,
        lastRemindedAt: null,
        nowMs: now,
      }),
      false,
    );
  });
});

describe("ingest stages", () => {
  it("skips harvest when the checkbox is off", () => {
    assert.equal(
      nextIngestStage("e3_embed", { harvestEnabled: false }),
      "done",
    );
    assert.equal(
      nextIngestStage("e3_embed", { harvestEnabled: true }),
      "e4_harvest",
    );
  });

  it("resumes a running ingest only when the in-memory worker is idle", () => {
    assert.equal(
      shouldResumeIdleIngestRun({ status: "running", pipelineBusy: true }),
      false,
    );
    assert.equal(
      shouldResumeIdleIngestRun({ status: "running", pipelineBusy: false }),
      true,
    );
    assert.equal(
      shouldResumeIdleIngestRun({
        status: "waiting_continue",
        pipelineBusy: false,
      }),
      false,
    );
  });

  it("marks prior stages done and the current stage active on the meter", () => {
    const segments = ingestStageMeterSegments({
      stage: "e1_docling",
      status: "waiting_continue",
    });
    assert.equal(segments.filter((s) => s.state === "done").length, 4);
    assert.equal(
      segments.find((s) => s.stage === "e1_docling")?.state,
      "active",
    );
    assert.equal(
      segments.find((s) => s.stage === "e2_file_cards")?.state,
      "pending",
    );
  });
});

describe("ingest completion summary", () => {
  it("rewrites 38/46 as eight emails still needing extraction", () => {
    const message = formatHarvestAfterSyncMessage({
      status: "ran",
      kinds: [
        {
          kind: "contacts",
          status: "completed",
          completedEmails: 38,
          totalEmails: 46,
          failedThreads: 0,
        },
        {
          kind: "organizations",
          status: "skipped_empty",
          completedEmails: 0,
          totalEmails: 0,
          failedThreads: 0,
        },
      ],
    });
    assert.match(message ?? "", /38 of 46 emails/);
    assert.match(message ?? "", /remaining 8 emails were not harvested/);
    assert.match(message ?? "", /not an expected skip/);
    assert.match(message ?? "", /organizations had no emails missing harvests/);
  });

  it("builds a summary from stored counts and a legacy harvest note", () => {
    const rows = ingestRunSummaryRows({
      id: "run-1",
      trigger: "manual",
      status: "completed",
      stage: "done",
      waitKind: null,
      lastSuccessfulSyncAt: null,
      newEmailIds: Array.from({ length: 44 }, (_, i) => `e${i}`),
      counts: {
        messagesAdded: 12,
        expandAdded: 32,
        approvedSenders: 7,
        attachmentsDownloaded: 4,
        extractionHashes: 3,
        fileCards: 3,
        embedChunks: 80,
        embedSlices: 4,
        harvest: "ran",
        stageNote: "Harvested missing contacts 38/46.",
      },
      cursorIndex: 0,
      reminderSentAt: null,
      lastError: null,
      startedAt: "2026-09-11T12:00:00.000Z",
      updatedAt: "2026-09-11T12:30:00.000Z",
      finishedAt: "2026-09-11T12:30:00.000Z",
      senders: [
        {
          id: "s1",
          email: "a@x.com",
          status: "approved",
          sortIndex: 0,
          estimatedThreadCount: 1,
          estimatedEmailCount: 2,
        },
      ],
    });
    const harvest = rows.find((row) => row.label === "Harvest");
    assert.equal(harvest?.tone, "warn");
    assert.match(harvest?.detail ?? "", /38 of 46 emails/);
    assert.match(
      rows.find((row) => row.label === "Emails in this run")?.detail ?? "",
      /44 emails/,
    );
  });
});
