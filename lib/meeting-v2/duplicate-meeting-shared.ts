import type { AgendaApprovalSettings } from "@/lib/meeting-v2/extraction-diagnostics";

export const MEETING_V2_DUPLICATE_NOT_READY_MESSAGE =
  "Duplicate is available after the agenda has been generated. This meeting has not reached agenda review yet.";

export function meetingV2CanDuplicateToAgendaApproval(agendaItemCount: number): boolean {
  return agendaItemCount > 0;
}

export function rewriteMeetingScopedPath(
  storedPath: string | null | undefined,
  sourceMeetingId: string,
  destMeetingId: string,
): string | null {
  if (!storedPath) return storedPath ?? null;
  const posix = storedPath.replaceAll("\\", "/");
  const needle = `uploads/${sourceMeetingId}`;
  const index = posix.indexOf(needle);
  if (index === -1) return posix;
  const after = posix.slice(index + needle.length);
  if (after !== "" && !after.startsWith("/")) return posix;
  return `${posix.slice(0, index)}uploads/${destMeetingId}${after}`;
}

export function remapCopiedMeetingText(
  value: string | null | undefined,
  replacements: ReadonlyArray<readonly [string, string]>,
): string | null {
  if (value == null) return null;
  let next = value;
  for (const [from, to] of replacements) {
    if (from && from !== to) next = next.split(from).join(to);
  }
  return next;
}

export function buildDuplicatedAgendaApproval(
  source: AgendaApprovalSettings | undefined,
  agendaItemIdMap: Map<string, string>,
): AgendaApprovalSettings {
  const itemStatuses: NonNullable<AgendaApprovalSettings["itemStatuses"]> = {};
  for (const [oldId, status] of Object.entries(source?.itemStatuses ?? {})) {
    const nextId = agendaItemIdMap.get(oldId);
    if (nextId) itemStatuses[nextId] = status;
  }
  const excludedItemIds = (source?.excludedItemIds ?? [])
    .map((id) => agendaItemIdMap.get(id))
    .filter((id): id is string => Boolean(id));

  return {
    status: "pending_review",
    approvedAt: null,
    itemStatuses,
    excludedItemIds: excludedItemIds.length > 0 ? excludedItemIds : undefined,
    discrepancies: source?.discrepancies ?? [],
  };
}
