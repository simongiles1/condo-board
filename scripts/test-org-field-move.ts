/**
 * Move one org alias / email / phone / website between cards.
 * Run: npx tsx --test scripts/test-org-field-move.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OrgEntityCard } from "../lib/email-analysis/org-highlight-shared";
import { applyOrgFieldMoveToCards } from "../lib/organizations/field-attachments";

function card(
  partial: Partial<OrgEntityCard> & { name: string },
): OrgEntityCard {
  return {
    name: partial.name,
    organization_role: partial.organization_role ?? null,
    email: partial.email ?? null,
    phone: partial.phone ?? null,
    website: partial.website ?? null,
    aliases: [...(partial.aliases ?? [])],
  };
}

const office = card({
  name: "Studio on Richmond Management Office",
  organization_role: "Property Management Company",
  email: "studiopm@iccpropertymanagement.com",
  aliases: [
    "Studio 1 Property Management",
    "Studio 1",
    "ICC Property Management",
  ],
});

const icc = card({
  name: "ICC Property Management Ltd.",
  organization_role: "Property Management Company",
  email: "jwilson@iccpropertymanagement.com",
  aliases: ["ICC Property Management", "ICC"],
});

const tscc = card({
  name: "Studio on Richmond – TSCC 2517",
  organization_role: "Condominium Corporation",
  aliases: ["Studio 1", "Studio Richmond"],
});

describe("applyOrgFieldMoveToCards", () => {
  it("moves an alias from the office card onto ICC without merging cards", () => {
    const next = applyOrgFieldMoveToCards({
      cards: [office, icc, tscc],
      field: "name_alias",
      value: "Studio 1 Property Management",
      sourceOrgKey: "name:studio on richmond management office",
      sourceNameKey: "studio on richmond management office",
      targetOrgKey: "email:jwilson@iccpropertymanagement.com",
      targetNameKey: "icc property management ltd",
    });

    const movedOffice = next.find(
      (row) => row.name === "Studio on Richmond Management Office",
    );
    const movedIcc = next.find(
      (row) => row.name === "ICC Property Management Ltd.",
    );
    const movedTscc = next.find(
      (row) => row.name === "Studio on Richmond – TSCC 2517",
    );

    assert.ok(movedOffice);
    assert.ok(movedIcc);
    assert.ok(movedTscc);
    assert.equal(next.length, 3);
    assert.deepEqual(movedOffice!.aliases, ["Studio 1", "ICC Property Management"]);
    assert.deepEqual(movedIcc!.aliases, [
      "ICC Property Management",
      "ICC",
      "Studio 1 Property Management",
    ]);
    assert.deepEqual(movedTscc!.aliases, ["Studio 1", "Studio Richmond"]);
  });

  it("moves an email onto ICC and leaves the other cards' mailboxes", () => {
    const next = applyOrgFieldMoveToCards({
      cards: [office, icc, tscc],
      field: "email",
      value: "studiopm@iccpropertymanagement.com",
      sourceOrgKey: "name:studio on richmond management office",
      sourceNameKey: "studio on richmond management office",
      targetOrgKey: "email:jwilson@iccpropertymanagement.com",
      targetNameKey: "icc property management ltd",
    });

    const movedOffice = next.find(
      (row) => row.name === "Studio on Richmond Management Office",
    );
    const movedIcc = next.find(
      (row) => row.name === "ICC Property Management Ltd.",
    );

    assert.equal(movedOffice!.email, null);
    assert.equal(
      movedIcc!.email,
      "jwilson@iccpropertymanagement.com\nstudiopm@iccpropertymanagement.com",
    );
  });

  it("does not duplicate an alias that already matches the target primary name", () => {
    const next = applyOrgFieldMoveToCards({
      cards: [office, icc],
      field: "name_alias",
      value: "ICC Property Management Ltd.",
      sourceOrgKey: "name:studio on richmond management office",
      sourceNameKey: "studio on richmond management office",
      targetOrgKey: "email:jwilson@iccpropertymanagement.com",
      targetNameKey: "icc property management ltd",
    });

    const movedIcc = next.find(
      (row) => row.name === "ICC Property Management Ltd.",
    );
    assert.deepEqual(movedIcc!.aliases, ["ICC Property Management", "ICC"]);
  });
});
