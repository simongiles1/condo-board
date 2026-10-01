/**
 * V3 fact quotes must appear on the named page.
 * Run: npx tsx --test scripts/test-meeting-v3-facts.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptQuotedFacts,
  applyOrganizationMatches,
  chunkFactPageText,
  chunkFactPages,
  expandFactPagesForPrompt,
  factContextNotes,
  FACT_RESOLUTION_MAX_OUTPUT_TOKENS,
  FACT_RESOLUTION_PAGE_BATCH,
  FACT_RESOLUTION_PAGE_CHAR_BUDGET,
  FACT_RESOLUTION_REQUEST_TIMEOUT_MS,
  factRequestShouldSplit,
  factResolutionProgressFraction,
  factSliceShouldDivide,
  formatFactResolutionProgress,
  mergeProposedFacts,
  readFactResolutionProgress,
  readProposedFacts,
  readStoredItemFacts,
  summarizeItemFactReviews,
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

  it("keeps two different bids as separate amounts when they lack a shared service", () => {
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
    assert.equal(facts.reviewIssues.some((issue) => issue.code === "conflicting_prices"), false);
  });

  it("keeps two equal amounts on one page when the quotes differ", () => {
    const facts = acceptQuotedFacts({
      pages: [{
        pageNumber: 20,
        text: "Project management is $500. Construction review is $500.",
      }],
      proposed: [
        { field: "amount", value: "$500", page: 20, quote: "Project management is $500." },
        { field: "amount", value: "$500", page: 20, quote: "Construction review is $500." },
      ],
    });
    assert.equal(facts.candidates.length, 2);
  });

  it("reads every quote stored for the same page", () => {
    const stored = readStoredItemFacts(JSON.stringify({
      candidates: [
        { field: "vendor", value: "Trace Consulting Group", page: 3, quote: "approved Trace Consulting Group" },
        { field: "vendor", value: "Trace Consulting Group Ltd.", page: 3, quote: "thank you Trace Consulting Group Ltd." },
        { field: "amount", value: "$2,800", page: 3, quote: "fee is $2,800" },
      ],
    }));
    assert.equal(stored?.candidates.length, 3);
  });

  it("keeps a reported prior approval only when the quote says so", () => {
    const facts = acceptQuotedFacts({
      pages: [{
        pageNumber: 3,
        text: "The Board approved Trace Consulting Group's proposal for the steam room.",
      }],
      proposed: [
        {
          field: "vendor",
          value: "Trace Consulting Group",
          page: 3,
          quote: "The Board approved Trace Consulting Group's proposal",
          subject: "steam room",
          role: "reported_prior_approval",
        },
        {
          field: "vendor",
          value: "Trace Consulting Group",
          page: 3,
          quote: "The Board approved Trace Consulting Group's proposal",
          role: "proposal",
        },
      ],
    });
    assert.equal(facts.candidates.length, 1);
    assert.equal(facts.candidates[0]?.role, "reported_prior_approval");
    assert.equal(facts.candidates[0]?.subject, undefined);
  });

  it("flags conflicting prices for the same service and leaves a bare fee line unverified", () => {
    const conflict = acceptQuotedFacts({
      pages: [{
        pageNumber: 20,
        text: "Steam room project management is $2,800. Steam room project management is $1,700.",
      }],
      proposed: [
        {
          field: "amount",
          value: "$2,800",
          page: 20,
          quote: "Steam room project management is $2,800.",
          subject: "Steam room",
          service: "project management",
        },
        {
          field: "amount",
          value: "$1,700",
          page: 20,
          quote: "Steam room project management is $1,700.",
          subject: "Steam room",
          service: "project management",
        },
      ],
    });
    assert.equal(conflict.reviewIssues.some((issue) => issue.code === "conflicting_prices"), true);

    const smashed = acceptQuotedFacts({
      pages: [{
        pageNumber: 20,
        text: "Phase 3 | $2,800 $1,700 $750/Visit",
      }],
      proposed: [
        {
          field: "amount",
          value: "$2,800",
          page: 20,
          quote: "Phase 3 | $2,800 $1,700 $750/Visit",
        },
      ],
    });
    assert.equal(smashed.reviewIssues.some((issue) => issue.code === "fee_needs_verification"), true);
  });

  it("matches one organization and leaves an ambiguous name unmatched to an id", () => {
    const facts = acceptQuotedFacts({
      pages: [{ pageNumber: 3, text: "Trace Consulting Group Ltd. (TCG) wrote the letter." }],
      proposed: [{
        field: "vendor",
        value: "Trace Consulting Group Ltd. (TCG)",
        page: 3,
        quote: "Trace Consulting Group Ltd. (TCG) wrote the letter.",
      }],
    });
    const matched = applyOrganizationMatches(facts, [{
      id: "trace",
      name: "Trace Consulting Group Ltd.",
      aliases: ["Trace Consulting Group Ltd. (TCG)", "TCG"],
      email: null,
      website: null,
    }]);
    assert.equal(matched.candidates[0]?.organizationMatch, "confirmed");
    assert.equal(matched.candidates[0]?.organizationId, "trace");
    assert.equal(matched.candidates[0]?.value, "Trace Consulting Group Ltd. (TCG)");

    const ambiguous = applyOrganizationMatches(facts, [
      { id: "a", name: "Alpha Corp", aliases: ["Trace Consulting Group Ltd. (TCG)"], email: null, website: null },
      { id: "b", name: "Beta Corp", aliases: ["Trace Consulting Group Ltd. (TCG)"], email: null, website: null },
    ]);
    assert.equal(ambiguous.candidates[0]?.organizationMatch, "ambiguous");
    assert.equal(ambiguous.candidates[0]?.organizationId, undefined);
  });

  it("sends the rest of a page after the first character window", () => {
    const text = `${"a".repeat(FACT_RESOLUTION_PAGE_CHAR_BUDGET)} tail`;
    const chunks = chunkFactPageText(`hello ${text}`);
    assert.ok(chunks.length > 1);
    assert.equal(chunks.join(" ").replace(/\s+/g, ""), (`hello ${text}`).replace(/\s+/g, ""));
    const expanded = expandFactPagesForPrompt([{ pageNumber: 20, text: `hello ${text}` }]);
    assert.ok(expanded.every((page) => page.pageNumber === 20));
    assert.ok(expanded.at(-1)?.text.includes("tail"));
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

  it("takes the project from the heading and the fee from the amount line", () => {
    const facts = acceptQuotedFacts({
      title: "Steam Room Heat Pump",
      pages: [{
        pageNumber: 20,
        text: "Steam Room Heat Pump\nHeat Pump Design $10,500\nFees exclude HST.",
      }],
      proposed: [{
        field: "amount",
        value: "$10,500",
        page: 20,
        quote: "Heat Pump Design $10,500",
      }],
    });
    assert.equal(facts.candidates[0]?.subject, "Steam Room Heat Pump");
    assert.equal(facts.candidates[0]?.service, "Heat Pump Design");
    assert.match(facts.candidates[0]?.qualifications ?? "", /HST/);
    assert.equal(facts.reviewIssues.some((issue) => issue.code === "fee_needs_verification"), false);
  });

  it("keeps a subject copied from a heading quote that is not inside the value quote", () => {
    const facts = acceptQuotedFacts({
      pages: [{
        pageNumber: 20,
        text: "Steam Room Heat Pump\nHeat Pump Design is $10,500.",
      }],
      proposed: [{
        field: "amount",
        value: "$10,500",
        page: 20,
        quote: "Heat Pump Design is $10,500.",
        headingQuote: "Steam Room Heat Pump",
        subject: "Steam Room Heat Pump",
        service: "Heat Pump Design",
      }],
    });
    assert.equal(facts.candidates[0]?.subject, "Steam Room Heat Pump");
    assert.equal(facts.candidates[0]?.service, "Heat Pump Design");
  });

  it("flags a bare fee and treats two bidders as alternatives", () => {
    const bare = acceptQuotedFacts({
      pages: [{ pageNumber: 4, text: "Fee: $500." }],
      proposed: [{ field: "amount", value: "$500", page: 4, quote: "Fee: $500." }],
    });
    assert.equal(bare.reviewIssues.some((issue) => issue.code === "fee_needs_verification"), true);

    const bids = acceptQuotedFacts({
      pages: [{
        pageNumber: 8,
        text: "Acme offered $100 for pump replacement. Bravo offered $200 for pump replacement.",
      }],
      proposed: [
        {
          field: "amount",
          value: "$100",
          page: 8,
          quote: "Acme offered $100 for pump replacement.",
          subject: "pump replacement",
          service: "pump replacement",
          bidder: "Acme",
        },
        {
          field: "amount",
          value: "$200",
          page: 8,
          quote: "Bravo offered $200 for pump replacement.",
          subject: "pump replacement",
          service: "pump replacement",
          bidder: "Bravo",
        },
      ],
    });
    assert.equal(bids.reviewIssues.some((issue) => issue.code === "conflicting_prices"), false);
    assert.match(factContextNotes(bids).join(" "), /alternative prices/);
  });

  it("flags a quote that names a sibling topic", () => {
    const facts = acceptQuotedFacts({
      title: "Steam Room Heat Pump",
      siblingTitles: ["Lobby restoration"],
      pages: [{
        pageNumber: 3,
        text: "Absolute Ltd. was awarded the lobby restoration for $40,000.",
      }],
      proposed: [{
        field: "amount",
        value: "$40,000",
        page: 3,
        quote: "Absolute Ltd. was awarded the lobby restoration for $40,000.",
        subject: "lobby restoration",
        service: "lobby restoration",
      }],
    });
    assert.equal(facts.reviewIssues.some((issue) => issue.code === "topic_ownership"), true);
    const summary = summarizeItemFactReviews({
      itemNumber: "4.A.1",
      title: "Steam Room Heat Pump",
      facts,
    });
    assert.match(summary.join(" "), /4\.A\.1 Steam Room Heat Pump/);
  });

  it("replaces a proposal when recovery returns the same amount", () => {
    const merged = mergeProposedFacts(
      [{ field: "amount", value: "$500", page: 4, quote: "Fee: $500" }],
      [{ field: "amount", value: "$500", page: 4, quote: "Design fee $500", service: "Design fee" }],
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.quote, "Design fee $500");
    const dropped = mergeProposedFacts(merged, [{ field: "amount", value: "$500", page: 4, omit: true }]);
    assert.equal(dropped.length, 0);
  });

  it("retries a timed-out fact call when the batch still has more than one page", () => {
    assert.ok(FACT_RESOLUTION_REQUEST_TIMEOUT_MS > 120_000);
    const timeout = new Error("The operation was aborted due to timeout");
    assert.equal(factRequestShouldSplit(timeout, 4), true);
    assert.equal(factRequestShouldSplit(timeout, 1), false);
    assert.equal(factRequestShouldSplit(new Error("finish_reason=length"), 2), true);
    assert.equal(factRequestShouldSplit(new Error("DeepSeek request failed (500)."), 4), false);
  });

  it("reads fact-resolution progress and divides a page that timed out", () => {
    const step = formatFactResolutionProgress({
      itemIndex: 3,
      itemCount: 28,
      batchIndex: 2,
      batchCount: 4,
      label: "4.B.1 Booster Pump",
    });
    const progress = readFactResolutionProgress(step);
    assert.equal(progress?.label, "4.B.1 Booster Pump");
    assert.equal(progress?.itemIndex, 3);
    assert.ok(factResolutionProgressFraction(progress!) > 2 / 28);
    assert.ok(factResolutionProgressFraction(progress!) < 3 / 28);
    assert.equal(readFactResolutionProgress("Quoted facts stored"), null);
    assert.equal(factSliceShouldDivide(new Error("The operation was aborted due to timeout"), 2500), true);
    assert.equal(factSliceShouldDivide(new Error("The operation was aborted due to timeout"), 400), false);
  });
});
