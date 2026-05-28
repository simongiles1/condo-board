import { StyleSheet } from "@react-pdf/renderer";

import { PDF_FONT } from "@/lib/pdf/fonts";

/** Left page margin (pt). */
export const LEFT_MARGIN = 72;

/** Width of the marker column (numbers, (a), etc.) — text starts after this. */
export const MARKER_WIDTH = 36;

/** Extra shift for roman numeral sub-items inside a lettered item. */
export const ROMAN_MARKER_INDENT = 18;

export const hangingIndentStyles = StyleSheet.create({
  hangRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  markerCell: {
    width: MARKER_WIDTH,
    fontFamily: PDF_FONT,
  },
  markerCellRoman: {
    width: MARKER_WIDTH - ROMAN_MARKER_INDENT,
    marginLeft: ROMAN_MARKER_INDENT,
    fontFamily: PDF_FONT,
  },
  contentCell: {
    flex: 1,
    fontFamily: PDF_FONT,
  },
  bodyParagraph: {
    fontFamily: PDF_FONT,
    marginBottom: 0,
    textAlign: "justify",
  },
  sectionTopTitle: {
    fontFamily: PDF_FONT,
    fontWeight: "bold",
    textTransform: "uppercase",
    textDecoration: "underline",
  },
  subsectionTitle: {
    fontFamily: PDF_FONT,
    fontWeight: "bold",
  },
  bodyText: {
    fontFamily: PDF_FONT,
  },
  actionBold: {
    fontFamily: PDF_FONT,
    fontWeight: "bold",
  },
  motionKeyword: {
    fontFamily: PDF_FONT,
    fontWeight: "bold",
  },
  noteRight: {
    fontFamily: PDF_FONT,
    fontStyle: "italic",
    textAlign: "right",
  },
});
