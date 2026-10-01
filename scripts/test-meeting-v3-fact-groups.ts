/**
 * V3 fact groups must share one quote that is on the page.
 * Run: npx tsx --test scripts/test-meeting-v3-fact-groups.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptFactGroups,
  readProposedFactGroups,
  readStoredItemFactGroups,
} from "../lib/meeting-v3/fact-groups";
import type { MeetingsV3FactCandidate } from "../lib/meeting-v3/facts";

const pages = [
  {
    pageNumber: 14,
    text: "NWP Mechanical proposes $48,200 to replace the booster pump by June 1, 2026. Other Co. bids $51,000.",
  },
];

const candidates: MeetingsV3FactCandidate[] = [
  {
    field: "vendor",
    value: "NWP Mechanical",
    page: 14,
    quote: "NWP Mechanical proposes $48,200",
  },
  {
    field: "amount",
    value: "$48,200",
    page: 14,
    quote: "proposes $48,200 to replace",
  },
  {
    field: "date",
    value: "June 1, 2026",
    page: 14,
    quote: "by June 1, 2026",
  },
  {
    field: "vendor",
    value: "Other Co.",
    page: 14,
    quote: "Other Co. bids $51,000.",
  },
  {
    field: "amount",
    value: "$51,000",
    page: 14,
    quote: "bids $51,000.",
  },
];

describe("v3 fact groups", () => {
  it("keeps vendor, amount, and date together when one quote contains them", () => {
    const grouped = acceptFactGroups({
      pages,
      candidates,
      proposed: [
        {
          page: 14,
          quote: "NWP Mechanical proposes $48,200 to replace the booster pump by June 1, 2026.",
          members: [
            { field: "vendor", value: "NWP Mechanical" },
            { field: "amount", value: "$48,200" },
            { field: "date", value: "June 1, 2026" },
          ],
        },
        {
          page: 14,
          quote: "Other Co. bids $51,000.",
          members: [
            { field: "vendor", value: "Other Co." },
            { field: "amount", value: "$51,000" },
          ],
        },
      ],
    });
    assert.equal(grouped.groups.length, 2);
    assert.deepEqual(
      grouped.groups[0]?.members.map((member) => member.field),
      ["amount", "vendor", "date"],
    );
    assert.deepEqual(grouped.groups[0]?.unresolvedFields, []);
    assert.deepEqual(grouped.ungrouped, []);
  });

  it("drops a quote that is not on the named page", () => {
    const grouped = acceptFactGroups({
      pages,
      candidates,
      proposed: [
        {
          page: 15,
          quote: "NWP Mechanical proposes $48,200 to replace the booster pump by June 1, 2026.",
          members: [
            { field: "vendor", value: "NWP Mechanical" },
            { field: "amount", value: "$48,200" },
          ],
        },
      ],
    });
    assert.deepEqual(grouped.groups, []);
    assert.equal(grouped.ungrouped.length, candidates.length);
  });

  it("drops a member that is not an accepted fact", () => {
    const grouped = acceptFactGroups({
      pages,
      candidates,
      proposed: [
        {
          page: 14,
          quote: "NWP Mechanical proposes $48,200 to replace the booster pump by June 1, 2026.",
          members: [
            { field: "vendor", value: "NWP Mechanical" },
            { field: "amount", value: "$99,000" },
          ],
        },
      ],
    });
    assert.deepEqual(grouped.groups, []);
  });

  it("leaves a fact ungrouped when it does not share a quote", () => {
    const grouped = acceptFactGroups({
      pages,
      candidates,
      proposed: [
        {
          page: 14,
          quote: "Other Co. bids $51,000.",
          members: [
            { field: "vendor", value: "Other Co." },
            { field: "amount", value: "$51,000" },
          ],
        },
      ],
    });
    assert.equal(grouped.groups.length, 1);
    assert.equal(grouped.ungrouped.length, 3);
  });

  it("marks two amounts inside one quote unresolved on that source", () => {
    const grouped = acceptFactGroups({
      pages: [{ pageNumber: 14, text: "The bids are $48,200 and $51,000." }],
      candidates: [
        { field: "amount", value: "$48,200", page: 14, quote: "$48,200" },
        { field: "amount", value: "$51,000", page: 14, quote: "$51,000" },
      ],
      proposed: [
        {
          page: 14,
          quote: "The bids are $48,200 and $51,000.",
          members: [
            { field: "amount", value: "$48,200" },
            { field: "amount", value: "$51,000" },
          ],
        },
      ],
    });
    assert.deepEqual(grouped.groups[0]?.unresolvedFields, ["amount"]);
    assert.deepEqual(grouped.ungrouped, []);
  });

  it("does not place one fact in two groups", () => {
    const grouped = acceptFactGroups({
      pages,
      candidates,
      proposed: [
        {
          page: 14,
          quote: "NWP Mechanical proposes $48,200 to replace the booster pump by June 1, 2026.",
          members: [
            { field: "vendor", value: "NWP Mechanical" },
            { field: "amount", value: "$48,200" },
          ],
        },
        {
          page: 14,
          quote: "NWP Mechanical proposes $48,200 to replace the booster pump by June 1, 2026.",
          members: [
            { field: "amount", value: "$48,200" },
            { field: "date", value: "June 1, 2026" },
          ],
        },
      ],
    });
    assert.equal(grouped.groups.length, 1);
    assert.equal(grouped.ungrouped.some((fact) => fact.field === "date"), true);
  });

  it("reads per-item groups from the model reply", () => {
    const items = readProposedFactGroups(
      JSON.stringify({
        items: [
          {
            agendaItemId: "item-1",
            groups: [{ page: 14, quote: "NWP Mechanical proposes $48,200", members: [] }],
          },
        ],
      }),
    );
    assert.equal(items[0]?.agendaItemId, "item-1");
    assert.equal(items[0]?.groups.length, 1);
  });

  it("rechecks stored groups against the accepted facts", () => {
    const stored = readStoredItemFactGroups(
      JSON.stringify({
        groups: [
          {
            page: 14,
            quote: "Other Co. bids $51,000.",
            members: [
              { field: "vendor", value: "Other Co." },
              { field: "amount", value: "$51,000" },
            ],
          },
        ],
      }),
      { candidates, unresolvedFields: ["amount", "vendor"] },
    );
    assert.equal(stored?.groups.length, 1);
    assert.equal(stored?.ungrouped.length, 3);
  });
});
