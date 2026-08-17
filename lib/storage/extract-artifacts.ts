/**
 * Disk cache + Supabase Storage for paid extract markdown.
 *
 * Original PDFs/video stay on disk (Gmail backfill). Assembled `.md`,
 * Docling, and vision artifacts hydrate from the private
 * `extract-artifacts` bucket on a cache miss, and new writes go to
 * disk and Storage so Coolify and local share one corpus.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const HASH = /^[a-f0-9]{64}$/i;
const DEFAULT_BUCKET = "extract-artifacts";
const ASSEMBLED_RE = /(?:^|\/)([a-f0-9]{64}\.md)$/i;
const DOCLING_ASSEMBLED_RE = /(?:^|\/)([a-f0-9]{64}\.docling\.md)$/i;
const PAGE_RE = /(?:^|\/)([a-f0-9]{64})\/(docling|vision)\/(p\d+\.md)$/i;

type StorageConfig = {
  projectRef: string;
  serviceRoleKey: string;
  bucket: string;
};

function posixPath(storedPath: string): string {
  return storedPath.trim().replaceAll("\\", "/");
}

export function isExtractArtifactObjectKey(key: string): boolean {
  const parts = posixPath(key).split("/").filter(Boolean);
  if (parts.length === 1) {
    return (
      HASH.test(parts[0]!.replace(/\.docling\.md$/i, "").replace(/\.md$/i, "")) &&
      (/^[a-f0-9]{64}\.md$/i.test(parts[0]!) ||
        /^[a-f0-9]{64}\.docling\.md$/i.test(parts[0]!))
    );
  }
  if (parts.length === 3 && HASH.test(parts[0]!)) {
    const folder = parts[1]!.toLowerCase();
    if (folder !== "docling" && folder !== "vision") return false;
    return /^p\d+\.md$/i.test(parts[2]!);
  }
  return false;
}

/**
 * Storage object key matching the upload script (relative to
 * data/email-attachments/). Returns null for originals (PDF/video).
 */
export function extractArtifactObjectKey(
  storedOrAbsolute: string,
): string | null {
  const posix = posixPath(storedOrAbsolute);
  if (!posix) return null;

  const cwd = process.cwd().replaceAll("\\", "/");
  let rel = posix;
  if (rel.toLowerCase().startsWith(`${cwd.toLowerCase()}/`)) {
    rel = rel.slice(cwd.length + 1);
  }

  const doclingAssembled = rel.match(DOCLING_ASSEMBLED_RE);
  if (doclingAssembled) {
    return doclingAssembled[1]!.toLowerCase();
  }
  const page = rel.match(PAGE_RE);
  if (page) {
    return `${page[1]!.toLowerCase()}/${page[2]!.toLowerCase()}/${page[3]!.toLowerCase()}`;
  }
  const assembled = rel.match(ASSEMBLED_RE);
  if (assembled) {
    return assembled[1]!.toLowerCase();
  }
  if (isExtractArtifactObjectKey(rel)) return rel.toLowerCase();
  return null;
}

function storageConfig(): StorageConfig | null {
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!projectRef || !serviceRoleKey) return null;
  const bucket =
    process.env.SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_BUCKET;
  return { projectRef, serviceRoleKey, bucket };
}

function objectUrl(config: StorageConfig, objectKey: string): string {
  const encoded = objectKey.split("/").map(encodeURIComponent).join("/");
  return `https://${config.projectRef}.supabase.co/storage/v1/object/${config.bucket}/${encoded}`;
}

function authHeaders(config: StorageConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.serviceRoleKey}`,
    apikey: config.serviceRoleKey,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function downloadFromStorage(objectKey: string): Promise<string | null> {
  const config = storageConfig();
  if (!config) return null;

  let attempt = 0;
  while (attempt < 4) {
    attempt += 1;
    try {
      const response = await fetch(objectUrl(config, objectKey), {
        method: "GET",
        headers: authHeaders(config),
      });
      if (response.status === 404 || response.status === 400) return null;
      if (response.ok) return await response.text();
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < 4
      ) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      console.warn(
        `[extract-artifacts] Storage GET ${objectKey} failed: HTTP ${response.status}`,
      );
      return null;
    } catch (error) {
      if (attempt < 4) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      console.warn(
        `[extract-artifacts] Storage GET ${objectKey} failed:`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }
  return null;
}

async function uploadToStorage(
  objectKey: string,
  body: string,
): Promise<void> {
  const config = storageConfig();
  if (!config) return;

  let attempt = 0;
  while (attempt < 4) {
    attempt += 1;
    try {
      const response = await fetch(objectUrl(config, objectKey), {
        method: "POST",
        headers: {
          ...authHeaders(config),
          "Content-Type": "text/markdown; charset=utf-8",
          "x-upsert": "true",
        },
        body,
      });
      if (response.ok) return;
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < 4
      ) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      const detail = await response.text().catch(() => "");
      console.warn(
        `[extract-artifacts] Storage POST ${objectKey} failed: HTTP ${response.status} ${detail.slice(0, 180)}`,
      );
      return;
    } catch (error) {
      if (attempt < 4) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      console.warn(
        `[extract-artifacts] Storage POST ${objectKey} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

async function writeLocalFile(
  absolutePath: string,
  content: string,
): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

/**
 * Read extract markdown from disk; on miss, download from Storage and
 * populate the local cache. Returns null when neither has the object.
 */
export async function readExtractArtifactText(
  absolutePath: string,
): Promise<string | null> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch {
    // Cache miss — try Storage.
  }

  const objectKey = extractArtifactObjectKey(absolutePath);
  if (!objectKey) return null;
  const remote = await downloadFromStorage(objectKey);
  if (remote == null) return null;
  try {
    await writeLocalFile(absolutePath, remote);
  } catch (error) {
    console.warn(
      `[extract-artifacts] could not cache ${absolutePath}:`,
      error instanceof Error ? error.message : error,
    );
  }
  return remote;
}

export async function extractArtifactExists(
  absolutePath: string,
): Promise<boolean> {
  const body = await readExtractArtifactText(absolutePath);
  return body != null;
}

/**
 * Write extract markdown to disk and upsert Storage when configured.
 * Disk write is required; Storage failure is logged and does not throw
 * so a paid Docling/vision page is not discarded.
 */
export async function writeExtractArtifactText(
  absolutePath: string,
  content: string,
): Promise<void> {
  await writeLocalFile(absolutePath, content);
  const objectKey = extractArtifactObjectKey(absolutePath);
  if (!objectKey) return;
  await uploadToStorage(objectKey, content);
}
