// Extracts positional text info (x, y, font, size) from a PDF so we can
// inspect the LAYOUT of the third-party reference vs. the system-produced PDF.
// Uses the copy of pdf.js bundled inside pdf-parse to avoid extra installs.

import fs from "node:fs";
import path from "node:path";

const PDF_JS_PATH = path.resolve(
  "node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js",
);
const pdfjs = await import(`file:///${PDF_JS_PATH.replace(/\\/g, "/")}`);

function inferAlign(item, pageWidth) {
  const x = item.transform[4];
  const width = item.width ?? 0;
  const left = x;
  const right = x + width;
  const center = (left + right) / 2;
  const pageCenter = pageWidth / 2;
  const leftMargin = left;
  const rightMargin = pageWidth - right;
  if (Math.abs(center - pageCenter) < 8 && leftMargin > 60 && rightMargin > 60) {
    return "center";
  }
  if (rightMargin < 16) return "right";
  return "left";
}

async function inspect(file) {
  const buf = fs.readFileSync(file);
  const data = new Uint8Array(buf);
  const loadingTask = pdfjs.getDocument({ data, disableFontFace: true });
  const doc = await loadingTask.promise;

  const out = [];
  out.push(`=== ${path.basename(file)} ===`);
  out.push(`Pages: ${doc.numPages}`);

  const pagesToInspect = doc.numPages;
  for (let p = 1; p <= pagesToInspect; p += 1) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    out.push(
      `--- Page ${p} (${viewport.width.toFixed(0)} x ${viewport.height.toFixed(0)}) ---`,
    );

    const content = await page.getTextContent({ disableCombineTextItems: false });
    const items = content.items
      .filter((it) => it.str.trim().length > 0)
      .map((it) => {
        const x = it.transform[4];
        const y = it.transform[5];
        const fontSize = Math.abs(it.transform[0]);
        return {
          str: it.str,
          x: +x.toFixed(1),
          y: +y.toFixed(1),
          width: +(it.width ?? 0).toFixed(1),
          fontSize: +fontSize.toFixed(1),
          fontName: it.fontName,
          align: inferAlign(it, viewport.width),
        };
      })
      .sort((a, b) => b.y - a.y || a.x - b.x);

    for (const it of items) {
      out.push(
        `y=${it.y} x=${it.x} w=${it.width} sz=${it.fontSize} ${it.fontName} ${it.align}  | ${it.str}`,
      );
    }
  }

  return out.join("\n");
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node inspect-pdf-layout.mjs <pdf> [<pdf> ...]");
  process.exit(1);
}

for (const f of files) {
  console.log(await inspect(f));
  console.log("");
}
