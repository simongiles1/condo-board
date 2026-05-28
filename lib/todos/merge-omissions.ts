import type { TodoOmissionFinding } from "@/lib/minutes/omissions-schema";

const HEADING_LINE = /^###\s+\[?(.+?)\]?\s*-\s+\[?(.+?)\]?\s*$/;
const SIMPLE_HEADING = /^###\s+\[?([^\]\n]+)\]?\s*$/;
const CHECKBOX_LINE = /^-\s*\[\s?(?:x|X)?\s?\]\s+(.+)$/;

function formatHeading(assignee: string, role: string): string {
  const name = assignee.trim();
  const rolePart = role.trim();
  return rolePart ? `### [${name}] - [${rolePart}]` : `### [${name}]`;
}

function formatTaskLine(description: string, deadline?: string | null): string {
  const desc = description.trim();
  if (!desc) return "";
  const dl = deadline?.trim();
  if (dl) {
    return `- [ ] ${desc} (deadline: ${dl})`;
  }
  return `- [ ] ${desc}`;
}

function normalizeAssigneeKey(name: string): string {
  return name.trim().toLowerCase();
}

function findAssigneeSection(
  lines: string[],
  assignee: string,
): { headingIndex: number; taskLineIndices: number[] } | null {
  const key = normalizeAssigneeKey(assignee);
  let headingIndex = -1;
  const taskLineIndices: number[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith("###")) continue;

    const full = HEADING_LINE.exec(line);
    const simple = SIMPLE_HEADING.exec(line);
    const headingName = (full?.[1] ?? simple?.[1] ?? "").trim();
    if (normalizeAssigneeKey(headingName) !== key) continue;

    headingIndex = i;
    taskLineIndices.length = 0;

    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (next.startsWith("###")) break;
      if (CHECKBOX_LINE.test(next.trim())) {
        taskLineIndices.push(j);
      }
    }
    return { headingIndex, taskLineIndices };
  }

  return headingIndex >= 0 ? { headingIndex, taskLineIndices } : null;
}

function mergeTaskDescriptions(existing: string, addition: string): string {
  const a = existing.trim();
  const b = addition.trim();
  if (!a) return b;
  if (!b) return a;
  if (a.toLowerCase().includes(b.toLowerCase())) return a;
  if (b.toLowerCase().includes(a.toLowerCase())) return b;
  return `${a} and ${b}`;
}

function applyFinding(lines: string[], finding: TodoOmissionFinding): string[] {
  const next = [...lines];
  const section = findAssigneeSection(next, finding.assignee);

  if (finding.mergeAction === "augment_existing") {
    const index = finding.existingTaskIndex;
    if (!section || index === undefined || index < 0) {
      return applyFinding(lines, { ...finding, mergeAction: "insert_new" });
    }
    const taskIdx = section.taskLineIndices[index];
    if (taskIdx === undefined) {
      return applyFinding(lines, { ...finding, mergeAction: "insert_new" });
    }

    const match = CHECKBOX_LINE.exec(next[taskIdx].trim());
    if (!match) return next;

    const merged = mergeTaskDescriptions(match[1], finding.taskDescription);
    next[taskIdx] = formatTaskLine(merged, finding.deadline);
    return next;
  }

  const newLine = formatTaskLine(finding.taskDescription, finding.deadline);
  if (!newLine) return next;

  if (section) {
    const insertAt =
      section.taskLineIndices.length > 0
        ? section.taskLineIndices[section.taskLineIndices.length - 1] + 1
        : section.headingIndex + 1;
    next.splice(insertAt, 0, newLine);
    return next;
  }

  const heading = formatHeading(finding.assignee, finding.role);
  const trimmed = next.join("\n").trimEnd();
  const block = trimmed ? `${trimmed}\n\n${heading}\n${newLine}` : `${heading}\n${newLine}`;
  return block.split(/\r?\n/);
}

/** Merge selected todo omission findings into constitution-style todos markdown. */
export function applyTodosOmissionsToMarkdown(
  markdown: string,
  findings: TodoOmissionFinding[],
): string | null {
  if (!findings.length) return markdown;

  let lines = markdown.split(/\r?\n/);
  for (const finding of findings) {
    lines = applyFinding(lines, finding);
  }

  return lines.join("\n").trimEnd() + (lines.length ? "\n" : "");
}
