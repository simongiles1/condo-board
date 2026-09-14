import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEvidenceSources, draftReadiness, evidenceFingerprint, investigationFingerprint, MINUTES_PIPELINE_VERSION, parseFactResolution, type EvidenceSource } from "../lib/meeting-v2/evidence-contract";
import { parseInvestigation } from "../lib/meeting-v2/investigation-contract";
import { resolveAgendaFacts } from "../lib/meeting-v2/fact-resolution";
import { buildMeetingV2DraftArtifact } from "../lib/meeting-v2/draft-builder";
import { normalizeWorkflowState } from "../lib/meeting-v2/agenda-ai";
import { partitionRestricted, validateMinutesV2, type AgendaItemV2 } from "../lib/minutes/schema-v2";
import { letterMarker } from "../lib/minutes/v2-render-helpers";
import { RESTRICTED_ADDENDUM_TITLE } from "../lib/minutes/restricted-addendum-boilerplate";

const item = (topic: string, restricted = false, subItems: AgendaItemV2[] = []): AgendaItemV2 => ({ topic, summary: `${topic} summary.`, restricted, actionItems: [], subItems });
const evidence: EvidenceSource[] = [
  { id: "document:4", kind: "document", association: "direct", text: "Management recommends Ambient Mechanical at $214,194.00 plus HST for the booster pump." },
  { id: "transcript:165", kind: "transcript", association: "direct", text: "The booster pump was approved at the previous meeting with New Water Plumbing for $163,000." },
  { id: "transcript:720", kind: "transcript", association: "direct", text: "The CCDC contract will be reviewed by legal counsel before signing." },
];
const resolution = {
  facts: [{ field: "contractor and amount", scope: "prior_approval", candidates: [
    { value: "Ambient Mechanical $214,194.00", sourceId: "document:4", quote: "Ambient Mechanical at $214,194.00 plus HST" },
    { value: "New Water Plumbing $163,000", sourceId: "transcript:165", quote: "New Water Plumbing for $163,000" },
  ], selected: 1, explanation: "The transcript confirms a prior approval and supersedes the package recommendation." }],
  unresolvedQuestions: [],
};

type BuildInput = Parameters<typeof buildMeetingV2DraftArtifact>[0];
function fixture(topics: Array<{ title: string; code: string; type?: string; restricted?: boolean; motion?: unknown; summary?: string }>): BuildInput {
  const agendaItems = topics.map((t, i) => ({ id: `a${i}`, meetingV2Id: "meeting", title: t.title, itemNumber: t.code,
    itemType: t.type ?? "discussion_approval", sectionLabel: "Property Management Report", sortOrder: i, sourcePagesJson: "[4]", sourceText: "", createdAt: "2026-09-14" }));
  const investigations = agendaItems.map((a, i) => ({ id: `i${i}`, agendaItemId: a.id, meetingV2Id: "meeting",
    discussionSummary: topics[i].summary ?? `${a.title} was discussed.`, outcome: "no_decision", confidence: "high",
    visibility: topics[i].restricted ? "restricted" : "public", decisionsJson: "[]", actionsJson: "[]", motionJson: JSON.stringify(topics[i].motion ?? null),
    openQuestionsJson: "[]", userAnswersJson: null, modelName: "fixture", usageJson: JSON.stringify({ pipelineVersion: MINUTES_PIPELINE_VERSION, evidenceFingerprint: "evidence", factResolution: resolution }),
    createdAt: "2026-09-14", updatedAt: "2026-09-14" }));
  const validations = investigations.map(i => ({ id: `v${i.id}`, meetingV2Id: "meeting", agendaItemId: i.agendaItemId,
    severity: "info", code: "ai_verdict", message: "Supported", validationType: "ai_review", createdAt: "2026-09-14",
    detailsJson: JSON.stringify({ verdict: "pass", needsHumanReview: false, pipelineVersion: MINUTES_PIPELINE_VERSION,
      investigationId: i.id, investigationFingerprint: investigationFingerprint(i), evidenceFingerprint: "evidence" }) }));
  return { meeting: { id: "meeting", title: "Evidence regression", meetingDate: "2026-08-12", settings: { agendaApproval: { approvedAt: "2026-09-14", status: "approved" } } },
    agendaItems, investigations, validations, contexts: [], chunks: [], pages: [] } as unknown as BuildInput;
}

describe("source precedence and loss prevention", () => {
  it("preserves the August 12 conflicting bids and selects the transcript's prior approval", () => {
    const result = parseFactResolution(resolution, evidence);
    assert.equal(result.facts[0].candidates[result.facts[0].selected!].value, "New Water Plumbing $163,000");
    assert.equal(result.facts[0].scope, "prior_approval");
    assert.throws(() => parseFactResolution({ ...resolution, facts: [{ ...resolution.facts[0], selected: 0 }] }, evidence), /package evidence over meeting evidence/);
    assert.throws(() => parseFactResolution({ ...resolution, facts: [{ ...resolution.facts[0], scope: "current_decision", selected: 0 }] }, evidence));
  });
  it("rejects invented quotations and malformed resolution JSON", () => {
    assert.throws(() => parseFactResolution({ facts: [{ ...resolution.facts[0], candidates: [{ value: "approved", sourceId: "transcript:165", quote: "The board approved Ambient Mechanical" }] }], unresolvedQuestions: [] }, evidence));
    assert.throws(() => parseFactResolution({}, evidence));
  });
  it("keeps late transcript corrections intact and labels unrelated keyword hits", () => {
    const segments = Array.from({ length: 730 }, (_, sequence) => ({ sequence, startTimestamp: "00:00:00", speakerLabel: "Speaker", text: sequence === 720 ? evidence[2].text : "Context ".repeat(220) }));
    const sources = buildEvidenceSources({ ranges: [[164, 165], [719, 721]], segments, documents: [], relatedSequences: [50] });
    assert.equal(sources.find(s => s.id === "transcript:720")?.association, "direct");
    assert.match(sources.find(s => s.id === "transcript:720")!.text, /CCDC/);
    assert.equal(sources.find(s => s.id === "transcript:50")?.association, "related");
    assert.equal(sources.find(s => s.id === "transcript:163")?.association, "neighbor");
    assert.notEqual(evidenceFingerprint(sources), evidenceFingerprint(sources.slice(0, -1)));
  });
  it("retries an invalid fact selection without accepting a guessed fallback", async () => {
    let calls = 0;
    const complete = async () => ({ text: JSON.stringify(calls++ === 0 ? { ...resolution, facts: [{ ...resolution.facts[0], selected: 0 }] } : resolution), modelName: "fixture", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cacheHitTokens: 0, cacheMissTokens: 1 } });
    const result = await resolveAgendaFacts({ agenda: { title: "Booster pump", itemNumber: "4.B.1", itemType: "discussion_approval" }, sources: evidence }, complete as Parameters<typeof resolveAgendaFacts>[1]);
    assert.equal(calls, 2);
    assert.equal(result.attempts.length, 2);
    await assert.rejects(resolveAgendaFacts({ agenda: { title: "Pump", itemNumber: "4.B.1", itemType: "discussion_approval" }, sources: evidence }, (async () => ({ ...await complete(), text: "{" })) as Parameters<typeof resolveAgendaFacts>[1]), /Fact resolution failed/);
  });
  it("retains topics, printed codes and earlier notes after a partial incremental response", () => {
    const a: Parameters<typeof normalizeWorkflowState>[1]["documentTopics"][number] = { title: "Pump", itemNumber: "4.B.1", sectionLabel: "Management", itemType: "discussion_approval", sourcePages: [4], sourceChunkIds: [], sourceTranscriptRanges: [[1, 2]], aliases: [], notes: ["Earlier discussion"], visibility: "PUBLIC", confidence: 1, sourceText: "", confidenceReason: null, evidenceStrength: "DIRECT", openQuestions: [], needsHumanReview: false, humanReviewReason: null };
    const b = { ...a, title: "Roof", itemNumber: "4.B.2" };
    const next = normalizeWorkflowState({ documentTopics: [{ ...a, notes: ["Later correction"] }] }, { documentTopics: [a, b], extraTopics: [], uncertainties: [] } as Parameters<typeof normalizeWorkflowState>[1]);
    assert.equal(next.documentTopics.length, 2);
    assert.equal(next.documentTopics[1].itemNumber, "4.B.2");
    assert.deepEqual(next.documentTopics[0].notes, ["Earlier discussion", "Later correction"]);
  });
});

describe("draft quality gate", () => {
  it("blocks missing, failed, review-required and stale investigations instead of silently omitting them", () => {
    const input = fixture([{ title: "Pump", code: "4.B.1" }, { title: "Roof", code: "4.B.2" }]);
    assert.doesNotThrow(() => buildMeetingV2DraftArtifact(input));
    assert.throws(() => buildMeetingV2DraftArtifact({ ...input, investigations: input.investigations.slice(0, 1) }), /requires exactly one/);
    assert.throws(() => buildMeetingV2DraftArtifact({ ...input, validations: [] }), /validation is incomplete/);
    assert.throws(() => buildMeetingV2DraftArtifact({ ...input, validations: input.validations.map(v => ({ ...v, severity: "error" })) }), /correction or review/);
    assert.throws(() => buildMeetingV2DraftArtifact({ ...input, validations: input.validations.map(v => ({ ...v, severity: "warning" })) }), /correction or review/);
    input.investigations[0].discussionSummary = "Changed after validation";
    assert.match(draftReadiness(input.agendaItems, input.investigations, input.validations).join(" "), /stale/);
  });
  it("does not invent motion participants, a carried result, attendance, start time or adjournment", () => {
    const input = fixture([{ title: "Pump", code: "4.B.1", motion: { moved_by: null, seconded_by: null, resolution_text: "THAT a study be considered", result: "UNKNOWN", is_candidate: true } }]);
    const result = buildMeetingV2DraftArtifact(input);
    const doc = JSON.parse(result.summaryJson).minutesV2.data;
    assert.equal(doc.managementReport.itemsForApproval[0].motion.status, "Outcome not recorded.");
    assert.equal(doc.managementReport.itemsForApproval[0].motion.movedBy, "");
    assert.deepEqual(doc.attendance.regrets, []);
    assert.equal(doc.metadata.meetingTime, "");
    assert.equal(doc.termination, undefined);
    assert.doesNotMatch(result.contentMarkdown, /Motion carried|Seconded by|6:00 pm|unanimously/);
  });
  it("requires structurally valid investigations and retains proposed answers as questions", () => {
    assert.throws(() => parseInvestigation({}), /incomplete/);
    const parsed = parseInvestigation({ discussion_summary: "A quote was discussed.", outcome: "no_decision", confidence: "low", visibility: "restricted", decisions: [], motion: null, actions: [], open_questions: [{ question: "Which quote?", recommended_answer: "Use the cheaper quote.", confidence: "high" }] });
    assert.equal(parsed.visibility, "RESTRICTED");
    assert.equal(parsed.open_questions.length, 1);
    assert.doesNotMatch(parsed.discussion_summary, /cheaper/);
  });
});

describe("complete agenda numbering and restricted filtering", () => {
  it("keeps c in the addendum and public b then d, including after normalization", () => {
    const input = fixture(["A", "B", "C", "D"].map((title, i) => ({ title, code: `4.B.${i + 1}`, restricted: title === "C" })));
    const output = buildMeetingV2DraftArtifact(input);
    const [publicText, restricted] = output.contentMarkdown.split(`## ${RESTRICTED_ADDENDUM_TITLE}`);
    assert.match(publicText, /\*\*\(b\)\*\* B/);
    assert.match(publicText, /\*\*\(d\)\*\* D/);
    assert.doesNotMatch(publicText, /C summary/);
    assert.match(restricted, /\*\*\(c\)\*\* \*C\*/);
    const doc = validateMinutesV2(JSON.parse(output.summaryJson).minutesV2).value!;
    assert.deepEqual(doc.managementReport.itemsForApproval.map(i => i.topic), ["A", "B", "C", "D"]);
  });
  it("filters restricted children and inherits a restricted parent's visibility", () => {
    const items = [item("Parent", false, [item("Public"), item("Private", true), item("Later")]), item("Private parent", true, [item("Inherited private")])];
    const split = partitionRestricted(items);
    assert.deepEqual(split.public[0].subItems.map(i => i.displayIndex), [0, 2]);
    assert.equal(split.restricted[0].subItems[0].displayIndex, 1);
    assert.equal(split.restricted[0].summary, "");
    assert.equal(split.restricted[1].subItems[0].topic, "Inherited private");
    assert.equal(items[0].subItems.length, 3);
  });
  it("keeps headings out of the substantive list, preserves children, and routes completed/admin items", () => {
    const input = fixture([{ title: "Management", code: "4" }, { title: "Approvals", code: "4.B" }, { title: "Pump", code: "4.B.1" },
      { title: "Contract", code: "4.B.1.a" }, { title: "Completed roof", code: "4.C.1", type: "completed_items" },
      { title: "Next meeting", code: "5", type: "next_meeting" }, { title: "Adjournment", code: "6", type: "adjournment" }]);
    const output = buildMeetingV2DraftArtifact(input);
    const doc = JSON.parse(output.summaryJson).minutesV2.data;
    assert.equal(doc.managementReport.itemsForApproval.length, 1);
    assert.equal(doc.managementReport.itemsForApproval[0].subItems[0].topic, "Contract");
    assert.equal(doc.managementReport.itemsForInformation[0].topic, "Completed roof");
    assert.deepEqual(doc.newOrOtherBusiness, []);
  });
  it("uses letters beyond z without punctuation and includes restricted presentations/correspondence", () => {
    assert.equal(letterMarker(26), "(aa)"); assert.equal(letterMarker(51), "(az)"); assert.equal(letterMarker(52), "(ba)");
    const output = buildMeetingV2DraftArtifact(fixture([{ title: "Private presentation", code: "1.A", type: "guest_presentation", restricted: true }, { title: "Private letter", code: "8", type: "correspondence", restricted: true }]));
    const parts = output.contentMarkdown.split(`## ${RESTRICTED_ADDENDUM_TITLE}`);
    assert.doesNotMatch(parts[0], /Private presentation|Private letter/);
    assert.match(parts[1], /Private presentation/); assert.match(parts[1], /Private letter/);
  });
});
