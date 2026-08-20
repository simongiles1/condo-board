/**
 * Entities registry pagination helpers.
 * Run: npx tsx --test scripts/test-registry-page.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clampEntityListPage,
  entityListPageCount,
  parseEntityListLimit,
  sliceEntityListPage,
} from "../lib/entities/registry-page";

describe("entityListPageCount", () => {
  it("uses 100-item pages and never returns zero pages", () => {
    assert.equal(entityListPageCount(0), 1);
    assert.equal(entityListPageCount(100), 1);
    assert.equal(entityListPageCount(101), 2);
    assert.equal(entityListPageCount(1201), 13);
  });
});

describe("sliceEntityListPage", () => {
  it("returns the requested page and clamps overflow", () => {
    const items = Array.from({ length: 250 }, (_, i) => i + 1);
    assert.deepEqual(sliceEntityListPage(items, 1), items.slice(0, 100));
    assert.deepEqual(sliceEntityListPage(items, 3), items.slice(200, 250));
    assert.deepEqual(sliceEntityListPage(items, 99), items.slice(200, 250));
    assert.equal(clampEntityListPage(0, 250), 1);
  });
});

describe("parseEntityListLimit", () => {
  it("treats omitted/all as uncapped", () => {
    assert.equal(parseEntityListLimit(null), undefined);
    assert.equal(parseEntityListLimit("all"), undefined);
    assert.equal(parseEntityListLimit("500"), 500);
  });
});
