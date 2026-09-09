export type MinutesEditorTooltipSection = {
  title?: string;
  items: string[];
};

export type MinutesEditorTooltip = {
  title: string;
  summary: string;
  sections: MinutesEditorTooltipSection[];
};

/** Hover copy for Draft Preview → Editor sections with non-obvious rules or boilerplate. */
export const MINUTES_EDITOR_TOOLTIPS: Record<string, MinutesEditorTooltip> = {
  attendance: {
    title: "Attendance",
    summary:
      "The opening clause and attendance lists are assembled from structured fields when the PDF is rendered.",
    sections: [
      {
        items: [
          "Names and roles are auto-detected when the draft is generated; use Edit attendees to correct them.",
          "The title line uses corporation name, meeting date, time, and virtual/in-person medium from metadata.",
        ],
      },
    ],
  },
  "call-to-order": {
    title: "Call to Order",
    summary:
      "Chair name and time feed a fixed opening sentence — the prose is not written freely by the AI.",
    sections: [
      {
        items: [
          "Rendered as: “Proper notice having been given and there being a quorum present, [Chair] called the meeting to order at [time] and presided as Chair.”",
        ],
      },
    ],
  },
  "approval-of-previous-minutes": {
    title: "Approval of Previous Minutes",
    summary:
      "The narrative paragraph in the PDF is standard boilerplate, not a transcript summary.",
    sections: [
      {
        items: [
          "Only the prior meeting date and the Amendments noted checkbox change the wording.",
          "When checked: “Several amendments were agreed to and incorporated into a clean copy of the minutes.”",
          "When unchecked: “There being none, the minutes were accepted as presented.”",
          "Specific corrections are not listed here — edit the motion for the formal resolution (movers, “approved as amended”, etc.).",
        ],
      },
    ],
  },
  "items-for-ratification": {
    title: "Items for Ratification",
    summary:
      "Ratification line items come from the board package and should mirror package wording and dollar amounts.",
    sections: [
      {
        items: [
          "The pipeline expects every ratification line listed in the package to appear here, even if batch-approved on the recording.",
          "Each item should include cost figures in the summary when the package states them.",
        ],
      },
    ],
  },
  "date-of-next-meeting": {
    title: "Date of Next Meeting",
    summary:
      "Date, time, and location fields feed a fixed closing sentence in the PDF.",
    sections: [
      {
        items: [
          "Rendered as: “The next meeting of the Board of Directors will be held [location] on [date] commencing at [time].”",
          "If date is left blank, the PDF falls back to “The date of the next Board meeting is to be determined.”",
        ],
      },
    ],
  },
  "meeting-conclusion": {
    title: "Meeting Conclusion",
    summary:
      "Conclusion time feeds a fixed adjournment sentence — not free-form AI prose.",
    sections: [
      {
        items: [
          "Rendered as: “There being no further business to discuss, the meeting was unanimously concluded at [time].”",
        ],
      },
    ],
  },
  "restricted-addendum": {
    title: "Restricted Records Addendum",
    summary:
      "Items flagged Restricted are removed from the public minutes and reproduced here under s. 55(4) boilerplate.",
    sections: [
      {
        items: [
          "The disclaimer text is fixed by statute and cannot be edited in this editor.",
          "Use the Restricted checkbox on an agenda item to move it into this addendum.",
          "Suite-specific matters, employee issues, litigation, and similar topics belong here.",
        ],
      },
    ],
  },
  "restricted-item-flag": {
    title: "Restricted (addendum only)",
    summary:
      "Marks an item as confidential under s. 55(4) so it renders only in the restricted addendum, not in owner-facing minutes.",
    sections: [
      {
        items: [
          "Sub-items inherit the parent’s restricted flag.",
          "Public section numbering skips restricted items; they reappear under “continued” headings in the addendum.",
        ],
      },
    ],
  },
};

export function getMinutesEditorTooltip(
  tooltipId: string,
): MinutesEditorTooltip | undefined {
  return MINUTES_EDITOR_TOOLTIPS[tooltipId];
}
