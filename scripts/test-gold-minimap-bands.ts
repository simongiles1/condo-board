/**
 * Gold minimap band merging.
 * Run: npx tsx --test scripts/test-gold-minimap-bands.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGoldMinimapBands } from "../components/GoldStandardTranscriptMinimap";
import type { GoldCueSegmentMeta } from "../lib/meeting-v2/segment-gold-standard";

function metaAt(
  sections: Array<{ id: string; code: string; title: string }>,
): GoldCueSegmentMeta {
  return {
    sections: sections.map((section) => ({
      id: section.id,
      code: section.code,
      title: section.title,
      startSeconds: 0,
      endSeconds: 1,
    })),
    position: "solo",
    showLabel: true,
    segmentStartsAtCue: true,
  };
}

describe("buildGoldMinimapBands", () => {
  it("merges adjacent cues with the same labeling", () => {
    const colors = new Map([["1.a", "#2563eb"]]);
    const meta: GoldCueSegmentMeta[] = [
      metaAt([{ id: "a", code: "1.A", title: "One" }]),
      metaAt([{ id: "a", code: "1.A", title: "One" }]),
      metaAt([]),
      metaAt([]),
    ];
    const bands = buildGoldMinimapBands(meta, colors);
    assert.equal(bands.length, 2);
    assert.equal(bands[0].cueCount, 2);
    assert.ok(bands[0].fill);
    assert.equal(bands[1].cueCount, 2);
    assert.equal(bands[1].fill, null);
  });
});
