/**
 * Org multi-value merge + alias fold helpers.
 * Run: npx tsx --test scripts/test-org-multi-values.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { coalesceOrgEntityCards } from "../lib/email-analysis/org-highlight-shared";
import {
  foldOrgNames,
  mergeOrgMultiValues,
  removeOrgMultiValue,
  splitOrgMultiValue,
} from "../lib/organizations/org-multi-values";

describe("splitOrgMultiValue", () => {
  it("splits newlines, pipes, and semicolons", () => {
    assert.deepEqual(splitOrgMultiValue("a@x.com\nb@y.com"), [
      "a@x.com",
      "b@y.com",
    ]);
    assert.deepEqual(splitOrgMultiValue("a|b;c"), ["a", "b", "c"]);
  });

  it("splits comma-separated mailboxes from harvest output", () => {
    assert.deepEqual(
      splitOrgMultiValue(
        "jwilson@iccpropertymanagement.com, studiopm@iccpropertymanagement.com",
      ),
      [
        "jwilson@iccpropertymanagement.com",
        "studiopm@iccpropertymanagement.com",
      ],
    );
  });
});

describe("mergeOrgMultiValues", () => {
  it("appends emails without overwrite and dedupes", () => {
    assert.equal(
      mergeOrgMultiValues(
        "email",
        "jwilson@iccpropertymanagement.com",
        "office@studio.com",
      ),
      "jwilson@iccpropertymanagement.com\noffice@studio.com",
    );
    assert.equal(
      mergeOrgMultiValues(
        "email",
        "JWilson@iccpropertymanagement.com",
        "jwilson@iccpropertymanagement.com",
      ),
      "JWilson@iccpropertymanagement.com",
    );
  });

  it("dedupes phones by digits", () => {
    assert.equal(
      mergeOrgMultiValues("phone", "(905) 940-1234", "9059401234"),
      "(905) 940-1234",
    );
    assert.equal(
      mergeOrgMultiValues("phone", "(905) 940-1234", "416-555-0100"),
      "(905) 940-1234\n416-555-0100",
    );
  });
});

describe("removeOrgMultiValue", () => {
  it("removes one email from a list", () => {
    assert.equal(
      removeOrgMultiValue("email", "a@x.com\nb@y.com", "B@y.com"),
      "a@x.com",
    );
  });
});

describe("foldOrgNames", () => {
  it("keeps preferred name and stores the other as alias", () => {
    const folded = foldOrgNames({
      preferredName: "ICC Property Management Ltd.",
      otherName: "Studio on Richmond Management Office",
    });
    assert.equal(folded.name, "ICC Property Management Ltd.");
    assert.deepEqual(folded.aliases, [
      "Studio on Richmond Management Office",
    ]);
  });
});

describe("coalesceOrgEntityCards multi-value", () => {
  it("appends phone/website when folding same-email cards", () => {
    const cards = coalesceOrgEntityCards([
      {
        name: "ICC Property Management Ltd.",
        organization_role: "Property Management Company",
        email: "jwilson@iccpropertymanagement.com",
        phone: "(905) 940-1234",
        website: null,
      },
      {
        name: "ICC Property Management Ltd.",
        organization_role: null,
        email: "jwilson@iccpropertymanagement.com",
        phone: "416-555-0100",
        website: "https://example.com",
      },
    ]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]!.phone, "(905) 940-1234\n416-555-0100");
    assert.equal(cards[0]!.website, "https://example.com");
  });

  it("keeps shorter distinct name as alias when coalescing", () => {
    const cards = coalesceOrgEntityCards([
      {
        name: "ICC",
        organization_role: null,
        email: "jwilson@iccpropertymanagement.com",
        phone: null,
        website: null,
      },
      {
        name: "ICC Property Management Ltd.",
        organization_role: null,
        email: "jwilson@iccpropertymanagement.com",
        phone: null,
        website: null,
      },
    ]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]!.name, "ICC Property Management Ltd.");
    assert.deepEqual(cards[0]!.aliases, ["ICC"]);
  });
});
