/**
 * V3 fact quotes must appear on the named page.
 * Run: npx tsx --test scripts/test-meeting-v3-facts.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptQuotedFacts,
  chunkFactPages,
  FACT_RESOLUTION_MAX_OUTPUT_TOKENS,
  FACT_RESOLUTION_PAGE_BATCH,
  readProposedFacts,
  readStoredItemFacts,
} from "../lib/meeting-v3/facts";

const pages = [
  {
    pageNumber: 14,
    text: "NWP Mechanical proposes $48,200 to replace the booster pump.",
  },
  {
    pageNumber: 15,
    text: "A second bid from Other Co. is $51,000.",
  },
];

describe("v3 quoted facts", () => {
  it("keeps a fact whose quote and value are on that page", () => {
    const facts = acceptQuotedFacts({
      pages,
      proposed: [
        {
          field: "amount",
          value: "$48,200",
          page: 14,
          quote: "NWP Mechanical proposes $48,200 to replace the booster pump.",
        },
        {
          field: "vendor",
          value: "NWP Mechanical",
          page: 14,
          quote: "NWP Mechanical proposes $48,200",
        },
      ],
    });
    assert.equal(facts.candidates.length, 2);
    assert.deepEqual(facts.unresolvedFields, []);
  });

  it("drops a quote that is not on the named page", () => {
    const facts = acceptQuotedFacts({
      pages,
      proposed: [
        {
          field: "amount",
          value: "$51,000",
          page: 14,
          quote: "A second bid from Other Co. is $51,000.",
        },
      ],
    });
    assert.deepEqual(facts.candidates, []);
  });

  it("drops a value that is not inside the quote", () => {
    const facts = acceptQuotedFacts({
      pages,
      proposed: [
        {
          field: "amount",
          value: "$99,000",
          page: 14,
          quote: "NWP Mechanical proposes $48,200 to replace the booster pump.",
        },
      ],
    });
    assert.deepEqual(facts.candidates, []);
  });

  it("leaves two different amounts unresolved", () => {
    const facts = acceptQuotedFacts({
      pages,
      proposed: [
        {
          field: "amount",
          value: "$48,200",
          page: 14,
          quote: "proposes $48,200 to replace",
        },
        {
          field: "amount",
          value: "$51,000",
          page: 15,
          quote: "Other Co. is $51,000.",
        },
      ],
    });
    assert.equal(facts.candidates.length, 2);
    assert.deepEqual(facts.unresolvedFields, ["amount"]);
  });

  it("matches a quote when the page breaks the line", () => {
    const facts = acceptQuotedFacts({
      pages: [{ pageNumber: 14, text: "NWP Mechanical proposes\n$48,200 to replace the booster pump." }],
      proposed: [
        {
          field: "amount",
          value: "$48,200",
          page: 14,
          quote: "proposes $48,200 to replace",
        },
      ],
    });
    assert.equal(facts.candidates.length, 1);
  });

  it("reads per-item facts from the model reply", () => {
    const items = readProposedFacts(
      JSON.stringify({
        items: [
          {
            agendaItemId: "item-1",
            facts: [{ field: "amount", value: "$48,200", page: 14, quote: "proposes $48,200" }],
          },
        ],
      }),
    );
    assert.equal(items.length, 1);
    assert.equal(items[0]?.agendaItemId, "item-1");
    assert.equal(items[0]?.facts.length, 1);
  });

  it("splits a long topic into page batches under the output budget", () => {
    assert.ok(FACT_RESOLUTION_MAX_OUTPUT_TOKENS > 4096);
    const pages = Array.from({ length: 10 }, (_, index) => index + 1);
    const chunks = chunkFactPages(pages);
    assert.equal(FACT_RESOLUTION_PAGE_BATCH, 4);
    assert.deepEqual(chunks, [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]]);
    assert.deepEqual(chunkFactPages([]), []);
  });

  it("reads a stored fact object back", () => {
    const stored = readStoredItemFacts(
      JSON.stringify({
        candidates: [
          {
            field: "vendor",
            value: "NWP Mechanical",
            page: 14,
            quote: "NWP Mechanical proposes $48,200",
          },
        ],
        unresolvedFields: [],
      }),
    );
    assert.equal(stored?.candidates[0]?.value, "NWP Mechanical");
    assert.equal(stored?.unresolvedFields.length, 0);
  });
});
