/**
 * Golden-set manifest helpers for page-route calibration UI + scripts.
 */

import { access, readFile, writeFile } from "fs/promises";
import path from "path";

export type PageRouteLabel = "text" | "vision" | "ambiguous";

export type GoldenManifestPage = {
  pageNo: number;
  expectedRoute: PageRouteLabel;
  notes?: string;
};

export type GoldenManifestDoc = {
  id: string;
  bucket?: string;
  contentHash: string;
  filename?: string;
  pageCount?: number | null;
  pages: GoldenManifestPage[];
  note?: string;
};

export type GoldenManifest = {
  version: number;
  description?: string;
  thresholdsFile?: string;
  labelGuide?: Record<string, string>;
  documents: GoldenManifestDoc[];
};

export const GOLDEN_MANIFEST_RELATIVE =
  "fixtures/golden-attachments/manifest.json";

export function goldenManifestAbsolutePath(): string {
  return path.join(process.cwd(), GOLDEN_MANIFEST_RELATIVE);
}

export async function readGoldenManifest(): Promise<GoldenManifest> {
  const raw = await readFile(goldenManifestAbsolutePath(), "utf8");
  const parsed = JSON.parse(raw) as GoldenManifest;
  if (!Array.isArray(parsed.documents)) {
    throw new Error("Golden manifest missing documents array.");
  }
  return parsed;
}

export async function writeGoldenManifest(
  manifest: GoldenManifest,
): Promise<void> {
  const payload = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(goldenManifestAbsolutePath(), payload, "utf8");
}

export async function resolveCachedPdfAbsolutePath(
  contentHash: string,
): Promise<string | null> {
  const candidate = path.join(
    process.cwd(),
    "data",
    "email-attachments",
    `${contentHash}.pdf`,
  );
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export function isPageRouteLabel(value: unknown): value is PageRouteLabel {
  return value === "text" || value === "vision" || value === "ambiguous";
}

/** Merge page labels for one document; replaces that doc's pages array. */
export function upsertDocumentPages(
  manifest: GoldenManifest,
  documentId: string,
  pages: GoldenManifestPage[],
): GoldenManifest {
  const documents = manifest.documents.map((doc) => {
    if (doc.id !== documentId) return doc;
    const cleaned = [...pages]
      .filter(
        (p) =>
          Number.isFinite(p.pageNo) &&
          p.pageNo >= 1 &&
          isPageRouteLabel(p.expectedRoute),
      )
      .map((p) => ({
        pageNo: Math.floor(p.pageNo),
        expectedRoute: p.expectedRoute,
        ...(p.notes?.trim() ? { notes: p.notes.trim() } : {}),
      }))
      .sort((a, b) => a.pageNo - b.pageNo);
    return {
      ...doc,
      pages: cleaned,
      note:
        cleaned.length > 0
          ? `Labeled ${cleaned.length} page(s) via UI`
          : doc.note,
    };
  });

  if (!documents.some((d) => d.id === documentId)) {
    throw new Error(`Document not found in manifest: ${documentId}`);
  }

  return { ...manifest, documents };
}

export function labelingProgress(manifest: GoldenManifest): {
  totalDocs: number;
  labeledDocs: number;
  totalLabeledPages: number;
} {
  let labeledDocs = 0;
  let totalLabeledPages = 0;
  for (const doc of manifest.documents) {
    const n = doc.pages?.length ?? 0;
    if (n > 0) labeledDocs += 1;
    totalLabeledPages += n;
  }
  return {
    totalDocs: manifest.documents.length,
    labeledDocs,
    totalLabeledPages,
  };
}
