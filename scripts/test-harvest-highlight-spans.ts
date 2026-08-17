/**
 * Harvest highlight span nesting tests.
 * Run: npx tsx --test scripts/test-harvest-highlight-spans.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildHarvestMarkTree,
  findFlexibleQuoteRange,
  resolveHarvestSpans,
} from "../lib/email-analysis/harvest-highlight-spans";

describe("findFlexibleQuoteRange", () => {
  it("matches verbatim quotes case-insensitively", () => {
    const text = "Hello Shawna, additional insulation was identified.";
    const range = findFlexibleQuoteRange(
      text,
      "Additional insulation was identified",
    );
    assert.ok(range);
    assert.equal(text.slice(range!.start, range!.end), "additional insulation was identified");
  });

  it("matches quotes when whitespace differs", () => {
    const text = "Applied System  Technology was requested";
    const range = findFlexibleQuoteRange(
      text,
      "Applied System Technology was requested",
    );
    assert.ok(range);
    assert.equal(range!.start, 0);
  });
});

describe("buildHarvestMarkTree", () => {
  it("nests a contact name inside a longer event quote", () => {
    const text = "TCG attended Unit 211 with Applied System Technology.";
    const tree = buildHarvestMarkTree(
      resolveHarvestSpans({
        text,
        contact: {
          contact_names: [],
          phones: [],
          job_titles: [],
          company_names: ["Applied System Technology"],
        },
        events: [
          {
            type: "maintenance",
            title: "Insulation: piping",
            sourceQuote: "TCG attended Unit 211 with Applied System Technology.",
          },
        ],
      }),
    );

    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.layers[0]!.group, "event");
    assert.equal(tree[0]!.children.length, 1);
    assert.equal(tree[0]!.children[0]!.layers[0]!.group, "contact");
    assert.equal(
      text.slice(tree[0]!.children[0]!.start, tree[0]!.children[0]!.end),
      "Applied System Technology",
    );
  });

  it("stacks contact company and org name on the same range", () => {
    const text = "Call Applied System Technology tomorrow.";
    const tree = buildHarvestMarkTree(
      resolveHarvestSpans({
        text,
        contact: {
          contact_names: [],
          phones: [],
          job_titles: [],
          company_names: ["Applied System Technology"],
        },
        org: {
          organization_names: ["Applied System Technology"],
          phones: [],
          organization_roles: [],
          websites: [],
        },
      }),
    );

    assert.equal(tree.length, 1);
    const groups = tree[0]!.layers.map((layer) => layer.group);
    assert.deepEqual(groups, ["contact", "organization"]);
    assert.equal(tree[0]!.layers[0]!.group, "contact");
  });

  it("splits a partial overlap so the shorter span stays intact", () => {
    const text = "abcdefghij";
    const tree = buildHarvestMarkTree([
      {
        group: "event",
        type: "maintenance",
        start: 0,
        end: 7,
        title: "event",
      },
      {
        group: "contact",
        type: "contact_name",
        start: 5,
        end: 10,
        title: "name",
      },
    ]);

    const groups = tree.map((node) => node.layers[0]!.group);
    assert.ok(groups.includes("event"));
    assert.ok(groups.includes("contact"));
    const contact = tree.find((node) => node.layers[0]!.group === "contact")!;
    assert.equal(contact.start, 5);
    assert.equal(contact.end, 10);
  });
});
