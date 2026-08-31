/**
 * Gemini list vs intro pricing (3.6 / 3.7 Flash 50% off through 2026-12-31).
 * Run: npx tsx --test scripts/test-gemini-pricing.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  billedPricingForModel,
  formatUsdPerMillion,
  GEMINI_FLASH_INTRO_UNTIL_MS,
  geminiFlashIntroPricingActive,
  listPricingForModel,
} from "../lib/gemini/pricing";
import { estimateCostUsd } from "../lib/gemini/usage";

const INTRO_MS = Date.parse("2026-08-22T00:00:00.000Z");
const AFTER_INTRO_MS = GEMINI_FLASH_INTRO_UNTIL_MS;
const FLASH_LIST = { input: 1.5, output: 7.5 };
const FLASH_INTRO = { input: 0.75, output: 3.75 };

describe("Gemini Flash intro pricing window", () => {
  it("is active through 2026-12-31 UTC", () => {
    assert.equal(geminiFlashIntroPricingActive(INTRO_MS), true);
    assert.equal(
      geminiFlashIntroPricingActive(Date.parse("2026-12-31T23:59:59.000Z")),
      true,
    );
    assert.equal(geminiFlashIntroPricingActive(AFTER_INTRO_MS), false);
  });

  it("prices 3.6 and 3.7 Flash the same (50% off list through 2026)", () => {
    for (const id of ["gemini-3.6-flash", "gemini-3.7-flash"] as const) {
      assert.deepEqual(listPricingForModel(id), FLASH_LIST);
      assert.deepEqual(billedPricingForModel(id, INTRO_MS), FLASH_INTRO);
      assert.deepEqual(billedPricingForModel(id, AFTER_INTRO_MS), FLASH_LIST);
    }
  });

  it("does not discount other Gemini models", () => {
    assert.deepEqual(billedPricingForModel("gemini-2.5-flash", INTRO_MS), {
      input: 0.3,
      output: 2.5,
    });
  });
});

describe("formatUsdPerMillion", () => {
  it("uses two decimals for Flash intro rates", () => {
    assert.equal(formatUsdPerMillion(0.75), "0.75");
    assert.equal(formatUsdPerMillion(3.75), "3.75");
    assert.equal(formatUsdPerMillion(1.5), "1.50");
  });
});

describe("estimateCostUsd intro rates", () => {
  it("bills 3.6 and 3.7 Flash at $0.75/$3.75 during the intro window", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    for (const id of ["gemini-3.6-flash", "gemini-3.7-flash"] as const) {
      assert.equal(estimateCostUsd(id, usage, INTRO_MS), 0.75 + 3.75);
      assert.equal(estimateCostUsd(id, usage, AFTER_INTRO_MS), 1.5 + 7.5);
    }
  });
});
