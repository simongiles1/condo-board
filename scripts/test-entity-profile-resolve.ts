/**
 * Unique fingerprint → registry id matching (no DB).
 * Run: npx tsx --test scripts/test-entity-profile-resolve.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  pickUniqueOrgId,
  pickUniquePersonId,
  pickUniqueProjectId,
  type OrgResolveCandidate,
  type PersonResolveCandidate,
  type ProjectResolveCandidate,
} from "../lib/entities/entity-profile-resolve";

const dan: PersonResolveCandidate = {
  id: "person-dan",
  sparseStub: false,
  firstName: "Dan",
  lastName: "Smith",
  emails: ["dan@studio.ca"],
  phonesNormalized: ["4165550101"],
};

const otherDan: PersonResolveCandidate = {
  id: "person-dan-2",
  sparseStub: false,
  firstName: "Dan",
  lastName: "Smith",
  emails: ["dan.other@studio.ca"],
  phonesNormalized: ["4165550199"],
};

const stubDan: PersonResolveCandidate = {
  id: "person-stub",
  sparseStub: true,
  firstName: "Dan",
  lastName: "Smith",
  emails: [],
  phonesNormalized: [],
};

describe("pickUniquePersonId", () => {
  it("matches a unique email", () => {
    assert.equal(
      pickUniquePersonId([dan, otherDan], { email: "Dan@studio.ca" }),
      "person-dan",
    );
  });

  it("returns null when two people share the email", () => {
    const twin = { ...otherDan, emails: ["dan@studio.ca"] };
    assert.equal(
      pickUniquePersonId([dan, twin], { email: "dan@studio.ca" }),
      null,
    );
  });

  it("matches a unique phone", () => {
    assert.equal(
      pickUniquePersonId([dan, otherDan], { phone: "(416) 555-0101" }),
      "person-dan",
    );
  });

  it("matches unique first+last and skips sparse stubs", () => {
    assert.equal(
      pickUniquePersonId([dan, stubDan], {
        firstName: "Dan",
        lastName: "Smith",
      }),
      "person-dan",
    );
  });

  it("returns null when two non-stub people share first+last", () => {
    assert.equal(
      pickUniquePersonId([dan, otherDan], {
        firstName: "Dan",
        lastName: "Smith",
      }),
      null,
    );
  });

  it("returns null without a strong hint", () => {
    assert.equal(pickUniquePersonId([dan], { firstName: "Dan" }), null);
  });
});

const icc: OrgResolveCandidate = { id: "org-icc", name: "ICC Property Management Ltd." };
const tcg: OrgResolveCandidate = { id: "org-tcg", name: "Trace Consulting Group" };

describe("pickUniqueOrgId", () => {
  it("matches a unique name after legal-suffix strip", () => {
    assert.equal(
      pickUniqueOrgId([icc, tcg], "ICC Property Management"),
      "org-icc",
    );
  });

  it("returns null when two orgs normalize to the same name", () => {
    const twin = { id: "org-icc-2", name: "ICC Property Management Inc." };
    assert.equal(pickUniqueOrgId([icc, twin], "ICC Property Management"), null);
  });

  it("returns null for an empty name", () => {
    assert.equal(pickUniqueOrgId([icc], "  "), null);
  });
});

const maglock2024: ProjectResolveCandidate = {
  id: "proj-2024",
  name: "Maglock",
  aliases: ["magnet"],
  yearHint: "2024",
};

const maglock2026: ProjectResolveCandidate = {
  id: "proj-2026",
  name: "Electromagnetic locking devices",
  aliases: ["Maglock"],
  yearHint: "2026",
};

describe("pickUniqueProjectId", () => {
  it("uses year to split same-name jobs", () => {
    assert.equal(
      pickUniqueProjectId([maglock2024, maglock2026], {
        name: "Maglock",
        yearHint: "2024",
      }),
      "proj-2024",
    );
  });

  it("matches a unique alias when years are absent", () => {
    assert.equal(
      pickUniqueProjectId(
        [{ ...maglock2024, yearHint: null }],
        { name: "magnet" },
      ),
      "proj-2024",
    );
  });

  it("returns null when two cards share the name and no year is given", () => {
    assert.equal(
      pickUniqueProjectId([maglock2024, maglock2026], { name: "Maglock" }),
      null,
    );
  });
});
