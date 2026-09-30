/**
 * Docling-style page rewrite parsing.
 * Run: npx tsx --test scripts/test-meeting-v3-page-rewrite.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PAGE_REWRITE_SYSTEM_PROMPT, readPageRewriteMarkdown } from "../lib/meeting-v3/page-rewrite";
import {
  isMeetingsV3Workspace,
  meetingsV3PackageError,
  meetingsV3PackageStage,
} from "../lib/meeting-v3/workspace";

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
  it("asks for the same markdown style on every kind of page", () => {
    assert.match(PAGE_REWRITE_SYSTEM_PROMPT, /same markdown style/);
    assert.match(PAGE_REWRITE_SYSTEM_PROMPT, /lead times/);
    assert.match(PAGE_REWRITE_SYSTEM_PROMPT, /weeks or months/);
    assert.match(PAGE_REWRITE_SYSTEM_PROMPT, /reference lists/);
    assert.match(PAGE_REWRITE_SYSTEM_PROMPT, /on page 174 - 175/);
  });
});

describe("v3 workspace flag", () => {
  it("keeps V2 meetings off the V3 list", () => {
    assert.equal(isMeetingsV3Workspace(null), false);
    assert.equal(isMeetingsV3Workspace({}), false);
    assert.equal(meetingsV3PackageStage({}), "created");
    assert.equal(meetingsV3PackageError({}), null);
  });

  it("reads a V3 package stage and error", () => {
    const settings = {
      v3Package: {
        workspace: true as const,
        stage: "failed" as const,
        error: "Docling sidecar is down",
        updatedAt: "2026-09-30T00:00:00.000Z",
      },
    };
    assert.equal(isMeetingsV3Workspace(settings), true);
    assert.equal(meetingsV3PackageStage(settings), "failed");
    assert.equal(meetingsV3PackageError(settings), "Docling sidecar is down");
  });

  it("treats a stored quote-ledger stage as page correction", () => {
    assert.equal(meetingsV3PackageStage({ v3Package: { stage: "reading_quotes" } }), "correcting");
  });
});
