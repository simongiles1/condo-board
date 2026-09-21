import { createHash } from "node:crypto";

/** Bump when evidence, resolution, investigation, validation, or assembly contracts change. */
export const MINUTES_PIPELINE_VERSION = "2026-09-evidence-v4";

export type EvidenceSource = {
  id: string;
  kind: "transcript" | "document" | "user";
  association: "direct" | "neighbor" | "related";
  text: string;
  sequence?: number;
};

/**
 * LLM evidence contract: fact resolution and investigation user prompts pass structured
 * `sources` only (see resolveAgendaFacts and investigateAgendaItems in service.ts).
 * `assembledContextText` is a flattened rendering of those same sources for humans and
 * legacy fallbacks; validation uses sources OR assembledContextText, never both
 * (buildValidationInput in service.ts).
 */
export type CanonicalAgendaEvidence = {
  itemNumber: string | null;
  sourceTranscriptRanges: Array<[number, number]>;
  sourceChunkIds: string[];
  aliases: string[];
  notes: string[];
  visibility?: string;
};

export type ResolvedFact = {
  field: string;
  /** Prior approval and current meeting decisions are separate facts, even for the same project. */
  scope: "package_proposal" | "prior_approval" | "current_decision" | "discussion";
  candidates: Array<{ value: string; sourceId: string; quote: string }>;
  selected: number | null;
  explanation: string;
};
export type FactResolution = { facts: ResolvedFact[]; unresolvedQuestions: string[] };

export function evidenceFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function stableAgendaId(meetingId: string, itemNumber: string, title: string): string {
  return createHash("sha256").update(`${meetingId}:${itemNumber || title.trim().toLowerCase()}`).digest("hex").slice(0, 32);
}

export function buildEvidenceSources(options: {
  ranges: Array<[number, number]>;
  segments: Array<{ sequence: number; text: string; startTimestamp: string; speakerLabel: string | null }>;
  documents: Array<{ chunkId: string; text: string }>;
  relatedSequences?: number[];
  onlyDirectTranscript?: boolean;
}): EvidenceSource[] {
  const direct = new Set(options.segments.filter(s => options.ranges.some(([a, b]) => s.sequence >= a && s.sequence <= b)).map(s => s.sequence));
  const related = new Set(options.onlyDirectTranscript ? [] : (options.relatedSequences ?? []));
  const transcript: EvidenceSource[] = options.segments
    .filter(s => direct.has(s.sequence) || (!options.onlyDirectTranscript && (direct.has(s.sequence - 1) || direct.has(s.sequence + 1) || related.has(s.sequence))))
    .sort((a, b) => a.sequence - b.sequence)
    .map(s => ({ id: `transcript:${s.sequence}`, kind: "transcript", sequence: s.sequence,
      association: direct.has(s.sequence) ? "direct" : related.has(s.sequence) ? "related" : "neighbor",
      text: `[${s.startTimestamp}] ${s.speakerLabel ?? "Speaker"}: ${s.text}` }));
  return [...transcript, ...options.documents.map(d => ({ id: `document:${d.chunkId}`, kind: "document" as const, association: "direct" as const, text: d.text }))];
}

const clean = (s: string) =>
  s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/(\d),\s+(\d)/g, "$1,$2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Alternate slices of a source body when the model quotes content without headers or cue prefixes. */
function sourceTextVariants(source: EvidenceSource): string[] {
  const variants = [source.text];
  if (source.kind === "transcript") {
    const spoken = source.text.replace(/^\[[^\]]+\]\s+[^:]+:\s*/u, "");
    if (spoken && spoken !== source.text) variants.push(spoken);
  }
  if (source.kind === "document") {
    const pageIdx = source.text.indexOf("PAGE ");
    if (pageIdx > 0) variants.push(source.text.slice(pageIdx));
    const headingIdx = source.text.indexOf("## ");
    if (headingIdx >= 0) variants.push(source.text.slice(headingIdx));
  }
  return variants;
}

function quoteSupportedBySource(source: EvidenceSource, quote: string): boolean {
  const q = clean(quote);
  if (q.length < 8) return false;
  for (const raw of sourceTextVariants(source)) {
    const s = clean(raw);
    if (s.includes(q)) return true;
    const compactQuote = q.replace(/[^a-z0-9]+/g, "");
    const compactSource = s.replace(/[^a-z0-9]+/g, "");
    if (compactQuote.length >= 12 && compactSource.includes(compactQuote)) return true;
  }
  return false;
}

const FACT_SCOPES = ["package_proposal", "prior_approval", "current_decision", "discussion"] as const;

function candidateIsVerifiable(
  candidate: ResolvedFact["candidates"][number],
  byId: Map<string, EvidenceSource>,
): boolean {
  const source = byId.get(candidate.sourceId);
  return Boolean(
    source &&
      typeof candidate.value === "string" &&
      candidate.value.trim() &&
      typeof candidate.quote === "string" &&
      quoteSupportedBySource(source, candidate.quote),
  );
}

function coerceSelectedIndex(selected: unknown, candidateCount: number): number | null | undefined {
  if (selected === null) return null;
  const numeric =
    typeof selected === "number"
      ? selected
      : typeof selected === "string" && /^-?\d+$/.test(selected.trim())
        ? Number(selected.trim())
        : NaN;
  if (!Number.isInteger(numeric)) return undefined;
  if (numeric < 0 || numeric >= candidateCount) return undefined;
  return numeric;
}

function coerceUnresolvedQuestions(raw: unknown, salvage: boolean): string[] {
  if (!Array.isArray(raw)) {
    if (salvage) return [];
    throw new Error("Fact resolution returned an invalid schema.");
  }
  const questions: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      questions.push(entry);
      continue;
    }
    if (
      salvage &&
      entry &&
      typeof entry === "object" &&
      typeof (entry as { question?: unknown }).question === "string"
    ) {
      questions.push((entry as { question: string }).question);
      continue;
    }
    if (!salvage) throw new Error("Fact resolution returned an invalid schema.");
  }
  return questions;
}

/** Validate shape and verbatim evidence links before a model's fact choices can be used. */
export function parseFactResolution(
  raw: unknown,
  sources: EvidenceSource[],
  options?: { salvageUnverifiable?: boolean },
): FactResolution {
  const salvage = Boolean(options?.salvageUnverifiable);
  const value = raw as Partial<FactResolution> | null;
  if (!value || !Array.isArray(value.facts)) {
    throw new Error("Fact resolution returned an invalid schema.");
  }
  const byId = new Map(sources.map(s => [s.id, s]));
  const unresolvedQuestions = coerceUnresolvedQuestions(value.unresolvedQuestions, salvage);
  const facts: ResolvedFact[] = [];
  for (const fact of value.facts) {
    const field = typeof fact?.field === "string" ? fact.field : "unknown field";
    const shapeOk = Boolean(
      fact &&
        typeof fact.field === "string" &&
        typeof fact.explanation === "string" &&
        FACT_SCOPES.includes(fact.scope as (typeof FACT_SCOPES)[number]) &&
        Array.isArray(fact.candidates) &&
        fact.candidates.length,
    );
    if (!shapeOk) {
      if (!salvage) throw new Error("Fact resolution contains an invalid fact or selection.");
      unresolvedQuestions.push(`Could not use a malformed fact record for ${field}.`);
      continue;
    }
    let originalSelected = coerceSelectedIndex(fact.selected ?? null, fact.candidates.length);
    if (originalSelected === undefined) {
      if (!salvage) throw new Error("Fact resolution contains an invalid fact or selection.");
      originalSelected = null;
      unresolvedQuestions.push(`Could not use the selected index for ${fact.field}.`);
    }
    const kept: ResolvedFact["candidates"] = [];
    const keptFromOriginal: number[] = [];
    fact.candidates.forEach((candidate, index) => {
      if (candidateIsVerifiable(candidate, byId)) {
        kept.push(candidate);
        keptFromOriginal.push(index);
        return;
      }
      if (!salvage) {
        throw new Error(`Fact ${fact.field} has a missing or unverifiable citation.`);
      }
    });
    if (!kept.length) {
      if (!salvage) {
        throw new Error(`Fact ${fact.field} has a missing or unverifiable citation.`);
      }
      unresolvedQuestions.push(`Could not verify a citation for ${fact.field}.`);
      continue;
    }
    let selected = originalSelected === null ? null : keptFromOriginal.indexOf(originalSelected);
    if (selected !== null && selected < 0) {
      selected = null;
      if (salvage) unresolvedQuestions.push(`Could not verify the selected citation for ${fact.field}.`);
    }
    if (selected !== null) {
      const selectedSource = byId.get(kept[selected].sourceId)!;
      const prefersMeetingEvidence =
        selectedSource.kind === "document" &&
        fact.scope !== "package_proposal" &&
        kept.some(c => ["transcript", "user"].includes(byId.get(c.sourceId)!.kind));
      const packageAsDecision = fact.scope === "current_decision" && selectedSource.kind === "document";
      if (prefersMeetingEvidence || packageAsDecision) {
        if (!salvage) {
          throw new Error(
            prefersMeetingEvidence
              ? `Fact ${fact.field} selects package evidence over meeting evidence.`
              : `Fact ${fact.field} treats a package proposal as a current decision.`,
          );
        }
        selected = null;
        unresolvedQuestions.push(
          prefersMeetingEvidence
            ? `Could not accept package evidence over meeting evidence for ${fact.field}.`
            : `Could not treat a package proposal as a current decision for ${fact.field}.`,
        );
      }
    }
    facts.push({
      field: fact.field,
      scope: fact.scope as ResolvedFact["scope"],
      candidates: kept,
      selected,
      explanation: fact.explanation,
    });
  }
  return { facts, unresolvedQuestions };
}

/** System instruction for resolving material facts from agenda evidence before minutes investigation. */
export const FACT_RESOLUTION_PROMPT = `Resolve the material facts for ONE agenda item before writing minutes. Return JSON only:
{"facts":[{"field":"contractor | amount | approval | date | motion | action | other descriptive field","scope":"package_proposal | prior_approval | current_decision | discussion","candidates":[{"value":"precise fact","sourceId":"provided source id","quote":"verbatim supporting passage"}],"selected":0,"explanation":"why this candidate is supported"}],"unresolvedQuestions":[]}
Read ALL direct transcript evidence, including later continuations. Package notes and recommendations are proposals, not meeting decisions. Preserve competing values as candidates, select transcript over package when they conflict, and distinguish approval at a previous meeting from any decision made today. Keep separate facts for package proposals, prior approvals and current directions. If no candidate can be selected responsibly, selected must be null and record the question. Never invent a mover, seconder, amount, vote, attendance or adjournment time.
Transcripts are generated by automated speech recognition (ASR) and often contain phonetic errors, homophones, or mishearings (e.g. "second dead" for "seconded", "past" for "passed", "cordial" for "corridor"). Interpret spoken statements using surrounding meeting and package context rather than treating transcription noise as genuine ambiguity or conflict. Verbatim quotes in candidate quote fields must still reproduce the exact transcript text as written.
When speakers use conversational shorthand for amounts or acronyms (for example a truncated spoken figure that matches one contractor's row in a package comparison table, or a spoken abbreviation for a contractor name), cross-reference that contractor's specific column and row to resolve the exact full figure (e.g. $163,900.00 rather than rounding to $163,000) instead of flagging false ambiguity. selected.value must be the professional resolved fact (legal name, dollar amount with cents). Do not put spoken shorthand, "spoken as …", ASR, or transcription-process language in selected.value or explanation; those fields feed published minutes.
If an agenda item is skipped, deferred, or was approved at an earlier meeting, the absence of a new decision or contract amount today is expected normal governance; do NOT emit an unresolved question for decisions not made today.
Informal board agreement or direction to management (e.g. instructing management to proceed with a review, obtain clarification, or send a draft to counsel) represents administrative direction; record it under "discussion" or "action" rather than flagging an unresolved question over the absence of a formal motion or vote.
Related and neighboring evidence can concern another agenda item; use it only when the association is supported. Cite source IDs and exact quotes: each quote must be a contiguous substring copied from that source's text in the request (same spelling and punctuation; package text may contain &amp; — quote it as stored or use the spoken line without the timestamp prefix for transcript sources). Use scope for package_proposal vs prior_approval; keep field to the topic (contractor, amount, approval), not the scope label. All material contractors, amounts, decisions, conditions and dates in the evidence must be addressed; an empty facts array is acceptable only for a procedural heading or no substantive evidence.`;

export type GateItem = { id: string; title: string };
export type InvestigationVersion = {
  id: string; agendaItemId: string; modelName?: string | null; usageJson?: string | null;
  discussionSummary: string; outcome: string; confidence: string; visibility: string;
  decisionsJson: string | null; motionJson: string | null; actionsJson: string | null;
  openQuestionsJson: string | null; userAnswersJson: string | null;
};
export function investigationFingerprint(row: InvestigationVersion): string {
  return evidenceFingerprint([row.discussionSummary, row.outcome, row.confidence, row.visibility,
    row.decisionsJson, row.motionJson, row.actionsJson, row.openQuestionsJson, row.userAnswersJson]);
}
export function draftReadiness(agenda: GateItem[], investigations: InvestigationVersion[],
  validations: Array<{ agendaItemId: string; severity: string; code: string; detailsJson?: string | null }>): string[] {
  const problems: string[] = [];
  if (!agenda.length) problems.push("No approved agenda items.");
  for (const item of agenda) {
    const results = investigations.filter(i => i.agendaItemId === item.id);
    if (results.length !== 1) { problems.push(`${item.title}: requires exactly one current investigation.`); continue; }
    const findings = validations.filter(v => v.agendaItemId === item.id);
    try {
      const usage = JSON.parse(results[0].usageJson ?? "{}");
      if (usage.pipelineVersion !== MINUTES_PIPELINE_VERSION || !usage.evidenceFingerprint) problems.push(`${item.title}: re-evaluate with the current pipeline.`);
    } catch { problems.push(`${item.title}: invalid investigation provenance.`); }
    const verdict = findings.find(v => v.code === "ai_verdict" || v.code === "item_not_discussed" || v.code === "structural_heading");
    if (!verdict) problems.push(`${item.title}: validation is incomplete.`);
    if (findings.some(v => v.severity === "error" || (v.code === "ai_verdict" && v.severity !== "info"))) {
      problems.push(`${item.title}: validation requires correction or review.`);
    }
    if (verdict?.detailsJson) {
      try {
        const details = JSON.parse(verdict.detailsJson);
        if (details.needsHumanReview === true) problems.push(`${item.title}: human review is required.`);
        if (details.pipelineVersion !== MINUTES_PIPELINE_VERSION || details.investigationId !== results[0].id ||
            details.investigationFingerprint !== investigationFingerprint(results[0])) problems.push(`${item.title}: validation is stale.`);
      }
      catch { problems.push(`${item.title}: invalid validation record.`); }
    } else if (verdict) problems.push(`${item.title}: validation provenance is missing.`);
  }
  return problems;
}
