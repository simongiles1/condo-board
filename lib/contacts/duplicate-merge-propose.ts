/**
 * AI proposals for merging first-name stub candidates into full-name anchors
 * within a Contacts → Duplicates group. Session-only — does not persist or merge.
 */

import { desc, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  contactPersonEmails,
  contactPersonPhones,
  contactPersonTitles,
  contactPersons,
  emails,
  organizationEntities,
} from "@/lib/db/schema";
import { generateDeepSeekJson } from "@/lib/deepseek/client";
import {
  getContactHighlightModelMeta,
  getContactHighlightPassConfig,
  resolveContactHighlightModel,
} from "@/lib/email-analysis/contact-highlight-models";
import { buildContactHighlightDomainContext } from "@/lib/email-analysis/contact-highlight-shared";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { estimateCostUsd } from "@/lib/gemini/usage";
import {
  collectCandidateEmailIdsByPersonIds,
  resolveAuthoredBodiesForEvidence,
} from "@/lib/contacts/registry-evidence";
import {
  contactFieldValueIsDenied,
  loadContactFieldDenialsForPersons,
} from "@/lib/contacts/field-denials";
import {
  parseNameAliasesJson,
  personDisplayName,
  type ContactRegistryPersonSummary,
} from "@/lib/contacts/registry-shared";
import {
  classifyDuplicateMergeRole,
  DUPLICATE_MERGE_PARSE_FALLBACK_REASON,
  DUPLICATE_MERGE_PROPOSE_BATCH_SIZE,
  DUPLICATE_MERGE_PROPOSE_MAX_BODY_CHARS,
  DUPLICATE_MERGE_PROPOSE_MAX_EMAILS,
  DUPLICATE_MERGE_PROPOSE_MAX_OUTPUT_TOKENS,
  type DuplicateMergeProposeBucket,
  type DuplicateMergeProposeMeta,
  type DuplicateMergeProposeResult,
  type DuplicateMergeProposeUnresolved,
} from "@/lib/contacts/duplicate-merge-propose-shared";

type EvidenceExcerpt = {
  subject: string;
  from: string;
  at: string;
  excerpt: string;
};

type CandidateDossier = {
  person: ContactRegistryPersonSummary;
  evidence: EvidenceExcerpt[];
};

function truncateAroundNeedle(
  text: string,
  needle: string | null,
  maxChars: number,
): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  const hay = trimmed.toLowerCase();
  const n = needle?.trim().toLowerCase() ?? "";
  let start = 0;
  if (n.length >= 2) {
    const idx = hay.indexOf(n);
    if (idx >= 0) {
      start = Math.max(0, idx - Math.floor(maxChars / 3));
    }
  }
  const slice = trimmed.slice(start, start + maxChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = start + maxChars < trimmed.length ? "…" : "";
  return `${prefix}${slice}${suffix}`;
}

async function loadPersonsByIds(
  personIds: string[],
): Promise<ContactRegistryPersonSummary[]> {
  const unique = [...new Set(personIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const db = getDb();
  const rows = await db
    .select()
    .from(contactPersons)
    .where(inArray(contactPersons.id, unique));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const orgIds = [
    ...new Set(
      rows
        .map((r) => r.currentOrganizationId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [emailAttrs, phoneAttrs, titleAttrs, orgRows, denialsByPerson] =
    await Promise.all([
      db
        .select()
        .from(contactPersonEmails)
        .where(inArray(contactPersonEmails.personId, ids)),
      db
        .select()
        .from(contactPersonPhones)
        .where(inArray(contactPersonPhones.personId, ids)),
      db
        .select()
        .from(contactPersonTitles)
        .where(inArray(contactPersonTitles.personId, ids)),
      orgIds.length === 0
        ? Promise.resolve([] as Array<{ id: string; name: string | null }>)
        : db
            .select({
              id: organizationEntities.id,
              name: organizationEntities.name,
            })
            .from(organizationEntities)
            .where(inArray(organizationEntities.id, orgIds)),
      loadContactFieldDenialsForPersons(ids),
    ]);

  const orgNameById = new Map(orgRows.map((o) => [o.id, o.name]));
  const emailsBy = new Map<string, typeof emailAttrs>();
  for (const row of emailAttrs) {
    const list = emailsBy.get(row.personId) ?? [];
    list.push(row);
    emailsBy.set(row.personId, list);
  }
  const phonesBy = new Map<string, typeof phoneAttrs>();
  for (const row of phoneAttrs) {
    const list = phonesBy.get(row.personId) ?? [];
    list.push(row);
    phonesBy.set(row.personId, list);
  }
  const titlesBy = new Map<string, typeof titleAttrs>();
  for (const row of titleAttrs) {
    const list = titlesBy.get(row.personId) ?? [];
    list.push(row);
    titlesBy.set(row.personId, list);
  }

  // Preserve caller order when possible.
  const byId = new Map(
    rows.map((row) => {
      const denials = denialsByPerson.get(row.id) ?? [];
      const summary: ContactRegistryPersonSummary = {
        id: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        nameAliases: parseNameAliasesJson(row.nameAliasesJson).filter(
          (alias) => !contactFieldValueIsDenied(denials, "name_alias", alias),
        ),
        mentionWeight: row.mentionWeight,
        // Skip live recount — duplicates UI already uses stored weight here.
        sourceEmailCount: row.mentionWeight,
        sparseStub: row.sparseStub,
        currentOrganizationId: row.currentOrganizationId,
        currentOrganizationName: row.currentOrganizationId
          ? (orgNameById.get(row.currentOrganizationId) ?? null)
          : null,
        emails: (emailsBy.get(row.id) ?? [])
          .filter((e) => !contactFieldValueIsDenied(denials, "email", e.email))
          .map((e) => ({
            id: e.id,
            email: e.email,
            validFrom: e.validFrom,
            validTo: e.validTo,
          })),
        phones: (phonesBy.get(row.id) ?? [])
          .filter((p) => !contactFieldValueIsDenied(denials, "phone", p.phone))
          .map((p) => ({
            id: p.id,
            phone: p.phone,
            phoneNormalized: p.phoneNormalized,
            validFrom: p.validFrom,
            validTo: p.validTo,
          })),
        titles: (titlesBy.get(row.id) ?? [])
          .filter((t) => !contactFieldValueIsDenied(denials, "title", t.title))
          .map((t) => ({
            id: t.id,
            title: t.title,
            validFrom: t.validFrom,
            validTo: t.validTo,
          })),
      };
      return [row.id, summary] as const;
    }),
  );

  return unique.map((id) => byId.get(id)).filter(Boolean) as ContactRegistryPersonSummary[];
}

function profilePayload(person: ContactRegistryPersonSummary) {
  return {
    id: person.id,
    name: personDisplayName(person),
    aliases: person.nameAliases.slice(0, 6),
    mentions: person.sourceEmailCount,
    org: person.currentOrganizationName,
    titles: person.titles.map((t) => t.title).slice(0, 4),
    emails: person.emails.map((e) => e.email).slice(0, 6),
    domains: [
      ...new Set(
        person.emails
          .map((e) => e.email.split("@")[1]?.toLowerCase())
          .filter((d): d is string => Boolean(d)),
      ),
    ].slice(0, 6),
    phones: person.phones.map((p) => p.phone).slice(0, 3),
  };
}

async function loadCandidateEvidence(
  candidates: ContactRegistryPersonSummary[],
): Promise<{ dossiers: CandidateDossier[]; emailsSampled: number }> {
  if (candidates.length === 0) {
    return { dossiers: [], emailsSampled: 0 };
  }

  const idsByPerson = await collectCandidateEmailIdsByPersonIds(
    candidates.map((c) => c.id),
  );

  const selectedIds: string[] = [];
  const selectedByPerson = new Map<string, string[]>();
  for (const person of candidates) {
    const set = idsByPerson.get(person.id) ?? new Set<string>();
    const picked = [...set].slice(0, DUPLICATE_MERGE_PROPOSE_MAX_EMAILS);
    selectedByPerson.set(person.id, picked);
    selectedIds.push(...picked);
  }

  const uniqueEmailIds = [...new Set(selectedIds)];
  if (uniqueEmailIds.length === 0) {
    return {
      dossiers: candidates.map((person) => ({ person, evidence: [] })),
      emailsSampled: 0,
    };
  }

  const db = getDb();
  const rows = await db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      receivedAt: emails.receivedAt,
      bodyText: emails.bodyText,
      bodyHtml: emails.bodyHtml,
      bodyTextUnique: emails.bodyTextUnique,
      bodyTextStrictUnique: emails.bodyTextStrictUnique,
    })
    .from(emails)
    .where(inArray(emails.id, uniqueEmailIds))
    .orderBy(desc(emails.receivedAt));

  const authoredById = await resolveAuthoredBodiesForEvidence(rows);
  const rowById = new Map(rows.map((r) => [r.id, r]));

  let emailsSampled = 0;
  const dossiers: CandidateDossier[] = candidates.map((person) => {
    const evidence: EvidenceExcerpt[] = [];
    for (const emailId of selectedByPerson.get(person.id) ?? []) {
      const row = rowById.get(emailId);
      if (!row) continue;
      const authored = authoredById.get(row.id) ?? row.bodyText;
      evidence.push({
        subject: row.subject,
        from: row.fromAddress,
        at: row.receivedAt.slice(0, 10),
        excerpt: truncateAroundNeedle(
          authored,
          person.firstName,
          DUPLICATE_MERGE_PROPOSE_MAX_BODY_CHARS,
        ),
      });
      emailsSampled += 1;
    }
    return { person, evidence };
  });

  return { dossiers, emailsSampled };
}

export function buildDuplicateMergeProposeSystemPrompt(): string {
  return `You propose merges of sparse contact stubs into known full-name people in a condo-building contact registry.

${buildContactHighlightDomainContext()}

You receive:
1) ANCHORS — full-name people (profiles only). No email bodies for anchors.
2) CANDIDATES — stubs with a few short evidence excerpts.

Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "buckets": [
    {
      "targetPersonId": string,
      "synopsis": string,
      "sourcePersonIds": string[],
      "confidence": "high" | "medium" | "low"
    }
  ],
  "unresolved": [
    {
      "personId": string,
      "reason": string
    }
  ]
}

Rules:
- Every candidate id MUST appear exactly once: in one bucket's sourcePersonIds, or in unresolved.
- targetPersonId MUST be an ANCHOR id. Never invent people. Never merge candidate→candidate.
- synopsis: ≤2 short sentences for a reviewer (role/company + why these stubs match).
- unresolved.reason: ≤12 words. Prefer unresolved over weak guesses.
- Use titles, orgs, domains, and excerpts to disambiguate same given names.
- Weak surnames (e.g. "John W.") may merge into a matching full surname when context supports it.
- Keep JSON compact. Do not echo evidence text back into the response.`;
}

export function buildDuplicateMergeProposeUserPrompt(params: {
  anchors: ContactRegistryPersonSummary[];
  dossiers: CandidateDossier[];
}): string {
  const payload = {
    anchors: params.anchors.map(profilePayload),
    candidates: params.dossiers.map(({ person, evidence }) => ({
      ...profilePayload(person),
      role: classifyDuplicateMergeRole(person),
      evidence,
    })),
  };

  return `ANCHORS + CANDIDATES (compact JSON). Propose buckets + unresolved.

${JSON.stringify(payload)}

Return JSON only.`;
}

function parseConfidence(raw: unknown): "high" | "medium" | "low" {
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "medium";
}

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/** Remove trailing commas before } or ] (common model slip). */
function stripTrailingCommas(text: string): string {
  return text.replace(/,\s*([\]}])/g, "$1");
}

/**
 * Extract the first top-level `{...}` with string/escape awareness.
 * Returns null when braces never balance (truncated output).
 */
export function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Best-effort close of truncated `{...` JSON for buckets/unresolved payloads. */
function tryCloseTruncatedJson(text: string): string[] {
  const variants: string[] = [];
  let base = stripTrailingCommas(text.trim());
  // Drop a dangling incomplete string / key at the end.
  base = base.replace(/,\s*"[^"]*$/u, "");
  base = base.replace(/,\s*$/u, "");
  const closers = [
    "}",
    "]}",
    "]}]",
    '"}]}',
    "}}",
    "]}}",
    "]}]}",
    '"}]}]}',
  ];
  for (const closer of closers) {
    variants.push(base + closer);
  }
  return variants;
}

export function parseJsonLenient(text: string): unknown | null {
  const cleaned = stripMarkdownFences(text);
  const attempts: string[] = [cleaned];
  const balanced = extractBalancedJsonObject(cleaned);
  if (balanced) attempts.push(balanced);
  // Truncated: try closing from the raw cleaned text and from last `{`.
  const fromBrace = cleaned.slice(cleaned.indexOf("{"));
  if (fromBrace.startsWith("{")) {
    attempts.push(...tryCloseTruncatedJson(fromBrace));
  }

  for (const raw of attempts) {
    const candidate = stripTrailingCommas(raw);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }
  return null;
}

function allParseFallback(
  unresolved: DuplicateMergeProposeUnresolved[],
  expectedCount: number,
): boolean {
  if (expectedCount === 0) return false;
  if (unresolved.length !== expectedCount) return false;
  return unresolved.every(
    (u) =>
      u.reason === "parse_fallback" ||
      u.reason === DUPLICATE_MERGE_PARSE_FALLBACK_REASON,
  );
}

function parseFallbackUnresolved(
  expectedCandidateIds: string[],
): DuplicateMergeProposeUnresolved[] {
  return expectedCandidateIds.map((personId) => ({
    personId,
    reason: DUPLICATE_MERGE_PARSE_FALLBACK_REASON,
  }));
}

function parseProposeResponse(
  text: string,
  expectedCandidateIds: string[],
  anchorById: Map<string, ContactRegistryPersonSummary>,
): {
  buckets: DuplicateMergeProposeBucket[];
  unresolved: DuplicateMergeProposeUnresolved[];
  parseOk: boolean;
} {
  const expected = new Set(expectedCandidateIds);
  const parsed = parseJsonLenient(text);

  if (!parsed || typeof parsed !== "object") {
    console.warn(
      "[duplicate-merge-propose] JSON parse failed; preview:",
      text.slice(0, 400),
    );
    return {
      buckets: [],
      unresolved: parseFallbackUnresolved(expectedCandidateIds),
      parseOk: false,
    };
  }

  const obj = parsed as {
    buckets?: unknown;
    unresolved?: unknown;
  };

  // Accept empty arrays as a valid (if unhelpful) parse.
  if (!Array.isArray(obj.buckets) && !Array.isArray(obj.unresolved)) {
    console.warn(
      "[duplicate-merge-propose] JSON missing buckets/unresolved; preview:",
      text.slice(0, 400),
    );
    return {
      buckets: [],
      unresolved: parseFallbackUnresolved(expectedCandidateIds),
      parseOk: false,
    };
  }

  const assigned = new Set<string>();
  const buckets: DuplicateMergeProposeBucket[] = [];

  if (Array.isArray(obj.buckets)) {
    for (const item of obj.buckets) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const targetPersonId =
        typeof row.targetPersonId === "string"
          ? row.targetPersonId.trim()
          : "";
      const anchor = anchorById.get(targetPersonId);
      if (!anchor) continue;
      const sourcePersonIds = Array.isArray(row.sourcePersonIds)
        ? row.sourcePersonIds
            .filter((id): id is string => typeof id === "string")
            .map((id) => id.trim())
            .filter((id) => expected.has(id) && !assigned.has(id))
        : [];
      if (sourcePersonIds.length === 0) continue;
      for (const id of sourcePersonIds) assigned.add(id);
      buckets.push({
        targetPersonId,
        targetDisplayName: personDisplayName(anchor),
        synopsis:
          typeof row.synopsis === "string" && row.synopsis.trim()
            ? row.synopsis.trim()
            : `Merge into ${personDisplayName(anchor)}.`,
        sourcePersonIds,
        confidence: parseConfidence(row.confidence),
      });
    }
  }

  const unresolved: DuplicateMergeProposeUnresolved[] = [];
  if (Array.isArray(obj.unresolved)) {
    for (const item of obj.unresolved) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const personId =
        typeof row.personId === "string" ? row.personId.trim() : "";
      if (!personId || !expected.has(personId) || assigned.has(personId)) {
        continue;
      }
      assigned.add(personId);
      unresolved.push({
        personId,
        reason:
          typeof row.reason === "string" && row.reason.trim()
            ? row.reason.trim()
            : "Insufficient context to choose an anchor.",
      });
    }
  }

  for (const personId of expectedCandidateIds) {
    if (assigned.has(personId)) continue;
    unresolved.push({
      personId,
      reason: "Not assigned in model response.",
    });
  }

  return { buckets, unresolved, parseOk: true };
}

function mergeBatchResults(
  batches: Array<{
    buckets: DuplicateMergeProposeBucket[];
    unresolved: DuplicateMergeProposeUnresolved[];
  }>,
): {
  buckets: DuplicateMergeProposeBucket[];
  unresolved: DuplicateMergeProposeUnresolved[];
} {
  const bucketByTarget = new Map<string, DuplicateMergeProposeBucket>();
  const unresolvedById = new Map<string, DuplicateMergeProposeUnresolved>();

  for (const batch of batches) {
    for (const bucket of batch.buckets) {
      const existing = bucketByTarget.get(bucket.targetPersonId);
      if (!existing) {
        bucketByTarget.set(bucket.targetPersonId, {
          ...bucket,
          sourcePersonIds: [...bucket.sourcePersonIds],
        });
        continue;
      }
      const ids = new Set([
        ...existing.sourcePersonIds,
        ...bucket.sourcePersonIds,
      ]);
      existing.sourcePersonIds = [...ids];
      // Keep the longer synopsis; prefer higher confidence.
      if (bucket.synopsis.length > existing.synopsis.length) {
        existing.synopsis = bucket.synopsis;
      }
      const rank = { high: 3, medium: 2, low: 1 } as const;
      if (rank[bucket.confidence] > rank[existing.confidence]) {
        existing.confidence = bucket.confidence;
      }
    }
    for (const item of batch.unresolved) {
      if (!unresolvedById.has(item.personId)) {
        unresolvedById.set(item.personId, item);
      }
    }
  }

  // A person merged into a bucket should not remain unresolved.
  for (const bucket of bucketByTarget.values()) {
    for (const id of bucket.sourcePersonIds) {
      unresolvedById.delete(id);
    }
  }

  return {
    buckets: [...bucketByTarget.values()],
    unresolved: [...unresolvedById.values()],
  };
}

async function callProposeModel(params: {
  systemInstruction: string;
  userText: string;
  modelId?: string | null;
}): Promise<{
  text: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  costUsd: number;
  modelName: string;
}> {
  const resolvedModel = resolveContactHighlightModel(params.modelId);
  const meta = getContactHighlightModelMeta(resolvedModel);
  const passConfig = getContactHighlightPassConfig(resolvedModel, 4);
  const maxOutputTokens = Math.max(
    passConfig.maxOutputTokens,
    DUPLICATE_MERGE_PROPOSE_MAX_OUTPUT_TOKENS,
  );

  if (meta.provider === "deepseek") {
    const result = await generateDeepSeekJson({
      systemInstruction: params.systemInstruction,
      userText: params.userText,
      modelName: passConfig.apiModelName,
      thinking: passConfig.thinking,
      maxOutputTokens,
    });
    return {
      text: result.text,
      usage: result.usage,
      costUsd: estimateCostUsd(result.modelName, result.usage),
      modelName: result.modelName,
    };
  }

  const result = await generateEmailExtraction({
    systemInstruction: params.systemInstruction,
    userText: params.userText,
    modelName: passConfig.apiModelName,
    maxOutputTokens,
    step: "duplicate_merge_propose",
  });
  return {
    text: result.text,
    usage: result.usage,
    costUsd: estimateCostUsd(result.modelName, result.usage),
    modelName: result.modelName,
  };
}

async function runProposeBatch(params: {
  anchors: ContactRegistryPersonSummary[];
  dossiers: CandidateDossier[];
  modelId?: string | null;
  /** Depth of split-retries after parse failure. */
  splitDepth?: number;
}): Promise<{
  buckets: DuplicateMergeProposeBucket[];
  unresolved: DuplicateMergeProposeUnresolved[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  costUsd: number;
  modelName: string;
}> {
  const resolvedModel = resolveContactHighlightModel(params.modelId);
  const passConfig = getContactHighlightPassConfig(resolvedModel, 4);
  const expected = params.dossiers.map((d) => d.person.id);
  const anchorById = new Map(params.anchors.map((a) => [a.id, a]));
  const splitDepth = params.splitDepth ?? 0;

  if (params.dossiers.length === 0) {
    return {
      buckets: [],
      unresolved: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costUsd: 0,
      modelName: passConfig.apiModelName,
    };
  }

  const systemInstruction = buildDuplicateMergeProposeSystemPrompt();
  const userText = buildDuplicateMergeProposeUserPrompt({
    anchors: params.anchors,
    dossiers: params.dossiers,
  });

  const modelResult = await callProposeModel({
    systemInstruction,
    userText,
    modelId: params.modelId,
  });

  const parsed = parseProposeResponse(
    modelResult.text,
    expected,
    anchorById,
  );

  // Truncated / unreadable JSON: split the batch and retry (once per half).
  if (
    !parsed.parseOk &&
    allParseFallback(parsed.unresolved, expected.length) &&
    params.dossiers.length > 1 &&
    splitDepth < 2
  ) {
    const mid = Math.ceil(params.dossiers.length / 2);
    const left = await runProposeBatch({
      anchors: params.anchors,
      dossiers: params.dossiers.slice(0, mid),
      modelId: params.modelId,
      splitDepth: splitDepth + 1,
    });
    const right = await runProposeBatch({
      anchors: params.anchors,
      dossiers: params.dossiers.slice(mid),
      modelId: params.modelId,
      splitDepth: splitDepth + 1,
    });
    const merged = mergeBatchResults([left, right]);
    return {
      ...merged,
      usage: {
        inputTokens:
          modelResult.usage.inputTokens +
          left.usage.inputTokens +
          right.usage.inputTokens,
        outputTokens:
          modelResult.usage.outputTokens +
          left.usage.outputTokens +
          right.usage.outputTokens,
        totalTokens:
          modelResult.usage.totalTokens +
          left.usage.totalTokens +
          right.usage.totalTokens,
      },
      costUsd: modelResult.costUsd + left.costUsd + right.costUsd,
      modelName: right.modelName || left.modelName || modelResult.modelName,
    };
  }

  // Single-item still failed: one compact retry.
  if (
    !parsed.parseOk &&
    allParseFallback(parsed.unresolved, expected.length) &&
    params.dossiers.length === 1 &&
    splitDepth < 3
  ) {
    const retryUser = `${userText}

Previous reply was not valid JSON. Reply again with ONLY compact JSON matching the schema. Short unresolved.reason (≤12 words).`;
    const retry = await callProposeModel({
      systemInstruction,
      userText: retryUser,
      modelId: params.modelId,
    });
    const retryParsed = parseProposeResponse(
      retry.text,
      expected,
      anchorById,
    );
    return {
      buckets: retryParsed.buckets,
      unresolved: retryParsed.unresolved,
      usage: {
        inputTokens:
          modelResult.usage.inputTokens + retry.usage.inputTokens,
        outputTokens:
          modelResult.usage.outputTokens + retry.usage.outputTokens,
        totalTokens:
          modelResult.usage.totalTokens + retry.usage.totalTokens,
      },
      costUsd: modelResult.costUsd + retry.costUsd,
      modelName: retry.modelName,
    };
  }

  return {
    buckets: parsed.buckets,
    unresolved: parsed.unresolved,
    usage: modelResult.usage,
    costUsd: modelResult.costUsd,
    modelName: modelResult.modelName,
  };
}

export type ProposeDuplicateMergesParams = {
  memberIds: string[];
  modelId?: string | null;
};

export type ProposeDuplicateMergesOutcome =
  | { ok: true; result: DuplicateMergeProposeResult }
  | { ok: false; error: string };

export async function proposeDuplicateMerges(
  params: ProposeDuplicateMergesParams,
): Promise<ProposeDuplicateMergesOutcome> {
  const memberIds = Array.isArray(params.memberIds)
    ? params.memberIds.filter((id) => typeof id === "string" && id.trim())
    : [];
  if (memberIds.length < 2) {
    return {
      ok: false,
      error: "Select a duplicate group with at least two contacts.",
    };
  }

  const persons = await loadPersonsByIds(memberIds);
  if (persons.length < 2) {
    return { ok: false, error: "Could not load the selected contacts." };
  }

  const anchors = persons.filter(
    (p) => classifyDuplicateMergeRole(p) === "anchor",
  );
  const candidates = persons.filter(
    (p) => classifyDuplicateMergeRole(p) === "candidate",
  );

  if (anchors.length === 0) {
    return {
      ok: false,
      error:
        "No full-name anchors in this group. AI suggestions need at least one person with a real last name to merge into.",
    };
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      error:
        "No stub candidates in this group (first-name only, nameless, or weak surname).",
    };
  }

  const { dossiers, emailsSampled } = await loadCandidateEvidence(candidates);

  const batches: CandidateDossier[][] = [];
  for (
    let i = 0;
    i < dossiers.length;
    i += DUPLICATE_MERGE_PROPOSE_BATCH_SIZE
  ) {
    batches.push(dossiers.slice(i, i + DUPLICATE_MERGE_PROPOSE_BATCH_SIZE));
  }

  const batchResults: Array<{
    buckets: DuplicateMergeProposeBucket[];
    unresolved: DuplicateMergeProposeUnresolved[];
  }> = [];
  let totalCost = 0;
  let modelName = "";

  for (const batch of batches) {
    const result = await runProposeBatch({
      anchors,
      dossiers: batch,
      modelId: params.modelId,
    });
    batchResults.push({
      buckets: result.buckets,
      unresolved: result.unresolved,
    });
    totalCost += result.costUsd;
    modelName = result.modelName || modelName;
  }

  const merged = mergeBatchResults(batchResults);
  const meta: DuplicateMergeProposeMeta = {
    modelName:
      modelName ||
      getContactHighlightPassConfig(
        resolveContactHighlightModel(params.modelId),
        4,
      ).apiModelName,
    costUsd: totalCost,
    anchorCount: anchors.length,
    candidateCount: candidates.length,
    emailsSampled,
    batchCount: batches.length,
  };

  return {
    ok: true,
    result: {
      buckets: merged.buckets,
      unresolved: merged.unresolved,
      meta,
    },
  };
}
