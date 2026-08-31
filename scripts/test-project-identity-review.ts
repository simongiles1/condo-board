/**
 * Project identity-review parsers, apply planner, and going-forward matcher.
 * Run: npx tsx --test scripts/test-project-identity-review.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  projectIdentityKey,
  type ProjectEntityCard,
} from "../lib/email-analysis/project-highlight-shared";
import {
  canonicalizeProjectWorkName,
  compactProjectWorkName,
  projectIdentityKeyWithPolicies,
  projectWorkNameMatchesPolicy,
  type ProjectIdentityPolicy,
} from "../lib/projects/identity-match";
import {
  parseIdentityReviewPass1Clusters,
  parseIdentityReviewPass2Decision,
  parseJsonObjectText,
  planIdentityReviewDecision,
  type IdentityReviewMemberSnapshot,
} from "../lib/projects/identity-review-shared";

function card(
  partial: Partial<ProjectEntityCard> & { name: string | null },
): ProjectEntityCard {
  return {
    name: partial.name,
    year_hint: partial.year_hint ?? null,
    phase: partial.phase ?? null,
    contractor: partial.contractor ?? null,
    location: partial.location ?? null,
    equipment_mentions: partial.equipment_mentions ?? null,
    scope: partial.scope ?? null,
    aliases: partial.aliases ?? [],
  };
}

function member(
  partial: Partial<IdentityReviewMemberSnapshot> & {
    id: string;
    displayName: string;
  },
): IdentityReviewMemberSnapshot {
  return {
    name: partial.name ?? partial.displayName,
    yearHint: partial.yearHint ?? null,
    sourceEmailCount: partial.sourceEmailCount ?? 1,
    aliases: partial.aliases ?? [],
    ...partial,
  };
}

describe("canonicalizeProjectWorkName", () => {
  it("collapses maglock spelling variants to the same stem", () => {
    assert.equal(canonicalizeProjectWorkName("maglock installation"), "maglock");
    assert.equal(canonicalizeProjectWorkName("maglock system"), "maglock");
    assert.equal(canonicalizeProjectWorkName("Maglock Project"), "maglock");
    assert.equal(
      compactProjectWorkName("Mag Locks for Building Security"),
      compactProjectWorkName("maglock"),
    );
  });

  it("keeps distinct cleaning campaigns apart", () => {
    assert.notEqual(
      canonicalizeProjectWorkName("kitchen stack cleaning"),
      canonicalizeProjectWorkName("window cleaning"),
    );
    assert.notEqual(
      canonicalizeProjectWorkName("garage cleaning"),
      canonicalizeProjectWorkName("window cleaning"),
    );
  });
});

describe("parseIdentityReviewPass1Clusters", () => {
  it("keeps multi-member clusters and drops unknown or duplicate ids", () => {
    const known = new Set(["a", "b", "c", "d"]);
    const clusters = parseIdentityReviewPass1Clusters(
      {
        clusters: [
          { label: "Maglock", memberIds: ["a", "b", "missing"] },
          { label: "Kitchen stack", member_ids: ["c", "a"] },
          { label: "Solo", memberIds: ["d"] },
        ],
      },
      known,
    );
    assert.equal(clusters.length, 1);
    assert.deepEqual(clusters[0]!.memberIds, ["a", "b"]);
    assert.equal(clusters[0]!.label, "Maglock");
  });

  it("rejects malformed JSON", () => {
    assert.throws(() => parseJsonObjectText("not json"));
  });
});

describe("parseIdentityReviewPass2Decision", () => {
  it("parses a spanning MagLock decision", () => {
    const parsed = parseIdentityReviewPass2Decision(
      {
        kind: "single_span",
        confidence: "high",
        rationale: "Same capital job across emails.",
        workLabel: "Maglock",
        subgroups: [],
      },
      ["a", "b"],
    );
    assert.equal(parsed.kind, "single_span");
    assert.equal(parsed.confidence, "high");
    assert.equal(parsed.workLabel, "Maglock");
  });

  it("defaults unknown kind to keep_separate", () => {
    const parsed = parseIdentityReviewPass2Decision({ kind: "nope" }, ["a"]);
    assert.equal(parsed.kind, "keep_separate");
  });
});

describe("planIdentityReviewDecision", () => {
  const maglockMembers = [
    member({
      id: "name:maglock installation",
      displayName: "maglock installation",
      sourceEmailCount: 5,
    }),
    member({
      id: "name:maglock system|year:2025",
      displayName: "maglock system (2025)",
      name: "maglock system",
      yearHint: "2025",
      sourceEmailCount: 1,
    }),
    member({
      id: "name:maglock security system at stair f",
      displayName: "Maglock Security System at Stair F",
      sourceEmailCount: 1,
    }),
  ];

  it("auto-merges a high-confidence MagLock span into one survivor", () => {
    const plan = planIdentityReviewDecision({
      clusterLabel: "Maglock",
      clusterMemberIds: maglockMembers.map((m) => m.id),
      members: maglockMembers,
      decision: {
        kind: "single_span",
        confidence: "high",
        rationale: "One capital maglock job.",
        workLabel: "Maglock",
        subgroups: [],
      },
    });
    assert.equal(plan.apply, true);
    assert.equal(plan.merges.length, 1);
    assert.equal(plan.merges[0]!.targetId, "name:maglock installation");
    assert.equal(plan.merges[0]!.sourceIds.length, 2);
    assert.equal(plan.policies.length, 1);
    assert.equal(plan.policies[0]!.policy, "span");
    assert.equal(plan.proposedGroups.length, 0);
  });

  it("leaves medium confidence as proposed groups", () => {
    const plan = planIdentityReviewDecision({
      clusterLabel: "Maglock",
      clusterMemberIds: maglockMembers.map((m) => m.id),
      members: maglockMembers,
      decision: {
        kind: "single_span",
        confidence: "medium",
        rationale: "Likely the same job.",
        workLabel: "Maglock",
        subgroups: [],
      },
    });
    assert.equal(plan.apply, false);
    assert.equal(plan.proposedGroups.length, 1);
    assert.equal(plan.proposedGroups[0]!.memberIds.length, 3);
  });

  it("merges kitchen-stack variants within a year only", () => {
    const members = [
      member({
        id: "ks-2024-a",
        displayName: "kitchen stack cleaning",
        yearHint: "2024",
        sourceEmailCount: 4,
      }),
      member({
        id: "ks-2024-b",
        displayName: "kitchen stack clean",
        yearHint: "2024",
        sourceEmailCount: 1,
      }),
      member({
        id: "ks-2025-a",
        displayName: "Kitchen stack cleaning (2025)",
        name: "Kitchen stack cleaning",
        yearHint: "2025",
        sourceEmailCount: 3,
      }),
      member({
        id: "ks-2025-b",
        displayName: "kitchen stack",
        yearHint: "2025",
        sourceEmailCount: 1,
      }),
    ];
    const plan = planIdentityReviewDecision({
      clusterLabel: "Kitchen stack cleaning",
      clusterMemberIds: members.map((m) => m.id),
      members,
      decision: {
        kind: "recurring_by_year",
        confidence: "high",
        rationale: "Annual campaign.",
        workLabel: "Kitchen stack cleaning",
        subgroups: [],
      },
    });
    assert.equal(plan.apply, true);
    assert.equal(plan.merges.length, 2);
    const years = new Set(plan.policies.map((p) => p.yearHint));
    assert.deepEqual([...years].sort(), ["2024", "2025"]);
    const merge2025 = plan.merges.find((row) => row.targetId === "ks-2025-a");
    assert.ok(merge2025);
    assert.deepEqual(merge2025!.sourceIds, ["ks-2025-b"]);
    assert.ok(!merge2025!.sourceIds.includes("ks-2024-a"));
    assert.ok(plan.policies.every((p) => p.policy === "recurring_year"));
  });
});

describe("projectIdentityKeyWithPolicies", () => {
  const maglockPolicy: ProjectIdentityPolicy = {
    survivorKey: "name:maglock installation",
    workLabel: "Maglock",
    policy: "span",
    aliases: ["maglock system"],
    yearHint: null,
  };
  const kitchen2025: ProjectIdentityPolicy = {
    survivorKey: "name:kitchen stack cleaning|year:2025",
    workLabel: "Kitchen stack cleaning",
    policy: "recurring_year",
    aliases: ["kitchen stack"],
    yearHint: "2025",
  };

  it("does not treat a generic token as a match for a longer work label", () => {
    assert.equal(
      projectWorkNameMatchesPolicy("maglock system", maglockPolicy),
      true,
    );
    assert.equal(
      projectWorkNameMatchesPolicy("window cleaning", maglockPolicy),
      false,
    );
    assert.equal(
      projectWorkNameMatchesPolicy("boiler", {
        workLabel: "boiler replacement",
        aliases: [],
      }),
      false,
    );
  });

  it("remaps maglock system + year onto the MagLock survivor", () => {
    const key = projectIdentityKeyWithPolicies(
      card({ name: "maglock system", year_hint: "2025" }),
      [maglockPolicy],
    );
    assert.equal(key, "name:maglock installation");
  });

  it("does not remap 2026 kitchen stack onto the 2025 survivor", () => {
    const key = projectIdentityKeyWithPolicies(
      card({ name: "kitchen stack cleaning", year_hint: "2026" }),
      [kitchen2025],
    );
    assert.equal(key, "name:kitchen stack cleaning|year:2026");
    assert.notEqual(key, kitchen2025.survivorKey);
  });

  it("keeps Option C when no policy exists", () => {
    const withYear = card({ name: "Maglock", year_hint: "2024" });
    const without = card({ name: "Maglock", year_hint: "2026" });
    assert.notEqual(projectIdentityKey(withYear), projectIdentityKey(without));
    assert.equal(
      projectIdentityKeyWithPolicies(withYear, []),
      projectIdentityKey(withYear),
    );
  });

  it("still remaps a near-spelling onto the MagLock survivor", () => {
    const key = projectIdentityKeyWithPolicies(
      card({ name: "maglok", year_hint: "2025" }),
      [maglockPolicy],
    );
    assert.equal(key, "name:maglock installation");
  });

  it("finds MagLock among many unrelated policies", () => {
    const noise: ProjectIdentityPolicy[] = Array.from(
      { length: 80 },
      (_, i) => ({
        survivorKey: `name:unrelated work ${i}`,
        workLabel: `Window cleaning campaign ${i}`,
        policy: "span" as const,
        aliases: [`facade wash ${i}`],
        yearHint: null,
      }),
    );
    const key = projectIdentityKeyWithPolicies(
      card({ name: "Maglock Security System at Stair F", year_hint: "2025" }),
      [...noise, maglockPolicy],
    );
    assert.equal(key, "name:maglock installation");
  });
});
