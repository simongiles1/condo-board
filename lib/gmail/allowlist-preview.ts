import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emailThreads, emails } from "@/lib/db/schema";

import { buildAllowlistQuery } from "./queries";
import { getGmailClient } from "./client";
import { getQueryMatchCounts } from "./thread-search";

export type AllowlistImportPreview = {
  threadCount: number;
  emailCount: number;
  importedThreadCount: number;
  importedEmailCount: number;
};

function normalizeMailbox(email: string): string {
  return email.trim().toLowerCase();
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

async function getImportedAllowlistCounts(
  addresses: string[],
): Promise<{ threadCount: number; emailCount: number }> {
  const allowSet = new Set(addresses.map(normalizeMailbox));
  if (allowSet.size === 0) {
    return { threadCount: 0, emailCount: 0 };
  }

  const db = getDb();
  const rows = await db
    .select({
      fromAddress: emails.fromAddress,
      toAddresses: emails.toAddresses,
      ccAddresses: emails.ccAddresses,
      gmailThreadId: emailThreads.gmailThreadId,
    })
    .from(emails)
    .innerJoin(emailThreads, eq(emails.threadId, emailThreads.id))
    .where(eq(emails.source, "personal_backfill"));

  let emailCount = 0;
  const gmailThreadIds = new Set<string>();

  for (const row of rows) {
    if (!storedEmailMatchesAllowlist(row, allowSet)) continue;
    emailCount += 1;
    gmailThreadIds.add(row.gmailThreadId);
  }

  return { emailCount, threadCount: gmailThreadIds.size };
}

/** Estimate allowlist-matching mail in personal Gmail (same query as Sync now). */
export async function getAllowlistImportPreview(
  addresses: string[],
): Promise<AllowlistImportPreview | null> {
  const normalized = [
    ...new Set(
      addresses
        .map((address) => address.trim().toLowerCase())
        .filter((address) => address.includes("@")),
    ),
  ];

  if (normalized.length === 0) {
    return {
      threadCount: 0,
      emailCount: 0,
      importedThreadCount: 0,
      importedEmailCount: 0,
    };
  }

  try {
    const { gmail } = await getGmailClient("personal_backfill");
    const query = buildAllowlistQuery(normalized);
    const [gmailCounts, imported] = await Promise.all([
      getQueryMatchCounts(gmail, query),
      getImportedAllowlistCounts(normalized),
    ]);

    return {
      threadCount: gmailCounts.threadCount,
      emailCount: gmailCounts.emailCount,
      importedThreadCount: imported.threadCount,
      importedEmailCount: imported.emailCount,
    };
  } catch (error) {
    console.warn("[allowlist-preview] personal Gmail unavailable", error);
    return null;
  }
}

/** Estimate allowlist mail in Gmail not yet imported into the app. */
export async function getAllowlistBackfillPreview(
  addresses: string[],
): Promise<AllowlistImportPreview | null> {
  const gmailPreview = await getAllowlistImportPreview(addresses);
  if (!gmailPreview) return null;

  const imported = await getImportedAllowlistCounts(addresses);

  return {
    threadCount: Math.max(0, gmailPreview.threadCount - imported.threadCount),
    emailCount: Math.max(0, gmailPreview.emailCount - imported.emailCount),
    importedThreadCount: imported.threadCount,
    importedEmailCount: imported.emailCount,
  };
}
