/** Static boilerplate for the restricted records addendum (s. 55(4)). */

export const RESTRICTED_ADDENDUM_TITLE = "ADDENDUM TO THE MINUTES";

export const RESTRICTED_ADDENDUM_SUBTITLE =
  "RESTRICTED RECORDS (s. 55(4) of the Condominium Act, 1998)";

export const RESTRICTED_ADDENDUM_SECTION_HEADING = "Confidential Matters";

export const RESTRICTED_ADDENDUM_DISCLAIMER =
  "This section of the Minutes does not form a part of the Minutes which are available for owner review under section 55(4) (a-c) of the Condominium Act, 1998, as it relates to specific units or owners, to employees of the Corporation, or to an actual or pending litigation or an insurance investigation.";

/** Split text so "Condominium Act, 1998" can be rendered in italics. */
export function splitCondominiumActPhrase(text: string): string[] {
  return text.split("Condominium Act, 1998");
}

export function markdownItalicizeCondominiumAct(text: string): string {
  return text.replace(/Condominium Act, 1998/g, "*Condominium Act, 1998*");
}
