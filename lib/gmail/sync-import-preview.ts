import type { gmail_v1 } from "googleapis";

import { extractMailboxEmail } from "@/lib/email/address-display";

import { getPersonalCatchupSinceIso } from "./catchup-since";
import { getGmailClient } from "./client";
import { parseGmailMessage } from "./messages";
import {
  appendCatchupAfterToQuery,
  buildAllowlistQuery,
  isDuplicateMessage,
} from "./queries";

const MESSAGE_DETAIL_CONCURRENCY = 8;
const CATCHUP_MESSAGE_LIST_CAP = 200;

export type CatchupPreviewMessage = {
  gmailMessageId: string;
  gmailThreadId: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  receivedAt: string;
  alreadyInArchive: boolean;
  matchedAllowlistAddresses: string[];
  gmailUrl: string;
};

export type CatchupWindowDetail = {
  query: string;
  sinceIso: string | null;
  messages: CatchupPreviewMessage[];
  truncated: boolean;
};

export type NextSyncCatchupPreview = {
  /** ISO timestamp used for catch-up; null when using Gmail `newer_than:2d`. */
  sinceIso: string | null;
  /** Messages in Gmail matching allowlist participation in the catch-up window. */
  gmailEmailCount: number;
  gmailThreadCount: number;
  /** Allowlist-participating Gmail matches in the window already stored. */
  archivedEmailCount: number;
  /** Messages in the Gmail catch-up search not yet in the archive (by Gmail message id). */
  remainingEmailCount: number;
};

const DUPLICATE_CHECK_CONCURRENCY = 25;

async function analyzeCatchupQuery(
  gmail: gmail_v1.Gmail,
  query: string,
): Promise<{
  gmailEmailCount: number;
  gmailThreadCount: number;
  pendingEmailCount: number;
  importedEmailCount: number;
}> {
  const threadIds = new Set<string>();
  const messageIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 500,
      pageToken,
    });

    for (const message of response.data.messages ?? []) {
      if (!message.id) continue;
      messageIds.push(message.id);
      if (message.threadId) threadIds.add(message.threadId);
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  let pendingEmailCount = 0;

  for (let index = 0; index < messageIds.length; index += DUPLICATE_CHECK_CONCURRENCY) {
    const batch = messageIds.slice(index, index + DUPLICATE_CHECK_CONCURRENCY);
    const duplicates = await Promise.all(
      batch.map((gmailMessageId) =>
        isDuplicateMessage({ gmailMessageId, messageIdHeader: null }),
      ),
    );
    for (const duplicate of duplicates) {
      if (!duplicate) pendingEmailCount += 1;
    }
  }

  const gmailEmailCount = messageIds.length;
  return {
    gmailEmailCount,
    gmailThreadCount: threadIds.size,
    pendingEmailCount,
    importedEmailCount: gmailEmailCount - pendingEmailCount,
  };
}

function normalizeMailbox(email: string): string {
  return (extractMailboxEmail(email) ?? email).trim().toLowerCase();
}

function normalizeAllowlistAddresses(addresses: string[]): string[] {
  return [
    ...new Set(
      addresses
        .map((address) => address.trim().toLowerCase())
        .filter((address) => address.includes("@")),
    ),
  ];
}

function matchedAllowlistAddressesForMessage(
  parsed: NonNullable<ReturnType<typeof parseGmailMessage>>,
  allowlistEmails: string[],
): string[] {
  const allowSet = new Set(allowlistEmails.map(normalizeMailbox));
  const hits = new Set<string>();
  const participants = [
    parsed.fromAddress,
    ...parsed.toAddresses,
    ...parsed.ccAddresses,
  ].map(normalizeMailbox);

  for (const email of participants) {
    if (allowSet.has(email)) hits.add(email);
  }
  return [...hits].sort((left, right) => left.localeCompare(right));
}

export async function buildCatchupSearchQuery(
  addresses: string[],
): Promise<{ query: string; sinceIso: string | null; normalized: string[] }> {
  const normalized = normalizeAllowlistAddresses(addresses);
  if (normalized.length === 0) {
    return { query: "", sinceIso: null, normalized };
  }

  const sinceIso = await getPersonalCatchupSinceIso();
  const base = buildAllowlistQuery(normalized);
  const query = sinceIso
    ? appendCatchupAfterToQuery(base, sinceIso)
    : `${base} newer_than:2d`;

  return { query, sinceIso, normalized };
}

async function listCatchupMessageIds(
  gmail: gmail_v1.Gmail,
  query: string,
  cap: number,
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let truncated = false;

  do {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 500,
      pageToken,
    });

    for (const message of response.data.messages ?? []) {
      if (!message.id) continue;
      ids.push(message.id);
      if (ids.length >= cap) {
        truncated = Boolean(response.data.nextPageToken);
        return { ids, truncated };
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { ids, truncated: false };
}

async function fetchCatchupMessageDetail(
  gmail: gmail_v1.Gmail,
  messageId: string,
  allowlistEmails: string[],
): Promise<CatchupPreviewMessage | null> {
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["From", "To", "Cc", "Subject", "Date", "Message-ID"],
  });

  const parsed = parseGmailMessage(response.data);
  if (!parsed) return null;

  const alreadyInArchive = await isDuplicateMessage({
    gmailMessageId: parsed.gmailMessageId,
    messageIdHeader: parsed.messageIdHeader,
  });

  return {
    gmailMessageId: parsed.gmailMessageId,
    gmailThreadId: parsed.gmailThreadId,
    fromAddress: parsed.fromAddress,
    toAddresses: parsed.toAddresses,
    ccAddresses: parsed.ccAddresses,
    subject: parsed.subject,
    receivedAt: parsed.receivedAt,
    alreadyInArchive,
    matchedAllowlistAddresses: matchedAllowlistAddressesForMessage(
      parsed,
      allowlistEmails,
    ),
    gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${parsed.gmailThreadId}`,
  };
}

/** List Gmail messages in the Sync now catch-up window (lazy; used by preview modal). */
export async function listCatchupWindowMessages(
  addresses: string[],
): Promise<CatchupWindowDetail | null> {
  const { query, sinceIso, normalized } = await buildCatchupSearchQuery(addresses);
  if (normalized.length === 0 || !query) {
    return { query: "", sinceIso, messages: [], truncated: false };
  }

  try {
    const { gmail } = await getGmailClient("personal_backfill");
    const { ids, truncated } = await listCatchupMessageIds(
      gmail,
      query,
      CATCHUP_MESSAGE_LIST_CAP,
    );

    const messages: CatchupPreviewMessage[] = [];

    for (let index = 0; index < ids.length; index += MESSAGE_DETAIL_CONCURRENCY) {
      const batch = ids.slice(index, index + MESSAGE_DETAIL_CONCURRENCY);
      const batchRows = await Promise.all(
        batch.map((id) => fetchCatchupMessageDetail(gmail, id, normalized)),
      );
      for (const row of batchRows) {
        if (row) messages.push(row);
      }
    }

    messages.sort(
      (left, right) =>
        new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime(),
    );

    return { query, sinceIso, messages, truncated };
  } catch (error) {
    console.warn("[sync-import-preview] catch-up message list failed", error);
    return null;
  }
}

/**
 * Estimate how much mail Sync now catch-up may add. One Gmail search pass plus
 * per-message duplicate checks (same rule as import).
 */
export async function getNextSyncCatchupPreview(
  addresses: string[],
): Promise<NextSyncCatchupPreview | null> {
  const normalized = normalizeAllowlistAddresses(addresses);

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
    const { query, sinceIso } = await buildCatchupSearchQuery(normalized);
    const { gmail } = await getGmailClient("personal_backfill");
    const stats = await analyzeCatchupQuery(gmail, query);

    return {
      sinceIso,
      gmailEmailCount: stats.gmailEmailCount,
      gmailThreadCount: stats.gmailThreadCount,
      archivedEmailCount: stats.importedEmailCount,
      remainingEmailCount: stats.pendingEmailCount,
    };
  } catch (error) {
    console.warn("[sync-import-preview] personal Gmail unavailable", error);
    return null;
  }
}
