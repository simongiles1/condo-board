/**
 * Missing-harvest targeting: successful row = error is null; group by thread.
 * Run: npx tsx --test scripts/test-harvest-missing-targets.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterEmailsMissingHarvest,
  groupEmailsIntoExtractTargets,
  isSuccessfulHarvestRow,
  type ExtractTargetEmail,
  type ExtractTargetThread,
} from "../lib/email-analysis/bulk-extract-targets";
import {
  formatHarvestAfterSyncMessage,
  shouldSkipHarvestAfterSync,
} from "../lib/email/ingest-harvest";

function thread(
  id: string,
  lastMessageAt: string,
  subject = "Subject",
): ExtractTargetThread {
  return { id, subject, lastMessageAt };
}

function email(
  id: string,
  receivedAt: string,
  threadId: string | null,
  subject = "Subject",
): ExtractTargetEmail {
  return { id, threadId, subject, receivedAt };
}

describe("isSuccessfulHarvestRow", () => {
  it("treats null error as extracted", () => {
    assert.equal(isSuccessfulHarvestRow(null), true);
  });

  it("treats a failed row as still missing", () => {
    assert.equal(isSuccessfulHarvestRow("model timeout"), false);
  });
});

describe("filterEmailsMissingHarvest", () => {
  it("drops emails that already have a successful harvest", () => {
    const missing = filterEmailsMissingHarvest(
      [email("a", "2026-01-01T00:00:00.000Z", "t1"), email("b", "2026-01-02T00:00:00.000Z", "t1")],
      ["a"],
    );
    assert.deepEqual(
      missing.map((row) => row.id),
      ["b"],
    );
  });
});

describe("groupEmailsIntoExtractTargets", () => {
  it("keeps thread order and only missing emails when grouping a subset", () => {
    const targets = groupEmailsIntoExtractTargets(
      [
        thread("t-old", "2026-01-01T00:00:00.000Z", "Old"),
        thread("t-new", "2026-01-03T00:00:00.000Z", "New"),
      ],
      [
        email("e2", "2026-01-02T00:00:00.000Z", "t-new", "New"),
        email("e-orphan", "2026-01-04T00:00:00.000Z", null, "Orphan"),
      ],
      "emails",
    );

    assert.equal(targets.length, 2);
    assert.equal(targets[0]?.threadId, "t-new");
    assert.deepEqual(targets[0]?.emailIds, ["e2"]);
    assert.ok(targets[0]?.prepareQuery.startsWith("emailIds="));
    assert.equal(targets[1]?.threadId, null);
    assert.deepEqual(targets[1]?.emailIds, ["e-orphan"]);
  });

  it("skips threads that have no remaining emails", () => {
    const targets = groupEmailsIntoExtractTargets(
      [thread("t1", "2026-01-01T00:00:00.000Z")],
      [],
    );
    assert.equal(targets.length, 0);
  });
});

describe("shouldSkipHarvestAfterSync", () => {
  it("does not harvest when the toggle is off", () => {
    assert.equal(
      shouldSkipHarvestAfterSync({ enabled: false, runningBulkCount: 0 }),
      "disabled",
    );
  });

  it("skips when a bulk extract is already running", () => {
    assert.equal(
      shouldSkipHarvestAfterSync({ enabled: true, runningBulkCount: 1 }),
      "skipped_busy",
    );
  });

  it("runs when enabled and idle", () => {
    assert.equal(
      shouldSkipHarvestAfterSync({ enabled: true, runningBulkCount: 0 }),
      "run",
    );
  });
});

describe("formatHarvestAfterSyncMessage", () => {
  it("says nothing when harvest is disabled", () => {
    assert.equal(
      formatHarvestAfterSyncMessage({ status: "disabled", kinds: [] }),
      null,
    );
  });

  it("explains a busy skip", () => {
    assert.equal(
      formatHarvestAfterSyncMessage({ status: "skipped_busy", kinds: [] }),
      "Harvest skipped: a bulk extract is already running.",
    );
  });
});
