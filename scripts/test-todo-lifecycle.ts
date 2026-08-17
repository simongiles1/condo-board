/**
 * Email to-do working window and lifecycle helpers.
 * Run: npx tsx --test scripts/test-todo-lifecycle.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  completedFieldsForLifecycle,
  isTodoInWorkingWindow,
  isTodoLifecycleStatus,
  isUnresolvedTodoLifecycle,
  isWorkingListTodo,
  lifecycleStatusForReceivedAt,
  TODO_WORKING_WINDOW_DAYS,
  todoWorkingWindowCutoffIso,
} from "../lib/email-analysis/todo-lifecycle";
import { parseTodoHighlightJson } from "../lib/email-analysis/todo-highlight-shared";
import { isDeepSeekModelName, isEmailInTodoReconciliationScope } from "../lib/email-analysis/action-item-reconciliation";
import {
  parseSemanticActionItemDedupResult,
  resolveSemanticDedupInsertItems,
} from "../lib/email-analysis/action-item-dedup";

describe("todo working window", () => {
  const now = new Date("2026-08-15T16:00:00.000Z");

  it("is 120 days", () => {
    assert.equal(TODO_WORKING_WINDOW_DAYS, 120);
  });

  it("cuts off 120 days before now", () => {
    assert.equal(
      todoWorkingWindowCutoffIso(now),
      "2026-04-17T16:00:00.000Z",
    );
  });

  it("treats a recent email as in-window", () => {
    assert.equal(isTodoInWorkingWindow("2026-08-01T12:00:00.000Z", now), true);
  });

  it("treats an older email as archive", () => {
    assert.equal(isTodoInWorkingWindow("2026-04-01T12:00:00.000Z", now), false);
  });

  it("rejects missing receivedAt", () => {
    assert.equal(isTodoInWorkingWindow(null, now), false);
    assert.equal(isTodoInWorkingWindow("  ", now), false);
  });
});

describe("lifecycleStatusForReceivedAt", () => {
  const now = new Date("2026-08-15T16:00:00.000Z");

  it("opens harvests from the working window", () => {
    assert.equal(
      lifecycleStatusForReceivedAt("2026-07-01T00:00:00.000Z", now),
      "open",
    );
  });

  it("marks older harvests stale so they stay off the working list", () => {
    assert.equal(
      lifecycleStatusForReceivedAt("2025-01-01T00:00:00.000Z", now),
      "stale",
    );
  });
});

describe("completedFieldsForLifecycle", () => {
  it("keeps completed in sync for completed and superseded", () => {
    assert.deepEqual(
      completedFieldsForLifecycle("completed", "2026-08-15T16:00:00.000Z"),
      { completed: true, completedAt: "2026-08-15T16:00:00.000Z" },
    );
    assert.deepEqual(
      completedFieldsForLifecycle("superseded", "2026-08-15T16:00:00.000Z"),
      { completed: true, completedAt: "2026-08-15T16:00:00.000Z" },
    );
  });

  it("leaves open, stale, and dismissed incomplete", () => {
    for (const status of ["open", "stale", "dismissed"] as const) {
      assert.deepEqual(
        completedFieldsForLifecycle(status, "2026-08-15T16:00:00.000Z"),
        { completed: false, completedAt: null },
      );
    }
  });
});

describe("working vs archive list membership", () => {
  const now = new Date("2026-08-15T16:00:00.000Z");

  it("keeps meeting and manual rows on the working list", () => {
    assert.equal(isWorkingListTodo("meeting", "2020-01-01T00:00:00.000Z", now), true);
    assert.equal(isWorkingListTodo("manual", null, now), true);
  });

  it("archives email harvests older than the window", () => {
    assert.equal(
      isWorkingListTodo("email", "2026-04-01T00:00:00.000Z", now),
      false,
    );
    assert.equal(
      isWorkingListTodo("email", "2026-07-01T00:00:00.000Z", now),
      true,
    );
  });

  it("treats open and stale as unresolved for close-out", () => {
    assert.equal(isUnresolvedTodoLifecycle("open"), true);
    assert.equal(isUnresolvedTodoLifecycle("stale"), true);
    assert.equal(isUnresolvedTodoLifecycle("completed"), false);
    assert.equal(isUnresolvedTodoLifecycle("superseded"), false);
  });
});

describe("isTodoLifecycleStatus", () => {
  it("accepts the five product statuses", () => {
    for (const status of [
      "open",
      "completed",
      "superseded",
      "stale",
      "dismissed",
    ]) {
      assert.equal(isTodoLifecycleStatus(status), true);
    }
  });

  it("rejects unknown values", () => {
    assert.equal(isTodoLifecycleStatus("archived"), false);
    assert.equal(isTodoLifecycleStatus(null), false);
  });
});

describe("parseTodoHighlightJson", () => {
  it("reads a to-do-only harvest without requiring other domains", () => {
    const extraction = parseTodoHighlightJson(
      JSON.stringify({
        action_items: [
          {
            assignee: "Management",
            task: "Send the AGM package to owners",
            deadline: "2026-08-20",
            source_quote: "please send the AGM package",
          },
        ],
      }),
    );
    assert.equal(extraction.action_items.length, 1);
    assert.equal(extraction.action_items[0]?.assignee, "Management");
    assert.equal(
      extraction.action_items[0]?.task,
      "Send the AGM package to owners",
    );
  });

  it("drops items without a task", () => {
    const extraction = parseTodoHighlightJson(
      JSON.stringify({
        action_items: [{ assignee: "Board", task: "  " }],
      }),
    );
    assert.equal(extraction.action_items.length, 0);
  });
});

describe("todo close-out plumbing", () => {
  it("treats harvest extraction_sources as analyzed even without emails.processedAt", () => {
    assert.equal(
      isEmailInTodoReconciliationScope({
        emailId: "e1",
        processedAt: null,
        hasExtractionSource: true,
      }),
      true,
    );
    assert.equal(
      isEmailInTodoReconciliationScope({
        emailId: "e1",
        processedAt: null,
        hasExtractionSource: false,
      }),
      false,
    );
    assert.equal(
      isEmailInTodoReconciliationScope({
        emailId: "e1",
        processedAt: null,
        hasExtractionSource: false,
        analyzedEmailId: "e1",
      }),
      true,
    );
  });

  it("routes DeepSeek model names away from the Gemini client", () => {
    assert.equal(isDeepSeekModelName("deepseek-v4-flash"), true);
    assert.equal(isDeepSeekModelName("gemini-2.5-flash"), false);
  });

  it("honors an explicit empty insert_items list instead of reinserting the batch", () => {
    const parsed = parseSemanticActionItemDedupResult({
      insert_items: [],
      supersede_open_ids: ["open-1"],
    });
    assert.equal(parsed.insertItemsSpecified, true);
    assert.deepEqual(
      resolveSemanticDedupInsertItems(parsed, [
        { assignee: "Board", task: "Approve the maglock project" },
      ]),
      [],
    );
  });

  it("falls back to the incoming batch when insert_items is omitted", () => {
    const incoming = [
      { assignee: "Board", task: "Approve the maglock project" },
    ];
    const parsed = parseSemanticActionItemDedupResult({
      supersede_open_ids: [],
    });
    assert.equal(parsed.insertItemsSpecified, false);
    assert.deepEqual(resolveSemanticDedupInsertItems(parsed, incoming), incoming);
  });
});
