import type { gmail_v1 } from "googleapis";

import { getGmailClient } from "./client";

const LOOKUP_CONCURRENCY = 4;

export type PersonalFromCounts = {
  messageCount: number;
  threadCount: number;
};

async function getPersonalFromCountsForSender(
  gmail: gmail_v1.Gmail,
  email: string,
): Promise<PersonalFromCounts> {
  const query = `from:${email.toLowerCase()} -in:spam -in:trash`;
  const threadIds = new Set<string>();
  let messageCount = 0;
  let pageToken: string | undefined;

  do {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 500,
      pageToken,
    });

    for (const message of response.data.messages ?? []) {
      messageCount += 1;
      if (message.threadId) threadIds.add(message.threadId);
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { messageCount, threadCount: threadIds.size };
}

/** From-message and thread counts in connected personal Gmail, keyed by email. */
export async function getPersonalFromCounts(
  emails: string[],
): Promise<Map<string, PersonalFromCounts>> {
  const normalized = [
    ...new Set(
      emails
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.includes("@")),
    ),
  ];

  const results = new Map<string, PersonalFromCounts>();
  if (normalized.length === 0) return results;

  const { gmail } = await getGmailClient("personal_backfill");

  for (let index = 0; index < normalized.length; index += LOOKUP_CONCURRENCY) {
    const batch = normalized.slice(index, index + LOOKUP_CONCURRENCY);
    await Promise.all(
      batch.map(async (email) => {
        try {
          results.set(email, await getPersonalFromCountsForSender(gmail, email));
        } catch (error) {
          console.warn("[personal-from-counts]", email, error);
        }
      }),
    );
  }

  return results;
}
