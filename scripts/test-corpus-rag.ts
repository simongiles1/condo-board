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
    assert.equal(res.chunks[0].chunkText, markdown);
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
      console.log(`    • [${Math.round(res.similarity * 100)}%] (${res.sourceKind}) ${res.metadata.subject || res.metadata.filename}: ${res.excerpt.slice(0, 75)}...`);
    }
  });
});
