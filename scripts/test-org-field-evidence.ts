/**
 * Org field evidence matching (alias fold + highlight).
 * Run: npx tsx --test scripts/test-org-field-evidence.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findCaseInsensitiveRanges,
  headerReasonsForOrgEmail,
  orgCardMatchesEvidenceValue,
  orgHighlightMatchesEvidenceValue,
} from "../lib/organizations/registry-evidence-shared";

describe("orgCardMatchesEvidenceValue", () => {
  it("matches an alias that was originally a card name", () => {
    const card = {
      name: "Gartenburg",
      organization_role: null,
      email: "pgartenburg@gmail.com",
      phone: null,
      website: null,
      aliases: [],
    };
    assert.equal(
      orgCardMatchesEvidenceValue(card, "name_alias", "Gartenburg"),
      true,
    );
    assert.equal(
      orgCardMatchesEvidenceValue(card, "email", "pgartenburg@gmail.com"),
      true,
    );
  });

  it("matches a folded alias on the survivor card", () => {
    const card = {
      name: "TSCC # 2517",
      organization_role: null,
      email: null,
      phone: null,
      website: null,
      aliases: ["Studio 1", "Gartenburg"],
    };
    assert.equal(
      orgCardMatchesEvidenceValue(card, "name_alias", "Gartenburg"),
      true,
    );
    assert.equal(
      orgCardMatchesEvidenceValue(card, "name_alias", "Studio 1"),
      true,
    );
    assert.equal(
      orgCardMatchesEvidenceValue(card, "name", "Gartenburg"),
      false,
    );
  });
});

describe("orgHighlightMatchesEvidenceValue", () => {
  it("treats pass-1 organization_names as alias evidence", () => {
    const extraction = {
      organization_names: ["Gartenburg", "TSCC 2517"],
      phones: [],
      organization_roles: [],
      websites: [],
    };
    assert.equal(
      orgHighlightMatchesEvidenceValue(extraction, "name_alias", "Gartenburg"),
      true,
    );
    assert.equal(
      orgHighlightMatchesEvidenceValue(extraction, "email", "x@y.com"),
      false,
    );
  });
});

describe("findCaseInsensitiveRanges", () => {
  it("finds the alias in authored text", () => {
    const text = "Please copy Gartenburg on the board package.";
    assert.deepEqual(findCaseInsensitiveRanges(text, "gartenburg"), [
      { start: 12, end: 22 },
    ]);
  });
});

describe("headerReasonsForOrgEmail", () => {
  it("flags From when the address is the sender", () => {
    const reasons = headerReasonsForOrgEmail("email", "pgartenburg@gmail.com", {
      fromAddress: "Paul Gartenburg <pgartenburg@gmail.com>",
      toAddresses: ["board@studio1onrichmond.com"],
      ccAddresses: [],
    });
    assert.deepEqual(reasons, ["email_from"]);
  });
});
