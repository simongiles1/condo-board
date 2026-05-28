import path from "node:path";

import { Font } from "@react-pdf/renderer";

const fontsDir = path.join(process.cwd(), "lib", "pdf", "fonts");

let registered = false;

/** Register bundled Arial faces for server-side PDF export. */
export function registerPdfFonts(): void {
  if (registered) return;
  Font.register({
    family: "Arial",
    fonts: [
      {
        src: path.join(fontsDir, "Arial.ttf"),
        fontWeight: "normal",
        fontStyle: "normal",
      },
      {
        src: path.join(fontsDir, "Arial-Bold.ttf"),
        fontWeight: "bold",
        fontStyle: "normal",
      },
      {
        src: path.join(fontsDir, "Arial-Italic.ttf"),
        fontWeight: "normal",
        fontStyle: "italic",
      },
      {
        src: path.join(fontsDir, "Arial-BoldItalic.ttf"),
        fontWeight: "bold",
        fontStyle: "italic",
      },
    ],
  });
  registered = true;
}

export const PDF_FONT = "Arial";
