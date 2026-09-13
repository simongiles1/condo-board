/**
 * Tests for assigning unmatched package leaves inside transcript overlay holes.
 * Run: npx tsx --test scripts/test-meeting-v2-gap-leaf-assignment.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignRemainingHolesToAgenda,
  assignUnmatchedLeavesInHoles,
  extendFloorThroughLifecycleHoles,
  findTranscriptHoles,
  isProceduralTranscriptCue,
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

function nextMeetingHoleTopics(): SpanReviewTopic[] {
  return [
    {
      title: "Shared Cost Invoices with Studio 2",
      itemNumber: "4.E.g",
      discussionStatus: "ad_hoc",
      discussionTimestampRange: "01:58:45 - 02:01:53",
      sourceTranscriptRanges: [[1, 20]],
    },
    {
      title: "Manual Fire Alarm Announcements",
      itemNumber: "4.E.h",
      discussionStatus: "ad_hoc",
      discussionTimestampRange: "02:04:07 - 02:08:28",
      sourceTranscriptRanges: [[80, 120]],
    },
    {
      title: "Date and time of the next Board Meeting",
      itemNumber: "5",
      discussionStatus: "not_discussed",
      sourceTranscriptRanges: [],
    },
    {
      title: "Adjournment",
      itemNumber: "6",
      discussionStatus: "not_discussed",
      sourceTranscriptRanges: [],
    },
  ];
}

describe("leftover holes after outline-order assignment", () => {
  const gEnd = 2 * 3600 + 1 * 60 + 53;
  const nextStart = 2 * 3600 + 2 * 60 + 9;
  const nextEnd = 2 * 3600 + 3 * 60 + 40;
  const hStart = 2 * 3600 + 4 * 60 + 7;

  it("treats item 5 as outside unmatched-between 4.E.g and 4.E.h", () => {
    const holes = findTranscriptHoles(nextMeetingHoleTopics(), [
      cueAt(gEnd + 10, "we can wait"),
      cueAt(hStart + 5, "manual announcements"),
    ]);
    assert.equal(holes.length, 1);
    assert.equal(holes[0]?.left.itemNumber, "4.E.g");
    assert.equal(holes[0]?.right?.itemNumber, "4.E.h");
    assert.deepEqual(
      holes[0]?.unmatched.map((topic) => topic.itemNumber),
      [],
    );
  });

  it("does not open item 5 during outline-order hole assignment", async () => {
    const reviewed = await assignUnmatchedLeavesInHoles({
      topics: nextMeetingHoleTopics(),
      cues: [cueAt(nextStart, "we didn't talk about the next board meeting")],
      judge: async () => ({
        extendFloorTo: null,
        opens: [
          {
            itemNumber: "5",
            startSeconds: nextStart,
            endSeconds: nextEnd,
          },
        ],
      }),
    });
    assert.equal(reviewed[2]?.discussionTimestampRange, undefined);
  });

  it("assigns item 5 in the leftover hole between 4.E.g and 4.E.h", async () => {
    const reviewed = await assignRemainingHolesToAgenda({
      topics: nextMeetingHoleTopics(),
      cues: [
        cueAt(gEnd + 4, "We can wait on that, actually."),
        cueAt(nextStart, "Oh, one other important thing, we didn't talk about the next board"),
        cueAt(nextStart + 1, "We can deal with them that time."),
        cueAt(nextEnd, "Yeah, it goes fast."),
      ],
      judge: async ({ unmatched, cues: windowCues }) => {
        const text = windowCues.map((cue) => cue.text.toLowerCase()).join(" ");
        if (text.includes("next board") && unmatched.some((topic) => topic.itemNumber === "5")) {
          return {
            extendFloorTo: null,
            opens: [
              {
                itemNumber: "5",
                startSeconds: nextStart,
                endSeconds: nextEnd,
              },
            ],
          };
        }
        return { extendFloorTo: null, opens: [] };
      },
    });
    assert.match(reviewed[2]?.discussionTimestampRange ?? "", /02:02:09/);
    assert.match(reviewed[2]?.discussionTimestampRange ?? "", /02:03:40/);
    assert.equal(reviewed[2]?.discussionStatus, "discussed");
    assert.equal(reviewed[3]?.discussionTimestampRange, undefined);
    assert.match(reviewed[0]?.discussionTimestampRange ?? "", /02:01:53/);
    assert.match(reviewed[1]?.discussionTimestampRange ?? "", /02:04:07/);
  });
});

describe("lifecycle wrap-up holes", () => {
  const b3End = 38 * 60 + 18;
  const unmute = 38 * 60 + 21;
  const hearMe = 38 * 60 + 34;
  const good = 38 * 60 + 35;
  const pumpStart = 38 * 60 + 49;

  function muaAndPump(): SpanReviewTopic[] {
    return [
      {
        title: "PH Mechanical Room Make-Up Air Unit Leak Repair",
        itemNumber: "4.B.3",
        discussionStatus: "discussed",
        discussionTimestampRange: "00:31:35 - 00:38:18",
        sourceTranscriptRanges: [[1, 40]],
      },
      {
        title: "Heating Pump P-10A Seal Replacement",
        itemNumber: "4.B.4",
        discussionStatus: "discussed",
        discussionTimestampRange: "00:38:49 - 00:42:27",
        sourceTranscriptRanges: [[80, 120]],
      },
    ];
  }

  it("treats unmute and move-on lines as procedural", () => {
    assert.equal(isProceduralTranscriptCue("Okay, can we move to the next item?"), true);
    assert.equal(isProceduralTranscriptCue("Hey, Paul, are you?"), true);
    assert.equal(isProceduralTranscriptCue("He is muted."), true);
    assert.equal(isProceduralTranscriptCue("Can you hear me?"), true);
    assert.equal(isProceduralTranscriptCue("We are good."), true);
    assert.equal(
      isProceduralTranscriptCue("We have a sealed replacement for pump 10A"),
      false,
    );
  });

  it("extends 4.B.3 through the unmute hole before 4.B.4", () => {
    const reviewed = extendFloorThroughLifecycleHoles({
      topics: muaAndPump(),
      cues: [
        cueAt(b3End + 1, "Okay, can we move to the next item?"),
        cueAt(unmute, "Hey, Paul, are you?"),
        cueAt(unmute + 3, "He is muted."),
        cueAt(hearMe, "Can you hear me?"),
        cueAt(good, "We are good."),
        cueAt(pumpStart, "We have a sealed replacement for pump 10A"),
      ],
    });
    assert.match(reviewed[0]?.discussionTimestampRange ?? "", /00:38:3/);
    assert.doesNotMatch(reviewed[0]?.discussionTimestampRange ?? "", /00:38:49/);
    assert.match(reviewed[1]?.discussionTimestampRange ?? "", /00:38:49/);
  });

  it("does not swallow the next named matter", () => {
    const reviewed = extendFloorThroughLifecycleHoles({
      topics: muaAndPump(),
      cues: [cueAt(b3End + 2, "We have a sealed replacement for pump 10A")],
    });
    assert.match(reviewed[0]?.discussionTimestampRange ?? "", /00:38:18/);
    assert.doesNotMatch(reviewed[0]?.discussionTimestampRange ?? "", /00:38:20/);
  });
});
