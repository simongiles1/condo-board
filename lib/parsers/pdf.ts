import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (
  data: Buffer,
) => Promise<{ text: string }>;

/** Extract plaintext from PDF (style reference — not factual source per constitution). */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const res = await pdfParse(buffer);
  return (res.text ?? "").trim();
}
