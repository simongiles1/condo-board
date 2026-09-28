import { meetingDateSortKey } from "@/lib/format-meeting-date";

export type MeetingV2ListSortRow = {
  meetingDate: string;
  createdAt: string;
  title: string;
};

/**
 * Sorts V2 workspace rows for the pipeline table. Same meeting date uses newest `createdAt` first so re-runs and upcoming meetings are not buried under older "Minutes -" titles.
 */
export function compareMeetingsV2ListRows(
  left: MeetingV2ListSortRow,
  right: MeetingV2ListSortRow,
  meetingDateSort: "asc" | "desc",
): number {
  const delta = meetingDateSortKey(left.meetingDate) - meetingDateSortKey(right.meetingDate);
  if (delta !== 0) {
    return meetingDateSort === "asc" ? delta : -delta;
  }

  const createdCmp = left.createdAt.localeCompare(right.createdAt);
  if (createdCmp !== 0) {
    return meetingDateSort === "asc" ? createdCmp : -createdCmp;
  }

  const titleCmp = left.title.localeCompare(right.title, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return meetingDateSort === "asc" ? titleCmp : -titleCmp;
}
