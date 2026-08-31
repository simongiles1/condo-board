/**
 * East/west mechanical sheet overlap and merge.
 * Run: npx tsx --test scripts/test-floor-plan-split.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { degrees, PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  familiesOfDrawingSet,
  parseFloorPlanDrawingSet,
  parseFloorPlanFileKind,
  planNeedsMerge,
  plansOfDrawingSet,
} from "@/lib/building/floor-plan-shared";
import {
  floorPlanStatus,
  visualCropToMedia,
  visualPageSize,
} from "@/lib/building/floor-plan-align";
import {
  clippedEastOffset,
  defaultEastOffset,
  defaultSheetCrop,
  nudgeEastOffset,
  nudgeWestOffset,
  parsePdfRect,
  resolvedEastOffset,
  resolvedSheetCrop,
  splitCanvasLayout,
  splitSheetSizes,
} from "@/lib/building/floor-plan-split";
import { mergeSplitFloorPlanPdfs } from "@/lib/building/floor-plan-split-pdf";
import { readPdfPageSize } from "@/lib/building/floor-plan-crop-pdf";

type PdfDocumentInit = Parameters<typeof getDocument>[0];

async function pdfTextItems(bytes: Uint8Array) {
  const task = getDocument({
    data: bytes,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  } as PdfDocumentInit);
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .filter((it): it is { str: string; transform: number[] } => "str" in it)
      .filter((it) => it.str.trim().length > 0)
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
      }));
    return {
      width: viewport.width,
      height: viewport.height,
      rotation: page.rotate ?? 0,
      items,
    };
  } finally {
    await doc.destroy?.();
  }
}

async function labeledRotatedSheet(rotationDeg: 90 | 270) {
  const src = await PDFDocument.create();
  const page = src.addPage([100, 200]);
  page.setRotation(degrees(rotationDeg));
  const font = await src.embedFont(StandardFonts.Helvetica);
  const media = { width: 100, height: 200 };
  const vis = visualPageSize(media, rotationDeg);
  const marks = [
    { label: "KEEP", vis: { x: 20, y: 20 } },
    { label: "TITLE", vis: { x: vis.width - 40, y: vis.height / 2 } },
  ] as const;
  for (const mark of marks) {
    const box = visualCropToMedia(
      { x: mark.vis.x, y: mark.vis.y, width: 1, height: 1 },
      media,
      rotationDeg,
    );
    page.drawText(mark.label, { x: box.x, y: box.y, size: 10, font });
  }
  return { bytes: await src.save(), vis };
}

describe("defaultEastOffset", () => {
  it("overlaps the east sheet onto the west sheet's right edge", () => {
    const offset = defaultEastOffset(
      { width: 1000, height: 400 },
      { width: 800, height: 400 },
    );
    assert.equal(offset.x, 1000 - 800 * 0.35);
    assert.equal(offset.y, 0);
  });

  it("centers a shorter east sheet vertically", () => {
    const offset = defaultEastOffset(
      { width: 200, height: 100 },
      { width: 200, height: 60 },
    );
    assert.equal(offset.y, 20);
  });
});

describe("splitCanvasLayout", () => {
  it("keeps west at the origin when east is to the right", () => {
    const layout = splitCanvasLayout(
      { width: 100, height: 50 },
      { width: 80, height: 50 },
      { x: 60, y: 0 },
    );
    assert.equal(layout.width, 140);
    assert.equal(layout.height, 50);
    assert.deepEqual(layout.west, { x: 0, y: 0 });
    assert.deepEqual(layout.east, { x: 60, y: 0 });
  });

  it("shifts west when the east offset is negative", () => {
    const layout = splitCanvasLayout(
      { width: 100, height: 50 },
      { width: 80, height: 40 },
      { x: -20, y: -10 },
    );
    assert.equal(layout.width, 120);
    assert.equal(layout.height, 60);
    assert.deepEqual(layout.west, { x: 20, y: 10 });
    assert.deepEqual(layout.east, { x: 0, y: 0 });
  });
});

describe("nudgeEastOffset", () => {
  it("adds PDF-space deltas", () => {
    assert.deepEqual(nudgeEastOffset({ x: 10, y: 20 }, -3, 4), { x: 7, y: 24 });
  });
});

describe("nudgeWestOffset", () => {
  it("subtracts PDF-space deltas from the east offset", () => {
    assert.deepEqual(nudgeWestOffset({ x: 10, y: 20 }, -3, 4), { x: 13, y: 16 });
  });
});

describe("resolvedEastOffset", () => {
  it("uses the saved offset when both axes are present", () => {
    assert.deepEqual(
      resolvedEastOffset(
        { width: 100, height: 50 },
        { width: 80, height: 50 },
        { x: 12, y: -4 },
      ),
      { x: 12, y: -4 },
    );
  });

  it("falls back to the default overlap when unsaved", () => {
    assert.deepEqual(
      resolvedEastOffset(
        { width: 100, height: 50 },
        { width: 80, height: 50 },
        { x: null, y: null },
      ),
      defaultEastOffset({ width: 100, height: 50 }, { width: 80, height: 50 }),
    );
  });
});

describe("splitSheetSizes", () => {
  it("returns null until both sheets have positive sizes", () => {
    assert.equal(
      splitSheetSizes({
        westPageWidthPt: 100,
        westPageHeightPt: 50,
        eastPageWidthPt: null,
        eastPageHeightPt: 50,
      }),
      null,
    );
  });
});

describe("drawing set helpers", () => {
  it("parses mechanical and defaults the rest to architectural", () => {
    assert.equal(parseFloorPlanDrawingSet("mechanical"), "mechanical");
    assert.equal(parseFloorPlanDrawingSet("architectural"), "architectural");
    assert.equal(parseFloorPlanDrawingSet("other"), "architectural");
  });

  it("parses west/east file kinds", () => {
    assert.equal(parseFloorPlanFileKind("west"), "west");
    assert.equal(parseFloorPlanFileKind("east"), "east");
    assert.equal(parseFloorPlanFileKind("cropped"), "cropped");
    assert.equal(parseFloorPlanFileKind("original"), "original");
    assert.equal(parseFloorPlanFileKind(null), "original");
  });

  it("filters families and plans by drawing set", () => {
    const families = [
      { id: "a", kind: "architectural" as const },
      { id: "m", kind: "mechanical" as const },
    ];
    const plans = [
      { id: "1", familyId: "a" },
      { id: "2", familyId: "m" },
    ];
    assert.deepEqual(
      familiesOfDrawingSet(families, "mechanical").map((family) => family.id),
      ["m"],
    );
    assert.deepEqual(
      plansOfDrawingSet(plans, families, "mechanical").map((plan) => plan.id),
      ["2"],
    );
  });

  it("treats an unmerged pair as needing merge", () => {
    assert.equal(
      planNeedsMerge({ hasWest: true, hasEast: true, hasOriginal: false }),
      true,
    );
    assert.equal(
      planNeedsMerge({ hasWest: true, hasEast: true, hasOriginal: true }),
      false,
    );
    assert.equal(
      planNeedsMerge({ hasWest: false, hasEast: false, hasOriginal: true }),
      false,
    );
  });
});

describe("floorPlanStatus", () => {
  it("marks unmerged pairs before uploaded/pinned/cropped", () => {
    assert.equal(
      floorPlanStatus({ cropped: true, pinned: true, needsMerge: true }),
      "unmerged",
    );
    assert.equal(
      floorPlanStatus({ cropped: false, pinned: false, needsMerge: false }),
      "uploaded",
    );
  });
});

describe("defaultSheetCrop", () => {
  it("insets from every edge", () => {
    const crop = defaultSheetCrop({ width: 100, height: 50 });
    assert.equal(crop.x, 4);
    assert.equal(crop.y, 4);
    assert.equal(crop.width, 92);
    assert.equal(crop.height, 42);
  });
});

describe("resolvedSheetCrop", () => {
  it("uses a saved rectangle when it fits the page", () => {
    assert.deepEqual(
      resolvedSheetCrop(
        { width: 200, height: 100 },
        { x: 10, y: 20, width: 80, height: 40 },
      ),
      { x: 10, y: 20, width: 80, height: 40 },
    );
  });

  it("falls back to the default inset when unsaved", () => {
    assert.deepEqual(
      resolvedSheetCrop(
        { width: 100, height: 50 },
        { x: null, y: null, width: null, height: null },
      ),
      defaultSheetCrop({ width: 100, height: 50 }),
    );
  });
});

describe("clippedEastOffset", () => {
  it("shifts the saved offset by the crop origins so content stays aligned", () => {
    assert.deepEqual(
      clippedEastOffset(
        { x: 140, y: 0 },
        { x: 10, y: 10, width: 120, height: 80 },
        { x: 20, y: 5, width: 100, height: 80 },
      ),
      { x: 150, y: -5 },
    );
  });
});

describe("parsePdfRect", () => {
  it("reads x, y, width, and height", () => {
    assert.deepEqual(parsePdfRect({ x: 1, y: 2, width: 3, height: 4 }, "West"), {
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  });

  it("rejects a missing crop", () => {
    assert.throws(() => parsePdfRect(null, "West"), /West crop is required/);
  });
});

describe("mergeSplitFloorPlanPdfs", () => {
  it("stamps both sheets onto a canvas that includes the overlap", async () => {
    const westDoc = await PDFDocument.create();
    const westPage = westDoc.addPage([200, 100]);
    westPage.drawRectangle({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      color: rgb(0.9, 0.9, 0.9),
    });
    const eastDoc = await PDFDocument.create();
    const eastPage = eastDoc.addPage([180, 100]);
    eastPage.drawRectangle({
      x: 0,
      y: 0,
      width: 180,
      height: 100,
      color: rgb(0.7, 0.7, 0.7),
    });
    const westBytes = await westDoc.save();
    const eastBytes = await eastDoc.save();
    const offset = { x: 140, y: 0 };
    const merged = await mergeSplitFloorPlanPdfs(
      westBytes,
      eastBytes,
      offset,
      { x: 0, y: 0, width: 200, height: 100 },
      { x: 0, y: 0, width: 180, height: 100 },
    );
    assert.equal(merged.size.width, 320);
    assert.equal(merged.size.height, 100);
    const visual = await readPdfPageSize(merged.bytes);
    assert.equal(visual.width, 320);
    assert.equal(visual.height, 100);
    assert.equal(visual.pageCount, 1);
  });

  it("clips each sheet before stamping so the canvas is the cropped overlap", async () => {
    const westDoc = await PDFDocument.create();
    const westPage = westDoc.addPage([200, 100]);
    westPage.drawRectangle({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      color: rgb(0.9, 0.9, 0.9),
    });
    const eastDoc = await PDFDocument.create();
    const eastPage = eastDoc.addPage([180, 100]);
    eastPage.drawRectangle({
      x: 0,
      y: 0,
      width: 180,
      height: 100,
      color: rgb(0.7, 0.7, 0.7),
    });
    const westCrop = { x: 10, y: 10, width: 120, height: 80 };
    const eastCrop = { x: 20, y: 5, width: 100, height: 80 };
    const offset = { x: 140, y: 0 };
    const clipped = clippedEastOffset(offset, westCrop, eastCrop);
    const layout = splitCanvasLayout(
      { width: westCrop.width, height: westCrop.height },
      { width: eastCrop.width, height: eastCrop.height },
      clipped,
    );
    const merged = await mergeSplitFloorPlanPdfs(
      await westDoc.save(),
      await eastDoc.save(),
      offset,
      westCrop,
      eastCrop,
    );
    assert.equal(merged.size.width, layout.width);
    assert.equal(merged.size.height, layout.height);
    assert.equal(merged.size.width, 250);
    assert.equal(merged.size.height, 85);
    const visual = await readPdfPageSize(merged.bytes);
    assert.equal(visual.width, 250);
    assert.equal(visual.height, 85);
  });

  for (const rotationDeg of [90, 270] as const) {
    it(`flattens a ${rotationDeg}° sheet so the visual crop stays upright and excludes the title block`, async () => {
      const sheet = await labeledRotatedSheet(rotationDeg);
      const crop = { x: 10, y: 10, width: 120, height: 60 };
      const merged = await mergeSplitFloorPlanPdfs(
        sheet.bytes,
        sheet.bytes,
        { x: 0, y: 0 },
        crop,
        crop,
      );
      assert.equal(merged.size.width, crop.width);
      assert.equal(merged.size.height, crop.height);
      const visual = await readPdfPageSize(merged.bytes);
      assert.equal(visual.width, crop.width);
      assert.equal(visual.height, crop.height);
      assert.equal(visual.rotationDeg, 0);
      const text = await pdfTextItems(merged.bytes);
      assert.equal(text.rotation, 0);
      assert.equal(text.width, crop.width);
      assert.equal(text.height, crop.height);
      const labels = text.items.map((item) => item.str);
      const keep = text.items.find((item) => item.str.startsWith("KE"));
      assert.ok(keep, `KEEP missing: ${labels.join(",")}`);
      assert.ok(
        !labels.some((label) => label.includes("TI")),
        `TITLE leaked into crop: ${labels.join(",")}`,
      );
      assert.ok(
        Math.abs(keep.x - 10) < 4 && Math.abs(keep.y - 10) < 4,
        `KEEP at (${keep.x}, ${keep.y}), expected ~(10, 10)`,
      );
    });
  }

  it("pads the merged page so a larger family plate still fits", async () => {
    const westDoc = await PDFDocument.create();
    const westPage = westDoc.addPage([200, 100]);
    westPage.drawRectangle({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      color: rgb(0.9, 0.9, 0.9),
    });
    const eastDoc = await PDFDocument.create();
    const eastPage = eastDoc.addPage([180, 100]);
    eastPage.drawRectangle({
      x: 0,
      y: 0,
      width: 180,
      height: 100,
      color: rgb(0.7, 0.7, 0.7),
    });
    const merged = await mergeSplitFloorPlanPdfs(
      await westDoc.save(),
      await eastDoc.save(),
      { x: 140, y: 0 },
      { x: 0, y: 0, width: 200, height: 100 },
      { x: 0, y: 0, width: 180, height: 100 },
      { width: 400, height: 150 },
    );
    assert.equal(merged.size.width, 400);
    assert.equal(merged.size.height, 150);
    const visual = await readPdfPageSize(merged.bytes);
    assert.equal(visual.width, 400);
    assert.equal(visual.height, 150);
  });
});
