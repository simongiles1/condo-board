/**
 * Links accepted package facts that name the same project or proposal.
 * The same organization is not enough. A fee with no subject stays unlinked.
 */

import { normalizeFactText, type MeetingsV3FactCandidate } from "@/lib/meeting-v3/facts";

/** Facts kept together because they name one project, and one revision when a date is stated. */
export type MeetingsV3FactStatement = {
  subject: string;
  revision: string | null;
  pages: number[];
  uncertain: boolean;
  members: MeetingsV3FactCandidate[];
};

/**
 * Cross-page statements for one agenda item.
 * `unlinked` lists accepted facts that do not name a subject, or that do not name the revision.
 */
export type MeetingsV3FactStatementResult = {
  statements: MeetingsV3FactStatement[];
  unlinked: MeetingsV3FactCandidate[];
};

/**
 * Groups facts that share a subject the quote already states.
 * When the subject has more than one date, a fact joins a revision only when its quote contains that date.
 */
export function linkFactStatements(candidates: readonly MeetingsV3FactCandidate[]): MeetingsV3FactStatementResult {
  const unlinked: MeetingsV3FactCandidate[] = [];
  const bySubject = new Map<string, { label: string; members: MeetingsV3FactCandidate[] }>();
  for (const candidate of candidates) {
    const subject = candidate.subject?.trim();
    if (!subject) {
      unlinked.push(candidate);
      continue;
    }
    const key = normalizeFactText(subject);
    const bucket = bySubject.get(key) ?? { label: subject, members: [] };
    bucket.members.push(candidate);
    bySubject.set(key, bucket);
  }

  const statements: MeetingsV3FactStatement[] = [];
  for (const bucket of bySubject.values()) {
    const dates = [
      ...new Set(
        bucket.members
          .filter((member) => member.field === "date" && isRevisionDate(member))
          .map((member) => member.value),
      ),
    ];
    if (dates.length <= 1) {
      statements.push(makeStatement(bucket.label, dates[0] ?? null, bucket.members));
      continue;
    }
    const placed = new Set<MeetingsV3FactCandidate>();
    for (const date of dates) {
      const dateNorm = normalizeFactText(date);
      const members = bucket.members.filter((member) => normalizeFactText(member.quote).includes(dateNorm));
      for (const member of members) placed.add(member);
      if (members.length > 0) statements.push(makeStatement(bucket.label, date, members));
    }
    for (const member of bucket.members) {
      if (!placed.has(member)) unlinked.push(member);
    }
  }

  statements.sort(
    (left, right) =>
      left.subject.localeCompare(right.subject)
      || (left.revision ?? "").localeCompare(right.revision ?? "")
      || (left.pages[0] ?? 0) - (right.pages[0] ?? 0),
  );
  return { statements, unlinked };
}

function makeStatement(
  subject: string,
  revision: string | null,
  members: MeetingsV3FactCandidate[],
): MeetingsV3FactStatement {
  const pages = [...new Set(members.map((member) => member.page))].sort((left, right) => left - right);
  return {
    subject,
    revision,
    pages,
    uncertain: members.some((member) => member.field === "amount" && !member.service),
    members,
  };
}

function isRevisionDate(member: MeetingsV3FactCandidate): boolean {
  if (member.role === "historical_event") return false;
  return /\b(revis|dated|amend)/i.test(member.quote);
}
