/** Schema for AI merge of meeting todos into the global board checklist. */

export type GlobalTodoMergeItem = {
  assignee: string;
  role: string;
  description: string;
  deadline: string | null;
  completed: boolean;
  /** Optional note explaining why this item was added or updated. */
  merge_note?: string;
};

export type GlobalTodosMergeResult = {
  schema_version: "global_todos_merge_v1";
  analyzed_at: string;
  todos: GlobalTodoMergeItem[];
  changes_summary: {
    added: number;
    updated: number;
    unchanged: number;
    deduplicated: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return readString(value);
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseMergeItem(raw: unknown): GlobalTodoMergeItem | null {
  if (!isRecord(raw)) return null;

  const assignee = readString(raw.assignee);
  const role = readString(raw.role);
  const description = readString(raw.description);
  if (!assignee || !description) return null;

  const mergeNote = readOptionalString(raw.merge_note);

  return {
    assignee,
    role: role ?? "Board member",
    description,
    deadline: readOptionalString(raw.deadline),
    completed: readBoolean(raw.completed),
    ...(mergeNote ? { merge_note: mergeNote } : {}),
  };
}

export function validateGlobalTodosMergeResult(
  raw: unknown,
): { ok: true; result: GlobalTodosMergeResult } | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: "Merge response must be a JSON object." };
  }

  if (raw.schema_version !== "global_todos_merge_v1") {
    return { ok: false, error: "Unexpected schema_version in merge response." };
  }

  const analyzedAt = readString(raw.analyzed_at);
  if (!analyzedAt) {
    return { ok: false, error: "Merge response missing analyzed_at." };
  }

  if (!Array.isArray(raw.todos)) {
    return { ok: false, error: "Merge response missing todos array." };
  }

  const todos: GlobalTodoMergeItem[] = [];
  for (const item of raw.todos) {
    const parsed = parseMergeItem(item);
    if (!parsed) {
      return { ok: false, error: "Invalid todo item in merge response." };
    }
    todos.push(parsed);
  }

  const summaryRaw = isRecord(raw.changes_summary) ? raw.changes_summary : {};

  return {
    ok: true,
    result: {
      schema_version: "global_todos_merge_v1",
      analyzed_at: analyzedAt,
      todos,
      changes_summary: {
        added: readNumber(summaryRaw.added),
        updated: readNumber(summaryRaw.updated),
        unchanged: readNumber(summaryRaw.unchanged),
        deduplicated: readNumber(summaryRaw.deduplicated),
      },
    },
  };
}
