/**
 * Tests for looping transcript span-edge review.
 * Run: npx tsx --test scripts/test-meeting-v2-span-edge-review.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cuesInWindow,
  growSpanForwardOnce,
  nextForeignSpanStartSeconds,
  reviewTranscriptTopicSpans,
  SPAN_EDGE_MAX_FORWARD_LOOPS,
  SPAN_EDGE_WINDOW_SECONDS,
  type SpanReviewCue,
  type SpanReviewTopic,
} from "../lib/meeting-v2/span-edge-review";

function cueAt(seconds: number, sequence: number, text = "talk"): SpanReviewCue {
  const hh = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const ss = String(Math.floor(seconds % 60)).padStart(2, "0");
  return {
    sequence,
    startSeconds: seconds,
    endSeconds: seconds + 2,
    startTimestamp: `${hh}:${mm}:${ss}`,
    speaker: "Haider",
    text,
  };
}

describe("span-edge window helpers", () => {
  it("selects cues after the span end up to the window cap", () => {
    const cues = [cueAt(10, 1), cueAt(70, 2), cueAt(130, 3), cueAt(200, 4)];
    const inWindow = cuesInWindow(cues, 60, 180);
    assert.deepEqual(
      inWindow.map((cue) => cue.sequence),
      [2, 3],
    );
  });

  it("caps growth at the next foreign span start", () => {
    const grown = growSpanForwardOnce({
      span: { startSeconds: 100, endSeconds: 120 },
      foreignStartSeconds: 150,
      decision: { action: "extend", atSeconds: 240 },
      lastCueEndSeconds: 240,
    });
    assert.ok(grown);
    assert.ok(grown.endSeconds < 150);
    assert.ok(grown.endSeconds > 120);
  });

  it("finds the next later leaf span on a different item", () => {
    const leak: SpanReviewTopic = {
      title: "MUA leak",
      itemNumber: "4.B.3",
      discussionTimestampRange: "00:32:00 - 00:32:34",
      sourceTranscriptRanges: [[10, 20]],
    };
    const pump: SpanReviewTopic = {
      title: "Pump 10A",
      itemNumber: "4.B.4",
      discussionTimestampRange: "00:38:49 - 00:40:00",
      sourceTranscriptRanges: [[80, 90]],
    };
    const parent: SpanReviewTopic = {
      title: "Projects",
      itemNumber: "4.B",
      discussionTimestampRange: "00:30:00 - 00:40:00",
      sourceTranscriptRanges: [[1, 90]],
    };
    const next = nextForeignSpanStartSeconds(leak, 32 * 60 + 34, [parent, leak, pump]);
    assert.equal(next?.title, "Pump 10A");
  });
});

describe("reviewTranscriptTopicSpans looping", () => {
  it("loops 2-minute windows until a 6-minute hole is filled", async () => {
    const start = 32 * 60 + 34;
    const holeEnd = 38 * 60 + 43;
    const cues: SpanReviewCue[] = [];
    for (let second = start + 5; second <= holeEnd; second += 15) {
      cues.push(cueAt(second, second));
    }
    const topic: SpanReviewTopic = {
      title: "MUA leak",
      itemNumber: "4.B.3",
      discussionStatus: "discussed",
      discussionTimestampRange: "00:32:00 - 00:32:34",
      sourceTranscriptRanges: [[1, 10]],
    };
    const next: SpanReviewTopic = {
      title: "Pump 10A",
      itemNumber: "4.B.4",
      discussionStatus: "discussed",
      discussionTimestampRange: "00:38:49 - 00:40:00",
      sourceTranscriptRanges: [[200, 210]],
    };

    let forwardCalls = 0;
    const reviewed = await reviewTranscriptTopicSpans({
      topics: [topic, next],
      cues,
      judge: async ({ direction }) => {
        if (direction === "forward") {
          forwardCalls += 1;
          return { action: "extend", atSeconds: null };
        }
        return { action: "stop", atSeconds: null };
      },
    });

    assert.ok(forwardCalls >= 3);
    assert.ok(forwardCalls <= SPAN_EDGE_MAX_FORWARD_LOOPS * 3);
    const timing = reviewed[0]?.discussionTimestampRange ?? "";
    assert.match(timing, /00:38:/);
    assert.equal(SPAN_EDGE_WINDOW_SECONDS, 120);
  });
});
