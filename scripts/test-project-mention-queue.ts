/**
 * Project mention queue grouping tests.
 * Run: npx tsx --test scripts/test-project-mention-queue.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolutionReasonLabel } from "../lib/entities/resolution-reason";
import {
  buildProjectMentionQueueGroups,
  parseProjectMentionQueueView,
  type ProjectMentionQueueRow,
} from "../lib/projects/mention-queue-shared";

function row(
  partial: Partial<ProjectMentionQueueRow> & { id: string; rawName: string },
): ProjectMentionQueueRow {
  return {
    contractor: null,
    yearHint: null,
    phase: null,
    location: null,
    nameKey: partial.rawName.toLowerCase(),
    identityKey: null,
    fingerprint: `fp-${partial.id}`,
    minted: false,
    resolutionStatus: "unresolved",
    resolutionReason: "insufficient",
    resolvedProjectId: null,
    resolvedProjectName: null,
    resolvedProjectIdentityKey: null,
    sourceEmailId: `email-${partial.id}`,
    threadId: "thread-1",
    subject: "Hello",
    receivedAt: "2026-01-01T00:00:00.000Z",
    fromAddress: "a@example.com",
    toAddresses: "[]",
    contextSnippet: null,
    ...partial,
  };
}

describe("parseProjectMentionQueueView", () => {
  it("defaults to unresolved", () => {
    assert.equal(parseProjectMentionQueueView(null), "unresolved");
    assert.equal(parseProjectMentionQueueView("nope"), "unresolved");
  });

  it("accepts the three status queues", () => {
    assert.equal(parseProjectMentionQueueView("provisional"), "provisional");
    assert.equal(parseProjectMentionQueueView("confirmed"), "confirmed");
  });
});

describe("buildProjectMentionQueueGroups", () => {
  it("groups the same work name together", () => {
    const groups = buildProjectMentionQueueGroups([
      row({ id: "1", rawName: "Maglock", nameKey: "maglock", yearHint: "2024" }),
      row({
        id: "2",
        rawName: "Maglock",
        nameKey: "maglock",
        yearHint: "2025",
        minted: true,
      }),
      row({ id: "3", rawName: "Roof", nameKey: "roof" }),
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.label, "Maglock");
    assert.equal(groups[0]?.mentionCount, 2);
    assert.equal(groups[0]?.mintedCount, 1);
    assert.equal(groups[0]?.samples[0]?.resolutionReason, "insufficient");
    assert.equal(groups[1]?.label, "Roof");
  });

  it("copies linked project fields onto samples", () => {
    const groups = buildProjectMentionQueueGroups([
      row({
        id: "1",
        rawName: "Maglock",
        nameKey: "maglock",
        minted: true,
        resolutionStatus: "confirmed",
        resolutionReason: "unique_identity_key",
        resolvedProjectId: "proj-1",
        resolvedProjectName: "Maglock installation",
        resolvedProjectIdentityKey: "maglock|2024",
      }),
    ]);
    const sample = groups[0]?.samples[0];
    assert.equal(sample?.minted, true);
    assert.equal(sample?.resolvedProjectName, "Maglock installation");
    assert.equal(sample?.resolvedProjectIdentityKey, "maglock|2024");
    assert.equal(sample?.resolutionReason, "unique_identity_key");
  });
});

describe("resolutionReasonLabel", () => {
  it("labels known contact and project codes", () => {
    assert.equal(
      resolutionReasonLabel("unique_first_plus_org_provisional"),
      "Unique first name + org (provisional)",
    );
    assert.equal(
      resolutionReasonLabel("unique_work_name_provisional"),
      "Unique work-name match (provisional)",
    );
    assert.equal(resolutionReasonLabel("year_mismatch"), "Name matches but years do not overlap");
  });
});
