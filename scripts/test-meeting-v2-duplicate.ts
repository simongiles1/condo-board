/**
 * Tests for V2 meeting duplicate-to-agenda-approval helpers.
 * Run: npx tsx --test scripts/test-meeting-v2-duplicate.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDuplicatedAgendaApproval,
  meetingV2CanDuplicateToAgendaApproval,
  remapCopiedMeetingText,
  rewriteMeetingScopedPath,
} from "../lib/meeting-v2/duplicate-meeting-shared";

describe("meetingV2CanDuplicateToAgendaApproval", () => {
  it("allows duplicate once agenda items exist", () => {
    assert.equal(meetingV2CanDuplicateToAgendaApproval(0), false);
    assert.equal(meetingV2CanDuplicateToAgendaApproval(12), true);
  });
});

describe("rewriteMeetingScopedPath", () => {
  it("rewrites upload paths for the new meeting id", () => {
    assert.equal(
      rewriteMeetingScopedPath("uploads/old-id/transcript.vtt", "old-id", "new-id"),
      "uploads/new-id/transcript.vtt",
    );
  });

  it("leaves shared archive paths unchanged", () => {
    assert.equal(
      rewriteMeetingScopedPath("uploads/attachments/board.pdf", "old-id", "new-id"),
      "uploads/attachments/board.pdf",
    );
  });
});

describe("buildDuplicatedAgendaApproval", () => {
  it("clears approval and remaps agenda item ids", () => {
    const itemIdMap = new Map([
      ["item-a", "item-a-copy"],
      ["item-b", "item-b-copy"],
    ]);
    const next = buildDuplicatedAgendaApproval(
      {
        status: "approved",
        approvedAt: "2026-09-14T12:00:00.000Z",
        approvedBy: "tester",
        itemStatuses: { "item-a": "discussed", "item-b": "not_discussed" },
        excludedItemIds: ["item-b"],
        discrepancies: [
          {
            id: "d1",
            transcriptRange: [1, 2],
            timestamp: "00:01:00",
            snippet: "next meeting",
            suggestedTitle: "Date of Next Meeting",
            clarificationQuestion: "Keep this item?",
            status: "accepted",
          },
        ],
      },
      itemIdMap,
    );

    assert.equal(next.status, "pending_review");
    assert.equal(next.approvedAt, null);
    assert.deepEqual(next.itemStatuses, {
      "item-a-copy": "discussed",
      "item-b-copy": "not_discussed",
    });
    assert.deepEqual(next.excludedItemIds, ["item-b-copy"]);
    assert.equal(next.discrepancies?.[0]?.status, "accepted");
  });
});

describe("remapCopiedMeetingText", () => {
  it("replaces copied row ids in JSON text", () => {
    const rewritten = remapCopiedMeetingText(
      '{"chunkId":"chunk-old","meetingId":"meet-old"}',
      [
        ["chunk-old", "chunk-new"],
        ["meet-old", "meet-new"],
      ],
    );
    assert.equal(rewritten, '{"chunkId":"chunk-new","meetingId":"meet-new"}');
  });
});
