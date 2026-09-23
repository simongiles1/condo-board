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
    label: "Haider Mukadam",
    email: "studiopm@iccpropertymanagement.com",
  },
];

/** Default timeline selection (Bonnie only). */
export const DEFAULT_EMAIL_TIMELINE_SENDER_IDS = ["bonnie"];

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
