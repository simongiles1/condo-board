import { asc } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emails, senderAllowlist } from "@/lib/db/schema";

export type AllowlistCandidate = {
  email: string;
  /** Imported messages where this address appears in the From header. */
  messageCount: number;
  /** Distinct imported threads where this address appears in the From header. */
  threadCount: number;
  /** From-message count in connected personal Gmail; null when unavailable. */
  personalFromCount: number | null;
  /** Distinct personal Gmail threads with a From message from this address; null when unavailable. */
  personalThreadCount: number | null;
  saved: boolean;
  id: string | null;
  displayName: string | null;
  notes: string | null;
  addedAt: string | null;
};

function normalizeSenderEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || !email.includes("@") || email === "unknown@unknown") {
    return null;
  }
  return email;
}

/** Unique From addresses in imported mail, merged with saved allowlist entries. */
export async function listAllowlistCandidates(): Promise<AllowlistCandidate[]> {
  const candidates = await listAllowlistCandidatesBase();
  return attachPersonalFromCounts(candidates);
}

async function listAllowlistCandidatesBase(): Promise<
  Omit<AllowlistCandidate, "personalFromCount" | "personalThreadCount">[]
> {
  const db = getDb();

  const [emailRows, allowlistRows] = await Promise.all([
    db
      .select({ fromAddress: emails.fromAddress, threadId: emails.threadId })
      .from(emails),
    db
      .select()
      .from(senderAllowlist)
      .orderBy(asc(senderAllowlist.email)),
  ]);

  const messageCounts = new Map<string, number>();
  const threadIdsByEmail = new Map<string, Set<string>>();
  for (const row of emailRows) {
    const email = normalizeSenderEmail(row.fromAddress);
    if (!email) continue;
    messageCounts.set(email, (messageCounts.get(email) ?? 0) + 1);
    if (row.threadId) {
      const threadIds = threadIdsByEmail.get(email) ?? new Set<string>();
      threadIds.add(row.threadId);
      threadIdsByEmail.set(email, threadIds);
    }
  }

  const allowlistByEmail = new Map(
    allowlistRows.map((entry) => [entry.email.toLowerCase(), entry]),
  );

  const candidates: Omit<
    AllowlistCandidate,
    "personalFromCount" | "personalThreadCount"
  >[] = [];
  const seen = new Set<string>();

  for (const email of [...messageCounts.keys()].sort((a, b) =>
    a.localeCompare(b),
  )) {
    seen.add(email);
    const saved = allowlistByEmail.get(email);
    candidates.push({
      email,
      messageCount: messageCounts.get(email) ?? 0,
      threadCount: threadIdsByEmail.get(email)?.size ?? 0,
      saved: Boolean(saved),
      id: saved?.id ?? null,
      displayName: saved?.displayName ?? null,
      notes: saved?.notes ?? null,
      addedAt: saved?.addedAt ?? null,
    });
  }

  for (const entry of allowlistRows) {
    const email = entry.email.toLowerCase();
    if (seen.has(email)) continue;
    candidates.push({
      email: entry.email,
      messageCount: 0,
      threadCount: 0,
      saved: true,
      id: entry.id,
      displayName: entry.displayName,
      notes: entry.notes,
      addedAt: entry.addedAt,
    });
  }

  return candidates.sort((a, b) => a.email.localeCompare(b.email));
}

async function attachPersonalFromCounts(
  candidates: Omit<AllowlistCandidate, "personalFromCount" | "personalThreadCount">[],
): Promise<AllowlistCandidate[]> {
  if (candidates.length === 0) return [];

  try {
    const { getPersonalFromCounts } = await import(
      "@/lib/gmail/personal-from-counts"
    );
    const counts = await getPersonalFromCounts(
      candidates.map((candidate) => candidate.email),
    );

    return candidates.map((candidate) => {
      const personalCounts = counts.get(candidate.email.toLowerCase());
      return {
        ...candidate,
        personalFromCount: personalCounts?.messageCount ?? 0,
        personalThreadCount: personalCounts?.threadCount ?? 0,
      };
    });
  } catch (error) {
    console.warn("[allowlist-candidates] personal From counts unavailable", error);
    return candidates.map((candidate) => ({
      ...candidate,
      personalFromCount: null,
      personalThreadCount: null,
    }));
  }
}
