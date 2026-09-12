const MEETING_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Sort key for meeting dates stored as `YYYY-MM-DD` (calendar order, not UTC). */
export function meetingDateSortKey(isoDate: string): number {
  const match = MEETING_DATE_ONLY_RE.exec(isoDate.trim());
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return year * 10_000 + month * 100 + day;
  }
  const parsed = new Date(isoDate).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Display `YYYY-MM-DD` as e.g. "May 19, 2026". Falls back to the input on parse failure. */
export function formatMeetingDate(isoDate: string): string {
  const match = MEETING_DATE_ONLY_RE.exec(isoDate.trim());
  if (!match) return isoDate;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return isoDate;
  }

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
