/**
 * Discrete contact-mention resolution (no DB).
 * Order: exact email/phone → unique thread participant → unique first+last
 * → unique full name in the email subject → unique first+org (provisional if
 * well-known) → unique canonical first name (provisional).
 */

import { mentionMatchingFirstNameKey, personMeetsProvisionalPrior } from "@/lib/contacts/mention-shared";

export type MentionResolveCandidate = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  sourceEmailCount: number;
  mentionWeight: number;
};

export type MentionResolveSignals = {
  exactPersonByEmailId: string | null;
  exactPersonByPhoneId: string | null;
  participantMatches: MentionResolveCandidate[];
  firstLastMatches?: MentionResolveCandidate[];
  subjectNameMatches?: MentionResolveCandidate[];
  firstOrgMatches: MentionResolveCandidate[];
  firstNameCanonicalMatches: MentionResolveCandidate[];
};

function normalizeNameHaystack(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the person's first + last appear as a phrase in the subject. */
export function personFullNameAppearsInSubject(params: {
  firstName: string | null;
  lastName: string | null;
  subject: string | null;
}): boolean {
  const first = mentionMatchingFirstNameKey(params.firstName);
  const last = params.lastName
    ? normalizeNameHaystack(params.lastName)
    : "";
  const subject = params.subject?.trim();
  if (!first || last.length < 2 || !subject) return false;
  const hay = normalizeNameHaystack(subject);
  if (!hay) return false;
  return hay.includes(`${first} ${last}`) || hay.includes(`${last} ${first}`);
}

export type MentionResolveDecision = {
  status: "unresolved" | "provisional" | "confirmed";
  personId: string | null;
  reason: string;
};

function uniqueCandidate(
  matches: MentionResolveCandidate[],
): MentionResolveCandidate | null {
  if (matches.length !== 1) return null;
  return matches[0] ?? null;
}

export function decideContactMentionResolution(
  signals: MentionResolveSignals,
): MentionResolveDecision {
  if (signals.exactPersonByEmailId) {
    return {
      status: "confirmed",
      personId: signals.exactPersonByEmailId,
      reason: "exact_key_email",
    };
  }
  if (signals.exactPersonByPhoneId) {
    return {
      status: "confirmed",
      personId: signals.exactPersonByPhoneId,
      reason: "exact_key_phone",
    };
  }

  const participant = uniqueCandidate(signals.participantMatches);
  if (participant) {
    return {
      status: "confirmed",
      personId: participant.id,
      reason: "thread_participant",
    };
  }
  if (signals.participantMatches.length > 1) {
    return {
      status: "unresolved",
      personId: null,
      reason: "thread_participant_ambiguous",
    };
  }

  const firstLastMatches = signals.firstLastMatches ?? [];
  const firstLast = uniqueCandidate(firstLastMatches);
  if (firstLast) {
    return {
      status: "confirmed",
      personId: firstLast.id,
      reason: "unique_first_last",
    };
  }
  if (firstLastMatches.length > 1) {
    return {
      status: "unresolved",
      personId: null,
      reason: "first_last_ambiguous",
    };
  }

  const subjectNameMatches = signals.subjectNameMatches ?? [];
  const subjectName = uniqueCandidate(subjectNameMatches);
  if (subjectName) {
    return {
      status: "confirmed",
      personId: subjectName.id,
      reason: "unique_name_in_subject",
    };
  }
  if (subjectNameMatches.length > 1) {
    return {
      status: "unresolved",
      personId: null,
      reason: "subject_name_ambiguous",
    };
  }

  const firstOrg = uniqueCandidate(signals.firstOrgMatches);
  if (firstOrg) {
    if (personMeetsProvisionalPrior(firstOrg)) {
      return {
        status: "provisional",
        personId: firstOrg.id,
        reason: "unique_first_plus_org_provisional",
      };
    }
    return {
      status: "unresolved",
      personId: null,
      reason: "unique_first_plus_org_thin",
    };
  }
  if (signals.firstOrgMatches.length > 1) {
    return {
      status: "unresolved",
      personId: null,
      reason: "first_plus_org_ambiguous",
    };
  }

  const firstOnly = uniqueCandidate(signals.firstNameCanonicalMatches);
  if (firstOnly) {
    if (personMeetsProvisionalPrior(firstOnly)) {
      return {
        status: "provisional",
        personId: firstOnly.id,
        reason: "unique_first_name_provisional",
      };
    }
    return {
      status: "unresolved",
      personId: null,
      reason: "unique_first_name_thin",
    };
  }
  if (signals.firstNameCanonicalMatches.length > 1) {
    return {
      status: "unresolved",
      personId: null,
      reason: "first_name_ambiguous",
    };
  }

  return {
    status: "unresolved",
    personId: null,
    reason: "insufficient",
  };
}

export function shouldRetractProvisionalMention(params: {
  reason: string | null;
  firstOrgKey: string | null;
  firstNameKey: string | null;
  collidingFirstOrgKeys: Set<string>;
  collidingFirstNameKeys: Set<string>;
}): boolean {
  const reason = params.reason ?? "";
  if (reason === "unique_first_plus_org_provisional" && params.firstOrgKey) {
    return params.collidingFirstOrgKeys.has(params.firstOrgKey);
  }
  if (reason === "unique_first_name_provisional" && params.firstNameKey) {
    return params.collidingFirstNameKeys.has(params.firstNameKey);
  }
  return false;
}
