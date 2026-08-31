/**
 * Role-based involve-when heuristic from job titles.
 * Run: npx tsx --test scripts/test-involve-when.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { involveWhenFromJobTitle } from "../lib/entities/involve-when";

describe("involveWhenFromJobTitle", () => {
  it("returns null when there is no title", () => {
    assert.equal(involveWhenFromJobTitle(null), null);
    assert.equal(involveWhenFromJobTitle(""), null);
    assert.equal(involveWhenFromJobTitle("   "), null);
  });

  it("maps property / assistant managers to operations", () => {
    const result = involveWhenFromJobTitle("Assistant Property Manager");
    assert.ok(result);
    assert.match(result.prompt, /complaints/);
    assert.ok(result.examples.some((example) => /complaint/i.test(example)));
  });

  it("maps solicitors to contracts and collections", () => {
    const result = involveWhenFromJobTitle("Solicitor, Lash Condo Law");
    assert.ok(result);
    assert.match(result.prompt, /contracts/);
  });

  it("maps engineers to specs and deficiencies", () => {
    const result = involveWhenFromJobTitle("Consulting Engineer");
    assert.ok(result);
    assert.match(result.prompt, /specs/);
  });

  it("maps concierge / security to access and incidents", () => {
    const result = involveWhenFromJobTitle("Concierge");
    assert.ok(result);
    assert.match(result.prompt, /access/);
  });

  it("maps board roles to votes and notices", () => {
    const result = involveWhenFromJobTitle("Board President");
    assert.ok(result);
    assert.match(result.prompt, /votes/);
  });

  it("falls back to the raw title when the role is unknown", () => {
    const result = involveWhenFromJobTitle("Rooftop Landscaper");
    assert.ok(result);
    assert.match(result.prompt, /Rooftop Landscaper/);
    assert.deepEqual(result.examples, []);
  });

  it("prefers management over a generic director title", () => {
    const result = involveWhenFromJobTitle("Director of Property Management");
    assert.ok(result);
    assert.match(result.prompt, /complaints/);
  });
});
