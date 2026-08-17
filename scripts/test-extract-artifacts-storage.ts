/**
 * Unit checks for extract-artifact Storage keys and disk+Storage I/O.
 * Run: npx tsx --test scripts/test-extract-artifacts-storage.ts
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  extractArtifactObjectKey,
  isExtractArtifactObjectKey,
  readExtractArtifactText,
  writeExtractArtifactText,
} from "../lib/storage/extract-artifacts";

const HASH = "a".repeat(64);

const originalFetch = globalThis.fetch;
const originalEnv = {
  ref: process.env.SUPABASE_PROJECT_REF,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  bucket: process.env.SUPABASE_STORAGE_BUCKET,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEnv.ref === undefined) delete process.env.SUPABASE_PROJECT_REF;
  else process.env.SUPABASE_PROJECT_REF = originalEnv.ref;
  if (originalEnv.key === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.key;
  }
  if (originalEnv.bucket === undefined) {
    delete process.env.SUPABASE_STORAGE_BUCKET;
  } else {
    process.env.SUPABASE_STORAGE_BUCKET = originalEnv.bucket;
  }
});

describe("extractArtifactObjectKey", () => {
  it("maps assembled, Docling, and vision paths to Storage keys", () => {
    assert.equal(extractArtifactObjectKey(`${HASH}.md`), `${HASH}.md`);
    assert.equal(
      extractArtifactObjectKey(`data/email-attachments/${HASH}.md`),
      `${HASH}.md`,
    );
    assert.equal(
      extractArtifactObjectKey(`data/email-attachments/${HASH}.docling.md`),
      `${HASH}.docling.md`,
    );
    assert.equal(
      extractArtifactObjectKey(
        `data/email-attachments/${HASH}/docling/p007.md`,
      ),
      `${HASH}/docling/p007.md`,
    );
    assert.equal(
      extractArtifactObjectKey(
        path.join(process.cwd(), "data", "email-attachments", HASH, "vision", "p012.md"),
      ),
      `${HASH}/vision/p012.md`,
    );
  });

  it("rejects original PDFs and other binaries", () => {
    assert.equal(
      extractArtifactObjectKey(`data/email-attachments/${HASH}.pdf`),
      null,
    );
    assert.equal(isExtractArtifactObjectKey(`${HASH}.pdf`), false);
    assert.equal(isExtractArtifactObjectKey(`${HASH}.md`), true);
  });
});

describe("readExtractArtifactText", () => {
  it("hydrates a disk miss from Storage and writes the local cache", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "extract-art-"));
    const absolute = path.join(root, "data", "email-attachments", `${HASH}.md`);
    process.env.SUPABASE_PROJECT_REF = "testref";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    process.env.SUPABASE_STORAGE_BUCKET = "extract-artifacts";

    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("# from storage\n", {
        status: 200,
        headers: { "Content-Type": "text/markdown" },
      });
    }) as typeof fetch;

    try {
      const body = await readExtractArtifactText(absolute);
      assert.equal(body, "# from storage\n");
      assert.equal(await readFile(absolute, "utf8"), "# from storage\n");
      assert.equal(calls.length, 1);
      assert.match(calls[0]!, /\/storage\/v1\/object\/extract-artifacts\//);
      assert.match(calls[0]!, new RegExp(`${HASH}\\.md`));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns disk content without calling Storage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "extract-art-"));
    const absolute = path.join(root, "data", "email-attachments", `${HASH}.md`);
    process.env.SUPABASE_PROJECT_REF = "testref";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, "# local\n", "utf8");

    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response("nope", { status: 500 });
    }) as typeof fetch;

    try {
      // Clear service role so a cache hit still must not fetch even if
      // a later miss would. Re-set after confirming disk-only read.
      const body = await readExtractArtifactText(absolute);
      assert.equal(body, "# local\n");
      assert.equal(fetches, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("writeExtractArtifactText", () => {
  it("writes disk and upserts Storage when configured", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "extract-art-"));
    const absolute = path.join(
      root,
      "data",
      "email-attachments",
      HASH,
      "vision",
      "p003.md",
    );
    process.env.SUPABASE_PROJECT_REF = "testref";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    process.env.SUPABASE_STORAGE_BUCKET = "extract-artifacts";

    const uploads: Array<{ url: string; method: string; upsert: string | null }> =
      [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      uploads.push({
        url: String(input),
        method: init?.method ?? "GET",
        upsert:
          init?.headers instanceof Headers
            ? init.headers.get("x-upsert")
            : (init?.headers as Record<string, string> | undefined)?.[
                "x-upsert"
              ] ?? null,
      });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      await writeExtractArtifactText(absolute, "vision page\n");
      assert.equal(await readFile(absolute, "utf8"), "vision page\n");
      assert.equal(uploads.length, 1);
      assert.equal(uploads[0]!.method, "POST");
      assert.equal(uploads[0]!.upsert, "true");
      assert.match(uploads[0]!.url, new RegExp(`${HASH}/vision/p003\\.md`));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("still writes disk when Storage is not configured", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "extract-art-"));
    const absolute = path.join(root, "data", "email-attachments", `${HASH}.md`);
    delete process.env.SUPABASE_PROJECT_REF;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response("nope", { status: 500 });
    }) as typeof fetch;

    try {
      await writeExtractArtifactText(absolute, "# disk only\n");
      assert.equal(await readFile(absolute, "utf8"), "# disk only\n");
      assert.equal(fetches, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
