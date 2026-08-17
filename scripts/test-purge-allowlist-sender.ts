/**
 * Classify imported threads for a mistaken allowlist sender.
 * Run: npx tsx --test scripts/test-purge-allowlist-sender.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifySenderImport } from "../lib/email/purge-allowlist-sender-classify";

function msg(input: {
  id: string;
  threadId: string | null;
  from: string;
  to?: string[];
  cc?: string[];
}) {
  return {
    id: input.id,
    threadId: input.threadId,
    fromAddress: input.from,
    toAddresses: JSON.stringify(input.to ?? []),
    ccAddresses: JSON.stringify(input.cc ?? []),
  };
}

describe("classifySenderImport", () => {
  it("deletes threads that only exist because of the mistaken sender", () => {
    const result = classifySenderImport({
      targetEmail: "friend@example.com",
      otherAllowlistEmails: ["pm@condo.com"],
      messages: [
        msg({
          id: "e1",
          threadId: "t1",
          from: "friend@example.com",
          to: ["pgartenburg@gmail.com"],
        }),
        msg({
          id: "e2",
          threadId: "t1",
          from: "pgartenburg@gmail.com",
          to: ["friend@example.com"],
        }),
      ],
    });
    assert.deepEqual(result.exclusiveThreadIds, ["t1"]);
    assert.deepEqual(result.mixedThreadIds, []);
    assert.equal(result.exclusiveEmailIds.length, 2);
  });

  it("keeps threads that also include someone still on the allowlist", () => {
    const result = classifySenderImport({
      targetEmail: "friend@example.com",
      otherAllowlistEmails: ["pm@condo.com"],
      messages: [
        msg({
          id: "e1",
          threadId: "t1",
          from: "friend@example.com",
          cc: ["pm@condo.com"],
        }),
      ],
    });
    assert.deepEqual(result.exclusiveThreadIds, []);
    assert.deepEqual(result.mixedThreadIds, ["t1"]);
  });

  it("does not select threads where the sender is only a recipient", () => {
    const result = classifySenderImport({
      targetEmail: "friend@example.com",
      otherAllowlistEmails: ["pm@condo.com"],
      messages: [
        msg({
          id: "e1",
          threadId: "t1",
          from: "pm@condo.com",
          to: ["friend@example.com"],
        }),
      ],
    });
    assert.deepEqual(result.exclusiveThreadIds, []);
    assert.deepEqual(result.mixedThreadIds, []);
  });

  it("includes From-only messages with no thread", () => {
    const result = classifySenderImport({
      targetEmail: "friend@example.com",
      otherAllowlistEmails: [],
      messages: [
        msg({
          id: "orphan",
          threadId: null,
          from: "Friend <friend@example.com>",
        }),
      ],
    });
    assert.deepEqual(result.orphanEmailIds, ["orphan"]);
    assert.ok(result.exclusiveEmailIds.includes("orphan"));
  });
});
