import { asc } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emails, senderAllowlist } from "@/lib/db/schema";

export type AllowlistCandidate = {
  email: string;
  /** Imported messages where this address appears in the From header. */
  messageCount: number;
  /** From-message count in connected personal Gmail; null when unavailable. */
  personalFromCount: number | null;
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
  Omit<AllowlistCandidate, "personalFromCount">[]
> {
  const db = getDb();

  const [emailRows, allowlistRows] = await Promise.all([
    db.select({ fromAddress: emails.fromAddress }).from(emails),
    db
      .select()
      .from(senderAllowlist)
      .orderBy(asc(senderAllowlist.email)),
  ]);

  const messageCounts = new Map<string, number>();
  for (const row of emailRows) {
    const email = normalizeSenderEmail(row.fromAddress);
    if (!email) continue;
    messageCounts.set(email, (messageCounts.get(email) ?? 0) + 1);
  }

  const allowlistByEmail = new Map(
    allowlistRows.map((entry) => [entry.email.toLowerCase(), entry]),
  );

  const candidates: Omit<AllowlistCandidate, "personalFromCount">[] = [];
  const seen = new Set<string>();

  for (const email of [...messageCounts.keys()].sort((a, b) =>
    a.localeCompare(b),
  )) {
    seen.add(email);
    const saved = allowlistByEmail.get(email);
    candidates.push({
      email,
      messageCount: messageCounts.get(email) ?? 0,
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
  candidates: Omit<AllowlistCandidate, "personalFromCount">[],
): Promise<AllowlistCandidate[]> {
  if (candidates.length === 0) return [];

  try {
    const { getPersonalFromMessageCounts } = await import(
      "@/lib/gmail/personal-from-counts"
    );
    const counts = await getPersonalFromMessageCounts(
      candidates.map((candidate) => candidate.email),
    );

    return candidates.map((candidate) => ({
      ...candidate,
      personalFromCount: counts.get(candidate.email.toLowerCase()) ?? 0,
    }));
  } catch (error) {
    console.warn("[allowlist-candidates] personal From counts unavailable", error);
    return candidates.map((candidate) => ({
      ...candidate,
      personalFromCount: null,
    }));
  }
}
