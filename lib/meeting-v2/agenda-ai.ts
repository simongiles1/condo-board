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
} from "@/lib/db/schema";

type WorkflowTopic = {
  title: string;
  sectionLabel: string;
  itemType: string;
  visibility: "PUBLIC" | "RESTRICTED" | "UNKNOWN";
  sourcePages: number[];
  sourceChunkIds: string[];
  sourceTranscriptRanges: Array<[number, number]>;
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

type WorkflowState = {
  documentTopics: WorkflowTopic[];
  extraTopics: WorkflowTopic[];
  uncertainties: string[];
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
- Maintain topics in the exact chronological order of the official meeting agenda as presented in the package (e.g. Item 1 before Item 2, sub-items in their original outline order). Do not reorder topics alphabetically.
- When the package shows one umbrella heading with numbered or lettered sub-items, create one topic per real sub-item instead of one umbrella topic.
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
      "itemType": "guest_presentation | approval_of_previous_minutes | financial_matters | ratification_line_item | discussion_approval | discussion_topic | completed_items | discussion_subitem | legal_matter | new_other_business | extra_topic | other",
      "visibility": "PUBLIC | RESTRICTED | UNKNOWN",
      "sourcePages": [1],
      "sourceChunkIds": ["document_chunk_001"],
      "sourceTranscriptRanges": [],
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

const TRANSCRIPT_TASK = `TASK: TRANSCRIPT CHUNK ENRICHMENT

You will receive:
- the current topic state
- one transcript chunk

Use the transcript chunk to:
- link discussion to existing documentTopics
- add aliases or notes when the transcript uses shorthand
- add extraTopics only for real discussion matters not clearly present in documentTopics

If this chunk does not require any change, return:
{
  "status": "no_change"
}

Otherwise return strict JSON with the same shape as before.

Transcript rules:
- Do not remove solid package-backed topics just because they are not mentioned in this chunk.
- Prefer updating notes and aliases on existing topics.
- Lines marked as [PREVIOUS TRANSCRIPT CONTEXT] are provided strictly so you can read conversations that connect to the current lines. Do not extract brand new extra topics from the previous transcript context if they do not spill over into the new lines.
- Preserve early guest-presentation topics when the transcript clearly shows a contractor, engineer, or presenter leading a distinct opening discussion block.
- If the transcript clearly reveals a planned or structured meeting matter that belongs in the main agenda but is missing from documentTopics, add it to documentTopics rather than extraTopics.
- Use extraTopics only for genuinely additional matters that do not behave like an official agenda topic.
- Every transcript-only new matter must use itemType "extra_topic". EXCEPTION: If the transcript introduces the approval of previous minutes or financial matters, add it to documentTopics with itemType "approval_of_previous_minutes" or "financial_matters" respectively. Do not invent custom itemType values for extraTopics.
- If the transcript uses shorthand, partial names, or abbreviated project references, attach them to the matching existing topic through aliases or notes whenever reasonably possible.
- Do not merge a transcript matter into an existing topic unless they are clearly the same business issue. Shared words, contractor names, or building-area overlap alone are not enough.
- If the transcript gives a more specific unit number, room name, incident, or records issue than the package topic list, preserve that specific matter instead of flattening it into a broader nearby topic.
- If one transcript chunk contains multiple separate business matters, preserve them as separate topics. Do not keep only the last matter mentioned.
- If a transcript chunk moves from one issue to another with a clear transition, evaluate each issue separately before deciding no_change.
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

function normalizeTopic(raw: Partial<WorkflowTopic>): WorkflowTopic | null {
  const title = normalizeWhitespace(raw.title ?? "");
  if (!title) return null;
  return {
    title,
    sectionLabel: normalizeWhitespace(raw.sectionLabel ?? "") || "Unknown",
    itemType: normalizeWhitespace(raw.itemType ?? "") || "other",
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
      sourceTranscriptRanges: unique(
        [...existing.sourceTranscriptRanges, ...topic.sourceTranscriptRanges].map(
          (range) => `${range[0]}:${range[1]}`,
        ),
      ).map((range) => {
        const [start, end] = range.split(":").map((value) => Number.parseInt(value, 10));
        return [start, end] as [number, number];
      }),
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

function normalizeWorkflowState(value: unknown, fallback: WorkflowState): WorkflowResponse {
  const record = (value && typeof value === "object" ? value : {}) as Partial<WorkflowResponse>;
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
    documentTopics: documentTopics.length > 0 ? documentTopics : fallback.documentTopics,
    extraTopics: extraTopics.length > 0 || record.extraTopics ? extraTopics : fallback.extraTopics,
    uncertainties: unique(
      (Array.isArray(record.uncertainties) ? record.uncertainties : [])
        .flatMap((entry) => (typeof entry === "string" ? [normalizeWhitespace(entry)] : []))
        .filter(Boolean),
    ).slice(0, 20),
    changes: normalizeChanges(record.changes),
  };
}

function sortTopics(topics: WorkflowTopic[]): WorkflowTopic[] {
  return topics
    .map((topic, originalIndex) => ({ topic, originalIndex }))
    .sort((left, right) => {
      const leftPage = left.topic.sourcePages[0] ?? Number.MAX_SAFE_INTEGER;
      const rightPage = right.topic.sourcePages[0] ?? Number.MAX_SAFE_INTEGER;
      if (leftPage !== rightPage) return leftPage - rightPage;
      return left.originalIndex - right.originalIndex;
    })
    .map(({ topic }) => topic);
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
        sourceTranscriptRanges: topic.sourceTranscriptRanges.slice(0, 4),
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
        sourceTranscriptRanges: topic.sourceTranscriptRanges.slice(0, 4),
        sourceText: topic.sourceText,
        aliases: topic.aliases.slice(0, 3),
        notes: topic.notes.slice(0, 3),
      })),
      uncertainties: state.uncertainties.slice(0, 8),
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
    .map((chunk) => {
      const metadata = safeParseObject<{ aiChunkId?: string; sequenceRange?: [number, number] }>(
        chunk.metadataJson,
      );
      return {
        id: chunk.id,
        sourceArtifactId: chunk.sourceArtifactId,
        aiChunkId:
          metadata?.aiChunkId ?? `transcript_chunk_${String(chunk.sortOrder + 1).padStart(3, "0")}`,
        index: chunk.sortOrder,
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
  const remainingPackageChunks =
    resumeCheckpoint && resumeCheckpoint.lastProcessedPackageSortOrder >= 0
      ? packageChunks.filter((chunk) => chunk.index > resumeCheckpoint.lastProcessedPackageSortOrder)
      : packageChunks;
  const remainingTranscriptChunks =
    resumeCheckpoint && resumeCheckpoint.lastProcessedTranscriptSortOrder >= 0
      ? transcriptChunks.filter((chunk) => chunk.index > resumeCheckpoint.lastProcessedTranscriptSortOrder)
      : transcriptChunks;

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

  for (const chunk of remainingTranscriptChunks) {
    const current = packageChunks.length + chunk.index + 1;
    await options?.onProgress?.({
      current,
      total: totalChunks,
      label: `Extracting transcript chunk ${chunk.index + 1}/${transcriptChunks.length}`,
    });
    const response = await generateDeepSeekJson({
      systemInstruction: TRANSCRIPT_SYSTEM_PROMPT,
      userText: buildTranscriptUserText({
        meetingId,
        state,
        chunkIndex: chunk.index,
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

  const finalTopics = [...sortTopics(state.documentTopics), ...sortTopics(state.extraTopics)];

  await db.delete(meetingsV2AgendaItems).where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId));

  const rows = finalTopics.map((topic, sortOrder) => {
    const firstPage = topic.sourcePages[0] ?? null;
    const sourceSection =
      firstPage !== null
        ? sections.find((section) => section.startPage <= firstPage && section.endPage >= firstPage) ?? null
        : null;
    const enrichedSourceText = [
      topic.sourceText,
      topic.sourceChunkIds.length > 0 ? `Chunk IDs: ${topic.sourceChunkIds.join(", ")}` : null,
      topic.sourceTranscriptRanges.length > 0
        ? `Transcript ranges: ${topic.sourceTranscriptRanges.map((range) => `${range[0]}-${range[1]}`).join("; ")}`
        : null,
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
      itemNumber: String(sortOrder + 1),
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

  return {
    meetingId,
    extractor: "deepseek_incremental",
    agendaItemCount: rows.length,
  };
}
