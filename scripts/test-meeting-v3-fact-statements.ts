/**
 * Cross-page fact statements follow the subject, not the organization id.
 * Run: npx tsx --test scripts/test-meeting-v3-fact-statements.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { linkFactStatements } from "../lib/meeting-v3/fact-statements";
import type { MeetingsV3FactCandidate } from "../lib/meeting-v3/facts";

const traceVendor: MeetingsV3FactCandidate = {
  field: "vendor",
  value: "Trace Consulting Group",
  page: 3,
  quote: "approved Trace Consulting Group's proposal for the steam room",
  subject: "steam room",
  role: "reported_prior_approval",
  organizationId: "trace",
  organizationMatch: "confirmed",
};

const traceFee: MeetingsV3FactCandidate = {
  field: "amount",
  value: "$2,800",
  page: 20,
  quote: "steam room project management is $2,800",
  subject: "steam room",
  service: "project management",
  organizationId: "trace",
  organizationMatch: "confirmed",
};

describe("v3 fact statements", () => {
  it("links a company and a fee across pages when they name the same project", () => {
    const linked = linkFactStatements([traceVendor, traceFee]);
    assert.equal(linked.statements.length, 1);
    assert.deepEqual(linked.statements[0]?.pages, [3, 20]);
    assert.equal(linked.unlinked.length, 0);
    assert.equal(linked.statements[0]?.uncertain, false);
  });

  it("does not link a fee to a company only because the organization matches", () => {
    const otherFee: MeetingsV3FactCandidate = {
      ...traceFee,
      subject: "lobby restoration",
      quote: "lobby restoration project management is $2,800",
    };
    const linked = linkFactStatements([traceVendor, otherFee]);
    assert.equal(linked.statements.length, 2);
    assert.equal(linked.statements.every((statement) => statement.pages.length === 1), true);
  });

  it("leaves a fee off a dated revision when its quote does not name that date", () => {
    const linked = linkFactStatements([
      { ...traceVendor, field: "date", value: "June 1, 2026", quote: "steam room dated June 1, 2026" },
      { ...traceVendor, field: "date", value: "July 1, 2026", quote: "steam room dated July 1, 2026", page: 4 },
      traceFee,
    ]);
    assert.equal(linked.statements.length, 2);
    assert.equal(linked.unlinked.some((fact) => fact.value === "$2,800"), true);
  });

  it("does not treat an incident date and a completion date as two revisions", () => {
    const linked = linkFactStatements([
      {
        ...traceVendor,
        field: "date",
        value: "June 1, 2026",
        role: "historical_event",
        quote: "steam room incident on June 1, 2026",
      },
      {
        ...traceVendor,
        field: "date",
        value: "July 1, 2026",
        quote: "steam room completion on July 1, 2026",
        page: 4,
      },
      traceFee,
    ]);
    assert.equal(linked.statements.length, 1);
    assert.equal(linked.unlinked.length, 0);
    assert.equal(linked.statements[0]?.members.some((fact) => fact.value === "$2,800"), true);
  });
});
