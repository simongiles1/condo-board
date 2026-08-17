/**
 * Unit checks for pdfjs page profiler routing + helpers (no network).
 * Run: npx tsx --test scripts/test-page-profile.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PAGE_ROUTE_THRESHOLDS,
  coverageRatioFromBoxes,
  routeFromProfileMetrics,
  summarizeProfiles,
  type PageProfile,
} from "../lib/pdf/page-profile";

describe("routeFromProfileMetrics", () => {
  it("routes caption-under-diagram pages to vision (char-count false negative)", () => {
    // >150 chars but tiny text area + dense vectors = blueprint with caption
    const route = routeFromProfileMetrics({
      chars: 220,
      textAreaRatio: 0.03,
      imageAreaRatio: 0,
      vectorOps: 4_200,
    });
    assert.equal(route, "vision");
  });

  it("routes scanned invoice with footer text to vision via image coverage", () => {
    const route = routeFromProfileMetrics({
      chars: 800,
      textAreaRatio: 0.12,
      imageAreaRatio: 0.92,
      vectorOps: 0,
    });
    assert.equal(route, "vision");
  });

  it("routes dense contract text pages to text", () => {
    const route = routeFromProfileMetrics({
      chars: 3_100,
      textAreaRatio: 0.46,
      imageAreaRatio: 0,
      vectorOps: 5,
    });
    assert.equal(route, "text");
  });

  it("routes near-blank / scan pages to vision", () => {
    const route = routeFromProfileMetrics({
      chars: 12,
      textAreaRatio: 0.01,
      imageAreaRatio: 0.05,
      vectorOps: 0,
    });
    assert.equal(route, "vision");
  });

  it("marks moderate mixed pages as ambiguous", () => {
    const route = routeFromProfileMetrics({
      chars: 900,
      textAreaRatio: 0.18,
      imageAreaRatio: 0.2,
      vectorOps: 50,
    });
    assert.equal(route, "ambiguous");
  });

  it("marks text-heavy pages with small embedded photos/charts as ambiguous", () => {
    // g11/g20-style: dense selectable text + photos covering ~4–8% of page
    const withPhotos = routeFromProfileMetrics({
      chars: 3_000,
      textAreaRatio: 0.45,
      imageAreaRatio: 0.08,
      vectorOps: 40,
    });
    assert.equal(withPhotos, "ambiguous");

    // g20 p17-style: pie chart body ~5% while labels are selectable text
    const withChart = routeFromProfileMetrics({
      chars: 800,
      textAreaRatio: 0.27,
      imageAreaRatio: 0.05,
      vectorOps: 26,
    });
    assert.equal(withChart, "ambiguous");

    // Logo-only under the embedded threshold stays text
    const logoOnly = routeFromProfileMetrics({
      chars: 2_000,
      textAreaRatio: 0.5,
      imageAreaRatio: 0.02,
      vectorOps: 10,
    });
    assert.equal(logoOnly, "text");
  });

  it("exposes thresholds suitable for zero-FN tuning", () => {
    assert.ok(PAGE_ROUTE_THRESHOLDS.textAreaVisionMax < 0.2);
    assert.ok(PAGE_ROUTE_THRESHOLDS.imageAreaVisionMin > 0.2);
    assert.ok(PAGE_ROUTE_THRESHOLDS.vectorOpsVisionMin >= 100);
    assert.ok(PAGE_ROUTE_THRESHOLDS.embeddedImageAmbiguousMin < 0.1);
    assert.ok(
      PAGE_ROUTE_THRESHOLDS.minImagePaintArea <
        PAGE_ROUTE_THRESHOLDS.embeddedImageAmbiguousMin,
    );
  });
});

describe("coverageRatioFromBoxes", () => {
  it("uses union coverage, not summed overlapping boxes", () => {
    // Two identical full-page boxes must still count as ~1.0, not 2.0.
    const pageW = 100;
    const pageH = 100;
    const full = { x0: 0, y0: 0, x1: 100, y1: 100 };
    const summedWouldBeTwo = coverageRatioFromBoxes([full, full], pageW, pageH, 1);
    assert.equal(summedWouldBeTwo, 1);

    // Two non-overlapping halves → ~0.5
    const left = { x0: 0, y0: 0, x1: 50, y1: 100 };
    const right = { x0: 50, y0: 0, x1: 100, y1: 100 };
    const halves = coverageRatioFromBoxes([left, right], pageW, pageH, 1);
    assert.equal(halves, 1);

    // Small band (full width × 20% height) stays near 0.2 even with X-overlap
    const bandA = { x0: 0, y0: 40, x1: 100, y1: 60 };
    const bandB = { x0: 10, y0: 40, x1: 90, y1: 60 };
    const band = coverageRatioFromBoxes([bandA, bandB], pageW, pageH, 1);
    assert.equal(band, 0.2);
  });
});

describe("summarizeProfiles", () => {
  it("reports vision-or-ambiguous base rate", () => {
    const profiles: PageProfile[] = [
      {
        pageNo: 1,
        chars: 100,
        textAreaRatio: 0.4,
        imageAreaRatio: 0,
        vectorOps: 0,
        hasTextLayer: true,
        route: "text",
      },
      {
        pageNo: 2,
        chars: 10,
        textAreaRatio: 0.01,
        imageAreaRatio: 0.9,
        vectorOps: 0,
        hasTextLayer: true,
        route: "vision",
      },
      {
        pageNo: 3,
        chars: 500,
        textAreaRatio: 0.15,
        imageAreaRatio: 0.2,
        vectorOps: 80,
        hasTextLayer: true,
        route: "ambiguous",
      },
    ];
    const summary = summarizeProfiles(profiles);
    assert.equal(summary.totalPages, 3);
    assert.equal(summary.text, 1);
    assert.equal(summary.vision, 1);
    assert.equal(summary.ambiguous, 1);
    assert.equal(summary.visionOrAmbiguousRate, 2 / 3);
  });
});
