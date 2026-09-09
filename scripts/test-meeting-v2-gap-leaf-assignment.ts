/**
 * Tests for assigning unmatched package leaves inside transcript overlay holes.
 * Run: npx tsx --test scripts/test-meeting-v2-gap-leaf-assignment.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignUnmatchedLeavesInHoles,
  findTranscriptHoles,
} from "../lib/meeting-v2/gap-leaf-assignment";
import {
  listUnmatchedLaterLeaves,
  type SpanReviewCue,
  type SpanReviewTopic,
} from "../lib/meeting-v2/span-edge-review";

function cueAt(seconds: number, text: string): SpanReviewCue {
  const hh = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const ss = String(Math.floor(seconds % 60)).padStart(2, "0");
  return {
    sequence: seconds,
    startSeconds: seconds,
    endSeconds: seconds + 2,
    startTimestamp: `${hh}:${mm}:${ss}`,
    speaker: "Haider",
    text,
  };
}

const gEnd = 1 * 3600 + 1 * 60 + 5;
const hStart = 1 * 3600 + 1 * 60 + 42;
const gWrapEnd = 1 * 3600 + 2 * 60 + 14;
const iStart = 1 * 3600 + 2 * 60 + 15;
const jStart = 1 * 3600 + 7 * 60 + 2;
const jEnd = 1 * 3600 + 11 * 60 + 46;
const kStart = 1 * 3600 + 11 * 60 + 49;

function packageLeaves(): SpanReviewTopic[] {
  return [
    {
      title: "Unit 712 - Chargeback Dispute",
      itemNumber: "4.D.g",
      discussionStatus: "discussed",
      discussionTimestampRange: "01:00:00 - 01:01:05",
      sourceTranscriptRanges: [[1, 10]],
    },
    {
      title: "Unit 2005 water meter pipe",
      itemNumber: "4.D.h",
      discussionStatus: "not_discussed",
      sourceTranscriptRanges: [],
    },
    {
      title: "Shared facilities quarterly meetings with Studio 2",
      itemNumber: "4.D.i",
      discussionStatus: "not_discussed",
      sourceTranscriptRanges: [],
    },
    {
      title: "Gym signage and rules",
      itemNumber: "4.D.j",
      discussionStatus: "not_discussed",
      sourceTranscriptRanges: [],
    },
    {
      title: "Mailroom Light Cut-out Concerns",
      itemNumber: "4.D.k",
      discussionStatus: "discussed",
      discussionTimestampRange: "01:11:49 - 01:13:00",
      sourceTranscriptRanges: [[400, 420]],
    },
  ];
}

describe("unmatched later leaves in a hole", () => {
  it("lists 4.D.h/i/j between 4.D.g and 4.D.k", () => {
    const topics = packageLeaves();
    const unmatched = listUnmatchedLaterLeaves(topics[0], gEnd, topics);
    assert.deepEqual(
      unmatched.map((topic) => topic.itemNumber),
      ["4.D.h", "4.D.i", "4.D.j"],
    );
  });

  it("finds the overlay hole from 4.D.g to 4.D.k", () => {
    const holes = findTranscriptHoles(packageLeaves(), [
      cueAt(gEnd + 10, "wrap"),
      cueAt(kStart + 5, "mailroom"),
    ]);
    assert.equal(holes.length, 1);
    assert.equal(holes[0]?.left.itemNumber, "4.D.g");
    assert.equal(holes[0]?.right?.itemNumber, "4.D.k");
    assert.deepEqual(
      holes[0]?.unmatched.map((topic) => topic.itemNumber),
      ["4.D.h", "4.D.i", "4.D.j"],
    );
  });
});

describe("assignUnmatchedLeavesInHoles", () => {
  it("extends 4.D.g wrap-up and opens h, i, and j in the hole", async () => {
    const cues: SpanReviewCue[] = [
      cueAt(gEnd + 13, "Honour felt sorry for me."),
      cueAt(gEnd + 14, "Sometimes people just want to feel heard."),
      cueAt(hStart, "Even unit 2005, this is regarding that water metre pipe."),
      cueAt(gWrapEnd, "Great."),
      cueAt(iStart, "joint meeting for the shared facilities with Studio Two quarterly"),
      cueAt(jStart, "I can actually jump in on this one. I think the sign in the gym was just"),
      cueAt(jEnd, "Uhh..."),
      cueAt(kStart, "this is regarding the ceiling light cutouts."),
    ];

    const reviewed = await assignUnmatchedLeavesInHoles({
      topics: packageLeaves(),
      cues,
      judge: async ({ unmatched, cues: windowCues }) => {
        const text = windowCues.map((cue) => cue.text.toLowerCase()).join(" ");
        const opens = [];
        if (text.includes("2005") && unmatched.some((topic) => topic.itemNumber === "4.D.h")) {
          opens.push({
            itemNumber: "4.D.h",
            startSeconds: hStart,
            endSeconds: gWrapEnd,
          });
        }
        if (text.includes("shared facilities") && unmatched.some((topic) => topic.itemNumber === "4.D.i")) {
          opens.push({
            itemNumber: "4.D.i",
            startSeconds: iStart,
            endSeconds: jStart - 1,
          });
        }
        if (text.includes("gym") && unmatched.some((topic) => topic.itemNumber === "4.D.j")) {
          opens.push({
            itemNumber: "4.D.j",
            startSeconds: jStart,
            endSeconds: jEnd,
          });
        }
        return {
          extendFloorTo: text.includes("heard") || text.includes("great") ? gWrapEnd : null,
          opens,
        };
      },
    });

    assert.match(reviewed[0]?.discussionTimestampRange ?? "", /01:02:14/);
    assert.match(reviewed[1]?.discussionTimestampRange ?? "", /01:01:42/);
    assert.match(reviewed[2]?.discussionTimestampRange ?? "", /01:02:15/);
    assert.match(reviewed[3]?.discussionTimestampRange ?? "", /01:07:02/);
    assert.equal(reviewed[1]?.discussionStatus, "discussed");
    assert.equal(reviewed[2]?.discussionStatus, "discussed");
    assert.equal(reviewed[3]?.discussionStatus, "discussed");
  });
});
