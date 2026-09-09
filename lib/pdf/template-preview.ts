import {
  formatMeetingDateDisplay,
  formatMeetingTimeClause,
  meetingMediumFromMetadata,
} from "@/lib/minutes/v2-render-helpers";
import { MEETING_TYPE_HEADER, corpShortFromName, resolveCorporationName } from "@/lib/pdf/corporation";
import {
  computeMarginLayout,
  LETTER_HEIGHT,
  LETTER_WIDTH,
  type PdfMarginLayout,
  type PdfMargins,
} from "@/lib/pdf/margins";

export type PdfTemplatePreviewContext = {
  corporationName?: string;
  meetingDate?: string;
  meetingTime?: string;
  meetingPlatform?: string;
};

export type PdfTemplateVariable = {
  id: string;
  token: string;
  label: string;
  description: string;
  pages: Array<"first" | "continued">;
};

export const PDF_TEMPLATE_VARIABLES: PdfTemplateVariable[] = [
  {
    id: "corporationName",
    token: "{corporationName}",
    label: "Corporation",
    description: "Full legal corporation name in the page 1 title",
    pages: ["first"],
  },
  {
    id: "corpShort",
    token: "{corpShort}",
    label: "Corp short",
    description: "Abbreviated running header (e.g. T.S.C.C. #2517)",
    pages: ["continued"],
  },
  {
    id: "meetingType",
    token: "{meetingType}",
    label: "Meeting type",
    description: "Meeting type line (Board of Directors Meeting)",
    pages: ["first", "continued"],
  },
  {
    id: "meetingDate",
    token: "{meetingDate}",
    label: "Meeting date",
    description: "Formatted meeting date",
    pages: ["first", "continued"],
  },
  {
    id: "meetingMedium",
    token: "{meetingMedium}",
    label: "Medium",
    description: "Whether the meeting was held in person or virtually",
    pages: ["first"],
  },
  {
    id: "meetingTime",
    token: "{meetingTime}",
    label: "Meeting time",
    description: "Start time clause on the page 1 title",
    pages: ["first"],
  },
  {
    id: "pageNumber",
    token: "{pageNumber}",
    label: "Page #",
    description: "Page number in the running header (pages 2+ only)",
    pages: ["continued"],
  },
];

export type PdfTemplatePreviewValues = {
  corporationName: string;
  corpShort: string;
  meetingType: string;
  meetingDate: string;
  meetingMedium: string;
  meetingTime: string;
  timeClause: string;
  pageNumber: string;
};

export function resolveTemplatePreviewValues(
  ctx?: PdfTemplatePreviewContext,
): PdfTemplatePreviewValues {
  const corporationName = resolveCorporationName(ctx?.corporationName);
  const meetingDate =
    formatMeetingDateDisplay(ctx?.meetingDate) || "Monday, March 23, 2026";
  const meetingMedium = meetingMediumFromMetadata(ctx?.meetingPlatform);
  const meetingTime = ctx?.meetingTime?.trim() || "6:00 p.m.";
  const timeClause = formatMeetingTimeClause(meetingTime);
  const corpShort = corpShortFromName(corporationName);

  return {
    corporationName,
    corpShort,
    meetingType: MEETING_TYPE_HEADER,
    meetingDate,
    meetingMedium,
    meetingTime,
    timeClause,
    pageNumber: "2",
  };
}

export function buildPageOneTitle(values: PdfTemplatePreviewValues): string {
  const openerRest = ` of the meeting of the Board of Directors of ${values.corporationName} held ${values.meetingMedium} on ${values.meetingDate}${values.timeClause}`;
  return `MINUTES${openerRest}`;
}

/** Page 1 title with variable tokens instead of resolved values. */
export function buildPageOneTitleTokens(): string {
  return "MINUTES of the meeting of the Board of Directors of {corporationName} held {meetingMedium} on {meetingDate} at {meetingTime}.";
}

export function buildTemplatePreviewLayout(
  margins: PdfMargins,
): PdfMarginLayout {
  return computeMarginLayout(margins);
}

export function ptToPctY(pt: number): number {
  return (pt / LETTER_HEIGHT) * 100;
}

export function ptToPctX(pt: number): number {
  return (pt / LETTER_WIDTH) * 100;
}

export function pctHeightOfMargin(marginPt: number): number {
  return (marginPt / LETTER_HEIGHT) * 100;
}

export function pctWidthOfMargin(marginPt: number): number {
  return (marginPt / LETTER_WIDTH) * 100;
}
