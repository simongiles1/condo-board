/**
 * Shared / role mailboxes: one address occupied by more than one person.
 * Client-safe grouping and occupancy timeline math.
 */

import {
  normalizeContactRegistryEmail,
  parseEvidenceJson,
  personDisplayName,
  pickCurrentOccupancyPersonId,
} from "@/lib/contacts/registry-shared";

export const SHARED_MAILBOX_MIN_OCCUPANTS = 2;

export type SharedMailboxPersonInfo = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  sparseStub: boolean;
  mentionWeight: number;
  currentOrganizationName: string | null;
};

export type SharedMailboxOccupancyInput = {
  email: string;
  personId: string;
  validFrom: string | null;
  validTo: string | null;
  evidenceJson?: string | null;
};

export type SharedMailboxRange = {
  validFrom: string | null;
  validTo: string | null;
  evidenceCount: number;
};

export type SharedMailboxOccupant = {
  personId: string;
  personName: string;
  firstName: string | null;
  lastName: string | null;
  sparseStub: boolean;
  mentionWeight: number;
  currentOrganizationName: string | null;
  isCurrent: boolean;
  ranges: SharedMailboxRange[];
};

export type SharedMailboxSummary = {
  email: string;
  occupantCount: number;
  currentPersonId: string | null;
  currentPersonName: string | null;
  occupants: SharedMailboxOccupant[];
};

export type SharedMailboxStats = {
  mailboxCount: number;
  occupantCount: number;
};

export type OccupancyTimelineBounds = {
  startMs: number;
  endMs: number;
};

const MISSING_PERSON: SharedMailboxPersonInfo = {
  id: "",
  firstName: null,
  lastName: null,
  sparseStub: false,
  mentionWeight: 0,
  currentOrganizationName: null,
};

export function formatOccupancyRange(
  from: string | null,
  to: string | null,
): string {
  if (!from && !to) return "unknown dates";
  const a = from?.slice(0, 10) ?? "…";
  const b = to?.slice(0, 10) ?? "present";
  return `${a} → ${b}`;
}

export function formatOccupancyDate(iso: string | null | undefined): string {
  if (!iso) return "…";
  return iso.slice(0, 10);
}

export function parseOccupancyMs(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function occupantEarliestFrom(ranges: SharedMailboxRange[]): string {
  const froms = ranges
    .map((range) => range.validFrom)
    .filter((value): value is string => Boolean(value))
    .sort();
  return froms[0] ?? "";
}

function occupantLatestEnd(ranges: SharedMailboxRange[]): string {
  let latest = "";
  for (const range of ranges) {
    const end = range.validTo ?? range.validFrom ?? "";
    if (end > latest) latest = end;
  }
  return latest;
}

function flattenRanges(occupants: SharedMailboxOccupant[]): SharedMailboxRange[] {
  return occupants.flatMap((occupant) => occupant.ranges);
}

/**
 * Shared time axis for occupancy bars. Open-ended ranges extend to `nowMs`.
 */
export function occupancyTimelineBounds(
  ranges: SharedMailboxRange[],
  nowMs: number,
): OccupancyTimelineBounds | null {
  const points: number[] = [];
  let hasOpen = false;
  for (const range of ranges) {
    const from = parseOccupancyMs(range.validFrom);
    const to = parseOccupancyMs(range.validTo);
    if (from != null) points.push(from);
    if (to != null) points.push(to);
    if (!range.validTo) hasOpen = true;
  }
  if (points.length === 0) return null;

  const startMs = Math.min(...points);
  const datedEnd = Math.max(...points);
  const endMs = hasOpen ? Math.max(datedEnd, nowMs) : datedEnd;
  if (endMs <= startMs) {
    return { startMs, endMs: startMs + 24 * 60 * 60 * 1000 };
  }
  return { startMs, endMs };
}

export function occupancyBarPercent(
  from: string | null,
  to: string | null,
  bounds: OccupancyTimelineBounds,
  nowMs: number,
): { left: number; width: number } {
  const span = bounds.endMs - bounds.startMs;
  if (span <= 0) return { left: 0, width: 100 };

  const start = parseOccupancyMs(from) ?? bounds.startMs;
  const end = parseOccupancyMs(to) ?? nowMs;
  const leftRaw = ((start - bounds.startMs) / span) * 100;
  const rightRaw = ((end - bounds.startMs) / span) * 100;
  const left = Math.min(100, Math.max(0, leftRaw));
  const right = Math.min(100, Math.max(0, rightRaw));
  return {
    left,
    width: Math.max(right - left, 0.8),
  };
}

export function mailboxTimelineBounds(
  mailbox: SharedMailboxSummary,
  nowMs: number,
): OccupancyTimelineBounds | null {
  return occupancyTimelineBounds(flattenRanges(mailbox.occupants), nowMs);
}

export function sharedMailboxStats(
  mailboxes: SharedMailboxSummary[],
): SharedMailboxStats {
  const people = new Set<string>();
  for (const mailbox of mailboxes) {
    for (const occupant of mailbox.occupants) {
      people.add(occupant.personId);
    }
  }
  return {
    mailboxCount: mailboxes.length,
    occupantCount: people.size,
  };
}

/**
 * Emails with at least `minOccupants` distinct people. Occupancy rows for the
 * same person on one address collapse into one occupant with one or more ranges.
 */
export function buildSharedMailboxes(
  occupancy: SharedMailboxOccupancyInput[],
  persons: ReadonlyMap<string, SharedMailboxPersonInfo>,
  params?: {
    minOccupants?: number;
    nowIso?: string;
  },
): SharedMailboxSummary[] {
  const minOccupants = params?.minOccupants ?? SHARED_MAILBOX_MIN_OCCUPANTS;
  const nowIso = params?.nowIso ?? new Date().toISOString();

  const byEmail = new Map<string, SharedMailboxOccupancyInput[]>();
  for (const row of occupancy) {
    const email = normalizeContactRegistryEmail(row.email);
    if (!email) continue;
    const list = byEmail.get(email) ?? [];
    list.push({ ...row, email });
    byEmail.set(email, list);
  }

  const mailboxes: SharedMailboxSummary[] = [];
  for (const [email, rows] of byEmail) {
    const personIds = new Set(rows.map((row) => row.personId));
    if (personIds.size < minOccupants) continue;

    const rangesByPerson = new Map<string, SharedMailboxRange[]>();
    for (const row of rows) {
      const list = rangesByPerson.get(row.personId) ?? [];
      list.push({
        validFrom: row.validFrom,
        validTo: row.validTo,
        evidenceCount: parseEvidenceJson(row.evidenceJson).length,
      });
      rangesByPerson.set(row.personId, list);
    }

    const occupants: SharedMailboxOccupant[] = [...personIds].map((personId) => {
      const person = persons.get(personId) ?? { ...MISSING_PERSON, id: personId };
      const ranges = (rangesByPerson.get(personId) ?? []).sort((a, b) =>
        (a.validFrom ?? "").localeCompare(b.validFrom ?? ""),
      );
      const personName = personDisplayName({
        firstName: person.firstName,
        lastName: person.lastName,
        emails: [{ email }],
      });
      return {
        personId,
        personName,
        firstName: person.firstName,
        lastName: person.lastName,
        sparseStub: person.sparseStub,
        mentionWeight: person.mentionWeight,
        currentOrganizationName: person.currentOrganizationName,
        isCurrent: false,
        ranges,
      };
    });

    occupants.sort((a, b) => {
      const fromCmp = occupantEarliestFrom(a.ranges).localeCompare(
        occupantEarliestFrom(b.ranges),
      );
      if (fromCmp !== 0) return fromCmp;
      const endCmp = occupantLatestEnd(a.ranges).localeCompare(
        occupantLatestEnd(b.ranges),
      );
      if (endCmp !== 0) return endCmp;
      return a.personName.localeCompare(b.personName, undefined, {
        sensitivity: "base",
      });
    });

    // Prefer the open-ended occupant as current. A predecessor closed on the
    // same day the successor started would otherwise tie on evidence end.
    const openOccupants = occupants.filter((occupant) =>
      occupant.ranges.some((range) => !range.validTo),
    );
    const currentPersonId =
      openOccupants.length === 1
        ? openOccupants[0]!.personId
        : pickCurrentOccupancyPersonId(
            rows.map((row) => ({
              personId: row.personId,
              validFrom: row.validFrom,
              validTo: row.validTo,
            })),
            nowIso,
          );
    for (const occupant of occupants) {
      occupant.isCurrent = occupant.personId === currentPersonId;
    }

    const current = occupants.find((occupant) => occupant.isCurrent) ?? null;
    mailboxes.push({
      email,
      occupantCount: occupants.length,
      currentPersonId,
      currentPersonName: current?.personName ?? null,
      occupants,
    });
  }

  return mailboxes.sort((a, b) => {
    const countCmp = b.occupantCount - a.occupantCount;
    if (countCmp !== 0) return countCmp;
    return a.email.localeCompare(b.email);
  });
}
