/**
 * Unit and integration tests for Corpus RAG (Chunking, Embeddings, Search, Indexing).
 * Run: npx tsx --test scripts/test-corpus-rag.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { after, describe, it } from "node:test";

function loadEnvLocal() {
  try {
    if (!fs.existsSync(".env.local")) return;
    for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sep = trimmed.indexOf("=");
      if (sep === -1) continue;
      const key = trimmed.slice(0, sep).trim();
      let val = trimmed.slice(sep + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore
  }
}
loadEnvLocal();

import {
  chunkAttachmentMarkdown,
  chunkEmailBody,
  chunkText,
  hashChunkText,
} from "../lib/rag/chunk";
import { cosineSimilarity } from "../lib/rag/embed";
import {
  applyRegistryBoost,
  matchRegistryCatalog,
  REGISTRY_BOOST_PHRASE,
  REGISTRY_BOOST_TOKEN,
  scoreRegistryEntry,
  type RegistryCatalogEntry,
} from "../lib/rag/registry-boost";
import {
  buildCorpusAnswerUserText,
  emptyCorpusAnswer,
  MAX_ANSWER_CHUNK_CHARS,
  MAX_ANSWER_CONTEXT_CHUNKS,
  packAnswerSources,
  parseGroundedAnswerJson,
  mergeAnswerCitations,
  salvageGroundedAnswerFromText,
  selectNearMisses,
  stripJsonFence,
} from "../lib/rag/answer";
import { extractExcerpt } from "../lib/rag/search";

describe("Corpus RAG - Text Chunking", () => {
  it("returns empty array for empty or whitespace text", () => {
    assert.deepEqual(chunkText(""), []);
    assert.deepEqual(chunkText("   \n\n  "), []);
  });

  it("keeps short text under maxChars as a single chunk", () => {
    const text = "This is a short email about the upcoming board meeting.";
    const chunks = chunkText(text, { minChars: 100, maxChars: 500 });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].chunkIndex, 0);
    assert.equal(chunks[0].chunkText, text);
    assert.equal(chunks[0].charStart, 0);
    assert.equal(chunks[0].charEnd, text.length);
  });

  it("splits multi-paragraph text along paragraph and heading boundaries", () => {
    const para1 = "Section 1: Executive Summary\n" + "A".repeat(450);
    const para2 = "\n\n## Section 2: Reserve Fund Study\n" + "B".repeat(450);
    const para3 = "\n\n## Section 3: Engineering Recommendations\n" + "C".repeat(450);
    const fullText = para1 + para2 + para3;

    const chunks = chunkText(fullText, { minChars: 300, maxChars: 600, overlapChars: 50 });
    assert.ok(chunks.length >= 3, `Expected at least 3 chunks, got ${chunks.length}`);
    assert.ok(chunks[0].chunkText.includes("Section 1"));
    assert.ok(chunks[1].chunkText.includes("Section 2"));
  });

  it("produces deterministic SHA-256 content hashes", () => {
    const textA = "Reserve fund study update for 2026 fiscal year";
    const hash1 = hashChunkText(textA);
    const hash2 = hashChunkText(textA);
    const hash3 = hashChunkText(textA + " ");

    assert.equal(hash1, hash2);
    assert.equal(hash1, hash3, "Whitespace differences should normalize to the same hash");
    assert.equal(hash1.length, 64);
  });

  it("chunks email body preferring bodyTextUnique with fallback to bodyText", () => {
    const emailWithUnique = {
      id: "email_1",
      subject: "Reserve Fund Discussion",
      fromAddress: "board@condo.ca",
      receivedAt: "2026-03-01T12:00:00Z",
      threadId: "thread_1",
      bodyText: "Full quote text that should be skipped",
      bodyTextUnique: "Unique text about the reserve fund study draft.",
    };

    const res1 = chunkEmailBody(emailWithUnique);
    assert.equal(res1.metadata.emailId, "email_1");
    assert.equal(res1.chunks.length, 1);
    assert.ok(res1.chunks[0].chunkText.includes("Unique text"));

    const emailFallback = {
      id: "email_2",
      subject: "Elevator Quote",
      fromAddress: "pm@condo.ca",
      receivedAt: "2026-03-02T12:00:00Z",
      threadId: null,
      bodyText: "Only regular body text is present.",
      bodyTextUnique: null,
    };

    const res2 = chunkEmailBody(emailFallback);
    assert.ok(res2.chunks[0].chunkText.includes("Only regular body"));
  });

  it("chunks attachment markdown and attaches metadata", () => {
    const attachment = {
      contentHash: "hash_abc123",
      attachmentId: "att_456",
      filename: "Reserve_Fund_Study_2026.pdf",
      mimeType: "application/pdf",
      emailId: "email_99",
      subject: "Annual Reserve Study",
    };

    const markdown = "# Comprehensive Reserve Fund Study\n\nPrepared for Studio 1 Condominiums.";
    const res = chunkAttachmentMarkdown(attachment, markdown);
    assert.equal(res.metadata.contentHash, "hash_abc123");
    assert.equal(res.metadata.filename, "Reserve_Fund_Study_2026.pdf");
    assert.ok(res.chunks[0].chunkText.startsWith("File: Reserve_Fund_Study_2026.pdf"));
    assert.ok(res.chunks[0].chunkText.includes("Email: Annual Reserve Study"));
    assert.ok(res.chunks[0].chunkText.includes(markdown));
  });
});

describe("Corpus RAG - Filename lexical match", () => {
  it("extracts spaced PDF names and matches the RFS tables file", async () => {
    const {
      extractFileLikeNames,
      filenameMatchesQuery,
      filenameSearchNeedles,
    } = await import("../lib/rag/filename-match");

    const filename =
      "199 Richmond St W (25.0626.5) Final RFS Tables-2026.04.13.pdf";
    const query = `Where is ${filename}`;

    assert.equal(extractFileLikeNames(query)[0], filename);
    assert.equal(filenameMatchesQuery(filename, query), true);
    assert.equal(
      filenameMatchesQuery("TSCC 2517- NoFF 2026.04.13.pdf", query),
      false,
    );
    assert.ok(
      filenameSearchNeedles(query).some((needle) =>
        filename.toLowerCase().includes(needle.toLowerCase()),
      ),
    );
    assert.equal(
      filenameMatchesQuery(filename, "where is the elevator quote?"),
      false,
    );
  });

  it("does not hardcode RFS from reserve fund study", async () => {
    const { filenameSearchNeedles, filenameMatchesAlias } = await import(
      "../lib/rag/filename-match"
    );
    const query =
      "I need to find the file that has the reserve fund study. There was two of them done. One was by Trace and the other one was by EGIS.";
    assert.equal(
      filenameSearchNeedles(query).some((needle) => needle.toLowerCase() === "rfs"),
      false,
    );
    assert.equal(
      filenameMatchesAlias(
        "199 Richmond St W (25.0626.5) Final RFS Tables-2026.04.13.pdf",
        [],
      ),
      false,
    );
  });

  it("uses rewrite needles to match acronym filenames and covering emails", async () => {
    const {
      coveringEmailQueryOverlap,
      filenameMatchesAlias,
      filenameSearchNeedles,
      isFileSeekingQuery,
    } = await import("../lib/rag/filename-match");

    const query =
      "I need to find the file that has the reserve fund study. There was two of them done. One was by Trace and the other one was by EGIS.";
    const filename =
      "199 Richmond St W (25.0626.5) Final RFS Tables-2026.04.13.pdf";
    const extraNeedles = ["RFS", "Trace", "EGIS"];

    assert.equal(isFileSeekingQuery(query), true);
    assert.equal(filenameMatchesAlias(filename, extraNeedles), true);
    assert.equal(
      filenameMatchesAlias("Budget Approval Form (2026).pdf", extraNeedles),
      false,
    );
    assert.ok(
      filenameSearchNeedles(query, extraNeedles).some(
        (needle) => needle.toLowerCase() === "rfs",
      ),
    );
    assert.ok(
      coveringEmailQueryOverlap(
        query,
        "Budget questions",
        "It was great to hear from Trace and the Final RFS Tables are attached.",
        extraNeedles,
      ) >= 2,
    );
  });
});

describe("Corpus RAG - Hybrid filename quota", () => {
  function hit(
    id: string,
    filename: string,
    similarity: number,
    lexical?: "match" | "alias",
  ) {
    return {
      id,
      sourceKind: "attachment_markdown" as const,
      emailId: "email_1",
      contentHash: id,
      pageNo: null,
      chunkIndex: 0,
      chunkText: filename,
      similarity,
      excerpt: filename,
      metadata: {
        filename,
        filenameMatch: lexical === "match",
        filenameAlias: lexical === "alias",
      },
      sourceLink: `/api/email/attachments/${id}`,
      emailLink: "/knowledge/emails/email_1?scope=message",
      rawSimilarity: similarity,
      boost: 0,
      entities: [],
    };
  }

  it("keeps a low-scoring filename hit inside the top-N cut", async () => {
    const { selectHybridResults } = await import("../lib/rag/search");
    const results = [
      ...Array.from({ length: 20 }, (_, i) =>
        hit(`vec_${i}`, `Discussion report ${i}.pdf`, 0.99 - i * 0.001),
      ),
      hit("named_a", "Project Report A.pdf", 0.78, "alias"),
      hit("named_b", "Project Report B.pdf", 0.77, "alias"),
    ];
    const selected = selectHybridResults(results, 15);
    assert.equal(selected.length, 15);
    assert.ok(selected.some((row) => row.id === "named_a"));
    assert.ok(selected.some((row) => row.id === "named_b"));
    assert.equal(
      selected.some((row) => row.id === "vec_19"),
      false,
    );
  });

  it("spreads filename hits so a later match is not dropped", async () => {
    const { selectHybridResults, spreadTake } = await import("../lib/rag/search");
    const items = Array.from({ length: 21 }, (_, i) => `file_${i}`);
    const spread = spreadTake(items, 15);
    assert.equal(spread[0], "file_0");
    assert.equal(spread[spread.length - 1], "file_20");
    assert.equal(spread.length, 15);

    const results = [
      ...Array.from({ length: 20 }, (_, i) =>
        hit(`lex_${i}`, `Engineering Study Update ${i}.pdf`, 0.93, "match"),
      ),
      hit("named_tail", "Engineering Report.pdf", 0.77, "alias"),
    ];
    const selected = selectHybridResults(results, 15);
    assert.ok(selected.some((row) => row.id === "named_tail"));
    assert.equal(selected.length, 15);
  });

  it("keeps a low-scoring email subject hit inside the packed cut", async () => {
    const { selectHybridResults } = await import("../lib/rag/search");
    const results = [
      ...Array.from({ length: 20 }, (_, i) =>
        hit(`vec_${i}`, `Discussion report ${i}.pdf`, 0.99 - i * 0.001),
      ),
      {
        ...hit("email_haider", "unused.pdf", 0.4),
        id: "email_haider",
        sourceKind: "email_body" as const,
        metadata: {
          subject: "Haider Mukadam - Condominium Manager",
          subjectMatch: true,
        },
      },
    ];
    const selected = selectHybridResults(results, 15);
    assert.equal(selected.length, 15);
    assert.ok(selected.some((row) => row.id === "email_haider"));
  });
});

describe("Corpus RAG - Ask pipeline debug", () => {
  it("keeps retrieval order separate from packed citations", async () => {
    const { buildCorpusAskPipeline } = await import("../lib/rag/pipeline-debug");
    const hit = (id: string, filename: string, filenameAlias = false) => ({
      id,
      sourceKind: "attachment_markdown" as const,
      emailId: "e1",
      contentHash: id,
      pageNo: null,
      chunkIndex: 0,
      chunkText: filename,
      similarity: 0.8,
      excerpt: filename,
      metadata: { filename, filenameAlias },
      sourceLink: null,
      emailLink: null,
      rawSimilarity: 0.8,
      boost: 0,
      entities: [],
    });
    const retrieval = [
      hit("a", "Discussion.pdf"),
      hit("b", "Report.pdf", true),
    ];
    const pipeline = buildCorpusAskPipeline({
      query: "find the report",
      rewrite: {
        originalQuery: "find the report",
        retrievalQuery: "report attachment",
        lexicalNeedles: ["report"],
        fileSeeking: true,
      },
      retrieval,
      reranked: [retrieval[1], retrieval[0]],
      selectedIds: ["b", "a"],
      packedLimit: 1,
      citedChunkIds: ["b"],
    });
    assert.equal(pipeline.rewrite.retrievalQuery, "report attachment");
    assert.equal(pipeline.retrieval.hits[0].label, "Discussion.pdf");
    assert.equal(pipeline.retrieval.filenameHits, 1);
    assert.equal(pipeline.rerank?.hits[0].label, "Report.pdf");
    assert.equal(pipeline.packed?.hits.length, 1);
    assert.equal(pipeline.packed?.hits[0].chunkId, "b");
    assert.deepEqual(pipeline.citedChunkIds, ["b"]);
  });
});

describe("Corpus RAG - Email subject lexical match", () => {
  it("extracts proper names and expands Hyder to Haider from the registry", async () => {
    const {
      emailSubjectSearchNeedles,
      expandEmailNeedlesFromPersonNames,
      namesAreRetrievalVariants,
      properNameNeedles,
    } = await import("../lib/rag/email-match");
    const query =
      "There were email chains regarding Hyder's promotion and when he would take over Bonnie's role.";
    assert.deepEqual(properNameNeedles(query).sort(), ["Bonnie", "Hyder"].sort());
    const needles = emailSubjectSearchNeedles(query, ["promotion"]);
    assert.ok(needles.some((n) => n.toLowerCase() === "hyder"));
    assert.equal(
      needles.some((n) => n.toLowerCase() === "promotion"),
      false,
    );
    assert.equal(namesAreRetrievalVariants("Hyder", "Haider"), true);
    const expanded = expandEmailNeedlesFromPersonNames(needles, [
      { firstName: "Haider", lastName: "Mukadam" },
    ]);
    assert.ok(expanded.some((n) => n.toLowerCase() === "haider"));
    assert.ok(expanded.some((n) => /haider mukadam/i.test(n)));
  });
});

describe("Corpus RAG - Query rewrite", () => {
  it("parses an expanded retrieval query and lexical needles", async () => {
    const { parseQueryRewriteJson } = await import("../lib/rag/query-rewrite");
    const original =
      "I need to find the file that has the reserve fund study. One was by Trace and the other by EGIS.";
    const parsed = parseQueryRewriteJson(
      original,
      JSON.stringify({
        retrievalQuery:
          "reserve fund study RFS Trace EGIS attachment PDF",
        lexicalNeedles: ["RFS", "Trace", "EGIS", "the"],
        fileSeeking: true,
      }),
    );

    assert.equal(parsed.originalQuery, original);
    assert.match(parsed.retrievalQuery, /RFS/);
    assert.equal(parsed.fileSeeking, true);
    assert.ok(parsed.lexicalNeedles.some((needle) => needle.toLowerCase() === "rfs"));
    assert.ok(parsed.lexicalNeedles.some((needle) => needle.toLowerCase() === "trace"));
    assert.equal(
      parsed.lexicalNeedles.some((needle) => needle.toLowerCase() === "the"),
      false,
    );
  });

  it("asks rewrite to add person-name spelling variants", async () => {
    const { CORPUS_QUERY_REWRITE_SYSTEM_PROMPT } = await import(
      "../lib/rag/query-rewrite"
    );
    assert.match(CORPUS_QUERY_REWRITE_SYSTEM_PROMPT, /alternate spellings/);
    assert.match(CORPUS_QUERY_REWRITE_SYSTEM_PROMPT, /person names/);
  });

  it("lifts all-caps acronyms from retrievalQuery into needles", async () => {
    const { parseQueryRewriteJson, acronymNeedlesFromText } = await import(
      "../lib/rag/query-rewrite"
    );
    assert.deepEqual(acronymNeedlesFromText("annual general meeting AGM minutes"), [
      "AGM",
    ]);
    assert.deepEqual(acronymNeedlesFromText("property manager PM company"), [
      "PM",
    ]);
    const parsed = parseQueryRewriteJson(
      "where are the AGM minutes?",
      '{"retrievalQuery":"annual general meeting AGM minutes","lexicalNeedles":[],"fileSeeking":false}',
    );
    assert.ok(parsed.lexicalNeedles.includes("AGM"));
  });

  it("falls back to the original query on invalid JSON", async () => {
    const { parseQueryRewriteJson } = await import("../lib/rag/query-rewrite");
    const original = "elevator modernization contract";
    const parsed = parseQueryRewriteJson(original, "not json at all");
    assert.equal(parsed.retrievalQuery, original);
    assert.deepEqual(parsed.lexicalNeedles, []);
    assert.equal(parsed.fileSeeking, false);
  });
});

describe("Corpus RAG - Embedding cost helpers", () => {
  it("estimates embedding tokens from text length", async () => {
    const {
      estimateEmbeddingTokensFromText,
      estimateEmbeddingCostUsd,
      EMBEDDING_CHARS_PER_TOKEN,
    } = await import("../lib/rag/cost");

    assert.equal(
      estimateEmbeddingTokensFromText("a".repeat(EMBEDDING_CHARS_PER_TOKEN)),
      1,
    );
    assert.equal(
      estimateEmbeddingTokensFromText("a".repeat(EMBEDDING_CHARS_PER_TOKEN + 1)),
      2,
    );
    assert.equal(estimateEmbeddingCostUsd(1_000_000), 0.15);
  });
});

describe("Corpus RAG - Index stint timing", () => {
  it("derives rate and ETA from the current stint only", async () => {
    const {
      corpusRemainingForMode,
      estimateCorpusIndexRate,
      formatCorpusIndexEta,
      formatCorpusIndexRate,
    } = await import("../lib/rag/index-timing");

    const status = {
      totalEmails: 100,
      indexedEmails: 40,
      totalParsedAttachments: 50,
      indexedAttachments: 10,
      totalDoneVisionPages: 20,
      indexedVisionPages: 5,
      totalChunks: 0,
      lastIndexedAt: null,
    };

    assert.equal(corpusRemainingForMode(status, "all"), 115);
    assert.equal(corpusRemainingForMode(status, "emails"), 60);

    const rate = estimateCorpusIndexRate({
      stintMs: 60_000,
      stintDocs: 12,
      remainingInMode: 60,
      remainingCorpus: 115,
    });

    assert.equal(rate.docsPerMinute, 12);
    assert.equal(rate.secondsPerDoc, 5);
    assert.equal(rate.modeEtaMs, 300_000);
    assert.equal(rate.corpusEtaMs, 575_000);
    assert.equal(formatCorpusIndexRate(rate.docsPerMinute), "12.0 docs/min");
    assert.equal(formatCorpusIndexEta(rate.corpusEtaMs), "~9m 35s");
  });

  it("shows a dash until the stint has a sample", async () => {
    const { estimateCorpusIndexRate, formatCorpusIndexEta } = await import(
      "../lib/rag/index-timing"
    );

    const rate = estimateCorpusIndexRate({
      stintMs: 500,
      stintDocs: 0,
      remainingInMode: 100,
      remainingCorpus: 100,
    });

    assert.equal(rate.modeEtaMs, null);
    assert.equal(formatCorpusIndexEta(null), "—");
  });

  it("pairs doc ETA with a smoothed embed burn rate", async () => {
    const { estimateCorpusEmbedCostRate, estimateCorpusIndexRate } =
      await import("../lib/rag/index-timing");

    const docRate = estimateCorpusIndexRate({
      stintMs: 60_000,
      stintDocs: 12,
      remainingInMode: 60,
      remainingCorpus: 115,
    });

    const costRate = estimateCorpusEmbedCostRate({
      stintMs: 60_000,
      stintCostUsd: 0.06,
      docRate,
      liveRolling: {
        windowMs: 60_000,
        sampleCount: 4,
        apiSampleCount: 4,
        inputTokens: 400_000,
        charCount: 800_000,
        costUsd: 0.06,
        tokensPerMinute: 400_000,
        costPerMinute: 0.06,
        charsPerToken: 2,
        tokenSource: "api",
      },
    });

    assert.equal(costRate.costPerMinute, 0.06);
    assert.equal(costRate.modeCostEtaUsd, 0.3);
    assert.ok(
      costRate.corpusCostEtaUsd != null && costRate.corpusCostEtaUsd > 0.05,
    );
  });
});

describe("Corpus RAG - Live embed cost rolling window", () => {
  it("tracks billed tokens per API call over a 60s window", async () => {
    const {
      EMBED_COST_ROLLING_WINDOW_MS,
      getEmbedCostRollingSnapshot,
      recordEmbedApiUsage,
      resetEmbedCostLiveSamples,
    } = await import("../lib/rag/embed-cost-live");
    const { buildEmbeddingUsage } = await import("../lib/rag/cost");

    resetEmbedCostLiveSamples();

    const now = Date.now();
    recordEmbedApiUsage(
      ["a".repeat(800), "b".repeat(400)],
      buildEmbeddingUsage(300, "api"),
      now - 30_000,
    );
    recordEmbedApiUsage(
      ["c".repeat(1200)],
      buildEmbeddingUsage(500, "api"),
      now - 5_000,
    );

    const snap = getEmbedCostRollingSnapshot(now);
    assert.equal(snap.sampleCount, 2);
    assert.equal(snap.apiSampleCount, 2);
    assert.equal(snap.inputTokens, 800);
    assert.ok(Math.abs(snap.costUsd - 0.00012) < 1e-9);
    assert.ok(snap.charsPerToken != null && snap.charsPerToken > 1.5);
    assert.equal(snap.tokenSource, "api");
    assert.equal(snap.windowMs, EMBED_COST_ROLLING_WINDOW_MS);

    recordEmbedApiUsage(
      ["stale"],
      buildEmbeddingUsage(100, "api"),
      now - EMBED_COST_ROLLING_WINDOW_MS - 1,
    );
    const pruned = getEmbedCostRollingSnapshot(now);
    assert.equal(pruned.sampleCount, 2);

    resetEmbedCostLiveSamples();
  });
});

describe("Corpus RAG - Cosine Similarity & Excerpt Extraction", () => {
  it("computes cosine similarity accurately", () => {
    // Identical
    assert.equal(Math.round(cosineSimilarity([1, 0, 0], [1, 0, 0])), 1);
    // Orthogonal
    assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
    // Opposite
    assert.equal(Math.round(cosineSimilarity([1, 0, 0], [-1, 0, 0])), -1);
    // Empty
    assert.equal(cosineSimilarity([], []), 0);
  });

  it("extracts excerpt surrounding query terms cleanly", () => {
    const text =
      "In accordance with Section 94 of the Condominium Act, the Corporation commissioned an updated " +
      "reserve fund study from Morrison Hershfield Ltd to evaluate the expected 30-year lifecycle of common elements.";

    const excerpt = extractExcerpt(text, "reserve fund study", 120);
    assert.ok(excerpt.toLowerCase().includes("reserve fund study"));
  });
});

describe("Corpus RAG - Registry boost (Phase B)", () => {
  const catalog: RegistryCatalogEntry[] = [
    {
      kind: "project",
      id: "proj_elev",
      name: "Elevator Modernization 2024",
      surfaces: ["Elevator Modernization 2024", "RFP-ELEV-2024"],
    },
    {
      kind: "equipment",
      id: "ELEV-HIGH-01",
      name: "High-rise elevator 01",
      surfaces: ["High-rise elevator 01", "ELEV-HIGH-01"],
    },
    {
      kind: "organization",
      id: "org_tcg",
      name: "TCG",
      surfaces: ["TCG", "tcgproperty.ca"],
    },
    {
      kind: "organization",
      id: "org_del",
      name: "Del Property Management",
      surfaces: ["Del Property Management"],
    },
    {
      kind: "organization",
      id: "org_icc",
      name: "ICC Property Management Ltd.",
      surfaces: ["ICC Property Management Ltd."],
    },
    {
      kind: "organization",
      id: "org_duka",
      name: "DUKA Management",
      surfaces: ["DUKA Management"],
    },
    {
      kind: "project",
      id: "proj_energy",
      name: "Energy Management System",
      surfaces: ["Energy Management System"],
    },
  ];

  it("phrase-matches a project name inside a longer query", () => {
    const matches = matchRegistryCatalog(
      "what elevator modernization ran this year",
      catalog,
    );
    const project = matches.find((item) => item.id === "proj_elev");
    assert.ok(project);
    assert.equal(project?.strength, "phrase");
  });

  it("does not match every elevator asset from the generic word elevator", () => {
    const hit = scoreRegistryEntry("elevator", catalog[1]!);
    assert.equal(hit, null);
  });

  it("matches a short distinctive org alias as a token", () => {
    const matches = matchRegistryCatalog("what did TCG invoice?", catalog);
    assert.equal(matches.some((item) => item.id === "org_tcg"), true);
  });

  it("boosts linked hits above unlinked hits with the same raw similarity", () => {
    const matched = matchRegistryCatalog("elevator modernization", catalog);
    const boosted = applyRegistryBoost({
      results: [
        {
          emailId: "email_unlinked",
          similarity: 0.7,
        },
        {
          emailId: "email_linked",
          similarity: 0.7,
        },
      ],
      matchedEntities: matched,
      linksByEmail: new Map([
        [
          "email_linked",
          [{ kind: "project", id: "proj_elev", name: "Elevator Modernization 2024" }],
        ],
      ]),
      limit: 10,
    });

    assert.equal(boosted[0]?.emailId, "email_linked");
    assert.equal(boosted[0]?.boost, REGISTRY_BOOST_PHRASE);
    assert.equal(boosted[0]?.similarity, Number((0.7 + REGISTRY_BOOST_PHRASE).toFixed(4)));
    assert.equal(boosted[0]?.entities[0]?.boosted, true);
    assert.equal(boosted[1]?.boost, 0);
    assert.equal(boosted[1]?.similarity, 0.7);
  });

  it("does not match unrelated management firms from the word management", () => {
    const matches = matchRegistryCatalog(
      "ICC Property Management elevator quote",
      catalog,
    );
    assert.equal(matches.some((item) => item.id === "org_icc"), true);
    assert.equal(matches.some((item) => item.id === "org_duka"), false);
    assert.equal(matches.some((item) => item.id === "proj_energy"), false);
  });

  it("does not boost an email that lacks the matched entity link", () => {
    const matched = matchRegistryCatalog("Del Property Management", catalog);
    const boosted = applyRegistryBoost({
      results: [
        {
          emailId: "email_other_org",
          similarity: 0.65,
        },
      ],
      matchedEntities: matched,
      linksByEmail: new Map([
        [
          "email_other_org",
          [{ kind: "organization", id: "org_tcg", name: "TCG" }],
        ],
      ]),
      limit: 5,
    });

    assert.equal(boosted[0]?.boost, 0);
    assert.equal(boosted[0]?.entities[0]?.boosted, false);
    assert.ok(REGISTRY_BOOST_TOKEN > 0);
  });
});

describe("Corpus RAG - Grounded answers (Phase C)", () => {
  const sampleResult = {
    id: "chunk_rfs",
    sourceKind: "attachment_markdown" as const,
    emailId: "email_1",
    contentHash: "hash",
    pageNo: 12,
    chunkIndex: 3,
    chunkText: `${"The Trace Consulting Group reserve fund study lists equipment replacements through 2045. ".repeat(80)}`,
    similarity: 0.81,
    excerpt: "The Trace Consulting Group reserve fund study lists equipment replacements.",
    metadata: { filename: "TSCC 2517-RFS.pdf", subject: "RFS delivery" },
    sourceLink: "/api/email/attachments/att_1",
    emailLink: "/knowledge/emails/email_1?scope=message",
    rawSimilarity: 0.81,
    boost: 0,
    entities: [],
  };

  it("packs only the top chunks and truncates long text", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...sampleResult,
      id: `chunk_${i}`,
    }));
    const packed = packAnswerSources(many);
    assert.equal(packed.length, MAX_ANSWER_CONTEXT_CHUNKS);
    assert.ok(packed[0].text.endsWith("…"));
    assert.ok(packed[0].text.startsWith("File: TSCC 2517-RFS.pdf"));
    assert.ok(packed[0].text.length <= MAX_ANSWER_CHUNK_CHARS + 1);
    assert.equal(packed[0].label, "TSCC 2517-RFS.pdf");
  });

  it("prefixes email subject and from onto packed email bodies", () => {
    const packed = packAnswerSources([
      {
        ...sampleResult,
        id: "email_haider",
        sourceKind: "email_body",
        chunkText: "Haider will oversee operations while Bonnie remains on the file.",
        metadata: {
          subject: "Haider Mukadam - Condominium Manager",
          fromAddress: "board@condo.ca",
        },
      },
    ]);
    assert.match(packed[0].text, /^Email: Haider Mukadam - Condominium Manager/);
    assert.match(packed[0].text, /From: board@condo\.ca/);
    assert.match(packed[0].text, /oversee operations/);
    assert.equal(packed[0].label, "Haider Mukadam - Condominium Manager");
  });

  it("includes query, registry hints, and numbered sources in the user prompt", () => {
    const prompt = buildCorpusAnswerUserText({
      query: "Where is the Trace reserve fund study?",
      sources: packAnswerSources([sampleResult]),
      matchedEntities: [
        {
          kind: "organization",
          id: "org_tcg",
          name: "Trace Consulting Group",
          surface: "Trace Consulting Group",
          strength: "phrase",
        },
      ],
    });

    assert.match(prompt, /Where is the Trace reserve fund study\?/);
    assert.match(prompt, /FILE INDEX/);
    assert.match(prompt, /\[S1\] TSCC 2517-RFS.pdf/);
    assert.match(prompt, /organization: Trace Consulting Group/);
    assert.equal(/chunkId:/.test(prompt), false);
    assert.match(prompt, /\[S1\]/);
  });

  it("lists filenames in the file index without document-type tags", () => {
    const prompt = buildCorpusAnswerUserText({
      query: "find the file that has the agreement",
      sources: packAnswerSources([
        {
          ...sampleResult,
          id: "chunk_agreement",
          chunkText: "Signature page.",
          metadata: { filename: "Agreement Signed.pdf" },
        },
      ]),
      matchedEntities: [],
    });
    assert.match(prompt, /\[S1\] Agreement Signed\.pdf/);
    assert.equal(/\(signed\)/.test(prompt), false);
    assert.equal(/role: signed/.test(prompt), false);
  });

  it("does not instruct the model to prefer signed or final files", async () => {
    const { CORPUS_ANSWER_SYSTEM_PROMPT } = await import("../lib/rag/answer");
    const { CORPUS_RERANK_SYSTEM_PROMPT } = await import("../lib/rag/rerank");
    assert.match(CORPUS_ANSWER_SYSTEM_PROMPT, /Do not prefer a document type/);
    assert.match(CORPUS_ANSWER_SYSTEM_PROMPT, /review must include every source number/);
    assert.match(CORPUS_ANSWER_SYSTEM_PROMPT, /Related, not a name match/);
    assert.match(CORPUS_ANSWER_SYSTEM_PROMPT, /Do not emit chunk ids/);
    assert.match(CORPUS_ANSWER_SYSTEM_PROMPT, /notInArchive to true only when no numbered source is on-topic/);
    assert.match(CORPUS_ANSWER_SYSTEM_PROMPT, /Do not claim the archive has no emails/);
    assert.match(CORPUS_RERANK_SYSTEM_PROMPT, /Do not prefer a document type/);
    assert.match(CORPUS_RERANK_SYSTEM_PROMPT, /near miss/);
    assert.equal(
      /Prefer the actual deliverable/i.test(CORPUS_RERANK_SYSTEM_PROMPT),
      false,
    );
  });

  it("maps review source numbers to packed chunk ids", () => {
    const sources = packAnswerSources([
      { ...sampleResult, id: "chunk_rfs" },
      { ...sampleResult, id: "chunk_other", metadata: { filename: "Other.pdf" } },
    ]);
    const parsed = parseGroundedAnswerJson(
      JSON.stringify({
        answer: "The RFS is TSCC 2517-RFS.pdf [S1].",
        review: [
          { source: 1, relevant: true, why: "names the study" },
          { source: 2, relevant: false, why: "unrelated" },
          { source: 99, relevant: true, why: "hallucinated index" },
        ],
        confidence: "high",
        notInArchive: false,
      }),
      sources,
    );

    assert.equal(parsed.reviews.length, 2);
    assert.equal(parsed.reviews[0]?.chunkId, "chunk_rfs");
    assert.equal(parsed.reviews[0]?.match, "direct");
    assert.equal(parsed.reviews[1]?.match, "no");
    assert.equal(parsed.answer, "The RFS is TSCC 2517-RFS.pdf [S1].");
    assert.equal(parsed.confidence, "high");
  });

  it("keeps party-mismatched studies as near misses instead of dropping them", () => {
    const sources = packAnswerSources(
      [
        {
          ...sampleResult,
          id: "chunk_trace",
          contentHash: "hash_trace",
          metadata: { filename: "Trace RFS tables.pdf" },
        },
        {
          ...sampleResult,
          id: "chunk_mp",
          contentHash: "hash_mp",
          metadata: { filename: "RFS Signed.pdf" },
        },
        {
          ...sampleResult,
          id: "chunk_sample",
          contentHash: "hash_sample",
          metadata: { filename: "Highrise Sample.pdf" },
        },
      ],
      5,
      new Map([
        [
          "hash_trace",
          {
            documentType: "tables",
            summary: "Trace RFS tables.",
            parties: ["Trace Consulting Group"],
            status: "ready" as const,
          },
        ],
        [
          "hash_mp",
          {
            documentType: "signed_report",
            summary: "McIntosh Perry Class 2 RFS.",
            parties: ["McIntosh Perry"],
            status: "ready" as const,
          },
        ],
        [
          "hash_sample",
          {
            documentType: "sample",
            summary: "Sample RFS report.",
            parties: ["McIntosh Perry"],
            status: "ready" as const,
          },
        ],
      ]),
    );
    const parsed = parseGroundedAnswerJson(
      JSON.stringify({
        answer:
          "Trace tables [S1]. Related, not a name match: RFS Signed.pdf [S2].",
        review: [
          { source: 1, match: "direct", why: "Trace study" },
          {
            source: 2,
            match: "near",
            why: "Class 2 RFS by McIntosh Perry, not Egis",
          },
          { source: 3, match: "near", why: "sample report" },
        ],
        confidence: "medium",
        notInArchive: false,
      }),
      sources,
    );
    const merged = mergeAnswerCitations({
      sources,
      citations: [],
      reviews: parsed.reviews,
      fileSeeking: true,
    });
    const near = selectNearMisses(parsed.reviews, sources, 1);

    assert.deepEqual(
      merged.map((row) => row.chunkId),
      ["chunk_trace"],
    );
    assert.equal(near.length, 1);
    assert.equal(near[0]?.chunkId, "chunk_mp");
  });

  it("salvages prose from truncated answer JSON", () => {
    const sources = packAnswerSources([{ ...sampleResult, id: "chunk_rfs" }]);
    const truncated = `{
  "answer": "Trace prepared the study [S1].",
  "review": [{ "source": 1, "relevant": true, "why": "Trace RFS" }],
  "confidence": "high",
  "citations": [{ "chunkId": "att_md:incomplete`;
    const salvaged = salvageGroundedAnswerFromText(truncated, sources);
    assert.ok(salvaged);
    assert.equal(salvaged!.answer, "Trace prepared the study [S1].");
    assert.equal(salvaged!.reviews.length, 1);
    assert.equal(salvaged!.reviews[0]?.chunkId, "chunk_rfs");
  });

  it("cites packed filename hits on file-seeking questions even if the model skipped them", () => {
    const sources = packAnswerSources([
      {
        ...sampleResult,
        id: "chunk_discussed",
        metadata: { filename: "Discussion.pdf" },
      },
      {
        ...sampleResult,
        id: "chunk_named",
        metadata: {
          filename: "Report.pdf",
          filenameAlias: true,
        },
        chunkText: "Signature page.",
      },
    ]);
    const merged = mergeAnswerCitations({
      sources,
      citations: [{ chunkId: "chunk_discussed", why: "discusses the report" }],
      reviews: [],
      fileSeeking: true,
    });
    assert.deepEqual(
      merged.map((row) => row.chunkId),
      ["chunk_discussed", "chunk_named"],
    );
    assert.equal(
      mergeAnswerCitations({
        sources,
        citations: [{ chunkId: "chunk_discussed", why: "discusses the report" }],
        reviews: [],
        fileSeeking: false,
      }).map((row) => row.chunkId).join(","),
      "chunk_discussed",
    );
  });

  it("strips fenced JSON and treats empty retrieval as not-in-archive", () => {
    const fenced = stripJsonFence(
      "```json\n{\"answer\":\"ok\",\"citations\":[],\"confidence\":\"low\",\"notInArchive\":true}\n```",
    );
    const parsed = parseGroundedAnswerJson(fenced, []);
    assert.equal(parsed.notInArchive, true);
    assert.equal(parsed.answer, "ok");

    const empty = emptyCorpusAnswer("gemini-3.7-flash");
    assert.equal(empty.notInArchive, true);
    assert.equal(empty.nearMisses.length, 0);
    assert.equal(empty.usage.costUsd, 0);
    assert.match(empty.answer, /No matching excerpts/);
  });
});

describe("Corpus RAG - Hit rerank", () => {
  function hit(
    id: string,
    filename: string,
    excerpt: string,
    similarity: number,
  ) {
    return {
      id,
      sourceKind: "attachment_markdown" as const,
      emailId: "email_1",
      contentHash: id,
      pageNo: null,
      chunkIndex: 0,
      chunkText: excerpt,
      similarity,
      excerpt,
      metadata: { filename },
      sourceLink: `/api/email/attachments/${id}`,
      emailLink: "/knowledge/emails/email_1?scope=message",
      rawSimilarity: similarity,
      boost: 0,
      entities: [],
    };
  }

  it("promotes selected lower-ranked hits without dropping the rest", async () => {
    const { applyRerankOrder, parseRerankJson } = await import(
      "../lib/rag/rerank"
    );
    const results = [
      hit("proposal", "TCG fee proposal.pdf", "Fee proposal for a Class 1 study", 0.95),
      hit("draft", "EGIS C2 RFS-Letter-2025-DRAFT.pdf", "Draft letter for Class 2", 0.94),
      hit("update", "Class 2 Reserve Fund Study Update.pdf", "Class 2 update November 2025", 0.93),
      hit("trace", "Final RFS Tables-2026.04.13.pdf", "Replacement cost summary tables", 0.9),
      hit("egis", "RFS Signed.pdf", "Signed reserve fund study", 0.88),
    ];
    const selected = parseRerankJson(
      JSON.stringify({
        chunkIds: ["trace", "egis", "missing", "proposal"],
      }),
      results.map((row) => row.id),
    );
    assert.deepEqual(selected, ["trace", "egis", "proposal"]);
    const ordered = applyRerankOrder(results, selected);
    assert.deepEqual(
      ordered.map((row) => row.id),
      ["trace", "egis", "proposal", "draft", "update"],
    );
    const packed = packAnswerSources(ordered, 3);
    assert.deepEqual(
      packed.map((row) => row.label),
      [
        "Final RFS Tables-2026.04.13.pdf",
        "RFS Signed.pdf",
        "TCG fee proposal.pdf",
      ],
    );
  });

  it("falls back to retrieval order when rerank JSON is invalid", async () => {
    const { applyRerankOrder, parseRerankJson } = await import(
      "../lib/rag/rerank"
    );
    const results = [
      hit("a", "A.pdf", "a", 0.9),
      hit("b", "B.pdf", "b", 0.8),
    ];
    const selected = parseRerankJson("not json", ["a", "b"]);
    assert.deepEqual(selected, []);
    assert.deepEqual(
      applyRerankOrder(results, selected).map((row) => row.id),
      ["a", "b"],
    );
  });

  it("collapses duplicate files and parses JSON wrapped in extra text", async () => {
    const { uniqueResultsByFile, parseRerankJson } = await import(
      "../lib/rag/rerank"
    );
    const duplicates = [
      hit("trace-p1", "Final RFS Tables-2026.04.13.pdf", "table page 1", 0.9),
      hit("trace-p2", "Final RFS Tables-2026.04.13.pdf", "table page 2", 0.89),
    ];
    duplicates[0].contentHash = "hash_tables";
    duplicates[1].contentHash = "hash_tables";
    const unique = uniqueResultsByFile(duplicates);
    assert.equal(unique.length, 1);
    assert.equal(unique[0].id, "trace-p1");

    const wrapped = parseRerankJson(
      'Thinking...\n{"chunkIds":["trace","egis"]}\nDone.',
      ["proposal", "trace", "egis"],
    );
    assert.deepEqual(wrapped, ["trace", "egis"]);
  });

  it("lists every candidate id in the rerank prompt", async () => {
    const { buildRerankUserText } = await import("../lib/rag/rerank");
    const prompt = buildRerankUserText({
      query: "find the reserve fund study files by Trace and EGIS",
      results: [
        hit("proposal", "TCG fee proposal.pdf", "Fee proposal", 0.95),
        hit("trace", "Final RFS Tables-2026.04.13.pdf", "Tables", 0.9),
      ],
      limit: 8,
    });
    assert.match(prompt, /LIMIT\n8/);
    assert.match(prompt, /chunkId: proposal/);
    assert.match(prompt, /chunkId: trace/);
    assert.match(prompt, /rank: 2/);
  });
});

// Integration checks with Database & Gemini (if configured)
describe("Corpus RAG - Database & API Integration", () => {
  after(async () => {
    const { closePool } = await import("../lib/db");
    await closePool();
  });

  it("loads corpus index status from PostgreSQL", async () => {
    // Check if env has DB credentials
    if (!fs.existsSync(".env.local")) return;
    const { getCorpusIndexStatus } = await import("../lib/rag/indexer");
    const status = await getCorpusIndexStatus();

    assert.ok(typeof status.totalEmails === "number");
    assert.ok(typeof status.totalChunks === "number");
    assert.ok(status.totalEmails >= 0);
    assert.ok(status.totalChunks >= 0);
  });

  it("runs an incremental index slice of 5 items", async () => {
    if (!fs.existsSync(".env.local") || !process.env.GEMINI_API_KEY) return;
    const { runIncrementalIndexSlice } = await import("../lib/rag/indexer");
    const sliceResult = await runIncrementalIndexSlice({ batchSize: 5 });

    assert.ok(sliceResult.chunksCreated >= 0);
    assert.ok(typeof sliceResult.costUsd === "number");
    assert.ok(typeof sliceResult.inputTokens === "number");
    assert.equal(sliceResult.errors.length, 0, `Expected 0 errors, got: ${sliceResult.errors.join("; ")}`);
  });

  it("performs semantic corpus search for 'reserve fund study'", async () => {
    if (!fs.existsSync(".env.local") || !process.env.GEMINI_API_KEY) return;
    const { searchCorpus } = await import("../lib/rag/search");
    const { results, usage } = await searchCorpus({ query: "reserve fund study", limit: 5 });

    assert.ok(Array.isArray(results));
    assert.ok(typeof usage.costUsd === "number");
    console.log(`\n  [searchCorpus] Found ${results.length} matches for 'reserve fund study' (${usage.inputTokens} tokens, ${usage.costUsd} USD):`);
    for (const res of results) {
      assert.ok(res.id);
      assert.ok(res.chunkText);
      assert.ok(typeof res.similarity === "number");
      assert.ok(res.excerpt);
      assert.ok(Array.isArray(res.entities));
      console.log(`    • [${Math.round(res.similarity * 100)}%] (${res.sourceKind}) ${res.metadata.subject || res.metadata.filename}: ${res.excerpt.slice(0, 75)}...`);
    }
  });

  it("generates a grounded answer for 'where is the reserve fund study?'", async () => {
    if (!fs.existsSync(".env.local") || !process.env.GEMINI_API_KEY) return;
    const { answerCorpusQuestion } = await import("../lib/rag/answer");
    const { results, answer, searchUsage } = await answerCorpusQuestion({
      query: "Where is the reserve fund study?",
      limit: 5,
    });

    assert.ok(Array.isArray(results));
    assert.ok(typeof searchUsage.costUsd === "number");
    assert.ok(answer.answer.length > 0);
    assert.ok(["high", "medium", "low", "none"].includes(answer.confidence));
    for (const citation of answer.citations) {
      assert.ok(
        results.some((result) => result.id === citation.chunkId),
        `citation ${citation.chunkId} was not in retrieved results`,
      );
    }
    console.log(
      `\n  [answerCorpusQuestion] ${answer.confidence} · ${answer.citations.length} citations · ${answer.usage.costUsd} USD\n  ${answer.answer.slice(0, 240)}`,
    );
  });
});
