/**
 * Run: npx tsx --test scripts/test-harvest-after-sync-kinds.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEGACY_DEFAULT_HARVEST_AFTER_SYNC_KINDS,
  normalizeHarvestAfterSyncKindsInput,
  parseHarvestAfterSyncKindsJson,
  serializeHarvestAfterSyncKinds,
} from "../lib/email/harvest-after-sync-kinds";

describe("parseHarvestAfterSyncKindsJson", () => {
  it("uses legacy defaults when null", () => {
    assert.deepEqual(parseHarvestAfterSyncKindsJson(null), [
      ...LEGACY_DEFAULT_HARVEST_AFTER_SYNC_KINDS,
    ]);
  });

  it("orders enabled kinds and drops unknown values", () => {
    assert.deepEqual(
      parseHarvestAfterSyncKindsJson(
        '["projects","contacts","bogus","todos"]',
      ),
      ["contacts", "todos", "projects"],
    );
  });
});

describe("normalizeHarvestAfterSyncKindsInput", () => {
  it("rejects non-arrays", () => {
    assert.equal(normalizeHarvestAfterSyncKindsInput("contacts"), null);
  });

  it("returns ordered kinds", () => {
    assert.deepEqual(
      normalizeHarvestAfterSyncKindsInput(["events", "contacts"]),
      ["contacts", "events"],
    );
  });
});

describe("serializeHarvestAfterSyncKinds", () => {
  it("round-trips through parse", () => {
    const kinds = ["contacts", "projects", "todos"] as const;
    const json = serializeHarvestAfterSyncKinds(kinds);
    assert.deepEqual(parseHarvestAfterSyncKindsJson(json), [
      "contacts",
      "todos",
      "projects",
    ]);
  });
});
