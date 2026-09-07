/**
 * DeepSeek V4 Flash peak/off-peak and cache-aware billing.
 * Run: npx tsx --test scripts/test-deepseek-pricing.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deepSeekPricingTierAt,
  DEEPSEEK_V4_FLASH_OFF_PEAK_RATES,
  DEEPSEEK_V4_FLASH_PEAK_RATES,
  estimateDeepSeekCostBreakdown,
  estimateDeepSeekOffPeakOptimizedBreakdown,
  formatDurationMs,
  getDeepSeekPricingStatus,
} from "../lib/deepseek/pricing";

describe("deepSeekPricingTierAt", () => {
  it("treats Monday 02:00 UTC as peak", () => {
    assert.equal(
      deepSeekPricingTierAt(Date.parse("2026-09-07T02:00:00.000Z")),
      "peak",
    );
  });

  it("treats Monday 05:00 UTC as off-peak", () => {
    assert.equal(
      deepSeekPricingTierAt(Date.parse("2026-09-07T05:00:00.000Z")),
      "off_peak",
    );
  });

  it("treats Saturday peak-hour clock time as off-peak", () => {
    assert.equal(
      deepSeekPricingTierAt(Date.parse("2026-09-06T02:00:00.000Z")),
      "off_peak",
    );
  });
});

describe("estimateDeepSeekCostBreakdown", () => {
  it("bills cache miss and output at off-peak rates", () => {
    const at = Date.parse("2026-09-07T05:00:00.000Z");
    const breakdown = estimateDeepSeekCostBreakdown(
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheMissTokens: 1_000_000,
      },
      at,
    );

    assert.equal(breakdown.tier, "off_peak");
    assert.equal(
      breakdown.totalCostUsd,
      DEEPSEEK_V4_FLASH_OFF_PEAK_RATES.inputCacheMissPerMillion +
        DEEPSEEK_V4_FLASH_OFF_PEAK_RATES.outputPerMillion,
    );
  });

  it("doubles off-peak rates during peak hours", () => {
    const at = Date.parse("2026-09-07T02:00:00.000Z");
    const breakdown = estimateDeepSeekCostBreakdown(
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheMissTokens: 1_000_000,
      },
      at,
    );

    assert.equal(breakdown.tier, "peak");
    assert.equal(
      breakdown.totalCostUsd,
      DEEPSEEK_V4_FLASH_PEAK_RATES.inputCacheMissPerMillion +
        DEEPSEEK_V4_FLASH_PEAK_RATES.outputPerMillion,
    );
  });

  it("applies cache-hit pricing separately from cache miss", () => {
    const at = Date.parse("2026-09-07T02:00:00.000Z");
    const breakdown = estimateDeepSeekCostBreakdown(
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheHitTokens: 500_000,
        cacheMissTokens: 500_000,
      },
      at,
    );

    assert.equal(
      breakdown.inputCostUsd,
      (500_000 / 1_000_000) * DEEPSEEK_V4_FLASH_PEAK_RATES.inputCacheHitPerMillion +
        (500_000 / 1_000_000) * DEEPSEEK_V4_FLASH_PEAK_RATES.inputCacheMissPerMillion,
    );
  });
});

describe("getDeepSeekPricingStatus", () => {
  it("returns null wait when off-peak", () => {
    const status = getDeepSeekPricingStatus(Date.parse("2026-09-07T05:00:00.000Z"));
    assert.equal(status.tier, "off_peak");
    assert.equal(status.msUntilOffPeak, null);
    assert.equal(status.nextOffPeakAtMs, null);
  });

  it("returns wait until 04:00 UTC during morning peak", () => {
    const at = Date.parse("2026-09-07T02:30:00.000Z");
    const status = getDeepSeekPricingStatus(at);
    assert.equal(status.tier, "peak");
    assert.equal(status.msUntilOffPeak, 90 * 60 * 1000);
    assert.equal(status.nextOffPeakAtMs, Date.parse("2026-09-07T04:00:00.000Z"));
  });

  it("returns wait until 10:00 UTC during day peak", () => {
    const at = Date.parse("2026-09-07T08:00:00.000Z");
    const status = getDeepSeekPricingStatus(at);
    assert.equal(status.tier, "peak");
    assert.equal(status.msUntilOffPeak, 2 * 60 * 60 * 1000);
    assert.equal(status.nextOffPeakAtMs, Date.parse("2026-09-07T10:00:00.000Z"));
  });
});

describe("formatDurationMs", () => {
  it("formats sub-hour durations in minutes", () => {
    assert.equal(formatDurationMs(30 * 60 * 1000), "30 min");
  });

  it("formats hour and minute durations", () => {
    assert.equal(formatDurationMs(90 * 60 * 1000), "1h 30m");
  });
});

describe("estimateDeepSeekOffPeakOptimizedBreakdown", () => {
  it("uses off-peak rates for cached and uncached input plus output", () => {
    const breakdown = estimateDeepSeekOffPeakOptimizedBreakdown({
      cacheHitTokens: 2_000_000,
      cacheMissTokens: 1_000_000,
      outputTokens: 100_000,
    });

    assert.equal(
      breakdown.totalCostUsd,
      (2_000_000 / 1_000_000) * DEEPSEEK_V4_FLASH_OFF_PEAK_RATES.inputCacheHitPerMillion +
        (1_000_000 / 1_000_000) * DEEPSEEK_V4_FLASH_OFF_PEAK_RATES.inputCacheMissPerMillion +
        (100_000 / 1_000_000) * DEEPSEEK_V4_FLASH_OFF_PEAK_RATES.outputPerMillion,
    );
  });
});
