import React from "react";
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";

import {
  hasAnyRestrictedItem,
  partitionRestricted,
  stripLeadingThatFromResolution,
  type ActionItemV2,
  type AgendaItemV2,
  type AttendeeV2,
  type MinutesDocumentV2,
  type MotionV2,
} from "@/lib/minutes/schema-v2";
import {
  RESTRICTED_ADDENDUM_DISCLAIMER,
  RESTRICTED_ADDENDUM_SECTION_HEADING,
  RESTRICTED_ADDENDUM_SUBTITLE,
  RESTRICTED_ADDENDUM_TITLE,
  splitCondominiumActPhrase,
} from "@/lib/minutes/restricted-addendum-boilerplate";
import {
  formatMeetingDateDisplay,
  formatMeetingTimeClause,
  letterMarker,
  meetingMediumFromMetadata,
  romanMarker,
  shouldBoldAgendaStatus,
  shouldRenderAgendaStatus,
} from "@/lib/minutes/v2-render-helpers";
import { MEETING_TYPE_HEADER } from "@/lib/pdf/corporation";
import { PDF_FONT, registerPdfFonts } from "@/lib/pdf/fonts";
import {
  hangingIndentStyles,
} from "@/lib/pdf/hanging-indent";
import {
  computeMarginLayout,
  DEFAULT_PDF_MARGINS,
  type PdfMarginLayout,
  type PdfMargins,
} from "@/lib/pdf/margins";
import { SignatureLines } from "@/lib/pdf/signature-lines";

registerPdfFonts();

function noHyphenation(word: string) {
  return [word];
}

Font.registerHyphenationCallback(noHyphenation);

const styles = StyleSheet.create({
  page: {
    fontFamily: PDF_FONT,
    fontSize: 12,
    lineHeight: 1.2,
    color: "#000",
  },

  headerText: {
    textAlign: "left",
    fontSize: 10,
    fontFamily: PDF_FONT,
    fontWeight: "bold",
  },
  headerPageText: {
    textAlign: "right",
    fontSize: 10,
    fontFamily: PDF_FONT,
    fontWeight: "bold",
  },
  docTitle: {
    fontSize: 12,
    fontFamily: PDF_FONT,
    marginBottom: 16,
    textAlign: "justify",
    lineHeight: 1.2,
  },

  hangRow: hangingIndentStyles.hangRow,
  markerCell: hangingIndentStyles.markerCell,
  markerCellRoman: hangingIndentStyles.markerCellRoman,
  contentCell: hangingIndentStyles.contentCell,
  sectionTopMarker: {
    fontFamily: PDF_FONT,
  },
  sectionTopTitle: hangingIndentStyles.sectionTopTitle,
  subsectionMarker: {
    fontFamily: PDF_FONT,
  },
  subsectionTitle: hangingIndentStyles.subsectionTitle,
  subsectionTitleItalic: {
    ...hangingIndentStyles.subsectionTitle,
    fontStyle: "italic",
  },
  bodyParagraph: hangingIndentStyles.bodyParagraph,
  bodyText: hangingIndentStyles.bodyText,
  actionBold: hangingIndentStyles.actionBold,
  motionKeyword: hangingIndentStyles.motionKeyword,
  motionRegular: {
    fontFamily: PDF_FONT,
  },
  noteRight: hangingIndentStyles.noteRight,

  attendanceRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  attendanceLabel: {
    fontFamily: PDF_FONT,
  },
  attendanceLabelCol: {
    width: 71,
  },
  attendanceRowsCol: {
    flex: 1,
  },
  attendanceName: {
    width: 121,
    fontFamily: PDF_FONT,
  },
  attendanceDash: {
    width: 15,
    fontFamily: PDF_FONT,
  },
  attendanceRole: {
    flex: 1,
    fontFamily: PDF_FONT,
  },

  horizontalRule: {
    borderBottomWidth: 1,
    borderBottomColor: "#000",
  },
  attendanceSectionTopRule: {
    marginTop: 4,
    marginBottom: 10,
  },
  attendanceSectionBottomRule: {
    marginTop: 8,
    marginBottom: 12,
  },

  addendumHeading: {
    fontFamily: PDF_FONT,
    fontWeight: "bold",
    fontSize: 12,
    marginTop: 12,
    marginBottom: 8,
    textAlign: "center",
    textTransform: "uppercase",
  },
  addendumRestrictedTitle: {
    fontFamily: PDF_FONT,
    fontWeight: "bold",
    fontSize: 12,
    marginBottom: 8,
    textAlign: "center",
    textDecoration: "underline",
  },
  addendumConfidentialHeading: {
    fontFamily: PDF_FONT,
    fontWeight: "bold",
    fontStyle: "italic",
    fontSize: 12,
    marginBottom: 8,
    textAlign: "center",
  },
  addendumDisclaimer: {
    fontFamily: PDF_FONT,
    fontSize: 10,
    marginBottom: 12,
    textAlign: "justify",
  },

  spacer: {
    height: 8,
  },
});

function HorizontalRule({
  style,
}: {
  style?: typeof styles.attendanceSectionTopRule;
}) {
  return <View style={[styles.horizontalRule, style ?? {}]} />;
}

function CondominiumActItalicText({
  text,
  style,
}: {
  text: string;
  style?: Style | Style[];
}) {
  const parts = splitCondominiumActPhrase(text);
  if (parts.length === 1) {
    return <Text style={style}>{text}</Text>;
  }

  const children: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part) children.push(part);
    if (i < parts.length - 1) {
      children.push(
        <Text key={`act-${i}`} style={{ fontStyle: "italic" }}>
          Condominium Act, 1998
        </Text>,
      );
    }
  });
  return <Text style={style}>{children}</Text>;
}

function buildPageStyle(layout: PdfMarginLayout) {
  return {
    ...styles.page,
    paddingTop: layout.pagePaddingTop,
    paddingBottom: layout.margins.bottom,
    paddingLeft: layout.margins.left,
    paddingRight: layout.margins.right,
  };
}

function RunningHeaderRule({ layout }: { layout: PdfMarginLayout }) {
  return (
    <View
      fixed
      style={{ position: "absolute", top: 0, left: 0, width: 0, height: 0 }}
      render={({ pageNumber }) => {
        if (pageNumber <= 1) return null;
        return (
          <View
            style={{
              position: "absolute",
              top: layout.headerRuleTop,
              left: layout.margins.left,
              width: layout.contentWidth,
              height: 1,
              backgroundColor: "#000",
            }}
          />
        );
      }}
    />
  );
}

function FixedChrome({
  corpShort,
  meetingDateDisplay,
  layout,
}: {
  corpShort: string;
  meetingDateDisplay: string;
  layout: PdfMarginLayout;
}) {
  const { margins } = layout;

  return (
    <>
      <Text
        style={[
          styles.headerText,
          {
            position: "absolute",
            top: layout.headerCorpTop,
            left: margins.left,
            right: margins.right,
          },
        ]}
        fixed
        render={({ pageNumber }) => (pageNumber > 1 ? corpShort : "")}
      />
      <Text
        style={[
          styles.headerText,
          {
            position: "absolute",
            top: layout.headerMeetingTypeTop,
            left: margins.left,
            right: margins.right,
          },
        ]}
        fixed
        render={({ pageNumber }) =>
          pageNumber > 1 ? MEETING_TYPE_HEADER : ""
        }
      />
      <Text
        style={[
          styles.headerText,
          {
            position: "absolute",
            top: layout.headerDateTop,
            left: margins.left,
          },
        ]}
        fixed
        render={({ pageNumber }) =>
          pageNumber > 1 ? meetingDateDisplay : ""
        }
      />
      <Text
        style={[
          styles.headerPageText,
          {
            position: "absolute",
            top: layout.headerDateTop,
            right: margins.right,
          },
        ]}
        fixed
        render={({ pageNumber }) =>
          pageNumber > 1 ? `Page ${pageNumber}` : ""
        }
      />
      <RunningHeaderRule layout={layout} />
    </>
  );
}

function ContentCell({ children }: { children: React.ReactNode }) {
  return <View style={styles.contentCell}>{children}</View>;
}

function HangRow({
  marker,
  children,
  markerKind = "letter",
  wrap = true,
}: {
  marker?: string;
  children: React.ReactNode;
  markerKind?: "section" | "letter" | "roman";
  wrap?: boolean;
}) {
  const markerCellStyle =
    markerKind === "roman" ? styles.markerCellRoman : styles.markerCell;
  return (
    <View style={styles.hangRow} wrap={wrap}>
      <Text style={markerCellStyle}>{marker ?? ""}</Text>
      <ContentCell>{children}</ContentCell>
    </View>
  );
}

function ContentParagraph({
  children,
  textStyle,
}: {
  children: React.ReactNode;
  textStyle?: typeof styles.noteRight;
}) {
  return (
    <HangRow marker=" " wrap>
      <Text
        style={
          textStyle
            ? [styles.bodyParagraph, styles.bodyText, textStyle]
            : [styles.bodyParagraph, styles.bodyText]
        }
      >
        {children}
      </Text>
    </HangRow>
  );
}

function AttendeeBlocks({
  label,
  people,
}: {
  label: string;
  people: AttendeeV2[];
}) {
  if (!people.length) return null;

  return (
    <View style={{ flexDirection: "row", marginBottom: 8 }} wrap={false}>
      <View style={styles.attendanceLabelCol}>
        <Text style={styles.attendanceLabel}>{label}</Text>
      </View>
      <View style={styles.attendanceRowsCol}>
        {people.map((person, idx) => {
          const role = person.titleOrRole.trim();
          const company = person.company?.trim();
          const roleText =
            role && company
              ? `${role}, ${company}`
              : role || company || "";
          return (
            <View key={`${person.name}-${idx}`} style={styles.attendanceRow}>
              <Text style={styles.attendanceName}>{person.name.trim()}</Text>
              <Text style={styles.attendanceDash}>{roleText ? "-" : ""}</Text>
              <Text style={styles.attendanceRole}>{roleText}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MotionPdf({ motion }: { motion: MotionV2 }) {
  const status = motion.status.trim() || "Motion carried.";
  return (
    <View>
      <HangRow marker=" ">
        <Text style={styles.bodyParagraph}>
          <Text style={styles.motionKeyword}>MOTION</Text>
          <Text style={styles.motionRegular}> by {motion.movedBy.trim()}</Text>
        </Text>
      </HangRow>
      <HangRow marker=" ">
        <Text style={styles.bodyParagraph}>
          <Text style={styles.motionKeyword}>Seconded</Text>
          <Text style={styles.motionRegular}>
            {" "}
            by {motion.secondedBy.trim()}
          </Text>
        </Text>
      </HangRow>
      <HangRow marker=" ">
        <Text style={styles.bodyParagraph}>
          <Text style={styles.motionKeyword}>
            THAT {stripLeadingThatFromResolution(motion.resolutionText)}
          </Text>
          <Text style={styles.motionRegular}> {status}</Text>
        </Text>
      </HangRow>
    </View>
  );
}

function formatActionInlineBody(action: ActionItemV2): string {
  const assignee = action.assignee.trim();
  const task = action.taskDescription.trim();
  return assignee ? `${assignee} ${task}`.replace(/\s+/g, " ") : task;
}

function InlineAgendaTail({ item }: { item: AgendaItemV2 }) {
  const showStatus = shouldRenderAgendaStatus(item.status);
  const statusText = showStatus ? (item.status as string).trim() : "";
  const statusBold = showStatus && shouldBoldAgendaStatus(statusText);

  if (item.actionItems.length === 0 && !showStatus) return null;

  return (
    <>
      {item.actionItems.map((a, i) => (
        <Text key={`action-${i}`}>
          <Text style={styles.bodyText}> </Text>
          <Text style={styles.actionBold}>
            Action: {formatActionInlineBody(a)}
          </Text>
        </Text>
      ))}
      {showStatus ? (
        <Text>
          <Text style={styles.bodyText}> </Text>
          <Text style={statusBold ? styles.actionBold : styles.bodyText}>
            {statusText}
          </Text>
        </Text>
      ) : null}
    </>
  );
}

type AgendaItemRenderOptions = {
  /** Italicize the topic name (used in the Restricted Records Addendum). */
  italicTopic?: boolean;
};

function AgendaItemPdf({
  item,
  marker,
  depth,
  options,
}: {
  item: AgendaItemV2;
  marker: string;
  depth: number;
  options?: AgendaItemRenderOptions;
}) {
  const topic = item.topic.trim();
  const summary = item.summary.trim();
  const markerKind: "letter" | "roman" = depth > 0 ? "roman" : "letter";
  const topicStyle = options?.italicTopic
    ? styles.subsectionTitleItalic
    : styles.subsectionTitle;

  return (
    <View>
      <HangRow marker={marker} markerKind={markerKind}>
        <Text style={styles.bodyParagraph}>
          {topic ? <Text style={topicStyle}>{topic}</Text> : null}
          {topic && summary ? (
            <Text style={styles.bodyText}> – </Text>
          ) : null}
          {summary ? (
            <Text style={styles.bodyText}>{summary}</Text>
          ) : null}
          <InlineAgendaTail item={item} />
        </Text>
      </HangRow>

      {item.motion ? <MotionPdf motion={item.motion} /> : null}
      {item.subItems.map((sub, idx) => (
        <AgendaItemPdf
          key={`sub-${idx}`}
          item={sub}
          marker={romanMarker(idx)}
          depth={depth + 1}
          options={options}
        />
      ))}
    </View>
  );
}

function AgendaItemsPdf({
  items,
  startIndex = 0,
  options,
}: {
  items: AgendaItemV2[];
  /** Offset the letter marker by this many positions (e.g. 4 → start at "(e)"). */
  startIndex?: number;
  options?: AgendaItemRenderOptions;
}) {
  return (
    <View>
      {items.map((item, idx) => (
        <AgendaItemPdf
          key={`item-${idx}`}
          item={item}
          marker={letterMarker(startIndex + idx)}
          depth={0}
          options={options}
        />
      ))}
    </View>
  );
}

function TopSectionHeading({
  number,
  title,
}: {
  number: string;
  title: string;
}) {
  return (
    <View style={[styles.hangRow, { marginTop: 10 }]}>
      <Text style={[styles.markerCell, styles.sectionTopMarker]}>
        {number}.
      </Text>
      <ContentCell>
        <Text style={styles.sectionTopTitle}>{title.toUpperCase()}</Text>
      </ContentCell>
    </View>
  );
}

function SubsectionHeading({
  number,
  title,
  lead,
  tail,
  italicTitle = false,
}: {
  number: string;
  title: string;
  lead?: string;
  tail?: React.ReactNode;
  italicTitle?: boolean;
}) {
  const titleStyle = italicTitle
    ? styles.subsectionTitleItalic
    : styles.subsectionTitle;
  return (
    <View style={styles.hangRow}>
      <Text style={[styles.markerCell, styles.subsectionMarker]}>{number}</Text>
      <ContentCell>
        <Text style={styles.bodyParagraph}>
          <Text style={titleStyle}>{title}</Text>
          {lead?.trim() ? (
            <>
              <Text style={styles.bodyText}> – </Text>
              <Text style={styles.bodyText}>{lead.trim()}</Text>
            </>
          ) : null}
          {tail}
        </Text>
      </ContentCell>
    </View>
  );
}

function NumberedFinancialItems({
  sectionNum,
  items,
  startIndex = 0,
  italicTitle = false,
}: {
  sectionNum: string;
  items: AgendaItemV2[];
  /** Offset the subsection number by this many positions (e.g. 3 → start at "3.4"). */
  startIndex?: number;
  italicTitle?: boolean;
}) {
  return (
    <View>
      {items.map((item, idx) => {
        const num = `${sectionNum}.${startIndex + idx + 1}`;
        const topic = item.topic.trim();
        const summary = item.summary.trim();

        return (
          <View key={`fin-${idx}`}>
            <SubsectionHeading
              number={num}
              title={topic}
              lead={summary || undefined}
              tail={<InlineAgendaTail item={item} />}
              italicTitle={italicTitle}
            />
            {item.motion ? <MotionPdf motion={item.motion} /> : null}
            {item.subItems.length > 0 ? (
              <AgendaItemsPdf
                items={item.subItems}
                options={italicTitle ? { italicTopic: true } : undefined}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function ManagementBucket({
  sectionNum,
  subNum,
  title,
  items,
  startIndex = 0,
  italicTopic = false,
}: {
  sectionNum: string;
  subNum: number;
  title: string;
  items: AgendaItemV2[];
  startIndex?: number;
  italicTopic?: boolean;
}) {
  if (!items.length) return null;
  return (
    <View>
      <SubsectionHeading number={`${sectionNum}.${subNum}`} title={title} />
      <AgendaItemsPdf
        items={items}
        startIndex={startIndex}
        options={italicTopic ? { italicTopic: true } : undefined}
      />
    </View>
  );
}

function TitleAndAttendees({ doc }: { doc: MinutesDocumentV2 }) {
  const medium = meetingMediumFromMetadata(doc.metadata.meetingPlatform);
  const dateDisplay = formatMeetingDateDisplay(doc.metadata.meetingDate);
  const corp = doc.metadata.corporationName.trim();
  const timeClause = formatMeetingTimeClause(doc.metadata.meetingTime);
  const openerRest = ` of the meeting of the Board of Directors of ${corp} held ${medium} on ${dateDisplay}${timeClause}`;

  return (
    <View>
      <Text style={styles.docTitle}>
        <Text style={{ fontFamily: PDF_FONT, fontWeight: "bold" }}>MINUTES</Text>
        <Text>{openerRest}</Text>
      </Text>
      <HorizontalRule style={styles.attendanceSectionTopRule} />
      <AttendeeBlocks label="Present:" people={doc.attendance.present} />
      <AttendeeBlocks
        label="By Invitation:"
        people={doc.attendance.byInvitation}
      />
      {doc.attendance.guests.length > 0 ? (
        <AttendeeBlocks label="Guests:" people={doc.attendance.guests} />
      ) : null}
      <AttendeeBlocks label="Regrets:" people={doc.attendance.regrets} />
      <HorizontalRule style={styles.attendanceSectionBottomRule} />
    </View>
  );
}

function CallToOrderBody({ doc }: { doc: MinutesDocumentV2 }) {
  if (!doc.callToOrder) return null;
  const chairName = doc.callToOrder.chairName?.trim() || "the Chair";
  const time = doc.callToOrder.time?.trim().replace(/\.+$/, "");
  const timePhrase = time ? ` at ${time}.` : ".";

  return (
    <ContentParagraph>
      Proper notice having been given and there being a quorum present,{" "}
      {chairName} called the meeting to order
      {timePhrase} and presided as Chair.
    </ContentParagraph>
  );
}

function ApprovalOfPreviousMinutesBody({
  doc,
}: {
  doc: MinutesDocumentV2;
}) {
  if (!doc.approvalOfPreviousMinutes.length) return null;
  return (
    <View>
      {doc.approvalOfPreviousMinutes.map((approval, idx) => (
        <View key={`appr-${idx}`}>
          {approval.amendmentsNoted ? (
            <ContentParagraph>
              The Chair asked for any errors or omissions in the minutes of the
              Board meeting of{" "}
              {approval.previousMeetingDate
                ? formatMeetingDateDisplay(approval.previousMeetingDate)
                : "the previous meeting"}{" "}
              that were circulated previously for review. Several amendments
              were agreed to and incorporated into a clean copy of the minutes.
            </ContentParagraph>
          ) : null}
          {approval.motion ? <MotionPdf motion={approval.motion} /> : null}
        </View>
      ))}
    </View>
  );
}

function DateOfNextMeetingBody({ doc }: { doc: MinutesDocumentV2 }) {
  if (!doc.dateOfNextMeeting) return null;
  const location = doc.dateOfNextMeeting.location?.trim();
  const date = doc.dateOfNextMeeting.date
    ? formatMeetingDateDisplay(doc.dateOfNextMeeting.date)
    : "";
  const time = doc.dateOfNextMeeting.time?.trim().replace(/\.+$/, "");

  return (
    <ContentParagraph>
      The next meeting of the Board of Directors will be held
      {location ? ` ${location}` : " virtually"}
      {date ? ` on ${date}` : ""}
      {time ? ` commencing at ${time}.` : "."}
    </ContentParagraph>
  );
}

/** Split helpers that give the renderer ready-to-iterate item lists. */
function publicOnly(items: AgendaItemV2[]): AgendaItemV2[] {
  return partitionRestricted(items).public;
}

function restrictedOnly(items: AgendaItemV2[]): AgendaItemV2[] {
  return partitionRestricted(items).restricted;
}

function MainBody({ doc }: { doc: MinutesDocumentV2 }) {
  const mr = doc.managementReport;

  const publicFinancial = publicOnly(doc.financialMatters);
  const publicRatification = publicOnly(mr.itemsForRatification);
  const publicApprovalDiscussion = publicOnly([
    ...mr.itemsForApproval,
    ...mr.itemsForDiscussion,
  ]);
  const publicInformation = publicOnly(mr.itemsForInformation);
  const publicNewBusiness = publicOnly(doc.newOrOtherBusiness);

  const hasManagement =
    publicRatification.length > 0 ||
    publicApprovalDiscussion.length > 0 ||
    publicInformation.length > 0;

  return (
    <View>
      <TopSectionHeading number="1" title="Call to Order" />
      <CallToOrderBody doc={doc} />

      {doc.approvalOfPreviousMinutes.length > 0 ? (
        <View>
          <TopSectionHeading number="2" title="Approval of Previous Minutes" />
          <ApprovalOfPreviousMinutesBody doc={doc} />
        </View>
      ) : null}

      {publicFinancial.length > 0 ? (
        <View>
          <TopSectionHeading number="3" title="Financial Matters" />
          <NumberedFinancialItems sectionNum="3" items={publicFinancial} />
        </View>
      ) : null}

      {hasManagement ? (
        <View>
          <TopSectionHeading number="4" title="Management Report" />
          <ManagementBucket
            sectionNum="4"
            subNum={1}
            title="Items for Ratification"
            items={publicRatification}
          />
          <ManagementBucket
            sectionNum="4"
            subNum={2}
            title="Items for Board Discussion and/or Approval"
            items={publicApprovalDiscussion}
          />
          <ManagementBucket
            sectionNum="4"
            subNum={3}
            title="Items for Board Information"
            items={publicInformation}
          />
        </View>
      ) : null}

      {publicNewBusiness.length > 0 ? (
        <View>
          <TopSectionHeading number="5" title="New / Other Business" />
          <AgendaItemsPdf items={publicNewBusiness} />
        </View>
      ) : null}

      {doc.dateOfNextMeeting ? (
        <View>
          <TopSectionHeading number="6" title="Date of Next Meeting" />
          <DateOfNextMeetingBody doc={doc} />
        </View>
      ) : null}

      {doc.termination?.time ? (
        <View>
          <TopSectionHeading number="7" title="Meeting Conclusion" />
          <ContentParagraph>
            There being no further business to discuss, the meeting was
            unanimously concluded at{" "}
            {doc.termination.time.replace(/\.+$/, "")}.
          </ContentParagraph>
        </View>
      ) : null}

      {doc.postTerminationSections.map((section, idx) => (
        <View key={`post-${idx}`}>
          <TopSectionHeading number={String(8 + idx)} title={section.title} />
          <AgendaItemsPdf items={publicOnly(section.items)} />
        </View>
      ))}

      <SignatureLines />
    </View>
  );
}

/**
 * Restricted Records Addendum — collects every item flagged `restricted: true`,
 * groups them by their parent section bucket, and renders them with letter
 * markers (or subsection numbers, for financial matters) that continue past
 * the count of public items in the same bucket.
 */
function AddendumPdf({
  doc,
  corpShort,
  meetingDateDisplay,
  layout,
}: {
  doc: MinutesDocumentV2;
  corpShort: string;
  meetingDateDisplay: string;
  layout: PdfMarginLayout;
}) {
  if (!hasAnyRestrictedItem(doc)) return null;

  const mr = doc.managementReport;

  const finPub = publicOnly(doc.financialMatters);
  const finRest = restrictedOnly(doc.financialMatters);

  const ratPub = publicOnly(mr.itemsForRatification);
  const ratRest = restrictedOnly(mr.itemsForRatification);

  const apprDiscCombined = [
    ...mr.itemsForApproval,
    ...mr.itemsForDiscussion,
  ];
  const apprDiscPub = publicOnly(apprDiscCombined);
  const apprDiscRest = restrictedOnly(apprDiscCombined);

  const infoPub = publicOnly(mr.itemsForInformation);
  const infoRest = restrictedOnly(mr.itemsForInformation);

  const newBizPub = publicOnly(doc.newOrOtherBusiness);
  const newBizRest = restrictedOnly(doc.newOrOtherBusiness);

  const hasFinancialRestricted = finRest.length > 0;
  const hasManagementRestricted =
    ratRest.length > 0 || apprDiscRest.length > 0 || infoRest.length > 0;
  const hasNewBusinessRestricted = newBizRest.length > 0;

  const postTermRestricted = doc.postTerminationSections
    .map((section, idx) => ({
      idx,
      section,
      pub: publicOnly(section.items),
      rest: restrictedOnly(section.items),
    }))
    .filter((entry) => entry.rest.length > 0);

  return (
    <Page size="LETTER" style={buildPageStyle(layout)} wrap>
      <FixedChrome
        corpShort={corpShort}
        meetingDateDisplay={meetingDateDisplay}
        layout={layout}
      />
      <Text style={styles.addendumHeading}>{RESTRICTED_ADDENDUM_TITLE}</Text>
      <CondominiumActItalicText
        text={RESTRICTED_ADDENDUM_SUBTITLE}
        style={styles.addendumRestrictedTitle}
      />
      <Text style={styles.addendumConfidentialHeading}>
        {RESTRICTED_ADDENDUM_SECTION_HEADING}
      </Text>
      <CondominiumActItalicText
        text={RESTRICTED_ADDENDUM_DISCLAIMER}
        style={styles.addendumDisclaimer}
      />

      {hasFinancialRestricted ? (
        <View>
          <TopSectionHeading number="3" title="Financial Matters, continued." />
          <NumberedFinancialItems
            sectionNum="3"
            items={finRest}
            startIndex={finPub.length}
            italicTitle
          />
        </View>
      ) : null}

      {hasManagementRestricted ? (
        <View>
          <TopSectionHeading
            number="4"
            title="Management Report, continued."
          />
          <ManagementBucket
            sectionNum="4"
            subNum={1}
            title="Items for Ratification"
            items={ratRest}
            startIndex={ratPub.length}
            italicTopic
          />
          <ManagementBucket
            sectionNum="4"
            subNum={2}
            title="Items for Board Discussion and/or Approval"
            items={apprDiscRest}
            startIndex={apprDiscPub.length}
            italicTopic
          />
          <ManagementBucket
            sectionNum="4"
            subNum={3}
            title="Items for Board Information"
            items={infoRest}
            startIndex={infoPub.length}
            italicTopic
          />
        </View>
      ) : null}

      {hasNewBusinessRestricted ? (
        <View>
          <TopSectionHeading
            number="5"
            title="New / Other Business, continued."
          />
          <AgendaItemsPdf
            items={newBizRest}
            startIndex={newBizPub.length}
            options={{ italicTopic: true }}
          />
        </View>
      ) : null}

      {postTermRestricted.map((entry) => (
        <View key={`post-rest-${entry.idx}`}>
          <TopSectionHeading
            number={String(8 + entry.idx)}
            title={`${entry.section.title}, continued.`}
          />
          <AgendaItemsPdf
            items={entry.rest}
            startIndex={entry.pub.length}
            options={{ italicTopic: true }}
          />
        </View>
      ))}

      <SignatureLines />
    </Page>
  );
}

type Props = {
  document: MinutesDocumentV2;
  margins?: PdfMargins;
};

function corpShortFromName(corpLong: string): string {
  const match = /No\.\s*(\d+)/i.exec(corpLong);
  if (match) return `T.S.C.C. #${match[1]}`;
  return corpLong.slice(0, 24);
}

/** Letter-sized PDF from semantic minutes schema v2. */
export default function MinutesPdfDocV2({
  document: doc,
  margins = DEFAULT_PDF_MARGINS,
}: Props) {
  const meetingDateDisplay = formatMeetingDateDisplay(doc.metadata.meetingDate);
  const corpShort = corpShortFromName(doc.metadata.corporationName);
  const layout = computeMarginLayout(margins);

  return (
    <Document>
      <Page size="LETTER" style={buildPageStyle(layout)} wrap>
        <FixedChrome
          corpShort={corpShort}
          meetingDateDisplay={meetingDateDisplay}
          layout={layout}
        />
        <View style={{ marginTop: layout.pageOneTitleOffset }}>
          <TitleAndAttendees doc={doc} />
        </View>
        <MainBody doc={doc} />
      </Page>
      <AddendumPdf
        doc={doc}
        corpShort={corpShort}
        meetingDateDisplay={meetingDateDisplay}
        layout={layout}
      />
    </Document>
  );
}
