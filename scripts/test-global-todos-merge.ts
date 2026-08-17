/**
 * Global to-do merge preserves email/manual rows.
 * Run: npx tsx --test scripts/test-global-todos-merge.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyGlobalTodosMerge,
  isMeetingGlobalTodoSource,
  type GlobalTodoRow,
} from "../lib/todos/global-todos";

function meetingTodo(
  overrides: Partial<GlobalTodoRow> = {},
): GlobalTodoRow {
  return {
    id: "meeting-1",
    assignee: "Board",
    role: "Director",
    description: "Approve the audit",
    deadline: null,
    completed: false,
    completedAt: null,
    sourceMeetingId: "mtg-1",
    sourceKind: "meeting",
    sourceExtractedActionItemId: null,
    sourceMeetingTitle: "April meeting",
    sourceMeetingDate: "2026-04-15",
    sourceEmailId: null,
    sourceEmailThreadId: null,
    sourceEmailReceivedAt: null,
    sourceQuote: null,
    createdAt: "2026-04-16T00:00:00.000Z",
    updatedAt: "2026-04-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("isMeetingGlobalTodoSource", () => {
  it("treats meeting and legacy blank kinds as meeting-owned", () => {
    assert.equal(isMeetingGlobalTodoSource("meeting"), true);
    assert.equal(isMeetingGlobalTodoSource(null), true);
  });

  it("preserves email and manual rows across a meeting merge", () => {
    assert.equal(isMeetingGlobalTodoSource("email"), false);
    assert.equal(isMeetingGlobalTodoSource("manual"), false);
  });
});

describe("applyGlobalTodosMerge", () => {
  it("tags rewritten rows as meeting-sourced", () => {
    const { rows } = applyGlobalTodosMerge({
      existing: [meetingTodo()],
      merged: [
        {
          assignee: "Board",
          role: "Director",
          description: "Approve the audit",
          deadline: null,
          completed: false,
        },
      ],
      sourceMeetingId: "mtg-2",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sourceKind, "meeting");
    assert.equal(rows[0]?.sourceExtractedActionItemId, null);
    assert.equal(rows[0]?.sourceMeetingId, "mtg-2");
  });
});
