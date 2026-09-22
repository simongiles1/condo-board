/**
 * Pause bulk extract during DeepSeek peak pricing unless the run opts in.
 */

import {
  CONTACT_HIGHLIGHT_MODELS,
  contactHighlightModelProvider,
  type ContactHighlightModelId,
} from "@/lib/email-analysis/contact-highlight-models";
import {
  endBulkExtractActiveStint,
  ensureBulkExtractActiveStint,
  getBulkExtractRun,
  getBulkExtractRunStatus,
  updateBulkExtractRun,
} from "@/lib/email-analysis/bulk-extract-runs";
import {
  formatDeepSeekTierCountdown,
  getDeepSeekPricingStatus,
} from "@/lib/deepseek/pricing";

const PEAK_PAUSE_POLL_MS = 15_000;

export const BULK_EXTRACT_DEEPSEEK_PEAK_PAUSE_PREFIX =
  "Paused for DeepSeek peak pricing";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when the bulk-extract model id routes to the DeepSeek provider. */
export function bulkExtractModelUsesDeepSeek(modelId: string): boolean {
  const trimmed = modelId.trim();
  if (!trimmed) return false;
  if (
    (CONTACT_HIGHLIGHT_MODELS as readonly string[]).includes(trimmed)
  ) {
    return (
      contactHighlightModelProvider(trimmed as ContactHighlightModelId) ===
      "deepseek"
    );
  }
  return trimmed.toLowerCase().includes("deepseek");
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
