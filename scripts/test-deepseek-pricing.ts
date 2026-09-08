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
  estimateDeepSeekPeakOptimizedBreakdown,
  formatDeepSeekTierCountdown,
  formatDurationMs,
  getDeepSeekLocalDayTimeline,
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

describe("estimateDeepSeekPeakOptimizedBreakdown", () => {
  it("doubles off-peak optimized totals for the same token profile", () => {
    const usage = {
      cacheHitTokens: 125_440,
      cacheMissTokens: 112_174,
      outputTokens: 96_458,
    };
    const offPeak = estimateDeepSeekOffPeakOptimizedBreakdown(usage);
    const peak = estimateDeepSeekPeakOptimizedBreakdown(usage);
    assert.equal(peak.totalCostUsd, offPeak.totalCostUsd * 2);
  });
});

describe("getDeepSeekPricingStatus", () => {
  it("returns wait until next peak when off-peak on a weekday", () => {
    const at = Date.parse("2026-09-07T05:00:00.000Z");
    const status = getDeepSeekPricingStatus(at);
    assert.equal(status.tier, "off_peak");
    assert.equal(status.nextTier, "peak");
    assert.equal(status.msUntilTierChange, 60 * 60 * 1000);
    assert.equal(status.nextTierChangeAtMs, Date.parse("2026-09-07T06:00:00.000Z"));
  });

  it("returns wait until 04:00 UTC during morning peak", () => {
    const at = Date.parse("2026-09-07T02:30:00.000Z");
    const status = getDeepSeekPricingStatus(at);
    assert.equal(status.tier, "peak");
    assert.equal(status.nextTier, "off_peak");
    assert.equal(status.msUntilTierChange, 90 * 60 * 1000);
    assert.equal(status.nextTierChangeAtMs, Date.parse("2026-09-07T04:00:00.000Z"));
  });

  it("returns wait until 10:00 UTC during day peak", () => {
    const at = Date.parse("2026-09-07T08:00:00.000Z");
    const status = getDeepSeekPricingStatus(at);
    assert.equal(status.tier, "peak");
    assert.equal(status.nextTier, "off_peak");
    assert.equal(status.msUntilTierChange, 2 * 60 * 60 * 1000);
    assert.equal(status.nextTierChangeAtMs, Date.parse("2026-09-07T10:00:00.000Z"));
  });

  it("returns wait until Monday morning peak from Saturday off-peak", () => {
    const at = Date.parse("2026-09-06T15:00:00.000Z");
    const status = getDeepSeekPricingStatus(at);
    assert.equal(status.tier, "off_peak");
    assert.equal(status.nextTier, "peak");
    assert.equal(status.nextTierChangeAtMs, Date.parse("2026-09-07T01:00:00.000Z"));
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

describe("formatDeepSeekTierCountdown", () => {
  it("formats remaining and until variants", () => {
    const status = getDeepSeekPricingStatus(Date.parse("2026-09-07T08:00:00.000Z"));
    assert.match(formatDeepSeekTierCountdown(status, "remaining"), /left in peak/i);
    assert.match(formatDeepSeekTierCountdown(status, "until"), /until off-peak/i);
  });
});

describe("getDeepSeekLocalDayTimeline", () => {
  it("builds contiguous segments that cover the local day", () => {
    const at = Date.parse("2026-09-06T12:00:00.000Z");
    const timeline = getDeepSeekLocalDayTimeline(at);
    assert.ok(timeline.segments.length > 0);
    assert.equal(timeline.segments[0]?.startFraction, 0);
    assert.equal(timeline.segments.at(-1)?.endFraction, 1);
    assert.ok(timeline.nowFraction >= 0 && timeline.nowFraction <= 1);
  });

  it("includes peak segments on a weekday", () => {
    const localMondayNoon = new Date(2026, 8, 7, 12, 0, 0, 0);
    const timeline = getDeepSeekLocalDayTimeline(localMondayNoon.getTime());
    assert.equal(timeline.isAllOffPeakDay, false);
    assert.ok(timeline.segments.some((segment) => segment.tier === "peak"));
    assert.ok(timeline.segments.some((segment) => segment.tier === "off_peak"));
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
