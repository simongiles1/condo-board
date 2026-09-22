import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEvidenceSources, draftReadiness, evidenceFingerprint, FACT_RESOLUTION_PROMPT, investigationFingerprint, MINUTES_PIPELINE_VERSION, parseFactResolution, type EvidenceSource } from "../lib/meeting-v2/evidence-contract";
import { AGENDA_ITEM_INVESTIGATION_PROMPT } from "../lib/meeting-v2/investigation-prompts";
import { AGENDA_ITEM_REPAIR_PROMPT } from "../lib/meeting-v2/repair-prompts";
import { AGENDA_ITEM_VALIDATION_PROMPT } from "../lib/meeting-v2/validation-prompts";
import { parseInvestigation, parseStoredOpenQuestions, serializeOpenQuestionsJson, storedOpenQuestionTexts } from "../lib/meeting-v2/investigation-contract";
import { resolveAgendaFacts } from "../lib/meeting-v2/fact-resolution";
import { buildMeetingV2DraftArtifact } from "../lib/meeting-v2/draft-builder";
import { normalizeWorkflowState } from "../lib/meeting-v2/agenda-ai";
import { partitionRestricted, validateMinutesV2, type AgendaItemV2 } from "../lib/minutes/schema-v2";
import { letterMarker } from "../lib/minutes/v2-render-helpers";
import { RESTRICTED_ADDENDUM_TITLE } from "../lib/minutes/restricted-addendum-boilerplate";
import { reviewAndRepairOnce } from "../lib/meeting-v2/validation-cycle";
import { canonicalDiscussionTiming, withCanonicalDiscussionTiming } from "../lib/meeting-v2/canonical-timing";
import { compareReferenceTopics } from "../lib/meeting-v2/reference-coverage";
import { chunkDocumentPages } from "../lib/meeting-v2/chunking";

describe("repair and evidence lifecycle", () => {
  it("reviews the repaired facts and preserves a failing final verdict", async () => {
    const reviewed: string[] = [];
    const original = { contractor: "Package proposal" };
    const result = await reviewAndRepairOnce(original, {
      review: async candidate => { reviewed.push(candidate.contractor); return { verdict: "fail" }; },
      requiresRepair: review => review.verdict !== "pass",
      repair: async () => ({ contractor: "Transcript contractor" }),
    });
    assert.deepEqual(reviewed, ["Package proposal", "Transcript contractor"]);
    assert.equal(result.review.verdict, "fail");
    assert.equal(result.repaired, true);
    assert.equal(original.contractor, "Package proposal");
  });
  it("does not accept a repair if its final review fails to run", async () => {
    let reviewed = 0;
    await assert.rejects(reviewAndRepairOnce("original", {
      review: async () => { if (++reviewed === 2) throw new Error("review unavailable"); return "fail"; },
      requiresRepair: () => true, repair: async () => "candidate",
    }), /review unavailable/);
  });
  it("skips repair only after a passing review", async () => {
    const result = await reviewAndRepairOnce("supported", {
      review: async () => "pass", requiresRepair: verdict => verdict !== "pass",
      repair: async () => { throw new Error("Unnecessary repair"); },
    });
    assert.equal(result.investigation, "supported"); assert.equal(result.repaired, false);
  });
  it("derives the overlay from final evidence ranges including a late revisit", () => {
    const segments = [{ sequence: 1, startTimestamp: "00:01:00", endTimestamp: "00:01:30" },
      { sequence: 2, startTimestamp: "00:01:30", endTimestamp: "00:02:00" },
      { sequence: 90, startTimestamp: "01:00:00", endTimestamp: "01:01:00" }];
    const timing = canonicalDiscussionTiming([[1, 2], [90, 90]], segments);
    assert.equal(timing, "00:01:00 - 00:02:00; 01:00:00 - 01:01:00");
    assert.equal(withCanonicalDiscussionTiming("Notes: Keep\nDiscussion timing: wrong", timing), `Notes: Keep\nDiscussion timing: ${timing}`);
    assert.throws(() => canonicalDiscussionTiming([[1, 91]], segments), /missing segments/);
  });
  it("does not claim complete reference coverage when no reference exists or matches are ambiguous", () => {
    assert.equal(compareReferenceTopics(null, [{ id: "a", title: "Pump" }]).topicCoveragePercent, null);
    const expectation = { meetingId: "fixture", expectedMeetingRecords: [], expectedTopics: [
      { key: "pump", title: "Pump", aliases: [], parentSection: "Management", category: "Discussion", visibility: "PUBLIC" as const },
    ] };
    const ambiguous = compareReferenceTopics(expectation, [{ id: "a", title: "Pump" }, { id: "b", title: "Pump" }]);
    assert.equal(ambiguous.topicCoveragePercent, 0);
    assert.equal(ambiguous.matches[0].status, "ambiguous");
  });
});

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
  it("retains evidence at the end of long package pages", () => {
    const page = { id: "p", meetingV2Id: "m", sourceArtifactId: "source", pageNumber: 1, pageHeading: null,
      extractedText: "Background context ".repeat(500) + "The final contract excludes tax.", imagePath: null, createdAt: "2026-09-14" };
    const chunks = chunkDocumentPages([page]);
    assert.match(chunks.map(c => c.text).join(" "), /final contract excludes tax/);
  });
  it("preserves the August 12 conflicting bids and selects the transcript's prior approval", () => {
    const result = parseFactResolution(resolution, evidence);
    assert.equal(result.facts[0].candidates[result.facts[0].selected!].value, "New Water Plumbing $163,000");
    assert.equal(result.facts[0].scope, "prior_approval");
    assert.throws(() => parseFactResolution({ ...resolution, facts: [{ ...resolution.facts[0], selected: 0 }] }, evidence), /package evidence over meeting evidence/);
    assert.throws(() => parseFactResolution({ ...resolution, facts: [{ ...resolution.facts[0], scope: "current_decision", selected: 0 }] }, evidence));
  });
  it("restores digits below the thousands place from the one matching package figure", () => {
    const sources: EvidenceSource[] = [
      { id: "document:9", kind: "document", association: "direct", text: "North Plumbing $48,900.00 plus HST" },
      { id: "transcript:9", kind: "transcript", association: "direct", text: "The board approved North Plumbing for $48,000." },
    ];
    const raw = {
      facts: [{
        field: "amount",
        scope: "prior_approval" as const,
        candidates: [
          { value: "$48,000", sourceId: "transcript:9", quote: "North Plumbing for $48,000" },
          { value: "$48,900.00", sourceId: "document:9", quote: "$48,900.00 plus HST" },
        ],
        selected: 0,
        explanation: "The transcript named the contractor and a round figure.",
      }],
      unresolvedQuestions: ["Is the amount $48,000 or $48,900?"],
    };
    const aligned = parseFactResolution(raw, sources);
    assert.equal(aligned.facts[0].candidates[aligned.facts[0].selected!].value, "$48,900.00");
    assert.deepEqual(aligned.unresolvedQuestions, []);
    const alreadyPrecise = parseFactResolution({
      ...raw,
      facts: [{ ...raw.facts[0], scope: "current_decision", selected: 1 }],
      unresolvedQuestions: ["Who signs?"],
    }, sources);
    assert.equal(alreadyPrecise.facts[0].candidates[alreadyPrecise.facts[0].selected!].value, "$48,900.00");
    assert.deepEqual(alreadyPrecise.unresolvedQuestions, ["Who signs?"]);
    const exactRow = parseFactResolution({
      facts: [{
        field: "amount",
        scope: "prior_approval",
        candidates: [
          { value: "$48,000", sourceId: "transcript:9", quote: "North Plumbing for $48,000" },
          { value: "$48,000.00", sourceId: "document:9", quote: "North Plumbing $48,900.00 plus HST" },
          { value: "$48,900.00", sourceId: "document:9", quote: "$48,900.00 plus HST" },
        ],
        selected: 0,
        explanation: "The package has an exact row for the spoken number.",
      }],
      unresolvedQuestions: [],
    }, [{ ...sources[0], text: "North Plumbing $48,000.00 and North Plumbing $48,900.00 plus HST" }, sources[1]]);
    assert.equal(exactRow.facts[0].candidates[exactRow.facts[0].selected!].value, "$48,000");
  });
  it("rejects invented quotations and malformed resolution JSON", () => {
    assert.throws(() => parseFactResolution({ facts: [{ ...resolution.facts[0], candidates: [{ value: "approved", sourceId: "transcript:165", quote: "The board approved Ambient Mechanical" }] }], unresolvedQuestions: [] }, evidence));
    assert.throws(() => parseFactResolution({}, evidence));
    const salvaged = parseFactResolution(
      {
        facts: [{
          ...resolution.facts[0],
          field: "decision - minutes accepted as amended",
          selected: 0,
          candidates: [{ value: "minutes accepted as amended", sourceId: "transcript:165", quote: "The board approved Ambient Mechanical" }],
        }],
        unresolvedQuestions: [],
      },
      evidence,
      { salvageUnverifiable: true },
    );
    assert.equal(salvaged.facts.length, 0);
    assert.match(salvaged.unresolvedQuestions.join(" "), /minutes accepted as amended/);
    const curlyQuote = parseFactResolution({
      facts: [{
        ...resolution.facts[0],
        candidates: [{
          value: "New Water Plumbing $163,000",
          sourceId: "transcript:165",
          quote: "The booster pump was approved at the previous meeting with New Water Plumbing for $163,000.",
        }],
        selected: 0,
      }],
      unresolvedQuestions: [],
    }, [{
      ...evidence[1],
      text: "The booster pump was approved at the previous meeting with New Water Plumbing for $163,000",
    }]);
    assert.equal(curlyQuote.facts[0].selected, 0);
    const htmlEntityQuote = parseFactResolution({
      facts: [{
        field: "contractor",
        scope: "package_proposal",
        candidates: [{
          value: "Ambient Mechanical",
          sourceId: "document:4",
          quote: "award the contract to Ambient Mechanical",
        }],
        selected: 0,
        explanation: "Package recommendation.",
      }],
      unresolvedQuestions: [],
    }, [{
      id: "document:4",
      kind: "document",
      association: "direct",
      text: "[SECTION: Report] (Pages 4-4)\n\nPAGE 4\n## Projects\nBell &amp; Gossett pump. TCG recommends award the contract to Ambient Mechanical at $214,194.00 plus HST.",
    }]);
    assert.equal(htmlEntityQuote.facts[0].selected, 0);
    const transcriptBodyQuote = parseFactResolution({
      facts: [{
        field: "approval",
        scope: "prior_approval",
        candidates: [{
          value: "prior approval referenced",
          sourceId: "transcript:165",
          quote: "approved at the previous meeting with New Water Plumbing",
        }],
        selected: 0,
        explanation: "Transcript body without cue prefix.",
      }],
      unresolvedQuestions: [],
    }, [{
      id: "transcript:165",
      kind: "transcript",
      association: "direct",
      text: "[00:15:58.534] Haider Mukadam: approved at the previous meeting with New Water Plumbing for $163,000.",
    }]);
    assert.equal(transcriptBodyQuote.facts[0].selected, 0);
    const stringSelected = parseFactResolution({
      ...resolution,
      facts: [{ ...resolution.facts[0], selected: "1" as unknown as number }],
    }, evidence);
    assert.equal(stringSelected.facts[0].selected, 1);
    const salvagedSelection = parseFactResolution({
      ...resolution,
      facts: [{ ...resolution.facts[0], selected: 9 }],
    }, evidence, { salvageUnverifiable: true });
    assert.equal(salvagedSelection.facts.length, 1);
    assert.equal(salvagedSelection.facts[0].selected, null);
    assert.match(salvagedSelection.unresolvedQuestions.join(" "), /selected index/);
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
  it("salvages paraphrased citations instead of aborting fact resolution", async () => {
    const paraphrased = {
      facts: [{
        field: "decision - minutes accepted as amended",
        scope: "current_decision" as const,
        explanation: "Board accepted the prior minutes.",
        selected: 0,
        candidates: [{
          value: "minutes accepted as amended",
          sourceId: "transcript:165",
          quote: "The board approved Ambient Mechanical",
        }],
      }],
      unresolvedQuestions: [],
    };
    const complete = async () => ({
      text: JSON.stringify(paraphrased),
      modelName: "fixture",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cacheHitTokens: 0, cacheMissTokens: 1 },
    });
    const result = await resolveAgendaFacts({
      agenda: { title: "Approval of minutes", itemNumber: "2", itemType: "discussion_approval" },
      sources: evidence,
    }, complete as Parameters<typeof resolveAgendaFacts>[1]);
    assert.equal(result.facts.facts.length, 0);
    assert.match(result.facts.unresolvedQuestions.join(" "), /minutes accepted as amended/);
  });
  it("salvages an out-of-range selected index instead of aborting fact resolution", async () => {
    const invalid = { ...resolution, facts: [{ ...resolution.facts[0], selected: 9 }] };
    const complete = async () => ({
      text: JSON.stringify(invalid),
      modelName: "fixture",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cacheHitTokens: 0, cacheMissTokens: 1 },
    });
    const result = await resolveAgendaFacts({
      agenda: { title: "Booster pump", itemNumber: "4.B.1", itemType: "discussion_approval" },
      sources: evidence,
    }, complete as Parameters<typeof resolveAgendaFacts>[1]);
    assert.equal(result.facts.facts.length, 1);
    assert.equal(result.facts.facts[0].selected, null);
    assert.match(result.facts.unresolvedQuestions.join(" "), /selected index/);
  });
  it("retains topics, printed codes and earlier notes after a partial incremental response", () => {
    const a: Parameters<typeof normalizeWorkflowState>[1]["documentTopics"][number] = { title: "Pump", itemNumber: "4.B.1", sectionLabel: "Management", itemType: "discussion_approval", sourcePages: [4], sourceChunkIds: [], sourceTranscriptRanges: [[1, 2]], aliases: [], notes: ["Earlier discussion"], visibility: "PUBLIC", confidence: 1, sourceText: "", confidenceReason: null, evidenceStrength: "DIRECT", openQuestions: [], needsHumanReview: false, humanReviewReason: null };
    const b = { ...a, title: "Roof", itemNumber: "4.B.2" };
    const next = normalizeWorkflowState({ documentTopics: [{ ...a, notes: ["Later correction"] }] }, { documentTopics: [a, b], extraTopics: [], uncertainties: [] } as Parameters<typeof normalizeWorkflowState>[1]);
    assert.equal(next.documentTopics.length, 2);
    assert.equal(next.documentTopics[1].itemNumber, "4.B.2");
    assert.deepEqual(next.documentTopics[0].notes, ["Earlier discussion", "Later correction"]);
    const manyNotes = Array.from({ length: 35 }, (_, i) => `Evidence note ${i}`);
    const manyChunks = Array.from({ length: 35 }, (_, i) => `chunk-${i}`);
    const repeatedTitles = normalizeWorkflowState({ documentTopics: [{ ...a, notes: manyNotes, sourceChunkIds: manyChunks }, { ...a, itemNumber: "4.B.3" }] }, { documentTopics: [], extraTopics: [], uncertainties: [] });
    assert.equal(repeatedTitles.documentTopics.length, 2, "Distinct printed codes must not merge just because their titles match");
    assert.deepEqual(repeatedTitles.documentTopics[0].notes, manyNotes);
    assert.deepEqual(repeatedTitles.documentTopics[0].sourceChunkIds, manyChunks);
  });
});

describe("draft quality gate", () => {
  it("blocks missing, failed, review-required and stale investigations instead of silently omitting them", () => {
    const input = fixture([{ title: "Pump", code: "4.B.1" }, { title: "Roof", code: "4.B.2" }]);
    assert.doesNotThrow(() => buildMeetingV2DraftArtifact(input));
    assert.throws(() => buildMeetingV2DraftArtifact({ ...input, investigations: input.investigations.slice(0, 1) }), /requires exactly one/);
    assert.throws(() => buildMeetingV2DraftArtifact({ ...input, validations: [] }), /validation is incomplete/);
    assert.throws(
      () =>
        buildMeetingV2DraftArtifact({
          ...input,
          validations: input.validations.map((v) => ({
            ...v,
            severity: "error",
            detailsJson: JSON.stringify({
              ...JSON.parse(v.detailsJson ?? "{}"),
              verdict: "fail",
            }),
          })),
        }),
      /correction or review/,
    );
    assert.doesNotThrow(() =>
      buildMeetingV2DraftArtifact({
        ...input,
        validations: input.validations.map(v => ({ ...v, severity: "warning" })),
      }),
    );
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
    const parsed = parseInvestigation({ discussion_summary: "A quote was discussed.", outcome: "no_decision", confidence: "low", visibility: "restricted", decisions: [], motion: null, actions: [], open_questions: [{ question: "Which quote?", recommended_answer: "Use the cheaper quote.", confidence: "high", context_notes: [{ fact: "The property manager named two quotes; no board member confirmed which one.", source: "transcript" }] }] });
    assert.equal(parsed.visibility, "RESTRICTED");
    assert.equal(parsed.open_questions.length, 1);
    assert.equal(parsed.open_questions[0].context_notes[0]?.source, "transcript");
    assert.doesNotMatch(parsed.discussion_summary, /cheaper/);
  });
  it("keeps question briefing notes when storing open questions as objects", () => {
    const stored = serializeOpenQuestionsJson([{
      question: "Was the quote approved?",
      recommended_answer: "",
      confidence: "low",
      context_notes: [{ fact: "A director named a figure; nobody seconded a motion.", source: "transcript" }],
    }]);
    assert.deepEqual(storedOpenQuestionTexts(stored), ["Was the quote approved?"]);
    assert.equal(parseStoredOpenQuestions(stored)[0]?.context_notes[0]?.source, "transcript");
    assert.deepEqual(storedOpenQuestionTexts('["Was the quote approved?"]'), ["Was the quote approved?"]);
    assert.deepEqual(parseStoredOpenQuestions('["Was the quote approved?"]')[0]?.context_notes, []);
    const withoutNotes = parseInvestigation({ discussion_summary: "A quote was discussed.", outcome: "no_decision", confidence: "low", visibility: "restricted", decisions: [], motion: null, actions: [], open_questions: [{ question: "Which quote?", recommended_answer: "", confidence: "low" }] });
    assert.deepEqual(withoutNotes.open_questions[0].context_notes, []);
  });
  it("rejects duplicate agenda codes before they can overwrite a substantive item", () => {
    assert.throws(() => buildMeetingV2DraftArtifact(fixture([{ title: "Pump", code: "4.B.1" }, { title: "Roof", code: "4.B.1" }])), /Duplicate agenda codes/);
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

describe("published minutes must not narrate ASR process", () => {
  it("keeps fact, investigation, validation, and repair prompts aligned against spoken-as minutes prose", () => {
    assert.match(FACT_RESOLUTION_PROMPT, /never the rounded spoken number/);
    assert.doesNotMatch(FACT_RESOLUTION_PROMPT, /speaking "100 and sixty-three"/);
    assert.match(AGENDA_ITEM_INVESTIGATION_PROMPT, /Never mention speech-to-text/);
    assert.match(AGENDA_ITEM_VALIDATION_PROMPT, /not a discrepancy/);
    assert.match(AGENDA_ITEM_VALIDATION_PROMPT, /Suggested fixes state the decision/);
    assert.match(AGENDA_ITEM_REPAIR_PROMPT, /Do not follow a validator suggestion that would insert process language/);
  });
});
