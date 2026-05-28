import { StyleSheet, Text, View } from "@react-pdf/renderer";

import { PDF_FONT } from "@/lib/pdf/fonts";
import { MARKER_WIDTH } from "@/lib/pdf/hanging-indent";

const styles = StyleSheet.create({
  container: {
    marginTop: 32,
    marginLeft: MARKER_WIDTH,
  },
  block: {
    marginBottom: 32,
  },
  signatureDateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 2,
  },
  signatureLine: {
    width: "62%",
    height: 22,
    borderBottomWidth: 1,
    borderBottomColor: "#000",
  },
  label: {
    fontFamily: PDF_FONT,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  dateLine: {
    width: 108,
    height: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#000",
  },
});

/** Director signature + date blocks at the end of minutes pages. */
export function SignatureLines({ count = 2 }: { count?: number }) {
  const lines = Math.max(0, count);

  return (
    <View style={styles.container} wrap={false}>
      {Array.from({ length: lines }).map((_, i) => (
        <View key={i} style={styles.block}>
          <View style={styles.signatureDateRow}>
            <View style={styles.signatureLine} />
            <View style={styles.dateRow}>
              <Text style={styles.label}>Date: </Text>
              <View style={styles.dateLine} />
            </View>
          </View>
          <Text style={styles.label}>Director</Text>
        </View>
      ))}
    </View>
  );
}
