import { and, eq, gte } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emailThreads, emails } from "@/lib/db/schema";
import { extractMailboxEmail } from "@/lib/email/address-display";

import { getPersonalCatchupSinceIso } from "./catchup-since";
import { getGmailClient } from "./client";
import {
  appendCatchupAfterToQuery,
  buildAllowlistQuery,
} from "./queries";
import { getQueryMatchCounts } from "./thread-search";

export type NextSyncCatchupPreview = {
  /** ISO timestamp used for catch-up; null when using Gmail `newer_than:2d`. */
  sinceIso: string | null;
  /** Messages in Gmail matching allowlist participation in the catch-up window. */
  gmailEmailCount: number;
  gmailThreadCount: number;
  /** Allowlist-participating messages already stored with receivedAt in the window. */
  archivedEmailCount: number;
  /** Rough upper bound: Gmail window matches not yet stored (same participation rules). */
  remainingEmailCount: number;
};

function normalizeMailbox(email: string): string {
  return (extractMailboxEmail(email) ?? email).trim().toLowerCase();
}

function parseAddressList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function storedEmailMatchesAllowlist(
  row: {
    fromAddress: string;
    toAddresses: string;
    ccAddresses: string;
  },
  allowSet: Set<string>,
): boolean {
  const participants = [
    row.fromAddress,
    ...parseAddressList(row.toAddresses),
    ...parseAddressList(row.ccAddresses),
  ].map(normalizeMailbox);

  return participants.some((email) => allowSet.has(email));
}

async function countArchivedAllowlistEmailsSince(
  addresses: string[],
  sinceIso: string | null,
): Promise<number> {
  const allowSet = new Set(addresses.map(normalizeMailbox));
  if (allowSet.size === 0) return 0;

  const sinceMs = sinceIso ? new Date(sinceIso).getTime() : Date.now() - 2 * 24 * 60 * 60 * 1000;
  const sinceIsoForQuery = new Date(sinceMs).toISOString();

  const db = getDb();
  const rows = await db
    .select({
      fromAddress: emails.fromAddress,
      toAddresses: emails.toAddresses,
      ccAddresses: emails.ccAddresses,
    })
    .from(emails)
    .where(
      and(
        eq(emails.source, "personal_backfill"),
        gte(emails.receivedAt, sinceIsoForQuery),
      ),
    );

  let count = 0;
  for (const row of rows) {
    if (!storedEmailMatchesAllowlist(row, allowSet)) continue;
    count += 1;
  }

  return count;
}

/**
 * Estimate how much mail Sync now catch-up may add. One Gmail search (same cost
 * as a single allowlist preview) plus a local DB scan — no per-thread fetches.
 */
export async function getNextSyncCatchupPreview(
  addresses: string[],
): Promise<NextSyncCatchupPreview | null> {
  const normalized = [
    ...new Set(
      addresses
        .map((address) => address.trim().toLowerCase())
        .filter((address) => address.includes("@")),
    ),
  ];

  if (normalized.length === 0) {
    return {
      sinceIso: null,
      gmailEmailCount: 0,
      gmailThreadCount: 0,
      archivedEmailCount: 0,
      remainingEmailCount: 0,
    };
  }

  try {
    const sinceIso = await getPersonalCatchupSinceIso();
    const base = buildAllowlistQuery(normalized);
    const query = sinceIso
      ? appendCatchupAfterToQuery(base, sinceIso)
      : `${base} newer_than:2d`;

    const [{ gmail }, archivedEmailCount] = await Promise.all([
      getGmailClient("personal_backfill"),
      countArchivedAllowlistEmailsSince(normalized, sinceIso),
    ]);

    const gmailCounts = await getQueryMatchCounts(gmail, query);

    return {
      sinceIso,
      gmailEmailCount: gmailCounts.emailCount,
      gmailThreadCount: gmailCounts.threadCount,
      archivedEmailCount,
      remainingEmailCount: Math.max(
        0,
        gmailCounts.emailCount - archivedEmailCount,
      ),
    };
  } catch (error) {
    console.warn("[sync-import-preview] personal Gmail unavailable", error);
    return null;
  }
}
