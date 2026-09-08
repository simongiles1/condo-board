/** Serializes corpus-index DB work so Supabase session pooler slots are not exhausted. */
const corpusIndexDbLock = createSemaphore(1);

function createSemaphore(limit: number) {
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

export async function withCorpusIndexDbLock<T>(fn: () => Promise<T>): Promise<T> {
  return corpusIndexDbLock.run(fn);
}
