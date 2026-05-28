import React from "react";
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import {
  CORP_LONG,
  CORP_SHORT,
  MEETING_TYPE_HEADER,
} from "@/lib/pdf/corporation";
import { PDF_FONT, registerPdfFonts } from "@/lib/pdf/fonts";
import {
  hangingIndentStyles,
  LEFT_MARGIN,
  MARKER_WIDTH,
} from "@/lib/pdf/hanging-indent";
import { SignatureLines } from "@/lib/pdf/signature-lines";
import type {
  Block,
  ListItem,
  MinutesDocument,
  Section,
} from "@/lib/minutes/schema";

registerPdfFonts();

/** Disable automatic hyphenation so justified text does not break mid-word. */
function noHyphenation(word: string) {
  return [word];
}

Font.registerHyphenationCallback(noHyphenation);

function formatMeetingTime(time: string): string {
  const trimmed = time.trim().replace(/\.+$/, "");
  return trimmed ? `${trimmed}.` : "";
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 72,
    paddingBottom: 72,
    paddingHorizontal: LEFT_MARGIN,
    fontFamily: PDF_FONT,
    fontSize: 11,
    lineHeight: 1.25,
    color: "#000",
  },
  fixedHeader: {
    position: "absolute",
    top: 28,
    left: LEFT_MARGIN,
    right: LEFT_MARGIN,
    textAlign: "center",
    fontSize: 10,
    lineHeight: 1.3,
    fontFamily: PDF_FONT,
  },
  docTitle: {
    fontSize: 11,
    fontFamily: PDF_FONT,
    marginBottom: 16,
    textAlign: "justify",
    lineHeight: 1.25,
  },
  labelBold: {
    fontFamily: PDF_FONT,
  },
  attendeeFirst: {
    marginBottom: 2,
  },
  attendeeCont: {
    marginLeft: MARKER_WIDTH,
    marginBottom: 2,
  },
  hangRow: hangingIndentStyles.hangRow,
  markerCell: hangingIndentStyles.markerCell,
  markerCellRoman: hangingIndentStyles.markerCellRoman,
  contentCell: hangingIndentStyles.contentCell,
  sectionTopTitle: hangingIndentStyles.sectionTopTitle,
  subsectionTitle: hangingIndentStyles.subsectionTitle,
  bodyParagraph: hangingIndentStyles.bodyParagraph,
  bodyText: hangingIndentStyles.bodyText,
  actionBold: hangingIndentStyles.actionBold,
  motionLine: {
    fontFamily: PDF_FONT,
    fontWeight: "bold",
    marginBottom: 2,
  },
  noteRight: hangingIndentStyles.noteRight,
  addendumHeading: {
    fontFamily: PDF_FONT,
    fontWeight: "bold",
    fontSize: 11,
    marginTop: 12,
    marginBottom: 8,
    textAlign: "center",
    textTransform: "uppercase",
  },
  addendumSub: {
    fontSize: 10,
    marginBottom: 10,
    textAlign: "center",
    fontFamily: PDF_FONT,
  },
});

function FixedChrome({ meetingDateDisplay }: { meetingDateDisplay: string }) {
  return (
    <>
      <View style={styles.fixedHeader} fixed>
        <Text render={({ pageNumber }) => (pageNumber > 1 ? CORP_SHORT : "")} />
        <Text
          render={({ pageNumber }) =>
            pageNumber > 1 ? MEETING_TYPE_HEADER : ""
          }
        />
        <Text
          render={({ pageNumber }) =>
            pageNumber > 1 ? `${meetingDateDisplay}   Page ${pageNumber}` : ""
          }
        />
      </View>
    </>
  );
}

function splitLabelBody(text: string): { label: string; body: string } | null {
  const match = text.match(/^(.+?[–—-])\s*([\s\S]+)$/);
  if (!match) return null;
  return { label: match[1], body: match[2] };
}

function ContentCell({ children }: { children: React.ReactNode }) {
  return <View style={styles.contentCell}>{children}</View>;
}

function HangRow({
  marker,
  children,
  roman = false,
}: {
  marker: string;
  children: React.ReactNode;
  roman?: boolean;
}) {
  return (
    <View style={styles.hangRow}>
      <Text style={roman ? styles.markerCellRoman : styles.markerCell}>
        {marker}
      </Text>
      <ContentCell>{children}</ContentCell>
    </View>
  );
}

function ContentParagraph({ children }: { children: React.ReactNode }) {
  return (
    <HangRow marker=" ">
      <Text style={[styles.bodyParagraph, styles.bodyText]}>{children}</Text>
    </HangRow>
  );
}

function MixedWeightLine({ text }: { text: string }) {
  const split = splitLabelBody(text);
  if (!split) {
    return <Text style={styles.subsectionTitle}>{text}</Text>;
  }
  return (
    <Text style={styles.bodyParagraph}>
      <Text style={styles.subsectionTitle}>{split.label}</Text>
      <Text style={styles.bodyText}> {split.body}</Text>
    </Text>
  );
}

function formatAttendeeLine(a: { name: string; role: string }): string {
  const role = a.role.trim();
  return role ? `${a.name} - ${role}` : a.name;
}

function AttendeeBlocks({
  label,
  people,
}: {
  label: string;
  people: { name: string; role: string }[];
}) {
  if (!people.length) return null;
  const [first, ...rest] = people;
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={styles.attendeeFirst}>
        <Text style={styles.labelBold}>{label}</Text>
        <Text> {formatAttendeeLine(first)}</Text>
      </Text>
      {rest.map((p, i) => (
        <Text key={`${p.name}-${i}`} style={styles.attendeeCont}>
          {formatAttendeeLine(p)}
        </Text>
      ))}
    </View>
  );
}

function MotionPdf({
  mover,
  seconder,
  resolution,
  outcome,
}: {
  mover: string;
  seconder: string;
  resolution: string;
  outcome: string;
}) {
  const end = outcome.trim() || "Motion carried.";
  return (
    <View>
      <HangRow marker=" ">
        <Text style={[styles.bodyParagraph, styles.motionLine]}>
          MOTION by {mover.trim()}
        </Text>
      </HangRow>
      <HangRow marker=" ">
        <Text style={[styles.bodyParagraph, styles.motionLine]}>
          Seconded by {seconder.trim()}
        </Text>
      </HangRow>
      <HangRow marker=" ">
        <Text style={[styles.bodyParagraph, styles.motionLine]}>
          THAT {resolution.trim()}
        </Text>
      </HangRow>
      <HangRow marker=" ">
        <Text style={[styles.bodyParagraph, styles.motionLine]}>{end}</Text>
      </HangRow>
    </View>
  );
}

function renderListItemPdf(
  item: ListItem,
  style: "letter" | "roman",
  depth: number,
) {
  const title = item.title?.trim();
  const roman = style === "roman" || depth > 0;
  return (
    <View key={item.marker + title}>
      <HangRow marker={`${item.marker}`} roman={roman}>
        {title ? <MixedWeightLine text={title} /> : <Text> </Text>}
      </HangRow>
      {renderBlocksPdf(item.blocks, depth + 1)}
    </View>
  );
}

function renderBlocksPdf(blocks: Block[], depth = 0) {
  return blocks.map((b, idx) => {
    const key = `b-${idx}-${b.kind}`;
    switch (b.kind) {
      case "paragraph": {
        const t = b.text.trim();
        if (!t) return null;
        return <ContentParagraph key={key}>{t}</ContentParagraph>;
      }
      case "motion":
        return (
          <MotionPdf
            key={key}
            mover={b.mover}
            seconder={b.seconder}
            resolution={b.resolution}
            outcome={b.outcome}
          />
        );
      case "action":
        return (
          <HangRow key={key} marker=" ">
            <Text style={[styles.bodyParagraph, styles.actionBold]}>
              Action: {b.text.trim()}
            </Text>
          </HangRow>
        );
      case "note":
        return (
          <HangRow key={key} marker=" ">
            <Text style={styles.noteRight}>{b.text.trim()}</Text>
          </HangRow>
        );
      case "list":
        return (
          <View key={key}>
            {b.items.map((item) => renderListItemPdf(item, b.style, depth))}
          </View>
        );
      default:
        return null;
    }
  });
}

function SectionPdf({ section, depth }: { section: Section; depth: number }) {
  const num = section.number.trim();
  const title = section.title.trim();
  const isTop = depth === 0 && /^\d+$/.test(num);
  const lead = section.lead?.trim();

  return (
    <View>
      {isTop ? (
        <View style={[styles.hangRow, { marginTop: 10 }]}>
          <Text style={styles.markerCell}>{num}.</Text>
          <ContentCell>
            <Text style={styles.sectionTopTitle}>{title.toUpperCase()}</Text>
          </ContentCell>
        </View>
      ) : (
        <HangRow marker={num}>
          {lead ? (
            <Text style={styles.bodyParagraph}>
              <Text style={styles.subsectionTitle}>{title}</Text>
              <Text style={styles.bodyText}> – {lead}</Text>
            </Text>
          ) : (
            <MixedWeightLine text={`${title}`} />
          )}
        </HangRow>
      )}
      {renderBlocksPdf(section.blocks)}
      {(section.subsections ?? []).map((sub, i) => (
        <SectionPdf key={`${sub.number}-${i}`} section={sub} depth={depth + 1} />
      ))}
    </View>
  );
}

function TitleAndAttendees({ doc }: { doc: MinutesDocument }) {
  const medium = doc.meetingMedium.trim() || "virtually";
  const time = formatMeetingTime(doc.meetingTime);
  const timeClause = time ? ` at ${time}` : "";
  const openerRest = ` of the meeting of the Board of Directors of ${CORP_LONG} held ${medium} on ${doc.meetingDateDisplay}${timeClause}.`;

  return (
    <View>
      <Text style={styles.docTitle}>
        <Text style={{ fontFamily: PDF_FONT, fontWeight: "bold" }}>MINUTES</Text>
        <Text>{openerRest}</Text>
      </Text>
      <AttendeeBlocks label="Present:" people={doc.present} />
      <AttendeeBlocks label="By Invitation:" people={doc.byInvitation} />
      <AttendeeBlocks label="Regrets:" people={doc.regrets} />
    </View>
  );
}

function AddendumPdf({ doc }: { doc: MinutesDocument }) {
  const ad = doc.addendum;
  if (!ad) return null;

  return (
    <Page size="LETTER" style={styles.page} wrap>
      <FixedChrome meetingDateDisplay={doc.meetingDateDisplay} />
      <Text style={styles.addendumHeading}>
        {ad.title.trim() || "ADDENDUM TO THE MINUTES / RESTRICTED RECORDS"}
      </Text>
      {ad.preamble?.trim() ? (
        <Text style={styles.addendumSub}>{ad.preamble.trim()}</Text>
      ) : (
        <Text style={styles.addendumSub}>
          (s. 55(4) of the Condominium Act, 1998)
        </Text>
      )}
      {ad.sections.map((s, i) => (
        <SectionPdf key={`ad-${i}`} section={s} depth={0} />
      ))}
      <SignatureLines count={doc.signatures} />
    </Page>
  );
}

type Props = {
  document: MinutesDocument;
};

/** Letter-sized PDF from structured minutes (matches corporation template). */
export default function MinutesPdfDoc({ document: doc }: Props) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        <FixedChrome meetingDateDisplay={doc.meetingDateDisplay} />
        <TitleAndAttendees doc={doc} />
        {doc.sections.map((s, i) => (
          <SectionPdf key={`sec-${i}`} section={s} depth={0} />
        ))}
        <SignatureLines count={doc.signatures} />
      </Page>
      <AddendumPdf doc={doc} />
    </Document>
  );
}
