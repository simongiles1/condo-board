/**
 * Org field denials after moving identity email off a card.
 * Run: npx tsx --test scripts/test-org-field-denials.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { coalesceOrgEntityCards } from "../lib/email-analysis/org-highlight-shared";
import {
  applyOrgFieldDenialsToCards,
  orgCardMatchesFieldDenial,
  orgIdentityKey,
  type OrgFieldDenial,
} from "../lib/organizations/field-denials";
import {
  applyResidualEmailsFromMovedIdentityBuckets,
  residualEmailsFromIdentityBucket,
} from "../lib/organizations/identity-email-bucket";

const studioName = "Studio on Richmond Management Office";
const studioEmail = "studiopm@icc.test";

const emailMoveDenial: OrgFieldDenial = {
  id: "deny-1",
  orgKey: `email:${studioEmail}`,
  field: "email",
  deniedValue: studioEmail,
  nameKey: "studio on richmond management office",
  createdAt: "",
};

describe("orgCardMatchesFieldDenial for moved identity email", () => {
  it("matches the named card and sparse email-only stubs", () => {
    assert.equal(
      orgCardMatchesFieldDenial(
        {
          name: studioName,
          organization_role: "Property Management Company",
          email: studioEmail,
          phone: null,
          website: null,
        },
        emailMoveDenial,
        new Map(),
      ),
      true,
    );
    assert.equal(
      orgCardMatchesFieldDenial(
        {
          name: null,
          organization_role: null,
          email: studioEmail,
          phone: null,
          website: null,
        },
        emailMoveDenial,
        new Map(),
      ),
      true,
    );
    assert.equal(
      orgCardMatchesFieldDenial(
        {
          name: "ICC Property Management Ltd.",
          organization_role: null,
          email: studioEmail,
          phone: null,
          website: null,
        },
        emailMoveDenial,
        new Map(),
      ),
      false,
    );
  });
});

describe("applyOrgFieldDenialsToCards after identity email move", () => {
  it("keeps a name-keyed Studio card and drops the orphan mailbox stub", () => {
    const flat = applyOrgFieldDenialsToCards(
      [
        {
          name: studioName,
          organization_role: "Property Management Company",
          email: studioEmail,
          phone: null,
          website: null,
        },
        {
          name: null,
          organization_role: null,
          email: studioEmail,
          phone: null,
          website: null,
        },
      ],
      [emailMoveDenial],
    );
    const unique = coalesceOrgEntityCards(flat);
    assert.equal(unique.length, 1);
    assert.equal(unique[0]!.name, studioName);
    assert.equal(unique[0]!.email, null);
    assert.equal(orgIdentityKey(unique[0]!), `name:${studioName.toLowerCase()}`);
  });
});

describe("residualEmailsFromIdentityBucket", () => {
  it("collects sibling mailboxes from cards that include the moved address", () => {
    const cards = [
      {
        name: null,
        organization_role: null,
        email:
          "jwilson@icc.test, studiopm@icc.test, bdossantos@icc.test",
        phone: null,
        website: null,
      },
    ];
    const residual = residualEmailsFromIdentityBucket({
      identityOrgKey: `email:${studioEmail}`,
      movedEmailNormalized: studioEmail,
      cards,
    });
    assert.deepEqual(residual.sort(), [
      "bdossantos@icc.test",
      "jwilson@icc.test",
    ]);
  });
});

describe("applyResidualEmailsFromMovedIdentityBuckets", () => {
  it("does not re-add sibling mailboxes that were moved off the name card", () => {
    const harvestCards = [
      {
        name: null,
        organization_role: null,
        email:
          "jwilson@icc.test, studiopm@icc.test, bdossantos@icc.test, jstatham@icc.test",
        phone: null,
        website: null,
      },
    ];
    const denials: OrgFieldDenial[] = [
      emailMoveDenial,
      {
        id: "deny-jw",
        orgKey: `name:${studioName.toLowerCase()}`,
        field: "email",
        deniedValue: "jwilson@icc.test",
        nameKey: "studio on richmond management office",
        createdAt: "",
      },
      {
        id: "deny-bd",
        orgKey: `name:${studioName.toLowerCase()}`,
        field: "email",
        deniedValue: "bdossantos@icc.test",
        nameKey: "studio on richmond management office",
        createdAt: "",
      },
    ];
    const next = applyResidualEmailsFromMovedIdentityBuckets({
      organizations: [
        {
          name: studioName,
          email: null,
        },
      ],
      denials,
      harvestCards,
    });
    assert.equal(next[0]!.email, "jstatham@icc.test");
  });
});
