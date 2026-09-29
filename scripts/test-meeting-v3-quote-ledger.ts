/**
 * Quote ledger page window, amount parsing, and bid arithmetic.
 * Run: npx tsx --test scripts/test-meeting-v3-quote-ledger.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  annotateQuoteRows,
  parseQuoteAmountCents,
  parseQuoteLedgerModelJson,
  QUOTE_LEDGER_SYSTEM_PROMPT,
  quoteLedgerPageNumbers,
  quoteLedgerTruncated,
  type QuoteRow,
} from "../lib/meeting-v3/quote-ledger";

const boosterItem = "Booster Pump Replacement";

function row(partial: Omit<QuoteRow, "pageNumber" | "itemLabel" | "taxBasis"> & Partial<QuoteRow>): QuoteRow {
  return {
    pageNumber: 4,
    itemLabel: boosterItem,
    taxBasis: "plus_hst",
    equipment: null,
    ...partial,
  };
}

/** The page-4 bid table once each amount sits in its own vendor column. */
function correctBoosterRows(): QuoteRow[] {
  return [
    row({ vendor: "Ambient", lineKind: "base", amountCents: 21_099_400 }),
    row({ vendor: "Ambient", lineKind: "optional", amountCents: 320_000 }),
    row({ vendor: "Ambient", lineKind: "total", amountCents: 21_419_400 }),
    row({ vendor: "Applied", lineKind: "base", amountCents: 22_692_800 }),
    row({ vendor: "Applied", lineKind: "optional", amountCents: 463_600 }),
    row({ vendor: "Applied", lineKind: "total", amountCents: 23_156_400 }),
    row({ vendor: "ABM", lineKind: "base", amountCents: 24_890_000 }),
    row({ vendor: "ABM", lineKind: "optional", amountCents: 1_000_000 }),
    row({ vendor: "ABM", lineKind: "total", amountCents: 25_890_000 }),
    row({ vendor: "Ambient", lineKind: "alternative", equipment: "Armstrong", amountCents: 17_999_400 }),
    row({ vendor: "Applied", lineKind: "alternative", equipment: "TACO", amountCents: 15_284_400 }),
    row({ vendor: "NWP", lineKind: "alternative", equipment: "Armstrong", amountCents: 16_390_000 }),
    row({ vendor: "ABM", lineKind: "alternative", equipment: "WILO", amountCents: 17_960_000 }),
    row({ vendor: "ABM", lineKind: "alternative", equipment: "Grundfos", amountCents: 21_890_000 }),
  ];
}

describe("quote ledger page window", () => {
  const pages = Array.from({ length: 20 }, (_, index) => index + 1);

  it("stops at the agenda split when one is recorded", () => {
    assert.deepEqual(quoteLedgerPageNumbers(pages, 4), [1, 2, 3, 4]);
    assert.equal(quoteLedgerTruncated(pages, 4), false);
  });

  it("stops at page 15 when the meeting has no split", () => {
    assert.deepEqual(quoteLedgerPageNumbers(pages, null), pages.slice(0, 15));
    assert.equal(quoteLedgerTruncated(pages, null), true);
  });
});

describe("quote amount parsing", () => {
  it("reads one dollar figure as cents", () => {
    assert.equal(parseQuoteAmountCents("$214,194.00"), 21_419_400);
    assert.equal(parseQuoteAmountCents("163900"), 16_390_000);
  });

  it("rejects a cell that contains more than one figure", () => {
    assert.equal(parseQuoteAmountCents("$152,844.00 $163,900.00 $179,600.00 $218,900.00"), null);
  });

  it("rejects percentages and words", () => {
    assert.equal(parseQuoteAmountCents("8.1%"), null);
    assert.equal(parseQuoteAmountCents("Not provided"), null);
  });
});

describe("quote arithmetic", () => {
  it("accepts a vendor when the base plus the optional item equals the total", () => {
    const annotated = annotateQuoteRows(correctBoosterRows());
    const checked = annotated.filter((entry) => entry.lineKind !== "alternative");
    assert.ok(checked.every((entry) => entry.checkStatus === "ok"));
    const nwp = annotated.find((entry) => entry.vendor === "NWP");
    assert.equal(nwp?.amountCents, 16_390_000);
    assert.equal(nwp?.checkStatus, "unchecked");
  });

  it("flags a total that does not match the base plus the optional item", () => {
    const annotated = annotateQuoteRows([
      row({ vendor: "Applied", lineKind: "base", amountCents: 21_099_400 }),
      row({ vendor: "Applied", lineKind: "optional", amountCents: 463_600 }),
      row({ vendor: "Applied", lineKind: "total", amountCents: 23_156_400 }),
    ]);
    assert.equal(annotated[0]?.checkStatus, "mismatch");
    assert.match(annotated[0]?.checkDetail ?? "", /stated total/i);
  });

  it("flags a base bid that has no total", () => {
    const annotated = annotateQuoteRows([
      row({ vendor: "NWP", lineKind: "base", amountCents: 22_692_800 }),
    ]);
    assert.equal(annotated[0]?.checkStatus, "incomplete");
  });
});

describe("quote ledger model json", () => {
  it("keeps a single amount and rejects a shifted multi-amount cell", () => {
    const parsed = parseQuoteLedgerModelJson(4, JSON.stringify({
      rows: [
        {
          itemLabel: boosterItem,
          vendor: "NWP",
          equipment: "Armstrong",
          lineKind: "alternative",
          amount: "163900.00",
          taxBasis: "plus_hst",
        },
        {
          itemLabel: boosterItem,
          vendor: "ABM",
          equipment: null,
          lineKind: "alternative",
          amount: "$152,844.00 $163,900.00",
          taxBasis: "unspecified",
        },
      ],
    }));
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0]?.vendor, "NWP");
    assert.equal(parsed.rejected.length, 1);
  });

  it("does not name the August 12 test item in the reader prompt", () => {
    assert.doesNotMatch(QUOTE_LEDGER_SYSTEM_PROMPT, /booster pump|163,900|new water|4\.B\.1/i);
  });
});
