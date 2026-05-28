import { randomUUID } from "crypto";

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { globalTodos, meetings } from "@/lib/db/schema";
import { parseTodosMarkdown, serializeTodosMarkdown } from "@/lib/todos-parser";

import type { GlobalTodoMergeItem } from "./merge-global-schema";

export type GlobalTodoRow = {
  id: string;
  assignee: string;
  role: string;
  description: string;
  deadline: string | null;
  completed: boolean;
  completedAt: string | null;
  sourceMeetingId: string | null;
  sourceMeetingTitle: string | null;
  sourceMeetingDate: string | null;
  createdAt: string;
  updatedAt: string;
};

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
      sourceMeetingTitle: meetings.title,
      sourceMeetingDate: meetings.meetingDate,
      createdAt: globalTodos.createdAt,
      updatedAt: globalTodos.updatedAt,
    })
    .from(globalTodos)
    .leftJoin(meetings, eq(globalTodos.sourceMeetingId, meetings.id))
    .orderBy(globalTodos.assignee, globalTodos.role, globalTodos.createdAt);

  return rows.map((row) => ({
    ...row,
    sourceMeetingTitle: row.sourceMeetingTitle ?? null,
    sourceMeetingDate: row.sourceMeetingDate ?? null,
  }));
}

export function globalTodosToMarkdown(rows: GlobalTodoRow[]): string {
  const parsed = rows.map((row) => ({
    assignee: row.assignee,
    role: row.role,
    description: row.description,
    deadline: row.deadline,
  }));

  const completed = new Set<string>();
  for (const row of rows) {
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
    await tx.delete(globalTodos);
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
