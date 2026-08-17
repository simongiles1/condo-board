/**
 * Working-list vs archive for email to-dos.
 *
 * Harvest stores every ask. The working list only shows items whose source
 * email is inside the working window. Older harvests are `stale` until
 * thread close-out marks them completed/superseded; they live on Archive.
 */

export const TODO_WORKING_WINDOW_DAYS = 120;

/** Incomplete harvests eligible for thread close-out (working + archive). */
export const UNRESOLVED_TODO_LIFECYCLE_STATUSES = ["open", "stale"] as const;

export const TODO_LIFECYCLE_STATUSES = [
  "open",
  "completed",
  "superseded",
  "stale",
  "dismissed",
] as const;

export type TodoLifecycleStatus = (typeof TODO_LIFECYCLE_STATUSES)[number];

export function isTodoLifecycleStatus(
  value: string | null | undefined,
): value is TodoLifecycleStatus {
  return (
    typeof value === "string" &&
    (TODO_LIFECYCLE_STATUSES as readonly string[]).includes(value)
  );
}

export function isUnresolvedTodoLifecycle(
  value: string | null | undefined,
): value is (typeof UNRESOLVED_TODO_LIFECYCLE_STATUSES)[number] {
  return (
    typeof value === "string" &&
    (UNRESOLVED_TODO_LIFECYCLE_STATUSES as readonly string[]).includes(value)
  );
}

/** Meeting and manual rows stay on the working list; email uses the window. */
export function isWorkingListTodo(
  sourceKind: string | null | undefined,
  sourceEmailReceivedAt: string | null | undefined,
  now = new Date(),
): boolean {
  if (sourceKind !== "email") return true;
  return isTodoInWorkingWindow(sourceEmailReceivedAt, now);
}

export function todoWorkingWindowCutoffIso(now = new Date()): string {
  return new Date(
    now.getTime() - TODO_WORKING_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export function isTodoInWorkingWindow(
  receivedAt: string | null | undefined,
  now = new Date(),
): boolean {
  const iso = receivedAt?.trim();
  if (!iso) return false;
  return iso >= todoWorkingWindowCutoffIso(now);
}

/** Status to write on persist: recent source email → open, otherwise stale. */
export function lifecycleStatusForReceivedAt(
  receivedAt: string | null | undefined,
  now = new Date(),
): Extract<TodoLifecycleStatus, "open" | "stale"> {
  return isTodoInWorkingWindow(receivedAt, now) ? "open" : "stale";
}

export function completedFieldsForLifecycle(
  status: TodoLifecycleStatus,
  nowIso: string,
): { completed: boolean; completedAt: string | null } {
  if (status === "completed" || status === "superseded") {
    return { completed: true, completedAt: nowIso };
  }
  return { completed: false, completedAt: null };
}
