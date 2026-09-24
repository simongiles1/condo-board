/** Person option for the email volume timeline chart. */
export type EmailTimelineSenderOption = {
  id: string;
  label: string;
  email: string;
};

/** Management contacts available in the email volume timeline filter. */
export const EMAIL_TIMELINE_SENDER_OPTIONS: EmailTimelineSenderOption[] = [
  {
    id: "bonnie",
    label: "Bonnie Kafi",
    email: "bkafi@iccpropertymanagement.com",
  },
  {
    id: "haider",
    label: "Assistant PM",
    email: "studiopm@iccpropertymanagement.com",
  },
  {
    id: "jwilson",
    label: "John Wilson",
    email: "jwilson@iccpropertymanagement.com",
  },
];

/** Default timeline selection (Bonnie only). */
export const DEFAULT_EMAIL_TIMELINE_SENDER_IDS = ["bonnie"];

/** Stacked bar order (first id = bottom segment). */
export const EMAIL_TIMELINE_STACK_ORDER = ["bonnie", "haider", "jwilson"];

const SENDER_CHART_COLORS: Record<string, string> = {
  bonnie: "#0f766e",
  haider: "#c2410c",
  jwilson: "#4f46e5",
};

export type EmailTimelineChartSeries = {
  id: string;
  label: string;
  color: string;
};

/** Multi-person email volume chart bar layout. */
export type EmailTimelineChartLayout = "stacked" | "grouped";

/**
 * Chart series metadata for the selected sender ids (stable stack order).
 */
export function chartSeriesForTimelineSenderIds(
  ids: string[],
): EmailTimelineChartSeries[] {
  const selected = new Set(ids);
  return EMAIL_TIMELINE_STACK_ORDER.filter((id) => selected.has(id)).map(
    (id) => {
      const option = EMAIL_TIMELINE_SENDER_OPTIONS.find(
        (entry) => entry.id === id,
      );
      return {
        id,
        label: option?.label ?? id,
        color: SENDER_CHART_COLORS[id] ?? "#64748b",
      };
    },
  );
}

/**
 * Resolves sender ids to email addresses; unknown ids are skipped.
 */
export function emailsForTimelineSenderIds(ids: string[]): string[] {
  const byId = new Map(
    EMAIL_TIMELINE_SENDER_OPTIONS.map((option) => [option.id, option.email]),
  );
  const emails: string[] = [];
  for (const id of ids) {
    const email = byId.get(id);
    if (email && !emails.includes(email)) emails.push(email);
  }
  return emails;
}
