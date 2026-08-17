/**
 * Organization fuzzy duplicate-group clustering tests.
 * Run: npx tsx --test scripts/test-org-duplicate-groups.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildOrgDuplicateGroups } from "../lib/organizations/duplicate-groups";
import type { OrgFingerprintSummary } from "../lib/organizations/fingerprint-list";
import {
  canonicalizeOrgNameForFuzzyMatch,
  orgNameSimilarity,
  ORG_NAME_FUZZY_THRESHOLD,
} from "../lib/organizations/org-name-fuzzy";

function org(
  partial: Partial<OrgFingerprintSummary> & { id: string; displayName: string },
): OrgFingerprintSummary {
  return {
    name: partial.name ?? partial.displayName,
    organization_role: null,
    email: null,
    phone: null,
    website: null,
    aliases: [],
    sourceMergeCount: 0,
    sourceEmailCount: 0,
    modelIds: [],
    ...partial,
  };
}

describe("canonicalizeOrgNameForFuzzyMatch", () => {
  it("strips trailing legal suffixes", () => {
    assert.equal(
      canonicalizeOrgNameForFuzzyMatch("Acme Property Management Inc."),
      "acme property management",
    );
    assert.equal(
      canonicalizeOrgNameForFuzzyMatch("Acme Property Management Ltd"),
      "acme property management",
    );
    assert.equal(canonicalizeOrgNameForFuzzyMatch("Foo LLC"), "foo");
    assert.equal(canonicalizeOrgNameForFuzzyMatch("Bar Corporation"), "bar");
  });

  it("keeps core tokens that look like suffixes when they are the whole name", () => {
    assert.equal(canonicalizeOrgNameForFuzzyMatch("Limited"), "limited");
  });
});

describe("orgNameSimilarity", () => {
  it("scores Inc / Ltd variants highly", () => {
    const score = orgNameSimilarity(
      "ICC Property Management Inc.",
      "ICC Property Management Ltd",
    );
    assert.ok(
      score >= ORG_NAME_FUZZY_THRESHOLD,
      `expected ≥ ${ORG_NAME_FUZZY_THRESHOLD}, got ${score}`,
    );
  });

  it("scores near-spelling variants highly", () => {
    const score = orgNameSimilarity(
      "Studio PM",
      "StudioPM",
    );
    assert.ok(score >= ORG_NAME_FUZZY_THRESHOLD, `got ${score}`);
  });

  it("keeps unrelated names below threshold", () => {
    const score = orgNameSimilarity(
      "Acme Roofing",
      "Zenith Elevators",
    );
    assert.ok(score < ORG_NAME_FUZZY_THRESHOLD, `got ${score}`);
  });
});

describe("buildOrgDuplicateGroups", () => {
  it("groups fuzzy name variants and leaves unique orgs out", () => {
    const groups = buildOrgDuplicateGroups([
      org({
        id: "1",
        displayName: "ICC Property Management Inc.",
        name: "ICC Property Management Inc.",
        sourceEmailCount: 8,
      }),
      org({
        id: "2",
        displayName: "ICC Property Management Ltd",
        name: "ICC Property Management Ltd",
        sourceEmailCount: 3,
      }),
      org({
        id: "3",
        displayName: "ICC Property Management",
        name: "ICC Property Management",
        aliases: ["ICC Prop Mgmt"],
        sourceEmailCount: 1,
      }),
      org({
        id: "4",
        displayName: "Zenith Elevators",
        name: "Zenith Elevators",
        sourceEmailCount: 10,
      }),
    ]);

    assert.equal(groups.length, 1);
    const group = groups[0]!;
    assert.equal(group.kind, "fuzzy_name");
    assert.equal(group.memberCount, 3);
    assert.ok(group.members.every((m) => m.id !== "4"));
    // Highest mention count becomes the label preference.
    assert.equal(group.label, "ICC Property Management Inc.");
    assert.ok(group.minLinkScore >= ORG_NAME_FUZZY_THRESHOLD);
  });

  it("clusters via transitive links", () => {
    const groups = buildOrgDuplicateGroups([
      org({ id: "a", displayName: "Acme Building Services Inc" }),
      org({ id: "b", displayName: "Acme Building Services Ltd" }),
      org({ id: "c", displayName: "Acme Building Services" }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.memberCount, 3);
  });

  it("matches via aliases", () => {
    const groups = buildOrgDuplicateGroups([
      org({
        id: "a",
        displayName: "Primary Corp",
        name: "Primary Corp",
        aliases: ["Secondary Holdings Inc"],
      }),
      org({
        id: "b",
        displayName: "Secondary Holdings Ltd",
        name: "Secondary Holdings Ltd",
      }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.memberCount, 2);
  });

  it("skips nameless orgs", () => {
    const groups = buildOrgDuplicateGroups([
      org({ id: "a", displayName: "—", name: null }),
      org({ id: "b", displayName: "—", name: null }),
      org({ id: "c", displayName: "Real Co", name: "Real Co" }),
    ]);
    assert.equal(groups.length, 0);
  });
});
