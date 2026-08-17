/**
 * Unit checks for attachment Markdown helpers (no network / no DB).
 * Run: npx tsx --test scripts/test-attachment-markdown.ts
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  classifySizeClass,
  isConvertibleMime,
  MIN_CHARS_PER_PAGE,
  SHORT_DOC_MAX_PAGES,
  shouldFlagNeedsOcr,
  canMarkExtractionParsed,
  attachmentMarkdownRelativeKey,
  resolveAttachmentStoragePath,
} from "../lib/email/attachment-markdown-shared";

describe("isConvertibleMime", () => {
  it("accepts PDF and Office formats", () => {
    assert.equal(isConvertibleMime("application/pdf"), true);
    assert.equal(
      isConvertibleMime(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
      true,
    );
    assert.equal(
      isConvertibleMime(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
      true,
    );
    assert.equal(isConvertibleMime("text/csv"), true);
  });

  it("rejects images and archives (OCR/vision is a later lane)", () => {
    assert.equal(isConvertibleMime("image/png"), false);
    assert.equal(isConvertibleMime("image/jpeg"), false);
    assert.equal(isConvertibleMime("application/zip"), false);
    assert.equal(isConvertibleMime("video/mp4"), false);
  });
});

describe("attachment storage keys", () => {
  it("stores relative markdown keys", () => {
    const key = attachmentMarkdownRelativeKey("abc123");
    assert.equal(key, "data/email-attachments/abc123.md");
    assert.equal(path.isAbsolute(key), false);
  });

  it("resolves relative keys against cwd and keeps absolute legacy paths", () => {
    const relative = resolveAttachmentStoragePath(
      "data/email-attachments/abc123.md",
    );
    assert.ok(relative.endsWith(path.join("data", "email-attachments", "abc123.md")));
    const absolute = path.join(process.cwd(), "tmp", "legacy.md");
    assert.equal(resolveAttachmentStoragePath(absolute), absolute);
  });
});

describe("classifySizeClass", () => {
  it("uses page count when present", () => {
    assert.equal(classifySizeClass(1, 100), "short");
    assert.equal(classifySizeClass(SHORT_DOC_MAX_PAGES, 10_000), "short");
    assert.equal(classifySizeClass(SHORT_DOC_MAX_PAGES + 1, 10_000), "long");
    assert.equal(classifySizeClass(27, 50_000), "long");
  });

  it("falls back to markdown length when pages unknown", () => {
    assert.equal(classifySizeClass(null, 5_000), "short");
    assert.equal(classifySizeClass(null, 50_000), "long");
  });
});

describe("shouldFlagNeedsOcr", () => {
  it("flags scanned packages and keeps text-layer docs", () => {
    assert.equal(
      shouldFlagNeedsOcr({ pageCount: 224, markdownChars: 4377 }).needsOcr,
      true,
    );
    assert.equal(
      shouldFlagNeedsOcr({ pageCount: 27, markdownChars: 53849 }).needsOcr,
      false,
    );
    assert.equal(
      shouldFlagNeedsOcr({ pageCount: 1, markdownChars: 50 }).needsOcr,
      false,
    );
  });

  it("uses the spike-derived chars/page floor", () => {
    assert.ok(1053 > MIN_CHARS_PER_PAGE);
    assert.ok(19.5 < MIN_CHARS_PER_PAGE);
  });
});

describe("canMarkExtractionParsed", () => {
  const ready = {
    parseStatus: "pending",
    pendingVision: 0,
    processingVision: 0,
    failedVision: 0,
    hasUsableMarkdown: true,
    uncachedTextPages: 0,
  };

  it("promotes pending PDFs when Docling/vision work is done", () => {
    assert.equal(canMarkExtractionParsed(ready), true);
    assert.equal(
      canMarkExtractionParsed({ ...ready, parseStatus: "needs_ocr" }),
      true,
    );
  });

  it("does not promote when vision failed or text pages are still uncached", () => {
    assert.equal(
      canMarkExtractionParsed({ ...ready, failedVision: 1 }),
      false,
    );
    assert.equal(
      canMarkExtractionParsed({ ...ready, uncachedTextPages: 3 }),
      false,
    );
    assert.equal(
      canMarkExtractionParsed({ ...ready, hasUsableMarkdown: false }),
      false,
    );
    assert.equal(
      canMarkExtractionParsed({ ...ready, parseStatus: "parsed" }),
      false,
    );
  });
});
