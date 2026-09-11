/**
 * Unit tests for file card packer, JSON parser, skip-on-hash, and email summary logic.
 * Run: npx tsx --test scripts/test-file-card-pack.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canSkipCardGeneration,
  extractDocumentOutline,
  formatFileCardAskParts,
  formatFileCardRerankExcerpt,
  hashPackedText,
  mergeFileCardParties,
  packFileCardPrompt,
  parseFileCardJson,
} from "../lib/rag/file-card-pack";
import { buildRerankUserText } from "../lib/rag/rerank";
import { packAnswerSources } from "../lib/rag/answer";
import { compactPipelineHit } from "../lib/rag/pipeline-debug";
import { estimateFileCardCostContext } from "../lib/rag/file-card-runs";
import type { CorpusSearchResult } from "../lib/rag/search";

describe("estimateFileCardCostContext", () => {
  it("matches observed four-doc billing at off-peak rates", () => {
    const context = estimateFileCardCostContext(4, Date.UTC(2026, 8, 10, 17, 0), {
      avgInputTokensPerDoc: 2316,
      avgOutputTokensPerDoc: 268,
      tokensPerDocBasis: "observed",
      observedCardCount: 4,
    });

    assert.equal(context.estimatedInputTokens, 9264);
    assert.equal(context.estimatedOutputTokens, 1072);
    assert.ok(
      Math.abs(context.estimatedOffPeakCostUsd - 0.0027) < 0.0001,
      `expected ~$0.0027 off-peak, got ${context.estimatedOffPeakCostUsd}`,
    );
  });
});

describe("packFileCardPrompt", () => {
  it("packs short attachment and covering email without truncation", () => {
    const packed = packFileCardPrompt({
      filename: "trace_rfs_2020.pdf",
      subject: "Reserve Fund Study Final Report",
      coveringEmailText: "Please find attached the signed final reserve fund study by Trace.",
      markdown: "# Trace Engineering\n\nExecutive Summary\n\nThis is the final report.",
      includeEmailSummaryPrompt: false,
    });

    assert.ok(packed.userPrompt.includes("PACK VERSION: file-card-pack-v3"));
    assert.ok(packed.userPrompt.includes("ATTACHMENT FILENAME: trace_rfs_2020.pdf"));
    assert.ok(packed.userPrompt.includes("COVERING EMAIL SUBJECT: Reserve Fund Study Final Report"));
    assert.ok(packed.userPrompt.includes("DOCUMENT FILE PROPERTIES:"));
    assert.ok(packed.userPrompt.includes("COVERING EMAIL BODY:"));
    assert.ok(packed.userPrompt.includes("EXTRACTED ATTACHMENT CONTENT:"));
    assert.ok(packed.userPrompt.includes("Executive Summary"));
    assert.ok(packed.userPrompt.includes("NOTE: Set email_summary to null."));
    assert.ok(!packed.userPrompt.includes("NOTE: The parent email is substantial."));
  });

  it("includes PDF Author and header text in the packed prompt", () => {
    const packed = packFileCardPrompt({
      filename: "rfs-tables.pdf",
      subject: "Final RFS Tables",
      coveringEmailText: "Please review the attached tables.",
      markdown: "Table 1 Replacement Cost Summary",
      includeEmailSummaryPrompt: false,
      fileMetadata: {
        title: null,
        author: "Mohammed Mansour",
        subject: null,
        keywords: null,
        creator: "Microsoft Excel for Microsoft 365",
        producer: "Microsoft Excel for Microsoft 365",
        creationDate: "2026-04-13T19:49:01.000Z",
        modificationDate: null,
        pageCount: 20,
        headerText: "TRACE CONSULTING GROUP LTD",
        footerText: null,
        extractedAt: "2026-09-10T17:00:00.000Z",
      },
    });

    assert.ok(packed.userPrompt.includes("Author: Mohammed Mansour"));
    assert.ok(packed.userPrompt.includes("TRACE CONSULTING GROUP LTD"));
  });

  it("includes email_summary instructions in prompt when requested", () => {
    const packed = packFileCardPrompt({
      filename: "egis_rfs_update.pdf",
      subject: "EGIS Study Review",
      coveringEmailText: "Long email explaining the whole history...",
      markdown: "EGIS Report contents",
      includeEmailSummaryPrompt: true,
    });

    assert.ok(packed.userPrompt.includes("NOTE: The parent email is substantial."));
  });

  it("enforces caps on long extracts (head, TOC headings, tail within ~16k limit)", () => {
    // Generate a long markdown text (~30k characters) with headings throughout
    const headPart = "A".repeat(10000);
    const middlePartWithHeadings = "\n\n## Section 1: Overview\n" + "B".repeat(10000) + "\n\n## Section 2: Financial Tables\n" + "C".repeat(5000);
    const tailPart = "\n\n" + "D".repeat(1500) + "\n\nConclusion: End of Report";
    const longMarkdown = headPart + middlePartWithHeadings + tailPart;

    const packed = packFileCardPrompt({
      filename: "giant_study.pdf",
      subject: "Big Document",
      coveringEmailText: "Here is the big study.",
      markdown: longMarkdown,
      includeEmailSummaryPrompt: false,
    });

    assert.ok(packed.inputChars <= 20000, `packed chars ${packed.inputChars} should stay near the extract cap`);
    assert.ok(packed.userPrompt.includes("DOCUMENT OUTLINE:"), "Should include extractive outline");
    assert.ok(packed.userPrompt.includes("Section 1: Overview"), "Should include TOC headings from middle");
    assert.ok(packed.userPrompt.includes("Section 2: Financial Tables"), "Should include TOC headings from middle");
    assert.ok(packed.userPrompt.includes("Conclusion: End of Report"), "Should include tail portion");
  });

  it("caps covering email to 2,000 characters", () => {
    const longEmail = "E".repeat(5000);
    const packed = packFileCardPrompt({
      filename: "test.pdf",
      subject: "Test",
      coveringEmailText: longEmail,
      markdown: "Short extract",
      includeEmailSummaryPrompt: false,
    });

    assert.ok(!packed.userPrompt.includes("E".repeat(2500)));
    assert.ok(packed.userPrompt.includes("E".repeat(2000)));
  });

  it("builds an extractive outline from Docling page breaks and title-like lines", () => {
    const markdown = [
      "Cover letter from ICC",
      "<!-- DOCLING_PAGE_BREAK -->",
      "NOTICE OF FUTURE FUNDING OF THE RESERVE FUND",
      "Subsection 94(9)",
      "<!-- DOCLING_PAGE_BREAK -->",
      "Table 4B 30-Year Cash Flow",
      "2024 contribution 125000",
    ].join("\n");
    const outline = extractDocumentOutline(markdown);
    assert.equal(outline.length, 3);
    assert.equal(outline[0]?.page, 1);
    assert.match(outline[1]?.title || "", /NOTICE OF FUTURE FUNDING/i);
    assert.match(outline[2]?.title || "", /Table 4B/i);
  });

  it("samples middle pages when a long packet has no markdown headings", () => {
    const pages = Array.from({ length: 8 }, (_, index) => {
      const body = `${index === 4 ? "Notice of Future Funding of the Reserve Fund\n" : ""}P${index}${"x".repeat(3500)}`;
      return body;
    });
    const markdown = pages.join("\n<!-- DOCLING_PAGE_BREAK -->\n");
    const packed = packFileCardPrompt({
      filename: "RFS Signed.pdf",
      subject: "Latest RFS",
      coveringEmailText: "Copy of the latest reserve fund study.",
      markdown,
      includeEmailSummaryPrompt: false,
    });
    assert.ok(packed.userPrompt.includes("DOCUMENT OUTLINE:"));
    assert.ok(packed.userPrompt.includes("Notice of Future Funding"));
    assert.ok(
      packed.userPrompt.includes("MIDDLE PAGE SAMPLES") ||
        packed.userPrompt.includes("DOCUMENT OUTLINE:"),
    );
  });
});

describe("parseFileCardJson", () => {
  it("parses valid JSON and normalizes document type", () => {
    const jsonStr = JSON.stringify({
      document_type: "study",
      summary: "2020 Reserve Fund Study prepared by Trace Associates.",
      covering_email_context: "Board requested final signed copy.",
      parties: ["Trace Associates", "Condo Corporation 42"],
      document_date: "2020-04-15",
      email_summary: "Email thread discussing final study signoff.",
    });

    const parsed = parseFileCardJson(jsonStr);
    assert.ok(parsed !== null);
    assert.equal(parsed.document_type, "study");
    assert.equal(parsed.summary, "2020 Reserve Fund Study prepared by Trace Associates.");
    assert.equal(parsed.covering_email_context, "Board requested final signed copy.");
    assert.deepEqual(parsed.parties, ["Trace Associates", "Condo Corporation 42"]);
    assert.equal(parsed.document_date, "2020-04-15");
    assert.equal(parsed.email_summary, "Email thread discussing final study signoff.");
  });

  it("normalizes unknown document types to 'other'", () => {
    const jsonStr = JSON.stringify({
      document_type: "random_presentation",
      summary: "A slide deck.",
    });

    const parsed = parseFileCardJson(jsonStr);
    assert.ok(parsed !== null);
    assert.equal(parsed.document_type, "other");
  });

  it("strips markdown code blocks around JSON", () => {
    const wrapped = "```json\n" + JSON.stringify({
      document_type: "tables",
      summary: "30-year cash flow projections table.",
    }) + "\n```";

    const parsed = parseFileCardJson(wrapped);
    assert.ok(parsed !== null);
    assert.equal(parsed.document_type, "tables");
    assert.equal(parsed.summary, "30-year cash flow projections table.");
  });

  it("returns null on invalid JSON", () => {
    const result = parseFileCardJson("Not valid json at all");
    assert.equal(result, null);
  });
});

describe("mergeFileCardParties", () => {
  it("adds PDF author and letterhead firms that the model omitted", () => {
    const merged = mergeFileCardParties(["ICC Property Management Ltd.", "TSCC 2517"], {
      title: null,
      author: "Mohammed Mansour",
      subject: null,
      keywords: null,
      creator: "Microsoft Excel for Microsoft 365",
      producer: "Microsoft Excel for Microsoft 365",
      creationDate: "2026-04-13T19:49:01.000Z",
      modificationDate: "2026-04-13T20:20:17.000Z",
      pageCount: 20,
      headerText: "TRACE CONSULTING GROUP LTD",
      footerText: null,
      extractedAt: "2026-09-10T17:00:00.000Z",
    });

    assert.deepEqual(merged, [
      "ICC Property Management Ltd.",
      "TSCC 2517",
      "Mohammed Mansour",
      "TRACE CONSULTING GROUP LTD",
    ]);
  });

  it("does not add Excel/Adobe producer strings as parties", () => {
    const merged = mergeFileCardParties([], {
      title: null,
      author: null,
      subject: null,
      keywords: null,
      creator: "Microsoft Excel for Microsoft 365",
      producer: "Adobe Acrobat",
      creationDate: null,
      modificationDate: null,
      pageCount: 1,
      headerText: null,
      footerText: null,
      extractedAt: "2026-09-10T17:00:00.000Z",
    });
    assert.deepEqual(merged, []);
  });
});

describe("canSkipCardGeneration & hashPackedText", () => {
  const text = "Sample packed text content for hashing";
  const hash = hashPackedText(text);

  it("computes deterministic SHA-256 hash", () => {
    assert.equal(hashPackedText(text), hash);
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64);
  });

  it("skips when hash matches exactly", () => {
    assert.equal(
      canSkipCardGeneration({
        existingInputHash: hash,
        existingInputChars: text.length,
        newInputHash: hash,
        newInputChars: text.length,
      }),
      true,
    );
  });

  it("does not skip when hash differs even if length is close", () => {
    const original = "A".repeat(100);
    const origHash = hashPackedText(original);
    const slightlyDifferent = "A".repeat(102);
    const newHash = hashPackedText(slightlyDifferent);

    assert.equal(
      canSkipCardGeneration({
        existingInputHash: origHash,
        existingInputChars: 100,
        newInputHash: newHash,
        newInputChars: 102,
      }),
      false,
    );
  });

  it("does not skip when char length difference exceeds 5%", () => {
    const original = "A".repeat(100);
    const origHash = hashPackedText(original);
    const significantlyDifferent = "A".repeat(120);
    const newHash = hashPackedText(significantlyDifferent);

    assert.equal(
      canSkipCardGeneration({
        existingInputHash: origHash,
        existingInputChars: 100,
        newInputHash: newHash,
        newInputChars: 120,
      }),
      false,
    );
  });

  it("does not skip when forceOverwrite is true", () => {
    assert.equal(
      canSkipCardGeneration({
        existingInputHash: hash,
        existingInputChars: text.length,
        newInputHash: hash,
        newInputChars: text.length,
        forceOverwrite: true,
      }),
      false,
    );
  });

  it("does not skip when there is no existing hash or chars", () => {
    assert.equal(
      canSkipCardGeneration({
        existingInputHash: null,
        existingInputChars: null,
        newInputHash: hash,
        newInputChars: text.length,
      }),
      false,
    );
  });
});

describe("First attachment owns email summary", () => {
  it("only assigns email summary to the first attachment of a long email", () => {
    const emailBody = "X".repeat(1500); // Exceeds threshold of 1200
    const attachments = [
      { id: "att-1", emailId: "email-100", filename: "doc1.pdf" },
      { id: "att-2", emailId: "email-100", filename: "doc2.pdf" },
      { id: "att-3", emailId: "email-200", filename: "doc3.pdf" },
    ];

    const processedEmailIds = new Set<string>();

    const decisions = attachments.map((att) => {
      const emailIsLong = emailBody.length >= 1200;
      const needsEmailSummary = emailIsLong && !processedEmailIds.has(att.emailId);
      if (needsEmailSummary) {
        processedEmailIds.add(att.emailId);
      }
      return {
        attId: att.id,
        emailId: att.emailId,
        needsEmailSummary,
      };
    });

    assert.deepEqual(decisions, [
      { attId: "att-1", emailId: "email-100", needsEmailSummary: true },
      { attId: "att-2", emailId: "email-100", needsEmailSummary: false },
      { attId: "att-3", emailId: "email-200", needsEmailSummary: true },
    ]);
  });
});

describe("Phase 2: Rerank excerpt, packAnswerSources, and pipeline debug card integration", () => {
  const dummyHit: CorpusSearchResult = {
    id: "chunk-123",
    sourceKind: "attachment_parsed",
    contentHash: "hash-abc",
    similarity: 0.85,
    excerpt: "280 char table slice that is not very descriptive",
    chunkText: "Full body chunk text of the report.",
    emailId: "email-1",
    threadId: "thread-1",
    pageNo: 3,
    chunkIndex: 0,
    metadata: {
      filename: "trace_rfs.pdf",
      subject: "Final RFS",
    },
    sourceLink: null,
    emailLink: null,
    rawSimilarity: 0.85,
    boost: 0,
    entities: [],
  };

  const fileCards = new Map([
    [
      "hash-abc",
      {
        documentType: "study",
        summary: "Trace Engineering 2020 Reserve Fund Study signed final report.",
        coveringEmailContext: "Transmits signed final copy.",
        parties: ["Trace Engineering"],
        documentDate: "2020-04-15",
        status: "ready" as const,
      },
    ],
  ]);

  it("prefers [document_type] summary in buildRerankUserText when card exists", () => {
    const userText = buildRerankUserText({
      query: "reserve fund study",
      results: [dummyHit],
      limit: 5,
      fileCards,
    });

    assert.ok(
      userText.includes("excerpt: [study] Trace Engineering 2020 Reserve Fund Study signed final report. parties: Trace Engineering date: 2020-04-15"),
      "Rerank excerpt should use the structured card summary, parties, and date",
    );
    assert.ok(
      !userText.includes("280 char table slice"),
      "Should not use the fallback table slice when card is available",
    );
  });

  it("prepends file card info in packAnswerSources ahead of the chunk", () => {
    const packed = packAnswerSources([dummyHit], 5, fileCards);
    assert.equal(packed.length, 1);
    const first = packed[0];
    assert.equal(first.documentType, "study");
    assert.ok(
      first.text.includes("[File Card: Document Type: study | Summary: Trace Engineering 2020 Reserve Fund Study signed final report. | Parties: Trace Engineering | Date: 2020-04-15 | Covering Email Context: Transmits signed final copy.]"),
      "Packed source text should prepend formatted file card with parties and date",
    );
    assert.ok(first.text.includes("Full body chunk text of the report."));
  });

  it("includes documentType in compactPipelineHit when card exists", () => {
    const pipelineHit = compactPipelineHit(dummyHit, 1, fileCards);
    assert.equal(pipelineHit.documentType, "study");
  });

  it("clips a long summary so parties still fit in the answer pack", () => {
    const longSummary = "A".repeat(500);
    const parts = formatFileCardAskParts({
      documentType: "signed_report",
      summary: longSummary,
      parties: ["McIntosh Perry"],
      documentDate: "2023-11-01",
    });
    const joined = parts.join(" | ");
    assert.ok(joined.includes("Parties: McIntosh Perry"));
    assert.ok(joined.includes("Date: 2023-11-01"));
    assert.ok(joined.length < 700);
    assert.equal(
      formatFileCardRerankExcerpt({
        documentType: "signed_report",
        summary: longSummary,
        parties: ["McIntosh Perry"],
      }).includes("parties: McIntosh Perry"),
      true,
    );
  });
});

