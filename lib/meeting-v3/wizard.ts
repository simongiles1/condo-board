/**
 * Ordered stages on a V3 meeting while the pipeline is still being built.
 * Append the next stage here. The meeting page walks them in this order.
 */

/** One stage on the V3 test wizard. */
export type MeetingsV3WizardStep = {
  id: "extract" | "agenda";
  title: string;
  detail: string;
};

/** The V3 test stages, in the order a meeting walks them. */
export const MEETINGS_V3_WIZARD_STEPS: readonly MeetingsV3WizardStep[] = [
  {
    id: "extract",
    title: "Extract and correct",
    detail: "Docling reads the board package, then every page is corrected from the PDF.",
  },
  {
    id: "agenda",
    title: "Build agenda",
    detail: "Topics, page numbers, amounts, and vendors come from the corrected pages.",
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
 * Extract is finished when every stored page has a correction. Agenda is finished after that list exists.
 */
export function meetingsV3WizardProgress(input: {
  pageCount: number;
  correctedPageCount: number;
  agendaItemCount: number;
}): MeetingsV3WizardProgress {
  const extractDone = input.pageCount > 0 && input.correctedPageCount >= input.pageCount;
  const agendaDone = extractDone && input.agendaItemCount > 0;
  const doneById = { extract: extractDone, agenda: agendaDone };
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
