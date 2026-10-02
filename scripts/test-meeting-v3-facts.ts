/**
 * V3 fact quotes must appear on the named page.
 * Run: npx tsx --test scripts/test-meeting-v3-facts.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readDeepSeekModelIds, readDeepSeekStreamLine } from "../lib/deepseek/client";
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
  recoveryFactBatches,
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

  it("flags a missing bidder for one service and a real price conflict when the bidder is the same", () => {
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
    assert.equal(conflict.reviewIssues.some((issue) => issue.code === "missing_bidder"), true);
    assert.equal(conflict.reviewIssues.some((issue) => issue.code === "conflicting_prices"), false);

    const sameBidder = acceptQuotedFacts({
      pages: [{
        pageNumber: 21,
        text: "Steam room\nTrace project management is $2,800. Trace project management is $1,700.",
      }],
      proposed: [
        {
          field: "amount",
          value: "$2,800",
          page: 21,
          quote: "Trace project management is $2,800.",
          headingQuote: "Steam room",
          subject: "Steam room",
          service: "project management",
          bidder: "Trace",
        },
        {
          field: "amount",
          value: "$1,700",
          page: 21,
          quote: "Trace project management is $1,700.",
          headingQuote: "Steam room",
          subject: "Steam room",
          service: "project management",
          bidder: "Trace",
        },
      ],
    });
    assert.equal(sameBidder.reviewIssues.some((issue) => issue.code === "conflicting_prices"), true);

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
    assert.equal(facts.candidates[0]?.headingQuote, "Steam Room Heat Pump");
    assert.equal(facts.candidates[0]?.service, "Heat Pump Design");
    assert.match(facts.candidates[0]?.qualifications ?? "", /HST/);
    assert.equal(facts.reviewIssues.some((issue) => issue.code === "fee_needs_verification"), false);
    const stored = readStoredItemFacts(JSON.stringify(facts));
    assert.equal(stored?.candidates[0]?.subject, "Steam Room Heat Pump");
    assert.equal(stored?.candidates[0]?.service, "Heat Pump Design");
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

  it("keeps a row amount whose label is not shared with the other figures", () => {
    const row = "PML base bid $100,000 | GI base bid $90,000";
    const distinguished = acceptQuotedFacts({
      pages: [{ pageNumber: 11, text: row }],
      proposed: [{
        field: "amount",
        value: "$100,000",
        page: 11,
        quote: "$100,000",
        rowQuote: row,
        service: "base bid",
        bidder: "PML",
      }],
    });
    assert.equal(distinguished.reviewIssues.some((issue) => issue.code === "fee_needs_verification"), false);

    const unit = acceptQuotedFacts({
      pages: [{ pageNumber: 12, text: "Unit price $50 | Line total $500" }],
      proposed: [{
        field: "amount",
        value: "$50",
        page: 12,
        quote: "$50",
        rowQuote: "Unit price $50 | Line total $500",
        service: "Unit price",
      }],
    });
    assert.equal(unit.reviewIssues.some((issue) => issue.code === "fee_needs_verification"), false);

    const unlabeled = acceptQuotedFacts({
      pages: [{ pageNumber: 12, text: "Unit price $50 | Line total $500" }],
      proposed: [{
        field: "amount",
        value: "$50",
        page: 12,
        quote: "$50",
        rowQuote: "Unit price $50 | Line total $500",
        service: "filter replacement",
      }],
    });
    assert.equal(unlabeled.reviewIssues.some((issue) => issue.code === "fee_needs_verification"), true);
  });

  it("does not describe tax, totals, or investments as competing services", () => {
    const facts = acceptQuotedFacts({
      pages: [{
        pageNumber: 30,
        text: "HST $100. Grand Total $200. RBC GIC $1,000. TD GIC $2,000.",
      }],
      proposed: [
        { field: "amount", value: "$100", page: 30, quote: "HST $100.", service: "HST" },
        { field: "amount", value: "$200", page: 30, quote: "Grand Total $200.", service: "Grand Total" },
        { field: "amount", value: "$1,000", page: 30, quote: "RBC GIC $1,000.", service: "GIC", bidder: "RBC" },
        { field: "amount", value: "$2,000", page: 30, quote: "TD GIC $2,000.", service: "GIC", bidder: "TD" },
      ],
    });
    const notes = factContextNotes(facts).join(" ");
    assert.doesNotMatch(notes, /services named/);
    assert.doesNotMatch(notes, /alternative prices/);
    assert.match(notes, /2 investment holdings/);
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

  it("repairs the fact with the same quote and leaves another equal amount", () => {
    const merged = mergeProposedFacts(
      [
        { field: "amount", value: "$500", page: 4, quote: "Design $500", service: "Design" },
        { field: "amount", value: "$500", page: 4, quote: "Inspection $500", service: "Inspection" },
      ],
      [{
        field: "amount",
        value: "$500",
        page: 4,
        quote: "Inspection $500",
        revisedQuote: "Inspection fee $500",
        service: "Inspection fee",
      }],
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.quote, "Design $500");
    assert.equal(merged[0]?.service, "Design");
    assert.equal(merged[1]?.quote, "Inspection fee $500");
    assert.equal(merged[1]?.service, "Inspection fee");
    const accepted = acceptQuotedFacts({
      pages: [{ pageNumber: 4, text: "Design $500. Inspection $500. Inspection fee $500." }],
      proposed: merged,
    });
    assert.equal(accepted.candidates.length, 2);
    assert.ok(accepted.candidates.some((candidate) => candidate.service === "Design"));
    const dropped = mergeProposedFacts(merged, [{ field: "amount", value: "$500", page: 4, quote: "Design $500", omit: true }]);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0]?.quote, "Inspection fee $500");
  });

  it("keeps both amounts when recovery repairs one shared quotation", () => {
    const row = "Row containing $100 and $200";
    const merged = mergeProposedFacts(
      [
        { field: "amount", value: "$100", page: 1, quote: row },
        { field: "amount", value: "$200", page: 1, quote: row },
      ],
      [
        { field: "amount", value: "$100", page: 1, quote: row, bidder: "Ambient" },
        { field: "amount", value: "$200", page: 1, quote: row, bidder: "Applied" },
      ],
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.value, "$100");
    assert.equal(merged[0]?.bidder, "Ambient");
    assert.equal(merged[1]?.value, "$200");
    assert.equal(merged[1]?.bidder, "Applied");
    const accepted = acceptQuotedFacts({
      pages: [{ pageNumber: 1, text: row }],
      proposed: merged,
    });
    assert.equal(accepted.candidates.length, 2);
    assert.ok(accepted.candidates.some((candidate) => candidate.value === "$100"));
    assert.ok(accepted.candidates.some((candidate) => candidate.value === "$200"));
  });

  it("repairs unresolved facts in bounded batches", () => {
    const candidates = Array.from({ length: 13 }, (_, index) => ({
      field: "amount" as const,
      value: `$${index + 1}`,
      page: 1,
      quote: `Fee $${index + 1}`,
      service: "Fee",
    }));
    const batches = recoveryFactBatches(candidates);
    assert.equal(batches.length, 2);
    assert.equal(batches[0]?.facts.length, 12);
    assert.equal(batches[1]?.facts.length, 1);
    const clear = recoveryFactBatches([{
      field: "amount",
      value: "$10",
      page: 1,
      quote: "Design fee $10",
      service: "Design fee",
    }]);
    assert.deepEqual(clear, []);
    const conflict = recoveryFactBatches([
      {
        field: "amount",
        value: "$210,994",
        page: 31,
        quote: "Ambient base bid $210,994",
        subject: "Booster Pump",
        service: "Base Bid Amount",
        bidder: "Ambient",
      },
      {
        field: "amount",
        value: "$200,000",
        page: 31,
        quote: "Ambient base bid $200,000",
        subject: "Booster Pump",
        service: "Base Bid Amount",
        bidder: "Ambient",
      },
    ]);
    assert.equal(conflict.length, 1);
    assert.equal(conflict[0]?.facts.length, 2);
  });

  it("retries a timed-out fact call when the batch still has more than one page", () => {
    assert.ok(FACT_RESOLUTION_REQUEST_TIMEOUT_MS > 120_000);
    const timeout = new Error("The operation was aborted due to timeout");
    assert.equal(factRequestShouldSplit(timeout, 4), true);
    assert.equal(factRequestShouldSplit(timeout, 1), false);
    assert.equal(factRequestShouldSplit(new Error("finish_reason=length"), 2), true);
    assert.equal(factRequestShouldSplit(new Error("DeepSeek request failed (500)."), 4), false);
    assert.equal(factRequestShouldSplit(new Error("DeepSeek sent no text."), 4), false);
    assert.equal(factSliceShouldDivide(new Error("DeepSeek sent no text."), 2000), false);
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

  it("reports one missing bidder when the same line was extracted twice", () => {
    const facts = acceptQuotedFacts({
      pages: [{
        pageNumber: 31,
        text: "Booster Pump\nBase Bid Amount $210,994. Base Bid Amount. $226,928.",
      }],
      proposed: [
        {
          field: "amount",
          value: "$210,994",
          page: 31,
          quote: "Base Bid Amount $210,994.",
          headingQuote: "Booster Pump",
          subject: "Booster Pump",
          service: "Base Bid Amount",
        },
        {
          field: "amount",
          value: "$226,928",
          page: 31,
          quote: "Base Bid Amount. $226,928.",
          headingQuote: "Booster Pump",
          subject: "Booster Pump",
          service: "Base Bid Amount.",
        },
      ],
    });
    const missing = facts.reviewIssues.filter((issue) => issue.code === "missing_bidder");
    assert.equal(missing.length, 1);
    assert.match(missing[0]?.message ?? "", /Base Bid Amount/);
    assert.equal(facts.reviewIssues.some((issue) => issue.code === "conflicting_prices"), false);
  });

  it("copies the column heading onto each bid and keeps it after save", () => {
    const table = [
      "| Scope | Ambient | Applied |",
      "| --- | --- | --- |",
      "| Base Bid Amount | $210,994 | $226,928 |",
    ].join("\n");
    const facts = acceptQuotedFacts({
      pages: [{ pageNumber: 31, text: table }],
      proposed: [
        { field: "amount", value: "$210,994", page: 31, quote: "$210,994", subject: "Booster Pump" },
        { field: "amount", value: "$226,928", page: 31, quote: "$226,928", subject: "Booster Pump" },
      ],
    });
    assert.equal(facts.candidates.find((candidate) => candidate.value === "$210,994")?.bidder, "Ambient");
    assert.equal(facts.candidates.find((candidate) => candidate.value === "$226,928")?.bidder, "Applied");
    assert.equal(facts.candidates[0]?.service, "Base Bid Amount");
    assert.equal(facts.reviewIssues.some((issue) => issue.code === "conflicting_prices" || issue.code === "missing_bidder"), false);
    assert.equal(facts.reviewIssues.some((issue) => issue.code === "fee_needs_verification"), false);
    assert.match(factContextNotes(facts).join(" "), /2 alternative prices/);
    const stored = readStoredItemFacts(JSON.stringify(facts));
    assert.equal(stored?.candidates.find((candidate) => candidate.value === "$210,994")?.bidder, "Ambient");
    assert.equal(stored?.candidates.find((candidate) => candidate.value === "$226,928")?.bidder, "Applied");
  });

  it("does not take a greeting, an image placeholder, or a section label as the project", () => {
    const named = acceptQuotedFacts({
      pages: [{
        pageNumber: 20,
        text: "<!-- image -->\nI hope you're doing well.\n## ENGINEERING FEES\nSteam Room Heat Pump\nHeat Pump Design $10,500",
      }],
      proposed: [{ field: "amount", value: "$10,500", page: 20, quote: "Heat Pump Design $10,500" }],
    });
    assert.equal(named.candidates[0]?.subject, "Steam Room Heat Pump");

    const section = acceptQuotedFacts({
      pages: [{ pageNumber: 20, text: "## ENGINEERING FEES\nDesign fee $10,500" }],
      proposed: [{ field: "amount", value: "$10,500", page: 20, quote: "Design fee $10,500" }],
    });
    assert.equal(section.candidates[0]?.subject, undefined);
  });

  it("keeps a fee that says plus HST, and counts a reserve without counting cash", () => {
    const facts = acceptQuotedFacts({
      pages: [{
        pageNumber: 8,
        text: "Acme pump replacement $100 plus HST. Bravo pump replacement $200 plus HST. Cash balance $50. Reserve $80. RBC GIC $1,000.",
      }],
      proposed: [
        {
          field: "amount",
          value: "$100",
          page: 8,
          quote: "Acme pump replacement $100 plus HST.",
          subject: "Reserve Fund Investments",
          service: "pump replacement",
          bidder: "Acme",
          qualifications: "plus HST",
        },
        {
          field: "amount",
          value: "$200",
          page: 8,
          quote: "Bravo pump replacement $200 plus HST.",
          subject: "Reserve Fund Investments",
          service: "pump replacement",
          bidder: "Bravo",
          qualifications: "plus HST",
        },
        {
          field: "amount",
          value: "$50",
          page: 8,
          quote: "Cash balance $50.",
          subject: "Reserve Fund Investments",
          service: "Cash balance",
        },
        {
          field: "amount",
          value: "$80",
          page: 8,
          quote: "Reserve $80.",
          subject: "Reserve Fund Investments",
          service: "Reserve",
        },
        {
          field: "amount",
          value: "$1,000",
          page: 8,
          quote: "RBC GIC $1,000.",
          subject: "Reserve Fund Investments",
          service: "GIC",
          bidder: "RBC",
        },
      ],
    });
    const notes = factContextNotes(facts).join(" ");
    assert.match(notes, /2 alternative prices/);
    assert.match(notes, /2 investment holdings/);
    assert.doesNotMatch(notes, /3 investment holdings/);
  });

  it("keeps the same price from two suppliers on one quotation", () => {
    const row = "| Base Bid Amount | $100 | $100 |";
    const merged = mergeProposedFacts(
      [
        { field: "amount", value: "$100", page: 31, quote: row, bidder: "Ambient" },
        { field: "amount", value: "$100", page: 31, quote: row, bidder: "Applied" },
      ],
      [
        { field: "amount", value: "$100", page: 31, quote: row, bidder: "Ambient", service: "Base Bid Amount" },
        { field: "amount", value: "$100", page: 31, quote: row, bidder: "Applied", service: "Base Bid Amount" },
      ],
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.bidder, "Ambient");
    assert.equal(merged[1]?.bidder, "Applied");
  });

  it("keeps supplier columns on every money row of the saved bid tables", () => {
    const booster = [
      "| Item Description | Ambient | Applied | NWP | ABM | |",
      "| :--- | :---: | :---: | :---: | :---: | :---: |",
      "| Base Bid Amount | $210,994.00 | $226,928.00 | Not provided | $248,900.00 | |",
      "| Recommended Optional Item 1. | $3,200.00 | $4,636.00 | - | $10,000.00 | |",
      "| **Total Bid Amount based on Base Specs for Bell & Gossett Pump Set.** | **$214,194.00** | **$231,564.00** | - | **$258,900.00** | |",
      "| Pump Lead Time | 6 months | 6 months | | 6 months | |",
      "| Percent Difference | - | 8.1% | - | 20.8% | |",
      "| Total Bid Amount based on Alternative to the base bid specs. | $179,994.00 | $152,844.00 | **$163,900.00** | $179,600.00 | $218,900.00 |",
      "| **Alternative** | Armstrong | TACO | Armstrong | WILO | Grundfos |",
      "| Delivery | 12-13 Weeks | 5 Weeks | 12-13 Weeks | 13-14 Weeks | |",
    ].join("\n");
    const boosterFacts = acceptQuotedFacts({
      pages: [{ pageNumber: 31, text: booster }],
      proposed: [
        { field: "amount", value: "$210,994.00", page: 31, quote: "$210,994.00", subject: "Booster Pump" },
        { field: "amount", value: "$226,928.00", page: 31, quote: "$226,928.00", subject: "Booster Pump" },
        { field: "amount", value: "$248,900.00", page: 31, quote: "$248,900.00", subject: "Booster Pump" },
        { field: "amount", value: "$3,200.00", page: 31, quote: "$3,200.00", subject: "Booster Pump" },
        { field: "amount", value: "$214,194.00", page: 31, quote: "**$214,194.00**", subject: "Booster Pump" },
        { field: "amount", value: "$231,564.00", page: 31, quote: "**$231,564.00**", subject: "Booster Pump" },
        { field: "amount", value: "$258,900.00", page: 31, quote: "**$258,900.00**", subject: "Booster Pump" },
        { field: "amount", value: "**$163,900.00**", page: 31, quote: "**$163,900.00**", subject: "Booster Pump" },
        { field: "amount", value: "$218,900.00", page: 31, quote: "$218,900.00", subject: "Booster Pump" },
      ],
    });
    const bidderFor = (value: string) => boosterFacts.candidates.find((candidate) => candidate.value === value)?.bidder;
    assert.equal(bidderFor("$210,994.00"), "Ambient");
    assert.equal(bidderFor("$226,928.00"), "Applied");
    assert.equal(bidderFor("$248,900.00"), "ABM");
    assert.equal(bidderFor("$3,200.00"), "Ambient");
    assert.equal(bidderFor("$214,194.00"), "Ambient");
    assert.equal(bidderFor("$231,564.00"), "Applied");
    assert.equal(bidderFor("$258,900.00"), "ABM");
    assert.equal(bidderFor("**$163,900.00**"), "NWP");
    assert.equal(bidderFor("$218,900.00"), undefined);
    for (const value of ["$214,194.00", "$231,564.00", "$258,900.00"]) {
      assert.equal(
        boosterFacts.reviewIssues.some((issue) => issue.code === "fee_needs_verification" && issue.message.includes(value)),
        false,
      );
    }
    assert.equal(boosterFacts.candidates.find((candidate) => candidate.value === "$3,200.00")?.service, "Recommended Optional Item 1");
    assert.equal(
      boosterFacts.candidates.find((candidate) => candidate.value === "$214,194.00")?.service,
      "Total Bid Amount based on Base Specs for Bell & Gossett Pump Set",
    );
    assert.equal(boosterFacts.candidates.some((candidate) => candidate.bidder === "20.8%" || candidate.bidder === "6 months" || candidate.bidder === "Armstrong"), false);
    assert.match(factContextNotes(boosterFacts).join(" "), /Base Bid Amount: 3 alternative prices \(Ambient, Applied, ABM\)/);
    const storedBooster = readStoredItemFacts(JSON.stringify(boosterFacts));
    assert.equal(storedBooster?.candidates.find((candidate) => candidate.value === "$210,994.00")?.bidder, "Ambient");
    assert.equal(storedBooster?.candidates.find((candidate) => candidate.value === "**$163,900.00**")?.bidder, "NWP");
    const savedService = "Total Bid Amount based on Base Specs for Bell & Gossett Pump Set.";
    const savedBold = acceptQuotedFacts({
      pages: [{ pageNumber: 31, text: booster }],
      proposed: ["$214,194.00", "$231,564.00", "$258,900.00"].map((value) => ({
        field: "amount",
        value,
        page: 31,
        quote: `**${value}**`,
        rowQuote: "| **Total Bid Amount based on Base Specs for Bell & Gossett Pump Set.** | **$214,194.00** | **$231,564.00** | - | **$258,900.00** | |",
        service: savedService,
        subject: "Booster Pump",
      })),
    });
    assert.equal(savedBold.candidates.length, 3);
    assert.equal(savedBold.reviewIssues.some((issue) => issue.code === "fee_needs_verification"), false);
    assert.equal(savedBold.candidates.every((candidate) => candidate.service === savedService), true);
    assert.match(savedBold.candidates[0]?.quote ?? "", /\*\*/);
    assert.match(savedBold.candidates[0]?.rowQuote ?? "", /\*\*/);
    const storedSaved = readStoredItemFacts(JSON.stringify(savedBold));
    assert.equal(storedSaved?.reviewIssues.some((issue) => issue.code === "fee_needs_verification"), false);
    assert.equal(storedSaved?.candidates.every((candidate) => candidate.service === savedService), true);
    assert.deepEqual(
      storedSaved?.candidates.map((candidate) => candidate.bidder).sort(),
      ["ABM", "Ambient", "Applied"],
    );

    const tanks = "| 4.0 | Provide two (2) new 1135 L double-wall fuel storage tanks, complete with all required piping, fittings, switches, gauges, and accessories. Scope shall include all necessary valves, connections, control instruments, and accessories not included in the base scope, to provide a complete and fully operational fuel system installation. | **$18,000.00** | $25,525.00 | $22,000.00 |";
    const silencer = "| 6.0 | Provide a new emergency generator exhaust silencer complete with all required accessories, supports, | **$18,000.00** | $25,525.00 | $24,400.00 |";
    const generator = [
      "| No. | Item Description | PML | GI | ESI |",
      "| :--- | :--- | :--- | :--- | :--- |",
      "| 1.0 | Demolish two (2) existing fuel storage tanks, including all associated valves, appurtenances, and connections, as shown on the drawings. | **$ 3,000.00** | $4,250.00 | $5,500.00 |",
      tanks,
      silencer,
    ].join("\n");
    const generatorFacts = acceptQuotedFacts({
      pages: [{ pageNumber: 124, text: generator }],
      proposed: [
        { field: "amount", value: "$ 3,000.00", page: 124, quote: "**$ 3,000.00**", subject: "Generator" },
        { field: "amount", value: "$4,250.00", page: 124, quote: "$4,250.00", subject: "Generator" },
        { field: "amount", value: "$5,500.00", page: 124, quote: "$5,500.00", subject: "Generator" },
        { field: "amount", value: "**$18,000.00**", page: 124, quote: tanks, subject: "Generator" },
        { field: "amount", value: "**$18,000.00**", page: 124, quote: silencer, subject: "Generator" },
        { field: "amount", value: "$18,000.00", page: 124, quote: "$18,000.00", subject: "Generator" },
      ],
    });
    assert.equal(generatorFacts.candidates.find((candidate) => candidate.value === "$ 3,000.00")?.bidder, "PML");
    assert.equal(generatorFacts.candidates.find((candidate) => candidate.value === "$4,250.00")?.bidder, "GI");
    assert.equal(generatorFacts.candidates.find((candidate) => candidate.value === "$5,500.00")?.bidder, "ESI");
    assert.match(generatorFacts.candidates.find((candidate) => candidate.value === "$ 3,000.00")?.service ?? "", /^Demolish two/);
    const eighteen = generatorFacts.candidates.filter((candidate) => candidate.value === "**$18,000.00**");
    assert.equal(eighteen.length, 2);
    assert.ok(eighteen.every((candidate) => candidate.bidder === "PML"));
    assert.notEqual(eighteen[0]?.service, eighteen[1]?.service);
    const ambiguous = generatorFacts.candidates.find((candidate) => candidate.value === "$18,000.00");
    assert.equal(ambiguous?.bidder, undefined);
    const storedGenerator = readStoredItemFacts(JSON.stringify(generatorFacts));
    assert.equal(storedGenerator?.candidates.filter((candidate) => candidate.value === "**$18,000.00**" && candidate.bidder === "PML").length, 2);
  });

  it("rejects a placeholder bidder and keeps a real column supplier", () => {
    const bare = acceptQuotedFacts({
      pages: [{
        pageNumber: 125,
        text: "Generator Optional Pricing --- $10.00. Generator Optional Pricing --- $12.00.",
      }],
      proposed: [
        { field: "amount", value: "$10.00", page: 125, quote: "Generator Optional Pricing --- $10.00", bidder: "---", service: "Optional Pricing", subject: "Generator" },
        { field: "amount", value: "$12.00", page: 125, quote: "Generator Optional Pricing --- $12.00", bidder: "---", service: "Optional Pricing", subject: "Generator" },
      ],
    });
    assert.equal(bare.candidates.length, 2);
    assert.equal(bare.candidates.some((candidate) => candidate.bidder === "---"), false);
    assert.equal(bare.reviewIssues.some((issue) => issue.code === "conflicting_prices"), false);
    assert.equal(bare.reviewIssues.some((issue) => issue.code === "missing_bidder"), true);

    const row = "| --- | $210,994.00 | $226,928.00 |";
    const table = acceptQuotedFacts({
      pages: [{
        pageNumber: 31,
        text: ["| Item Description | Ambient | Applied |", "| :--- | :---: | :---: |", row].join("\n"),
      }],
      proposed: [
        { field: "amount", value: "$210,994.00", page: 31, quote: row, bidder: "---", subject: "Booster" },
      ],
    });
    assert.equal(table.candidates[0]?.bidder, "Ambient");
  });

  it("shares one cited cell and still separates equal prices on that row", () => {
    const row = "| Base Bid Amount | $210,994.00 | $226,928.00 |";
    const shared = acceptQuotedFacts({
      pages: [{
        pageNumber: 31,
        text: [
          "Ambient proposes $210,994.00 for the base bid.",
          "| Item Description | Ambient | Applied |",
          "| :--- | :---: | :---: |",
          row,
        ].join("\n"),
      }],
      proposed: [
        { field: "amount", value: "$210,994.00", page: 31, quote: "Ambient proposes $210,994.00 for the base bid.", bidder: "Ambient", subject: "Booster" },
        { field: "amount", value: "$210,994.00", page: 31, quote: row, subject: "Booster" },
      ],
    });
    assert.equal(shared.candidates.length, 2);
    assert.deepEqual(shared.candidates.map((candidate) => candidate.bidder), ["Ambient", "Ambient"]);

    const tied = "| Base Bid Amount | $100.00 | $100.00 |";
    const equals = acceptQuotedFacts({
      pages: [{
        pageNumber: 31,
        text: ["| Item Description | Ambient | Applied |", "| :--- | :---: | :---: |", tied].join("\n"),
      }],
      proposed: [
        { field: "amount", value: "$100.00", page: 31, quote: "$100.00", subject: "Booster" },
        { field: "amount", value: "$100.00", page: 31, quote: "$100.00", subject: "Booster" },
      ],
    });
    assert.equal(equals.candidates.length, 2);
    assert.deepEqual(equals.candidates.map((candidate) => candidate.bidder).sort(), ["Ambient", "Applied"]);
  });

  it("carries a continued supplier header without taking an unrelated table or an unlabeled amount", () => {
    const header = "| No. | Item Description | PML | GI | ESI |";
    const page124 = [
      "Generator fuel upgrade",
      header,
      "| :--- | :--- | :--- | :--- | :--- |",
      "| 1.0 | Demolish two existing fuel storage tanks | $3,000.00 | $4,250.00 | $5,500.00 |",
      "| 6.0 | Provide a new emergency generator exhaust silencer | $18,000.00 | $25,525.00 | $24,400.00 |",
      "3 of 7.",
    ].join("\n");
    const continued = "| 7.0 | Provide a new access pathway | $1,100.00 | $1,200.00 | $1,300.00 |";
    const optional = "| | OPTIONAL PRICING | $10,000.00 | $11,000.00 | $12,000.00 |";
    const page125 = [
      "Premier Mechanical Ltd.",
      "100 King Street",
      "---",
      continued,
      optional,
      "Generator letter quotes $999.00 for a different scope.",
    ].join("\n");
    const unrelated = [
      "Premier Mechanical Ltd.",
      "---",
      "| 1.0 | Paint the lobby | $400.00 | $500.00 | $600.00 |",
    ].join("\n");
    const narrow = "| 8.0 | Paint the stair | $50.00 |";
    const restarted = [
      header,
      "| :--- | :--- | :--- | :--- | :--- |",
      "| 6.0 | Demolish the silencer | $18,000.00 | $25,525.00 | $24,400.00 |",
      "4 of 7.",
    ].join("\n");
    const restartedNext = [
      "Premier Mechanical Ltd.",
      "---",
      "| 1.0 | Paint the lobby again | $400.00 | $500.00 | $600.00 |",
    ].join("\n");
    const headedEnd = [
      header,
      "| :--- | :--- | :--- | :--- | :--- |",
      "| 6.0 | Demolish the silencer again | $18,000.00 | $25,525.00 | $24,400.00 |",
    ].join("\n");
    const proseNext = [
      "This schedule belongs to a different contract.",
      "| 9.0 | Paint the stairwell | $70.00 | $80.00 | $90.00 |",
    ].join("\n");
    const proposed = [
      { field: "amount", value: "$3,000.00", page: 124, quote: "$3,000.00", subject: "Generator" },
      { field: "amount", value: "$1,100.00", page: 125, quote: continued, subject: "Generator" },
      { field: "amount", value: "$1,200.00", page: 125, quote: continued, subject: "Generator" },
      { field: "amount", value: "$10,000.00", page: 125, quote: optional, subject: "Generator" },
      { field: "amount", value: "$11,000.00", page: 125, quote: optional, subject: "Generator" },
      { field: "amount", value: "$999.00", page: 125, quote: "Generator letter quotes $999.00 for a different scope.", subject: "Generator" },
      { field: "amount", value: "$400.00", page: 126, quote: unrelated, subject: "Generator" },
      { field: "amount", value: "$50.00", page: 127, quote: narrow, subject: "Generator" },
      { field: "amount", value: "$400.00", page: 131, quote: "| 1.0 | Paint the lobby again | $400.00 | $500.00 | $600.00 |", subject: "Generator" },
      { field: "amount", value: "$70.00", page: 133, quote: "| 9.0 | Paint the stairwell | $70.00 | $80.00 | $90.00 |", subject: "Generator" },
    ];
    const facts = acceptQuotedFacts({
      pages: [
        { pageNumber: 124, text: page124 },
        { pageNumber: 125, text: page125 },
        { pageNumber: 126, text: unrelated },
        { pageNumber: 127, text: narrow },
        { pageNumber: 130, text: restarted },
        { pageNumber: 131, text: restartedNext },
        { pageNumber: 132, text: headedEnd },
        { pageNumber: 133, text: proseNext },
      ],
      proposed,
    });
    const pathway = facts.candidates.find((candidate) => candidate.value === "$1,100.00");
    const otherColumn = facts.candidates.find((candidate) => candidate.value === "$1,200.00");
    const letter = facts.candidates.find((candidate) => candidate.value === "$999.00");
    const paint = facts.candidates.find((candidate) => candidate.page === 126);
    const stair = facts.candidates.find((candidate) => candidate.value === "$50.00");
    const optionalTotal = facts.candidates.find((candidate) => candidate.value === "$10,000.00");
    const optionalOther = facts.candidates.find((candidate) => candidate.value === "$11,000.00");
    const restartedPaint = facts.candidates.find((candidate) => candidate.page === 131);
    const proseTable = facts.candidates.find((candidate) => candidate.value === "$70.00");
    assert.equal(pathway?.bidder, "PML");
    assert.equal(pathway?.service, "Provide a new access pathway");
    assert.equal(pathway?.columnPage, 124);
    assert.match(pathway?.columnQuote ?? "", /PML/);
    assert.equal(pathway?.quote.includes("PML"), false);
    assert.equal(otherColumn?.bidder, "GI");
    assert.equal(optionalTotal?.bidder, "PML");
    assert.equal(optionalTotal?.service, "OPTIONAL PRICING");
    assert.equal(optionalTotal?.columnPage, 124);
    assert.match(optionalTotal?.columnQuote ?? "", /PML/);
    assert.equal(optionalOther?.bidder, "GI");
    assert.equal(letter?.bidder, undefined);
    assert.equal(paint?.bidder, undefined);
    assert.equal(stair?.bidder, undefined);
    assert.equal(restartedPaint?.bidder, undefined);
    assert.equal(proseTable?.bidder, undefined);
    assert.equal(facts.candidates.filter((candidate) => candidate.field === "amount").length, proposed.length);

    const merged = mergeProposedFacts(proposed, [
      { field: "amount", value: "$1,100.00", page: 125, quote: continued, bidder: "PML", columnQuote: header, columnPage: 124 },
    ]);
    assert.equal(merged.length, proposed.length);
    const recovered = acceptQuotedFacts({
      pages: [
        { pageNumber: 124, text: page124 },
        { pageNumber: 125, text: page125 },
        { pageNumber: 126, text: unrelated },
        { pageNumber: 127, text: narrow },
        { pageNumber: 130, text: restarted },
        { pageNumber: 131, text: restartedNext },
        { pageNumber: 132, text: headedEnd },
        { pageNumber: 133, text: proseNext },
      ],
      proposed: merged,
    });
    const stored = readStoredItemFacts(JSON.stringify(recovered));
    const storedPathway = stored?.candidates.find((candidate) => candidate.value === "$1,100.00");
    assert.equal(storedPathway?.bidder, "PML");
    assert.equal(storedPathway?.columnPage, 124);
    assert.equal(storedPathway?.quote.includes("PML"), false);
    const storedLetter = stored?.candidates.find((candidate) => candidate.value === "$999.00");
    assert.ok(storedLetter);
    assert.equal(storedLetter?.bidder, undefined);
    assert.equal(stored?.candidates.find((candidate) => candidate.value === "$400.00")?.bidder, undefined);
    assert.equal(recoveryFactBatches(recovered.candidates).some((batch) => batch.facts.some((fact) => fact.value === "$1,100.00")), false);
  });

  it("shows one context line for the same service and bidders", () => {
    const facts = acceptQuotedFacts({
      pages: [{
        pageNumber: 31,
        text: "One Base Bid Amount Ambient $1.00. One Base Bid Amount Applied $2.00. Two Base Bid Amount Ambient $1.00. Two Base Bid Amount Applied $2.00.",
      }],
      proposed: [
        { field: "amount", value: "$1.00", page: 31, quote: "One Base Bid Amount Ambient $1.00", bidder: "Ambient", service: "Base Bid Amount", subject: "One" },
        { field: "amount", value: "$2.00", page: 31, quote: "One Base Bid Amount Applied $2.00", bidder: "Applied", service: "Base Bid Amount", subject: "One" },
        { field: "amount", value: "$1.00", page: 31, quote: "Two Base Bid Amount Ambient $1.00", bidder: "Ambient", service: "Base Bid Amount", subject: "Two" },
        { field: "amount", value: "$2.00", page: 31, quote: "Two Base Bid Amount Applied $2.00", bidder: "Applied", service: "Base Bid Amount", subject: "Two" },
      ],
    });
    assert.equal(facts.candidates.length, 4);
    const notes = factContextNotes(facts).filter((note) => note.includes("alternative prices"));
    assert.deepEqual(notes, ["Base Bid Amount: 2 alternative prices (Ambient, Applied)."]);
  });

  it("treats a DeepSeek keep-alive as silence and a content line as text", () => {
    assert.equal(readDeepSeekStreamLine(": keep-alive"), null);
    assert.equal(readDeepSeekStreamLine("data: [DONE]"), null);
    const delta = readDeepSeekStreamLine(
      'data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"},"finish_reason":null}]}',
    );
    assert.equal(delta?.content, "{\"ok\":true}");
    assert.equal(readDeepSeekStreamLine("data: {") , null);
  });

  it("reads DeepSeek catalog model ids and ignores a bad payload", () => {
    assert.deepEqual(
      readDeepSeekModelIds({ data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }, { id: "" }] }),
      ["deepseek-flash", "deepseek-v4-pro"],
    );
    assert.deepEqual(readDeepSeekModelIds(null), []);
  });
});
