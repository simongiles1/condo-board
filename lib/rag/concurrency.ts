/** Shared concurrency helpers for corpus indexing. */

export function createSemaphore(limit: number) {
  let available = Math.max(1, limit);
  const waiters: Array<() => void> = [];
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (available > 0) {
        available -= 1;
      } else {
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      }
      try {
        return await fn();
      } finally {
        const next = waiters.shift();
        if (next) next();
        else available += 1;
      }
    },
  };
}

export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let nextIndex = 0;
  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  }
  const pool = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: pool }, () => runWorker()));
}

function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

/** Parallel file-read + chunk prep within one indexer slice. Does not hit Gemini. */
export function corpusIndexDocConcurrencyFromEnv(): number {
  return parseBoundedInt(process.env.CORPUS_INDEX_DOC_CONCURRENCY, 6, 1, 16);
}

/**
 * Parallel Gemini batchEmbedContents calls (each batch is up to 50 texts).
 * Kept low by default; embed.ts retries with backoff on 429.
 */
export function corpusEmbedConcurrencyFromEnv(): number {
  return parseBoundedInt(process.env.CORPUS_EMBED_CONCURRENCY, 2, 1, 8);
}
