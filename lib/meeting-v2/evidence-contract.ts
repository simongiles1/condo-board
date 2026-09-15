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
}): EvidenceSource[] {
  const direct = new Set(options.segments.filter(s => options.ranges.some(([a, b]) => s.sequence >= a && s.sequence <= b)).map(s => s.sequence));
  const related = new Set(options.relatedSequences ?? []);
  const transcript: EvidenceSource[] = options.segments
    .filter(s => direct.has(s.sequence) || direct.has(s.sequence - 1) || direct.has(s.sequence + 1) || related.has(s.sequence))
    .sort((a, b) => a.sequence - b.sequence)
    .map(s => ({ id: `transcript:${s.sequence}`, kind: "transcript", sequence: s.sequence,
      association: direct.has(s.sequence) ? "direct" : related.has(s.sequence) ? "related" : "neighbor",
      text: `[${s.startTimestamp}] ${s.speakerLabel ?? "Speaker"}: ${s.text}` }));
  return [...transcript, ...options.documents.map(d => ({ id: `document:${d.chunkId}`, kind: "document" as const, association: "direct" as const, text: d.text }))];
}

const clean = (s: string) =>
  s
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function quoteSupportedBySource(sourceText: string, quote: string): boolean {
  const q = clean(quote);
  const s = clean(sourceText);
  if (q.length < 8) return false;
  if (s.includes(q)) return true;
  const compactQuote = q.replace(/[^a-z0-9]+/g, "");
  const compactSource = s.replace(/[^a-z0-9]+/g, "");
  return compactQuote.length >= 12 && compactSource.includes(compactQuote);
}

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
      quoteSupportedBySource(source.text, candidate.quote),
  );
}

/** Validate shape and verbatim evidence links before a model's fact choices can be used. */
export function parseFactResolution(
  raw: unknown,
  sources: EvidenceSource[],
  options?: { salvageUnverifiable?: boolean },
): FactResolution {
  const value = raw as FactResolution;
  if (!value || !Array.isArray(value.facts) || !Array.isArray(value.unresolvedQuestions) ||
      !value.unresolvedQuestions.every(q => typeof q === "string")) throw new Error("Fact resolution returned an invalid schema.");
  const byId = new Map(sources.map(s => [s.id, s]));
  const salvage = Boolean(options?.salvageUnverifiable);
  const unresolvedQuestions = [...value.unresolvedQuestions];
  const facts: ResolvedFact[] = [];
  for (const fact of value.facts) {
    if (!fact || typeof fact.field !== "string" || typeof fact.explanation !== "string" ||
        !["package_proposal", "prior_approval", "current_decision", "discussion"].includes(fact.scope) ||
        !Array.isArray(fact.candidates) || !fact.candidates.length ||
        (fact.selected !== null && (!Number.isInteger(fact.selected) || fact.selected < 0 || fact.selected >= fact.candidates.length))) {
      throw new Error("Fact resolution contains an invalid fact or selection.");
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
    let selected =
      fact.selected === null ? null : keptFromOriginal.indexOf(fact.selected);
    if (selected !== null && selected < 0) {
      selected = null;
      if (salvage) unresolvedQuestions.push(`Could not verify the selected citation for ${fact.field}.`);
    }
    if (selected !== null) {
      const selectedSource = byId.get(kept[selected].sourceId)!;
      if (selectedSource.kind === "document" && fact.scope !== "package_proposal" &&
          kept.some(c => ["transcript", "user"].includes(byId.get(c.sourceId)!.kind))) {
        throw new Error(`Fact ${fact.field} selects package evidence over meeting evidence.`);
      }
      if (fact.scope === "current_decision" && selectedSource.kind === "document") {
        throw new Error(`Fact ${fact.field} treats a package proposal as a current decision.`);
      }
    }
    facts.push({
      field: fact.field,
      scope: fact.scope,
      candidates: kept,
      selected,
      explanation: fact.explanation,
    });
  }
  return { facts, unresolvedQuestions };
}

export const FACT_RESOLUTION_PROMPT = `Resolve the material facts for ONE agenda item before writing minutes. Return JSON only:
{"facts":[{"field":"contractor | amount | approval | date | motion | action | other descriptive field","scope":"package_proposal | prior_approval | current_decision | discussion","candidates":[{"value":"precise fact","sourceId":"provided source id","quote":"verbatim supporting passage"}],"selected":0,"explanation":"why this candidate is supported"}],"unresolvedQuestions":[]}
Read ALL direct transcript evidence, including later continuations. Package notes and recommendations are proposals, not meeting decisions. Preserve competing values as candidates, select transcript over package when they conflict, and distinguish approval at a previous meeting from any decision made today. Keep separate facts for package proposals, prior approvals and current directions. If no candidate can be selected responsibly, selected must be null and record the question. Never invent a mover, seconder, amount, vote, attendance or adjournment time. Preserve the precision of spoken amounts; do not silently expand an ambiguous number. Related and neighboring evidence can concern another agenda item; use it only when the association is supported. Cite source IDs and exact quotes. All material contractors, amounts, decisions, conditions and dates in the evidence must be addressed; an empty facts array is acceptable only for a procedural heading or no substantive evidence.`;

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
