export const DEV_NOTE_STATUSES = [
  "open",
  "closed",
  "in_progress",
  "deferred",
] as const;

export type DevNoteStatus = (typeof DEV_NOTE_STATUSES)[number];

export const DEV_NOTE_STATUS_LABELS: Record<DevNoteStatus, string> = {
  open: "Open",
  closed: "Closed",
  in_progress: "In progress",
  deferred: "Deferred",
};

export function parseDevNoteStatus(value: unknown): DevNoteStatus | null {
  if (typeof value !== "string") return null;
  return DEV_NOTE_STATUSES.includes(value as DevNoteStatus)
    ? (value as DevNoteStatus)
    : null;
}
