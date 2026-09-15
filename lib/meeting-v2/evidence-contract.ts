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

const clean = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Validate shape and verbatim evidence links before a model's fact choices can be used. */
export function parseFactResolution(raw: unknown, sources: EvidenceSource[]): FactResolution {
  const value = raw as FactResolution;
  if (!value || !Array.isArray(value.facts) || !Array.isArray(value.unresolvedQuestions) ||
      !value.unresolvedQuestions.every(q => typeof q === "string")) throw new Error("Fact resolution returned an invalid schema.");
  const byId = new Map(sources.map(s => [s.id, s]));
  for (const fact of value.facts) {
    if (!fact || typeof fact.field !== "string" || typeof fact.explanation !== "string" ||
        !["package_proposal", "prior_approval", "current_decision", "discussion"].includes(fact.scope) ||
        !Array.isArray(fact.candidates) || !fact.candidates.length ||
        (fact.selected !== null && (!Number.isInteger(fact.selected) || fact.selected < 0 || fact.selected >= fact.candidates.length))) {
      throw new Error("Fact resolution contains an invalid fact or selection.");
    }
    for (const candidate of fact.candidates) {
      const source = byId.get(candidate.sourceId);
      if (!source || typeof candidate.value !== "string" || !candidate.value.trim() || typeof candidate.quote !== "string" ||
          clean(candidate.quote).length < 8 || !clean(source.text).includes(clean(candidate.quote))) {
        throw new Error(`Fact ${fact.field} has a missing or unverifiable citation.`);
      }
    }
    if (fact.selected !== null) {
      const selected = byId.get(fact.candidates[fact.selected].sourceId)!;
      if (selected.kind === "document" && fact.scope !== "package_proposal" &&
          fact.candidates.some(c => ["transcript", "user"].includes(byId.get(c.sourceId)!.kind))) {
        throw new Error(`Fact ${fact.field} selects package evidence over meeting evidence.`);
      }
      if (fact.scope === "current_decision" && selected.kind === "document") {
        throw new Error(`Fact ${fact.field} treats a package proposal as a current decision.`);
      }
    }
  }
  return value;
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
