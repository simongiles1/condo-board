import { and, eq, gte, lt } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  emails,
  extractedActionItems,
  extractionSources,
} from "@/lib/db/schema";
import { todoWorkingWindowCutoffIso } from "@/lib/email-analysis/todo-lifecycle";
import { EMAIL_GLOBAL_TODO_ROLE } from "@/lib/todos/sync-email-global-todos";

export type WorkingEmailActionItem = {
  id: string;
  assignee: string;
  description: string;
  deadline: string | null;
  sourceId: string;
  createdAt: string;
  receivedAt: string;
};

/**
 * Open email to-dos whose source message is inside the working window.
 * Older harvests stay in extracted_action_items as stale / completed.
 */
export async function loadWorkingEmailActionItems(
  now = new Date(),
): Promise<WorkingEmailActionItem[]> {
  const db = getDb();
  const cutoff = todoWorkingWindowCutoffIso(now);
  return db
    .select({
      id: extractedActionItems.id,
      assignee: extractedActionItems.assignee,
      description: extractedActionItems.description,
      deadline: extractedActionItems.deadline,
      sourceId: extractedActionItems.sourceId,
      createdAt: extractedActionItems.createdAt,
      receivedAt: emails.receivedAt,
    })
    .from(extractedActionItems)
    .innerJoin(
      extractionSources,
      eq(extractedActionItems.sourceId, extractionSources.id),
    )
    .innerJoin(emails, eq(extractionSources.sourceId, emails.id))
    .where(
      and(
        eq(extractedActionItems.lifecycleStatus, "open"),
        eq(extractedActionItems.completed, false),
        gte(emails.receivedAt, cutoff),
      ),
    );
}

export type ArchivedEmailTodoRow = {
  id: string;
  assignee: string;
  role: string;
  description: string;
  deadline: string | null;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
  sourceKind: "email";
  sourceMeetingTitle: null;
  sourceMeetingDate: null;
  sourceEmailId: string;
  sourceEmailThreadId: string | null;
  sourceEmailReceivedAt: string;
  sourceQuote: string | null;
};

/**
 * Email harvests whose source message is older than the working window.
 * Includes still-open (stale) asks and items thread close-out already closed.
 */
export async function loadArchivedEmailTodos(
  now = new Date(),
): Promise<ArchivedEmailTodoRow[]> {
  const db = getDb();
  const cutoff = todoWorkingWindowCutoffIso(now);
  const rows = await db
    .select({
      id: extractedActionItems.id,
      assignee: extractedActionItems.assignee,
      description: extractedActionItems.description,
      deadline: extractedActionItems.deadline,
      completed: extractedActionItems.completed,
      completedAt: extractedActionItems.completedAt,
      createdAt: extractedActionItems.createdAt,
      sourceQuote: extractedActionItems.sourceQuote,
      sourceEmailId: emails.id,
      sourceEmailThreadId: emails.threadId,
      sourceEmailReceivedAt: emails.receivedAt,
      actionItemThreadId: extractedActionItems.emailThreadId,
    })
    .from(extractedActionItems)
    .innerJoin(
      extractionSources,
      eq(extractedActionItems.sourceId, extractionSources.id),
    )
    .innerJoin(emails, eq(extractionSources.sourceId, emails.id))
    .where(
      and(
        eq(extractionSources.sourceType, "email_message"),
        lt(emails.receivedAt, cutoff),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    assignee: row.assignee,
    role: EMAIL_GLOBAL_TODO_ROLE,
    description: row.description,
    deadline: row.deadline,
    completed: row.completed,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    sourceKind: "email",
    sourceMeetingTitle: null,
    sourceMeetingDate: null,
    sourceEmailId: row.sourceEmailId,
    sourceEmailThreadId: row.sourceEmailThreadId ?? row.actionItemThreadId,
    sourceEmailReceivedAt: row.sourceEmailReceivedAt,
    sourceQuote: row.sourceQuote,
  }));
}
