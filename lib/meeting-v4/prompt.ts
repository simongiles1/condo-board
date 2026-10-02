/**
 * Instructions and reply parsing for one V4 agenda item.
 * The model may record several findings. It does not collapse them into one outcome.
 */

import {
  MEETINGS_V4_EVIDENCE_FITS,
  MEETINGS_V4_FINDING_KINDS,
  type MeetingsV4EvidenceFit,
  type MeetingsV4Finding,
  type MeetingsV4FindingKind,
  type MeetingsV4MotionNote,
} from "@/lib/meeting-v4/types";

/** System instruction for one item. Prior minutes are not attached. */
export const MEETINGS_V4_DRAFT_PROMPT = `You write the minutes for one condominium board agenda item.

You receive the agenda text for that item and the reviewed transcript stretches assigned to it, with speakers and timestamps. No attachment pages are included. Do not assume a figure that is not in the agenda text or the transcript.

The transcript decides what happened at this meeting. The agenda supplies the topic and any printed proposal. A package recommendation does not override a different decision made in the room. A later remark replaces an earlier one on the same point. Separate a prior approval that is only being reported from a decision made today.

Speech-to-text mishears names and numbers. "Two six six oh" or "about twenty-six hundred" can be the agenda figure $2,660 when that is the only matching figure for the same party. Write the agenda figure, including tax treatment when the agenda states it. If two figures could match, or the party is unclear, keep a supported approval and set amount to "uncertain". Do not mention transcription in the minutes.

"No questions" after a report is not an approval. Agreement, "I'm fine", "go ahead", or the chair moving on after someone asked the board to approve or direct something is a decision when no unmet condition remains. The chair moving on during an update is not, by itself, a decision. Record a supported approval, rejection, deferral, or direction even when nobody said "I move".

If the transcript is about a different topic, set evidence_fit to "wrong_item" and do not write the stretch as this item's minutes. If it is partly this item, set "mixed" and use only the relevant part.

Several findings may all be true. "Previously approved the contractor; today directed management to obtain legal review" is a reported prior approval and a direction. Do not drop one to make a single label.

Name a mover or seconder only when the transcript identifies them. Never infer them from who attended or who usually moves. This call has no separate notes.

STYLE
Formal third person, past tense, for a reader who was not in the room. Ordinarily two to four sentences. Do not quote speech. Do not include filler words.
Do not name a mover or seconder in the minutes paragraph.
The following example is fictional and is only a shape:
"The board considered the proposal to replace the lobby carpet and the quoted price of $4,200 plus HST. The board approved the replacement by North Flooring, subject to a cancellation clause. Management was directed to issue the purchase order."

Return JSON only:
{
  "minutes": "string or null when evidence_fit is wrong_item or transcript_missing",
  "findings": [{ "kind": "reported_prior_approval | decision | direction | condition | unresolved | information", "text": "string" }],
  "evidence_fit": "on_topic | mixed | wrong_item | transcript_missing",
  "amount": "the figure, uncertain, or not applicable",
  "amount_basis": "string",
  "actions": [{ "owner": "string or null", "description": "string" }],
  "motion": { "mover": "string or null", "seconder": "string or null", "source": "transcript | unsupported" },
  "restricted": false,
  "restricted_reason": "string",
  "gaps": ["string"]
}`;

/** Fields read from one model reply. */
export type MeetingsV4ParsedDraft = {
  minutes: string | null;
  findings: MeetingsV4Finding[];
  evidenceFit: MeetingsV4EvidenceFit;
  amount: string;
  amountBasis: string;
  actions: Array<{ owner: string | null; description: string }>;
  motion: MeetingsV4MotionNote;
  restricted: boolean;
  restrictedReason: string;
  gaps: string[];
};

const FINDING_KINDS = new Set<string>(MEETINGS_V4_FINDING_KINDS);
const EVIDENCE_FITS = new Set<string>(MEETINGS_V4_EVIDENCE_FITS);

/**
 * Reads one item draft from a model reply.
 * Returns null when the reply is empty or not the expected JSON object.
 * A mover is kept only when the reply says the transcript identified them.
 */
export function readMeetingsV4Draft(text: string): MeetingsV4ParsedDraft | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/\{[\s\S]*\}/);
  if (!fenced) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const evidenceFit = typeof record.evidence_fit === "string" && EVIDENCE_FITS.has(record.evidence_fit)
    ? record.evidence_fit as MeetingsV4EvidenceFit
    : null;
  if (!evidenceFit) return null;
  const minutes = typeof record.minutes === "string" ? record.minutes.replace(/\s+/g, " ").trim() : "";
  return {
    minutes: minutes.length >= 24 ? minutes : null,
    findings: readFindings(record.findings),
    evidenceFit,
    amount: asText(record.amount) || "not applicable",
    amountBasis: asText(record.amount_basis),
    actions: readActions(record.actions),
    motion: readMotion(record.motion),
    restricted: record.restricted === true,
    restrictedReason: asText(record.restricted_reason),
    gaps: readGaps(record.gaps),
  };
}

function readFindings(value: unknown): MeetingsV4Finding[] {
  if (!Array.isArray(value)) return [];
  const findings: MeetingsV4Finding[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.kind !== "string" || !FINDING_KINDS.has(record.kind)) continue;
    const text = asText(record.text);
    if (!text) continue;
    findings.push({ kind: record.kind as MeetingsV4FindingKind, text });
  }
  return findings;
}

function readActions(value: unknown): Array<{ owner: string | null; description: string }> {
  if (!Array.isArray(value)) return [];
  const actions: Array<{ owner: string | null; description: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const description = asText(record.description);
    if (!description) continue;
    const owner = asText(record.owner);
    actions.push({ owner: owner || null, description });
  }
  return actions;
}

function readMotion(value: unknown): MeetingsV4MotionNote {
  const empty: MeetingsV4MotionNote = { mover: null, seconder: null, source: "unsupported" };
  if (!value || typeof value !== "object") return empty;
  const record = value as Record<string, unknown>;
  if (record.source !== "transcript") return empty;
  const mover = asText(record.mover);
  const seconder = asText(record.seconder);
  if (!mover && !seconder) return empty;
  return { mover: mover || null, seconder: seconder || null, source: "transcript" };
}

function readGaps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asText(entry)).filter(Boolean);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
