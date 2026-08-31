/**
 * Project fuzzy duplicate-group clustering tests.
 * Run: npx tsx --test scripts/test-project-duplicate-groups.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProjectDuplicateGroups,
  projectDuplicatesWaitReason,
} from "../lib/projects/duplicate-groups";
import type { ProjectFingerprintSummary } from "../lib/projects/fingerprint-list";
import {
  canonicalizeProjectNameForFuzzyMatch,
  projectNameSimilarity,
  PROJECT_NAME_FUZZY_THRESHOLD,
} from "../lib/projects/project-name-fuzzy";

function project(
  partial: Partial<ProjectFingerprintSummary> & {
    id: string;
    displayName: string;
  },
): ProjectFingerprintSummary {
  return {
    name: partial.name ?? partial.displayName,
    year_hint: null,
    phase: null,
    contractor: null,
    location: null,
    equipment_mentions: null,
    scope: null,
    aliases: [],
    sourceMergeCount: 0,
    sourceEmailCount: 0,
    modelIds: [],
    boardReportCount: 0,
    boardLastReportAt: null,
    ...partial,
  };
}

describe("canonicalizeProjectNameForFuzzyMatch", () => {
  it("strips trailing legal suffixes", () => {
    assert.equal(
      canonicalizeProjectNameForFuzzyMatch("Acme Property Management Inc."),
      "acme property management",
    );
    assert.equal(
      canonicalizeProjectNameForFuzzyMatch("Acme Property Management Ltd"),
      "acme property management",
    );
    assert.equal(canonicalizeProjectNameForFuzzyMatch("Foo LLC"), "foo");
    assert.equal(canonicalizeProjectNameForFuzzyMatch("Bar Corporation"), "bar");
  });

  it("keeps core tokens that look like suffixes when they are the whole name", () => {
    assert.equal(canonicalizeProjectNameForFuzzyMatch("Limited"), "limited");
  });
});

describe("projectNameSimilarity", () => {
  it("scores Inc / Ltd variants highly", () => {
    const score = projectNameSimilarity(
      "ICC Property Management Inc.",
      "ICC Property Management Ltd",
    );
    assert.ok(
      score >= PROJECT_NAME_FUZZY_THRESHOLD,
      `expected ≥ ${PROJECT_NAME_FUZZY_THRESHOLD}, got ${score}`,
    );
  });

  it("scores near-spelling variants highly", () => {
    const score = projectNameSimilarity("Studio PM", "StudioPM");
    assert.ok(score >= PROJECT_NAME_FUZZY_THRESHOLD, `got ${score}`);
  });

  it("keeps unrelated names below threshold", () => {
    const score = projectNameSimilarity("Acme Roofing", "Zenith Elevators");
    assert.ok(score < PROJECT_NAME_FUZZY_THRESHOLD, `got ${score}`);
  });
});

describe("buildProjectDuplicateGroups", () => {
  it("groups fuzzy name variants and leaves unique projects out", () => {
    const groups = buildProjectDuplicateGroups([
      project({
        id: "1",
        displayName: "ICC Property Management Inc.",
        name: "ICC Property Management Inc.",
        sourceEmailCount: 8,
      }),
      project({
        id: "2",
        displayName: "ICC Property Management Ltd",
        name: "ICC Property Management Ltd",
        sourceEmailCount: 3,
      }),
      project({
        id: "3",
        displayName: "ICC Property Management",
        name: "ICC Property Management",
        aliases: ["ICC Prop Mgmt"],
        sourceEmailCount: 1,
      }),
      project({
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
    assert.equal(group.label, "ICC Property Management Inc.");
    assert.ok(group.minLinkScore >= PROJECT_NAME_FUZZY_THRESHOLD);
  });

  it("clusters via transitive links", () => {
    const groups = buildProjectDuplicateGroups([
      project({ id: "a", displayName: "Acme Building Services Inc" }),
      project({ id: "b", displayName: "Acme Building Services Ltd" }),
      project({ id: "c", displayName: "Acme Building Services" }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.memberCount, 3);
  });

  it("matches via aliases", () => {
    const groups = buildProjectDuplicateGroups([
      project({
        id: "a",
        displayName: "Primary Corp",
        name: "Primary Corp",
        aliases: ["Secondary Holdings Inc"],
      }),
      project({
        id: "b",
        displayName: "Secondary Holdings Ltd",
        name: "Secondary Holdings Ltd",
      }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.memberCount, 2);
  });

  it("skips nameless projects", () => {
    const groups = buildProjectDuplicateGroups([
      project({ id: "a", displayName: "—", name: null }),
      project({ id: "b", displayName: "—", name: null }),
      project({ id: "c", displayName: "Real Co", name: "Real Co" }),
    ]);
    assert.equal(groups.length, 0);
  });
});

const idleWait = {
  groupsLoading: false,
  reviewStatusLoading: false,
  reviewRunning: false,
  startingReview: false,
  cancellingReview: false,
  pagePending: false,
  pageMessage: null as string | null,
};

describe("projectDuplicatesWaitReason", () => {
  it("is silent when nothing is in flight", () => {
    assert.equal(projectDuplicatesWaitReason(idleWait), null);
  });

  it("explains a registry rebuild wait before review status", () => {
    assert.match(
      projectDuplicatesWaitReason({ ...idleWait, groupsLoading: true }),
      /duplicate groups/,
    );
  });

  it("explains identity-review status load after groups are on screen", () => {
    assert.equal(
      projectDuplicatesWaitReason({ ...idleWait, reviewStatusLoading: true }),
      "Loading identity-review status…",
    );
  });

  it("uses the page message when another Projects action holds the UI", () => {
    assert.equal(
      projectDuplicatesWaitReason({
        ...idleWait,
        pagePending: true,
        pageMessage: "Syncing project registry and resolving mentions…",
      }),
      "Syncing project registry and resolving mentions…",
    );
  });
});
