/**
 * Display helpers for mention resolution_reason codes (client-safe).
 * Badge text is the stored code; the label is for tooltips / titles.
 */

export function formatResolutionReasonCode(
  reason: string | null | undefined,
): string | null {
  const trimmed = reason?.trim();
  return trimmed ? trimmed : null;
}

/** Human label for a stored resolution_reason. Unknown codes stay readable. */
export function resolutionReasonLabel(
  reason: string | null | undefined,
): string | null {
  const code = formatResolutionReasonCode(reason);
  if (!code) return null;
  const known: Record<string, string> = {
    exact_key_email: "Matched a known email address",
    exact_key_phone: "Matched a known phone number",
    thread_participant: "Unique matching person on To/From",
    thread_participant_ambiguous: "Several matching people on To/From",
    unique_first_last: "Unique first + last name",
    first_last_ambiguous: "Several people share that full name",
    unique_name_in_subject: "Unique full name already in the subject",
    subject_name_ambiguous: "Several people match the subject name",
    unique_first_plus_org_provisional: "Unique first name + org (provisional)",
    unique_first_plus_org_thin: "First + org match is too thinly mentioned",
    first_plus_org_ambiguous: "Several people share that first name + org",
    unique_first_name_provisional: "Unique well-known first name (provisional)",
    unique_first_name_thin: "First-name match is too thinly mentioned",
    first_name_ambiguous: "Several people share that first name",
    manual_attach: "Attached by hand",
    retracted_uniqueness_broken: "Provisional link taken back",
    unique_identity_key: "Unique project identity key",
    identity_key_ambiguous: "Several projects share that identity key",
    unique_name_or_alias: "Unique exact name or alias",
    name_ambiguous: "Several projects share that name/alias",
    unique_work_name_provisional: "Unique work-name match (provisional)",
    work_name_ambiguous: "Several work-name matches",
    year_mismatch: "Name matches but years do not overlap",
    insufficient: "Not enough to attach",
  };
  if (known[code]) return known[code];
  return code.replace(/_/g, " ");
}
