/**
 * Docling for IBM watsonx — same REST API as docling-serve.
 * Uploads PDF bytes; caches stay local (per-page markdown).
 */

import { readFile } from "fs/promises";

import { ibmDoclingCostUsd } from "@/lib/email/docling-provider";

function collapsePageRanges(pages: number[]): Array<[number, number]> {
  const unique = [...new Set(pages)].sort((a, b) => a - b);
  if (unique.length === 0) return [];
  const ranges: Array<[number, number]> = [];
  let start = unique[0]!;
  let prev = unique[0]!;
  for (let i = 1; i < unique.length; i += 1) {
    const page = unique[i]!;
    if (page === prev + 1) {
      prev = page;
      continue;
    }
    ranges.push([start, prev]);
    start = page;
    prev = page;
  }
  ranges.push([start, prev]);
  return ranges;
}

export const DOCLING_PAGE_BREAK_PLACEHOLDER = "<!-- DOCLING_PAGE_BREAK -->";
/** Hosted IBM Docling only allows remote targets; presigned_url is the inline-equivalent. */
export const IBM_TARGET_TYPE = "presigned_url";
const ARTIFACT_DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
/** Hosted IBM often returns 0-byte markdown S3 objects; JSON carries md_content. */
const ARTIFACT_TYPE_PREFERENCE = ["json", "markdown", "md", "text"] as const;

const POLL_MS = 2_000;
const MAX_WAIT_MS = 10 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
const SUBMIT_TIMEOUT_MS = 120_000;
const DEFAULT_IBM_JOB_CONCURRENCY = 4;
const MAX_IBM_JOB_CONCURRENCY = 8;
const MAX_IBM_CREDENTIAL_SLOTS = 8;
/** Max pages per IBM submit — larger ranges often omit page-break placeholders. */
export const IBM_PAGE_RANGE_CHUNK = 5;

export function ibmJobConcurrencyFromEnv(): number {
  const raw = process.env.DOCLING_IBM_CONCURRENCY?.trim();
  if (!raw) return DEFAULT_IBM_JOB_CONCURRENCY;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_IBM_JOB_CONCURRENCY;
  return Math.min(MAX_IBM_JOB_CONCURRENCY, Math.floor(n));
}

function createSemaphore(limit: number) {
  let available = Math.max(1, limit);
  const waiters: Array<() => void> = [];
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (available > 0) {
        available -= 1;
      } else {
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      }
      try {
        return await fn();
      } finally {
        const next = waiters.shift();
        if (next) next();
        else available += 1;
      }
    },
  };
}

const ibmJobSlot = createSemaphore(ibmJobConcurrencyFromEnv());

function chunkCollapsedPageRanges(
  ranges: Array<[number, number]>,
  maxPages: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    for (let page = start; page <= end; page += maxPages) {
      out.push([page, Math.min(end, page + maxPages - 1)]);
    }
  }
  return out;
}

async function mapPoolResults<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  }
  const pool = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: pool }, () => run()));
  return results;
}

type IbmTask = {
  task_id?: string;
  taskId?: string;
  task_status?: string;
  taskStatus?: string;
};

export type IbmDoclingPage = {
  pageNo: number;
  markdown: string;
};

export type IbmDoclingConvertResult = {
  pages: IbmDoclingPage[];
  elapsedMs: number;
  costUsd: number;
  billedPages: number;
};

export type IbmDoclingHealth = {
  ok: boolean;
  configured: boolean;
  url: string | null;
  detail?: string;
  keyCount?: number;
  activeSlot?: number | null;
};

export type IbmDoclingCredential = {
  slot: number;
  url: string;
  apiKey: string;
};

function trimBaseUrl(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

function envValue(
  env: NodeJS.Dict<string>,
  name: string,
): string {
  return env[name]?.trim() || "";
}

/**
 * IBM hosted trials are URL+key pairs. Slot 1 is `DOCLING_IBM_URL` /
 * `DOCLING_IBM_API_KEY`. Extra trials: `_2` `_3` `_4`. A key without its
 * own URL reuses slot 1's URL.
 */
export function listIbmDoclingCredentials(
  env: NodeJS.Dict<string> = process.env,
): IbmDoclingCredential[] {
  const fallbackUrl = trimBaseUrl(
    envValue(env, "DOCLING_IBM_URL") || envValue(env, "DOCLING_SERVICE_URL"),
  );
  const out: IbmDoclingCredential[] = [];
  for (let slot = 1; slot <= MAX_IBM_CREDENTIAL_SLOTS; slot += 1) {
    const urlName = slot === 1 ? "DOCLING_IBM_URL" : `DOCLING_IBM_URL_${slot}`;
    const keyName =
      slot === 1 ? "DOCLING_IBM_API_KEY" : `DOCLING_IBM_API_KEY_${slot}`;
    const key =
      envValue(env, keyName) ||
      (slot === 1 ? envValue(env, "DOCLING_API_KEY") : "");
    if (!key) continue;
    const url = trimBaseUrl(
      (slot === 1
        ? envValue(env, urlName) || envValue(env, "DOCLING_SERVICE_URL")
        : envValue(env, urlName)) || fallbackUrl,
    );
    if (!url) continue;
    out.push({ slot, url, apiKey: key });
  }
  return out;
}

export function getIbmDoclingConfig(): {
  url: string | null;
  apiKey: string | null;
} {
  const first = listIbmDoclingCredentials()[0];
  return {
    url: first?.url ?? null,
    apiKey: first?.apiKey ?? null,
  };
}

function authHeaders(apiKey: string): Record<string, string> {
  return { "X-Api-Key": apiKey };
}

/**
 * IBM/docling-serve rejected the multipart body itself (wrong types, auth).
 * Every remaining doc would fail the same way — abort the run, do not count
 * the current doc as done.
 */
export class IbmDoclingRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "IbmDoclingRequestError";
    this.status = status;
  }
}

/** DNS / socket / offline — abort the run; resume when the network is back. */
export class IbmDoclingConnectivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IbmDoclingConnectivityError";
  }
}

/** IBM 402 `usage_limit_exceeded` — rotate to the next env key, do not abort the run. */
export class IbmDoclingQuotaError extends Error {
  readonly status: number;
  readonly slot: number;

  constructor(message: string, status: number, slot: number) {
    super(message);
    this.name = "IbmDoclingQuotaError";
    this.status = status;
    this.slot = slot;
  }
}

/** 401/403 on one key — skip it and try the next. */
export class IbmDoclingKeyRejectedError extends Error {
  readonly status: number;
  readonly slot: number;

  constructor(message: string, status: number, slot: number) {
    super(message);
    this.name = "IbmDoclingKeyRejectedError";
    this.status = status;
    this.slot = slot;
  }
}

export class IbmDoclingAllKeysExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IbmDoclingAllKeysExhaustedError";
  }
}

/**
 * IBM returned HTTP 200 / task success but no markdown (common when a trial
 * instance is out of pages). Rotate to the next env key like a soft quota hit.
 */
export class IbmDoclingEmptyResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IbmDoclingEmptyResultError";
  }
}

const QUOTA_MESSAGE_RE =
  /usage_limit_exceeded|usage limit|quota (exceeded|exhausted)|out of (credits|funds)|insufficient (credits|funds)|trial.{0,24}(exceeded|exhausted)|page limit/i;

export function isIbmQuotaExhausted(
  status: number,
  data: unknown,
  message?: string,
): boolean {
  if (status === 402) return true;
  const record =
    data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (record?.error === "usage_limit_exceeded") return true;
  const blob = [message, errorDetail(data, ""), JSON.stringify(data ?? "")]
    .filter(Boolean)
    .join(" ");
  return QUOTA_MESSAGE_RE.test(blob);
}

function errorDetail(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const record = data as { detail?: unknown; message?: unknown };
  const detail = record.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const joined = detail
      .map((item) =>
        typeof item === "string"
          ? item
          : item && typeof item === "object" && "msg" in item
            ? String((item as { msg: unknown }).msg)
            : "",
      )
      .filter(Boolean)
      .join("; ");
    if (joined) return joined;
  }
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }
  return fallback;
}

const PYDANTIC_FORM_ERROR_RE =
  /input should be a valid integer|unable to parse string as an integer|value is not a valid integer|target kind .+ is not allowed/i;

function isFatalSubmitFailure(status: number, data: unknown): boolean {
  if (isIbmQuotaExhausted(status, data)) return false;
  if (status === 401 || status === 403) return false;
  if (status === 422) return true;
  if (status !== 400) return false;
  return PYDANTIC_FORM_ERROR_RE.test(errorDetail(data, ""));
}

export function isFatalIbmDoclingError(error: unknown): boolean {
  if (error instanceof IbmDoclingAllKeysExhaustedError) return false;
  if (error instanceof IbmDoclingConnectivityError) return true;
  if (error instanceof IbmDoclingQuotaError) return false;
  if (error instanceof IbmDoclingKeyRejectedError) return false;
  if (error instanceof IbmDoclingRequestError) return true;
  if (isIbmConnectivityError(error)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return PYDANTIC_FORM_ERROR_RE.test(message);
}

function ibmErrorCauseChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let i = 0; i < 4 && current; i += 1) {
    if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message}`);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(" ");
}

const CONNECTIVITY_RE =
  /fetch failed|ENOTFOUND|ENETUNREACH|ENETDOWN|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|EAI_AGAIN|UND_ERR_CONNECT|UND_ERR_SOCKET|getaddrinfo|network is unreachable|socket hang up|temporarily unavailable/i;

export function isIbmConnectivityError(error: unknown): boolean {
  if (error instanceof IbmDoclingConnectivityError) return true;
  return CONNECTIVITY_RE.test(ibmErrorCauseChain(error));
}

function isAbortTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    /aborted due to timeout/i.test(error.message)
  );
}

function rethrowIfIbmConnectivity(
  error: unknown,
  action: string,
  treatAbortTimeout = false,
): never {
  if (isIbmConnectivityError(error) || (treatAbortTimeout && isAbortTimeout(error))) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new IbmDoclingConnectivityError(
      `Lost connection to IBM Docling while ${action} (${detail}). Resume when internet is back.`,
    );
  }
  throw error;
}

/**
 * FastAPI `page_range: tuple[int, int]` must be two integer form fields.
 * A JSON array string (`"[1,20]"`) is parsed as one string → 422.
 */
export function appendIbmConvertOptions(
  form: FormData,
  pageStart: number,
  pageEnd: number,
): void {
  const start = Math.floor(Number(pageStart));
  const end = Math.floor(Number(pageEnd));
  form.append("from_formats", "pdf");
  // IBM presigned_url flow: request JSON alongside markdown (tutorial uses both).
  form.append("to_formats", "json");
  form.append("to_formats", "md");
  form.append("do_ocr", "true");
  form.append("force_ocr", "false");
  form.append("image_export_mode", "placeholder");
  form.append("page_range", String(start));
  form.append("page_range", String(end));
  form.append("md_page_break_placeholder", DOCLING_PAGE_BREAK_PLACEHOLDER);
  form.append("document_timeout", "3600");
  // Hosted IBM Docling rejects inbody/zip; results come back as presigned artifacts.
  form.append("target_type", IBM_TARGET_TYPE);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(
  record: Record<string, unknown> | null,
  ...keys: string[]
): string {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function markdownFromExportDoc(value: unknown): string {
  const record = asRecord(value);
  return stringField(
    record,
    "md_content",
    "mdContent",
    "text_content",
    "textContent",
  );
}

function markdownFromResultItem(value: unknown): string {
  const record = asRecord(value);
  if (!record) return "";
  return (
    markdownFromExportDoc(record.content) ||
    markdownFromExportDoc(record.document) ||
    markdownFromExportDoc(record)
  );
}

/**
 * IBM/docling-serve has shipped several result envelopes. Read markdown from
 * all of them so a successful convert is not treated as empty.
 */
export function extractIbmMarkdown(data: unknown): string {
  const root = asRecord(data);
  if (!root) return "";

  const direct =
    markdownFromExportDoc(root.document) ||
    markdownFromResultItem(root.result) ||
    markdownFromResultItem(root);
  if (direct) return direct;

  const groups = [root.documents];
  const result = asRecord(root.result);
  if (result) groups.push(result.documents);
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const markdown = markdownFromResultItem(item);
      if (markdown) return markdown;
    }
  }
  return "";
}

function ibmResultKind(data: unknown): string {
  const root = asRecord(data);
  if (!root) return "";
  if (typeof root.kind === "string") return root.kind;
  const result = asRecord(root.result);
  if (result && typeof result.kind === "string") return result.kind;
  return "";
}

export type IbmArtifactRef = {
  artifactType: string;
  uri: string;
};

function documentItems(data: unknown): unknown[] {
  const root = asRecord(data);
  if (!root) return [];
  const items: unknown[] = [];
  if (Array.isArray(root.documents)) items.push(...root.documents);
  const result = asRecord(root.result);
  if (result && Array.isArray(result.documents)) items.push(...result.documents);
  return items;
}

function artifactRefsFromDocument(value: unknown): IbmArtifactRef[] {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.artifacts)) return [];
  const refs: IbmArtifactRef[] = [];
  for (const item of record.artifacts) {
    const artifact = asRecord(item);
    if (!artifact) continue;
    const uri = stringField(artifact, "uri");
    if (!uri) continue;
    refs.push({
      artifactType: stringField(
        artifact,
        "artifact_type",
        "artifactType",
      ).toLowerCase(),
      uri,
    });
  }
  return refs;
}

/**
 * Hosted IBM returns a PresignedArtifactResult manifest, not inline md_content.
 * Prefer JSON (carries md_content or DoclingDocument.texts), then markdown files.
 */
export function selectIbmMarkdownArtifact(
  data: unknown,
): IbmArtifactRef | null {
  return listIbmMarkdownArtifacts(data)[0] ?? null;
}

/** All artifact refs in preference order (json → markdown → md → text). */
export function listIbmMarkdownArtifacts(data: unknown): IbmArtifactRef[] {
  const out: IbmArtifactRef[] = [];
  const seen = new Set<string>();
  for (const document of documentItems(data)) {
    const refs = artifactRefsFromDocument(document);
    for (const preferred of ARTIFACT_TYPE_PREFERENCE) {
      const match = refs.find((ref) => ref.artifactType === preferred);
      if (!match || seen.has(match.uri)) continue;
      seen.add(match.uri);
      out.push(match);
    }
    for (const ref of refs) {
      if (seen.has(ref.uri)) continue;
      seen.add(ref.uri);
      out.push(ref);
    }
  }
  return out;
}

function markdownFromDoclingDocumentJson(value: unknown): string {
  const root = asRecord(value);
  if (!root) return "";
  if (root.schema_name !== "DoclingDocument") {
    const nested = root.document ?? root.content;
    if (nested) return markdownFromDoclingDocumentJson(nested);
    return "";
  }
  const texts = root.texts;
  if (!Array.isArray(texts) || texts.length === 0) return "";
  const parts: string[] = [];
  for (const item of texts) {
    const text = stringField(asRecord(item), "text");
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

export function markdownFromIbmArtifactBytes(
  artifactType: string,
  bytes: Buffer,
): string {
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!text) return "";
  if (artifactType === "json") {
    try {
      const parsed = JSON.parse(text);
      const fromMd = extractIbmMarkdown(parsed);
      if (fromMd) return fromMd;
      return markdownFromDoclingDocumentJson(parsed);
    } catch {
      return "";
    }
  }
  return text;
}

async function downloadIbmArtifactMarkdown(
  artifact: IbmArtifactRef,
  apiKey?: string,
): Promise<string> {
  if (!/^https:\/\//i.test(artifact.uri)) {
    throw new Error("IBM Docling artifact URI is not https.");
  }
  const headerSets: Array<Record<string, string> | undefined> = [
    undefined,
    apiKey ? { "X-Api-Key": apiKey } : undefined,
  ];
  let lastBytes = 0;
  for (const headers of headerSets) {
    let response: Response;
    try {
      response = await fetch(artifact.uri, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(ARTIFACT_DOWNLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      rethrowIfIbmConnectivity(error, "downloading the result artifact");
    }
    if (!response.ok) {
      continue;
    }
    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader && Number(lengthHeader) > MAX_ARTIFACT_BYTES) {
      throw new Error("IBM Docling artifact exceeds 32 MB.");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    lastBytes = bytes.length;
    if (bytes.length > MAX_ARTIFACT_BYTES) {
      throw new Error("IBM Docling artifact exceeds 32 MB.");
    }
    const markdown = markdownFromIbmArtifactBytes(artifact.artifactType, bytes);
    if (markdown) return markdown;
  }
  if (lastBytes === 0) {
    console.warn("[ibm-docling] artifact download returned 0 bytes", {
      artifactType: artifact.artifactType,
      uri: artifact.uri.slice(0, 120),
    });
  }
  return "";
}

function ibmResultKeys(data: unknown): string {
  const root = asRecord(data);
  return root ? Object.keys(root).join(",") : "";
}

function numberField(
  record: Record<string, unknown> | null,
  ...keys: string[]
): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Summarize hosted IBM conversion counters when markdown is missing. */
export function ibmConversionFailureSummary(data: unknown): string | null {
  const root = asRecord(data);
  if (!root) return null;
  const numFailed = numberField(root, "num_failed", "numFailed");
  const numSucceeded = numberField(root, "num_succeeded", "numSucceeded");
  const numConverted = numberField(root, "num_converted", "numConverted");
  const parts: string[] = [];
  if (numFailed != null && numFailed > 0) {
    parts.push(`${numFailed} failed`);
  }
  if (numSucceeded != null) {
    parts.push(`${numSucceeded} succeeded`);
  }
  if (numConverted != null) {
    parts.push(`${numConverted} converted`);
  }
  for (const document of documentItems(data)) {
    const record = asRecord(document);
    if (!record) continue;
    const status = stringField(record, "status").toLowerCase();
    const errors = record.errors;
    if (status === "failure" || status === "failed") {
      parts.push("document status=failure");
    }
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      const message =
        typeof first === "string"
          ? first
          : asRecord(first)
            ? stringField(asRecord(first), "message", "detail", "error")
            : "";
      if (message) parts.push(message.slice(0, 160));
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * When IBM reports num_succeeded > 0 but artifacts are empty, treat it as a
 * conversion/download glitch — do not mark the API key exhausted.
 */
export function shouldRotateOnEmptyIbmResult(data: unknown): boolean {
  const root = asRecord(data);
  if (!root) return true;
  const numFailed = numberField(root, "num_failed", "numFailed");
  const numSucceeded = numberField(root, "num_succeeded", "numSucceeded");
  if (numFailed != null && numFailed > 0) return true;
  if (numSucceeded != null && numSucceeded > 0) return false;
  const summary = ibmConversionFailureSummary(data) ?? "";
  if (QUOTA_MESSAGE_RE.test(summary)) return true;
  // Job reported success but artifact download was empty — not a dead API key.
  if (/\bsucceeded\b/i.test(summary) && /\bconverted\b/i.test(summary)) {
    return false;
  }
  return true;
}

function throwOnEmptyIbmMarkdown(data: unknown, detail: string): never {
  const stats = ibmConversionFailureSummary(data);
  const suffix = stats ? ` (${stats})` : "";
  const message = shouldRotateOnEmptyIbmResult(data)
    ? `${detail}${suffix}`
    : `${detail}${suffix} IBM accepted the job but returned empty result files (often 0-byte S3 artifacts). This is not fixed by adding another API key — retry later or contact IBM watsonx support.`;
  if (shouldRotateOnEmptyIbmResult(data)) {
    throw new IbmDoclingEmptyResultError(message);
  }
  throw new Error(message);
}

async function downloadIbmMarkdownFromResult(
  data: unknown,
  apiKey?: string,
): Promise<string> {
  const inline = extractIbmMarkdown(data);
  if (inline) return inline;

  const artifacts = listIbmMarkdownArtifacts(data);
  const root = asRecord(data);
  const numSucceeded = numberField(root, "num_succeeded", "numSucceeded");
  const maxRounds = numSucceeded != null && numSucceeded > 0 ? 4 : 1;

  if (numSucceeded != null && numSucceeded > 0) {
    // Presigned S3 artifacts can lag behind num_succeeded.
    await sleep(1_500);
  }

  for (let round = 1; round <= maxRounds; round += 1) {
    for (const artifact of artifacts) {
      const markdown = await downloadIbmArtifactMarkdown(artifact, apiKey);
      if (markdown) return markdown;
    }
    if (round < maxRounds) {
      await sleep(600 * round);
    }
  }
  return "";
}

function taskIdOf(task: IbmTask): string | null {
  const id = task.task_id ?? task.taskId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function taskStatusOf(task: IbmTask): string {
  return String(task.task_status ?? task.taskStatus ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Split IBM/docling-serve markdown that used md_page_break_placeholder.
 * Returns null when segment count does not match the requested pages.
 */
export function splitMarkdownByPageBreak(
  markdown: string,
  pageNos: number[],
): IbmDoclingPage[] | null {
  const trimmed = markdown.trim();
  if (pageNos.length === 0) return [];
  if (pageNos.length === 1) {
    return [{ pageNo: pageNos[0]!, markdown: trimmed }];
  }
  const parts = trimmed
    .split(DOCLING_PAGE_BREAK_PLACEHOLDER)
    .map((part) => part.trim());
  if (parts.length !== pageNos.length) return null;
  return pageNos.map((pageNo, index) => ({
    pageNo,
    markdown: parts[index] ?? "",
  }));
}

export async function checkIbmDoclingHealth(): Promise<IbmDoclingHealth> {
  const creds = listIbmDoclingCredentials();
  if (creds.length === 0) {
    return {
      ok: false,
      configured: false,
      url: null,
      keyCount: 0,
      activeSlot: null,
      detail:
        "Set DOCLING_IBM_URL and DOCLING_IBM_API_KEY (plus _2 / _3 / _4 for extra trials).",
    };
  }

  const slots = await import("@/lib/email/ibm-docling-slots");
  await slots.syncIbmDoclingSlotsFromEnv();

  const paths = ["/health", "/v1/health", "/docs", "/openapi.json"];
  let lastUrl: string | null = null;
  let lastDetail = "No health endpoint responded.";
  const ordered = await slots.listOrderedIbmCredentials();
  const candidates = ordered.length > 0 ? ordered : creds;

  for (const live of candidates) {
    lastUrl = live.url;
    let authRejected = false;

    for (const path of paths) {
      try {
        const response = await fetch(`${live.url}${path}`, {
          method: "GET",
          headers: authHeaders(live.apiKey),
          signal: AbortSignal.timeout(8_000),
        });
        if (response.status === 401 || response.status === 403) {
          lastDetail = `IBM rejected API key ${live.slot} (${response.status}).`;
          authRejected = true;
          break;
        }
        if (response.ok || response.status === 404) {
          if (response.ok || path !== "/health") {
            return {
              ok: true,
              configured: true,
              url: live.url,
              keyCount: creds.length,
              activeSlot: live.slot,
            };
          }
          lastDetail = `Health check returned ${response.status} at ${path}.`;
          continue;
        }
        lastDetail = `IBM returned ${response.status} at ${path}.`;
      } catch (error) {
        lastDetail =
          error instanceof Error ? error.message : "IBM Docling unreachable.";
      }
    }

    if (authRejected) {
      await slots.withIbmSlotLock(() =>
        slots.markIbmSlotExhausted(live.slot, "auth"),
      );
      continue;
    }
  }

  return {
    ok: false,
    configured: true,
    url: lastUrl,
    keyCount: creds.length,
    activeSlot: null,
    detail: lastDetail,
  };
}

async function submitConvertFile(options: {
  url: string;
  apiKey: string;
  pdfBytes: Buffer;
  filename: string;
  pageStart: number;
  pageEnd: number;
}): Promise<string> {
  const form = new FormData();
  form.append(
    "files",
    new Blob([new Uint8Array(options.pdfBytes)], { type: "application/pdf" }),
    options.filename,
  );
  appendIbmConvertOptions(form, options.pageStart, options.pageEnd);

  let response: Response;
  try {
    response = await fetch(`${options.url}/v1/convert/file/async`, {
      method: "POST",
      headers: authHeaders(options.apiKey),
      body: form,
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
  } catch (error) {
    rethrowIfIbmConnectivity(error, "submitting the PDF");
  }
  const data = (await response.json().catch(() => ({}))) as IbmTask & {
    detail?: unknown;
  };
  if (!response.ok) {
    const message = errorDetail(
      data,
      `IBM convert submit returned ${response.status}.`,
    );
    if (isIbmQuotaExhausted(response.status, data, message)) {
      throw new IbmDoclingQuotaError(message, response.status, 0);
    }
    if (response.status === 401 || response.status === 403) {
      throw new IbmDoclingKeyRejectedError(message, response.status, 0);
    }
    if (isFatalSubmitFailure(response.status, data)) {
      throw new IbmDoclingRequestError(message, response.status);
    }
    throw new Error(message);
  }
  const id = taskIdOf(data);
  if (!id) {
    throw new Error("IBM convert submit did not return a task_id.");
  }
  return id;
}

async function pollTask(options: {
  url: string;
  apiKey: string;
  taskId: string;
}): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    let response: Response;
    try {
      response = await fetch(
        `${options.url}/v1/status/poll/${encodeURIComponent(options.taskId)}`,
        {
          method: "GET",
          headers: authHeaders(options.apiKey),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch (error) {
      rethrowIfIbmConnectivity(error, "polling conversion status", true);
    }
    const data = (await response.json().catch(() => ({}))) as IbmTask & {
      detail?: unknown;
    };
    if (!response.ok) {
      const message = errorDetail(
        data,
        `IBM poll returned ${response.status}.`,
      );
      if (isIbmQuotaExhausted(response.status, data, message)) {
        throw new IbmDoclingQuotaError(message, response.status, 0);
      }
      if (response.status === 401 || response.status === 403) {
        throw new IbmDoclingKeyRejectedError(message, response.status, 0);
      }
      throw new Error(message);
    }
    const status = taskStatusOf(data);
    if (status === "success" || status === "partial_success") return;
    if (status === "failure" || status === "failed") {
      throw new Error("IBM Docling conversion failed.");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error("IBM Docling conversion timed out after 10 minutes.");
}

async function fetchTaskResult(options: {
  url: string;
  apiKey: string;
  taskId: string;
}): Promise<string> {
  let response: Response;
  try {
    response = await fetch(
      `${options.url}/v1/result/${encodeURIComponent(options.taskId)}`,
      {
        method: "GET",
        headers: {
          ...authHeaders(options.apiKey),
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch (error) {
    rethrowIfIbmConnectivity(error, "fetching conversion results", true);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (/zip/i.test(contentType)) {
    throw new IbmDoclingRequestError(
      `IBM result was ${contentType}, not a JSON artifact manifest.`,
      response.status,
    );
  }
  const raw = await response.text();
  let data: unknown = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new IbmDoclingRequestError(
      `IBM result was not JSON (${contentType || "unknown type"}).`,
      response.status,
    );
  }
  if (!response.ok) {
    const message = errorDetail(
      data,
      `IBM result returned ${response.status}.`,
    );
    if (isIbmQuotaExhausted(response.status, data, message)) {
      throw new IbmDoclingQuotaError(message, response.status, 0);
    }
    if (response.status === 401 || response.status === 403) {
      throw new IbmDoclingKeyRejectedError(message, response.status, 0);
    }
    throw new Error(message);
  }
  const root = asRecord(data);
  const status = stringField(root, "status").toLowerCase();
  if (status === "failure") {
    throw new Error("IBM Docling result status=failure.");
  }
  const markdown = await downloadIbmMarkdownFromResult(data, options.apiKey);
  if (markdown) return markdown;

  const artifacts = listIbmMarkdownArtifacts(data);
  if (artifacts.length > 0) {
    const types = [...new Set(artifacts.map((a) => a.artifactType))].join(", ");
    throwOnEmptyIbmMarkdown(
      data,
      `IBM Docling artifact(s) (${types}) had no markdown.`,
    );
  }

  const kind = ibmResultKind(data);
  const keys = ibmResultKeys(data) || "(none)";
  throwOnEmptyIbmMarkdown(
    data,
    `IBM Docling returned empty markdown (kind=${kind || "unknown"}; keys=${keys}).`,
  );
}

function isRotatableIbmError(error: unknown): boolean {
  if (error instanceof IbmDoclingQuotaError) return true;
  if (error instanceof IbmDoclingKeyRejectedError) return true;
  if (error instanceof IbmDoclingEmptyResultError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return QUOTA_MESSAGE_RE.test(message);
}

function rotatableReason(error: unknown): "quota" | "auth" {
  if (error instanceof IbmDoclingKeyRejectedError) return "auth";
  if (error instanceof IbmDoclingQuotaError) return "quota";
  if (error instanceof IbmDoclingEmptyResultError) return "quota";
  return "quota";
}

async function withIbmCredential<T>(
  fn: (cred: IbmDoclingCredential) => Promise<T>,
): Promise<{ value: T; slot: number }> {
  const slots = await import("@/lib/email/ibm-docling-slots");
  slots.clearIbmSlotRunSkips();
  const tried = new Set<number>();
  let lastRotatableError: unknown = null;

  while (true) {
    const ordered = await slots.withIbmSlotLock(() =>
      slots.listOrderedIbmCredentials(),
    );
    const cred = ordered.find((c) => !tried.has(c.slot));
    if (!cred) {
      if (lastRotatableError instanceof Error) {
        throw lastRotatableError;
      }
      const keyCount = listIbmDoclingCredentials().length;
      const nextSlot = keyCount + 1;
      throw new IbmDoclingAllKeysExhaustedError(
        `All ${keyCount} configured IBM Docling API key(s) are exhausted or rejected. ` +
          `Provision a fresh watsonx Docling trial and add DOCLING_IBM_URL_${nextSlot} / ` +
          `DOCLING_IBM_API_KEY_${nextSlot} in Coolify (or .env.local).`,
      );
    }
    tried.add(cred.slot);
    try {
      const value = await fn(cred);
      return { value, slot: cred.slot };
    } catch (error) {
      if (!isRotatableIbmError(error)) throw error;
      lastRotatableError = error;
      const reason = rotatableReason(error);
      const persist =
        error instanceof IbmDoclingKeyRejectedError ||
        error instanceof IbmDoclingQuotaError ||
        (error instanceof IbmDoclingEmptyResultError &&
          (await slots.shouldPersistIbmSlotExhaustion(cred.slot)));
      console.warn("[ibm-docling] rotating API key", {
        fromSlot: cred.slot,
        reason,
        persist,
        message: error instanceof Error ? error.message : String(error),
      });
      await slots.withIbmSlotLock(async () => {
        if (persist) {
          await slots.markIbmSlotExhausted(cred.slot, reason);
        } else {
          slots.skipIbmSlotForRun(cred.slot);
        }
      });
    }
  }
}

async function convertPageRange(options: {
  pdfBytes: Buffer;
  filename: string;
  pageStart: number;
  pageEnd: number;
}): Promise<IbmDoclingPage[]> {
  const pageNos: number[] = [];
  for (let page = options.pageStart; page <= options.pageEnd; page += 1) {
    pageNos.push(page);
  }

  const { value: markdown, slot } = await ibmJobSlot.run(async () =>
    withIbmCredential(async (cred) => {
      const taskId = await submitConvertFile({
        url: cred.url,
        apiKey: cred.apiKey,
        pdfBytes: options.pdfBytes,
        filename: options.filename,
        pageStart: options.pageStart,
        pageEnd: options.pageEnd,
      });
      await pollTask({ url: cred.url, apiKey: cred.apiKey, taskId });
      return fetchTaskResult({
        url: cred.url,
        apiKey: cred.apiKey,
        taskId,
      });
    }),
  );

  const slots = await import("@/lib/email/ibm-docling-slots");

  const split = splitMarkdownByPageBreak(markdown, pageNos);
  if (split) {
    await slots.recordIbmSlotUsage(slot, pageNos.length);
    return split;
  }

  if (pageNos.length === 1) {
    await slots.recordIbmSlotUsage(slot, 1);
    return [{ pageNo: pageNos[0]!, markdown: markdown.trim() }];
  }

  // IBM ignored md_page_break_placeholder — retry one page at a time. Do not
  // bill the failed batch in our ledger (IBM may still count it); billing the
  // batch and every single-page retry was double-counting trial pages.
  console.warn("[ibm-docling] page-break placeholder mismatch; converting pages individually", {
    pageStart: options.pageStart,
    pageEnd: options.pageEnd,
  });
  const singles = await mapPoolResults(
    pageNos,
    ibmJobConcurrencyFromEnv(),
    (pageNo) =>
      convertPageRange({
        pdfBytes: options.pdfBytes,
        filename: options.filename,
        pageStart: pageNo,
        pageEnd: pageNo,
      }),
  );
  return singles.flat();
}

export async function convertPagesWithIbmDocling(options: {
  pdfPath: string;
  pages: number[];
  filename?: string;
}): Promise<IbmDoclingConvertResult> {
  if (listIbmDoclingCredentials().length === 0) {
    throw new Error(
      "IBM Docling is not configured. Set DOCLING_IBM_URL and DOCLING_IBM_API_KEY (plus _2 / _3 / _4 for extra trials).",
    );
  }

  const uniquePages = [
    ...new Set(
      options.pages
        .map((p) => Math.floor(Number(p)))
        .filter((p) => Number.isFinite(p) && p >= 1),
    ),
  ].sort((a, b) => a - b);
  if (uniquePages.length === 0) {
    throw new Error("IBM Docling convert requires at least one page.");
  }

  const pdfBytes = await readFile(options.pdfPath);
  const filename = options.filename ?? "document.pdf";
  const started = Date.now();
  const ranges = chunkCollapsedPageRanges(
    collapsePageRanges(uniquePages),
    IBM_PAGE_RANGE_CHUNK,
  );
  const rangeResults = await mapPoolResults(
    ranges,
    ibmJobConcurrencyFromEnv(),
    ([start, end]) =>
      convertPageRange({
        pdfBytes,
        filename,
        pageStart: start,
        pageEnd: end,
      }),
  );
  const pages = rangeResults.flat();

  pages.sort((a, b) => a.pageNo - b.pageNo);
  return {
    pages,
    elapsedMs: Date.now() - started,
    billedPages: uniquePages.length,
    costUsd: ibmDoclingCostUsd(uniquePages.length),
  };
}

export type IbmDoclingSlotProbeResult = {
  slot: number;
  configured: boolean;
  urlHint: string | null;
  healthChecks: Array<{ path: string; status: number; ok: boolean }>;
  convert: {
    ok: boolean;
    elapsedMs: number;
    taskId?: string;
    markdownChars?: number;
    markdownPreview?: string;
    errorName?: string;
    errorMessage?: string;
    httpStatus?: number;
  };
};

/**
 * Live probe for one env slot — does not rotate keys or mark slots exhausted.
 * Uses a tiny one-page PDF to exercise submit → poll → result.
 */
export async function probeIbmDoclingSlot(
  slot: number,
  pdfBytes: Buffer,
): Promise<IbmDoclingSlotProbeResult> {
  const cred = listIbmDoclingCredentials().find((c) => c.slot === slot);
  const healthPaths = ["/health", "/v1/health", "/docs", "/openapi.json"];
  const healthChecks: IbmDoclingSlotProbeResult["healthChecks"] = [];

  if (!cred) {
    return {
      slot,
      configured: false,
      urlHint: null,
      healthChecks,
      convert: {
        ok: false,
        elapsedMs: 0,
        errorMessage: `No DOCLING_IBM_API_KEY_${slot} (and URL) in environment.`,
      },
    };
  }

  let urlHint: string;
  try {
    const { hostname } = new URL(cred.url);
    urlHint = hostname;
  } catch {
    urlHint = cred.url.slice(0, 48);
  }

  for (const path of healthPaths) {
    try {
      const response = await fetch(`${cred.url}${path}`, {
        method: "GET",
        headers: authHeaders(cred.apiKey),
        signal: AbortSignal.timeout(8_000),
      });
      healthChecks.push({
        path,
        status: response.status,
        ok: response.ok || response.status === 404,
      });
    } catch (error) {
      healthChecks.push({
        path,
        status: 0,
        ok: false,
      });
    }
  }

  const started = Date.now();
  try {
    const taskId = await submitConvertFile({
      url: cred.url,
      apiKey: cred.apiKey,
      pdfBytes,
      filename: "probe-one-page.pdf",
      pageStart: 1,
      pageEnd: 1,
    });
    await pollTask({ url: cred.url, apiKey: cred.apiKey, taskId });
    const markdown = await fetchTaskResult({
      url: cred.url,
      apiKey: cred.apiKey,
      taskId,
    });
    const trimmed = markdown.trim();
    return {
      slot,
      configured: true,
      urlHint,
      healthChecks,
      convert: {
        ok: trimmed.length > 0,
        elapsedMs: Date.now() - started,
        taskId,
        markdownChars: trimmed.length,
        markdownPreview: trimmed.slice(0, 240),
        errorMessage:
          trimmed.length > 0 ? undefined : "IBM returned empty markdown.",
        errorName:
          trimmed.length > 0 ? undefined : "IbmDoclingEmptyResultError",
      },
    };
  } catch (error) {
    const httpStatus =
      error instanceof IbmDoclingQuotaError ||
      error instanceof IbmDoclingKeyRejectedError ||
      error instanceof IbmDoclingRequestError
        ? error.status
        : undefined;
    return {
      slot,
      configured: true,
      urlHint,
      healthChecks,
      convert: {
        ok: false,
        elapsedMs: Date.now() - started,
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage:
          error instanceof Error ? error.message : String(error),
        httpStatus,
      },
    };
  }
}
