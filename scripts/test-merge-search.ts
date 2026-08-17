/**
 * Merge-target search ranking.
 * Run: npx tsx --test scripts/test-merge-search.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  rankMergeOptions,
  scoreMergeMatch,
  type MergeSearchOption,
} from "../lib/contacts/merge-search";

function option(
  displayName: string,
  extra?: Partial<MergeSearchOption>,
): MergeSearchOption {
  return {
    id: extra?.id ?? displayName,
    displayName,
    searchText:
      extra?.searchText ??
      [displayName, extra?.searchText].filter(Boolean).join("\n").toLowerCase(),
    rankHint: extra?.rankHint,
  };
}

describe("scoreMergeMatch", () => {
  it("scores an exact given-name token above a Johnson substring", () => {
    const wilson = scoreMergeMatch(option("John Wilson"), "john");
    const aJohnson = scoreMergeMatch(option("A. Johnson"), "john");
    const adam = scoreMergeMatch(option("Adam Johnson"), "john");
    assert.ok(wilson > aJohnson);
    assert.ok(wilson > adam);
  });

  it("still matches Johnson as a weaker hit", () => {
    assert.ok(scoreMergeMatch(option("A. Johnson"), "john") > 0);
    assert.ok(scoreMergeMatch(option("Adam Johnson"), "john") > 0);
  });
});

describe("rankMergeOptions", () => {
  it("puts John Wilson first when searching john among Johnsons", () => {
    const ranked = rankMergeOptions(
      [
        option("A. Johnson", { rankHint: 8 }),
        option("Adam Johnson", { rankHint: 8582 }),
        option("John Wilson", { rankHint: 10126 }),
        option("jwilson@propertymanagement.com", {
          rankHint: 6,
          searchText: "jwilson@propertymanagement.com",
        }),
      ],
      "john",
    );
    assert.equal(ranked[0]?.displayName, "John Wilson");
  });

  it("does not drop John Wilson when many Johnsons fill the 25-cap", () => {
    const johnsonCrowd = Array.from({ length: 40 }, (_, i) =>
      option(`Alex Johnson ${i}`, { rankHint: 10 + i }),
    );
    const ranked = rankMergeOptions(
      [...johnsonCrowd, option("John Wilson", { rankHint: 10126 })],
      "john",
    );
    assert.ok(ranked.some((row) => row.displayName === "John Wilson"));
    assert.equal(ranked[0]?.displayName, "John Wilson");
    assert.equal(ranked.length, 25);
  });

  it("matches email local-parts that do not contain the given name", () => {
    const ranked = rankMergeOptions(
      [
        option("jwilson@propertymanagement.com", {
          searchText: "jwilson@propertymanagement.com",
        }),
      ],
      "jwilson",
    );
    assert.equal(ranked.length, 1);
  });
});
