/**
 * Gmail quota detection, error collapsing, and retry waits.
 * Run: npx tsx --test scripts/test-gmail-quota.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isGmailQuotaError,
  summarizeGmailSyncErrors,
  withGmailQuotaRetry,
} from "../lib/gmail/quota";

describe("isGmailQuotaError", () => {
  it("matches Gmail Total Query Cost quota text", () => {
    assert.equal(
      isGmailQuotaError(
        new Error(
          "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com'",
        ),
      ),
      true,
    );
  });

  it("matches HTTP 429", () => {
    assert.equal(isGmailQuotaError({ status: 429, message: "slow down" }), true);
  });

  it("ignores unrelated errors", () => {
    assert.equal(isGmailQuotaError(new Error("invalid_grant")), false);
  });
});

describe("summarizeGmailSyncErrors", () => {
  it("collapses a quota dump into one line", () => {
    const errors = Array.from({ length: 12 }, (_, i) => `Message ${i}: Quota exceeded for quota metric 'Total Query Cost'`);
    errors.push("Gmail history cursor was not advanced because one or more messages in the history batch failed to import.");
    const summarized = summarizeGmailSyncErrors(errors);
    assert.equal(summarized.length, 1);
    assert.match(summarized[0]!, /12 fetches/);
  });

  it("leaves a short error list unchanged", () => {
    const errors = ["Thread abc: boom"];
    assert.deepEqual(summarizeGmailSyncErrors(errors), errors);
  });
});

describe("withGmailQuotaRetry", () => {
  it("retries after quota then succeeds", async () => {
    let calls = 0;
    const waits: number[] = [];
    const result = await withGmailQuotaRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error("Quota exceeded for quota metric 'Total Query Cost'");
        }
        return "ok";
      },
      {
        waitsMs: [1, 1, 1],
        sleep: async (ms) => {
          waits.push(ms);
        },
      },
    );
    assert.equal(result, "ok");
    assert.equal(calls, 3);
    assert.deepEqual(waits, [1, 1]);
  });
});
