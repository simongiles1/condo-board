import { asc, eq, inArray } from "drizzle-orm";

import { resolveMentionUniqueBody } from "@/lib/contacts/mention-presence";
import { getDb } from "@/lib/db";
import { emails } from "@/lib/db/schema";
import { formatEmailBodyForDisplay } from "@/lib/email/format-body-display";
import { resolveHighlightedExcerpt } from "@/lib/email/highlight-unique";
import { computeThreadUniqueBodies } from "@/lib/email/thread-unique-content";

/** Payload shape accepted by POST /api/analysis/extract-contacts. */
export type PreparedContactExtractItem = {
  emailId: string;
  highlightedText: string;
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  bodyText: string;
  label: string;
};

function parseAddressList(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function fingerprintBodyText(
  bodyText: string,
  bodyTextUnique: string | null | undefined,
): string {
  if (bodyTextUnique != null) return bodyTextUnique.trim();
  return bodyText.trim();
}

function emailFilterLabel(input: {
  receivedAt: string;
  fromAddress: string;
  subject: string;
}): string {
  const from = input.fromAddress || "(unknown)";
  const subject = input.subject?.trim() || "(no subject)";
  const shortSubject =
    subject.length > 48 ? `${subject.slice(0, 48).trimEnd()}…` : subject;
  return `${input.receivedAt} · ${from} · ${shortSubject}`;
}

/**
 * Build extract-contacts items for a thread (oldest → newest) using the same
 * unique-body + display excerpt rules as the thread detail page.
 */
export async function prepareContactExtractItemsForThread(
  threadId: string,
): Promise<PreparedContactExtractItem[]> {
  const db = getDb();
  const messages = await db
    .select()
    .from(emails)
    .where(eq(emails.threadId, threadId))
    .orderBy(asc(emails.receivedAt));

  return buildPreparedItems(messages);
}

/**
 * Build extract-contacts items for specific emails. Unique bodies are computed
 * against all siblings in each email’s thread (same as single-message view).
 */
export async function prepareContactExtractItemsForEmails(
  emailIds: string[],
): Promise<PreparedContactExtractItem[]> {
  const uniqueIds = [
    ...new Set(emailIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (uniqueIds.length === 0) return [];

  const db = getDb();
  const selected = await db
    .select()
    .from(emails)
    .where(inArray(emails.id, uniqueIds));

  if (selected.length === 0) return [];

  const threadIds = [
    ...new Set(
      selected
        .map((message) => message.threadId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const siblingsByThread = new Map<string, (typeof emails.$inferSelect)[]>();
  if (threadIds.length > 0) {
    const siblings = await db
      .select()
      .from(emails)
      .where(inArray(emails.threadId, threadIds));
    for (const message of siblings) {
      if (!message.threadId) continue;
      const list = siblingsByThread.get(message.threadId) ?? [];
      list.push(message);
      siblingsByThread.set(message.threadId, list);
    }
  }

  const uniqueByEmailId = new Map<string, string>();
  for (const threadId of threadIds) {
    const siblings = siblingsByThread.get(threadId) ?? [];
    const uniqueMap = computeThreadUniqueBodies(
      siblings.map((message) => ({
        id: message.id,
        bodyText: message.bodyText,
        bodyHtml: message.bodyHtml,
        receivedAt: message.receivedAt,
      })),
    );
    for (const [emailId, unique] of uniqueMap) {
      uniqueByEmailId.set(emailId, unique);
    }
  }

  // Preserve caller order when possible; fall back to receivedAt ascending.
  const byId = new Map(selected.map((message) => [message.id, message]));
  const ordered = uniqueIds
    .map((id) => byId.get(id))
    .filter((message): message is typeof emails.$inferSelect => Boolean(message))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

  return buildPreparedItems(ordered, uniqueByEmailId);
}

function buildPreparedItems(
  messages: (typeof emails.$inferSelect)[],
  uniqueOverride?: Map<string, string>,
): PreparedContactExtractItem[] {
  const uniqueMap =
    uniqueOverride ??
    computeThreadUniqueBodies(
      messages.map((message) => ({
        id: message.id,
        bodyText: message.bodyText,
        bodyHtml: message.bodyHtml,
        receivedAt: message.receivedAt,
      })),
    );

  return messages.map((message) => {
    const uniqueText = resolveMentionUniqueBody(
      {
        bodyText: message.bodyText,
        bodyTextUnique: message.bodyTextUnique,
        bodyTextStrictUnique: message.bodyTextStrictUnique,
      },
      uniqueMap.get(message.id),
    );
    const bodyDisplay = formatEmailBodyForDisplay(
      message.bodyText,
      message.bodyHtml,
    );
    const highlightedText = resolveHighlightedExcerpt(
      bodyDisplay.content,
      uniqueText,
    );
    const toAddresses = parseAddressList(message.toAddresses);
    const ccAddresses = parseAddressList(message.ccAddresses);

    return {
      emailId: message.id,
      highlightedText,
      subject: message.subject,
      fromAddress: message.fromAddress,
      toAddresses,
      ccAddresses,
      bodyText: fingerprintBodyText(message.bodyText, uniqueText),
      label: emailFilterLabel({
        receivedAt: message.receivedAt,
        fromAddress: message.fromAddress,
        subject: message.subject,
      }),
    };
  });
}
