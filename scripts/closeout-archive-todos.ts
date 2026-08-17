/**
 * Run thread close-out on harvests older than the 120-day working window.
 * Usage: npx tsx scripts/closeout-archive-todos.ts
 * Optional: TODO_CLOSEOUT_MODEL=deepseek-v4-flash
 * Optional: TODO_CLOSEOUT_CONCURRENCY=4
 */
import { readFileSync } from "fs";
import path from "path";

import { runArchiveTodoCloseout } from "../lib/email-analysis/archive-todo-closeout";
import { getAnalysisSettings } from "../lib/email-analysis/settings";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // optional when env is already set
  }
}

function concurrencyFromEnv(): number {
  const raw = process.env.TODO_CLOSEOUT_CONCURRENCY?.trim();
  if (!raw) return 4;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 4;
  return Math.min(8, Math.floor(n));
}

async function main() {
  loadEnvLocal();

  const settings = await getAnalysisSettings();
  const modelName =
    process.env.TODO_CLOSEOUT_MODEL?.trim() ||
    "deepseek-v4-flash";
  const concurrency = concurrencyFromEnv();

  console.log(
    `Archive close-out with ${modelName} (analysis fallback ${settings.analysisModel}), concurrency=${concurrency}`,
  );

  const result = await runArchiveTodoCloseout({
    modelName,
    concurrency,
    onProgress: (progress) => {
      const prefix = `${progress.index}/${progress.total} ${progress.threadId}`;
      if (progress.error) {
        console.error(`  ${prefix}: FAILED ${progress.error}`);
        return;
      }
      if (progress.completed || progress.superseded) {
        console.log(
          `  ${prefix}: completed=${progress.completed}, superseded=${progress.superseded}`,
        );
      } else if (progress.index % 25 === 0 || progress.index === progress.total) {
        console.log(`  ${prefix}: no changes`);
      }
    },
  });

  console.log(
    `Done. threads=${result.threadCount} completed=${result.completed} superseded=${result.superseded} calendarClosed=${result.calendarClosed} failed=${result.failedThreads} costUsd=${result.costUsd.toFixed(4)}`,
  );
  if (result.failedThreads > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
