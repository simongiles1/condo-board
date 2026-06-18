import type { gmail_v1 } from "googleapis";

const THREAD_FETCH_CONCURRENCY = 8;

export async function listMatchingThreadIds(
  gmail: gmail_v1.Gmail,
  query: string,
): Promise<string[]> {
  const threadIds = new Set<string>();
  let pageToken: string | undefined;

  do {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 500,
      pageToken,
    });

    for (const message of response.data.messages ?? []) {
      if (message.threadId) threadIds.add(message.threadId);
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return [...threadIds];
}

/** Every message in threads that match the query, oldest first. */
export async function listMessageIdsInMatchingThreads(
  gmail: gmail_v1.Gmail,
  query: string,
): Promise<{
  messageIds: string[];
  threadsMatched: number;
  queryMatchedMessageCount: number;
}> {
  const queryMatchedMessageCount = await countMatchingMessages(gmail, query);
  const threadIds = await listMatchingThreadIds(gmail, query);
  const messageIdToDate = new Map<string, number>();

  for (let index = 0; index < threadIds.length; index += THREAD_FETCH_CONCURRENCY) {
    const batch = threadIds.slice(index, index + THREAD_FETCH_CONCURRENCY);
    await Promise.all(
      batch.map(async (threadId) => {
        const response = await gmail.users.threads.get({
          userId: "me",
          id: threadId,
          format: "minimal",
        });

        for (const message of response.data.messages ?? []) {
          if (!message.id) continue;
          messageIdToDate.set(message.id, Number(message.internalDate ?? 0));
        }
      }),
    );
  }

  const messageIds = [...messageIdToDate.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([messageId]) => messageId);

  return {
    messageIds,
    threadsMatched: threadIds.length,
    queryMatchedMessageCount,
  };
}

async function countMatchingMessages(
  gmail: gmail_v1.Gmail,
  query: string,
): Promise<number> {
  return (await getQueryMatchCounts(gmail, query)).emailCount;
}

/** Messages and unique threads matching a Gmail search query. */
export async function getQueryMatchCounts(
  gmail: gmail_v1.Gmail,
  query: string,
): Promise<{ emailCount: number; threadCount: number }> {
  const threadIds = new Set<string>();
  let emailCount = 0;
  let pageToken: string | undefined;

  do {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 500,
      pageToken,
    });

    for (const message of response.data.messages ?? []) {
      emailCount += 1;
      if (message.threadId) threadIds.add(message.threadId);
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { emailCount, threadCount: threadIds.size };
}
