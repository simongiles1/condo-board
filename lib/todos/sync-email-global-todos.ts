/**
 * Mirror open email harvests onto the single board checklist (global_todos).
 * Harvest JSON stays on the email. Stale history does not appear here.
 */

import { randomUUID } from "crypto";

import { inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { globalTodos } from "@/lib/db/schema";

export const EMAIL_GLOBAL_TODO_ROLE = "Email";

export type EmailGlobalTodoInput = {
  extractedActionItemId: string;
  assignee: string;
  description: string;
  deadline: string | null;
};

export async function upsertEmailGlobalTodos(
  items: EmailGlobalTodoInput[],
): Promise<void> {
  if (!items.length) return;

  const db = getDb();
  const now = new Date().toISOString();

  for (const item of items) {
    const assignee = item.assignee.trim() || "Unassigned";
    const description = item.description.trim();
    if (!description) continue;

    await db
      .insert(globalTodos)
      .values({
        id: randomUUID(),
        assignee,
        role: EMAIL_GLOBAL_TODO_ROLE,
        description,
        deadline: item.deadline,
        completed: false,
        completedAt: null,
        sourceMeetingId: null,
        sourceKind: "email",
        sourceExtractedActionItemId: item.extractedActionItemId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: globalTodos.sourceExtractedActionItemId,
        set: {
          assignee,
          description,
          deadline: item.deadline,
          updatedAt: now,
        },
      });
  }
}

export async function markEmailGlobalTodosCompleted(
  extractedActionItemIds: string[],
  completedAt: string,
): Promise<void> {
  const ids = [...new Set(extractedActionItemIds.filter(Boolean))];
  if (!ids.length) return;

  const db = getDb();
  await db
    .update(globalTodos)
    .set({
      completed: true,
      completedAt,
      updatedAt: completedAt,
    })
    .where(inArray(globalTodos.sourceExtractedActionItemId, ids));
}

export async function reopenEmailGlobalTodos(
  extractedActionItemIds: string[],
): Promise<void> {
  const ids = [...new Set(extractedActionItemIds.filter(Boolean))];
  if (!ids.length) return;

  const db = getDb();
  const now = new Date().toISOString();
  await db
    .update(globalTodos)
    .set({
      completed: false,
      completedAt: null,
      updatedAt: now,
    })
    .where(inArray(globalTodos.sourceExtractedActionItemId, ids));
}
