/**
 * Ordered stages on a V3 meeting while the pipeline is still being built.
 * Append the next stage here. The meeting page walks them in this order.
 */

import { countAgendaPages } from "@/lib/meeting-v3/agenda-pages";

/** One stage on the V3 test wizard. */
export type MeetingsV3WizardStep = {
  id: "extract" | "agenda" | "attachments" | "facts" | "transcript" | "sources" | "conclusions" | "validate" | "draft";
  title: string;
  detail: string;
};

/** The V3 test stages, in the order a meeting walks them. */
export const MEETINGS_V3_WIZARD_STEPS: readonly MeetingsV3WizardStep[] = [
  {
    id: "extract",
    title: "Extract and correct",
    detail: "Docling reads the board package, then each agenda page is corrected from the PDF.",
  },
  {
    id: "agenda",
    title: "Build agenda",
    detail: "Topics, page numbers, amounts, and vendors come from the corrected pages.",
  },
  {
    id: "attachments",
    title: "Link attachments",
    detail: "Pages after the agenda split are linked to the topic they support.",
  },
  {
    id: "facts",
    title: "Resolve facts",
    detail:
      "Amounts, vendors, dates, and recommendations stay only when the quote is on that page. A heading, a table row, or a nearby condition can name the project or the fee. Another topic on the same page is not this item.",
  },
  {
    id: "transcript",
    title: "Segment transcript",
    detail:
      "Each topic keeps the stretches from the transcript walk, span edges, and gap fill. Cues stay separate so one speaker turn cannot cover two topics. Talk that is not on the agenda is additional business.",
  },
  {
    id: "sources",
    title: "Group sources",
    detail: "Facts that name the same project stay together, including when the company and the fees are on different pages.",
  },
  {
    id: "conclusions",
    title: "Reconcile meeting",
    detail:
      "Each topic's transcript stretch is read in order. A motion is not a decision until the stretch adopts, defeats, or replaces it. The package can name what the talk pointed at. It cannot decide the meeting.",
  },
  {
    id: "validate",
    title: "Check minutes",
    detail:
      "Lists missing decisions, open package references, and figures that still need review. This check is immediate. It does not write the minutes.",
  },
  {
    id: "draft",
    title: "Draft minutes",
    detail:
      "Writes a formal paragraph for each topic from the transcript stretch. Unverified figures stay off the page. A topic without a supported decision is not written as approved.",
  },
];

/** Query-string key for the wizard step on the V3 meeting page. */
export const MEETINGS_V3_WIZARD_STEP_QUERY_PARAM = "step";

/**
 * Parses a wizard step id from the meeting page URL.
 * Returns null when the value is missing or not a known step.
 */
export function parseMeetingsV3WizardStepId(
  value: string | null | undefined,
): MeetingsV3WizardStep["id"] | null {
  if (!value) return null;
  return MEETINGS_V3_WIZARD_STEPS.some((step) => step.id === value)
    ? (value as MeetingsV3WizardStep["id"])
    : null;
}

/** Where one wizard stage sits relative to the meeting. */
export type MeetingsV3WizardStepState = "complete" | "current" | "upcoming";

/** A wizard stage plus whether it can be opened. */
export type MeetingsV3WizardStepProgress = MeetingsV3WizardStep & {
  state: MeetingsV3WizardStepState;
};

/** Which V3 stage is next, and whether every stage is finished. */
export type MeetingsV3WizardProgress = {
  steps: MeetingsV3WizardStepProgress[];
  activeId: MeetingsV3WizardStep["id"];
  completedCount: number;
  finished: boolean;
  readyToDraft: boolean;
  /** Every stage has run, so a working draft may list open points. */
  workingDraft: boolean;
  /** Material open points and unsupported references are cleared. */
  minutesComplete: boolean;
};

/**
 * The first unfinished V3 stage.
 * Extract is finished when every agenda page has a correction.
 * Agenda is finished after that list exists.
 * Attachments are finished after a link run is stored for that agenda.
 * Facts are finished after a resolution run is stored for that link.
 * The transcript is finished after a segmentation run is stored for those facts.
 * Sources are finished after a grouping run is stored.
 * Reconciliation is finished after meeting conclusions are stored for that transcript.
 * The minutes check is finished after those conclusions have been checked.
 * The draft is finished after a minutes draft is stored for that check.
 * `finished` means every stage has been run.
 * `workingDraft` and `readyToDraft` match that: a draft may include marked open points.
 * `minutesComplete` also requires no fact-review issues, no unclear conclusion, and no open package reference.
 */
export function meetingsV3WizardProgress(input: {
  pageCount: number;
  correctedPageCount: number;
  agendaItemCount: number;
  attachmentsLinked: boolean;
  factsResolved: boolean;
  transcriptSegmented: boolean;
  factsGrouped: boolean;
  conclusionsRecorded?: boolean;
  minutesValidated?: boolean;
  minutesDrafted?: boolean;
  reviewIssueCount?: number;
  unclearConclusionCount?: number;
  openReferenceCount?: number;
  agendaContentEndsAtPage: number | null;
}): MeetingsV3WizardProgress {
  const agendaPageCount = countAgendaPages(input.pageCount, input.agendaContentEndsAtPage);
  const extractDone = agendaPageCount > 0 && input.correctedPageCount >= agendaPageCount;
  const agendaDone = extractDone && input.agendaItemCount > 0;
  const attachmentsDone = agendaDone && input.attachmentsLinked;
  const factsDone = attachmentsDone && input.factsResolved;
  const transcriptDone = factsDone && input.transcriptSegmented;
  const sourcesDone = transcriptDone && input.factsGrouped;
  const conclusionsDone = sourcesDone && input.conclusionsRecorded === true;
  const validateDone = conclusionsDone && input.minutesValidated === true;
  const draftDone = validateDone && input.minutesDrafted === true;
  const doneById = {
    extract: extractDone,
    agenda: agendaDone,
    attachments: attachmentsDone,
    facts: factsDone,
    transcript: transcriptDone,
    sources: sourcesDone,
    conclusions: conclusionsDone,
    validate: validateDone,
    draft: draftDone,
  };
  const activeId = MEETINGS_V3_WIZARD_STEPS.find((step) => !doneById[step.id])?.id
    ?? MEETINGS_V3_WIZARD_STEPS[MEETINGS_V3_WIZARD_STEPS.length - 1].id;
  let passedActive = false;
  const steps = MEETINGS_V3_WIZARD_STEPS.map((step) => {
    if (doneById[step.id]) return { ...step, state: "complete" as const };
    if (!passedActive && step.id === activeId) {
      passedActive = true;
      return { ...step, state: "current" as const };
    }
    return { ...step, state: "upcoming" as const };
  });
  const completedCount = steps.filter((step) => step.state === "complete").length;
  const finished = completedCount === steps.length;
  const materialOpen = (input.reviewIssueCount ?? 0) + (input.unclearConclusionCount ?? 0) + (input.openReferenceCount ?? 0);
  const workingDraft = finished;
  return {
    steps,
    activeId,
    completedCount,
    finished,
    readyToDraft: workingDraft,
    workingDraft,
    minutesComplete: finished && materialOpen === 0,
  };
}
