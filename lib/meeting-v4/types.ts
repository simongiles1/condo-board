/**
 * Shapes for a V4 minutes draft that reads a reviewed transcript segmentation.
 * A finding list holds more than one result on the same item.
 */

/** One thing the discussion supports. Several can apply to the same item. */
export const MEETINGS_V4_FINDING_KINDS = [
  "reported_prior_approval",
  "decision",
  "direction",
  "condition",
  "unresolved",
  "information",
] as const;

/** A kind of finding the writer may record. */
export type MeetingsV4FindingKind = (typeof MEETINGS_V4_FINDING_KINDS)[number];

/** One supported fact about the item, separate from the minutes paragraph. */
export type MeetingsV4Finding = {
  kind: MeetingsV4FindingKind;
  text: string;
};

/** Whether the assigned transcript belongs to this agenda item. */
export const MEETINGS_V4_EVIDENCE_FITS = [
  "on_topic",
  "mixed",
  "wrong_item",
  "transcript_missing",
] as const;

/** How the assigned discussion relates to the agenda item. */
export type MeetingsV4EvidenceFit = (typeof MEETINGS_V4_EVIDENCE_FITS)[number];

/** A transcript cue the writer was given, in order. */
export type MeetingsV4BundleCue = {
  index: number;
  start: string;
  end: string;
  speaker: string;
  text: string;
};

/**
 * The corrected agenda-page extract and transcript cues sent for one item.
 * Attachment pages stay empty. The extract already includes that item's printed pages.
 */
export type MeetingsV4Bundle = {
  /** Corrected-first page extract sent as the agenda field in the draft prompt. */
  agendaText: string;
  /** Docling-only text for the same source pages. */
  agendaTextDocling: string;
  /** Corrected rewrite text only, when stored for an older draft review. */
  agendaTextCorrected?: string;
  cues: MeetingsV4BundleCue[];
  attachmentPages: [];
};

/** How the meeting closed a motion. */
export const MEETINGS_V4_MOTION_OUTCOMES = ["carried", "defeated", "deferred", "unrecorded"] as const;

/** The outcome stored on one drafted motion. */
export type MeetingsV4MotionOutcome = (typeof MEETINGS_V4_MOTION_OUTCOMES)[number];

/**
 * The formal motion for one item.
 * Names are present only when the transcript identified them. A resolution can exist without names.
 */
export type MeetingsV4MotionNote = {
  mover: string | null;
  seconder: string | null;
  resolution: string | null;
  outcome: MeetingsV4MotionOutcome;
  source: "transcript" | "unsupported";
};

/** One agenda item after drafting, including the bundle that was sent. */
export type MeetingsV4ItemResult = {
  agendaItemId: string;
  itemNumber: string;
  title: string;
  bundle: MeetingsV4Bundle;
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
  error: string | null;
};

/** A stored V4 draft on the V2 meeting settings. */
export type MeetingsV4Stored = {
  draftedAt: string;
  modelName: string;
  items: MeetingsV4ItemResult[];
};
