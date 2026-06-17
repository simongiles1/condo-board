import type { gmail_v1 } from "googleapis";

import { getGmailClient } from "./client";

const LOOKUP_CONCURRENCY = 4;

async function getPersonalFromCount(
  gmail: gmail_v1.Gmail,
  email: string,
): Promise<number> {
  const query = `from:${email.toLowerCase()} -in:spam -in:trash`;
  let count = 0;
  let pageToken: string | undefined;

  do {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 500,
      pageToken,
    });

    count += response.data.messages?.length ?? 0;
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return count;
}

/** From-message counts in the connected personal Gmail mailbox, keyed by email. */
export async function getPersonalFromMessageCounts(
  emails: string[],
): Promise<Map<string, number>> {
  const normalized = [
    ...new Set(
      emails
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.includes("@")),
    ),
  ];

  const results = new Map<string, number>();
  if (normalized.length === 0) return results;

  const { gmail } = await getGmailClient("personal_backfill");

  for (let index = 0; index < normalized.length; index += LOOKUP_CONCURRENCY) {
    const batch = normalized.slice(index, index + LOOKUP_CONCURRENCY);
    await Promise.all(
      batch.map(async (email) => {
        try {
          results.set(email, await getPersonalFromCount(gmail, email));
        } catch (error) {
          console.warn("[personal-from-counts]", email, error);
        }
      }),
    );
  }

  return results;
}
