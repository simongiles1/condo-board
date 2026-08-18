/**
 * Telegram HITL hold heuristic + callback parsing.
 * Run: npx tsx --test scripts/test-telegram-hitl.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  contactHoldReason,
  CONTACT_HOLD_EMAIL_SCORE,
  rewriteSharedMailboxDecision,
} from "../lib/contacts/registry-hold";
import type { ShortlistHit } from "../lib/contacts/registry-shortlist";
import type { ContactAdjudicationDecision } from "../lib/contacts/registry-shared";
import type { ContactRegistryIncomingCard } from "../lib/contacts/registry-shared";
import type { ContactRegistryPersonSummary } from "../lib/contacts/registry-shared";
import {
  formatResolvedMessage,
  parseTelegramCallbackData,
  telegramCallbackData,
} from "../lib/telegram/format";
import {
  contactReviewIdentityKey,
} from "../lib/telegram/types";
import {
  normalizeTelegramChatId,
  shouldPollTelegram,
} from "../lib/telegram/config";
import { explainTelegramSendFailure } from "../lib/telegram/api";

function person(
  id: string,
  firstName: string,
  lastName: string,
  extras?: Partial<ContactRegistryPersonSummary>,
): ContactRegistryPersonSummary {
  return {
    id,
    firstName,
    lastName,
    nameAliases: [],
    mentionWeight: extras?.mentionWeight ?? 1,
    sourceEmailCount: 1,
    sparseStub: false,
    currentOrganizationId: null,
    currentOrganizationName: null,
    emails: extras?.emails ?? [],
    phones: extras?.phones ?? [],
    titles: extras?.titles ?? [],
  };
}

function occupancyEmail(
  address: string,
  validFrom: string | null,
  validTo: string | null,
): ContactRegistryPersonSummary["emails"][number] {
  return { id: address, email: address, validFrom, validTo };
}

function incomingCard(
  extras: Partial<ContactRegistryIncomingCard> & {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  },
): ContactRegistryIncomingCard {
  return {
    tempId: extras.tempId ?? "t1",
    first_name: extras.first_name ?? null,
    last_name: extras.last_name ?? null,
    email: extras.email ?? null,
    phone: extras.phone ?? null,
    job_title: extras.job_title ?? null,
    sourceEmailIds: extras.sourceEmailIds ?? [],
    dateMin: extras.dateMin ?? "2026-08-14",
    dateMax: extras.dateMax ?? "2026-08-14",
    mentionWeight: extras.mentionWeight ?? 1,
    blockingKeys: extras.blockingKeys ?? [],
  };
}

function hit(
  id: string,
  first: string,
  last: string,
  score: number,
): ShortlistHit {
  return { person: person(id, first, last), score };
}

function decision(
  action: ContactAdjudicationDecision["action"],
  extras?: Partial<ContactAdjudicationDecision>,
): ContactAdjudicationDecision {
  return {
    incomingTempId: "t1",
    action,
    targetPersonId: extras?.targetPersonId ?? null,
    email: null,
    validFrom: null,
    validTo: null,
    reason: extras?.reason ?? null,
  };
}

describe("contactHoldReason", () => {
  it("auto-applies a unique email match even with a weaker second name hit", () => {
    const reason = contactHoldReason({
      decision: decision("merge", { targetPersonId: "a" }),
      candidates: [
        hit("a", "Jane", "Smith", CONTACT_HOLD_EMAIL_SCORE),
        hit("b", "Janet", "Smith", 30),
      ],
    });
    assert.equal(reason, null);
  });

  it("holds when two name-level candidates compete", () => {
    const reason = contactHoldReason({
      decision: decision("merge", { targetPersonId: "a" }),
      candidates: [
        hit("a", "Jane", "Smith", 45),
        hit("b", "Janet", "Smith", 38),
      ],
    });
    assert.equal(reason, "multiple_candidates");
  });

  it("holds keep_separate against a strong match", () => {
    const reason = contactHoldReason({
      decision: decision("keep_separate"),
      candidates: [hit("a", "Jane", "Smith", 70)],
    });
    assert.equal(reason, "declined_strong_match");
  });

  it("holds a weak merge", () => {
    const reason = contactHoldReason({
      decision: decision("merge", { targetPersonId: "a" }),
      candidates: [hit("a", "Jane", "Smith", 25)],
    });
    assert.equal(reason, "weak_merge");
  });

  it("holds model parse fallback", () => {
    const reason = contactHoldReason({
      decision: decision("keep_separate", { reason: "parse_fallback" }),
      candidates: [],
    });
    assert.equal(reason, "model_fallback");
  });

  it("auto-applies keep_separate with no candidates", () => {
    const reason = contactHoldReason({
      decision: decision("keep_separate"),
      candidates: [],
    });
    assert.equal(reason, null);
  });

  it("does not hold a named role-mailbox match when other occupants are different people", () => {
    const studio = "studiopm@iccpropertymanagement.com";
    const reason = contactHoldReason({
      incoming: incomingCard({
        first_name: "Haider",
        last_name: "Mukadam",
        email: studio,
      }),
      decision: decision("merge", { targetPersonId: "haider" }),
      candidates: [
        {
          person: person("haider", "Haider", "Mukadam", {
            emails: [occupancyEmail(studio, "2023-07-27", "2026-08-14")],
          }),
          score: 160,
        },
        {
          person: person("bonnie", "Bonnie", "Kafi", {
            emails: [occupancyEmail(studio, "2023-07-27", "2026-05-11")],
            mentionWeight: 1413,
          }),
          score: 105,
        },
        {
          person: person("atif", "Atif", "Khurshid", {
            emails: [occupancyEmail(studio, "2022-01-01", "2023-07-01")],
          }),
          score: 105,
        },
      ],
    });
    assert.equal(reason, null);
  });

  it("does not hold Haider stubs that share the role mailbox with the full name", () => {
    const studio = "studiopm@iccpropertymanagement.com";
    const reason = contactHoldReason({
      incoming: incomingCard({
        first_name: "Haider",
        last_name: "Mukadam",
        email: studio,
      }),
      decision: decision("merge", { targetPersonId: "haider" }),
      candidates: [
        {
          person: person("haider", "Haider", "Mukadam", {
            emails: [occupancyEmail(studio, "2023-07-27", "2026-08-14")],
          }),
          score: 160,
        },
        {
          person: person("stub", "Haider", "M", {
            emails: [occupancyEmail(studio, "2024-01-01", "2024-06-01")],
          }),
          score: 123,
        },
      ],
    });
    assert.equal(reason, null);
  });
});

describe("rewriteSharedMailboxDecision", () => {
  const studio = "studiopm@iccpropertymanagement.com";

  it("attaches nameless incoming to the latest occupant, not the highest-mention person", () => {
    const rewritten = rewriteSharedMailboxDecision({
      incoming: incomingCard({
        first_name: null,
        last_name: null,
        email: studio,
      }),
      candidates: [
        {
          person: person("bonnie", "Bonnie", "Kafi", {
            mentionWeight: 1413,
            emails: [occupancyEmail(studio, "2023-07-27", "2026-05-11")],
          }),
          score: 105,
        },
        {
          person: person("haider", "Haider", "Mukadam", {
            mentionWeight: 213,
            emails: [occupancyEmail(studio, "2023-07-27", "2026-08-14")],
          }),
          score: 105,
        },
      ],
      decision: decision("link_email", {
        targetPersonId: "bonnie",
        reason: "link to current occupant (Bonnie Kafi)",
      }),
    });
    assert.equal(rewritten.action, "enrich");
    assert.equal(rewritten.targetPersonId, "haider");
    assert.equal(rewritten.reason, "nameless_role_mailbox_current_occupant");
  });

  it("retargets a named card away from a conflicting occupant", () => {
    const rewritten = rewriteSharedMailboxDecision({
      incoming: incomingCard({
        first_name: "Haider",
        last_name: "Mukadam",
        email: studio,
      }),
      candidates: [
        {
          person: person("bonnie", "Bonnie", "Kafi", {
            emails: [occupancyEmail(studio, "2023-07-27", "2026-05-11")],
          }),
          score: 105,
        },
        {
          person: person("haider", "Haider", "Mukadam", {
            emails: [occupancyEmail(studio, "2023-07-27", "2026-08-14")],
          }),
          score: 160,
        },
      ],
      decision: decision("link_email", { targetPersonId: "bonnie" }),
    });
    assert.equal(rewritten.action, "merge");
    assert.equal(rewritten.targetPersonId, "haider");
  });
});

describe("contactReviewIdentityKey", () => {
  it("collapses the same mailbox identity", () => {
    assert.equal(
      contactReviewIdentityKey({
        first_name: "Haider",
        last_name: "Mukadam",
        email: "StudioPM@ICCPropertyManagement.com",
      }),
      contactReviewIdentityKey({
        first_name: "Haider",
        last_name: "Mukadam",
        email: "studiopm@iccpropertymanagement.com",
      }),
    );
  });
});

describe("parseTelegramCallbackData", () => {
  const id = "3b95db63-e1b3-4cf9-a3ea-d39a910018d7";

  it("parses approve and deny", () => {
    assert.deepEqual(parseTelegramCallbackData(telegramCallbackData(id, "approved")), {
      action: "approved",
      id,
    });
    assert.deepEqual(parseTelegramCallbackData(`no:${id}`), {
      action: "denied",
      id,
    });
  });

  it("rejects junk", () => {
    assert.equal(parseTelegramCallbackData("ok:not-a-uuid"), null);
    assert.equal(parseTelegramCallbackData(undefined), null);
  });
});

describe("formatResolvedMessage", () => {
  it("appends the outcome once", () => {
    const first = formatResolvedMessage("Ambiguous contact", "approved");
    assert.match(first, /Approved in Telegram/);
    assert.equal(formatResolvedMessage(first, "approved"), first);
  });
});

describe("shouldPollTelegram", () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalWebhook = process.env.TELEGRAM_WEBHOOK_URL;
  const originalWorkers = process.env.DISABLE_BACKGROUND_WORKERS;

  function restoreTelegramEnv() {
    if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalToken;
    if (originalWebhook === undefined) delete process.env.TELEGRAM_WEBHOOK_URL;
    else process.env.TELEGRAM_WEBHOOK_URL = originalWebhook;
    if (originalWorkers === undefined) delete process.env.DISABLE_BACKGROUND_WORKERS;
    else process.env.DISABLE_BACKGROUND_WORKERS = originalWorkers;
  }

  it("does not long-poll when background workers are disabled", () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    delete process.env.TELEGRAM_WEBHOOK_URL;
    process.env.DISABLE_BACKGROUND_WORKERS = "true";
    try {
      assert.equal(shouldPollTelegram(), false);
    } finally {
      restoreTelegramEnv();
    }
  });

  it("long-polls when the bot is configured and workers are on", () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    delete process.env.TELEGRAM_WEBHOOK_URL;
    delete process.env.DISABLE_BACKGROUND_WORKERS;
    try {
      assert.equal(shouldPollTelegram(), true);
    } finally {
      restoreTelegramEnv();
    }
  });
});

describe("normalizeTelegramChatId", () => {
  it("accepts numeric user and group ids", () => {
    assert.equal(normalizeTelegramChatId("123456789"), "123456789");
    assert.equal(normalizeTelegramChatId(" -1001234567890 "), "-1001234567890");
  });

  it("rejects blank and non-numeric values", () => {
    assert.equal(normalizeTelegramChatId(""), null);
    assert.equal(normalizeTelegramChatId("abc"), null);
    assert.equal(normalizeTelegramChatId("0"), null);
  });
});

describe("explainTelegramSendFailure", () => {
  it("tells the user to Start this bot on chat not found", () => {
    const message = explainTelegramSendFailure(
      "Bad Request: chat not found",
      "CondoBoardBot",
    );
    assert.match(message, /@CondoBoardBot/);
    assert.match(message, /tap Start/i);
  });
});
