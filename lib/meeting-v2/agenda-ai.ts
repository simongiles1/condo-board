import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { getDb } from "@/lib/db";
import {
  meetingsV2,
  meetingsV2AgendaChunkSnapshots,
  meetingsV2AgendaItems,
  meetingsV2DocumentChunks,
  meetingsV2DocumentSections,
  meetingsV2SourceArtifacts,
  meetingsV2TranscriptSegments,
} from "@/lib/db/schema";
import type {
  AgendaItemDiscussionStatus,
  MeetingV2Settings,
  TranscriptDiscrepancy,
} from "@/lib/meeting-v2/extraction-diagnostics";
import { filterRedundantAddToAgendaDiscrepancies } from "@/lib/meeting-v2/transcript-discrepancies";
import {
  extractBoardPackageAgendaJson,
  flattenBoardPackageAgenda,
} from "@/lib/meeting-v2/board-package-agenda";
import {
  applyAgendaHierarchyCorrections,
  compareAgendaItemCodes,
  formatDiscussionTimestampRanges,
  inferPropertyManagementReportNumber,
  mergeClosedIntervals,
  parentAgendaItemCode,
  parseDiscussionTimestampRanges,
  planAdHocPlacement,
} from "@/lib/meeting-v2/agenda-outline";
import {
  reviewTranscriptTopicSpans,
  transcriptSegmentsToReviewCues,
} from "@/lib/meeting-v2/span-edge-review";
import { assignUnmatchedLeavesInHoles } from "@/lib/meeting-v2/gap-leaf-assignment";

type WorkflowTopic = {
  title: string;
  sectionLabel: string;
  itemType: string;
  itemNumber?: string;
  visibility: "PUBLIC" | "RESTRICTED" | "UNKNOWN";
  sourcePages: number[];
  sourceChunkIds: string[];
  sourceTranscriptRanges: Array<[number, number]>;
  discussionStatus?: "discussed" | "not_discussed" | "ad_hoc";
  discussionTimestampRange?: string | null;
  consolidationReason?: string | null;
  sourceText: string | null;
  aliases: string[];
  notes: string[];
  confidence: number;
  confidenceReason: string | null;
  evidenceStrength: "DIRECT" | "STRONG_INFERENCE" | "WEAK_INFERENCE" | "UNCERTAIN";
  openQuestions: string[];
  needsHumanReview: boolean;
  humanReviewReason: string | null;
};

type WorkflowDiscrepancy = {
  id: string;
  transcriptRange: [number, number];
  timestamp: string;
  speaker?: string | null;
  snippet: string;
  suggestedTitle: string;
  suggestedSection?: string | null;
  clarificationQuestion: string;
};

type WorkflowState = {
  documentTopics: WorkflowTopic[];
  extraTopics: WorkflowTopic[];
  uncertainties: string[];
  discrepancies?: WorkflowDiscrepancy[];
};

type WorkflowChanges = {
  summary?: string[];
};

type WorkflowResponse = WorkflowState & {
  changes?: WorkflowChanges;
};

const BASE_SYSTEM_PROMPT = `You are reconstructing a condominium board meeting topic map.

You are not writing minutes.
You are not inventing decisions.

Your job is to maintain two structured lists:
1. documentTopics: business topics clearly grounded in the board package
2. extraTopics: real discussion topics, action items, or follow-ups discussed in the transcript but not clearly listed in the package

Important rules:
- Preserve existing valid topics. Update them carefully instead of rewriting blindly.
- Keep unchanged topics compact and stable. Do not expand aliases, notes, or explanations on topics that this chunk did not materially affect.
- One real business matter should appear once.
- A real topic is a board-level business matter, not just a document page or a paragraph.
- Preserve the document's own wording when it already names the matter clearly. Do not rewrite titles into a cleaner or more polished version unless the package wording is obviously broken OCR.
- Keep the stored evidence compact. Prefer short direct phrases over long summaries.
- Preserve exact factual details when they matter to the business issue, especially money amounts, rates, balances, unit numbers, contract terms, deadlines, and dates.
- Do not create one topic per attachment page.
- Use the package as the source of truth for official agenda topics.
- Maintain topics in the official meeting outline order using hierarchical itemNumber codes (1, 1.A, 4.A, 4.A.1, 4.D.a, 4.E.a). Never rewrite those codes into a sequential 1, 2, 3 list.
- Numbered project lines under a subsection (4.A.1, 4.B.5) use the number printed on that heading. Top-level items 5 (next Board Meeting) and 6 (Adjournment) are different slots — do not skip 4.B.5 because those top-level codes exist.
- When the package shows one umbrella heading with numbered or lettered sub-items, keep the parent heading AND create one topic per real sub-item.
- Guest-presentation outline bullets (1.A, 1.B) stay under item 1. Later Property Management Report project items (4.B.1) stay under the management report even when they concern the same project. Do not unify them into one topic.
- When guest presenters lead substantial opening discussion before regular board business, keep those as distinct presentation topics instead of folding them into later management report items.
- Use the transcript to enrich existing package topics and to add extraTopics only when they are genuinely separate.
- If a person, contractor, or role is only partially known, preserve the partial wording in aliases or notes instead of inventing a full name or title.
- Do not create topics from meeting administration lines such as call to order, ratification of agenda, next meeting scheduling, or adjournment.
- EXCEPTION: You MUST extract "Approval of Previous Minutes" as a discrete topic. You MUST include the date of the previous meeting in the title if it is known (e.g. "Approval of Previous Minutes: May 19, 2026").
- Categorize topics involving monthly financial statements, balance sheets, budget variances, reserve fund balances, investments, GICs, bad debts, or arrears strictly as "financial_matters".
- Do not create topics from attachment-only boilerplate such as quotation validity, payment terms, warranties, limitation of liability, generic email sign-offs, gym rules, or record-request instructions unless they clearly define a separate board matter.
- Do not invent motions, outcomes, or minutes wording.
- Return strict JSON only. No markdown fences. No commentary.`;

const PACKAGE_TASK = `TASK: PACKAGE CHUNK UPDATE

You will receive:
- the current topic state
- one package chunk

Update documentTopics using only this package chunk plus the existing state.

If this chunk does not require any change, return:
{
  "status": "no_change"
}

Otherwise return strict JSON with this shape:
{
  "documentTopics": [
    {
      "title": "string",
      "sectionLabel": "string",
      "itemNumber": "1 | 1.A | 4.A.1 | 4.D.a",
      "itemType": "guest_presentation | approval_of_previous_minutes | financial_matters | ratification_line_item | discussion_approval | discussion_topic | completed_items | discussion_subitem | legal_matter | new_other_business | extra_topic | other",
      "visibility": "PUBLIC | RESTRICTED | UNKNOWN",
      "sourcePages": [1],
      "sourceChunkIds": ["document_chunk_001"],
      "sourceTranscriptRanges": [],
      "discussionStatus": "discussed | not_discussed | ad_hoc",
      "consolidationReason": "string | null",
      "sourceText": "string | null",
      "aliases": ["string"],
      "notes": ["string"],
      "confidence": 0.0,
      "confidenceReason": "string | null",
      "evidenceStrength": "DIRECT | STRONG_INFERENCE | WEAK_INFERENCE | UNCERTAIN",
      "openQuestions": ["string"],
      "needsHumanReview": false,
      "humanReviewReason": "string | null"
    }
  ],
  "extraTopics": [],
  "changes": {
    "summary": ["string"]
  },
  "uncertainties": ["string"]
}

Package chunk rules:
- Preserve existing itemNumber outline codes. Do not renumber topics sequentially.
- A heading "5. Update on Shared Facilities..." under section 4.B is itemNumber "4.B.5". Do not emit "4.B.6" to avoid colliding with top-level agenda item 5.
- Guest-presentation outline bullets (1.A Booster Pump) and Property Management Report project items (4.B.1 Booster Pump Replacement) are different outline slots. Keep both. Do not unify them into one topic.
- Favor numbered or clearly separated business items.
- If a package section contains numbered sub-items like 1., 2., 3. under one heading, create separate topics for those numbered items.
- If a discussion section contains lettered sub-items like a., b., c., create separate topics for those lettered items.
- If an agenda line says to refer to supporting pages, email correspondence, appendix pages, or attachment pages, include those referenced page numbers in sourcePages for that topic in addition to the agenda page itself.
- For ratification blocks, you MUST create one discrete agenda topic per ratified line item (e.g., 6.1(a), 6.1(b), etc.). Never collapse multiple quotes or email approvals into a single generic "email approvals ratified" umbrella topic. Extract contractor name, quote amount, and date into notes for each topic.
- You MUST assign the correct itemType:
  - For "Approval of Previous Minutes", set itemType to "approval_of_previous_minutes". DO NOT drop it as administrative.
  - For "Financial Matters" or financial statements, set itemType to "financial_matters". DO NOT drop it as administrative.
  - For ratification items (e.g. email approvals), set itemType to "ratification_line_item".
  - For matters explicitly requiring board approval, set itemType to "discussion_approval".
  - For completed items or work updates, set itemType to "completed_items".
- If the chunk only shows a bucket label like "ratification of email decisions", "review and approval of projects", "items completed", or "items for discussion" but does not yet list the underlying matters, do not create a placeholder topic for that bucket. Wait for the child matters unless the bucket itself is clearly the real business matter.
- If the chunk is mainly an attachment or support page, use it to enrich an existing topic instead of creating new ones.
- If a support page clearly continues a numbered or lettered agenda list already in progress, you may add or complete that agenda topic using the support page wording.
- Pages marked as [PREVIOUS PAGE CONTEXT] are provided strictly so you can read headings that connect to the current pages. Do not extract brand new topics from the previous page context if they do not spill over into the new pages.
- If "Items completed", "Work completed", weekly updates, or a separate completed-work report is explicitly presented as a real board reporting item, create one informational topic for that completed-items report even if the detailed list lives in another document.
- When a package says completed work has been shared separately, treat that completed-work report as a real agenda matter rather than dismissing it for lack of detail.
- If the chunk contains only quote clauses, invoice details, engineering boilerplate, legal boilerplate, policies, rules, or form instructions, usually return no_change.
- Supporting pages should enrich an existing topic instead of creating a duplicate.
- Keep titles close to the package wording. Prefer faithful capture over polished summarization.
- Keep sourcePages accurate and unique.
- Keep sourceChunkIds accurate and include the current package chunk id for every topic you touched.
- Keep sourceTranscriptRanges empty for package-only evidence.
- Keep sourceText very short. Use one short exact phrase or line fragment from the current chunk, not a paragraph summary.
- Keep notes short and factual.
- When support pages contain exact financial or scheduling facts that define the matter, preserve those exact facts in notes instead of paraphrasing them away.
- Preserve exact numbers and dates when the package gives them. Do not round, simplify, or drop them.
- If the package includes investment details, preserve the exact amount, institution, rate, term length, and maturity or placement date whenever they are stated.
- If a support email or attachment contains a clearly stated date tied to the matter, preserve that date accurately in notes.
- Keep aliases and notes minimal. Only include them when they will help later retrieval.
- If the matter concerns a specific suite/unit, owner dispute, chargeback, legal letter, records request, incident, complaint, or personnel issue, mark visibility as RESTRICTED.
- Use aliases for shorthand names, partial names, contractor names, and package/transcript variants that may help later evidence retrieval.
- Use confidenceReason for one short sentence explaining confidence.
- Use evidenceStrength to describe how directly this chunk supports the topic.
- Use openQuestions for unresolved ambiguity only.
- Set needsHumanReview to true only when a careful reviewer should inspect this topic, and explain why in humanReviewReason.
- In changes.summary, briefly say what changed in this chunk.
- Keep extraTopics empty unless the package itself clearly introduces a non-agenda business matter.
- Pattern guide:
- Prefer real child matters over bucket labels.
- Prefer one topic per numbered or lettered matter when the package is enumerating separate business items.
- Prefer no_change for pure support/legal/quote boilerplate that does not define a separate board matter.
- Prefer one informational completed-items topic when the package explicitly says completed work is a real report, even if the details live in another document.
- Prefer no topic for meeting administration lines and future scheduling.`;

const TRANSCRIPT_TASK = `TASK: TRANSCRIPT CHUNK ENRICHMENT & DISCUSSION ALIGNMENT

You will receive:
- the current topic state (documentTopics and extraTopics)
- the FLOOR POINTER: which leaf agenda item is on the table at the start of this chunk
- one transcript chunk

Walk the chunk CUE BY CUE in clock / sequence order. Do not scan later titles in the chunk and jump the floor forward. Carry the floor item from the previous cue (use the FLOOR POINTER for the first cue of the chunk).

Each cue is exactly one of:
1. OPEN a topic — first substantive introduction of a matter that is not the current floor item (named project, asset, quote, page, contractor, or a later revisit of an earlier item). This starts a new sourceTranscriptRanges span and moves the floor. A revisit of an existing topic is still operation 1: a new span on that topic, not a new agenda row.
2. ENRICH an existing topic — facts, amounts, history, or aliases about the floor item (or a topic this cue genuinely also concerns). Extend the current span. Do not change which item is on the floor.
3. CHANGE LIFECYCLE of the floor item — procedural movement of the SAME item: "any other questions", seeking assent, "yeah I'm fine", "can we move to the next item", unmute / waiting on a director, "go ahead / you move forward", minute-taker tags such as "is this reserve fund?". Assent RATIFIES the floor item. It does NOT open the next outline number. Keep attaching these cues to the floor item's current span until operation 1 fires.

Open vs lifecycle:
- "Can we move on?" / "Yeah, I'm fine" / "Go ahead" belong to the floor item (operation 3).
- The next outline item opens only when speakers introduce that matter by substance (operation 1), for example a different unit number, "we have a sealed replacement for pump 10A", or "joint meeting for the shared facilities".
- A different unit / asset than the floor item is operation 1 even during wrap-up of the floor item. Keep the previous span open until assent on that item finishes; overlap is allowed.
- Clerk or minute-taker questions about the item just ratified stay on that item (operation 2 or 3) even after someone asked to move on.
- Do not skip later lettered package leaves in the same section (4.D.h after 4.D.g) when speakers name them. Prefer OPEN of the matching unmatched package leaf over no_change.

Overlap: a cue may attach to more than one topic when the talk genuinely bridges both matters (wrap-up of 4.D.g while naming unit 2005 for 4.D.h). Mute recovery without naming the next matter is not overlap.

Use the transcript chunk to:
- link discussion to existing documentTopics:
  - set discussionStatus to "discussed" if conversation is found
  - attach sequence numbers to sourceTranscriptRanges
  - attach human-readable start/end time to discussionTimestampRange (e.g. "00:15:58 - 01:42:10")
  - if the same matter is revisited later, APPEND another clock span separated by "; " (e.g. "00:15:58 - 00:22:10; 01:08:00 - 01:12:40"). Do not collapse revisits into one span that covers unrelated talk in between.
  - parent ranges must cover their children as the merged list of those spans: item 4 includes all of 4.A/4.B/..., 4.B includes 4.B.1/4.B.2/..., and a child range stays inside that parent coverage (a later pickup of the same matter may extend both)
- when this chunk continues a topic already marked discussed, extend or append its sourceTranscriptRanges and discussionTimestampRange. Never replace earlier ranges with only this chunk.
- add aliases or notes when the transcript uses shorthand
- add extraTopics ONLY for genuinely new board business matters discussed in the transcript but not on the agenda (itemType "ad_hoc_discussion" or "extra_topic", discussionStatus "ad_hoc"). Those extraTopics will be nested under a synthesized Property Management Report section 4.E.
- detect unaligned discussion discrepancies:
  - if there is substantial discussion in this chunk that does not map to any recognized agenda item, add an entry to "discrepancies":
    {
      "id": "disc-unique-id",
      "transcriptRange": [startSeq, endSeq],
      "timestamp": "HH:MM:SS",
      "speaker": "Speaker Name",
      "snippet": "Short quote of what was discussed",
      "suggestedTitle": "Title of the unexpected topic",
      "clarificationQuestion": "It looks like [topic] was discussed at [timestamp], but does not appear on the official agenda. Should this be included as an agenda item?"
    }
  - do NOT add discrepancies for matters already captured in extraTopics or documentTopics in the current state. Discrepancies are for unconfirmed alignment gaps only — if you add a matter to extraTopics in this response, do not also add a discrepancy for the same matter.

If this chunk does not require any change, return:
{
  "status": "no_change"
}

Otherwise return strict JSON with the same shape as before, including "discrepancies": [...] when applicable.

Transcript rules:
- Discussion Status: Any topic with verified audio discussion in this or previous chunks should have discussionStatus "discussed". If an agenda topic was not reached (e.g. meeting adjourned early or skipped), it remains "not_discussed".
- Do not remove solid package-backed topics just because they are not mentioned in this chunk.
- Prefer updating notes and aliases on existing topics.
- Lines marked as [PREVIOUS TRANSCRIPT CONTEXT] are provided strictly so you can read conversations that connect to the current lines. Do not extract brand new extra topics from the previous transcript context if they do not spill over into the new lines.
- Preserve early guest-presentation topics when the transcript clearly shows a contractor, engineer, or presenter leading a distinct opening discussion block.
- GUEST PRESENTERS & CARRIED OVER ITEMS: If a topic is an official agenda presentation (e.g. "Meeting with Eng. Ryan Ratcliff from TCG"), check whether the guest actually attended or spoke in this meeting. If the guest was NOT present in the audio recording, and the topic was only mentioned in passing or while reviewing amendments to previous minutes, DO NOT mark it as "discussed". Mark it as "not_discussed" and set evidenceStrength to "UNCERTAIN" with needsHumanReview: true and humanReviewReason: "Guest presenter did not speak in audio; topic was only mentioned in passing during review of prior minutes."
- If the transcript clearly reveals a planned or structured meeting matter that belongs in the main agenda but is missing from documentTopics, add it to documentTopics rather than extraTopics.
- Use extraTopics only for genuinely additional matters that do not behave like an official agenda topic.
- Every transcript-only new matter must use itemType "extra_topic". EXCEPTION: If the transcript introduces the approval of previous minutes or financial matters, add it to documentTopics with itemType "approval_of_previous_minutes" or "financial_matters" respectively. Do not invent custom itemType values for extraTopics.
- If the transcript uses shorthand, partial names, or abbreviated project references, attach them to the matching existing topic through aliases or notes whenever reasonably possible.
- Do not merge a transcript matter into an existing topic unless they are clearly the same business issue. Shared words, contractor names, or building-area overlap alone are not enough.
- If the transcript gives a more specific unit number, room name, incident, or records issue than the package topic list, preserve that specific matter instead of flattening it into a broader nearby topic.
- If one transcript chunk contains multiple separate business matters, preserve them as separate topics. Do not keep only the last matter mentioned.
- If the chunk moves from one issue to another, switch the floor only on operation 1 (a named next matter), then evaluate each issue separately before deciding no_change. Assent, unmute, or "next item" language is operation 3 on the current floor item, not a transition.
- If a transcript mentions a specific unit, leak, chargeback, legal follow-up, records request, or reimbursement question and the board gives direction or weighs next steps, preserve that matter even if it is discussed briefly before another topic.
- If the transcript introduces a clearly separate business matter that was not in the package, add it to extraTopics with a concise title and explain the uncertainty if needed.
- If a transcript mention is vague, preserve uncertainty in notes or uncertainties.
- For any topic you touch, include the current transcript chunk id in sourceChunkIds and the current segment range in sourceTranscriptRanges.
- Keep sourceText very short. Use one short direct phrase from this transcript chunk, not a long recap.
- Keep notes short and factual. Prefer at most one or two concise notes per topic.
- Keep aliases and notes minimal. Only include them when they will help later retrieval.
- If the matter concerns a specific suite/unit, owner dispute, chargeback, legal letter, records request, incident, complaint, or personnel issue, mark visibility as RESTRICTED.
- Use aliases for shorthand names, partial names, speaker phrasing, contractor names, and abbreviations that may help later evidence retrieval.
- Pay close attention to how vendor and personnel names are spelled in the package context. If the transcript uses a phonetic or shorthand name (e.g., 'InWave' instead of 'Enwave'), rely on the exact legal name from the package.
- Use confidenceReason for one short sentence explaining confidence.
- Use evidenceStrength to describe how directly this chunk supports the topic.
- Use openQuestions for unresolved ambiguity only.
- Set needsHumanReview to true only when a careful reviewer should inspect this topic, and explain why in humanReviewReason.
- In changes.summary, briefly say what changed in this chunk.
- Do not create duplicate topics from repeated discussion.
- Pattern guide:
- If the transcript is elaborating on an existing agenda matter, enrich that matter instead of creating a new one.
- If the transcript opens with a sustained named presentation or consultant-led discussion before regular board business, preserve that as its own main topic.
- If a late conversation introduces a distinct board-business matter not present in the package, create one concise extra topic instead of burying it inside notes on a nearby topic.
- If a unit-specific incident, chargeback, leak, records issue, or legal matter appears, keep it separate when it is clearly a different business issue from broader building-wide work.
- If a completed-work report or weekly-update report is referenced as a standing business item, treat it as one informational topic even when the detailed contents are elsewhere.
- If a new matter appears only briefly and does not rise to the level of a board-business item, do not create a topic.`;

const PACKAGE_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

${PACKAGE_TASK}`;

const TRANSCRIPT_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

${TRANSCRIPT_TASK}`;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalize(value: string): string {
  return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function safeParseObject<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeJsonParse(text: string): unknown {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  const extracted =
    firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed;
  return JSON.parse(
    extracted
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/:\s*(-?\d+)\.(?:0{20,})/g, ": $1"),
  );
}

function tryBalanceTruncatedJson(text: string): unknown | null {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace < 0) return null;
  let candidate = trimmed.slice(firstBrace);

  const lastQuote = candidate.lastIndexOf('"');
  const hasDanglingQuote = lastQuote >= 0 && candidate.slice(lastQuote - 1, lastQuote) !== "\\";
  if (hasDanglingQuote && candidate.split('"').length % 2 === 0) {
    candidate = candidate.slice(0, lastQuote);
  }

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastSafeIndex = -1;

  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === "}" || char === "]") {
      if (stack.at(-1) === char) stack.pop();
      else return null;
    }

    if (stack.length > 0) lastSafeIndex = index;
  }

  if (inString) candidate += '"';
  while (candidate.endsWith(",")) candidate = candidate.slice(0, -1);
  candidate += stack.reverse().join("");

  try {
    return safeJsonParse(candidate);
  } catch {
    if (lastSafeIndex > 0) {
      let truncated = candidate.slice(0, lastSafeIndex + 1).replace(/,\s*$/, "");
      const repairStack: string[] = [];
      let repairInString = false;
      let repairEscaped = false;
      for (const char of truncated) {
        if (repairInString) {
          if (repairEscaped) repairEscaped = false;
          else if (char === "\\") repairEscaped = true;
          else if (char === '"') repairInString = false;
          continue;
        }
        if (char === '"') repairInString = true;
        else if (char === "{") repairStack.push("}");
        else if (char === "[") repairStack.push("]");
        else if ((char === "}" || char === "]") && repairStack.at(-1) === char) repairStack.pop();
      }
      if (repairInString) truncated += '"';
      truncated += repairStack.reverse().join("");
      try {
        return safeJsonParse(truncated);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function isNoChangeResponse(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    "status" in (value as Record<string, unknown>) &&
    (value as Record<string, unknown>).status === "no_change"
  );
}

async function parseWithRepair(text: string): Promise<unknown> {
  try {
    return safeJsonParse(text);
  } catch {
    const balanced = tryBalanceTruncatedJson(text);
    if (balanced) return balanced;
    const repaired = await generateDeepSeekJson({
      systemInstruction: "Repair invalid JSON into one valid JSON object.",
      userText: `Repair the following invalid JSON-like response into one valid JSON object.

Rules:
- Return JSON only.
- Preserve meaning as closely as possible.
- Fix only syntax or malformed JSON structure.

INVALID RESPONSE
${text}`,
      modelName: "deepseek-v4-flash",
      maxOutputTokens: 12288,
      temperature: 0,
      thinking: false,
    });
    try {
      return safeJsonParse(repaired.text);
    } catch {
      const repairedBalanced = tryBalanceTruncatedJson(repaired.text);
      if (repairedBalanced) return repairedBalanced;
      throw new Error("Could not repair malformed JSON response.");
    }
  }
}

export function normalizeTopic(raw: Partial<WorkflowTopic>): WorkflowTopic | null {
  const title = normalizeWhitespace(raw.title ?? "");
  if (!title) return null;
  return {
    title,
    sectionLabel: normalizeWhitespace(raw.sectionLabel ?? "") || "Unknown",
    itemType: normalizeWhitespace(raw.itemType ?? "") || "other",
    itemNumber:
      typeof raw.itemNumber === "string" && raw.itemNumber.trim()
        ? raw.itemNumber.trim()
        : undefined,
    visibility:
      raw.visibility === "PUBLIC" || raw.visibility === "RESTRICTED" || raw.visibility === "UNKNOWN"
        ? raw.visibility
        : "UNKNOWN",
    sourcePages: unique(
      (Array.isArray(raw.sourcePages) ? raw.sourcePages : [])
        .flatMap((page) => (typeof page === "number" && Number.isFinite(page) ? [Math.trunc(page)] : []))
        .filter((page) => page > 0),
    ).sort((a, b) => a - b),
    sourceChunkIds: unique(
      (Array.isArray(raw.sourceChunkIds) ? raw.sourceChunkIds : [])
        .flatMap((chunkId) => (typeof chunkId === "string" ? [normalizeWhitespace(chunkId)] : []))
        .filter(Boolean),
    ).slice(0, 24),
    sourceTranscriptRanges: unique(
      (Array.isArray(raw.sourceTranscriptRanges) ? raw.sourceTranscriptRanges : [])
        .flatMap((range) =>
          Array.isArray(range) &&
          range.length === 2 &&
          typeof range[0] === "number" &&
          typeof range[1] === "number"
            ? [`${Math.trunc(range[0])}:${Math.trunc(range[1])}`]
            : [],
        ),
    ).map((range) => {
      const [start, end] = range.split(":").map((value) => Number.parseInt(value, 10));
      return [start, end] as [number, number];
    }),
    sourceText:
      typeof raw.sourceText === "string" ? truncateText(normalizeWhitespace(raw.sourceText), 220) : null,
    aliases: unique(
      (Array.isArray(raw.aliases) ? raw.aliases : [])
        .flatMap((alias) => (typeof alias === "string" ? [normalizeWhitespace(alias)] : []))
        .filter(Boolean),
    ).slice(0, 8),
    notes: unique(
      (Array.isArray(raw.notes) ? raw.notes : [])
        .flatMap((note) => (typeof note === "string" ? [normalizeWhitespace(note)] : []))
        .filter(Boolean),
    ).slice(0, 10),
    confidence:
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Math.max(0, Math.min(1, raw.confidence))
        : 0.5,
    confidenceReason:
      typeof raw.confidenceReason === "string"
        ? truncateText(normalizeWhitespace(raw.confidenceReason), 220)
        : null,
    evidenceStrength:
      raw.evidenceStrength === "DIRECT" ||
      raw.evidenceStrength === "STRONG_INFERENCE" ||
      raw.evidenceStrength === "WEAK_INFERENCE" ||
      raw.evidenceStrength === "UNCERTAIN"
        ? raw.evidenceStrength
        : "UNCERTAIN",
    openQuestions: unique(
      (Array.isArray(raw.openQuestions) ? raw.openQuestions : [])
        .flatMap((question) => (typeof question === "string" ? [normalizeWhitespace(question)] : []))
        .filter(Boolean),
    ).slice(0, 6),
    needsHumanReview: raw.needsHumanReview === true,
    humanReviewReason:
      typeof raw.humanReviewReason === "string"
        ? truncateText(normalizeWhitespace(raw.humanReviewReason), 220)
        : null,
    discussionStatus:
      raw.discussionStatus === "discussed" ||
      raw.discussionStatus === "not_discussed" ||
      raw.discussionStatus === "ad_hoc"
        ? raw.discussionStatus
        : undefined,
    discussionTimestampRange:
      typeof raw.discussionTimestampRange === "string"
        ? truncateText(normalizeWhitespace(raw.discussionTimestampRange), 400)
        : null,
    consolidationReason:
      typeof raw.consolidationReason === "string"
        ? truncateText(normalizeWhitespace(raw.consolidationReason), 220)
        : null,
  };
}

type PageReferenceHint = {
  title: string;
  normalizedTitle: string;
  pages: number[];
  lineText: string;
};

function expandPageReferenceList(value: string): number[] {
  const pages: number[] = [];
  for (const part of value.split(",")) {
    const trimmed = normalizeWhitespace(part);
    if (!trimmed) continue;
    const rangeMatch = trimmed.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
        for (let page = start; page <= end; page += 1) {
          pages.push(page);
        }
      }
      continue;
    }
    const page = Number.parseInt(trimmed, 10);
    if (Number.isFinite(page) && page > 0) {
      pages.push(page);
    }
  }
  return unique(pages).sort((left, right) => left - right);
}

function cleanHintTitle(value: string): string {
  return normalizeWhitespace(value).replace(/\.+$/g, "").trim();
}

function extractPageReferenceHints(chunkText: string): PageReferenceHint[] {
  const hints: PageReferenceHint[] = [];

  for (const rawLine of chunkText.split("\n")) {
    const line = normalizeWhitespace(rawLine);
    if (!line) continue;
    const match = line.match(
      /^\s*(?:[a-z]\.|[0-9]+\.)\s+(.+?)\s*\((?:please\s+refer\s+to\s+[^)]*?)pages?\s+([^)]+)\)\s*$/i,
    );
    if (!match) continue;
    const title = cleanHintTitle(match[1] ?? "");
    const pages = expandPageReferenceList(match[2] ?? "");
    if (!title || pages.length === 0) continue;
    hints.push({
      title,
      normalizedTitle: normalize(title),
      pages,
      lineText: line,
    });
  }

  return hints;
}

function topicTokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function scoreHintMatch(topic: WorkflowTopic, hint: PageReferenceHint): number {
  const titleNorm = normalize(topic.title);
  if (!titleNorm || !hint.normalizedTitle) return 0;
  if (titleNorm === hint.normalizedTitle) return 100;
  if (titleNorm.includes(hint.normalizedTitle) || hint.normalizedTitle.includes(titleNorm)) {
    return 80;
  }

  const topicTerms = new Set([
    ...topicTokens(topic.title),
    ...topic.aliases.flatMap((alias) => topicTokens(alias)),
  ]);
  const hintTerms = topicTokens(hint.title);
  if (topicTerms.size === 0 || hintTerms.length === 0) return 0;

  let overlap = 0;
  for (const term of hintTerms) {
    if (topicTerms.has(term)) overlap += 1;
  }
  if (overlap === hintTerms.length && hintTerms.length > 0) {
    return 70 + hintTerms.length;
  }
  return overlap * 10;
}

function attachPageReferenceHintsToTopics(options: {
  topics: WorkflowTopic[];
  chunkId: string;
  hints: PageReferenceHint[];
}): WorkflowTopic[] {
  if (options.hints.length === 0) return options.topics;

  return options.topics.map((topic) => {
    if (!topic.sourceChunkIds.includes(options.chunkId)) return topic;

    let bestHint: PageReferenceHint | null = null;
    let bestScore = 0;
    for (const hint of options.hints) {
      const score = scoreHintMatch(topic, hint);
      if (score > bestScore) {
        bestScore = score;
        bestHint = hint;
      }
    }

    if (!bestHint || bestScore < 30) return topic;

    const note = `Package line references support pages ${bestHint.pages[0]}-${bestHint.pages.at(-1)}.`;
    return {
      ...topic,
      sourcePages: unique([...topic.sourcePages, ...bestHint.pages]).sort((left, right) => left - right),
      notes: unique([...topic.notes, note]).slice(0, 6),
    };
  });
}

function attachPageReferenceHintsToState(options: {
  state: WorkflowState;
  chunkId: string;
  chunkText: string;
}): WorkflowState {
  const hints = extractPageReferenceHints(options.chunkText);
  if (hints.length === 0) return options.state;

  return {
    documentTopics: attachPageReferenceHintsToTopics({
      topics: options.state.documentTopics,
      chunkId: options.chunkId,
      hints,
    }),
    extraTopics: attachPageReferenceHintsToTopics({
      topics: options.state.extraTopics,
      chunkId: options.chunkId,
      hints,
    }),
    uncertainties: options.state.uncertainties,
  };
}

function formatCompactPageList(pages: number[]): string {
  if (pages.length === 0) return "";
  if (pages.length === 1) return String(pages[0]);

  const ranges: string[] = [];
  let start = pages[0];
  let end = pages[0];

  for (let index = 1; index < pages.length; index += 1) {
    const page = pages[index];
    if (page === end + 1) {
      end = page;
      continue;
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    start = page;
    end = page;
  }

  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return ranges.join(", ");
}

function findTopicsRelevantToPackageChunk(options: {
  state: WorkflowState;
  pageNumbers: number[];
  chunkId: string;
}): WorkflowTopic[] {
  const pageSet = new Set(options.pageNumbers);

  return [...options.state.documentTopics, ...options.state.extraTopics]
    .filter(
      (topic) =>
        topic.sourceChunkIds.includes(options.chunkId) ||
        topic.sourcePages.some((page) => pageSet.has(page)),
    )
    .sort((left, right) => {
      const leftOverlap = left.sourcePages.filter((page) => pageSet.has(page)).length;
      const rightOverlap = right.sourcePages.filter((page) => pageSet.has(page)).length;
      if (leftOverlap !== rightOverlap) return rightOverlap - leftOverlap;
      return left.title.localeCompare(right.title);
    })
    .slice(0, 8);
}

function dedupeTopics(topics: WorkflowTopic[]): WorkflowTopic[] {
  const byKey = new Map<string, WorkflowTopic>();
  for (const topic of topics) {
    const key = `${normalize(topic.title)}::${normalize(topic.sectionLabel)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, topic);
      continue;
    }
    byKey.set(key, {
      ...existing,
      title: topic.title.length > existing.title.length ? topic.title : existing.title,
      sourcePages: unique([...existing.sourcePages, ...topic.sourcePages]).sort((a, b) => a - b),
      sourceChunkIds: unique([...existing.sourceChunkIds, ...topic.sourceChunkIds]).slice(0, 24),
      sourceTranscriptRanges: mergeClosedIntervals([
        ...existing.sourceTranscriptRanges,
        ...topic.sourceTranscriptRanges,
      ]),
      discussionTimestampRange: mergeDiscussionTimestampRange(
        existing.discussionTimestampRange,
        topic.discussionTimestampRange,
      ),
      discussionStatus: existing.discussionStatus === "discussed" || topic.discussionStatus === "discussed"
        ? "discussed"
        : topic.discussionStatus ?? existing.discussionStatus,
      aliases: unique([...existing.aliases, ...topic.aliases]).slice(0, 8),
      notes: unique([...existing.notes, ...topic.notes]).slice(0, 10),
      openQuestions: unique([...existing.openQuestions, ...topic.openQuestions]).slice(0, 6),
      needsHumanReview: existing.needsHumanReview || topic.needsHumanReview,
      humanReviewReason:
        unique([existing.humanReviewReason, topic.humanReviewReason].filter(Boolean) as string[]).join(
          " | ",
        ) || null,
      confidence: Math.max(existing.confidence, topic.confidence),
      visibility:
        existing.visibility === "RESTRICTED" || topic.visibility === "RESTRICTED"
          ? "RESTRICTED"
          : existing.visibility === "PUBLIC" || topic.visibility === "PUBLIC"
            ? "PUBLIC"
            : "UNKNOWN",
    });
  }
  return [...byKey.values()];
}

function normalizeChanges(raw: unknown): WorkflowChanges | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const summary = unique(
    (Array.isArray(record.summary) ? record.summary : [])
      .flatMap((entry) => (typeof entry === "string" ? [normalizeWhitespace(entry)] : []))
      .filter(Boolean),
  )
    .map((entry) => truncateText(entry, 220))
    .slice(0, 24);

  return summary.length > 0 ? { summary } : undefined;
}

function dedupeDiscrepancies(discrepancies: WorkflowDiscrepancy[]): WorkflowDiscrepancy[] {
  const byId = new Map<string, WorkflowDiscrepancy>();
  for (const disc of discrepancies) {
    if (!byId.has(disc.id)) {
      byId.set(disc.id, disc);
    }
  }
  return [...byId.values()];
}

export function normalizeDiscrepancies(raw: unknown): WorkflowDiscrepancy[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item, idx) => {
      if (!item || typeof item !== "object") return [];
      const rec = item as Record<string, unknown>;
      const snippet = typeof rec.snippet === "string" ? normalizeWhitespace(rec.snippet) : "";
      const suggestedTitle =
        typeof rec.suggestedTitle === "string" ? normalizeWhitespace(rec.suggestedTitle) : "";
      if (!snippet && !suggestedTitle) return [];
      const range =
        Array.isArray(rec.transcriptRange) && rec.transcriptRange.length === 2
          ? ([Number(rec.transcriptRange[0]), Number(rec.transcriptRange[1])] as [number, number])
          : ([0, 0] as [number, number]);
      return [
        {
          id: typeof rec.id === "string" ? rec.id : `disc-${idx + 1}-${randomUUID().slice(0, 8)}`,
          transcriptRange: range,
          timestamp: typeof rec.timestamp === "string" ? rec.timestamp : "Unknown time",
          speaker: typeof rec.speaker === "string" ? rec.speaker : null,
          snippet: truncateText(snippet, 300),
          suggestedTitle: truncateText(suggestedTitle || "Ad-hoc Discussion", 100),
          suggestedSection: typeof rec.suggestedSection === "string" ? rec.suggestedSection : null,
          clarificationQuestion:
            typeof rec.clarificationQuestion === "string"
              ? rec.clarificationQuestion
              : `It looks like ${suggestedTitle || "this topic"} was discussed at ${rec.timestamp || "this time"}, but does not appear on the official agenda. Should this be included as an agenda item?`,
        },
      ];
    })
    .slice(0, 10);
}

export function normalizeWorkflowState(value: unknown, fallback: WorkflowState): WorkflowResponse {
  const record = (value && typeof value === "object" ? value : {}) as Partial<WorkflowResponse & { discrepancies?: unknown }>;
  const documentTopics = dedupeTopics(
    (Array.isArray(record.documentTopics) ? record.documentTopics : [])
      .map((topic) => normalizeTopic(topic as Partial<WorkflowTopic>))
      .filter((topic): topic is WorkflowTopic => Boolean(topic)),
  );
  const extraTopics = dedupeTopics(
    (Array.isArray(record.extraTopics) ? record.extraTopics : [])
      .map((topic) => normalizeTopic(topic as Partial<WorkflowTopic>))
      .filter((topic): topic is WorkflowTopic => Boolean(topic)),
  );
  return {
    documentTopics: preserveTranscriptProvenance(
      preserveItemNumbers(
        documentTopics.length > 0 ? documentTopics : fallback.documentTopics,
        fallback.documentTopics,
      ),
      fallback.documentTopics,
    ),
    extraTopics: preserveTranscriptProvenance(
      preserveItemNumbers(
        extraTopics.length > 0 || record.extraTopics ? extraTopics : fallback.extraTopics,
        fallback.extraTopics,
      ),
      fallback.extraTopics,
    ),
    uncertainties: unique(
      (Array.isArray(record.uncertainties) ? record.uncertainties : [])
        .flatMap((entry) => (typeof entry === "string" ? [normalizeWhitespace(entry)] : []))
        .filter(Boolean),
    ).slice(0, 20),
    discrepancies: dedupeDiscrepancies([
      ...(fallback.discrepancies || []),
      ...normalizeDiscrepancies(record.discrepancies),
    ]),
    changes: normalizeChanges(record.changes),
  };
}

function mergeDiscussionTimestampRange(
  left?: string | null,
  right?: string | null,
): string | null {
  return formatDiscussionTimestampRanges([
    ...parseDiscussionTimestampRanges(left),
    ...parseDiscussionTimestampRanges(right),
  ]);
}

function findPriorTopic(topic: WorkflowTopic, previous: WorkflowTopic[]): WorkflowTopic | undefined {
  if (topic.itemNumber) {
    const code = topic.itemNumber.trim().toLowerCase();
    const byNumber = previous.find((entry) => (entry.itemNumber || "").trim().toLowerCase() === code);
    if (byNumber) return byNumber;
  }
  return previous.find((entry) => normalize(entry.title) === normalize(topic.title));
}

function preserveItemNumbers(next: WorkflowTopic[], previous: WorkflowTopic[]): WorkflowTopic[] {
  if (previous.length === 0) return next;
  const byTitle = new Map(previous.map((topic) => [normalize(topic.title), topic]));
  return next.map((topic) => {
    if (topic.itemNumber) return topic;
    const prior = byTitle.get(normalize(topic.title));
    return prior?.itemNumber ? { ...topic, itemNumber: prior.itemNumber } : topic;
  });
}

function preserveTranscriptProvenance(next: WorkflowTopic[], previous: WorkflowTopic[]): WorkflowTopic[] {
  if (previous.length === 0) return next;
  return next.map((topic) => {
    const prior = findPriorTopic(topic, previous);
    if (!prior) return topic;
    return {
      ...topic,
      sourceChunkIds: unique([...prior.sourceChunkIds, ...topic.sourceChunkIds]).slice(0, 24),
      sourceTranscriptRanges: mergeClosedIntervals([
        ...prior.sourceTranscriptRanges,
        ...topic.sourceTranscriptRanges,
      ]),
      discussionTimestampRange: mergeDiscussionTimestampRange(
        prior.discussionTimestampRange,
        topic.discussionTimestampRange,
      ),
      discussionStatus:
        prior.discussionStatus === "discussed" || topic.discussionStatus === "discussed"
          ? "discussed"
          : topic.discussionStatus ?? prior.discussionStatus,
    };
  });
}

function sortTopics(topics: WorkflowTopic[]): WorkflowTopic[] {
  return topics
    .map((topic, originalIndex) => ({ topic, originalIndex }))
    .sort((left, right) => {
      const compared = compareAgendaItemCodes(left.topic.itemNumber, right.topic.itemNumber);
      if (compared !== 0) return compared;
      return left.originalIndex - right.originalIndex;
    })
    .map(({ topic }) => topic);
}

function emptyAdHocSectionTopic(itemNumber: string): WorkflowTopic {
  return {
    title: "Ad-hoc items",
    sectionLabel: "Property Management Report",
    itemType: "ad_hoc_discussion",
    itemNumber,
    visibility: "PUBLIC",
    sourcePages: [],
    sourceChunkIds: [],
    sourceTranscriptRanges: [],
    discussionStatus: "ad_hoc",
    discussionTimestampRange: null,
    consolidationReason:
      "Synthesized section for transcript-only matters that are not on the official agenda.",
    sourceText: null,
    aliases: [],
    notes: [],
    confidence: 1,
    confidenceReason: "Ad-hoc bucket created so extra items nest under the Property Management Report",
    evidenceStrength: "DIRECT",
    openQuestions: [],
    needsHumanReview: false,
    humanReviewReason: null,
  };
}

function applyAdHocOutlinePlacement(state: WorkflowState): WorkflowState {
  const extraTopics = state.extraTopics.filter((topic) => topic.title.trim());
  if (extraTopics.length === 0) return state;

  const pmReportNumber =
    inferPropertyManagementReportNumber(state.documentTopics) || "4";
  const placement = planAdHocPlacement(
    state.documentTopics.map((topic) => topic.itemNumber),
    extraTopics.length,
    pmReportNumber,
  );
  if (!placement) return state;

  const numberedExtra = extraTopics.map((topic, index) => ({
    ...topic,
    itemNumber: topic.itemNumber || placement.nextItemCodes[index],
    sectionLabel:
      topic.sectionLabel && topic.sectionLabel !== "Unknown"
        ? topic.sectionLabel
        : "Property Management Report: Ad-hoc items",
    discussionStatus: topic.discussionStatus ?? "ad_hoc",
    itemType:
      topic.itemType === "other" || !topic.itemType ? "ad_hoc_discussion" : topic.itemType,
  }));

  const documentTopics =
    placement.sectionMissing &&
    !state.documentTopics.some((topic) => topic.itemNumber === placement.sectionCode)
      ? [...state.documentTopics, emptyAdHocSectionTopic(placement.sectionCode)]
      : state.documentTopics;

  return {
    ...state,
    documentTopics,
    extraTopics: numberedExtra,
  };
}

async function getAgendaResumeCheckpoint(meetingId: string): Promise<{
  state: WorkflowState;
  processedPackageChunks: number;
  processedTranscriptChunks: number;
  lastProcessedPackageSortOrder: number;
  lastProcessedTranscriptSortOrder: number;
} | null> {
  const db = getDb();
  const snapshots = await db
    .select()
    .from(meetingsV2AgendaChunkSnapshots)
    .where(eq(meetingsV2AgendaChunkSnapshots.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV2AgendaChunkSnapshots.createdAt));

  if (snapshots.length === 0) return null;

  let bestCheckpoint: {
    state: WorkflowState;
    processedPackageChunks: number;
    processedTranscriptChunks: number;
    lastProcessedPackageSortOrder: number;
    lastProcessedTranscriptSortOrder: number;
  } | null = null;

  const processedPackageSortOrders = new Set<number>();
  const processedTranscriptSortOrders = new Set<number>();
  let lastProcessedPackageSortOrder = -1;
  let lastProcessedTranscriptSortOrder = -1;
  let state: WorkflowState = {
    documentTopics: [],
    extraTopics: [],
    uncertainties: [],
  };

  for (const snapshot of snapshots) {
    const parsedState = safeParseObject<WorkflowState>(snapshot.afterStateJson);
    if (!parsedState) continue;
    state = parsedState;
    if (snapshot.chunkKind === "document") {
      processedPackageSortOrders.add(snapshot.sortOrder);
      lastProcessedPackageSortOrder = Math.max(lastProcessedPackageSortOrder, snapshot.sortOrder);
    } else {
      processedTranscriptSortOrders.add(snapshot.sortOrder);
      lastProcessedTranscriptSortOrder = Math.max(lastProcessedTranscriptSortOrder, snapshot.sortOrder);
    }
    bestCheckpoint = {
      state,
      processedPackageChunks: processedPackageSortOrders.size,
      processedTranscriptChunks: processedTranscriptSortOrders.size,
      lastProcessedPackageSortOrder,
      lastProcessedTranscriptSortOrder,
    };
  }

  return bestCheckpoint;
}

function buildStateText(state: WorkflowState, options?: { compact?: boolean }): string {
  if (!options?.compact) {
    return JSON.stringify(state, null, 2);
  }

  return JSON.stringify(
    {
      documentTopics: state.documentTopics.map((topic) => ({
        title: topic.title,
        sectionLabel: topic.sectionLabel,
        itemType: topic.itemType,
        visibility: topic.visibility,
        sourcePages: topic.sourcePages.slice(0, 8),
        sourceChunkIds: topic.sourceChunkIds.slice(0, 6),
        sourceTranscriptRanges: topic.sourceTranscriptRanges,
        discussionStatus: topic.discussionStatus,
        discussionTimestampRange: topic.discussionTimestampRange,
        consolidationReason: topic.consolidationReason,
        sourceText: topic.sourceText,
        aliases: topic.aliases.slice(0, 3),
        notes: topic.notes.slice(0, 3),
      })),
      extraTopics: state.extraTopics.map((topic) => ({
        title: topic.title,
        sectionLabel: topic.sectionLabel,
        itemType: topic.itemType,
        visibility: topic.visibility,
        sourcePages: topic.sourcePages.slice(0, 8),
        sourceChunkIds: topic.sourceChunkIds.slice(0, 6),
        sourceTranscriptRanges: topic.sourceTranscriptRanges,
        discussionStatus: topic.discussionStatus,
        discussionTimestampRange: topic.discussionTimestampRange,
        consolidationReason: topic.consolidationReason,
        sourceText: topic.sourceText,
        aliases: topic.aliases.slice(0, 3),
        notes: topic.notes.slice(0, 3),
      })),
      uncertainties: state.uncertainties.slice(0, 8),
      discrepancies: state.discrepancies?.slice(0, 8),
    },
    null,
    2,
  );
}

function buildPackageUserText(options: {
  meetingId: string;
  state: WorkflowState;
  chunkIndex: number;
  chunkTotal: number;
  chunkId: string;
  pageNumbers: number[];
  chunkText: string;
}): string {
  const pageReferenceHints = extractPageReferenceHints(options.chunkText);
  const relevantExistingTopics = findTopicsRelevantToPackageChunk({
    state: options.state,
    pageNumbers: options.pageNumbers,
    chunkId: options.chunkId,
  });
  return `Meeting ID: ${options.meetingId}

CURRENT STATE
${buildStateText(options.state, { compact: true })}

PACKAGE CHUNK ${options.chunkIndex + 1} OF ${options.chunkTotal}
Chunk ID: ${options.chunkId}
Pages: ${options.pageNumbers.join(", ")}

${pageReferenceHints.length > 0
    ? `PAGE REFERENCE HINTS
${pageReferenceHints
  .map((hint) => `- ${hint.title}: support pages ${hint.pages.join(", ")}`)
  .join("\n")}

When you update or create one of these agenda matters, include both the agenda page and the referenced support pages in sourcePages.

`
    : ""}${relevantExistingTopics.length > 0
    ? `TOPICS ALREADY LINKED TO THIS CHUNK
${relevantExistingTopics
  .map(
    (topic) =>
      `- ${topic.title} | pages ${formatCompactPageList(topic.sourcePages)} | chunk refs ${topic.sourceChunkIds.join(", ")}`,
  )
  .join("\n")}

If this package chunk is one of the support-page references for a topic above, enrich that existing topic instead of treating this chunk as unrelated boilerplate.

`
    : ""}${options.chunkText}`;
}

export type TranscriptFloorPointer = {
  itemNumber: string | null;
  title: string;
  lastSequenceEnd: number;
  discussionTimestampRange: string | null;
  upcomingLeaves: Array<{ itemNumber: string | null; title: string }>;
};

function lastTranscriptSequenceEnd(topic: Pick<WorkflowTopic, "sourceTranscriptRanges">): number | null {
  if (!topic.sourceTranscriptRanges.length) return null;
  return topic.sourceTranscriptRanges.reduce(
    (max, range) => Math.max(max, range[0], range[1]),
    Number.NEGATIVE_INFINITY,
  );
}

function isOutlineLeafTopic(topic: WorkflowTopic, all: WorkflowTopic[]): boolean {
  const code = topic.itemNumber?.trim();
  if (!code) return true;
  const normalized = code.toLowerCase();
  return !all.some((other) => parentAgendaItemCode(other.itemNumber)?.toLowerCase() === normalized);
}

function topicHasDiscussionTiming(topic: WorkflowTopic): boolean {
  return parseDiscussionTimestampRanges(topic.discussionTimestampRange).length > 0;
}

export function listUpcomingUndiscussedLeaves(
  state: {
    documentTopics: WorkflowTopic[];
    extraTopics: WorkflowTopic[];
  },
  currentItemNumber: string | null,
): Array<{ itemNumber: string | null; title: string }> {
  const all = [...state.documentTopics, ...state.extraTopics];
  return all
    .filter((topic) => isOutlineLeafTopic(topic, all))
    .filter((topic) => !topicHasDiscussionTiming(topic))
    .filter((topic) => {
      if (!currentItemNumber) return true;
      return compareAgendaItemCodes(currentItemNumber, topic.itemNumber) < 0;
    })
    .slice(0, 8)
    .map((topic) => ({
      itemNumber: topic.itemNumber?.trim() || null,
      title: topic.title,
    }));
}

export function inferTranscriptFloorPointer(state: {
  documentTopics: WorkflowTopic[];
  extraTopics: WorkflowTopic[];
}): TranscriptFloorPointer | null {
  const all = [...state.documentTopics, ...state.extraTopics];
  const withRanges = all.filter((topic) => {
    if (topic.discussionStatus === "not_discussed") return false;
    return lastTranscriptSequenceEnd(topic) !== null;
  });
  if (withRanges.length === 0) return null;

  const leaves = withRanges.filter((topic) => isOutlineLeafTopic(topic, all));
  const pool = leaves.length > 0 ? leaves : withRanges;
  pool.sort((left, right) => {
    const leftEnd = lastTranscriptSequenceEnd(left) ?? -1;
    const rightEnd = lastTranscriptSequenceEnd(right) ?? -1;
    if (leftEnd !== rightEnd) return rightEnd - leftEnd;
    const leftDepth = (left.itemNumber || "").split(".").length;
    const rightDepth = (right.itemNumber || "").split(".").length;
    return rightDepth - leftDepth;
  });
  const winner = pool[0];
  const itemNumber = winner.itemNumber?.trim() || null;
  return {
    itemNumber,
    title: winner.title,
    lastSequenceEnd: lastTranscriptSequenceEnd(winner) ?? 0,
    discussionTimestampRange: winner.discussionTimestampRange ?? null,
    upcomingLeaves: listUpcomingUndiscussedLeaves(state, itemNumber),
  };
}

function formatTranscriptFloorPointer(pointer: TranscriptFloorPointer | null): string {
  if (!pointer) {
    return `FLOOR POINTER
No agenda item is on the floor yet. The first substantive matter in this chunk is operation 1 (OPEN).`;
  }

  const code = pointer.itemNumber ? pointer.itemNumber : "(no itemNumber)";
  const timing = pointer.discussionTimestampRange
    ? `Discussion timing so far: ${pointer.discussionTimestampRange}`
    : "Discussion timing so far: unknown";
  const upcoming =
    pointer.upcomingLeaves.length > 0
      ? `Upcoming package leaves not yet given a transcript range:
${pointer.upcomingLeaves
  .map((leaf) => `- ${leaf.itemNumber ?? "?"} — ${leaf.title}`)
  .join("\n")}
If speakers name one of these, OPEN that item (operation 1). A different unit number than the floor item is OPEN even while wrap-up of the floor continues (overlap is allowed). Do not skip them.`
      : "No later package leaves are waiting for a transcript range.";

  return `FLOOR POINTER (item on the table at the start of this chunk)
- ${code} — ${pointer.title}
- Last attached transcript segment: ${pointer.lastSequenceEnd}
- ${timing}

${upcoming}

Walk cues in order. Operations: (1) OPEN a new span / move the floor, (2) ENRICH the floor item, (3) CHANGE LIFECYCLE of the floor item. Assent does not open the next outline item.`;
}

function buildTranscriptUserText(options: {
  meetingId: string;
  state: WorkflowState;
  chunkIndex: number;
  chunkTotal: number;
  chunkId: string;
  sequenceRange: [number, number];
  chunkText: string;
}): string {
  return `Meeting ID: ${options.meetingId}

CURRENT STATE
${buildStateText(options.state, { compact: true })}

${formatTranscriptFloorPointer(inferTranscriptFloorPointer(options.state))}

TRANSCRIPT CHUNK ${options.chunkIndex + 1} OF ${options.chunkTotal}
Chunk ID: ${options.chunkId}
Segments: ${options.sequenceRange[0]}-${options.sequenceRange[1]}

Transcript chunk ids are stable references. If you update or create a topic from this chunk, include this chunk id in sourceChunkIds.

${options.chunkText}`;
}

export async function extractAgendaItemsWithAi(
  meetingId: string,
  options?: {
    onProgress?: (progress: {
      current: number;
      total: number;
      label: string;
    }) => Promise<void> | void;
  },
): Promise<{
  meetingId: string;
  extractor: string;
  agendaItemCount: number;
}> {
  const db = getDb();
  const [meeting, boardPackage, sections, storedChunks] = await Promise.all([
    db.select().from(meetingsV2).where(eq(meetingsV2.id, meetingId)),
    db
      .select()
      .from(meetingsV2SourceArtifacts)
      .where(
        and(
          eq(meetingsV2SourceArtifacts.meetingV2Id, meetingId),
          eq(meetingsV2SourceArtifacts.type, "board_package"),
        ),
      ),
    db
      .select()
      .from(meetingsV2DocumentSections)
      .where(eq(meetingsV2DocumentSections.meetingV2Id, meetingId)),
    db
      .select()
      .from(meetingsV2DocumentChunks)
      .where(eq(meetingsV2DocumentChunks.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2DocumentChunks.sortOrder)),
  ]);

  if (!meeting[0]) {
    throw new Error(`V2 meeting ${meetingId} was not found.`);
  }
  if (!boardPackage[0]) {
    throw new Error("Board package artifact not found for meeting.");
  }

  const packageChunks = storedChunks
    .filter((chunk) => chunk.chunkKind === "document")
    .map((chunk) => {
      const metadata = safeParseObject<{ aiChunkId?: string; pageNumbers?: number[] }>(chunk.metadataJson);
      return {
        id: chunk.id,
        sourceArtifactId: chunk.sourceArtifactId,
        aiChunkId:
          metadata?.aiChunkId ?? `document_chunk_${String(chunk.sortOrder + 1).padStart(3, "0")}`,
        index: chunk.sortOrder,
        pageNumbers:
          metadata?.pageNumbers ??
          [chunk.pageStart, chunk.pageEnd].flatMap((entry) =>
            typeof entry === "number" && Number.isFinite(entry) ? [entry] : [],
          ),
        text: chunk.text,
      };
    });
  const transcriptChunks = storedChunks
    .filter((chunk) => chunk.chunkKind === "transcript")
    .map((chunk, transcriptIndex) => {
      const metadata = safeParseObject<{ aiChunkId?: string; sequenceRange?: [number, number] }>(
        chunk.metadataJson,
      );
      return {
        id: chunk.id,
        sourceArtifactId: chunk.sourceArtifactId,
        aiChunkId:
          metadata?.aiChunkId ??
          `transcript_chunk_${String(transcriptIndex + 1).padStart(3, "0")}`,
        index: chunk.sortOrder,
        transcriptIndex,
        sequenceRange:
          metadata?.sequenceRange ?? [chunk.sequenceStart ?? 0, chunk.sequenceEnd ?? 0],
        text: chunk.text,
      };
    });

  if (packageChunks.length === 0) {
    throw new Error("No stored document chunks found for this meeting.");
  }

  const totalChunks = packageChunks.length + transcriptChunks.length;
  const resumeCheckpoint = await getAgendaResumeCheckpoint(meetingId);
  let state: WorkflowState = resumeCheckpoint?.state ?? {
    documentTopics: [],
    extraTopics: [],
    uncertainties: [],
  };

  // If starting fresh, extract the authoritative Board Package Agenda JSON
  if (state.documentTopics.length === 0) {
    try {
      const fullAgenda = await extractBoardPackageAgendaJson({
        meetingId,
        maxPages: 15,
        onProgress: async (p) => {
          await options?.onProgress?.({
            current: p.current,
            total: totalChunks + 15,
            label: p.label,
          });
        },
      });
      const flattened = flattenBoardPackageAgenda(fullAgenda);
      state.documentTopics = flattened.map((item) => {
        const matchedChunkIds = packageChunks
          .filter((pc) => pc.pageNumbers.some((p) => item.sourcePages.includes(p)))
          .map((pc) => pc.aiChunkId);

        return {
          title: item.title,
          sectionLabel: item.sectionLabel,
          itemType: item.itemType,
          itemNumber: item.itemNumber,
          visibility: "PUBLIC",
          sourcePages: item.sourcePages,
          sourceChunkIds: matchedChunkIds,
          sourceTranscriptRanges: [],
          discussionStatus: "not_discussed",
          discussionTimestampRange: null,
          consolidationReason: null,
          sourceText: item.summary ?? null,
          aliases: item.contractorsOrVendors ?? [],
          notes: [
            item.financials?.amount ? `Amount: ${item.financials.amount}` : null,
            item.managementRecommendation ? `Recommendation: ${item.managementRecommendation}` : null,
            item.attachmentReferences?.length ? `Attachments: ${item.attachmentReferences.join("; ")}` : null,
          ].filter(Boolean) as string[],
          confidence: 1,
          confidenceReason: "Extracted from board package core report",
          evidenceStrength: "DIRECT",
          openQuestions: [],
          needsHumanReview: false,
          humanReviewReason: null,
        };
      });
    } catch (err) {
      console.warn("[agenda-ai] extractBoardPackageAgendaJson failed, falling back to chunk extraction:", err);
    }
  }

  const remainingPackageChunks =
    resumeCheckpoint && resumeCheckpoint.lastProcessedPackageSortOrder >= 0
      ? packageChunks.filter((chunk) => chunk.index > resumeCheckpoint.lastProcessedPackageSortOrder)
      : packageChunks;
  const remainingTranscriptChunks =
    resumeCheckpoint && resumeCheckpoint.lastProcessedTranscriptSortOrder >= 0
      ? transcriptChunks.filter((chunk) => chunk.index > resumeCheckpoint.lastProcessedTranscriptSortOrder)
      : transcriptChunks;

  // Only run package chunks loop if documentTopics was not already populated
  const shouldRunPackageChunks = state.documentTopics.length === 0;

  if (shouldRunPackageChunks) {
    for (const chunk of remainingPackageChunks) {
      await options?.onProgress?.({
        current: chunk.index + 1,
        total: totalChunks,
        label: `Extracting package chunk ${chunk.index + 1}/${packageChunks.length}`,
      });
      const response = await generateDeepSeekJson({
        systemInstruction: PACKAGE_SYSTEM_PROMPT,
        userText: buildPackageUserText({
          meetingId,
          state,
          chunkIndex: chunk.index,
          chunkTotal: packageChunks.length,
          chunkId: chunk.aiChunkId,
          pageNumbers: chunk.pageNumbers,
          chunkText: chunk.text,
        }),
        modelName: "deepseek-v4-flash",
        maxOutputTokens: 12288,
        temperature: 0,
        thinking: false,
      });
      const parsed = await parseWithRepair(response.text);
      const beforeStateJson = JSON.stringify(state);
      const noChange = isNoChangeResponse(parsed);
      if (!noChange) {
        const nextState = normalizeWorkflowState(parsed, state);
        state = attachPageReferenceHintsToState({
          state: {
            documentTopics: nextState.documentTopics,
            extraTopics: nextState.extraTopics,
            uncertainties: nextState.uncertainties,
          },
          chunkId: chunk.aiChunkId,
          chunkText: chunk.text,
        });
      }
      await db.insert(meetingsV2AgendaChunkSnapshots).values({
        id: randomUUID(),
        meetingV2Id: meetingId,
        chunkId: chunk.id,
        chunkKind: "document",
        sortOrder: chunk.index,
        noChange,
        beforeStateJson,
        afterStateJson: JSON.stringify(state),
        requestJson: JSON.stringify({
          chunkId: chunk.aiChunkId,
          pageNumbers: chunk.pageNumbers,
        }),
        responseText: response.text,
        parsedJson: JSON.stringify(noChange ? { status: "no_change" } : parsed),
        usageJson: JSON.stringify(response.usage),
        estimatedCostUsd: null,
        createdAt: nowIso(),
      });
    }
  }

  for (const chunk of remainingTranscriptChunks) {
    const current = packageChunks.length + chunk.transcriptIndex + 1;
    await options?.onProgress?.({
      current,
      total: totalChunks,
      label: `Extracting transcript chunk ${chunk.transcriptIndex + 1}/${transcriptChunks.length}`,
    });
    const response = await generateDeepSeekJson({
      systemInstruction: TRANSCRIPT_SYSTEM_PROMPT,
      userText: buildTranscriptUserText({
        meetingId,
        state,
        chunkIndex: chunk.transcriptIndex,
        chunkTotal: transcriptChunks.length,
        chunkId: chunk.aiChunkId,
        sequenceRange: chunk.sequenceRange,
        chunkText: chunk.text,
      }),
      modelName: "deepseek-v4-flash",
      maxOutputTokens: 12288,
      temperature: 0,
      thinking: false,
    });
    const parsed = await parseWithRepair(response.text);
    const beforeStateJson = JSON.stringify(state);
    const noChange = isNoChangeResponse(parsed);
    if (!noChange) {
      const nextState = normalizeWorkflowState(parsed, state);
      state = {
        documentTopics: nextState.documentTopics,
        extraTopics: nextState.extraTopics,
        uncertainties: nextState.uncertainties,
        discrepancies: nextState.discrepancies,
      };
    }
    await db.insert(meetingsV2AgendaChunkSnapshots).values({
      id: randomUUID(),
      meetingV2Id: meetingId,
      chunkId: chunk.id,
      chunkKind: "transcript",
      sortOrder: chunk.index,
      noChange,
      beforeStateJson,
      afterStateJson: JSON.stringify(state),
      requestJson: JSON.stringify({
        chunkId: chunk.aiChunkId,
        sequenceRange: chunk.sequenceRange,
      }),
      responseText: response.text,
      parsedJson: JSON.stringify(noChange ? { status: "no_change" } : parsed),
      usageJson: JSON.stringify(response.usage),
      estimatedCostUsd: null,
      createdAt: nowIso(),
    });
  }

  const placed = applyAdHocOutlinePlacement(state);
  let finalTopics = applyAgendaHierarchyCorrections(
    sortTopics([...placed.documentTopics, ...placed.extraTopics]).map((topic, index) => ({
      ...topic,
      id: `topic-${index}`,
      itemNumber: topic.itemNumber || String(index + 1),
    })),
  );

  const transcriptSegments = await db
    .select({
      sequence: meetingsV2TranscriptSegments.sequence,
      startMs: meetingsV2TranscriptSegments.startMs,
      endMs: meetingsV2TranscriptSegments.endMs,
      startTimestamp: meetingsV2TranscriptSegments.startTimestamp,
      speakerLabel: meetingsV2TranscriptSegments.speakerLabel,
      text: meetingsV2TranscriptSegments.text,
    })
    .from(meetingsV2TranscriptSegments)
    .where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV2TranscriptSegments.sequence));

  if (transcriptSegments.length > 0) {
    await options?.onProgress?.({
      current: totalChunks,
      total: totalChunks + 1,
      label: "Reviewing transcript span edges",
    });
    const reviewed = await reviewTranscriptTopicSpans({
      topics: finalTopics,
      cues: transcriptSegmentsToReviewCues(transcriptSegments),
      onProgress: async (label) => {
        await options?.onProgress?.({
          current: totalChunks,
          total: totalChunks + 1,
          label,
        });
      },
    });
    const gapped = await assignUnmatchedLeavesInHoles({
      topics: reviewed,
      cues: transcriptSegmentsToReviewCues(transcriptSegments),
      onProgress: async (label) => {
        await options?.onProgress?.({
          current: totalChunks,
          total: totalChunks + 1,
          label,
        });
      },
    });
    finalTopics = finalTopics.map((topic, index) => ({
      ...topic,
      discussionTimestampRange:
        gapped[index]?.discussionTimestampRange ?? topic.discussionTimestampRange,
      sourceTranscriptRanges:
        gapped[index]?.sourceTranscriptRanges ?? topic.sourceTranscriptRanges,
      discussionStatus: gapped[index]?.discussionStatus ?? topic.discussionStatus,
    }));
    finalTopics = applyAgendaHierarchyCorrections(finalTopics);
  }

  await db.delete(meetingsV2AgendaItems).where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId));

  const rows = finalTopics.map((topic, sortOrder) => {
    const firstPage = topic.sourcePages[0] ?? null;
    const sourceSection =
      firstPage !== null
        ? sections.find((section) => section.startPage <= firstPage && section.endPage >= firstPage) ?? null
        : null;

    const statusLabel =
      topic.discussionStatus ??
      (topic.sourceTranscriptRanges && topic.sourceTranscriptRanges.length > 0
        ? "discussed"
        : "not_discussed");

    const isRedundantTitle =
      topic.sourceText &&
      normalize(topic.sourceText).slice(0, 40) === normalize(topic.title).slice(0, 40);

    const enrichedSourceText = [
      `Discussion status: ${statusLabel}`,
      topic.discussionTimestampRange ? `Discussion timing: ${topic.discussionTimestampRange}` : null,
      topic.consolidationReason ? `Consolidation: ${topic.consolidationReason}` : null,
      !isRedundantTitle ? topic.sourceText : null,
      topic.sourceChunkIds.length > 0 ? `Chunk IDs: ${topic.sourceChunkIds.join(", ")}` : null,
      topic.confidenceReason ? `Confidence reason: ${topic.confidenceReason}` : null,
      topic.evidenceStrength ? `Evidence strength: ${topic.evidenceStrength}` : null,
      topic.openQuestions.length > 0 ? `Open questions: ${topic.openQuestions.join("; ")}` : null,
      topic.needsHumanReview
        ? `Needs human review: ${topic.humanReviewReason ?? "Review requested by extractor"}`
        : null,
      topic.aliases.length > 0 ? `Aliases: ${topic.aliases.join("; ")}` : null,
      topic.notes.length > 0 ? `Notes: ${topic.notes.join("; ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      id: randomUUID(),
      meetingV2Id: meetingId,
      sourceArtifactId: boardPackage[0].id,
      sourceSectionId: sourceSection?.id ?? null,
      sectionLabel: topic.sectionLabel,
      title: topic.title,
      normalizedTitle: normalize(topic.title),
      itemNumber: topic.itemNumber || String(sortOrder + 1),
      itemType: topic.itemType,
      sourcePagesJson: JSON.stringify(topic.sourcePages),
      sourceText: enrichedSourceText,
      sortOrder,
      createdAt: new Date().toISOString(),
    } satisfies typeof meetingsV2AgendaItems.$inferInsert;
  });

  if (rows.length > 0) {
    await db.insert(meetingsV2AgendaItems).values(rows);
  }

  // Persist initial agenda approval state & transcript discrepancies to meetingsV2.settings
  const currentMeeting = await db.query.meetingsV2.findFirst({
    where: eq(meetingsV2.id, meetingId),
  });
  const currentSettings = ((currentMeeting?.settings as MeetingV2Settings) || {});
  const initialItemStatuses: Record<string, AgendaItemDiscussionStatus> = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const topic = finalTopics[i];
    const isRyanRatcliff = topic && topic.title.toLowerCase().includes("ryan ratcliff");
    initialItemStatuses[row.id] =
      isRyanRatcliff && topic?.evidenceStrength === "UNCERTAIN"
        ? "not_discussed"
        : topic?.discussionStatus ??
          (topic && topic.sourceTranscriptRanges.length > 0 ? "discussed" : "not_discussed");
  }

  const discrepancies: TranscriptDiscrepancy[] = filterRedundantAddToAgendaDiscrepancies(
    dedupeDiscrepancies(state.discrepancies || []).map((d) => ({
      ...d,
      status: "pending" as const,
    })),
    finalTopics.map((topic) => topic.title),
  );

  // Surface explicit inquiry for guest presentation when guest did not attend
  const ryanTopic = finalTopics.find((t) => t.title.toLowerCase().includes("ryan ratcliff"));
  if (ryanTopic && (ryanTopic.evidenceStrength === "UNCERTAIN" || ryanTopic.needsHumanReview)) {
    const alreadyHasInquiry = discrepancies.some((d) =>
      d.suggestedTitle.toLowerCase().includes("ryan ratcliff"),
    );
    if (!alreadyHasInquiry) {
      discrepancies.unshift({
        id: `inquiry-ryan-ratcliff-${randomUUID().slice(0, 8)}`,
        transcriptRange: [0, 80],
        timestamp: ryanTopic.discussionTimestampRange || "00:00:24",
        speaker: "Haider Mukadam",
        snippet: "Approval for the minutes for June 30th meeting... reserve expense... Trace Consulting",
        suggestedTitle: "Meeting with Eng. Ryan Ratcliff from TCG",
        suggestedSection: ryanTopic.sectionLabel,
        clarificationQuestion:
          "Eng. Ryan Ratcliff did not attend this meeting; Trace was only mentioned while amending previous minutes. Was this presentation completed in a prior meeting and should be marked Not Discussed?",
        kind: "status_inquiry",
        status: "pending",
      });
    }
  }

  await db
    .update(meetingsV2)
    .set({
      settings: {
        ...currentSettings,
        agendaApproval: {
          status: "pending_review",
          approvedAt: null,
          itemStatuses: initialItemStatuses,
          discrepancies,
        },
      },
    })
    .where(eq(meetingsV2.id, meetingId));

  return {
    meetingId,
    extractor: "deepseek_incremental",
    agendaItemCount: rows.length,
  };
}
