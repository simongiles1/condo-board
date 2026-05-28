import type { ActionItemV2 } from "@/lib/minutes/schema-v2";

function stripTrailingPunct(text: string): string {
  return text.trim().replace(/[.;]+$/, "");
}

/** Join two task_description fragments for the same assignee into one sentence. */
export function combineTaskDescriptions(a: string, b: string): string {
  const ta = stripTrailingPunct(a);
  const tb = stripTrailingPunct(b);
  if (!ta) return tb;
  if (!tb) return ta;
  if (ta.toLowerCase() === tb.toLowerCase()) return ta;

  const directedRe = /^is directed to\s+/i;
  if (directedRe.test(ta) && directedRe.test(tb)) {
    return `is directed to ${ta.replace(directedRe, "")} and ${tb.replace(directedRe, "")}`;
  }

  const willRe = /^will\s+/i;
  if (willRe.test(ta) && willRe.test(tb)) {
    return `will ${ta.replace(willRe, "")} and ${tb.replace(willRe, "")}`;
  }

  if (/^to\s+/i.test(ta) && /^to\s+/i.test(tb)) {
    return `to ${ta.replace(/^to\s+/i, "")} and ${tb.replace(/^to\s+/i, "")}`;
  }

  return `${ta} and ${tb}`;
}

/** One action item per assignee — multiple duties combined with "and". */
export function consolidateActionItemsByAssignee(
  items: ActionItemV2[],
): ActionItemV2[] {
  const byAssignee = new Map<string, ActionItemV2>();

  for (const item of items) {
    const assignee = item.assignee.trim();
    const taskDescription = stripTrailingPunct(item.taskDescription);
    if (!assignee || !taskDescription) continue;

    const key = assignee.toLowerCase();
    const existing = byAssignee.get(key);
    if (!existing) {
      byAssignee.set(key, { assignee, taskDescription });
      continue;
    }

    byAssignee.set(key, {
      assignee: existing.assignee,
      taskDescription: combineTaskDescriptions(
        existing.taskDescription,
        taskDescription,
      ),
    });
  }

  return Array.from(byAssignee.values());
}
