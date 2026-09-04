/**
 * Floor-plan crop / pin / neighbor alignment.
 * Run: npx tsx --test scripts/test-floor-plan-align.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFDocument, degrees, rgb } from "pdf-lib";

import {
  floorPlanLabel,
  lineOverlayCandidates,
  parseFloorNumber,
  parseFloorPlanName,
  type FloorPlanDto,
} from "@/lib/building/floor-plan-shared";

import {
  applyFamilyCropSize,
  canvasPointToPdf,
  canvasRectToPdf,
  clampCropOrigin,
  clampCropToPage,
  clampPin,
  CLIP_RASTER_OVERSCAN_PX,
  familyCropFitsPage,
  familyCropSizeLocked,
  croppedSizeMatchesFamily,
  cropOverlayCandidates,
  defaultCropOverlayId,
  editOverlayCandidates,
  editOverlayBlockedReason,
  editOverlayPlateLayout,
  resolveOverlayAnchorPin,
  familyCroppedNeighbors,
  familyCroppedPlans,
  familyNeighbors,
  buildingCompareNeighbors,
  buildingComparePlans,
  buildingPlanNeighbors,
  buildingPlanOrder,
  globalPlanOrder,
  compareSheetCanvasOffset,
  cropDraftIsDirty,
  pinDraftIsDirty,
  compareStackLayout,
  compareSheetRenderSize,
  effectiveFamilyScale,
  familyDisplayScaleMultiplier,
  floorPlanStatus,
  mediaCropToVisual,
  nudgePin,
  pdfPointToCanvas,
  pdfRectToCanvas,
  pinOverlayCanvasOffset,
  resolveCompareAnchor,
  panZoomFollowTransform,
  panZoomScreenPoint,
  panZoomScreenRect,
  panZoomViewportToPage,
  pinRelativeViewFromTransform,
  centerViewOnPagePoint,
  transformFromPinRelativeView,
  viewportResizePanAction,
  clampPdfVisibleRender,
  clipRasterKey,
  clipRasterKeyEquals,
  pdfClipFromElementRects,
  overlayPanZoom,
  pdfOverlayRenderParams,
  pdfVisibleRenderParams,
  pinOverlayOffset,
  buildingPinOnOriginalPage,
  pinFromReferenceAnchor,
  pinOffsetFromReferenceAnchor,
  pinOnCroppedPlate,
  planHasPin,
  planPinOnCropped,
  familyPlatePin,
  cropAlignedToPin,
  cropWaitsForPin,
  resizeCanvasRectFromHandle,
  visualCropToMedia,
  visualPageSize,
} from "../lib/building/floor-plan-align";
import { cropFloorPlanPdf, readPdfPageSize } from "../lib/building/floor-plan-crop-pdf";
import {
  clearFloorPlanAnnotationDraft,
  resolveFloorPlanAnnotationMarkup,
  writeFloorPlanAnnotationDraft,
} from "../lib/building/floor-plan-annotation-draft";
import {
  annotationsForCompareSheet,
  familyAnnotationSourcePlan,
  overlayAnnotationsForEditSheet,
  visibleAnnotationsForCompareSheet,
} from "../lib/building/floor-plan-compare-annotations";
import {
  filterAnnotationsByStrokeColors,
  lineOverlayFilterForFamily,
  mapAnnotationsAcrossPlans,
  mapAnnotationsToCroppedPlate,
  mapPdfPointAcrossPlans,
  parseDrawColorPresets,
} from "../lib/building/floor-plan-annotations";

describe("clampCropOrigin", () => {
  it("keeps the family rect fully on the page", () => {
    assert.deepEqual(
      clampCropOrigin(50, 60, 200, 100, 400, 300),
      { x: 50, y: 60 },
    );
    assert.deepEqual(
      clampCropOrigin(-20, -10, 200, 100, 400, 300),
      { x: 0, y: 0 },
    );
    assert.deepEqual(
      clampCropOrigin(300, 250, 200, 100, 400, 300),
      { x: 200, y: 200 },
    );
  });
});

describe("resizeCanvasRectFromHandle", () => {
  const start = { x: 100, y: 50, width: 400, height: 200 };
  const page = { width: 800, height: 600 };

  it("east handle changes only width, even if the pointer drifts vertically", () => {
    assert.deepEqual(
      resizeCanvasRectFromHandle("e", start, { x: 450, y: 180 }, page),
      { x: 100, y: 50, width: 350, height: 200 },
    );
  });

  it("west handle changes only width and keeps the right edge", () => {
    assert.deepEqual(
      resizeCanvasRectFromHandle("w", start, { x: 140, y: 10 }, page),
      { x: 140, y: 50, width: 360, height: 200 },
    );
  });

  it("north handle changes only height, even if the pointer drifts horizontally", () => {
    assert.deepEqual(
      resizeCanvasRectFromHandle("n", start, { x: 300, y: 80 }, page),
      { x: 100, y: 80, width: 400, height: 170 },
    );
  });

  it("south handle changes only height and keeps the top edge", () => {
    assert.deepEqual(
      resizeCanvasRectFromHandle("s", start, { x: 0, y: 300 }, page),
      { x: 100, y: 50, width: 400, height: 250 },
    );
  });
});

describe("clampCropToPage", () => {
  it("keeps the opposite edge when a side spills off the page", () => {
    assert.deepEqual(
      clampCropToPage(
        { x: 50, y: 40, width: 900, height: 800 },
        { width: 400, height: 300 },
      ),
      { x: 50, y: 40, width: 350, height: 260 },
    );
  });
});

describe("applyFamilyCropSize", () => {
  it("locks W×H from the first crop", () => {
    const first = applyFamilyCropSize(null, {
      x: 10,
      y: 20,
      width: 200,
      height: 80,
    }, { width: 500, height: 400 });
    assert.equal(first.width, 200);
    assert.equal(first.height, 80);
    assert.equal(familyCropSizeLocked({ width: first.width, height: first.height }), true);
  });

  it("second crop cannot change W×H", () => {
    const locked = applyFamilyCropSize(
      { width: 200, height: 100 },
      { x: 10, y: 10, width: 50, height: 50 },
      { width: 400, height: 400 },
    );
    assert.equal(locked.width, 200);
    assert.equal(locked.height, 100);
    assert.equal(locked.x, 10);
    assert.equal(locked.y, 10);
  });

  it("clamps a locked crop that would leave the page", () => {
    const locked = applyFamilyCropSize(
      { width: 200, height: 100 },
      { x: 900, y: 900, width: 50, height: 50 },
      { width: 400, height: 300 },
    );
    assert.deepEqual(locked, { x: 200, y: 200, width: 200, height: 100 });
  });

  it("clamps an unlocked resize that spills off the page", () => {
    const page = { width: 400, height: 300 };
    assert.deepEqual(
      applyFamilyCropSize(
        null,
        { x: 50, y: 40, width: 900, height: 800 },
        page,
      ),
      { x: 50, y: 40, width: 350, height: 260 },
    );
    assert.deepEqual(
      applyFamilyCropSize(
        null,
        { x: -20, y: -10, width: 120, height: 80 },
        page,
      ),
      { x: 0, y: 0, width: 100, height: 70 },
    );
  });

  it("keeps a minimum size instead of throwing on a collapsed drag", () => {
    const crop = applyFamilyCropSize(
      null,
      { x: 400, y: 150, width: 0, height: 0 },
      { width: 400, height: 300 },
    );
    assert.equal(crop.width, 1);
    assert.equal(crop.height, 1);
    assert.equal(crop.x, 399);
    assert.equal(crop.y, 150);
  });

  it("clamps a locked crop that is larger than the page so the editor can mount", () => {
    assert.deepEqual(
      applyFamilyCropSize(
        { width: 500, height: 100 },
        { x: 0, y: 0, width: 50, height: 50 },
        { width: 400, height: 300 },
      ),
      { x: 0, y: 0, width: 400, height: 100 },
    );
  });
});

describe("familyCropFitsPage", () => {
  it("is true when the plate is smaller than the page", () => {
    assert.equal(
      familyCropFitsPage({ width: 200, height: 100 }, { width: 400, height: 300 }),
      true,
    );
  });

  it("is false when either edge exceeds the page", () => {
    assert.equal(
      familyCropFitsPage({ width: 500, height: 100 }, { width: 400, height: 300 }),
      false,
    );
    assert.equal(
      familyCropFitsPage({ width: 200, height: 400 }, { width: 400, height: 300 }),
      false,
    );
  });
});

describe("croppedSizeMatchesFamily", () => {
  const family = { width: 1456.47, height: 378.216 };

  it("treats float noise from a 270° box swap as a match", () => {
    assert.equal(
      croppedSizeMatchesFamily(
        { width: 1456.4735642989638, height: 378.2159999999999 },
        family,
      ),
      true,
    );
  });

  it("detects a sibling still on an older, narrower crop", () => {
    assert.equal(
      croppedSizeMatchesFamily(
        { width: 1415.68, height: 378.216 },
        family,
      ),
      false,
    );
  });
});

describe("visual page rotation", () => {
  const media = { width: 2448, height: 3168 };

  it("swaps MediaBox size for 90° and 270° sheets", () => {
    assert.deepEqual(visualPageSize(media, 0), media);
    assert.deepEqual(visualPageSize(media, 270), {
      width: 3168,
      height: 2448,
    });
  });

  it("round-trips a visual crop through 270° user space", () => {
    const vis = { x: 40, y: 80, width: 200, height: 100 };
    const mediaCrop = visualCropToMedia(vis, media, 270);
    assert.deepEqual(mediaCropToVisual(mediaCrop, media, 270), vis);
  });

  it("maps a full visual 270° page back to the MediaBox", () => {
    assert.deepEqual(
      visualCropToMedia(
        { x: 0, y: 0, width: 3168, height: 2448 },
        media,
        270,
      ),
      { x: 0, y: 0, width: 2448, height: 3168 },
    );
  });
});

describe("pin overlay offset", () => {
  it("translates a smaller plate onto a larger one by pin delta", () => {
    const parkingPin = { x: 120, y: 40 };
    const towerPin = { x: 30, y: 40 };
    assert.deepEqual(pinOverlayOffset(parkingPin, towerPin), { x: 90, y: 0 });
  });

  it("places overlay B so pins coincide on a Y-down canvas", () => {
    const offset = pinOverlayCanvasOffset(
      { x: 120, y: 40 },
      200,
      { x: 30, y: 40 },
      100,
      2,
    );
    // Parking pin canvas: (240, (200-40)*2) = (240, 320)
    // Tower pin canvas: (60, (100-40)*2) = (60, 120)
    assert.deepEqual(offset, { x: 180, y: 200 });
  });
});

describe("compare stack layout", () => {
  const parkingFamily = {
    cropWidthPt: 300,
    cropHeightPt: 200,
  };
  const towerFamily = {
    cropWidthPt: 200,
    cropHeightPt: 100,
  };

  const parkingPlan = {
    id: "p1",
    familyId: "parking",
    sortOrder: 0,
    hasCropped: true,
    pinXPt: 120,
    pinYPt: 40,
    cropXPt: 0,
    cropYPt: 0,
  };
  const towerPlan = {
    id: "t1",
    familyId: "tower",
    sortOrder: 0,
    hasCropped: true,
    pinXPt: 30,
    pinYPt: 40,
    cropXPt: 0,
    cropYPt: 0,
  };

  it("keeps the registration pin at a fixed position when switching sheets", () => {
    const sheets = [
      { plan: parkingPlan, family: parkingFamily },
      { plan: towerPlan, family: towerFamily },
    ];
    const layout = compareStackLayout(parkingPlan, parkingFamily, sheets, 2);
    assert.ok(layout);
    const towerOffset = compareSheetCanvasOffset(
      parkingPlan,
      parkingFamily,
      towerPlan,
      towerFamily,
      2,
    );
    assert.deepEqual(towerOffset, { x: 180, y: 200 });

    const parkingAsActive = layout.offsets.p1;
    const towerAsActive = layout.offsets.t1;
    assert.deepEqual(parkingAsActive, { x: 0, y: 0 });
    assert.deepEqual(towerAsActive, { x: 180, y: 200 });

    const parkingPinCanvas = pdfPointToCanvas({ x: 120, y: 40 }, 200, 2);
    assert.equal(
      parkingAsActive.x + parkingPinCanvas.x,
      layout.pinX,
    );
    assert.equal(
      parkingAsActive.y + parkingPinCanvas.y,
      layout.pinY,
    );
    const towerPinCanvas = pdfPointToCanvas({ x: 30, y: 40 }, 100, 2);
    assert.equal(
      towerAsActive.x + towerPinCanvas.x,
      layout.pinX,
    );
    assert.equal(
      towerAsActive.y + towerPinCanvas.y,
      layout.pinY,
    );
  });

  it("prefers the registration plan as anchor", () => {
    const sheets = [parkingPlan, towerPlan];
    assert.equal(
      resolveCompareAnchor(sheets, towerPlan.id)?.id,
      towerPlan.id,
    );
    assert.equal(
      resolveCompareAnchor(sheets, null)?.id,
      parkingPlan.id,
    );
  });

  it("scales sheets by architectural family scale when denominators differ", () => {
    const podiumFamily = {
      cropWidthPt: 300,
      cropHeightPt: 200,
      scaleDenominator: 150,
    };
    const towerFamily = {
      cropWidthPt: 200,
      cropHeightPt: 100,
      scaleDenominator: 50,
    };
    const sheets = [
      { plan: parkingPlan, family: podiumFamily },
      { plan: towerPlan, family: towerFamily },
    ];
    const referenceDenom = 50;
    const podiumScale = effectiveFamilyScale(2, podiumFamily, referenceDenom);
    const towerScale = effectiveFamilyScale(2, towerFamily, referenceDenom);
    assert.equal(familyDisplayScaleMultiplier(150, 50), 150 / 50);
    assert.equal(podiumScale, 2 * (150 / 50));
    assert.equal(towerScale, 2);

    const layout = compareStackLayout(
      parkingPlan,
      podiumFamily,
      sheets,
      2,
      referenceDenom,
    );
    assert.ok(layout);

    const parkingPinCanvas = pdfPointToCanvas({ x: 120, y: 40 }, 200, podiumScale);
    const towerPinCanvas = pdfPointToCanvas({ x: 30, y: 40 }, 100, towerScale);
    assert.equal(layout.offsets.p1.x + parkingPinCanvas.x, layout.pinX);
    assert.equal(layout.offsets.p1.y + parkingPinCanvas.y, layout.pinY);
    assert.equal(layout.offsets.t1.x + towerPinCanvas.x, layout.pinX);
    assert.equal(layout.offsets.t1.y + towerPinCanvas.y, layout.pinY);
  });

  it("renders one sheet size with architectural scale at unit base scale", () => {
    const podiumFamily = {
      cropWidthPt: 300,
      cropHeightPt: 200,
      scaleDenominator: 150,
    };
    const towerFamily = {
      cropWidthPt: 200,
      cropHeightPt: 100,
      scaleDenominator: 50,
    };
    const referenceDenom = 50;
    assert.deepEqual(
      compareSheetRenderSize(1, podiumFamily, referenceDenom),
      { width: 300 * (150 / 50), height: 200 * (150 / 50) },
    );
    assert.deepEqual(compareSheetRenderSize(1, towerFamily, referenceDenom), {
      width: 200,
      height: 100,
    });
  });
});

describe("canvas / PDF conversion", () => {
  it("round-trips a crop rect through canvas space", () => {
    const crop = { x: 40, y: 60, width: 200, height: 80 };
    const canvas = pdfRectToCanvas(crop, 400, 2);
    assert.deepEqual(canvas, { x: 80, y: 520, width: 400, height: 160 });
    const back = canvasRectToPdf(canvas, 400, 2);
    assert.deepEqual(back, crop);
  });

  it("round-trips a pin through canvas space", () => {
    const pin = { x: 25, y: 75 };
    const canvas = pdfPointToCanvas(pin, 200, 4);
    const back = canvasPointToPdf(canvas, 200, 4);
    assert.deepEqual(back, pin);
  });
});

describe("clampPin / nudgePin", () => {
  it("keeps the pin on the page", () => {
    assert.deepEqual(clampPin({ x: -1, y: 50 }, { width: 100, height: 80 }), {
      x: 0,
      y: 50,
    });
    assert.deepEqual(
      nudgePin({ x: 99, y: 1 }, 5, -4, { width: 100, height: 80 }),
      { x: 100, y: 0 },
    );
  });
});

describe("familyNeighbors", () => {
  const plans = [
    { id: "p1", familyId: "parking", floorNumber: 0 },
    { id: "p2", familyId: "parking", floorNumber: 1 },
    { id: "l1", familyId: "tower", floorNumber: 0 },
    { id: "l2", familyId: "tower", floorNumber: 1 },
    { id: "l3", familyId: "tower", floorNumber: 2 },
  ];

  it("prev/next stay inside one family", () => {
    assert.deepEqual(familyNeighbors(plans, "p1"), {
      prevId: null,
      nextId: "p2",
    });
    assert.deepEqual(familyNeighbors(plans, "p2"), {
      prevId: "p1",
      nextId: null,
    });
    assert.deepEqual(familyNeighbors(plans, "l2"), {
      prevId: "l1",
      nextId: "l3",
    });
  });
});

describe("familyCroppedNeighbors", () => {
  const plans = [
    { id: "p1", familyId: "parking", floorNumber: 0, hasCropped: true },
    { id: "p2", familyId: "parking", floorNumber: 1, hasCropped: false },
    { id: "p3", familyId: "parking", floorNumber: 2, hasCropped: true },
    { id: "l1", familyId: "tower", floorNumber: 0, hasCropped: true },
  ];

  it("skips uncropped siblings", () => {
    assert.deepEqual(familyCroppedNeighbors(plans, "p1"), {
      prevId: null,
      nextId: "p3",
    });
    assert.deepEqual(familyCroppedNeighbors(plans, "p3"), {
      prevId: "p1",
      nextId: null,
    });
  });

  it("lists cropped sheets in family order", () => {
    assert.deepEqual(
      familyCroppedPlans(plans, "parking").map((plan) => plan.id),
      ["p1", "p3"],
    );
  });
});

describe("buildingComparePlans", () => {
  const families = [
    { id: "parking", name: "Parking", sortOrder: 0 },
    { id: "tower", name: "Tower", sortOrder: 1 },
  ];
  const plans = [
    {
      id: "p1",
      familyId: "parking",
      floorNumber: 0,
      hasCropped: true,
      pinXPt: 10,
      pinYPt: 20,
    },
    {
      id: "p2",
      familyId: "parking",
      floorNumber: 1,
      hasCropped: true,
      pinXPt: null,
      pinYPt: null,
    },
    {
      id: "l1",
      familyId: "tower",
      floorNumber: 0,
      hasCropped: true,
      pinXPt: 5,
      pinYPt: 8,
    },
    {
      id: "l2",
      familyId: "tower",
      floorNumber: 1,
      hasCropped: false,
      pinXPt: 1,
      pinYPt: 2,
    },
  ];

  it("lists cropped pinned sheets across families in building order", () => {
    assert.deepEqual(
      buildingComparePlans(plans, families).map((plan) => plan.id),
      ["p1", "l1"],
    );
  });

  it("prev/next walk the whole building, not one family", () => {
    assert.deepEqual(buildingCompareNeighbors(plans, families, "p1"), {
      prevId: null,
      nextId: "l1",
    });
    assert.deepEqual(buildingCompareNeighbors(plans, families, "l1"), {
      prevId: "p1",
      nextId: null,
    });
  });

  it("orders by floor number when layout families interleave", () => {
    const layoutFamilies = [
      { id: "layout-l", name: "Floors 10-30L", sortOrder: 0 },
      { id: "layout-s", name: "Floors 10-30S", sortOrder: 1 },
    ];
    const layoutPlans = [
      {
        id: "f23l",
        familyId: "layout-l",
        floorNumber: 23,
        hasCropped: true,
        pinXPt: 1,
        pinYPt: 2,
      },
      {
        id: "f24s",
        familyId: "layout-s",
        floorNumber: 24,
        hasCropped: true,
        pinXPt: 1,
        pinYPt: 2,
      },
      {
        id: "f25s",
        familyId: "layout-s",
        floorNumber: 25,
        hasCropped: true,
        pinXPt: 1,
        pinYPt: 2,
      },
      {
        id: "f26l",
        familyId: "layout-l",
        floorNumber: 26,
        hasCropped: true,
        pinXPt: 1,
        pinYPt: 2,
      },
    ];

    assert.deepEqual(
      buildingComparePlans(layoutPlans, layoutFamilies).map((plan) => plan.id),
      ["f23l", "f24s", "f25s", "f26l"],
    );
    assert.deepEqual(buildingCompareNeighbors(layoutPlans, layoutFamilies, "f25s"), {
      prevId: "f24s",
      nextId: "f26l",
    });
  });
});

describe("buildingPlanNeighbors", () => {
  const families = [
    { id: "parking", name: "Parking", sortOrder: 0 },
    { id: "tower", name: "Tower", sortOrder: 1 },
  ];
  const plans = [
    { id: "p1", familyId: "parking", floorNumber: 0 },
    { id: "p2", familyId: "parking", floorNumber: 1 },
    { id: "l1", familyId: "tower", floorNumber: 0 },
    { id: "l2", familyId: "tower", floorNumber: 1 },
  ];

  it("orders every sheet in building order", () => {
    assert.deepEqual(
      buildingPlanOrder(plans, families).map((plan) => plan.id),
      ["p1", "p2", "l1", "l2"],
    );
  });

  it("prev/next includes uncropped and unpinned sheets", () => {
    assert.deepEqual(buildingPlanNeighbors(plans, families, "p2"), {
      prevId: "p1",
      nextId: "l1",
    });
    assert.deepEqual(buildingPlanNeighbors(plans, families, "l2"), {
      prevId: "l1",
      nextId: null,
    });
  });
});

describe("floor number sort", () => {
  const families = [
    { id: "parking", name: "Parking", sortOrder: 0 },
    { id: "tower", name: "Tower", sortOrder: 1 },
  ];
  const plans = [
    { id: "p2", familyId: "parking", name: "P2", floorNumber: 2 },
    { id: "l12", familyId: "tower", name: "An212", floorNumber: 12 },
    { id: "l1", familyId: "tower", name: "An201", floorNumber: 1 },
    { id: "p1", familyId: "parking", name: "P1", floorNumber: -1 },
  ];

  it("folder order is family drag order, then floor number lowest to highest", () => {
    assert.deepEqual(
      buildingPlanOrder(plans, families).map((plan) => plan.id),
      ["p1", "p2", "l1", "l12"],
    );
  });

  it("flat order is floor number only", () => {
    assert.deepEqual(
      globalPlanOrder(plans).map((plan) => plan.id),
      ["p1", "l1", "p2", "l12"],
    );
  });
});

describe("parseFloorPlanName", () => {
  it("splits drawing name and floor from a hyphen label", () => {
    assert.deepEqual(parseFloorPlanName("An212 - Floor 12"), {
      name: "An212",
      floorNumber: 12,
    });
    assert.deepEqual(parseFloorPlanName("An212 – Floor -1"), {
      name: "An212",
      floorNumber: -1,
    });
    assert.deepEqual(parseFloorPlanName("P2 - 2"), {
      name: "P2",
      floorNumber: 2,
    });
  });

  it("leaves a drawing name without a floor as-is", () => {
    assert.deepEqual(parseFloorPlanName("An212"), {
      name: "An212",
      floorNumber: null,
    });
  });

  it("parses integers and rejects blanks", () => {
    assert.equal(parseFloorNumber(12), 12);
    assert.equal(parseFloorNumber(" -3 "), -3);
    assert.equal(parseFloorNumber("12.5"), null);
    assert.equal(parseFloorNumber(""), null);
    assert.equal(floorPlanLabel({ name: "An212", floorNumber: 12 }), "An212 · Floor 12");
  });
});

describe("draft dirty helpers", () => {
  const family = { cropWidthPt: 100, cropHeightPt: 80 };
  const savedPlan = {
    hasCropped: true,
    cropXPt: 10,
    cropYPt: 20,
    pinXPt: 5,
    pinYPt: 6,
  };

  it("pin is dirty when moved or newly placed", () => {
    assert.equal(pinDraftIsDirty(savedPlan, { x: 5, y: 6 }), false);
    assert.equal(pinDraftIsDirty(savedPlan, { x: 6, y: 6 }), true);
    assert.equal(
      pinDraftIsDirty({ pinXPt: null, pinYPt: null }, { x: 1, y: 2 }),
      true,
    );
    assert.equal(pinDraftIsDirty({ pinXPt: null, pinYPt: null }, null), false);
  });

  it("crop is dirty when unsaved or moved", () => {
    assert.equal(
      cropDraftIsDirty(savedPlan, family, {
        x: 10,
        y: 20,
        width: 100,
        height: 80,
      }),
      false,
    );
    assert.equal(
      cropDraftIsDirty(savedPlan, family, {
        x: 11,
        y: 20,
        width: 100,
        height: 80,
      }),
      true,
    );
    assert.equal(
      cropDraftIsDirty(
        { hasCropped: false, cropXPt: null, cropYPt: null },
        family,
        { x: 0, y: 0, width: 50, height: 50 },
      ),
      true,
    );
  });
});

describe("crop overlay candidates", () => {
  const plans = [
    {
      id: "l1",
      familyId: "tower",
      name: "L1",
      floorNumber: 0,
      hasCropped: true,
    },
    {
      id: "l2",
      familyId: "tower",
      name: "L2",
      floorNumber: 1,
      hasCropped: false,
    },
    {
      id: "l3",
      familyId: "tower",
      name: "L3",
      floorNumber: 2,
      hasCropped: true,
    },
    {
      id: "p1",
      familyId: "parking",
      name: "P1",
      floorNumber: 0,
      hasCropped: true,
    },
  ];

  it("lists cropped siblings in the same family, not this sheet", () => {
    const ids = cropOverlayCandidates(plans, {
      id: "l2",
      familyId: "tower",
    }).map((item) => item.id);
    assert.deepEqual(ids, ["l1", "l3"]);
  });

  it("defaults to the nearest cropped sheet at or below this floor", () => {
    const candidates = cropOverlayCandidates(plans, {
      id: "l2",
      familyId: "tower",
    });
    assert.equal(defaultCropOverlayId(candidates, 1), "l1");
  });

  it("falls back to the first sibling when recropping a lower floor", () => {
    const candidates = cropOverlayCandidates(plans, {
      id: "l1",
      familyId: "tower",
    });
    assert.equal(defaultCropOverlayId(candidates, 0), "l3");
  });

  it("returns null when nothing else is cropped", () => {
    assert.equal(defaultCropOverlayId([], 1), null);
  });
});

describe("edit overlay candidates", () => {
  const plans = [
    {
      id: "l1",
      familyId: "tower",
      name: "L1",
      floorNumber: 0,
      hasCropped: true,
      pinXPt: 10,
      pinYPt: 20,
    },
    {
      id: "l2",
      familyId: "tower",
      name: "L2",
      floorNumber: 1,
      hasCropped: true,
      pinXPt: 12,
      pinYPt: 22,
    },
    {
      id: "l3",
      familyId: "tower",
      name: "L3",
      floorNumber: 2,
      hasCropped: true,
      pinXPt: null,
      pinYPt: null,
    },
    {
      id: "p1",
      familyId: "parking",
      name: "P1",
      floorNumber: 0,
      hasCropped: true,
      pinXPt: 55,
      pinYPt: 80,
    },
    {
      id: "u1",
      familyId: "tower",
      name: "U1",
      floorNumber: 3,
      hasCropped: false,
      pinXPt: 1,
      pinYPt: 2,
    },
  ];

  it("lists cropped pinned sheets anywhere in the building, not this sheet", () => {
    const ids = editOverlayCandidates(plans, { id: "l2" }).map((item) => item.id);
    assert.deepEqual(ids, ["l1", "p1"]);
  });
});

describe("lineOverlayCandidates", () => {
  const line = (id: string): FloorPlanDto["annotations"] => [
    {
      type: "polyline",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      stroke: "#111111",
      strokeWidth: 2,
    },
  ];

  const mechanicalPlans: FloorPlanDto[] = [
    {
      id: "m1",
      familyId: "mech-a",
      name: "M-101",
      floorNumber: 1,
      hasCropped: true,
      pinXPt: 10,
      pinYPt: 20,
      annotations: line("m1"),
    } as FloorPlanDto,
    {
      id: "m2",
      familyId: "mech-b",
      name: "M-307n/308n",
      floorNumber: 2,
      hasCropped: true,
      pinXPt: 30,
      pinYPt: 40,
      annotations: [],
    } as FloorPlanDto,
    {
      id: "m3",
      familyId: "mech-c",
      name: "M-401",
      floorNumber: 3,
      hasCropped: true,
      pinXPt: null,
      pinYPt: null,
      annotations: line("m3"),
    } as FloorPlanDto,
  ];

  it("includes annotated pinned floors from other families in the drawing set", () => {
    const ids = lineOverlayCandidates(mechanicalPlans, { id: "m2" }).map(
      (item) => item.id,
    );
    assert.deepEqual(ids, ["m1"]);
  });
});

describe("edit overlay plate layout", () => {
  it("aligns overlay pins like compare mode from the draft crop origin", () => {
    const layout = editOverlayPlateLayout(
      { x: 55, y: 80 },
      { x: 40, y: 20 },
      100,
      { scaleDenominator: 100 },
      {
        pinXPt: 30,
        pinYPt: 40,
        cropXPt: 10,
        cropYPt: 5,
      },
      {
        cropWidthPt: 200,
        cropHeightPt: 100,
        scaleDenominator: 100,
      },
      2,
    );
    assert.ok(layout);
    const compareOffset = compareSheetCanvasOffset(
      {
        pinXPt: 55,
        pinYPt: 80,
        cropXPt: 40,
        cropYPt: 20,
      },
      { cropHeightPt: 100 },
      {
        pinXPt: 30,
        pinYPt: 40,
        cropXPt: 10,
        cropYPt: 5,
      },
      { cropHeightPt: 100 },
      2,
      2,
    );
    assert.deepEqual(layout!.offset, compareOffset);
    assert.equal(layout!.scale, 2);
    assert.equal(layout!.width, 400);
    assert.equal(layout!.height, 200);
  });
});

describe("resolveOverlayAnchorPin", () => {
  it("prefers draft pin, then saved, then suggested", () => {
    const draft = { x: 1, y: 2 };
    const saved = { x: 3, y: 4 };
    const suggested = { x: 5, y: 6 };
    assert.deepEqual(
      resolveOverlayAnchorPin(draft, { pinXPt: 3, pinYPt: 4 }, suggested),
      draft,
    );
    assert.deepEqual(
      resolveOverlayAnchorPin(null, { pinXPt: 3, pinYPt: 4 }, suggested),
      saved,
    );
    assert.deepEqual(
      resolveOverlayAnchorPin(null, { pinXPt: null, pinYPt: null }, suggested),
      suggested,
    );
  });
});

describe("editOverlayBlockedReason", () => {
  it("explains missing alignment pin", () => {
    assert.match(
      editOverlayBlockedReason({
        overlayActive: true,
        overlayPlan: {
          pinXPt: 1,
          pinYPt: 2,
          cropXPt: 3,
          cropYPt: 4,
        },
        overlayFamily: { cropWidthPt: 100, cropHeightPt: 80 },
        alignmentPin: null,
        cropAwaitingPin: false,
      }) ?? "",
      /building pin or reference anchor/i,
    );
  });

  it("returns null when the overlay can render", () => {
    assert.equal(
      editOverlayBlockedReason({
        overlayActive: true,
        overlayPlan: {
          pinXPt: 1,
          pinYPt: 2,
          cropXPt: 3,
          cropYPt: 4,
        },
        overlayFamily: { cropWidthPt: 100, cropHeightPt: 80 },
        alignmentPin: { x: 10, y: 20 },
        cropAwaitingPin: false,
      }),
      null,
    );
  });
});

describe("floorPlanStatus", () => {
  it("walks uploaded → pinned (even before crop) → cropped without pin", () => {
    assert.equal(
      floorPlanStatus({ cropped: false, pinned: false }),
      "uploaded",
    );
    assert.equal(
      floorPlanStatus({ cropped: false, pinned: true }),
      "pinned",
    );
    assert.equal(
      floorPlanStatus({ cropped: true, pinned: false }),
      "cropped",
    );
    assert.equal(
      floorPlanStatus({ cropped: true, pinned: true }),
      "pinned",
    );
  });
});

describe("pin on original vs cropped plate", () => {
  it("converts a plate pin to original-page coordinates and back", () => {
    const crop = { x: 40, y: 20, width: 200, height: 100 };
    const platePin = { x: 15, y: 30 };
    const original = buildingPinOnOriginalPage(crop, platePin);
    assert.deepEqual(pinOnCroppedPlate(original, crop), platePin);
  });

  it("reads a plan pin in cropped-plate space", () => {
    assert.equal(planHasPin({ pinXPt: null, pinYPt: null }), false);
    assert.equal(planHasPin({ pinXPt: 55, pinYPt: 80 }), true);
    assert.deepEqual(
      planPinOnCropped({
        pinXPt: 55,
        pinYPt: 80,
        cropXPt: 10,
        cropYPt: 20,
      }),
      { x: 45, y: 60 },
    );
    assert.equal(
      planPinOnCropped({
        pinXPt: 55,
        pinYPt: 80,
        cropXPt: null,
        cropYPt: null,
      }),
      null,
    );
  });
});

describe("crop waits for pin on an existing family plate", () => {
  it("hides the rect until a pin exists, except for a new family or a saved crop", () => {
    assert.equal(
      cropWaitsForPin({
        familyHasPlate: true,
        hasSavedCrop: false,
        hasPin: false,
      }),
      true,
    );
    assert.equal(
      cropWaitsForPin({
        familyHasPlate: true,
        hasSavedCrop: false,
        hasPin: true,
      }),
      false,
    );
    assert.equal(
      cropWaitsForPin({
        familyHasPlate: true,
        hasSavedCrop: true,
        hasPin: false,
      }),
      false,
    );
    assert.equal(
      cropWaitsForPin({
        familyHasPlate: false,
        hasSavedCrop: false,
        hasPin: false,
      }),
      false,
    );
  });
});

describe("family plate pin and crop aligned to pin", () => {
  const page = { width: 400, height: 300 };
  const familySize = { width: 200, height: 100 };
  const l1 = {
    id: "l1",
    familyId: "tower",
    floorNumber: 0,
    pinXPt: 55,
    pinYPt: 80,
    cropXPt: 10,
    cropYPt: 20,
  };
  const l3 = {
    id: "l3",
    familyId: "tower",
    floorNumber: 2,
    pinXPt: 70,
    pinYPt: 90,
    cropXPt: 20,
    cropYPt: 30,
  };
  const parking = {
    id: "p1",
    familyId: "parking",
    floorNumber: 0,
    pinXPt: 15,
    pinYPt: 25,
    cropXPt: 5,
    cropYPt: 5,
  };

  it("uses the nearest cropped sibling at or below this floor", () => {
    const l2 = { id: "l2", familyId: "tower", floorNumber: 1 };
    assert.deepEqual(familyPlatePin([l1, l3, parking], l2), {
      x: 45,
      y: 60,
    });
    assert.deepEqual(familyPlatePin([l1, l3, parking], l3), {
      x: 45,
      y: 60,
    });
    assert.equal(familyPlatePin([parking], l2), null);
  });

  it("matches the real-world offset when a higher floor follows floor 5", () => {
    const f3 = {
      id: "f3",
      familyId: "tower",
      floorNumber: 1,
      pinXPt: 1811.43,
      pinYPt: 1652.24,
      cropXPt: 1007.9,
      cropYPt: 1477.96,
    };
    const f5 = {
      id: "f5",
      familyId: "tower",
      floorNumber: 3,
      pinXPt: 1811.33,
      pinYPt: 1664.54,
      cropXPt: 1006.56,
      cropYPt: 1529.03,
    };
    const f6 = { id: "f6", familyId: "tower", floorNumber: 4 };
    const familySize = { width: 1467.78, height: 440.788 };
    const page = { width: 3168, height: 2448 };
    const pin = { x: 1811.86, y: 1652.27 };
    const platePin = familyPlatePin([f3, f5], f6);
    assert.deepEqual(platePin, { x: 804.77, y: 135.51 });
    const crop = cropAlignedToPin(pin, familySize, page, platePin);
    assert.ok(Math.abs(crop.x - 1007.09) < 0.01);
    assert.equal(crop.y, 1516.76);
    assert.equal(crop.width, 1467.78);
    assert.equal(crop.height, 440.788);
  });

  it("places the family plate so the pin lands on the sibling offset", () => {
    const pin = { x: 100, y: 80 };
    const platePin = { x: 45, y: 60 };
    assert.deepEqual(cropAlignedToPin(pin, familySize, page, platePin), {
      x: 55,
      y: 20,
      width: 200,
      height: 100,
    });
  });

  it("centers the plate on the pin when the family has no sibling offset", () => {
    assert.deepEqual(
      cropAlignedToPin({ x: 200, y: 150 }, familySize, page, null),
      { x: 100, y: 100, width: 200, height: 100 },
    );
  });

  it("clamps the aligned plate onto the page", () => {
    assert.deepEqual(
      cropAlignedToPin({ x: 10, y: 10 }, familySize, page, { x: 80, y: 80 }),
      { x: 0, y: 0, width: 200, height: 100 },
    );
  });
});

describe("cropFloorPlanPdf", () => {
  it("writes a PDF whose page size matches the family crop", async () => {
    const src = await PDFDocument.create();
    const page = src.addPage([400, 300]);
    page.drawRectangle({
      x: 50,
      y: 40,
      width: 200,
      height: 100,
      color: rgb(0.2, 0.2, 0.2),
    });
    const bytes = await src.save();
    const cropped = await cropFloorPlanPdf(bytes, {
      x: 50,
      y: 40,
      width: 200,
      height: 100,
    });
    const out = await PDFDocument.load(cropped);
    const size = out.getPage(0).getSize();
    assert.equal(out.getPageCount(), 1);
    assert.equal(size.width, 200);
    assert.equal(size.height, 100);
  });

  it("crops a 270° sheet using visual coordinates", async () => {
    const src = await PDFDocument.create();
    const page = src.addPage([100, 200]);
    page.setRotation(degrees(270));
    const bytes = await src.save();
    const cropped = await cropFloorPlanPdf(bytes, {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
    const out = await PDFDocument.load(cropped);
    const size = out.getPage(0).getSize();
    assert.equal(size.width, 100);
    assert.equal(size.height, 200);
    assert.equal(out.getPage(0).getRotation().angle, 270);
    const visual = await readPdfPageSize(cropped);
    assert.equal(visual.width, 200);
    assert.equal(visual.height, 100);
  });
});

describe("pdfVisibleRenderParams", () => {
  it("fills the viewport at device pixels and offsets by the CSS pan", () => {
    const params = pdfVisibleRenderParams(
      { x: 40, y: -20, zoom: 2 },
      800,
      600,
      0.5,
      2,
    );
    assert.equal(params.canvasWidth, 1600);
    assert.equal(params.canvasHeight, 1200);
    assert.equal(params.renderScale, 2);
    assert.equal(params.offsetX, 80);
    assert.equal(params.offsetY, -40);
  });

  it("at identity view, scale is layout * dpr and offset is 0", () => {
    const params = pdfVisibleRenderParams(
      { x: 0, y: 0, zoom: 1 },
      100,
      80,
      1.25,
      1,
    );
    assert.equal(params.renderScale, 1.25);
    assert.equal(params.offsetX, 0);
    assert.equal(params.offsetY, 0);
  });

  it("expands the clip by overscan so modest pans stay covered", () => {
    const params = pdfVisibleRenderParams(
      { x: 40, y: -20, zoom: 2 },
      800,
      600,
      0.5,
      2,
      100,
    );
    assert.equal(params.canvasWidth, 2000);
    assert.equal(params.canvasHeight, 1600);
    assert.equal(params.offsetX, (40 + 100) * 2);
    assert.equal(params.offsetY, (-20 + 100) * 2);
  });

  it("matches live element boxes so CSS pan/zoom and the clip share an origin", () => {
    const params = pdfClipFromElementRects(
      { left: 100, top: 50, width: 400 },
      { left: 0, top: 0, width: 800, height: 600 },
      200,
      2,
    );
    assert.equal(params.renderScale, 4);
    assert.equal(params.offsetX, 200);
    assert.equal(params.offsetY, 100);
    assert.equal(params.canvasWidth, 1600);
    assert.equal(params.canvasHeight, 1200);
  });
});

describe("clampPdfVisibleRender", () => {
  it("leaves a clip under the max edge unchanged", () => {
    const params = {
      canvasWidth: 1600,
      canvasHeight: 1200,
      renderScale: 2,
      offsetX: 80,
      offsetY: -40,
    };
    assert.equal(clampPdfVisibleRender(params, 8192), params);
  });

  it("shrinks width, height, scale, and offsets together", () => {
    const clamped = clampPdfVisibleRender(
      {
        canvasWidth: 16000,
        canvasHeight: 12000,
        renderScale: 8,
        offsetX: 400,
        offsetY: -200,
      },
      8192,
    );
    const k = 8192 / 16000;
    assert.equal(clamped.canvasWidth, Math.round(16000 * k));
    assert.equal(clamped.canvasHeight, Math.round(12000 * k));
    assert.equal(clamped.renderScale, 8 * k);
    assert.equal(clamped.offsetX, 400 * k);
    assert.equal(clamped.offsetY, -200 * k);
    const pdfAtOrigin = (0 - 400) / 8;
    assert.equal((0 - clamped.offsetX) / clamped.renderScale, pdfAtOrigin);
  });
});

describe("pdfOverlayRenderParams", () => {
  it("shifts the clip so the overlay rect sits at its screen position", () => {
    const params = pdfOverlayRenderParams(
      { x: 10, y: 20, zoom: 2 },
      { x: 40, y: 8, width: 100, height: 50 },
      400,
      300,
      0.5,
      2,
    );
    assert.equal(params.renderScale, 2);
    assert.equal(params.offsetX, (10 + 40 * 2) * 2);
    assert.equal(params.offsetY, (20 + 8 * 2) * 2);
  });

  it("adds overscan to overlay offsets", () => {
    const params = pdfOverlayRenderParams(
      { x: 10, y: 20, zoom: 2 },
      { x: 40, y: 8, width: 100, height: 50 },
      400,
      300,
      0.5,
      2,
      50,
    );
    assert.equal(params.offsetX, (10 + 40 * 2 + 50) * 2);
    assert.equal(params.offsetY, (20 + 8 * 2 + 50) * 2);
  });
});

describe("overlayPanZoom", () => {
  it("places the page origin at the overlay's screen position", () => {
    assert.deepEqual(
      overlayPanZoom(
        { x: 10, y: 20, zoom: 2 },
        { x: 40, y: 8, width: 100, height: 50 },
      ),
      { x: 90, y: 36, zoom: 2 },
    );
  });

  it("follows an overlay nudge as a screen-pixel translate", () => {
    const view = { x: 5, y: 7, zoom: 2 };
    const follow = panZoomFollowTransform(
      overlayPanZoom(view, { x: 40.5, y: 8, width: 100, height: 50 }),
      overlayPanZoom(view, { x: 40, y: 8, width: 100, height: 50 }),
    );
    assert.equal(follow.scale, 1);
    assert.equal(follow.x, 1);
    assert.equal(follow.y, 0);
  });
});

describe("centerViewOnPagePoint", () => {
  it("places the PDF point at the viewport center after Y-flip", () => {
    const view = { x: 10, y: 20, zoom: 2 };
    const pageHeight = 800;
    const scale = 0.5;
    const point = { x: 120, y: 80 };
    const next = centerViewOnPagePoint(
      view,
      { width: 1000, height: 600 },
      point,
      pageHeight,
      scale,
    );
    const screen = panZoomScreenPoint(
      pdfPointToCanvas(point, pageHeight, scale),
      next,
    );
    assert.equal(next.zoom, 2);
    assert.equal(screen.x, 500);
    assert.equal(screen.y, 300);
  });

  it("does not treat PDF y as canvas y", () => {
    const view = { x: 0, y: 0, zoom: 3 };
    const pageHeight = 2000;
    const point = { x: 1000, y: 1800 };
    const next = centerViewOnPagePoint(
      view,
      { width: 800, height: 800 },
      point,
      pageHeight,
      1,
    );
    const screen = panZoomScreenPoint(
      pdfPointToCanvas(point, pageHeight, 1),
      next,
    );
    assert.equal(screen.x, 400);
    assert.equal(screen.y, 400);
    assert.notEqual(next.y, 400 - point.y * 3);
  });
});

describe("pinRelativeView", () => {
  it("round-trips the same pin and page", () => {
    const view = { x: 40, y: -20, zoom: 2 };
    const pin = { x: 120, y: 80 };
    const stored = pinRelativeViewFromTransform(view, pin, 800, 1);
    assert.deepEqual(
      transformFromPinRelativeView(stored, pin, 800, 1),
      view,
    );
  });

  it("keeps zoom and the pin's screen position when the sheet changes", () => {
    const view = { x: 40, y: -20, zoom: 2.5 };
    const pinA = { x: 100, y: 200 };
    const stored = pinRelativeViewFromTransform(view, pinA, 800, 0.5);
    const pinB = { x: 180, y: 60 };
    const restored = transformFromPinRelativeView(stored, pinB, 1100, 0.5);
    assert.equal(restored.zoom, 2.5);
    const screenA = panZoomScreenPoint(
      pdfPointToCanvas(pinA, 800, 0.5),
      view,
    );
    const screenB = panZoomScreenPoint(
      pdfPointToCanvas(pinB, 1100, 0.5),
      restored,
    );
    assert.deepEqual(screenB, screenA);
  });
});

describe("viewportResizePanAction", () => {
  it("does not pan when the first measurement is from 0×0", () => {
    assert.deepEqual(
      viewportResizePanAction({ width: 0, height: 0 }, { width: 1400, height: 900 }),
      { action: "seed" },
    );
  });

  it("recenters by half the growth after a real size is known", () => {
    assert.deepEqual(
      viewportResizePanAction(
        { width: 1200, height: 800 },
        { width: 1400, height: 900 },
      ),
      { action: "recenter", x: 100, y: 50 },
    );
  });

  it("ignores scrollbar-sized noise", () => {
    assert.deepEqual(
      viewportResizePanAction(
        { width: 1200, height: 800 },
        { width: 1210, height: 805 },
      ),
      { action: "none" },
    );
  });

  it("keeps a restored pin on the same screen pixel across a remount seed", () => {
    const view = { x: 40, y: -20, zoom: 2.5 };
    const pin = { x: 100, y: 200 };
    const stored = pinRelativeViewFromTransform(view, pin, 800, 0.5);
    const restored = transformFromPinRelativeView(stored, pin, 800, 0.5);
    const resize = viewportResizePanAction(
      { width: 0, height: 0 },
      { width: 1400, height: 900 },
    );
    assert.equal(resize.action, "seed");
    const screenBefore = panZoomScreenPoint(pdfPointToCanvas(pin, 800, 0.5), view);
    const screenAfter = panZoomScreenPoint(
      pdfPointToCanvas(pin, 800, 0.5),
      restored,
    );
    assert.deepEqual(screenAfter, screenBefore);
  });
});

describe("panZoomFollowTransform", () => {
  it("is identity when the live view matches the rendered clip", () => {
    const view = { x: 12, y: -4, zoom: 1.5 };
    assert.deepEqual(panZoomFollowTransform(view, view), {
      x: 0,
      y: 0,
      scale: 1,
    });
  });

  it("keeps the cursor origin fixed when zoomAround-style pan/zoom changes", () => {
    const rendered = { x: 0, y: 0, zoom: 1 };
    const originX = 200;
    const originY = 100;
    const nextZoom = 2;
    const ratio = nextZoom / rendered.zoom;
    const current = {
      zoom: nextZoom,
      x: originX - (originX - rendered.x) * ratio,
      y: originY - (originY - rendered.y) * ratio,
    };
    const follow = panZoomFollowTransform(current, rendered);
    assert.equal(follow.scale, 2);
    assert.equal(follow.x + originX * follow.scale, originX);
    assert.equal(follow.y + originY * follow.scale, originY);
  });
});

describe("clipRasterKeyEquals", () => {
  const overlay = { x: 40, y: 8, width: 100, height: 50 };

  it("treats a modest pan as the same raster", () => {
    const zoomed = clipRasterKey(
      { x: 10, y: 20, zoom: 2 },
      0.5,
      800,
      600,
      overlay,
    );
    const panned = clipRasterKey(
      { x: 80, y: -15, zoom: 2 },
      0.5,
      800,
      600,
      overlay,
    );
    assert.equal(clipRasterKeyEquals(zoomed, panned), true);
  });

  it("needs a new raster when pan exceeds half the overscan", () => {
    const a = clipRasterKey({ x: 0, y: 0, zoom: 1 }, 1, 800, 600);
    const b = clipRasterKey(
      { x: CLIP_RASTER_OVERSCAN_PX, y: 0, zoom: 1 },
      1,
      800,
      600,
    );
    assert.equal(clipRasterKeyEquals(a, b), false);
  });

  it("treats overlay origin as the same raster", () => {
    const a = clipRasterKey(
      { x: 10, y: 20, zoom: 2 },
      0.5,
      800,
      600,
      overlay,
    );
    const b = clipRasterKey(
      { x: 10, y: 20, zoom: 2 },
      0.5,
      800,
      600,
      { ...overlay, x: 48, y: 12 },
    );
    assert.equal(clipRasterKeyEquals(a, b), true);
  });

  it("needs a new raster when zoom changes", () => {
    const a = clipRasterKey({ x: 10, y: 20, zoom: 2 }, 0.5, 800, 600);
    const b = clipRasterKey({ x: 10, y: 20, zoom: 2.2 }, 0.5, 800, 600);
    assert.equal(clipRasterKeyEquals(a, b), false);
  });

  it("needs a new raster when overlay size changes", () => {
    const a = clipRasterKey(
      { x: 0, y: 0, zoom: 1 },
      1,
      400,
      300,
      overlay,
    );
    const b = clipRasterKey(
      { x: 0, y: 0, zoom: 1 },
      1,
      400,
      300,
      { ...overlay, width: 120 },
    );
    assert.equal(clipRasterKeyEquals(a, b), false);
  });
});

describe("panZoomScreenRect", () => {
  it("is identity at zoom 1 with no pan", () => {
    const rect = { x: 10, y: 20, width: 100, height: 50 };
    assert.deepEqual(panZoomScreenRect(rect, { x: 0, y: 0, zoom: 1 }), rect);
  });

  it("scales size and origin from the pan offset", () => {
    assert.deepEqual(
      panZoomScreenRect(
        { x: 10, y: 20, width: 100, height: 50 },
        { x: 5, y: 7, zoom: 2 },
      ),
      { x: 25, y: 47, width: 200, height: 100 },
    );
  });
});

describe("panZoomScreenPoint / panZoomViewportToPage", () => {
  it("round-trips a click through zoom and pan", () => {
    const view = { x: 12, y: -8, zoom: 2.5 };
    const page = { x: 80, y: 40 };
    const screen = panZoomScreenPoint(page, view);
    assert.deepEqual(screen, { x: 212, y: 92 });
    assert.deepEqual(panZoomViewportToPage(screen, view), page);
  });

  it("treats zoom 0 as 1 so a click cannot divide by zero", () => {
    assert.deepEqual(
      panZoomViewportToPage({ x: 30, y: 10 }, { x: 10, y: 4, zoom: 0 }),
      { x: 20, y: 6 },
    );
  });
});

describe("pinFromReferenceAnchor", () => {
  const page = { width: 1000, height: 800 };
  const calibrationPlan = {
    pinXPt: 120,
    pinYPt: 80,
    referenceAnchorXPt: 100,
    referenceAnchorYPt: 50,
  };

  it("applies the calibration offset to a target anchor", () => {
    const targetAnchor = { x: 300, y: 200 };
    assert.deepEqual(
      pinFromReferenceAnchor(calibrationPlan, targetAnchor, page),
      { x: 320, y: 230 },
    );
  });

  it("returns null when the calibration floor is incomplete", () => {
    assert.equal(
      pinFromReferenceAnchor(
        { ...calibrationPlan, referenceAnchorXPt: null },
        { x: 1, y: 2 },
        page,
      ),
      null,
    );
  });

  it("computes the offset from pin to anchor on the calibration floor", () => {
    assert.deepEqual(pinOffsetFromReferenceAnchor(calibrationPlan), {
      x: 20,
      y: 30,
    });
  });
});

describe("mapPdfPointAcrossPlans", () => {
  const mechanicalFamily = { scaleDenominator: 50 };
  const architecturalFamily = { scaleDenominator: 150 };
  const mechanicalPin = { x: 100, y: 200 };
  const architecturalPin = { x: 400, y: 500 };

  it("shrinks mechanical offsets when mapped onto architectural (1:50 -> 1:150)", () => {
    const mapped = mapPdfPointAcrossPlans(
      { x: 130, y: 200 },
      mechanicalPin,
      architecturalPin,
      mechanicalFamily,
      architecturalFamily,
    );
    assert.deepEqual(mapped, { x: 410, y: 500 });
  });

  it("expands architectural offsets when mapped onto mechanical (1:150 -> 1:50)", () => {
    const mapped = mapPdfPointAcrossPlans(
      { x: 410, y: 500 },
      architecturalPin,
      mechanicalPin,
      architecturalFamily,
      mechanicalFamily,
    );
    assert.deepEqual(mapped, { x: 130, y: 200 });
  });

  it("maps rectangle geometry across mixed scales", () => {
    const [mapped] = mapAnnotationsAcrossPlans(
      [
        {
          type: "rectangle",
          rect: { x: 100, y: 180, width: 30, height: 20 },
          color: "#dc2626",
          strokeWidthPt: 2,
        },
      ],
      mechanicalPin,
      architecturalPin,
      mechanicalFamily,
      architecturalFamily,
    );
    assert.equal(mapped.type, "rectangle");
    if (mapped.type !== "rectangle") return;
    assert.equal(mapped.rect.x, 400);
    assert.equal(mapped.rect.y, 493.3333333333333);
    assert.equal(mapped.rect.width, 10);
    assert.ok(Math.abs(mapped.rect.height - 20 / 3) < 1e-9);
  });
});

describe("mapAnnotationsToCroppedPlate", () => {
  it("subtracts the crop origin from saved markup", () => {
    const [mapped] = mapAnnotationsToCroppedPlate(
      [
        {
          type: "polyline",
          points: [
            { x: 120, y: 220 },
            { x: 180, y: 260 },
          ],
          color: "#dc2626",
          strokeWidthPt: 2,
        },
      ],
      { x: 100, y: 200 },
    );
    assert.equal(mapped.type, "polyline");
    if (mapped.type !== "polyline") return;
    assert.deepEqual(mapped.points, [
      { x: 20, y: 20 },
      { x: 80, y: 60 },
    ]);
  });
});

describe("familyAnnotationSourcePlan", () => {
  const plans = [
    {
      id: "f10s",
      familyId: "layout-s",
      floorNumber: 10,
      name: "Floor 10",
      annotations: [{ type: "polyline" as const, points: [{ x: 1, y: 2 }], color: "#dc2626", strokeWidthPt: 2 }],
      pinXPt: 10,
      pinYPt: 20,
      cropXPt: 0,
      cropYPt: 0,
    },
    {
      id: "f15s",
      familyId: "layout-s",
      floorNumber: 15,
      name: "Floor 15",
      annotations: [],
      pinXPt: 12,
      pinYPt: 22,
      cropXPt: 5,
      cropYPt: 1,
    },
    {
      id: "f10l",
      familyId: "layout-l",
      floorNumber: 10,
      name: "Floor 10",
      annotations: [{ type: "polyline" as const, points: [{ x: 3, y: 4 }], color: "#2563eb", strokeWidthPt: 2 }],
      pinXPt: 30,
      pinYPt: 40,
      cropXPt: 0,
      cropYPt: 0,
    },
  ];

  it("prefers the nearest annotated sibling in the same family", () => {
    const sameFamily = familyAnnotationSourcePlan(plans, {
      id: "f15s",
      familyId: "layout-s",
      floorNumber: 15,
    });
    assert.equal(sameFamily?.id, "f10s");
    const otherFamily = familyAnnotationSourcePlan(plans, {
      id: "f99l",
      familyId: "layout-l",
      floorNumber: 99,
    });
    assert.equal(otherFamily?.id, "f10l");
    assert.equal(
      familyAnnotationSourcePlan(plans, {
        id: "f15s",
        familyId: "missing-family",
        floorNumber: 15,
      }),
      null,
    );
  });
});

describe("annotationsForCompareSheet", () => {
  it("maps family markup onto higher tower floors when this sheet is empty", () => {
    const plans = [
      {
        id: "f10s",
        familyId: "layout-s",
        floorNumber: 10,
        name: "Floor 10",
        annotations: [
          {
            type: "polyline" as const,
            points: [
              { x: 110, y: 210 },
              { x: 150, y: 250 },
            ],
            color: "#dc2626",
            strokeWidthPt: 2,
          },
        ],
        pinXPt: 100,
        pinYPt: 200,
        cropXPt: 50,
        cropYPt: 40,
      },
      {
        id: "f15s",
        familyId: "layout-s",
        floorNumber: 15,
        name: "Floor 15",
        annotations: [],
        pinXPt: 105,
        pinYPt: 205,
        cropXPt: 55,
        cropYPt: 45,
      },
    ];
    const families = [
      { id: "layout-s", scaleDenominator: 150 },
    ];
    const [mapped] = annotationsForCompareSheet(
      plans[1],
      families[0],
      plans,
      families,
    );
    assert.equal(mapped.type, "polyline");
    if (mapped.type !== "polyline") return;
    assert.deepEqual(mapped.points, [
      { x: 60, y: 170 },
      { x: 100, y: 210 },
    ]);
  });

  it("does not fall back to set 1 markup when comparing set 2", () => {
    const plans = [
      {
        id: "f10s",
        familyId: "layout-s",
        floorNumber: 10,
        name: "Floor 10",
        annotations: [
          {
            type: "polyline" as const,
            points: [
              { x: 110, y: 210 },
              { x: 150, y: 250 },
            ],
            color: "#dc2626",
            strokeWidthPt: 2,
          },
        ],
        pinXPt: 100,
        pinYPt: 200,
        cropXPt: 50,
        cropYPt: 40,
      },
      {
        id: "f15s",
        familyId: "layout-s",
        floorNumber: 15,
        name: "Floor 15",
        annotations: [],
        pinXPt: 105,
        pinYPt: 205,
        cropXPt: 55,
        cropYPt: 45,
      },
    ];
    const families = [{ id: "layout-s", scaleDenominator: 150 }];
    const mapped = annotationsForCompareSheet(
      plans[1],
      families[0],
      plans,
      families,
      2,
    );
    assert.deepEqual(mapped, []);
  });
});

describe("annotationsForCompareSheet cross-family", () => {
  it("does not pull markup from another family when the target family is empty", () => {
    const plans = [
      {
        id: "podium-9",
        familyId: "podium",
        floorNumber: 9,
        name: "Ac209",
        annotations: [
          {
            type: "polyline" as const,
            points: [
              { x: 110, y: 210 },
              { x: 150, y: 250 },
            ],
            color: "#dc2626",
            strokeWidthPt: 2,
          },
        ],
        pinXPt: 100,
        pinYPt: 200,
        cropXPt: 50,
        cropYPt: 40,
      },
      {
        id: "tower-10",
        familyId: "tower-l",
        floorNumber: 10,
        name: "An210",
        annotations: [],
        pinXPt: 105,
        pinYPt: 205,
        cropXPt: 55,
        cropYPt: 45,
      },
    ];
    const families = [
      { id: "podium", scaleDenominator: 150 },
      { id: "tower-l", scaleDenominator: 50 },
    ];
    const resolved = annotationsForCompareSheet(
      plans[1],
      families[1],
      plans,
      families,
    );
    assert.equal(resolved.length, 0);
  });
});

describe("visibleAnnotationsForCompareSheet", () => {
  const wall = {
    type: "polyline" as const,
    points: [
      { x: 110, y: 210 },
      { x: 150, y: 250 },
    ],
    color: "#dc2626",
    strokeWidthPt: 2,
  };
  const heatPump = {
    type: "polyline" as const,
    points: [
      { x: 90, y: 190 },
      { x: 130, y: 230 },
    ],
    color: "#0ea5e9",
    strokeWidthPt: 2,
  };
  const archPlan = {
    id: "arch-5",
    familyId: "arch",
    floorNumber: 5,
    name: "Floor 5",
    annotations: [wall],
    pinXPt: 100,
    pinYPt: 200,
    cropXPt: 50,
    cropYPt: 40,
  };
  const mechPlan = {
    id: "mech-5",
    familyId: "mech",
    floorNumber: 5,
    name: "Floor 5",
    annotations: [heatPump],
    pinXPt: 80,
    pinYPt: 180,
    cropXPt: 40,
    cropYPt: 30,
  };
  const families = [
    { id: "arch", kind: "architectural" as const, scaleDenominator: 150 },
    { id: "mech", kind: "mechanical" as const, scaleDenominator: 150 },
  ];
  const allPlans = [archPlan, mechPlan];

  it("keeps this sheet's lines and pin-maps the other drawing set on the same floor", () => {
    const visible = visibleAnnotationsForCompareSheet({
      plan: archPlan,
      family: families[0],
      plans: [archPlan],
      families: [families[0]],
      allPlans,
      allFamilies: families,
      colorFilter: "all",
    });
    assert.equal(visible.length, 2);
    assert.equal(visible[0]?.type, "polyline");
    if (visible[0]?.type !== "polyline") return;
    assert.deepEqual(visible[0].points, [
      { x: 60, y: 170 },
      { x: 100, y: 210 },
    ]);
    assert.equal(visible[1]?.color, "#0ea5e9");
    if (visible[1]?.type !== "polyline") return;
    assert.deepEqual(visible[1].points, [
      { x: 60, y: 170 },
      { x: 100, y: 210 },
    ]);
  });

  it("hides the other drawing set when only architectural types are checked", () => {
    const visible = visibleAnnotationsForCompareSheet({
      plan: archPlan,
      family: families[0],
      plans: [archPlan],
      families: [families[0]],
      allPlans,
      allFamilies: families,
      colorFilter: ["#dc2626"],
    });
    assert.equal(visible.length, 1);
    assert.equal(visible[0]?.color, "#dc2626");
  });

  it("shows only mechanical overlay when only mechanical types are checked", () => {
    const visible = visibleAnnotationsForCompareSheet({
      plan: archPlan,
      family: families[0],
      plans: [archPlan],
      families: [families[0]],
      allPlans,
      allFamilies: families,
      colorFilter: ["#0ea5e9"],
    });
    assert.equal(visible.length, 1);
    assert.equal(visible[0]?.color, "#0ea5e9");
  });

  it("hides every overlay line when no types are checked", () => {
    const visible = visibleAnnotationsForCompareSheet({
      plan: archPlan,
      family: families[0],
      plans: [archPlan],
      families: [families[0]],
      allPlans,
      allFamilies: families,
      colorFilter: [],
    });
    assert.deepEqual(visible, []);
  });

  it("scopes mechanical overlay to the active riser pass", () => {
    const pass1 = { ...heatPump, markupSet: 1 as const };
    const pass2 = {
      ...heatPump,
      points: [
        { x: 95, y: 195 },
        { x: 135, y: 235 },
      ],
      markupSet: 2 as const,
    };
    const mechanical = { ...mechPlan, annotations: [pass1, pass2] };
    const visible = visibleAnnotationsForCompareSheet({
      plan: archPlan,
      family: families[0],
      plans: [archPlan],
      families: [families[0]],
      allPlans: [archPlan, mechanical],
      allFamilies: families,
      markupSet: 2,
      colorFilter: ["#0ea5e9"],
    });
    assert.equal(visible.length, 1);
    if (visible[0]?.type !== "polyline") return;
    assert.deepEqual(visible[0].points, [
      { x: 65, y: 175 },
      { x: 105, y: 215 },
    ]);
  });
});

describe("overlayAnnotationsForEditSheet", () => {
  it("returns full-page pin-mapped markup when the target sheet is empty", () => {
    const plans = [
      {
        id: "f10s",
        familyId: "layout-s",
        floorNumber: 10,
        name: "Floor 10",
        annotations: [
          {
            type: "polyline" as const,
            points: [
              { x: 110, y: 210 },
              { x: 150, y: 250 },
            ],
            color: "#dc2626",
            strokeWidthPt: 2,
          },
        ],
        pinXPt: 100,
        pinYPt: 200,
        cropXPt: 50,
        cropYPt: 40,
      },
      {
        id: "f15s",
        familyId: "layout-s",
        floorNumber: 15,
        name: "Floor 15",
        annotations: [],
        pinXPt: 105,
        pinYPt: 205,
        cropXPt: 55,
        cropYPt: 45,
      },
    ];
    const families = [{ id: "layout-s", scaleDenominator: 150 }];
    const [mapped] = overlayAnnotationsForEditSheet(
      plans[1],
      families[0],
      plans,
      families,
      { x: 105, y: 205 },
    );
    assert.equal(mapped.type, "polyline");
    if (mapped.type !== "polyline") return;
    assert.deepEqual(mapped.points, [
      { x: 115, y: 215 },
      { x: 155, y: 255 },
    ]);
  });

  it("does not pull markup from another family", () => {
    const plans = [
      {
        id: "podium-9",
        familyId: "podium",
        floorNumber: 9,
        name: "Ac209",
        annotations: [
          {
            type: "polyline" as const,
            points: [{ x: 1, y: 2 }],
            color: "#dc2626",
            strokeWidthPt: 2,
          },
        ],
        pinXPt: 100,
        pinYPt: 200,
        cropXPt: 50,
        cropYPt: 40,
      },
      {
        id: "tower-10",
        familyId: "tower-l",
        floorNumber: 10,
        name: "An210",
        annotations: [],
        pinXPt: 105,
        pinYPt: 205,
        cropXPt: 55,
        cropYPt: 45,
      },
    ];
    const resolved = overlayAnnotationsForEditSheet(
      plans[1],
      { id: "tower-l", scaleDenominator: 50 },
      plans,
      [{ id: "podium", scaleDenominator: 150 }, { id: "tower-l", scaleDenominator: 50 }],
      { x: 105, y: 205 },
    );
    assert.equal(resolved.length, 0);
  });
});

describe("resolveFloorPlanAnnotationMarkup", () => {
  it("does not let a stale empty draft hide saved server markup", () => {
    const planId = "draft-test-plan";
    const saved = [
      {
        type: "polyline" as const,
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
        color: "#dc2626",
        strokeWidthPt: 2,
      },
    ];
    clearFloorPlanAnnotationDraft(planId);
    writeFloorPlanAnnotationDraft(planId, [], saved);
    assert.equal(resolveFloorPlanAnnotationMarkup(planId, saved).length, 1);
    clearFloorPlanAnnotationDraft(planId);
  });

  it("keeps an approve draft when a remount writes an empty preload snapshot", () => {
    const planId = "draft-approve-nav";
    const saved = [
      {
        type: "polyline" as const,
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
        color: "#dc2626",
        strokeWidthPt: 2,
      },
    ];
    const approved = [
      ...saved,
      {
        type: "rectangle" as const,
        rect: { x: 10, y: 20, width: 8, height: 6 },
        color: "#0ea5e9",
        strokeWidthPt: 2,
        callout: {
          x: 14,
          y: 30,
          text: "Riser - HC B9",
          riserId: "hc-b9",
          riserIds: ["hc-b9"],
        },
      },
    ];
    clearFloorPlanAnnotationDraft(planId);
    writeFloorPlanAnnotationDraft(planId, approved, saved);
    writeFloorPlanAnnotationDraft(planId, [], saved);
    const resolved = resolveFloorPlanAnnotationMarkup(planId, saved);
    assert.equal(resolved.length, 2);
    const box = resolved[1];
    assert.equal(box?.type, "rectangle");
    if (box?.type !== "rectangle") return;
    assert.equal(box.callout?.riserId, "hc-b9");
    clearFloorPlanAnnotationDraft(planId);
  });
});

describe("draw color families", () => {
  it("keeps built-in wall colors architectural when family is missing", () => {
    const parsed = parseDrawColorPresets([
      { color: "#dc2626", label: "Structural wall" },
    ]);
    assert.equal(parsed[0]?.family, "architectural");
  });

  it("treats user-added colors without family as mechanical", () => {
    const parsed = parseDrawColorPresets([
      { color: "#0ea5e9", label: "Heat pump", shortcut: "7" },
    ]);
    assert.equal(parsed[0]?.family, "mechanical");
    assert.equal(parsed[0]?.shortcut, "7");
  });

  it("respects an explicit family on a stored preset", () => {
    const parsed = parseDrawColorPresets([
      { color: "#0ea5e9", label: "Heat pump", family: "architectural" },
    ]);
    assert.equal(parsed[0]?.family, "architectural");
  });

  it("splits overlay filters so each family only shows its own types", () => {
    const presets = parseDrawColorPresets([
      { color: "#dc2626", label: "Wall", family: "architectural" },
      { color: "#0ea5e9", label: "Heat pump", family: "mechanical" },
    ]);
    const mechanicalOnly = ["#0ea5e9"];
    assert.deepEqual(
      lineOverlayFilterForFamily(mechanicalOnly, presets, "mechanical"),
      ["#0ea5e9"],
    );
    assert.deepEqual(
      lineOverlayFilterForFamily(mechanicalOnly, presets, "architectural"),
      [],
    );
    assert.equal(
      lineOverlayFilterForFamily("all", presets, "architectural"),
      "all",
    );
  });

  it("hides the other family's strokes when the overlay filter is a color list", () => {
    const annotations = [
      {
        type: "polyline" as const,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        color: "#dc2626",
        strokeWidthPt: 2,
      },
      {
        type: "polyline" as const,
        points: [
          { x: 2, y: 2 },
          { x: 3, y: 3 },
        ],
        color: "#0ea5e9",
        strokeWidthPt: 2,
      },
    ];
    const visible = filterAnnotationsByStrokeColors(annotations, ["#0ea5e9"]);
    assert.equal(visible.length, 1);
    assert.equal(visible[0]?.color, "#0ea5e9");
  });

  it("keeps checked equipment visible when another mechanical type is unchecked", () => {
    const presets = parseDrawColorPresets([
      { color: "#ca8a04", label: "Doors and windows", family: "architectural" },
      { color: "#2563eb", label: "Interior", family: "architectural" },
      { color: "#0ea5e9", label: "Heat pump", family: "mechanical" },
      { color: "#fbbf24", label: "Elec closet", family: "mechanical" },
      { color: "#6366f1", label: "Garbage chute", family: "mechanical" },
    ]);
    const checked = presets
      .map((preset) => preset.color)
      .filter((color) => color !== "#0ea5e9");
    const overlay = [
      {
        type: "rectangle" as const,
        rect: { x: 0, y: 0, width: 10, height: 10 },
        color: "#ca8a04",
        strokeWidthPt: 2,
      },
      {
        type: "circle" as const,
        rect: { x: 20, y: 0, width: 10, height: 10 },
        variant: "cross" as const,
        color: "#2563eb",
        strokeWidthPt: 2,
      },
      {
        type: "polyline" as const,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        color: "#0ea5e9",
        strokeWidthPt: 2,
      },
    ];
    const mechanicalOnly = lineOverlayFilterForFamily(
      checked,
      presets,
      "mechanical",
    );
    assert.equal(
      filterAnnotationsByStrokeColors(overlay, mechanicalOnly).length,
      0,
    );
    const visible = filterAnnotationsByStrokeColors(overlay, checked);
    assert.equal(visible.length, 2);
    assert.equal(visible[0]?.color, "#ca8a04");
    assert.equal(visible[1]?.color, "#2563eb");
  });
});
