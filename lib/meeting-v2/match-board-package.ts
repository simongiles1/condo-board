import { parseBoardPackageDate } from "@/lib/email/file-categories";

export type BoardPackageCandidate = {
  id: string;
  filename: string;
  receivedAt: string;
  sizeBytes: number | null;
  parsedDate: string | null;
};

export type BoardPackageMatchKind = "exact" | "nearest" | "none";

export type BoardPackageMatchResult = {
  selectedId: string | null;
  matchKind: BoardPackageMatchKind;
  ranked: BoardPackageCandidate[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function toIsoDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parsedBoardPackageIsoDate(filename: string): string | null {
  const parsed = parseBoardPackageDate(filename);
  return parsed ? toIsoDateLocal(parsed) : null;
}

function receivedIsoDate(receivedAt: string): string | null {
  const match = receivedAt.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function utcDay(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function dayDelta(fromIso: string, toIso: string): number {
  return Math.round((utcDay(fromIso) - utcDay(toIso)) / MS_PER_DAY);
}

type RankedRow = {
  candidate: BoardPackageCandidate;
  tier: number;
  distance: number;
  signedDelta: number;
};

/**
 * Pick the archive board package that belongs to a meeting date.
 * Filename dates win over email received-at. Equal distances prefer a package
 * dated on or before the meeting (the package is circulated first).
 */
export function matchBoardPackageForMeetingDate(
  meetingDate: string,
  packages: BoardPackageCandidate[],
): BoardPackageMatchResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate) || packages.length === 0) {
    return { selectedId: null, matchKind: "none", ranked: packages };
  }

  const rows: RankedRow[] = packages.map((candidate) => {
    const parsedDate = candidate.parsedDate;
    if (parsedDate === meetingDate) {
      return {
        candidate,
        tier: 0,
        distance: 0,
        signedDelta: 0,
      };
    }
    if (parsedDate) {
      const signedDelta = dayDelta(parsedDate, meetingDate);
      return {
        candidate,
        tier: 1,
        distance: Math.abs(signedDelta),
        signedDelta,
      };
    }
    const received = receivedIsoDate(candidate.receivedAt);
    if (received) {
      const signedDelta = dayDelta(received, meetingDate);
      return {
        candidate,
        tier: 2,
        distance: Math.abs(signedDelta),
        signedDelta,
      };
    }
    return {
      candidate,
      tier: 3,
      distance: Number.POSITIVE_INFINITY,
      signedDelta: Number.POSITIVE_INFINITY,
    };
  });

  rows.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.distance !== b.distance) return a.distance - b.distance;
    const aOnOrBefore = a.signedDelta <= 0 ? 0 : 1;
    const bOnOrBefore = b.signedDelta <= 0 ? 0 : 1;
    if (aOnOrBefore !== bOnOrBefore) return aOnOrBefore - bOnOrBefore;
    return b.candidate.receivedAt.localeCompare(a.candidate.receivedAt);
  });

  const ranked = rows.map((row) => row.candidate);
  const best = rows[0];
  if (!best || best.tier === 3) {
    return { selectedId: null, matchKind: "none", ranked };
  }

  return {
    selectedId: best.candidate.id,
    matchKind: best.tier === 0 ? "exact" : "nearest",
    ranked,
  };
}
