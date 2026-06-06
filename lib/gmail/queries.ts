import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emails, emailSyncExclusions, senderAllowlist } from "@/lib/db/schema";

export async function getAllowlistEmails(): Promise<string[]> {
  const db = getDb();
  const rows = await db.select({ email: senderAllowlist.email }).from(senderAllowlist);
  return rows.map((row) => row.email.toLowerCase());
}

function buildAddressParticipationClause(address: string): string {
  const normalized = address.toLowerCase();
  return `(from:${normalized} OR cc:${normalized} OR to:${normalized})`;
}

export function buildAllowlistQuery(addresses: string[]): string {
  if (addresses.length === 0) {
    throw new Error("Sender allowlist is empty. Add senders before backfill.");
  }

  const participationClause = addresses
    .map(buildAddressParticipationClause)
    .join(" OR ");
  return `(${participationClause}) -in:spam -in:trash`;
}

export function buildSenderBackfillQuery(email: string): string {
  return `${buildAddressParticipationClause(email)} -in:spam -in:trash`;
}

/** Gmail `before:` is exclusive; use the UTC day after cutoff so same-day mail is searched. */
export function gmailBeforeDateExclusive(cutoffAt: string): string {
  const cutoff = new Date(cutoffAt);
  const nextDay = new Date(
    Date.UTC(
      cutoff.getUTCFullYear(),
      cutoff.getUTCMonth(),
      cutoff.getUTCDate() + 1,
    ),
  );
  const y = nextDay.getUTCFullYear();
  const m = String(nextDay.getUTCMonth() + 1).padStart(2, "0");
  const d = String(nextDay.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

export function appendBackfillCutoffToQuery(
  query: string,
  cutoffAt: string,
): string {
  return `${query} before:${gmailBeforeDateExclusive(cutoffAt)}`;
}

export function isMessageOnOrBeforeCutoff(
  receivedAt: string,
  cutoffAt: string,
): boolean {
  return new Date(receivedAt).getTime() <= new Date(cutoffAt).getTime();
}

export const DEDICATED_SYNC_QUERY = "-in:spam -in:trash";

/** First dedicated import: condo forwards land in inbox; avoids scanning the whole mailbox. */
export const DEDICATED_INITIAL_SYNC_QUERY = "in:inbox -in:spam -in:trash";

export async function isDuplicateMessage(input: {
  gmailMessageId: string;
  messageIdHeader: string | null;
}): Promise<boolean> {
  const db = getDb();

  const [excluded] = await db
    .select({ gmailMessageId: emailSyncExclusions.gmailMessageId })
    .from(emailSyncExclusions)
    .where(eq(emailSyncExclusions.gmailMessageId, input.gmailMessageId));

  if (excluded) return true;

  const [byGmailId] = await db
    .select({ id: emails.id })
    .from(emails)
    .where(eq(emails.gmailMessageId, input.gmailMessageId));

  if (byGmailId) return true;

  if (input.messageIdHeader) {
    const [byHeader] = await db
      .select({ id: emails.id })
      .from(emails)
      .where(eq(emails.messageIdHeader, input.messageIdHeader));

    if (byHeader) return true;

    const [excludedByHeader] = await db
      .select({ gmailMessageId: emailSyncExclusions.gmailMessageId })
      .from(emailSyncExclusions)
      .where(eq(emailSyncExclusions.messageIdHeader, input.messageIdHeader));

    if (excludedByHeader) return true;
  }

  return false;
}
