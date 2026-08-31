/**
 * Client-safe types, prompts, and parsers for two-pass project identity review.
 */

import { buildProjectHighlightDomainContext } from "@/lib/email-analysis/project-highlight-shared";
import {
  canonicalizeProjectWorkName,
  type ProjectIdentityPolicyKind,
} from "@/lib/projects/identity-match";
import { normalizeProjectNameKey } from "@/lib/projects/project-multi-values";
import { normalizeProjectYearHint } from "@/lib/projects/project-year-range";

export const IDENTITY_REVIEW_CONFIDENCE = ["high", "medium", "low"] as const;
export type IdentityReviewConfidence =
  (typeof IDENTITY_REVIEW_CONFIDENCE)[number];

export const IDENTITY_REVIEW_DECISION_KINDS = [
  "single_span",
  "recurring_by_year",
  "keep_separate",
  "mixed",
] as const;
export type IdentityReviewDecisionKind =
  (typeof IDENTITY_REVIEW_DECISION_KINDS)[number];

export const IDENTITY_REVIEW_RUN_STATUSES = [
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type IdentityReviewRunStatus =
  (typeof IDENTITY_REVIEW_RUN_STATUSES)[number];

export const IDENTITY_REVIEW_DECISION_STATUSES = [
  "applied",
  "proposed",
  "skipped",
  "failed",
] as const;
export type IdentityReviewDecisionStatus =
  (typeof IDENTITY_REVIEW_DECISION_STATUSES)[number];

export type IdentityReviewRunRecord = {
  id: string;
  modelId: string;
  status: IdentityReviewRunStatus;
  currentPass: number | null;
  clusterTotal: number;
  clusterCompleted: number;
  projectCount: number;
  highApplied: number;
  proposedCount: number;
  totalCostUsd: number;
  lastError: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type IdentityReviewPass1Row = {
  id: string;
  name: string | null;
  aliases: string[];
  yearHint: string | null;
  phase: string | null;
  contractor: string | null;
  location: string | null;
  scope: string | null;
  sourceEmailCount: number;
};

export type IdentityReviewPass1Cluster = {
  label: string;
  memberIds: string[];
};

export type IdentityReviewSubgroup = {
  survivorId: string;
  absorbIds: string[];
  yearHint: string | null;
};

export type IdentityReviewPass2Decision = {
  kind: IdentityReviewDecisionKind;
  confidence: IdentityReviewConfidence;
  rationale: string;
  workLabel: string | null;
  subgroups: IdentityReviewSubgroup[];
};

export type IdentityReviewMemberSnapshot = {
  id: string;
  name: string | null;
  displayName: string;
  yearHint: string | null;
  sourceEmailCount: number;
  aliases: string[];
};

export type IdentityReviewMergePlan = {
  targetId: string;
  sourceIds: string[];
};

export type IdentityReviewPolicyDraft = {
  survivorKey: string;
  workLabel: string;
  policy: ProjectIdentityPolicyKind;
  aliases: string[];
  yearHint: string | null;
};

export type IdentityReviewApplyPlan = {
  apply: boolean;
  merges: IdentityReviewMergePlan[];
  policies: IdentityReviewPolicyDraft[];
  proposedGroups: Array<{
    label: string;
    memberIds: string[];
    rationale: string;
    confidence: IdentityReviewConfidence;
    decisionKind: IdentityReviewDecisionKind;
  }>;
};

export type IdentityReviewProposalForGroups = {
  decisionId: string;
  clusterLabel: string;
  memberIds: string[];
  decision: IdentityReviewPass2Decision;
};

export const IDENTITY_REVIEW_PASS1_MAX_OUTPUT_TOKENS = 65536;
export const IDENTITY_REVIEW_PASS2_MAX_OUTPUT_TOKENS = 8192;
export const IDENTITY_REVIEW_PASS2_MAX_CHARS = 300_000;

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseConfidence(raw: unknown): IdentityReviewConfidence {
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "medium";
}

function parseDecisionKind(raw: unknown): IdentityReviewDecisionKind | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "single_span" || key === "span" || key === "one_project") {
    return "single_span";
  }
  if (
    key === "recurring_by_year" ||
    key === "recurring_year" ||
    key === "yearly"
  ) {
    return "recurring_by_year";
  }
  if (key === "keep_separate" || key === "separate") return "keep_separate";
  if (key === "mixed") return "mixed";
  return null;
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

function stripTrailingCommas(text: string): string {
  return text.replace(/,\s*([\]}])/g, "$1");
}

/** First balanced `{...}` with string/escape awareness. */
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
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseJsonObjectText(text: string): unknown {
  const stripped = stripTrailingCommas(stripMarkdownFences(text));
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    const balanced = extractBalancedJsonObject(stripped);
    if (!balanced) throw new Error("Model response was not valid JSON.");
    return JSON.parse(stripTrailingCommas(balanced)) as unknown;
  }
}

/**
 * Pass 1: multi-member work-type clusters. Unknown ids dropped. An id that
 * appears in two clusters is kept in the first only.
 */
export function parseIdentityReviewPass1Clusters(
  raw: unknown,
  knownIds: ReadonlySet<string>,
): IdentityReviewPass1Cluster[] {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const rows = Array.isArray(obj?.clusters)
    ? obj.clusters
    : Array.isArray(raw)
      ? raw
      : [];
  const seen = new Set<string>();
  const clusters: IdentityReviewPass1Cluster[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const label =
      typeof record.label === "string" && record.label.trim()
        ? record.label.trim()
        : "Untitled work";
    const memberIds: string[] = [];
    for (const id of asStringArray(record.memberIds ?? record.member_ids)) {
      if (!knownIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      memberIds.push(id);
    }
    if (memberIds.length < 2) continue;
    clusters.push({ label, memberIds });
  }
  return clusters;
}

function parseSubgroups(
  raw: unknown,
  clusterMemberIds: ReadonlySet<string>,
): IdentityReviewSubgroup[] {
  if (!Array.isArray(raw)) return [];
  const out: IdentityReviewSubgroup[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const absorbIds = asStringArray(
      record.absorbIds ?? record.absorb_ids,
    ).filter((id) => clusterMemberIds.has(id));
    let survivorId =
      typeof record.survivorId === "string"
        ? record.survivorId.trim()
        : typeof record.survivor_id === "string"
          ? record.survivor_id.trim()
          : "";
    if (survivorId && !clusterMemberIds.has(survivorId)) survivorId = "";
    if (!survivorId) {
      const all = [
        ...new Set([
          ...asStringArray(record.memberIds ?? record.member_ids),
          ...absorbIds,
        ]),
      ].filter((id) => clusterMemberIds.has(id));
      survivorId = all[0] ?? "";
    }
    if (!survivorId) continue;
    const yearRaw =
      typeof record.yearHint === "string"
        ? record.yearHint
        : typeof record.year_hint === "string"
          ? record.year_hint
          : null;
    out.push({
      survivorId,
      absorbIds: absorbIds.filter((id) => id !== survivorId),
      yearHint: normalizeProjectYearHint(yearRaw),
    });
  }
  return out;
}

export function parseIdentityReviewPass2Decision(
  raw: unknown,
  clusterMemberIds: readonly string[],
): IdentityReviewPass2Decision {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind = parseDecisionKind(obj.kind) ?? "keep_separate";
  const memberSet = new Set(clusterMemberIds);
  const workLabel =
    typeof obj.workLabel === "string" && obj.workLabel.trim()
      ? obj.workLabel.trim()
      : typeof obj.work_label === "string" && obj.work_label.trim()
        ? obj.work_label.trim()
        : null;
  const rationale =
    typeof obj.rationale === "string" && obj.rationale.trim()
      ? obj.rationale.trim()
      : "";
  return {
    kind,
    confidence: parseConfidence(obj.confidence),
    rationale,
    workLabel,
    subgroups: parseSubgroups(obj.subgroups, memberSet),
  };
}

export function buildIdentityReviewPass1SystemPrompt(): string {
  return `You cluster building-project registry cards by TYPE OF WORK.

${buildProjectHighlightDomainContext()}

You receive every active project card (id, name, aliases, year, phase, contractor, location, scope, email count). Many cards are near-duplicate spellings of the same job (maglock installation vs maglock system vs Mag Locks for Building Security). Some cards are the same KIND of work in different years (kitchen stack cleaning 2024 vs 2025).

Return ONLY valid JSON:
{
  "clusters": [
    { "label": string, "memberIds": string[] }
  ]
}

Rules:
- Emit ONLY clusters with 2 or more memberIds. Singletons are implied — do not list them.
- Group by type of work even when years differ. MagLock / maglock system / Stair F / "(2025)" tags belong together. All kitchen-stack cleaning years belong together. Window cleaning is a different cluster from kitchen stack and from garage cleaning.
- Do NOT decide whether a cluster is one spanning project or yearly campaigns. That is a later pass with email text.
- label: a short canonical work name (e.g. "Maglock", "Kitchen stack cleaning"), not a vendor.
- memberIds must be ids from the input. Never invent ids.
- Keep distinct work types apart even if they share a generic word (cleaning, replacement, repair).
- Output compact JSON. No markdown fences.`;
}

export function buildIdentityReviewPass1UserPrompt(
  rows: IdentityReviewPass1Row[],
): string {
  return `PROJECT CARDS
${JSON.stringify(rows)}

Return clusters JSON only.`;
}

export function buildIdentityReviewPass2SystemPrompt(): string {
  return `You decide whether clustered building-project cards are ONE spanning job, YEARLY campaigns, or actually separate.

${buildProjectHighlightDomainContext()}

You receive:
1) Member cards for one work-type cluster (names, years, phases, contractors, locations, email counts)
2) Authored email excerpts already attributed to those cards (subject, date, from, body)

Return ONLY valid JSON:
{
  "kind": "single_span" | "recurring_by_year" | "keep_separate" | "mixed",
  "confidence": "high" | "medium" | "low",
  "rationale": string,
  "workLabel": string,
  "subgroups": [
    { "survivorId": string, "absorbIds": string[], "yearHint": string | null }
  ]
}

Rules:
- single_span: one capital/improvement/remediation initiative that emails discuss as the same job across years (MagLock / maglock system / Stair F / 2025 tags). Merge ALL members into one survivor. subgroups may be omitted (one group is implied).
- recurring_by_year: a campaign that repeats (kitchen stack cleaning, window cleaning, garage cleaning, annual meeting). Merge spelling variants INSIDE a year; keep different years as separate projects. One subgroup per year.
- keep_separate: the cluster was a false grouping; do not merge.
- mixed: some members are one job, others are not. Emit subgroups only for the sets that should merge.
- survivorId / absorbIds must be member ids from the input. Prefer the card with the most emails as survivor.
- yearHint: "2024" or "2024-2026" when kind is recurring_by_year or when a spanning job has a known range.
- confidence high only when the emails make the decision clear. Use medium/low when thin or conflicting.
- rationale: ≤2 short sentences for a reviewer.
- Examples: MagLock variants → single_span. Kitchen stack 2024 vs 2025 vs 2026 → recurring_by_year (merge spellings inside each year).
- Output compact JSON. No markdown fences.`;
}

export function buildIdentityReviewPass2UserPrompt(params: {
  label: string;
  members: IdentityReviewPass1Row[];
  emails: Array<{
    projectIds: string[];
    subject: string;
    from: string;
    at: string;
    excerpt: string;
  }>;
}): string {
  return `WORK-TYPE CLUSTER: ${params.label}

MEMBERS
${JSON.stringify(params.members)}

EMAILS
${JSON.stringify(params.emails)}

Return the decision JSON only.`;
}

function pickSurvivor(members: IdentityReviewMemberSnapshot[]): string {
  const ranked = [...members].sort((a, b) => {
    if (b.sourceEmailCount !== a.sourceEmailCount) {
      return b.sourceEmailCount - a.sourceEmailCount;
    }
    return (b.displayName.length || 0) - (a.displayName.length || 0);
  });
  return ranked[0]!.id;
}

function collectAliases(
  members: IdentityReviewMemberSnapshot[],
  workLabel: string,
): string[] {
  const labelKey = normalizeProjectNameKey(workLabel);
  const seen = new Set<string>(labelKey ? [labelKey] : []);
  const aliases: string[] = [];
  for (const member of members) {
    for (const raw of [member.name, member.displayName, ...member.aliases]) {
      const trimmed = raw?.trim();
      if (!trimmed) continue;
      const key = normalizeProjectNameKey(trimmed);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      aliases.push(trimmed);
    }
  }
  return aliases;
}

function membersById(
  members: IdentityReviewMemberSnapshot[],
): Map<string, IdentityReviewMemberSnapshot> {
  return new Map(members.map((member) => [member.id, member]));
}

function filterToCluster(
  ids: string[],
  clusterIds: ReadonlySet<string>,
): string[] {
  return ids.filter((id) => clusterIds.has(id));
}

function synthesizeRecurringSubgroups(
  members: IdentityReviewMemberSnapshot[],
): IdentityReviewSubgroup[] {
  const buckets = new Map<string, IdentityReviewMemberSnapshot[]>();
  const yearless: IdentityReviewMemberSnapshot[] = [];
  for (const member of members) {
    const year = normalizeProjectYearHint(member.yearHint);
    if (!year) {
      yearless.push(member);
      continue;
    }
    const list = buckets.get(year) ?? [];
    list.push(member);
    buckets.set(year, list);
  }
  if (yearless.length > 0) {
    let bestYear: string | null = null;
    let bestCount = -1;
    for (const [year, list] of buckets) {
      const emails = list.reduce((sum, row) => sum + row.sourceEmailCount, 0);
      if (emails > bestCount) {
        bestCount = emails;
        bestYear = year;
      }
    }
    if (bestYear) {
      buckets.get(bestYear)!.push(...yearless);
    } else {
      buckets.set("_none", yearless);
    }
  }
  const subgroups: IdentityReviewSubgroup[] = [];
  for (const [year, list] of buckets) {
    if (list.length === 0) continue;
    const survivorId = pickSurvivor(list);
    subgroups.push({
      survivorId,
      absorbIds: list.map((row) => row.id).filter((id) => id !== survivorId),
      yearHint: year === "_none" ? null : year,
    });
  }
  return subgroups;
}

function resolveSubgroups(
  decision: IdentityReviewPass2Decision,
  members: IdentityReviewMemberSnapshot[],
  clusterIds: ReadonlySet<string>,
): IdentityReviewSubgroup[] {
  const byId = membersById(members);
  const cleaned = decision.subgroups
    .map((group) => {
      const survivorId = clusterIds.has(group.survivorId)
        ? group.survivorId
        : "";
      const absorbIds = filterToCluster(group.absorbIds, clusterIds).filter(
        (id) => id !== survivorId && byId.has(id),
      );
      if (!survivorId || !byId.has(survivorId)) return null;
      return {
        survivorId,
        absorbIds,
        yearHint:
          group.yearHint ??
          normalizeProjectYearHint(byId.get(survivorId)!.yearHint),
      };
    })
    .filter((group): group is IdentityReviewSubgroup => group != null);

  if (decision.kind === "keep_separate") return [];
  if (decision.kind === "single_span") {
    if (cleaned.length > 0) return cleaned;
    const survivorId = pickSurvivor(members);
    return [
      {
        survivorId,
        absorbIds: members.map((m) => m.id).filter((id) => id !== survivorId),
        yearHint: null,
      },
    ];
  }
  if (decision.kind === "recurring_by_year") {
    return cleaned.length > 0 ? cleaned : synthesizeRecurringSubgroups(members);
  }
  return cleaned;
}

function policyKindForDecision(
  kind: IdentityReviewDecisionKind,
): ProjectIdentityPolicyKind | null {
  if (kind === "single_span") return "span";
  if (kind === "recurring_by_year") return "recurring_year";
  return null;
}

/**
 * Turn a pass-2 decision into merges + identity policies.
 * High confidence is applied; medium/low become proposed duplicate groups.
 */
export function planIdentityReviewDecision(params: {
  clusterLabel: string;
  clusterMemberIds: string[];
  members: IdentityReviewMemberSnapshot[];
  decision: IdentityReviewPass2Decision;
}): IdentityReviewApplyPlan {
  const clusterIds = new Set(params.clusterMemberIds);
  const members = params.members.filter((member) => clusterIds.has(member.id));
  const workLabel =
    params.decision.workLabel?.trim() ||
    params.clusterLabel.trim() ||
    canonicalizeProjectWorkName(members[0]?.name) ||
    "Project";
  const subgroups = resolveSubgroups(params.decision, members, clusterIds);
  const apply = params.decision.confidence === "high";

  const merges: IdentityReviewMergePlan[] = [];
  const policies: IdentityReviewPolicyDraft[] = [];
  const proposedGroups: IdentityReviewApplyPlan["proposedGroups"] = [];

  if (params.decision.kind === "keep_separate" || subgroups.length === 0) {
    return { apply: false, merges, policies, proposedGroups };
  }

  const defaultPolicy = policyKindForDecision(params.decision.kind);

  for (const subgroup of subgroups) {
    const subgroupMembers = members.filter(
      (member) =>
        member.id === subgroup.survivorId ||
        subgroup.absorbIds.includes(member.id),
    );
    if (subgroupMembers.length === 0) continue;
    if (subgroup.absorbIds.length > 0) {
      merges.push({
        targetId: subgroup.survivorId,
        sourceIds: subgroup.absorbIds,
      });
    }
    const kind: ProjectIdentityPolicyKind =
      params.decision.kind === "mixed"
        ? subgroup.yearHint
          ? "recurring_year"
          : "span"
        : (defaultPolicy ?? "span");
    policies.push({
      survivorKey: subgroup.survivorId,
      workLabel,
      policy: kind,
      aliases: collectAliases(subgroupMembers, workLabel),
      yearHint: kind === "recurring_year" ? subgroup.yearHint : null,
    });
    if (!apply && subgroupMembers.length >= 2) {
      proposedGroups.push({
        label: workLabel,
        memberIds: subgroupMembers.map((m) => m.id),
        rationale: params.decision.rationale,
        confidence: params.decision.confidence,
        decisionKind: params.decision.kind,
      });
    }
  }

  if (
    !apply &&
    proposedGroups.length === 0 &&
    members.length >= 2 &&
    params.decision.kind === "single_span"
  ) {
    proposedGroups.push({
      label: workLabel,
      memberIds: members.map((m) => m.id),
      rationale: params.decision.rationale,
      confidence: params.decision.confidence,
      decisionKind: params.decision.kind,
    });
  }

  return { apply, merges, policies, proposedGroups };
}
