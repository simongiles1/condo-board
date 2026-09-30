/**
 * Docling-style page rewrite parsing.
 * Run: npx tsx --test scripts/test-meeting-v3-page-rewrite.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PAGE_REWRITE_SYSTEM_PROMPT, readPageRewriteMarkdown } from "../lib/meeting-v3/page-rewrite";

const page = `## Booster pump

| Item | Ambient | Applied |
| --- | --- | --- |
| Base Bid Amount | $210,994.00 | $226,928.00 |
| Pump Lead Time | 6 months | 6 months |`;

describe("page rewrite markdown", () => {
  it("keeps a markdown page", () => {
    assert.equal(readPageRewriteMarkdown(`\n${page}\n`), page);
  });

  it("unwraps a markdown fence", () => {
    assert.equal(readPageRewriteMarkdown("```markdown\n" + page + "\n```"), page);
  });

  it("rejects an empty reply", () => {
    assert.throws(() => readPageRewriteMarkdown("   "), /empty/);
  });

  it("rejects a JSON object", () => {
    assert.throws(
      () => readPageRewriteMarkdown('{"rows":[{"amount":"1000.00"}]}'),
      /JSON/,
    );
  });
});

describe("page rewrite prompt", () => {
  it("asks for the Docling style and the non-dollar cells", () => {
    assert.match(PAGE_REWRITE_SYSTEM_PROMPT, /same markdown style/);
    assert.match(PAGE_REWRITE_SYSTEM_PROMPT, /lead times/);
    assert.match(PAGE_REWRITE_SYSTEM_PROMPT, /weeks or months/);
    assert.match(PAGE_REWRITE_SYSTEM_PROMPT, /Do not turn the page into a list of bids/);
  });
});
