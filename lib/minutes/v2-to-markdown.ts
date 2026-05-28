import {
  RESTRICTED_ADDENDUM_DISCLAIMER,
  RESTRICTED_ADDENDUM_SECTION_HEADING,
  RESTRICTED_ADDENDUM_SUBTITLE,
  RESTRICTED_ADDENDUM_TITLE,
  markdownItalicizeCondominiumAct,
} from "@/lib/minutes/restricted-addendum-boilerplate";
import {
  hasAnyRestrictedItem,
  partitionRestricted,
  type AgendaItemV2,
  type MinutesDocumentV2,
} from "@/lib/minutes/schema-v2";
import {
  formatAttendeeLine,
  formatMeetingDateDisplay,
  inlineAgendaItemSuffixMarkdown,
  joinSummaryWithTail,
  letterMarker,
  renderMotionLines,
  renderSubsectionHeading,
  romanMarker,
} from "@/lib/minutes/v2-render-helpers";

type RenderOpts = {
  /** Wrap each item's topic in markdown italics (used in the addendum). */
  italicTopic?: boolean;
};

function renderAgendaItemBlock(
  item: AgendaItemV2,
  marker: string,
  indentLevel: number,
  opts: RenderOpts = {},
): string[] {
  const base = "  ".repeat(indentLevel);
  const cont = "  ".repeat(indentLevel + 1);
  const topic = item.topic.trim();
  const body = joinSummaryWithTail(
    item.summary.trim(),
    inlineAgendaItemSuffixMarkdown(item),
  );
  const lines: string[] = [];

  if (topic) {
    const renderedTopic = opts.italicTopic ? `*${topic}*` : topic;
    lines.push(`${base}- **${marker}** ${renderedTopic}${body ? " –" : ""}`);
    if (body) {
      lines.push(`${cont}${body}`);
    }
  } else if (body) {
    lines.push(`${base}${body}`);
  }

  if (item.motion) {
    for (const ml of renderMotionLines(item.motion).lines) {
      lines.push(`${cont}${ml}`);
    }
  }
  item.subItems.forEach((sub, idx) => {
    lines.push(...renderAgendaItemBlock(sub, romanMarker(idx), indentLevel + 1, opts));
  });

  return lines;
}

function renderAgendaArray(
  items: AgendaItemV2[],
  startIndex = 0,
  opts: RenderOpts = {},
): string[] {
  const lines: string[] = [];
  items.forEach((item, idx) => {
    lines.push(
      ...renderAgendaItemBlock(item, letterMarker(startIndex + idx), 0, opts),
    );
    lines.push("");
  });
  return lines;
}

function renderNumberedItems(
  sectionNum: string,
  items: AgendaItemV2[],
  startIndex = 0,
  opts: RenderOpts = {},
): string[] {
  const lines: string[] = [];
  items.forEach((item, idx) => {
    const num = `${sectionNum}.${startIndex + idx + 1}`;
    const topic = item.topic.trim();
    const renderedTopic = opts.italicTopic ? `*${topic}*` : topic;
    const lead = joinSummaryWithTail(
      item.summary.trim(),
      inlineAgendaItemSuffixMarkdown(item),
    );

    lines.push(renderSubsectionHeading(num, renderedTopic, lead || undefined));
    lines.push("");

    if (item.motion) {
      lines.push(...renderMotionLines(item.motion).lines);
      lines.push("");
    }
    item.subItems.forEach((sub, subIdx) => {
      lines.push(
        ...renderAgendaItemBlock(sub, letterMarker(subIdx), 0, opts),
      );
      lines.push("");
    });
  });
  return lines;
}

function renderManagementBucket(
  sectionNum: string,
  subNum: number,
  title: string,
  items: AgendaItemV2[],
  startIndex = 0,
  opts: RenderOpts = {},
): string[] {
  if (!items.length) return [];
  return [
    renderSubsectionHeading(`${sectionNum}.${subNum}`, title),
    "",
    ...renderAgendaArray(items, startIndex, opts),
  ];
}

function publicOnly(items: AgendaItemV2[]): AgendaItemV2[] {
  return partitionRestricted(items).public;
}

function restrictedOnly(items: AgendaItemV2[]): AgendaItemV2[] {
  return partitionRestricted(items).restricted;
}

/** Deterministic markdown for TipTap seed + preview parity with PDF source. */
export function v2ToMarkdown(doc: MinutesDocumentV2): string {
  const lines: string[] = [];

  lines.push("Present:");
  for (const a of doc.attendance.present) {
    lines.push(formatAttendeeLine(a));
  }
  lines.push("");
  lines.push("By Invitation:");
  for (const a of doc.attendance.byInvitation) {
    lines.push(formatAttendeeLine(a));
  }
  if (doc.attendance.guests.length > 0) {
    lines.push("");
    lines.push("Guests:");
    for (const a of doc.attendance.guests) {
      lines.push(formatAttendeeLine(a));
    }
  }
  if (doc.attendance.regrets.length > 0) {
    lines.push("");
    lines.push("Regrets:");
    for (const a of doc.attendance.regrets) {
      lines.push(formatAttendeeLine(a));
    }
  }
  lines.push("");

  // 1. CALL TO ORDER
  lines.push("## 1. CALL TO ORDER");
  lines.push("");
  if (doc.callToOrder) {
    const chair = doc.callToOrder.chairName?.trim() ?? "the Chair";
    const time = doc.callToOrder.time?.trim() ?? doc.metadata.meetingTime.trim();
    lines.push(
      `Proper notice having been given and there being a quorum present, ${chair} called the meeting to order${time ? ` at ${time.replace(/\.+$/, "")}.` : "."} and presided as Chair.`,
    );
  }
  lines.push("");

  // 2. APPROVAL OF PREVIOUS MINUTES
  if (doc.approvalOfPreviousMinutes.length > 0) {
    lines.push("## 2. APPROVAL OF PREVIOUS MINUTES");
    lines.push("");
    for (const approval of doc.approvalOfPreviousMinutes) {
      const prevDate = approval.previousMeetingDate
        ? formatMeetingDateDisplay(approval.previousMeetingDate)
        : "the previous meeting";
      if (approval.amendmentsNoted) {
        lines.push(
          `The Chair asked for any errors or omissions in the minutes of the Board meeting of ${prevDate} that were circulated previously for review. Several amendments were agreed to and incorporated into a clean copy of the minutes.`,
        );
        lines.push("");
      }
      if (approval.motion) {
        lines.push(...renderMotionLines(approval.motion).lines);
        lines.push("");
      }
    }
  }

  const mr = doc.managementReport;

  const publicFinancial = publicOnly(doc.financialMatters);
  const publicRatification = publicOnly(mr.itemsForRatification);
  const publicApprovalDiscussion = publicOnly([
    ...mr.itemsForApproval,
    ...mr.itemsForDiscussion,
  ]);
  const publicInformation = publicOnly(mr.itemsForInformation);
  const publicNewBusiness = publicOnly(doc.newOrOtherBusiness);

  // 3. FINANCIAL MATTERS
  if (publicFinancial.length > 0) {
    lines.push("## 3. FINANCIAL MATTERS");
    lines.push("");
    lines.push(...renderNumberedItems("3", publicFinancial));
  }

  // 4. MANAGEMENT REPORT
  const hasManagement =
    publicRatification.length > 0 ||
    publicApprovalDiscussion.length > 0 ||
    publicInformation.length > 0;

  if (hasManagement) {
    lines.push("## 4. MANAGEMENT REPORT");
    lines.push("");
    lines.push(
      ...renderManagementBucket(
        "4",
        1,
        "Items for Ratification",
        publicRatification,
      ),
    );
    lines.push(
      ...renderManagementBucket(
        "4",
        2,
        "Items for Board Discussion and/or Approval",
        publicApprovalDiscussion,
      ),
    );
    lines.push(
      ...renderManagementBucket(
        "4",
        3,
        "Items for Board Information",
        publicInformation,
      ),
    );
  }

  // Correspondence
  const publicCorrespondence = publicOnly(doc.correspondence);
  if (publicCorrespondence.length > 0) {
    lines.push("## CORRESPONDENCE");
    lines.push("");
    lines.push(...renderAgendaArray(publicCorrespondence));
  }

  // 5. NEW / OTHER BUSINESS
  if (publicNewBusiness.length > 0) {
    lines.push("## 5. NEW / OTHER BUSINESS");
    lines.push("");
    lines.push(...renderAgendaArray(publicNewBusiness));
  }

  // 6. DATE OF NEXT MEETING
  if (doc.dateOfNextMeeting) {
    lines.push("## 6. DATE OF NEXT MEETING");
    lines.push("");
    const d = doc.dateOfNextMeeting.date
      ? formatMeetingDateDisplay(doc.dateOfNextMeeting.date)
      : "";
    const t = doc.dateOfNextMeeting.time?.trim() ?? "";
    const loc = doc.dateOfNextMeeting.location?.trim() ?? "";
    lines.push(
      `The next meeting of the Board of Directors will be held${loc ? ` ${loc}` : " virtually"}${d ? ` on ${d}` : ""}${t ? ` commencing at ${t.replace(/\.+$/, "")}.` : "."}`,
    );
    lines.push("");
  }

  // 7. MEETING CONCLUSION
  if (doc.termination?.time) {
    lines.push("## 7. MEETING CONCLUSION");
    lines.push("");
    lines.push(
      `There being no further business to discuss, the meeting was unanimously concluded at ${doc.termination.time.replace(/\.+$/, "")}.`,
    );
    lines.push("");
  }

  // Post-termination sections (e.g. 8. BUDGET DISCUSSION)
  doc.postTerminationSections.forEach((section, idx) => {
    const num = 8 + idx;
    const publicItems = publicOnly(section.items);
    if (publicItems.length === 0) return;
    lines.push(`## ${num}. ${section.title.toUpperCase()}`);
    lines.push("");
    lines.push(...renderAgendaArray(publicItems));
  });

  // Special presentations (prepend-style sections if populated)
  const publicSpecialPresentations = publicOnly(doc.specialPresentations);
  if (publicSpecialPresentations.length > 0) {
    lines.push("## SPECIAL PRESENTATIONS");
    lines.push("");
    lines.push(...renderAgendaArray(publicSpecialPresentations));
  }

  if (hasAnyRestrictedItem(doc)) {
    const finRest = restrictedOnly(doc.financialMatters);
    const ratRest = restrictedOnly(mr.itemsForRatification);
    const apprDiscRest = restrictedOnly([
      ...mr.itemsForApproval,
      ...mr.itemsForDiscussion,
    ]);
    const infoRest = restrictedOnly(mr.itemsForInformation);
    const newBizRest = restrictedOnly(doc.newOrOtherBusiness);

    const opts: RenderOpts = { italicTopic: true };

    lines.push(`## ${RESTRICTED_ADDENDUM_TITLE}`);
    lines.push("");
    lines.push(`### ${markdownItalicizeCondominiumAct(RESTRICTED_ADDENDUM_SUBTITLE)}`);
    lines.push("");
    lines.push(`***${RESTRICTED_ADDENDUM_SECTION_HEADING}***`);
    lines.push("");
    lines.push(markdownItalicizeCondominiumAct(RESTRICTED_ADDENDUM_DISCLAIMER));
    lines.push("");

    if (finRest.length > 0) {
      lines.push("## 3. FINANCIAL MATTERS, continued.");
      lines.push("");
      lines.push(
        ...renderNumberedItems("3", finRest, publicFinancial.length, opts),
      );
    }

    if (ratRest.length > 0 || apprDiscRest.length > 0 || infoRest.length > 0) {
      lines.push("## 4. MANAGEMENT REPORT, continued.");
      lines.push("");
      lines.push(
        ...renderManagementBucket(
          "4",
          1,
          "Items for Ratification",
          ratRest,
          publicRatification.length,
          opts,
        ),
      );
      lines.push(
        ...renderManagementBucket(
          "4",
          2,
          "Items for Board Discussion and/or Approval",
          apprDiscRest,
          publicApprovalDiscussion.length,
          opts,
        ),
      );
      lines.push(
        ...renderManagementBucket(
          "4",
          3,
          "Items for Board Information",
          infoRest,
          publicInformation.length,
          opts,
        ),
      );
    }

    if (newBizRest.length > 0) {
      lines.push("## 5. NEW / OTHER BUSINESS, continued.");
      lines.push("");
      lines.push(
        ...renderAgendaArray(newBizRest, publicNewBusiness.length, opts),
      );
    }

    doc.postTerminationSections.forEach((section, idx) => {
      const sectionRest = restrictedOnly(section.items);
      if (sectionRest.length === 0) return;
      const num = 8 + idx;
      const sectionPub = publicOnly(section.items);
      lines.push(`## ${num}. ${section.title.toUpperCase()}, CONTINUED.`);
      lines.push("");
      lines.push(...renderAgendaArray(sectionRest, sectionPub.length, opts));
    });
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}
