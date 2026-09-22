/**
 * Server-side pause loop for bulk extract during DeepSeek peak pricing.
 */

import {
  endBulkExtractActiveStint,
  ensureBulkExtractActiveStint,
  getBulkExtractRun,
  getBulkExtractRunStatus,
  updateBulkExtractRun,
} from "@/lib/email-analysis/bulk-extract-runs";
import {
  BULK_EXTRACT_DEEPSEEK_PEAK_PAUSE_PREFIX,
  bulkExtractModelUsesDeepSeek,
} from "@/lib/email-analysis/bulk-extract-deepseek-peak-shared";
import {
  formatDeepSeekTierCountdown,
  getDeepSeekPricingStatus,
} from "@/lib/deepseek/pricing";

export {
  BULK_EXTRACT_DEEPSEEK_PEAK_PAUSE_PREFIX,
  bulkExtractModelUsesDeepSeek,
} from "@/lib/email-analysis/bulk-extract-deepseek-peak-shared";

const PEAK_PAUSE_POLL_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Blocks until off-peak, override is enabled, or the run stops.
 * Returns false when the run is no longer active.
 */
export async function waitForBulkExtractDeepSeekOffPeak(
  runId: string,
  modelId: string,
): Promise<boolean> {
  if (!bulkExtractModelUsesDeepSeek(modelId)) return true;

  let pauseStintEnded = false;

  while (true) {
    const status = await getBulkExtractRunStatus(runId);
    if (status !== "running") return false;

    const run = await getBulkExtractRun(runId);
    if (!run || run.status !== "running") return false;

    if (run.runDuringDeepSeekPeak) {
      if (pauseStintEnded) {
        await ensureBulkExtractActiveStint(runId);
        pauseStintEnded = false;
      }
      return true;
    }

    const pricing = getDeepSeekPricingStatus();
    if (pricing.tier !== "peak") {
      if (pauseStintEnded) {
        await ensureBulkExtractActiveStint(runId);
      }
      return true;
    }

    if (!pauseStintEnded) {
      await endBulkExtractActiveStint(runId);
      pauseStintEnded = true;
    }

    const countdown = formatDeepSeekTierCountdown(pricing, "until");
    await updateBulkExtractRun(runId, {
      currentEmailLabel: `${BULK_EXTRACT_DEEPSEEK_PEAK_PAUSE_PREFIX} · ${countdown}`,
    });

    const sleepMs = Math.min(
      PEAK_PAUSE_POLL_MS,
      Math.max(5_000, pricing.msUntilTierChange + 1_000),
    );
    await sleep(sleepMs);
  }
}
