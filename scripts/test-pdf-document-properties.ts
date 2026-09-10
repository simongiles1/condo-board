/**
 * PDF Info + header-band extraction for file cards.
 * Run: npx tsx --test scripts/test-pdf-document-properties.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  extractPdfFileMetadata,
  formatPdfMetadataPromptBlock,
  partyHintsFromPdfMetadata,
} from "../lib/pdf/document-properties";

describe("extractPdfFileMetadata", () => {
  it("reads Author and first-page header letterhead text", async () => {
    const pdf = await PDFDocument.create();
    pdf.setTitle("Replacement Cost Summary");
    pdf.setAuthor("Mohammed Mansour");
    pdf.setProducer("Microsoft Excel for Microsoft 365");
    pdf.setCreator("Microsoft Excel for Microsoft 365");
    pdf.setCreationDate(new Date("2026-04-13T19:49:01.000Z"));
    pdf.setModificationDate(new Date("2026-04-13T20:20:17.000Z"));

    const page = pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("TRACE CONSULTING GROUP LTD", {
      x: 40,
      y: 770,
      size: 10,
      font,
    });
    page.drawText("Table 1 - Replacement Cost Summary", {
      x: 72,
      y: 400,
      size: 12,
      font,
    });

    const bytes = Buffer.from(await pdf.save());
    const meta = await extractPdfFileMetadata(bytes);

    assert.equal(meta.author, "Mohammed Mansour");
    assert.equal(meta.title, "Replacement Cost Summary");
    assert.equal(meta.pageCount, 1);
    assert.ok(
      meta.headerText?.includes("TRACE CONSULTING GROUP LTD"),
      `headerText was ${JSON.stringify(meta.headerText)}`,
    );
    assert.ok(!meta.headerText?.includes("Table 1 - Replacement Cost Summary"));

    const hints = partyHintsFromPdfMetadata(meta);
    assert.ok(hints.includes("Mohammed Mansour"));
    assert.ok(hints.includes("TRACE CONSULTING GROUP LTD"));
    assert.ok(!hints.some((h) => /microsoft excel/i.test(h)));

    const block = formatPdfMetadataPromptBlock(meta);
    assert.ok(block.includes("Author: Mohammed Mansour"));
    assert.ok(block.includes("TRACE CONSULTING GROUP LTD"));
  });
});
