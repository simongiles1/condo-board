/**
 * Project mention staging helpers.
 * Run: npx tsx --test scripts/test-project-mentions.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProjectEntityCard } from "../lib/email-analysis/project-highlight-shared";
import {
  cardToProjectMentionCard,
  projectMentionFingerprint,
  projectMentionIdentityKey,
  projectMentionIsMinted,
} from "../lib/projects/mention-shared";

function card(
  partial: Partial<ProjectEntityCard> & { name: string },
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

describe("cardToProjectMentionCard", () => {
  it("requires a work name", () => {
    assert.equal(
      cardToProjectMentionCard({
        name: null,
        year_hint: "2024",
        phase: null,
        contractor: "Otis",
        location: null,
        equipment_mentions: null,
      }),
      null,
    );
  });

  it("copies typed staging fields", () => {
    const mention = cardToProjectMentionCard(
      card({
        name: "Maglock installation",
        year_hint: "2024",
        contractor: "ABC Locks",
        phase: "tender",
        location: "front doors",
      }),
    );
    assert.ok(mention);
    assert.equal(mention!.raw_name, "Maglock installation");
    assert.equal(mention!.year_hint, "2024");
    assert.equal(mention!.contractor, "ABC Locks");
  });
});

describe("projectMentionFingerprint", () => {
  it("is stable across casing", () => {
    const a = projectMentionFingerprint({
      raw_name: "Maglock Installation",
      contractor: "ABC Locks",
      year_hint: "2024",
      phase: null,
      location: null,
    });
    const b = projectMentionFingerprint({
      raw_name: "maglock installation",
      contractor: "abc locks",
      year_hint: "2024",
      phase: "tender",
      location: "lobby",
    });
    assert.equal(a, b);
  });
});

describe("projectMentionIsMinted", () => {
  it("rejects a card whose name is the contractor", () => {
    const mention = cardToProjectMentionCard(
      card({ name: "Applied System Technology", contractor: "Applied System Technology" }),
    );
    assert.ok(mention);
    assert.equal(projectMentionIsMinted(mention!), false);
  });

  it("rejects a card whose name matches an organization identity", () => {
    const mention = cardToProjectMentionCard(card({ name: "ICC Property Management" }));
    assert.ok(mention);
    assert.equal(
      projectMentionIsMinted(
        mention!,
        new Set(["icc property management"]),
      ),
      false,
    );
  });

  it("keeps a named job", () => {
    const mention = cardToProjectMentionCard(
      card({ name: "Maglock installation", year_hint: "2024" }),
    );
    assert.ok(mention);
    assert.equal(projectMentionIsMinted(mention!), true);
    assert.ok(projectMentionIdentityKey(mention!).includes("year:"));
  });
});
