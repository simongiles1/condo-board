import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendIbmConvertOptions,
  DOCLING_PAGE_BREAK_PLACEHOLDER,
  extractIbmMarkdown,
  IbmDoclingAllKeysExhaustedError,
  IbmDoclingConnectivityError,
  IbmDoclingQuotaError,
  IbmDoclingRequestError,
  IBM_TARGET_TYPE,
  ibmJobConcurrencyFromEnv,
  isFatalIbmDoclingError,
  isIbmQuotaExhausted,
  listIbmDoclingCredentials,
  markdownFromIbmArtifactBytes,
  selectIbmMarkdownArtifact,
  splitMarkdownByPageBreak,
} from "../lib/email/docling-ibm";
import {
  assembleDoclingMarkdown,
  collapsePageRanges,
  extractDoclingPageMarkdown,
  formatDoclingPageBlock,
  listDoclingMarkerPageNos,
  tallyDoclingCacheCoverage,
} from "../lib/email/docling-lab";
import { ibmDoclingCostUsd } from "../lib/email/docling-provider";
import {
  estimateDoclingBackfillRateForRun,
  formatDoclingBackfillEta,
} from "../lib/email/docling-backfill-timing";
import { formatVisionErrorSummary } from "../lib/email/extraction-backfill-plan";
import { ibmTrialCoverage } from "../lib/email/ibm-docling-spend-shared";

describe("collapsePageRanges", () => {
  it("collapses contiguous pages", () => {
    assert.deepEqual(collapsePageRanges([1, 2, 3, 5, 6, 8]), [
      [1, 3],
      [5, 6],
      [8, 8],
    ]);
  });

  it("dedupes and sorts", () => {
    assert.deepEqual(collapsePageRanges([3, 1, 2, 2]), [[1, 3]]);
  });

  it("returns empty for no pages", () => {
    assert.deepEqual(collapsePageRanges([]), []);
  });
});

describe("docling page markers", () => {
  it("round-trips page extraction", () => {
    const markdown = assembleDoclingMarkdown([
      { pageNo: 1, markdown: "alpha table" },
      { pageNo: 3, markdown: "gamma" },
    ]);
    assert.equal(extractDoclingPageMarkdown(markdown, 1), "alpha table");
    assert.equal(extractDoclingPageMarkdown(markdown, 3), "gamma");
    assert.equal(extractDoclingPageMarkdown(markdown, 2), null);
  });

  it("formats a single block", () => {
    assert.equal(
      formatDoclingPageBlock(2, " hello "),
      "<!-- docling:page=2 -->\nhello\n<!-- /docling:page=2 -->",
    );
  });

  it("lists non-empty marker page numbers", () => {
    const markdown = assembleDoclingMarkdown([
      { pageNo: 1, markdown: "alpha" },
      { pageNo: 4, markdown: "delta" },
    ]);
    assert.deepEqual(listDoclingMarkerPageNos(markdown), [1, 4]);
    assert.deepEqual(listDoclingMarkerPageNos(""), []);
  });
});

describe("tallyDoclingCacheCoverage", () => {
  it("splits total into cached vs uncached pages and docs", () => {
    const textPages = new Map<string, number[]>([
      ["aa", [1, 2, 3]],
      ["bb", [1]],
    ]);
    const cached = new Map<string, Set<number>>([
      ["aa", new Set([1, 2])],
    ]);
    assert.deepEqual(tallyDoclingCacheCoverage(textPages, cached), {
      textRouteDocs: 2,
      textRoutePages: 4,
      cachedDoclingPages: 2,
      uncachedDoclingPages: 2,
      pendingDoclingDocs: 2,
      doneDoclingDocs: 0,
    });
  });

  it("counts a fully cached doc as done", () => {
    const textPages = new Map<string, number[]>([["aa", [1, 2]]]);
    const cached = new Map<string, Set<number>>([["aa", new Set([1, 2])]]);
    const tally = tallyDoclingCacheCoverage(textPages, cached);
    assert.equal(tally.uncachedDoclingPages, 0);
    assert.equal(tally.doneDoclingDocs, 1);
    assert.equal(tally.pendingDoclingDocs, 0);
  });
});

describe("splitMarkdownByPageBreak", () => {
  it("maps a single page without a placeholder", () => {
    assert.deepEqual(splitMarkdownByPageBreak("only page", [7]), [
      { pageNo: 7, markdown: "only page" },
    ]);
  });

  it("splits contiguous IBM markdown onto requested pages", () => {
    const markdown = ["alpha", "bravo", "charlie"].join(
      `\n${DOCLING_PAGE_BREAK_PLACEHOLDER}\n`,
    );
    assert.deepEqual(splitMarkdownByPageBreak(markdown, [5, 6, 7]), [
      { pageNo: 5, markdown: "alpha" },
      { pageNo: 6, markdown: "bravo" },
      { pageNo: 7, markdown: "charlie" },
    ]);
  });

  it("returns null when placeholder count does not match pages", () => {
    assert.equal(
      splitMarkdownByPageBreak(`a\n${DOCLING_PAGE_BREAK_PLACEHOLDER}\nb`, [1, 2, 3]),
      null,
    );
  });
});

describe("ibmDoclingCostUsd", () => {
  it("uses $4 per 1000 pages", () => {
    assert.equal(ibmDoclingCostUsd(0), 0);
    assert.equal(ibmDoclingCostUsd(10), 0.04);
  });
});

describe("ibmJobConcurrencyFromEnv", () => {
  it("defaults to 4 and caps at 8", () => {
    const previous = process.env.DOCLING_IBM_CONCURRENCY;
    delete process.env.DOCLING_IBM_CONCURRENCY;
    assert.equal(ibmJobConcurrencyFromEnv(), 4);
    process.env.DOCLING_IBM_CONCURRENCY = "8";
    assert.equal(ibmJobConcurrencyFromEnv(), 8);
    process.env.DOCLING_IBM_CONCURRENCY = "99";
    assert.equal(ibmJobConcurrencyFromEnv(), 8);
    process.env.DOCLING_IBM_CONCURRENCY = "0";
    assert.equal(ibmJobConcurrencyFromEnv(), 4);
    if (previous === undefined) delete process.env.DOCLING_IBM_CONCURRENCY;
    else process.env.DOCLING_IBM_CONCURRENCY = previous;
  });
});

describe("appendIbmConvertOptions", () => {
  it("sends page_range as two integers, not a JSON array string", () => {
    const form = new FormData();
    appendIbmConvertOptions(form, 1, 20);
    assert.deepEqual(form.getAll("page_range"), ["1", "20"]);
    assert.equal(form.get("document_timeout"), "3600");
    assert.equal(form.get("target_type"), IBM_TARGET_TYPE);
    assert.equal(form.get("target_type"), "presigned_url");
    assert.equal(
      form.getAll("page_range").some((value) => String(value).startsWith("[")),
      false,
    );
  });
});

describe("extractIbmMarkdown", () => {
  it("reads legacy document.md_content", () => {
    assert.equal(
      extractIbmMarkdown({ document: { md_content: " hello " }, status: "success" }),
      "hello",
    );
  });

  it("reads DoclingTaskResult result.content.md_content", () => {
    assert.equal(
      extractIbmMarkdown({
        result: {
          kind: "ExportResult",
          content: { filename: "a.pdf", md_content: "# Title" },
          status: "success",
        },
        num_succeeded: 1,
      }),
      "# Title",
    );
  });

  it("reads documents[0].content.md_content", () => {
    assert.equal(
      extractIbmMarkdown({
        documents: [{ status: "success", content: { md_content: "page one" } }],
      }),
      "page one",
    );
  });

  it("returns empty for presigned artifacts without inline markdown", () => {
    assert.equal(
      extractIbmMarkdown({
        result: {
          kind: "PresignedArtifactResult",
          documents: [{ artifacts: [{ uri: "https://example" }] }],
        },
      }),
      "",
    );
  });
});

describe("selectIbmMarkdownArtifact", () => {
  it("prefers markdown over json on a PresignedArtifactResult envelope", () => {
    const selected = selectIbmMarkdownArtifact({
      result: {
        kind: "PresignedArtifactResult",
        documents: [
          {
            status: "success",
            artifacts: [
              {
                artifact_type: "json",
                uri: "https://download.example.org/a.json",
              },
              {
                artifact_type: "markdown",
                uri: "https://download.example.org/a.md",
              },
            ],
          },
        ],
      },
    });
    assert.deepEqual(selected, {
      artifactType: "markdown",
      uri: "https://download.example.org/a.md",
    });
  });

  it("reads documents[] on the hosted IBM result envelope", () => {
    const selected = selectIbmMarkdownArtifact({
      documents: [
        {
          artifacts: [
            { artifactType: "text", uri: "https://download.example.org/a.txt" },
          ],
        },
      ],
    });
    assert.deepEqual(selected, {
      artifactType: "text",
      uri: "https://download.example.org/a.txt",
    });
  });
});

describe("markdownFromIbmArtifactBytes", () => {
  it("returns markdown bytes as text", () => {
    assert.equal(
      markdownFromIbmArtifactBytes("markdown", Buffer.from("# Title\n")),
      "# Title",
    );
  });

  it("reads md_content from a JSON artifact", () => {
    assert.equal(
      markdownFromIbmArtifactBytes(
        "json",
        Buffer.from(JSON.stringify({ document: { md_content: "hello" } })),
      ),
      "hello",
    );
  });
});

describe("isFatalIbmDoclingError", () => {
  it("treats request-shape errors as fatal", () => {
    assert.equal(
      isFatalIbmDoclingError(
        new IbmDoclingRequestError(
          "Input should be a valid integer, unable to parse string as an integer",
          422,
        ),
      ),
      true,
    );
  });

  it("treats pydantic integer messages as fatal even if untyped", () => {
    assert.equal(
      isFatalIbmDoclingError(
        new Error(
          "Input should be a valid integer, unable to parse string as an integer; Field required",
        ),
      ),
      true,
    );
  });

  it("does not treat per-doc conversion failures as fatal", () => {
    assert.equal(
      isFatalIbmDoclingError(new Error("IBM Docling conversion failed.")),
      false,
    );
    assert.equal(
      isFatalIbmDoclingError(new Error("Cached PDF not found under data/email-attachments.")),
      false,
    );
  });

  it("treats hosted IBM target-kind rejections as fatal", () => {
    assert.equal(
      isFatalIbmDoclingError(
        new Error(
          "target kind 'inbody' is not allowed. Allowed values: ['presigned_url', 's3']",
        ),
      ),
      true,
    );
  });

  it("does not treat empty markdown as a request-shape abort", () => {
    assert.equal(
      isFatalIbmDoclingError(
        new Error(
          "IBM Docling returned empty markdown (kind=PresignedArtifactResult; keys=result).",
        ),
      ),
      false,
    );
  });

  it("does not abort the run on a single-key quota 402", () => {
    assert.equal(
      isFatalIbmDoclingError(
        new IbmDoclingQuotaError("usage_limit_exceeded", 402, 1),
      ),
      false,
    );
  });

  it("aborts when IBM is unreachable (offline / DNS / reset)", () => {
    assert.equal(
      isFatalIbmDoclingError(
        new IbmDoclingConnectivityError(
          "Lost connection to IBM Docling while polling (fetch failed).",
        ),
      ),
      true,
    );
    const nested = new Error("fetch failed");
    nested.cause = new Error("getaddrinfo ENOTFOUND");
    assert.equal(isFatalIbmDoclingError(nested), true);
  });

  it("aborts when every IBM key is exhausted", () => {
    assert.equal(
      isFatalIbmDoclingError(
        new IbmDoclingAllKeysExhaustedError("All IBM Docling API keys are exhausted."),
      ),
      true,
    );
  });
});

describe("listIbmDoclingCredentials", () => {
  it("reads numbered URL/key pairs and reuses slot-1 URL", () => {
    const creds = listIbmDoclingCredentials({
      DOCLING_IBM_URL: "https://api.example.com/inst-a",
      DOCLING_IBM_API_KEY: "key-a",
      DOCLING_IBM_API_KEY_2: "key-b",
      DOCLING_IBM_URL_3: "https://api.example.com/inst-c",
      DOCLING_IBM_API_KEY_3: "key-c",
    });
    assert.equal(creds.length, 3);
    assert.deepEqual(
      creds.map((c) => ({ slot: c.slot, url: c.url, apiKey: c.apiKey })),
      [
        { slot: 1, url: "https://api.example.com/inst-a", apiKey: "key-a" },
        { slot: 2, url: "https://api.example.com/inst-a", apiKey: "key-b" },
        { slot: 3, url: "https://api.example.com/inst-c", apiKey: "key-c" },
      ],
    );
  });

  it("skips empty extra keys", () => {
    const creds = listIbmDoclingCredentials({
      DOCLING_IBM_URL: "https://api.example.com/inst-a",
      DOCLING_IBM_API_KEY: "key-a",
      DOCLING_IBM_API_KEY_2: "",
    });
    assert.equal(creds.length, 1);
  });
});

describe("isIbmQuotaExhausted", () => {
  it("detects HTTP 402 and usage_limit_exceeded bodies", () => {
    assert.equal(isIbmQuotaExhausted(402, {}), true);
    assert.equal(
      isIbmQuotaExhausted(403, { error: "usage_limit_exceeded", message: "Trial pages used" }),
      true,
    );
    assert.equal(isIbmQuotaExhausted(500, { detail: "boom" }), false);
  });
});

describe("formatVisionErrorSummary", () => {
  it("groups terminal vision failures by kind", () => {
    const summary = formatVisionErrorSummary([
      {
        contentHash: "a".repeat(64),
        pageNo: 107,
        status: "failed",
        attempts: 3,
        message: "Vision output truncated (max tokens) — requeued for retry.",
      },
      {
        contentHash: "b".repeat(64),
        pageNo: 18,
        status: "failed",
        attempts: 3,
        message: "Vision output truncated (max tokens) — requeued for retry.",
      },
      {
        contentHash: "c".repeat(64),
        pageNo: 8,
        status: "pending",
        attempts: 1,
        message: "still retrying",
      },
    ]);
    assert.match(summary ?? "", /2 vision pages failed/);
    assert.match(summary ?? "", /Vision output truncated/);
    assert.match(summary ?? "", /p107/);
    assert.match(summary ?? "", /p18/);
    assert.doesNotMatch(summary ?? "", /still retrying/);
  });

  it("omits per-page refs when a group is large", () => {
    const errors = Array.from({ length: 4 }, (_, i) => ({
      contentHash: String(i).padStart(64, "a"),
      pageNo: i + 1,
      status: "failed" as const,
      attempts: 3,
      message:
        "[GoogleGenerativeAI Error]: [429 Too Many Requests] Your project has exceeded its monthly spending cap.",
    }));
    const summary = formatVisionErrorSummary(errors);
    assert.match(summary ?? "", /4 vision pages failed/);
    assert.match(summary ?? "", /Gemini monthly spending cap/);
    assert.doesNotMatch(summary ?? "", /p1/);
  });

  it("returns null when nothing is terminally failed", () => {
    assert.equal(
      formatVisionErrorSummary([
        {
          contentHash: "a".repeat(64),
          pageNo: 1,
          status: "pending",
          attempts: 1,
          message: "retrying",
        },
      ]),
      null,
    );
  });

  it("surfaces pending prepaid-credit 429s so leftover cap rows are not the only signal", () => {
    const summary = formatVisionErrorSummary([
      {
        contentHash: "a".repeat(64),
        pageNo: 1,
        status: "pending",
        attempts: 0,
        message:
          "[GoogleGenerativeAI Error]: [429 Too Many Requests] Your prepayment credits are depleted.",
      },
      {
        contentHash: "b".repeat(64),
        pageNo: 2,
        status: "pending",
        attempts: 1,
        message: "retrying",
      },
    ]);
    assert.match(summary ?? "", /prepaid credits depleted/);
    assert.doesNotMatch(summary ?? "", /retrying/);
  });
});

describe("ibmTrialCoverage", () => {
  it("says 3 more 5k trials cover ~17.5k remaining after 869 billed", () => {
    const coverage = ibmTrialCoverage({
      remainingPages: 17499,
      usdPerPage: 0.004,
      accounts: [{ archived: false, trialPages: 5000, pagesUsed: 869 }],
    });
    assert.equal(coverage.trialPagesRemaining, 4131);
    assert.equal(coverage.extraAccountsNeeded, 3);
    assert.equal(coverage.shortfallPages, 13368);
  });

  it("is covered once those extra trials are added", () => {
    const coverage = ibmTrialCoverage({
      remainingPages: 17499,
      usdPerPage: 0.004,
      accounts: [
        { archived: false, trialPages: 5000, pagesUsed: 869 },
        { archived: false, trialPages: 5000, pagesUsed: 0 },
        { archived: false, trialPages: 5000, pagesUsed: 0 },
        { archived: false, trialPages: 5000, pagesUsed: 0 },
      ],
    });
    assert.equal(coverage.extraAccountsNeeded, 0);
    assert.ok(coverage.trialPagesRemaining >= 17499);
  });
});

describe("estimateDoclingBackfillRateForRun", () => {
  const now = Date.parse("2026-08-13T20:00:00.000Z");

  it("uses only the current stint for a live run, not lifetime pages", () => {
    const rate = estimateDoclingBackfillRateForRun(
      {
        status: "running",
        completedPages: 1000,
        totalPages: 2000,
        corpusUncachedPages: 5000,
        stintStartedAt: new Date(now - 60_000).toISOString(),
        completedPagesAtStintStart: 990,
        activeElapsedMs: 36_000_000,
      },
      now,
    );
    assert.equal(rate.samplePages, 10);
    assert.equal(rate.sampleMs, 60_000);
    assert.ok(Math.abs(rate.pagesPerMinute - 10) < 0.01);
    assert.ok(rate.runEtaMs != null);
    assert.ok(Math.abs((rate.runEtaMs ?? 0) - 6_000_000) < 1);
  });

  it("does not fall back to lifetime rate before the first stint page", () => {
    const rate = estimateDoclingBackfillRateForRun(
      {
        status: "running",
        completedPages: 500,
        totalPages: 2000,
        corpusUncachedPages: 5000,
        stintStartedAt: new Date(now - 120_000).toISOString(),
        completedPagesAtStintStart: 500,
        activeElapsedMs: 3_600_000,
      },
      now,
    );
    assert.equal(rate.samplePages, 0);
    assert.equal(rate.runEtaMs, null);
    assert.equal(rate.pagesPerMinute, 0);
  });

  it("uses full active time for a finished run", () => {
    const rate = estimateDoclingBackfillRateForRun(
      {
        status: "completed",
        completedPages: 100,
        totalPages: 100,
        corpusUncachedPages: 1000,
        stintStartedAt: null,
        completedPagesAtStintStart: 0,
        activeElapsedMs: 600_000,
      },
      now,
    );
    assert.equal(rate.samplePages, 100);
    assert.ok(Math.abs(rate.pagesPerMinute - 10) < 0.01);
    assert.equal(rate.runEtaMs, 0);
    assert.ok(rate.corpusEtaMs != null);
    assert.ok(Math.abs((rate.corpusEtaMs ?? 0) - 5_400_000) < 1);
  });
});

describe("formatDoclingBackfillEta", () => {
  it("shows a dash until a stint sample exists", () => {
    assert.equal(formatDoclingBackfillEta(null), "—");
  });

  it("formats remaining time", () => {
    assert.equal(formatDoclingBackfillEta(0), "Done");
    assert.equal(formatDoclingBackfillEta(30_000), "< 1 min");
    assert.equal(formatDoclingBackfillEta(125_000), "~2m 5s");
  });
});
