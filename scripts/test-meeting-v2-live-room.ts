/**
 * Live room clock, agenda leaf, recording health, and transcript cue shape.
 * Run: npx tsx --test scripts/test-meeting-v2-live-room.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activeLeafId,
  adjacentLeafId,
  liveAgendaLeaves,
  type LiveAgendaSourceItem,
} from "../lib/meeting-v2/live-agenda";
import { liveKitTrackEgress } from "../lib/livekit/config";
import {
  LIVE_TRANSCRIPT_INSERT_GAP,
  formatMediaClock,
  liveCuesToMergedCues,
  mediaOffsetMs,
  missingStorageRecordingHealth,
  summarizeRecordingHealth,
} from "../lib/meeting-v2/live-clock";
import {
  mergedCuesToSegmentRows,
  parseVttToMergedCues,
  segmentsToVtt,
} from "../lib/meeting-v2/transcript";

const items: LiveAgendaSourceItem[] = [
  {
    id: "parent",
    itemNumber: "1",
    title: "Reports",
    sourceText: "parent text",
    sourcePagesJson: "[1]",
  },
  {
    id: "steam",
    itemNumber: "1.A",
    title: "Steam",
    sourceText: "steam text",
    sourcePagesJson: "[4, 5]",
  },
  {
    id: "roof",
    itemNumber: "1.B",
    title: "Roof",
    sourceText: null,
    sourcePagesJson: "not-json",
  },
];

describe("live room media clock", () => {
  it("formats offsets as WebVTT timestamps", () => {
    assert.equal(formatMediaClock(0), "00:00:00.000");
    assert.equal(formatMediaClock(3_661_001), "01:01:01.001");
    assert.equal(formatMediaClock(-20), "00:00:00.000");
  });

  it("stores elapsed media time rather than a wall-clock instant", () => {
    const origin = "2026-09-24T20:00:00.000Z";
    const at = new Date("2026-09-24T20:00:05.250Z");
    const offset = mediaOffsetMs(origin, at);
    assert.equal(offset, 5250);
    assert.notEqual(offset, at.getTime());
    assert.equal(mediaOffsetMs(origin, new Date(origin)), 0);
  });

  it("rejects an unparseable media origin", () => {
    assert.throws(() => mediaOffsetMs("not-a-time", new Date()), /mediaStartedAt/);
  });
});

describe("live room agenda", () => {
  it("shows leaves and keeps package pages", () => {
    const leaves = liveAgendaLeaves(items);
    assert.deepEqual(
      leaves.map((leaf) => leaf.id),
      ["steam", "roof"],
    );
    assert.equal(leaves[0]?.sourceText, "steam text");
    assert.deepEqual(leaves[0]?.sourcePages, [4, 5]);
    assert.deepEqual(leaves[1]?.sourcePages, []);
  });

  it("moves to the next leaf and restores the last marked leaf", () => {
    const leaves = liveAgendaLeaves(items);
    assert.equal(adjacentLeafId(leaves, "steam", 1), "roof");
    assert.equal(adjacentLeafId(leaves, "roof", 1), null);
    assert.equal(adjacentLeafId(leaves, "steam", -1), null);
    assert.equal(activeLeafId(leaves, []), "steam");
    assert.equal(activeLeafId(leaves, ["roof", "missing"]), "roof");
  });
});

describe("live room recording health", () => {
  it("waits until a track egress exists", () => {
    assert.equal(summarizeRecordingHealth([]).state, "waiting");
  });

  it("reports an in-progress track ahead of a finished one", () => {
    const health = summarizeRecordingHealth([
      { status: "complete", error: "" },
      { status: "active", error: "" },
    ]);
    assert.equal(health.state, "recording");
    assert.match(health.detail, /1 track recording/);
  });

  it("surfaces the egress error when recording fails", () => {
    const health = summarizeRecordingHealth([
      { status: "failed", error: "missing storage bucket" },
    ]);
    assert.equal(health.state, "failed");
    assert.equal(health.detail, "missing storage bucket");
  });

  it("counts completed track files", () => {
    const health = summarizeRecordingHealth([
      { status: "complete", error: "" },
      { status: "complete", error: "" },
    ]);
    assert.equal(health.state, "finished");
    assert.match(health.detail, /2 track files/);
  });

  it("names the missing bucket instead of pretending recording is waiting", () => {
    const health = missingStorageRecordingHealth();
    assert.equal(health.state, "unconfigured");
    assert.match(health.detail, /LIVEKIT_EGRESS_S3_BUCKET/);
  });
});

describe("live room track egress", () => {
  const keys = [
    "LIVEKIT_EGRESS_S3_BUCKET",
    "LIVEKIT_EGRESS_S3_ACCESS_KEY",
    "LIVEKIT_EGRESS_S3_SECRET",
    "LIVEKIT_EGRESS_S3_REGION",
    "LIVEKIT_EGRESS_S3_ENDPOINT",
  ] as const;
  const previous = new Map<string, string | undefined>();

  it("omits egress until bucket, access key, and secret are all set", () => {
    for (const key of keys) previous.set(key, process.env[key]);
    try {
      delete process.env.LIVEKIT_EGRESS_S3_BUCKET;
      delete process.env.LIVEKIT_EGRESS_S3_ACCESS_KEY;
      delete process.env.LIVEKIT_EGRESS_S3_SECRET;
      assert.equal(liveKitTrackEgress(), null);

      process.env.LIVEKIT_EGRESS_S3_BUCKET = "board-recordings";
      process.env.LIVEKIT_EGRESS_S3_ACCESS_KEY = "key";
      process.env.LIVEKIT_EGRESS_S3_SECRET = "secret";
      process.env.LIVEKIT_EGRESS_S3_REGION = "us-east-1";
      const egress = liveKitTrackEgress();
      assert.equal(egress?.tracks?.output.case, "s3");
      assert.equal(egress?.tracks?.filepath.includes("{publisher_identity}"), true);
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("live recognition cue shape", () => {
  it("round-trips through the VTT parser the minutes pipeline already uses", () => {
    const merged = liveCuesToMergedCues([
      {
        startMs: 1500,
        endMs: 4200,
        speakerLabel: "Ada Lovelace",
        text: "Stairwell F",
      },
    ]);
    const rows = mergedCuesToSegmentRows(merged, {
      meetingId: "meeting",
      sourceArtifactId: "artifact",
      startSequence: 1,
    });
    const parsed = parseVttToMergedCues(segmentsToVtt(rows));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.speaker, "Ada Lovelace");
    assert.equal(parsed[0]?.text, "Stairwell F");
    assert.equal(parsed[0]?.start, "00:00:01.500");
    assert.equal(parsed[0]?.end, "00:00:04.200");
    assert.equal(rows[0]?.startMs, 1500);
    assert.equal(rows[0]?.speakerLabel, "Ada Lovelace");
  });

  it("names why those rows are not inserted yet", () => {
    assert.match(LIVE_TRANSCRIPT_INSERT_GAP, /first artifact of type transcript/);
    assert.match(LIVE_TRANSCRIPT_INSERT_GAP, /No recognizer is connected/);
  });
});
