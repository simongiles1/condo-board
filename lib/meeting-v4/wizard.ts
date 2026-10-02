/**
 * Stages on a V4 meeting page.
 * Segmentation previews a reviewed transcript. Later stages read that preview.
 */

/** One stage a reviewer can open. */
export type MeetingsV4WizardStep = {
  id: "segmentation" | "inventory" | "draft" | "minutes";
  title: string;
  detail: string;
};

/** V4 stages in the order a reviewer walks them. */
export const MEETINGS_V4_WIZARD_STEPS: readonly MeetingsV4WizardStep[] = [
  {
    id: "segmentation",
    title: "Segmentation",
    detail: "Reviewed transcript spans already stored on this V2 meeting. This step does not segment again.",
  },
  {
    id: "inventory",
    title: "Inventory",
    detail: "Checks that every leaf has its spans, including later returns, and lists transcript cues no span covers.",
  },
  {
    id: "draft",
    title: "Draft",
    detail: "Writes one minutes paragraph per item from the agenda text and the reviewed transcript. Evidence notes stay beside the paragraph.",
  },
  {
    id: "minutes",
    title: "Minutes",
    detail: "Assembles those paragraphs into one document. Attendance, chair, and the closing date lines stay blank.",
  },
];

/** Query-string key for the open stage. */
export const MEETINGS_V4_WIZARD_STEP_QUERY_PARAM = "step";

/**
 * Parses a V4 stage id from the page URL.
 * Returns null when the value is missing or unknown.
 */
export function parseMeetingsV4WizardStepId(
  value: string | null | undefined,
): MeetingsV4WizardStep["id"] | null {
  if (!value) return null;
  return MEETINGS_V4_WIZARD_STEPS.some((step) => step.id === value)
    ? (value as MeetingsV4WizardStep["id"])
    : null;
}
