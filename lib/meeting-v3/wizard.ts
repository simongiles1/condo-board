/**
 * Ordered stages on a V3 meeting while the pipeline is still being built.
 * Append the next stage here. The meeting page walks them in this order.
 */

import { countAgendaPages } from "@/lib/meeting-v3/agenda-pages";

/** One stage on the V3 test wizard. */
export type MeetingsV3WizardStep = {
  id: "extract" | "agenda" | "attachments" | "facts" | "transcript" | "sources";
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
    detail: "Amounts, vendors, dates, and recommendations are kept only when the quote is on that page.",
  },
  {
    id: "transcript",
    title: "Segment transcript",
    detail:
      "Each topic keeps the stretches of talk whose quote is inside that time range. Talk that is not on the agenda is additional business, item 4.E.",
  },
  {
    id: "sources",
    title: "Group sources",
    detail: "Vendor, amount, and date stay together when one quote on the page contains all of them.",
  },
];

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
};

/**
 * The first unfinished V3 stage.
 * Extract is finished when every agenda page has a correction.
 * Agenda is finished after that list exists.
 * Attachments are finished after a link run is stored for that agenda.
 * Facts are finished after a resolution run is stored for that link.
 * The transcript is finished after a segmentation run is stored for those facts.
 * Sources are finished after a grouping run is stored for that transcript.
 */
export function meetingsV3WizardProgress(input: {
  pageCount: number;
  correctedPageCount: number;
  agendaItemCount: number;
  attachmentsLinked: boolean;
  factsResolved: boolean;
  transcriptSegmented: boolean;
  factsGrouped: boolean;
  agendaContentEndsAtPage: number | null;
}): MeetingsV3WizardProgress {
  const agendaPageCount = countAgendaPages(input.pageCount, input.agendaContentEndsAtPage);
  const extractDone = agendaPageCount > 0 && input.correctedPageCount >= agendaPageCount;
  const agendaDone = extractDone && input.agendaItemCount > 0;
  const attachmentsDone = agendaDone && input.attachmentsLinked;
  const factsDone = attachmentsDone && input.factsResolved;
  const transcriptDone = factsDone && input.transcriptSegmented;
  const sourcesDone = transcriptDone && input.factsGrouped;
  const doneById = {
    extract: extractDone,
    agenda: agendaDone,
    attachments: attachmentsDone,
    facts: factsDone,
    transcript: transcriptDone,
    sources: sourcesDone,
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
  return {
    steps,
    activeId,
    completedCount,
    finished: completedCount === steps.length,
  };
}
