/**
 * Polyline cut / sever tests.
 * Run: npx tsx --test scripts/test-floor-plan-polyline-cut.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cutPolylineBetweenLocations,
  locatePointOnPolyline,
  positionAlongPolyline,
} from "@/lib/building/floor-plan-polyline-cut";

describe("floor-plan polyline cut", () => {
  it("locates endpoints and mid-segment points", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];

    const start = locatePointOnPolyline(points, { x: 0, y: 0 }, 1);
    assert.ok(start);
    assert.equal(start!.segmentIndex, 0);
    assert.equal(start!.t, 0);

    const corner = locatePointOnPolyline(points, { x: 10, y: 0 }, 1);
    assert.ok(corner);
    assert.equal(corner!.point.x, 10);
    assert.equal(corner!.point.y, 0);

    const mid = locatePointOnPolyline(points, { x: 5, y: 0 }, 1);
    assert.ok(mid);
    assert.equal(mid!.segmentIndex, 0);
    assert.ok(mid!.t > 0.4 && mid!.t < 0.6);
  });

  it("severs the segment between two interior cut points", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];

    const first = {
      segmentIndex: 0,
      t: 0.25,
      point: { x: 2.5, y: 0 },
    };
    const second = {
      segmentIndex: 1,
      t: 0.5,
      point: { x: 15, y: 0 },
    };

    const pieces = cutPolylineBetweenLocations(points, first, second);
    assert.equal(pieces.length, 2);
    assert.equal(pieces[0].length, 2);
    assert.equal(pieces[0][0].x, 0);
    assert.equal(pieces[0][1].x, 2.5);
    assert.equal(pieces[1][0].x, 15);
    assert.equal(pieces[1][1].x, 20);
  });

  it("orders cut points when the second click comes first along the line", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];

    const later = {
      segmentIndex: 1,
      t: 0.5,
      point: { x: 15, y: 0 },
    };
    const earlier = {
      segmentIndex: 0,
      t: 0.25,
      point: { x: 2.5, y: 0 },
    };

    const pieces = cutPolylineBetweenLocations(points, later, earlier);
    assert.equal(pieces.length, 2);
    assert.equal(pieces[0][1].x, 2.5);
    assert.equal(pieces[1][0].x, 15);
  });

  it("removes an interior segment between two corner cut points", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];

    const first = {
      segmentIndex: 0,
      t: 1,
      point: { x: 10, y: 0 },
    };
    const second = {
      segmentIndex: 1,
      t: 1,
      point: { x: 20, y: 0 },
    };

    const pieces = cutPolylineBetweenLocations(points, first, second);
    assert.equal(pieces.length, 1);
    assert.equal(pieces[0].length, 2);
    assert.equal(pieces[0][0].x, 0);
    assert.equal(pieces[0][1].x, 10);
  });

  it("returns empty when both cut points coincide", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const loc = {
      segmentIndex: 0,
      t: 0.5,
      point: { x: 5, y: 0 },
    };
    assert.equal(cutPolylineBetweenLocations(points, loc, loc).length, 0);
  });

  it("compares positions along a polyline", () => {
    const a = { segmentIndex: 0, t: 0.5, point: { x: 5, y: 0 } };
    const b = { segmentIndex: 1, t: 0, point: { x: 10, y: 0 } };
    assert.ok(positionAlongPolyline(a) < positionAlongPolyline(b));
  });
});
