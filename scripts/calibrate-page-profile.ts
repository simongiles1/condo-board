/**
 * Calibrate page-profile thresholds against a labeled golden-set manifest.
 *
 * Expects fixtures/golden-attachments/manifest.json with per-page expectedRoute.
 * Profiles each document from the attachment cache and prints a confusion
 * matrix + base-rate stats (no threshold auto-tuning — report only).
 *
 * Usage:
 *   npm run golden:calibrate-page-profile
 *   npx tsx scripts/calibrate-page-profile.ts --manifest=fixtures/golden-attachments/manifest.json
 */

import { readFile } from "fs/promises";
import path from "path";

import {
  profilePdfPages,
  summarizeProfiles,
  type PageRoute,
} from "../lib/pdf/page-profile";

type ManifestPage = {
  pageNo: number;
  expectedRoute: PageRoute;
  notes?: string;
};

type ManifestDoc = {
  id: string;
  bucket?: string;
  contentHash: string;
  filename?: string;
  pages: ManifestPage[];
};

type Manifest = {
  version: number;
  documents: ManifestDoc[];
};

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function resolvePdf(contentHash: string): Promise<string | null> {
  const candidate = path.join(
    process.cwd(),
    "data",
    "email-attachments",
    `${contentHash}.pdf`,
  );
  try {
    await readFile(candidate);
    return candidate;
  } catch {
    return null;
  }
}

async function main() {
  const manifestPath = path.resolve(
    process.cwd(),
    argValue("manifest") ?? "fixtures/golden-attachments/manifest.json",
  );

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    console.error(
      `[calibrate] Missing manifest at ${manifestPath}.\n` +
        `Generate candidates with:\n` +
        `  npm run golden:attachment-candidates > fixtures/golden-attachments/manifest.json\n` +
        `Then label each document's pages[].expectedRoute.`,
    );
    process.exit(1);
    return;
  }

  const manifest = JSON.parse(raw) as Manifest;
  if (!Array.isArray(manifest.documents) || manifest.documents.length === 0) {
    console.error("[calibrate] manifest.documents is empty.");
    process.exit(1);
  }

  const labeledDocs = manifest.documents.filter((d) => d.pages?.length > 0);
  if (labeledDocs.length === 0) {
    console.error(
      "[calibrate] No labeled pages yet. Fill documents[].pages with { pageNo, expectedRoute }.",
    );
    console.error(
      `Found ${manifest.documents.length} document stubs — open each PDF and label pages.`,
    );
    process.exit(2);
  }

  const routes: PageRoute[] = ["text", "vision", "ambiguous"];
  const confusion: Record<PageRoute, Record<PageRoute, number>> = {
    text: { text: 0, vision: 0, ambiguous: 0 },
    vision: { text: 0, vision: 0, ambiguous: 0 },
    ambiguous: { text: 0, vision: 0, ambiguous: 0 },
  };

  let compared = 0;
  let falseNegatives = 0; // expected vision, predicted text
  let allProfiles = 0;
  let visionPredicted = 0;
  let ambiguousPredicted = 0;

  for (const doc of labeledDocs) {
    const pdfPath = await resolvePdf(doc.contentHash);
    if (!pdfPath) {
      console.warn(`[calibrate] missing PDF for ${doc.id} ${doc.contentHash}`);
      continue;
    }

    const bytes = await readFile(pdfPath);
    const profiles = await profilePdfPages(bytes);
    const summary = summarizeProfiles(profiles);
    allProfiles += summary.totalPages;
    visionPredicted += summary.vision;
    ambiguousPredicted += summary.ambiguous;

    const byPage = new Map(profiles.map((p) => [p.pageNo, p]));
    console.info(
      `[calibrate] ${doc.id} ${doc.filename ?? doc.contentHash.slice(0, 12)} ` +
        `text=${summary.text} vision=${summary.vision} ambiguous=${summary.ambiguous}`,
    );

    for (const label of doc.pages) {
      const predicted = byPage.get(label.pageNo);
      if (!predicted) {
        console.warn(
          `  page ${label.pageNo}: missing from profiler (PDF has ${profiles.length} pages)`,
        );
        continue;
      }
      confusion[label.expectedRoute][predicted.route] += 1;
      compared += 1;
      if (label.expectedRoute === "vision" && predicted.route === "text") {
        falseNegatives += 1;
        console.warn(
          `  FN page ${label.pageNo}: expected vision, got text ` +
            `(chars=${predicted.chars} textArea=${predicted.textAreaRatio} ` +
            `imageArea=${predicted.imageAreaRatio} vectorOps=${predicted.vectorOps})`,
        );
      }
    }
  }

  console.info("\nConfusion matrix (rows=expected, cols=predicted):");
  console.info(["", ...routes].join("\t"));
  for (const expected of routes) {
    console.info(
      [expected, ...routes.map((p) => String(confusion[expected][p]))].join(
        "\t",
      ),
    );
  }

  const baseRate =
    allProfiles === 0
      ? 0
      : (visionPredicted + ambiguousPredicted) / allProfiles;

  console.info("\n[calibrate:complete]", {
    labeledDocs: labeledDocs.length,
    pagesCompared: compared,
    falseNegativesVisionAsText: falseNegatives,
    profiledPages: allProfiles,
    predictedVisionOrAmbiguousRate: Number(baseRate.toFixed(4)),
  });

  if (falseNegatives > 0) {
    console.error(
      `\n${falseNegatives} vision→text false negatives — tighten PAGE_ROUTE_THRESHOLDS (prefer over-escalation).`,
    );
    process.exit(3);
  }
}

main().catch((error) => {
  console.error("[calibrate:fatal]", error);
  process.exit(1);
});
