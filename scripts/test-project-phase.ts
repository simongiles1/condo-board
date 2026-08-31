/**
 * Canonical project phase mapping.
 * Run: npx tsx --test scripts/test-project-phase.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeProjectPhase,
  phasesMatch,
  preferProjectPhase,
  PROJECT_PHASES,
} from "../lib/projects/project-phase";

describe("normalizeProjectPhase", () => {
  it("maps aliases onto the 7-status set", () => {
    assert.equal(normalizeProjectPhase("QUOTE"), "awarded");
    assert.equal(normalizeProjectPhase("quoted"), "awarded");
    assert.equal(normalizeProjectPhase("quotes received"), "awarded");
    assert.equal(normalizeProjectPhase("contract signing"), "awarded");
    assert.equal(normalizeProjectPhase("quotes are being sought"), "tender");
    assert.equal(normalizeProjectPhase("getting quotes"), "tender");
    assert.equal(normalizeProjectPhase("bid process"), "tender");
    assert.equal(normalizeProjectPhase("completed"), "complete");
    assert.equal(normalizeProjectPhase("Proposed"), "planning");
    assert.equal(normalizeProjectPhase("assessment"), "planning");
    assert.equal(normalizeProjectPhase("commencing"), "in progress");
    assert.equal(normalizeProjectPhase("on hold"), "on hold");
    assert.equal(normalizeProjectPhase("canceled"), "cancelled");
  });

  it("drops work-package labels", () => {
    assert.equal(normalizeProjectPhase("Phase 1"), null);
    assert.equal(normalizeProjectPhase("Phase 1 and Phase 2"), null);
    assert.equal(normalizeProjectPhase("Phases 1 & 2"), null);
    assert.equal(normalizeProjectPhase("phases 1&2"), null);
    assert.equal(normalizeProjectPhase("changing them in phases"), null);
  });

  it("maps schedule prose instead of keeping it as a badge", () => {
    assert.equal(
      normalizeProjectPhase(
        "waiting on parts, work expected to begin in a few months",
      ),
      "on hold",
    );
    assert.equal(
      normalizeProjectPhase("inspection completed, maintenance pending"),
      "in progress",
    );
    assert.equal(
      normalizeProjectPhase("will start in the next month or two"),
      "in progress",
    );
  });

  it("exposes the closed set in lifecycle order", () => {
    assert.deepEqual(PROJECT_PHASES, [
      "planning",
      "tender",
      "awarded",
      "in progress",
      "complete",
      "on hold",
      "cancelled",
    ]);
  });
});

describe("phasesMatch", () => {
  it("matches raw extractor text to the canonical status", () => {
    assert.equal(phasesMatch("quoted", "awarded"), true);
    assert.equal(phasesMatch("awarded", "QUOTE"), true);
    assert.equal(phasesMatch("tender", "complete"), false);
  });
});

describe("preferProjectPhase", () => {
  it("keeps the later lifecycle status", () => {
    assert.equal(preferProjectPhase("planning", "tender"), "tender");
    assert.equal(preferProjectPhase("in progress", "complete"), "complete");
  });

  it("treats cancelled as sticky and on-hold as blocking in-flight work", () => {
    assert.equal(preferProjectPhase("tender", "cancelled"), "cancelled");
    assert.equal(preferProjectPhase("in progress", "on hold"), "on hold");
    assert.equal(preferProjectPhase("complete", "on hold"), "complete");
  });
});
