/** Parse constitution-style grouped todos into rows for SQLite. */

export type ParsedTodo = {
  assignee: string;
  role: string;
  description: string;
  deadline: string | null;
};

const HEADING_LINE = /^###\s+\[?(.+?)\]?\s*-\s+\[?(.+?)\]?\s*$/;
const SIMPLE_HEADING = /^###\s+\[?([^\]\n]+)\]?\s*$/;

/**
 * Parses markdown with blocks:
 * ### [Name] - [Role]
 * - [ ] Task text (deadline: foo)
 */
export function parseTodosMarkdown(md: string): ParsedTodo[] {
  const todos: ParsedTodo[] = [];
  let assignee = "Unknown";
  let role = "";

  const lines = md.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    if (line.startsWith("###")) {
      const full = HEADING_LINE.exec(line);
      if (full) {
        assignee = full[1].trim();
        role = full[2].trim();
        continue;
      }
      const simple = SIMPLE_HEADING.exec(line);
      if (simple) {
        assignee = simple[1].trim();
        role = "";
        continue;
      }
    }

    const item = /^-\s*\[\s?(?:x|X)?\s?\]\s+(.+)/.exec(line);
    if (item) {
      let desc = item[1].trim();

      let deadline: string | null = null;

      const deadlineColon = /\b[Dd]eadline:\s*([^\n.]+)/.exec(desc);
      const isoMatch =
        /\b(20\d{2}-\d{2}-\d{2})\b/.exec(desc) ||
        /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/.exec(desc);
      const byMatch =
        /\b(by|before)\s+\d{1,2}\s+[A-Za-z]{3,9}(?:\.?)\s*\d{2,4}\b/i.exec(desc);

      if (deadlineColon?.[1]) deadline = deadlineColon[1].trim();
      else if (byMatch?.[0]) deadline = byMatch[0].trim();
      else if (isoMatch?.[1]) deadline = isoMatch[1].trim();

      if (deadlineColon) {
        desc = desc.replace(deadlineColon[0], "").trim();
      }

      todos.push({
        assignee,
        role: role || "Board member",
        description: desc,
        deadline,
      });
    }
  }

  return todos;
}

/** Serialize parsed todos back to constitution-style markdown. */
export function serializeTodosMarkdown(
  todos: ParsedTodo[],
  options?: { completed?: Set<string> },
): string {
  if (!todos.length) return "";

  const groups = new Map<string, ParsedTodo[]>();
  for (const todo of todos) {
    const key = `${todo.assignee}|${todo.role}`;
    const arr = groups.get(key) ?? [];
    arr.push(todo);
    groups.set(key, arr);
  }

  const lines: string[] = [];
  for (const [key, items] of groups) {
    const [assignee, role] = key.split("|");
    lines.push(`### ${assignee} - ${role}`);
    for (const item of items) {
      const descKey = `${item.assignee}|${item.description}`;
      const checked = options?.completed?.has(descKey) ?? false;
      const deadlineSuffix = item.deadline
        ? ` (deadline: ${item.deadline})`
        : "";
      lines.push(`- [${checked ? "x" : " "}] ${item.description}${deadlineSuffix}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}
