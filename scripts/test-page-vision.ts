/**
 * Unit checks for page vision helpers (no network / no DB).
 * Run: npx tsx --test scripts/test-page-vision.ts
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  formatPageVisionBlock,
  classifyVisionError,
  isFatalGeminiVisionError,
  isGeminiVisionQuotaMessage,
  isDegeneratePageVisionMarkdown,
  pageVisionArtifactRelativeKey,
  pageVisionMarkerClose,
  pageVisionMarkerOpen,
  sanitizePageVisionMarkdown,
  spliceVisionPageIntoMarkdown,
} from "../lib/email/page-vision-shared";
import { pageVisionUserText } from "../lib/email/page-vision-prompt";
import {
  isVisionImageMime,
  normalizeVisionImageMime,
} from "../lib/email/attachment-vision-image-shared";
import { textItemsToPlainText } from "../lib/pdf/extract-page-text";

describe("pageVisionArtifactRelativeKey", () => {
  it("pads page numbers and stays relative", () => {
    const key = pageVisionArtifactRelativeKey("abc123", 7);
    assert.equal(key, "data/email-attachments/abc123/vision/p007.md");
    assert.equal(path.isAbsolute(key), false);
  });
});

describe("sanitizePageVisionMarkdown", () => {
  it("collapses runaway table separator dashes", () => {
    const runaway = `SITE REVIEW REPORT #1

| Project Number | 25.0368.4 |
| :--------------- | :${"-".repeat(5000)} |
`;
    const cleaned = sanitizePageVisionMarkdown(runaway);
    assert.ok(cleaned.includes("SITE REVIEW REPORT #1"));
    assert.ok(cleaned.includes("| Project Number | 25.0368.4 |"));
    assert.ok(!cleaned.includes("-".repeat(40)));
    assert.ok(cleaned.length < 200);
  });

  it("is a no-op for normal markdown", () => {
    const normal = "# Title\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    assert.equal(sanitizePageVisionMarkdown(normal), normal);
  });
});

describe("isDegeneratePageVisionMarkdown", () => {
  it("flags dash-heavy runaways", () => {
    assert.equal(
      isDegeneratePageVisionMarkdown(`x\n| :${"-".repeat(2000)} |\n`),
      true,
    );
  });

  it("allows normal tables", () => {
    assert.equal(
      isDegeneratePageVisionMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |\n"),
      false,
    );
  });
});

describe("pageVisionUserText", () => {
  it("includes native text when provided", () => {
    const text = pageVisionUserText(3, "Picture 1: fence");
    assert.ok(text.includes("Picture 1: fence"));
    assert.ok(text.includes("photograph"));
  });

  it("uses image wording for image kind", () => {
    const text = pageVisionUserText(1, null, { kind: "image" });
    assert.ok(text.toLowerCase().includes("image"));
    assert.ok(!text.includes("PDF page"));
  });
});

describe("isVisionImageMime", () => {
  it("accepts common image types", () => {
    assert.equal(isVisionImageMime("image/png"), true);
    assert.equal(isVisionImageMime("image/jpeg; charset=binary"), true);
    assert.equal(isVisionImageMime("image/jpg"), true);
    assert.equal(isVisionImageMime("application/pdf"), false);
  });

  it("normalizes jpg to jpeg", () => {
    assert.equal(normalizeVisionImageMime("image/jpg"), "image/jpeg");
  });
});

describe("textItemsToPlainText", () => {
  it("groups items on the same baseline into one line", () => {
    const text = textItemsToPlainText([
      { str: "Hello", transform: [1, 0, 0, 1, 10, 100] },
      { str: " ", transform: [1, 0, 0, 1, 40, 100] },
      { str: "world", transform: [1, 0, 0, 1, 48, 100] },
      { str: "Next", transform: [1, 0, 0, 1, 10, 80] },
    ]);
    assert.equal(text, "Hello world\nNext");
  });
});

describe("spliceVisionPageIntoMarkdown", () => {
  it("appends when no prior page markers", () => {
    const result = spliceVisionPageIntoMarkdown(
      "# Doc\n\nHello",
      2,
      "Invoice total: $100",
    );
    assert.ok(result.startsWith("# Doc\n\nHello"));
    assert.ok(result.includes(pageVisionMarkerOpen(2)));
    assert.ok(result.includes("Invoice total: $100"));
    assert.ok(result.includes(pageVisionMarkerClose(2)));
  });

  it("creates content when markdown is empty", () => {
    const result = spliceVisionPageIntoMarkdown("", 1, "Scan page");
    assert.equal(result, `${formatPageVisionBlock(1, "Scan page")}\n`);
  });

  it("replaces an existing page block", () => {
    const first = spliceVisionPageIntoMarkdown("# Base", 1, "old text");
    const second = spliceVisionPageIntoMarkdown(first, 1, "new text");
    assert.equal(second.includes("old text"), false);
    assert.ok(second.includes("new text"));
    assert.equal(second.split(pageVisionMarkerOpen(1)).length - 1, 1);
  });

  it("leaves other page blocks intact when replacing one", () => {
    let md = spliceVisionPageIntoMarkdown("# Base", 1, "page one");
    md = spliceVisionPageIntoMarkdown(md, 2, "page two");
    md = spliceVisionPageIntoMarkdown(md, 1, "page one revised");
    assert.ok(md.includes("page one revised"));
    assert.ok(md.includes("page two"));
    assert.equal(md.includes("page one\n"), false);
  });

  it("inserts a middle vision page between Docling neighbors", () => {
    const base = [
      "<!-- docling:page=1 -->",
      "cover",
      "<!-- /docling:page=1 -->",
      "",
      "<!-- docling:page=3 -->",
      "agenda",
      "<!-- /docling:page=3 -->",
      "",
    ].join("\n");
    const result = spliceVisionPageIntoMarkdown(base, 2, "scan of page 2");
    const i1 = result.indexOf("<!-- docling:page=1 -->");
    const i2 = result.indexOf(pageVisionMarkerOpen(2));
    const i3 = result.indexOf("<!-- docling:page=3 -->");
    assert.ok(i1 >= 0 && i2 > i1 && i3 > i2);
    assert.ok(result.includes("scan of page 2"));
  });

  it("inserts page 1 before later markers instead of appending", () => {
    const base = [
      "<!-- docling:page=4 -->",
      "later",
      "<!-- /docling:page=4 -->",
    ].join("\n");
    const result = spliceVisionPageIntoMarkdown(base, 1, "front");
    assert.ok(result.indexOf(pageVisionMarkerOpen(1)) < result.indexOf("<!-- docling:page=4 -->"));
  });
});

describe("Gemini vision quota classification", () => {
  it("flags 429 spending-cap messages as fatal", () => {
    const message =
      "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent: [429 Too Many Requests] Your project has exceeded its monthly spending cap.";
    assert.equal(isGeminiVisionQuotaMessage(message), true);
    assert.equal(isFatalGeminiVisionError(new Error(message)), true);
    assert.equal(classifyVisionError(message).kind, "gemini_spend_cap");
  });

  it("flags prepaid-credit 429s as fatal, not a spend cap", () => {
    const message =
      "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent: [429 Too Many Requests] Your prepayment credits are depleted. Please go to AI Studio.";
    assert.equal(isGeminiVisionQuotaMessage(message), true);
    assert.equal(isFatalGeminiVisionError(new Error(message)), true);
    assert.equal(classifyVisionError(message).kind, "gemini_credits");
  });

  it("treats generic 429 RESOURCE_EXHAUSTED as a rate limit, not fatal", () => {
    const message =
      "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent: [429 Too Many Requests] RESOURCE_EXHAUSTED Please try again later.";
    assert.equal(isGeminiVisionQuotaMessage(message), false);
    assert.equal(isFatalGeminiVisionError(new Error(message)), false);
    assert.equal(classifyVisionError(message).kind, "gemini_rate_limit");
  });

  it("does not treat generic fetch failed as a spend cap", () => {
    const message =
      "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent: fetch failed";
    assert.equal(isGeminiVisionQuotaMessage(message), false);
    assert.equal(classifyVisionError(message).kind, "gemini_fetch");
  });

  it("classifies encrypted pdf-lib errors", () => {
    const message =
      "Input document to `PDFDocument.load` is encrypted. You can use `PDFDocument.load(..., { ignoreEncryption: true })` if you wish to load the document anyways.";
    assert.equal(classifyVisionError(message).kind, "encrypted_pdf");
  });
});

describe("Gemini 2.5 Flash cost accounting", () => {
  it("uses $0.30/$2.50 per 1M and bills thinking tokens", async () => {
    const { estimateCostUsd, extractTokenUsage } = await import(
      "../lib/gemini/usage"
    );
    const usage = extractTokenUsage({
      promptTokenCount: 1_000_000,
      candidatesTokenCount: 100_000,
      thoughtsTokenCount: 400_000,
      totalTokenCount: 1_500_000,
    });
    assert.equal(usage.inputTokens, 1_000_000);
    assert.equal(usage.outputTokens, 500_000);
    assert.equal(
      Math.round(estimateCostUsd("gemini-2.5-flash", usage) * 1_000_000),
      Math.round((0.3 + 2.5 * 0.5) * 1_000_000),
    );
  });

  it("falls back to total minus prompt when thoughtsTokenCount is missing", async () => {
    const { extractTokenUsage } = await import("../lib/gemini/usage");
    const usage = extractTokenUsage({
      promptTokenCount: 200,
      candidatesTokenCount: 50,
      totalTokenCount: 800,
    });
    assert.equal(usage.outputTokens, 600);
  });
});
