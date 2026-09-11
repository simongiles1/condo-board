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
import { nextIngestStage } from "../lib/email/ingest-stages";
import {
  appendCatchupAfterToQuery,
  gmailAfterDateInclusive,
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
});
