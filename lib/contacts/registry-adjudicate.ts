/** AI adjudication prompts + runner for contact registry merges. */

import { generateDeepSeekJson } from "@/lib/deepseek/client";
import {
  getContactHighlightModelMeta,
  getContactHighlightPassConfig,
  resolveContactHighlightModel,
} from "@/lib/email-analysis/contact-highlight-models";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { estimateCostUsd } from "@/lib/gemini/usage";
import { buildContactHighlightDomainContext } from "@/lib/email-analysis/contact-highlight-shared";
import type { ShortlistHit } from "@/lib/contacts/registry-shortlist";
import {
  type ContactAdjudicationDecision,
  type ContactMergeAction,
  type ContactRegistryIncomingCard,
  type ContactRegistryPersonSummary,
} from "@/lib/contacts/registry-shared";

const ACTIONS: ContactMergeAction[] = [
  "merge",
  "link_email",
  "keep_separate",
  "enrich",
];

export function buildContactRegistryAdjudicateSystemPrompt(): string {
  return `You adjudicate whether incoming contact fingerprint cards should merge into existing people in a condo-building contact registry.

${buildContactHighlightDomainContext()}

Return ONLY valid JSON with this exact shape:
{
  "decisions": [
    {
      "incomingTempId": string,
      "action": "merge" | "link_email" | "keep_separate" | "enrich",
      "targetPersonId": string | null,
      "email": string | null,
      "validFrom": string | null,
      "validTo": string | null,
      "reason": string | null
    }
  ]
}

Actions:
- merge: incoming and target are the SAME person. Union identity fields. Use when strong evidence matches (same personal email + compatible name, or same phone + compatible name, or same full name with no conflicting emails).
- link_email: DIFFERENT people who share/used the same mailbox (role addresses like studiopm@…, vacation coverage, succession). Do NOT merge people. Create/keep the incoming person separately and attach the shared email with occupancy dates. Set email, validFrom, validTo from evidence dates (prefer card dateMin/dateMax). Use validTo null ONLY when this person is the current occupant; otherwise set a concrete validTo so prior tenants are not "present".
- enrich: incoming is clearly the SAME as targetPersonId but you are only attaching a new phone/title/email without treating another listed candidate as a duplicate person. Prefer merge when a target is the same person.
- keep_separate: create/keep as its own person; no merge and no email link to another person.

Hard rules:
- NEVER merge two cards that only share a first name.
- NEVER merge people with different given names (Margot vs Atif vs Mehal vs Haider) or incompatible surnames (Kempton vs Khurshid vs Singh vs Mukadam), even when they share a role mailbox or job title. That MUST be link_email.
- Sparse first-name-only stubs must stay separate unless unique corroboration (email or phone) appears in the evidence.
- Shared / role mailboxes: same address ≠ same human. Prefer link_email with date ranges over merge when names differ across time.
- People may have multiple emails; that is merge/enrich, not a reason to invent a second person.
- Titles change over time — do not treat title mismatch alone as proof of different people.
- Do not invent names, emails, phones, or dates that are not in the input.
- Every incomingTempId in the request MUST appear exactly once in decisions.
- targetPersonId must be one of the candidate person ids when action is merge, link_email, or enrich; null for keep_separate.`;
}

export function buildContactRegistryAdjudicateUserPrompt(
  items: Array<{
    incoming: ContactRegistryIncomingCard;
    candidates: ShortlistHit[];
  }>,
): string {
  const payload = items.map(({ incoming, candidates }) => ({
    incoming: {
      tempId: incoming.tempId,
      first_name: incoming.first_name,
      last_name: incoming.last_name,
      email: incoming.email,
      phone: incoming.phone,
      job_title: incoming.job_title,
      dateMin: incoming.dateMin,
      dateMax: incoming.dateMax,
      mentionWeight: incoming.mentionWeight,
      sourceEmailIds: incoming.sourceEmailIds,
    },
    candidates: candidates.map((hit) => ({
      score: hit.score,
      person: {
        id: hit.person.id,
        firstName: hit.person.firstName,
        lastName: hit.person.lastName,
        mentionWeight: hit.person.mentionWeight,
        sparseStub: hit.person.sparseStub,
        emails: hit.person.emails.map((e) => ({
          email: e.email,
          validFrom: e.validFrom,
          validTo: e.validTo,
        })),
        phones: hit.person.phones.map((p) => ({
          phone: p.phone,
          validFrom: p.validFrom,
          validTo: p.validTo,
        })),
        titles: hit.person.titles.map((t) => ({
          title: t.title,
          validFrom: t.validFrom,
          validTo: t.validTo,
        })),
      },
    })),
  }));

  return `INCOMING CARDS WITH SHORTLISTED REGISTRY CANDIDATES (fuzzy scores are hints only)

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

Return decisions JSON for every incoming tempId.`;
}

function parseAction(raw: unknown): ContactMergeAction | null {
  if (typeof raw !== "string") return null;
  return (ACTIONS as string[]).includes(raw)
    ? (raw as ContactMergeAction)
    : null;
}

export function parseContactAdjudicationDecisions(
  text: string,
  expectedTempIds: string[],
): ContactAdjudicationDecision[] {
  const expected = new Set(expectedTempIds);
  let parsed: unknown;
  const trimmed = text.trim();
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return fallbackKeepSeparate(expectedTempIds);
    try {
      parsed = JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return fallbackKeepSeparate(expectedTempIds);
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return fallbackKeepSeparate(expectedTempIds);
  }
  const list = Array.isArray((parsed as { decisions?: unknown }).decisions)
    ? ((parsed as { decisions: unknown[] }).decisions)
    : [];

  const byId = new Map<string, ContactAdjudicationDecision>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const incomingTempId =
      typeof obj.incomingTempId === "string" ? obj.incomingTempId.trim() : "";
    if (!incomingTempId || !expected.has(incomingTempId)) continue;
    const action = parseAction(obj.action);
    if (!action) continue;
    byId.set(incomingTempId, {
      incomingTempId,
      action,
      targetPersonId:
        typeof obj.targetPersonId === "string" && obj.targetPersonId.trim()
          ? obj.targetPersonId.trim()
          : null,
      email:
        typeof obj.email === "string" && obj.email.trim()
          ? obj.email.trim()
          : null,
      validFrom:
        typeof obj.validFrom === "string" && obj.validFrom.trim()
          ? obj.validFrom.trim()
          : null,
      validTo:
        obj.validTo === null
          ? null
          : typeof obj.validTo === "string" && obj.validTo.trim()
            ? obj.validTo.trim()
            : null,
      reason:
        typeof obj.reason === "string" && obj.reason.trim()
          ? obj.reason.trim()
          : null,
    });
  }

  const out: ContactAdjudicationDecision[] = [];
  for (const id of expectedTempIds) {
    out.push(
      byId.get(id) ?? {
        incomingTempId: id,
        action: "keep_separate",
        targetPersonId: null,
        email: null,
        validFrom: null,
        validTo: null,
        reason: "fallback_keep_separate",
      },
    );
  }
  return out;
}

function fallbackKeepSeparate(
  expectedTempIds: string[],
): ContactAdjudicationDecision[] {
  return expectedTempIds.map((incomingTempId) => ({
    incomingTempId,
    action: "keep_separate" as const,
    targetPersonId: null,
    email: null,
    validFrom: null,
    validTo: null,
    reason: "parse_fallback",
  }));
}

export type AdjudicateBatchResult = {
  decisions: ContactAdjudicationDecision[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: number;
  modelName: string;
};

export async function adjudicateContactRegistryBatch(
  items: Array<{
    incoming: ContactRegistryIncomingCard;
    candidates: ShortlistHit[];
  }>,
  modelId?: string | null,
): Promise<AdjudicateBatchResult> {
  const resolvedModel = resolveContactHighlightModel(modelId);
  const expected = items.map((i) => i.incoming.tempId);

  if (items.length === 0) {
    return {
      decisions: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costUsd: 0,
      modelName: getContactHighlightPassConfig(resolvedModel, 4).apiModelName,
    };
  }

  // No candidates anywhere → keep separate without an LLM call.
  if (items.every((i) => i.candidates.length === 0)) {
    return {
      decisions: fallbackKeepSeparate(expected).map((d) => ({
        ...d,
        reason: "no_candidates",
      })),
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costUsd: 0,
      modelName: getContactHighlightPassConfig(resolvedModel, 4).apiModelName,
    };
  }

  const meta = getContactHighlightModelMeta(resolvedModel);
  const passConfig = getContactHighlightPassConfig(resolvedModel, 4);
  const systemInstruction = buildContactRegistryAdjudicateSystemPrompt();
  const userText = buildContactRegistryAdjudicateUserPrompt(items);

  let text = "";
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let modelName = passConfig.apiModelName;

  if (meta.provider === "deepseek") {
    const result = await generateDeepSeekJson({
      systemInstruction,
      userText,
      modelName: passConfig.apiModelName,
      thinking: passConfig.thinking,
      maxOutputTokens: passConfig.maxOutputTokens,
    });
    text = result.text;
    usage = result.usage;
    modelName = result.modelName;
  } else {
    const result = await generateEmailExtraction({
      systemInstruction,
      userText,
      modelName: passConfig.apiModelName,
      maxOutputTokens: passConfig.maxOutputTokens,
      step: "contact_registry_adjudicate",
    });
    text = result.text;
    usage = result.usage;
    modelName = result.modelName;
  }

  return {
    decisions: parseContactAdjudicationDecisions(text, expected),
    usage,
    costUsd: estimateCostUsd(modelName, usage),
    modelName,
  };
}

export type { ContactRegistryPersonSummary };
