import { randomUUID } from "crypto";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  emails,
  extractedActionItems,
  extractionSources,
  globalTodos,
  meetings,
} from "@/lib/db/schema";
import { parseTodosMarkdown, serializeTodosMarkdown } from "@/lib/todos-parser";

import type { GlobalTodoMergeItem } from "./merge-global-schema";

export type GlobalTodoSourceKind = "meeting" | "email" | "manual";

export type GlobalTodoRow = {
  id: string;
  assignee: string;
  role: string;
  description: string;
  deadline: string | null;
  completed: boolean;
  completedAt: string | null;
  sourceMeetingId: string | null;
  sourceKind: GlobalTodoSourceKind;
  sourceExtractedActionItemId: string | null;
  sourceMeetingTitle: string | null;
  sourceMeetingDate: string | null;
  sourceEmailId: string | null;
  sourceEmailThreadId: string | null;
  sourceEmailReceivedAt: string | null;
  sourceQuote: string | null;
  createdAt: string;
  updatedAt: string;
};

export function isMeetingGlobalTodoSource(
  kind: string | null | undefined,
): boolean {
  return kind !== "email" && kind !== "manual";
}

function normalizeKey(assignee: string, description: string): string {
  return `${assignee.trim().toLowerCase()}|${description.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

export async function fetchGlobalTodoRows(): Promise<GlobalTodoRow[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: globalTodos.id,
      assignee: globalTodos.assignee,
      role: globalTodos.role,
      description: globalTodos.description,
      deadline: globalTodos.deadline,
      completed: globalTodos.completed,
      completedAt: globalTodos.completedAt,
      sourceMeetingId: globalTodos.sourceMeetingId,
      sourceKind: globalTodos.sourceKind,
      sourceExtractedActionItemId: globalTodos.sourceExtractedActionItemId,
      sourceMeetingTitle: meetings.title,
      sourceMeetingDate: meetings.meetingDate,
      sourceEmailId: emails.id,
      sourceEmailThreadId: emails.threadId,
      sourceEmailReceivedAt: emails.receivedAt,
      actionItemThreadId: extractedActionItems.emailThreadId,
      extractionThreadId: extractionSources.emailThreadId,
      sourceQuote: extractedActionItems.sourceQuote,
      createdAt: globalTodos.createdAt,
      updatedAt: globalTodos.updatedAt,
    })
    .from(globalTodos)
    .leftJoin(meetings, eq(globalTodos.sourceMeetingId, meetings.id))
    .leftJoin(
      extractedActionItems,
      eq(globalTodos.sourceExtractedActionItemId, extractedActionItems.id),
    )
    .leftJoin(
      extractionSources,
      eq(extractedActionItems.sourceId, extractionSources.id),
    )
    .leftJoin(
      emails,
      and(
        eq(extractionSources.sourceId, emails.id),
        eq(extractionSources.sourceType, "email_message"),
      ),
    )
    .orderBy(globalTodos.assignee, globalTodos.role, globalTodos.createdAt);

  return rows.map((row) => ({
    id: row.id,
    assignee: row.assignee,
    role: row.role,
    description: row.description,
    deadline: row.deadline,
    completed: row.completed,
    completedAt: row.completedAt,
    sourceMeetingId: row.sourceMeetingId,
    sourceKind: row.sourceKind,
    sourceExtractedActionItemId: row.sourceExtractedActionItemId,
    sourceMeetingTitle: row.sourceMeetingTitle ?? null,
    sourceMeetingDate: row.sourceMeetingDate ?? null,
    sourceEmailId: row.sourceEmailId ?? null,
    sourceEmailThreadId:
      row.sourceEmailThreadId ??
      row.actionItemThreadId ??
      row.extractionThreadId ??
      null,
    sourceEmailReceivedAt: row.sourceEmailReceivedAt ?? null,
    sourceQuote: row.sourceQuote ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export function globalTodosToMarkdown(rows: GlobalTodoRow[]): string {
  const meetingRows = rows.filter((row) =>
    isMeetingGlobalTodoSource(row.sourceKind),
  );
  const parsed = meetingRows.map((row) => ({
    assignee: row.assignee,
    role: row.role,
    description: row.description,
    deadline: row.deadline,
  }));

  const completed = new Set<string>();
  for (const row of meetingRows) {
    if (row.completed) {
      completed.add(`${row.assignee}|${row.description}`);
    }
  }

  return serializeTodosMarkdown(parsed, { completed });
}

export function buildGlobalTodosMergePrompt(options: {
  globalMarkdown: string;
  meetingTitle: string;
  meetingDate: string;
  meetingTodosMarkdown: string;
}): string {
  return `Meeting being merged: ${options.meetingTitle}
Meeting date: ${options.meetingDate}

CURRENT GLOBAL TO-DO LIST (board-wide master checklist)
<<<
${options.globalMarkdown.slice(0, 80000) || "(empty — no global todos yet)"}
>>>

MEETING TO-DO LIST (new items to merge in)
<<<
${options.meetingTodosMarkdown.slice(0, 80000)}
>>>`;
}

export function applyGlobalTodosMerge(options: {
  existing: GlobalTodoRow[];
  merged: GlobalTodoMergeItem[];
  sourceMeetingId: string;
}): { rows: typeof globalTodos.$inferInsert[]; summary: string } {
  const now = new Date().toISOString();

  const completedByKey = new Map<string, { completedAt: string | null }>();
  for (const row of options.existing) {
    if (row.completed) {
      completedByKey.set(normalizeKey(row.assignee, row.description), {
        completedAt: row.completedAt,
      });
    }
  }

  const rows: typeof globalTodos.$inferInsert[] = options.merged.map((item) => {
    const key = normalizeKey(item.assignee, item.description);
    const priorCompleted = completedByKey.get(key);
    const completed = item.completed || Boolean(priorCompleted);
    const completedAt = completed
      ? priorCompleted?.completedAt ?? now
      : null;

    return {
      id: randomUUID(),
      assignee: item.assignee,
      role: item.role,
      description: item.description,
      deadline: item.deadline,
      completed,
      completedAt,
      sourceMeetingId: options.sourceMeetingId,
      sourceKind: "meeting",
      sourceExtractedActionItemId: null,
      createdAt: now,
      updatedAt: now,
    };
  });

  return { rows, summary: `${rows.length} global todo(s) after merge.` };
}

export async function persistGlobalTodosMerge(options: {
  existing: GlobalTodoRow[];
  merged: GlobalTodoMergeItem[];
  sourceMeetingId: string;
}): Promise<{ count: number }> {
  const db = getDb();
  const { rows } = applyGlobalTodosMerge(options);

  await db.transaction(async (tx) => {
    await tx
      .delete(globalTodos)
      .where(eq(globalTodos.sourceKind, "meeting"));
    if (rows.length) {
      await tx.insert(globalTodos).values(rows);
    }
  });

  return { count: rows.length };
}

/** Parse meeting todos markdown for merge input validation. */
export function parseMeetingTodosForMerge(markdown: string) {
  return parseTodosMarkdown(markdown);
}
