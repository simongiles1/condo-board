/** AI adjudication for ambiguous person↔org affiliation candidates (hints only). */

import { eq, inArray } from "drizzle-orm";

import { serializeAffiliationEvidence } from "@/lib/affiliations/shared";
import { loadPendingAffiliationsForPerson } from "@/lib/affiliations/propose";
import { getDb } from "@/lib/db";
import {
  contactPersons,
  organizationEntities,
  personOrganizationAffiliations,
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
import { personDisplayName } from "@/lib/contacts/registry-shared";

export type AffiliationAdjudicationAction =
  | "link"
  | "keep_unlinked"
  | "needs_review";

export type AffiliationAdjudicationDecision = {
  personId: string;
  action: AffiliationAdjudicationAction;
  organizationId: string | null;
  reason: string | null;
};

function buildSystemPrompt(): string {
  return `You adjudicate ambiguous person↔organization affiliation proposals for a condo-building contact registry.

${buildContactHighlightDomainContext()}

Return ONLY valid JSON with this exact shape:
{
  "decisions": [
    {
      "personId": string,
      "action": "link" | "keep_unlinked" | "needs_review",
      "organizationId": string | null,
      "reason": string | null
    }
  ]
}

Actions:
- link: pick exactly one candidate organizationId that this person works for / represents. Use when evidence is clear (matching corporate domain, signature co-occurrence with one firm).
- keep_unlinked: none of the candidates are a credible employer/affiliation for this person.
- needs_review: evidence is mixed or insufficient; leave for a human.

Hard rules:
- Fuzzy / prior scores in the input are HINTS ONLY — do not treat them as proof.
- Prefer corporate email domain matches over company_name co-occurrence alone.
- Board members and owners on personal email (gmail, etc.) often have NO vendor affiliation — prefer keep_unlinked or needs_review over guessing.
- Do not invent organization ids. organizationId must be one of the listed candidates when action is link; null otherwise.
- Every personId in the request MUST appear exactly once in decisions.
- This does NOT auto-apply links — your output only annotates pending proposals for human review.`;
}

function buildUserPrompt(
  items: Array<{
    personId: string;
    displayName: string;
    emails: string[];
    candidates: Array<{
      affiliationId: string;
      organizationId: string;
      organizationName: string | null;
      organizationEmail: string | null;
      organizationWebsite: string | null;
      source: string;
      confidence: string;
      evidence: unknown;
    }>;
  }>,
): string {
  return `AMBIGUOUS AFFILIATION CANDIDATES (scores/sources are hints only)

\`\`\`json
${JSON.stringify(items, null, 2)}
\`\`\`

Return decisions JSON for every personId.`;
}

function parseDecisions(
  text: string,
  expectedPersonIds: string[],
  allowedOrgIdsByPerson: Map<string, Set<string>>,
): AffiliationAdjudicationDecision[] {
  const expected = new Set(expectedPersonIds);
  let parsed: unknown;
  const trimmed = text.trim();
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return expectedPersonIds.map((personId) => ({
        personId,
        action: "needs_review" as const,
        organizationId: null,
        reason: "Parse failure",
      }));
    }
    try {
      parsed = JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return expectedPersonIds.map((personId) => ({
        personId,
        action: "needs_review" as const,
        organizationId: null,
        reason: "Parse failure",
      }));
    }
  }

  const list = Array.isArray((parsed as { decisions?: unknown }).decisions)
    ? ((parsed as { decisions: unknown[] }).decisions)
    : [];
  const byId = new Map<string, AffiliationAdjudicationDecision>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const personId =
      typeof obj.personId === "string" ? obj.personId.trim() : "";
    if (!personId || !expected.has(personId)) continue;
    const actionRaw = typeof obj.action === "string" ? obj.action.trim() : "";
    const action =
      actionRaw === "link" ||
      actionRaw === "keep_unlinked" ||
      actionRaw === "needs_review"
        ? actionRaw
        : "needs_review";
    let organizationId =
      typeof obj.organizationId === "string" && obj.organizationId.trim()
        ? obj.organizationId.trim()
        : null;
    const allowed = allowedOrgIdsByPerson.get(personId) ?? new Set();
    if (action === "link") {
      if (!organizationId || !allowed.has(organizationId)) {
        byId.set(personId, {
          personId,
          action: "needs_review",
          organizationId: null,
          reason: "Invalid organizationId for link",
        });
        continue;
      }
    } else {
      organizationId = null;
    }
    byId.set(personId, {
      personId,
      action,
      organizationId,
      reason:
        typeof obj.reason === "string" && obj.reason.trim()
          ? obj.reason.trim()
          : null,
    });
  }

  return expectedPersonIds.map(
    (personId) =>
      byId.get(personId) ?? {
        personId,
        action: "needs_review" as const,
        organizationId: null,
        reason: null,
      },
  );
}

/**
 * Annotate pending affiliations with AI choices. Never changes status to
 * approved — only updates evidence_json + source=ai_adjudicated for the
 * preferred candidate (others stay pending for human deny).
 */
export async function adjudicateAmbiguousAffiliations(params: {
  personIds: string[];
  modelId?: string | null;
}): Promise<{
  decided: number;
  decisions: AffiliationAdjudicationDecision[];
  costUsd: number | null;
}> {
  const personIds = [...new Set(params.personIds.filter(Boolean))];
  if (personIds.length === 0) {
    return { decided: 0, decisions: [], costUsd: null };
  }

  const db = getDb();
  const persons = await db
    .select()
    .from(contactPersons)
    .where(inArray(contactPersons.id, personIds));

  const items: Array<{
    personId: string;
    displayName: string;
    emails: string[];
    candidates: Array<{
      affiliationId: string;
      organizationId: string;
      organizationName: string | null;
      organizationEmail: string | null;
      organizationWebsite: string | null;
      source: string;
      confidence: string;
      evidence: unknown;
    }>;
  }> = [];
  const allowedOrgIdsByPerson = new Map<string, Set<string>>();

  for (const person of persons) {
    const pending = await loadPendingAffiliationsForPerson(person.id);
    if (pending.length === 0) continue;
    const orgIds = pending.map((p) => p.organizationId);
    const orgs =
      orgIds.length === 0
        ? []
        : await db
            .select()
            .from(organizationEntities)
            .where(inArray(organizationEntities.id, orgIds));
    const orgById = new Map(orgs.map((o) => [o.id, o]));
    allowedOrgIdsByPerson.set(person.id, new Set(orgIds));
    items.push({
      personId: person.id,
      displayName: personDisplayName({
        firstName: person.firstName,
        lastName: person.lastName,
        emails: [],
      }),
      emails: [],
      candidates: pending.map((p) => {
        const org = orgById.get(p.organizationId);
        return {
          affiliationId: p.id,
          organizationId: p.organizationId,
          organizationName: org?.name ?? null,
          organizationEmail: org?.email ?? null,
          organizationWebsite: org?.website ?? null,
          source: p.source,
          confidence: p.confidence,
          evidence: p.evidence,
        };
      }),
    });
  }

  if (items.length === 0) {
    return { decided: 0, decisions: [], costUsd: null };
  }

  const modelId = resolveContactHighlightModel(params.modelId ?? null);
  const config = getContactHighlightPassConfig(modelId, 4);
  const meta = getContactHighlightModelMeta(modelId);
  const systemInstruction = buildSystemPrompt();
  const userText = buildUserPrompt(items);

  let text = "";
  let costUsd: number | null = null;

  if (meta.provider === "deepseek") {
    const result = await generateDeepSeekJson({
      systemInstruction,
      userText,
      modelName: config.apiModelName,
      thinking: config.thinking,
      maxOutputTokens: config.maxOutputTokens,
    });
    text = result.text;
    costUsd = estimateCostUsd(result.modelName, result.usage);
  } else {
    const result = await generateEmailExtraction({
      systemInstruction,
      userText,
      modelName: config.apiModelName,
      maxOutputTokens: config.maxOutputTokens,
      step: "affiliation_adjudicate",
    });
    text = result.text;
    costUsd = estimateCostUsd(result.modelName, result.usage);
  }

  const decisions = parseDecisions(
    text,
    items.map((i) => i.personId),
    allowedOrgIdsByPerson,
  );

  const nowIso = new Date().toISOString();
  let decided = 0;

  for (const decision of decisions) {
    const pending = await loadPendingAffiliationsForPerson(decision.personId);
    if (pending.length === 0) continue;

    if (decision.action === "link" && decision.organizationId) {
      for (const row of pending) {
        const isPreferred = row.organizationId === decision.organizationId;
        const evidence = {
          ...row.evidence,
          rationale: decision.reason ?? undefined,
          aiAction: decision.action,
          aiPreferred: isPreferred,
        };
        await db
          .update(personOrganizationAffiliations)
          .set({
            source: isPreferred ? "ai_adjudicated" : row.source,
            confidence: isPreferred ? "medium" : row.confidence,
            evidenceJson: serializeAffiliationEvidence(evidence),
            updatedAt: nowIso,
          })
          .where(eq(personOrganizationAffiliations.id, row.id));
      }
      decided += 1;
      continue;
    }

    // keep_unlinked / needs_review — annotate all pending with rationale.
    for (const row of pending) {
      const evidence = {
        ...row.evidence,
        rationale: decision.reason ?? undefined,
        aiAction: decision.action,
      };
      await db
        .update(personOrganizationAffiliations)
        .set({
          source:
            decision.action === "keep_unlinked"
              ? "ai_adjudicated"
              : row.source,
          evidenceJson: serializeAffiliationEvidence(evidence),
          updatedAt: nowIso,
        })
        .where(eq(personOrganizationAffiliations.id, row.id));
    }
    decided += 1;
  }

  return { decided, decisions, costUsd };
}
