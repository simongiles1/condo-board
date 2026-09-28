/**
 * Live room clock, agenda leaf, recording health, and transcript cue shape.
 * Run: npx tsx --test scripts/test-meeting-v2-live-room.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activeLeafId,
  activeLiveFocus,
  adjacentLeafId,
  effectivePresentedPage,
  leafStepTarget,
  liveAgendaLeaves,
  liveAgendaOutlineRows,
  liveRoomAgendaSidebarRows,
  navigationAllowed,
  packagePageToOpen,
  pageMapCheckView,
  groupPageRanges,
  stageMove,
  stagePackagePage,
  stagePages,
  type LiveAgendaSourceItem,
} from "../lib/meeting-v2/live-agenda";
import { agendaItemIndentDepth } from "../lib/meeting-v2/agenda-outline";
import {
  archiveLinksForLeaves,
  matchAgendaArchiveFile,
} from "../lib/meeting-v2/live-archive-links";
import { clipStageTextToItem } from "../lib/meeting-v2/stage-item-text";
import {
  linkPackagePageCitations,
  packagePdfViewRange,
  storedPackageCitationGap,
  packagePageFromHref,
} from "../lib/meeting-v2/package-page-refs";
import { applySpeechGrammar } from "../components/useLiveSpeechRecognition";
import {
  isDuplicateRecognitionCue,
  normalizeRecognitionText,
  recognitionCueOffsets,
} from "../lib/meeting-v2/live-recognition";
import {
  originalRecognitionText,
  proposeVocabularyCorrections,
} from "../lib/meeting-v2/live-corrections";
import {
  LIVE_VOCABULARY_HANGOVER_MS,
  liveVocabularyPhrases,
  vocabularyFocus,
} from "../lib/meeting-v2/live-vocabulary";
import { liveKitTrackEgress } from "../lib/livekit/config";
import {
  LIVE_TRANSCRIPT_INSERT_GAP,
  formatMediaClock,
  liveCuesToMergedCues,
  mediaOffsetMs,
  missingStorageRecordingHealth,
  summarizeRecordingHealth,
  type CaptureGapView,
  type RecordingEgressStatus,
} from "../lib/meeting-v2/live-clock";
import {
  assessCaptureHealth,
  liveKitTimestampMs,
  parseCaptureObjectLocation,
  trackIdFromEgressFile,
  type CaptureHealthInput,
} from "../lib/meeting-v2/capture-health";
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

  it("lists package headings before leaves and marks only leaves navigable", () => {
    const outline = liveAgendaOutlineRows(items);
    assert.deepEqual(
      outline.map((row) => [row.itemNumber, row.kind, row.agendaItemId]),
      [
        ["1", "heading", null],
        ["1.A", "leaf", "steam"],
        ["1.B", "leaf", "roof"],
      ],
    );
  });

  it("inserts missing subsection headings from section labels", () => {
    const outline = liveAgendaOutlineRows([
      {
        id: "fin",
        itemNumber: "3",
        title: "Financial statements",
        sourceText: null,
        sourcePagesJson: "[]",
      },
      {
        id: "rat-one",
        itemNumber: "4.A.1",
        title: "Steam Room Heat Pump",
        sectionLabel:
          "Property Management Report: Ratification of email decisions made since the last board meeting.",
        sourceText: null,
        sourcePagesJson: "[10]",
      },
    ]);
    assert.deepEqual(
      outline.map((row) => row.itemNumber),
      ["3", "4", "4.A", "4.A.1"],
    );
    assert.equal(outline.find((row) => row.itemNumber === "4")?.kind, "heading");
    assert.equal(outline.find((row) => row.itemNumber === "4.A")?.title, outline[2]?.title);
    assert.match(outline[2]?.title ?? "", /ratification/i);
    assert.equal(outline.find((row) => row.itemNumber === "4.A.1")?.kind, "leaf");
  });

  it("moves to the next leaf and restores the last marked leaf", () => {
    const leaves = liveAgendaLeaves(items);
    assert.equal(adjacentLeafId(leaves, "steam", 1), "roof");
    assert.equal(adjacentLeafId(leaves, "roof", 1), null);
    assert.equal(adjacentLeafId(leaves, "steam", -1), null);
    assert.equal(activeLeafId(leaves, []), "steam");
    assert.equal(activeLeafId(leaves, ["roof", "missing"]), "roof");
  });

  it("lets only the presenter move, and a later jump restores an earlier leaf", () => {
    assert.equal(navigationAllowed(null, "ada"), false);
    assert.equal(navigationAllowed("ada", "bea"), false);
    assert.equal(navigationAllowed("ada", "ada"), true);

    const leaves = liveAgendaLeaves(items);
    const history = [
      { agendaItemId: "steam", unscheduled: false },
      { agendaItemId: null, unscheduled: true },
      { agendaItemId: "steam", unscheduled: false },
    ];
    assert.deepEqual(activeLiveFocus(leaves, history), {
      kind: "leaf",
      agendaItemId: "steam",
    });
    assert.equal(history.length, 3);
    assert.deepEqual(activeLiveFocus(leaves, history.slice(0, 2)), { kind: "unscheduled" });
    assert.equal(leafStepTarget(leaves, history.slice(0, 2), 1), "roof");
    assert.equal(leafStepTarget(leaves, history.slice(0, 2), -1), "steam");
  });

  it("keeps a personal page open and does not treat a presented page as a leaf change", () => {
    const leaves = liveAgendaLeaves(items);
    const focus = activeLiveFocus(leaves, [{ agendaItemId: "steam", unscheduled: false }]);
    assert.equal(effectivePresentedPage(focus, leaves, 4), 4);
    assert.equal(effectivePresentedPage(focus, leaves, 9), null);
    assert.equal(effectivePresentedPage({ kind: "unscheduled" }, leaves, 4), null);
    assert.deepEqual(activeLiveFocus(leaves, [{ agendaItemId: "steam", unscheduled: false }]), focus);

    assert.deepEqual(
      packagePageToOpen({
        personalPage: 5,
        presentedPage: 4,
        viewerIsPresenter: false,
        dismissedPresentedPage: null,
      }),
      { page: 5, source: "personal" },
    );
    assert.deepEqual(
      packagePageToOpen({
        personalPage: null,
        presentedPage: 4,
        viewerIsPresenter: false,
        dismissedPresentedPage: null,
      }),
      { page: 4, source: "presented" },
    );
    assert.deepEqual(
      packagePageToOpen({
        personalPage: null,
        presentedPage: 4,
        viewerIsPresenter: true,
        dismissedPresentedPage: null,
      }),
      { page: null, source: null },
    );
    assert.deepEqual(
      packagePageToOpen({
        personalPage: null,
        presentedPage: 4,
        viewerIsPresenter: false,
        dismissedPresentedPage: 4,
      }),
      { page: null, source: null },
    );
  });

  it("shows an unchecked page map without dropping leaves", () => {
    const leaves = liveAgendaLeaves(items);
    const unchecked = pageMapCheckView({
      checkedAt: null,
      checkedByIdentity: null,
      checkedByName: null,
      leaves,
    });
    assert.equal(unchecked.checkedAt, null);
    assert.deepEqual(
      unchecked.leavesWithoutPages.map((leaf) => leaf.id),
      ["roof"],
    );
    assert.deepEqual(
      leaves.map((leaf) => leaf.id),
      ["steam", "roof"],
    );

    const checked = pageMapCheckView({
      checkedAt: "2026-09-26T12:00:00.000Z",
      checkedByIdentity: "ada",
      checkedByName: "Ada",
      leaves,
    });
    assert.equal(checked.checkedAt, "2026-09-26T12:00:00.000Z");
    assert.equal(checked.checkedByName, "Ada");
  });

  it("sidebar rows tolerate a missing snapshot and empty outline", () => {
    assert.deepEqual(liveRoomAgendaSidebarRows(null), []);
    assert.deepEqual(liveRoomAgendaSidebarRows(undefined), []);
    const leaves = liveAgendaLeaves(items);
    assert.equal(
      liveRoomAgendaSidebarRows({ outline: [], leaves }).length,
      leaves.length,
    );
    const outline = liveAgendaOutlineRows(items);
    assert.deepEqual(
      liveRoomAgendaSidebarRows({ outline, leaves }).map((row) => row.key),
      outline.map((row) => row.key),
    );
  });

  it("moves Next to the next agenda item, not the next attached page", () => {
    const leaves = [
      { id: "steam", sourcePages: [3, 13, 14] },
      { id: "roof", sourcePages: [9] },
    ];
    const onSteam = [{ agendaItemId: "steam", unscheduled: false }];
    assert.deepEqual(
      stageMove({ leaves, navigation: onSteam, presentedPage: 3, direction: 1 }),
      { kind: "leaf", agendaItemId: "roof", page: 9 },
    );
    assert.deepEqual(
      stageMove({
        leaves,
        navigation: [{ agendaItemId: "roof", unscheduled: false }],
        presentedPage: 9,
        direction: -1,
      }),
      { kind: "leaf", agendaItemId: "steam", page: 3 },
    );
    assert.equal(stagePackagePage({ kind: "leaf", agendaItemId: "steam" }, [3, 13]), 3);
    assert.equal(stagePackagePage({ kind: "unscheduled" }, [3]), null);
    assert.deepEqual(stagePages([3, 13, 14, 4]), { shown: [3, 4], attached: [13, 14] });
    assert.deepEqual(groupPageRanges([14, 13, 27]), [
      { start: 13, end: 14 },
      { start: 27, end: 27 },
    ]);
  });
});

describe("live room package citations", () => {
  it("links a Docling page icon and the page numbers that follow it", () => {
    const linked = linkPackagePageCitations(
      "signed proposal. (Page ... ... ...) 13 - 26\n(Page ... ... ...) 27\nBell &amp; Gossett",
    );
    assert.match(linked, /\[Pages 13–26\]\(#pkg\/13-26\)/);
    assert.match(linked, /\[Page 27\]\(#pkg\/27\)/);
    assert.match(linked, /Bell & Gossett/);
    assert.deepEqual(packagePageFromHref("#pkg/13-26"), { start: 13, end: 26 });
    assert.equal(packagePageFromHref("https://example.com"), null);
    assert.match(
      storedPackageCitationGap({ citedStart: 13, citedEnd: 26, storedPageCount: 13 }) ?? "",
      /pages 14–26 are missing/,
    );
    assert.match(
      storedPackageCitationGap({ citedStart: 27, citedEnd: 27, storedPageCount: 13 }) ?? "",
      /Page 27 is not in this meeting's package/,
    );
    assert.equal(
      storedPackageCitationGap({ citedStart: 13, citedEnd: 26, storedPageCount: 80 }),
      null,
    );
    assert.deepEqual(
      packagePdfViewRange({ initialPage: 13, citedEnd: 26, storedPageCount: 216 }),
      {
        start: 13,
        end: 26,
        pageNumbers: Array.from({ length: 14 }, (_, index) => 13 + index),
        continuousScroll: true,
        openPage: 13,
      },
    );
    assert.deepEqual(
      packagePdfViewRange({ initialPage: 27, citedEnd: 27, storedPageCount: 216 }),
      {
        start: 27,
        end: 27,
        pageNumbers: [27],
        continuousScroll: false,
        openPage: 27,
      },
    );
    assert.deepEqual(
      packagePdfViewRange({ initialPage: 40, storedPageCount: 216 }),
      {
        start: 1,
        end: 216,
        pageNumbers: [],
        continuousScroll: false,
        openPage: 40,
      },
    );
  });
});

describe("live room stage item text", () => {
  const page = [
    "## Property Management Report:",
    "## A. Ratification of email decisions",
    "## 1. Steam Room Heat Pump Design, Tender and Construction Review",
    "The Board approved the steam room proposal.",
    "## 2. Main Lobby / Elevator Lobby Restoration Work - Certificate of Completion",
    "The lobby work was awarded to Absolute Ltd.",
  ].join("\n");

  it("drops the next agenda item that shares the package page", () => {
    const steam = clipStageTextToItem(
      page,
      "Steam Room Heat Pump Design, Tender and Construction Review",
      ["Main Lobby / Elevator Lobby Restoration Work - Certificate of Completion"],
    );
    assert.match(steam, /steam room proposal/);
    assert.doesNotMatch(steam, /Absolute Ltd/);
    assert.doesNotMatch(steam, /Property Management Report/);

    const lobby = clipStageTextToItem(
      page,
      "Main Lobby / Elevator Lobby Restoration Work - Certificate of Completion",
      ["Steam Room Heat Pump Design, Tender and Construction Review"],
    );
    assert.match(lobby, /Absolute Ltd/);
    assert.doesNotMatch(lobby, /steam room proposal/);
  });

  it("indents outline codes the way the agenda review nests them", () => {
    assert.equal(agendaItemIndentDepth("2"), 0);
    assert.equal(agendaItemIndentDepth("1.A"), 1);
    assert.equal(agendaItemIndentDepth("4.A.1"), 2);
    assert.equal(agendaItemIndentDepth("4.B.1"), 2);
  });
});

describe("live room archive documents", () => {
  const minutes = [
    {
      id: "june",
      filename: "June 30-2026.2517 TSCC.pdf",
      receivedAt: "2026-07-02T00:00:00.000Z",
    },
    {
      id: "june-copy",
      filename: "June 30-2026.2517 TSCC (2).pdf",
      receivedAt: "2026-07-03T00:00:00.000Z",
    },
    {
      id: "may",
      filename: "May 21-2026.2517 TSCC.pdf",
      receivedAt: "2026-05-22T00:00:00.000Z",
    },
  ];
  const financials = [
    {
      id: "fs-june",
      filename: "2517 TSCC FS June 2026.pdf",
      receivedAt: "2026-07-10T00:00:00.000Z",
    },
  ];

  it("matches the minutes and statement named in the agenda title", () => {
    assert.equal(
      matchAgendaArchiveFile("Review and Approval of Minutes of June 30, 2026", minutes)?.fileId,
      "june",
    );
    assert.equal(
      matchAgendaArchiveFile(
        "Review and approval of the unaudited financial statements for June 2026",
        financials,
      )?.label,
      "June 2026 financial statements",
    );
    assert.equal(matchAgendaArchiveFile("1.A Booster Pump", minutes), null);
    assert.deepEqual(
      archiveLinksForLeaves(
        [
          { id: "minutes", title: "Review and Approval of Minutes of June 30, 2026" },
          { id: "pump", title: "1.A Booster Pump" },
        ],
        { minutes, financials },
      ).map((link) => link.agendaItemId),
      ["minutes"],
    );
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

  it("names a missing bucket as critical, including the recreate step", () => {
    const health = missingStorageRecordingHealth();
    assert.equal(health.severity, "critical");
    assert.equal(health.label, "Critical");
    assert.doesNotMatch(health.label, /Unknown/);
    assert.match(health.detail, /LIVEKIT_EGRESS_S3_BUCKET/);
    assert.match(health.detail, /everyone must leave|everyone leaves/i);
  });

  it("does not call an unreadable status Unknown", () => {
    const health = summarizeRecordingHealth([
      { status: "not-a-status" as RecordingEgressStatus, error: "" },
    ]);
    assert.equal(health.severity, "critical");
    assert.equal(health.label, "Critical");
    assert.doesNotMatch(health.label, /Unknown/);
  });
});

const mediaStartedAtMs = Date.parse("2026-09-26T00:00:00.000Z");

function captureInput(overrides: Partial<CaptureHealthInput> = {}): CaptureHealthInput {
  return {
    nowMs: mediaStartedAtMs + 60_000,
    mediaStartedAtMs,
    storageConfigured: true,
    statusReadOk: true,
    statusError: null,
    roomClosed: false,
    publishing: [],
    egress: [],
    gaps: [],
    tracks: [],
    graceMs: 20_000,
    ...overrides,
  };
}

function gap(partial: Partial<CaptureGapView> & Pick<CaptureGapView, "detection">): CaptureGapView {
  return {
    id: partial.id ?? "gap",
    detection: partial.detection,
    participantIdentity: partial.participantIdentity ?? null,
    trackId: partial.trackId ?? null,
    egressId: partial.egressId ?? null,
    startOffsetMs: partial.startOffsetMs ?? 0,
    endOffsetMs: partial.endOffsetMs ?? null,
    detail: partial.detail ?? "",
    acceptedAt: partial.acceptedAt ?? null,
  };
}

describe("capture health", () => {
  it("stays healthy while a new microphone is inside the grace period", () => {
    const health = assessCaptureHealth(
      captureInput({
        publishing: [
          {
            participantIdentity: "ada",
            trackId: "TR_ada",
            firstSeenAtMs: mediaStartedAtMs + 50_000,
          },
        ],
      }),
    );
    assert.equal(health.health.severity, "healthy");
    assert.equal(health.health.state, "waiting");
    assert.equal(health.drafts.length, 0);
  });

  it("is critical when a publishing microphone has no egress after the grace period", () => {
    const health = assessCaptureHealth(
      captureInput({
        publishing: [
          {
            participantIdentity: "ada",
            trackId: "TR_ada",
            firstSeenAtMs: mediaStartedAtMs,
          },
        ],
      }),
    );
    assert.equal(health.health.severity, "critical");
    assert.equal(health.health.label, "Critical");
    assert.equal(health.drafts[0]?.detection, "microphone_unmatched");
    assert.equal(health.drafts[0]?.trackId, "TR_ada");
    assert.match(health.health.detail, /ada/);
  });

  it("matches each publishing microphone and ignores a bare active egress", () => {
    const health = assessCaptureHealth(
      captureInput({
        publishing: [
          { participantIdentity: "ada", trackId: "TR_ada", firstSeenAtMs: mediaStartedAtMs },
          { participantIdentity: "grace", trackId: "TR_grace", firstSeenAtMs: mediaStartedAtMs },
        ],
        egress: [{ egressId: "eg-ada", status: "active", error: "", trackId: "TR_ada" }],
      }),
    );
    assert.equal(health.health.severity, "critical");
    assert.equal(health.drafts.filter((draft) => draft.trackId === "TR_grace").length, 1);
  });

  it("is healthy when every publishing microphone has a live egress", () => {
    const health = assessCaptureHealth(
      captureInput({
        publishing: [
          { participantIdentity: "ada", trackId: "TR_ada", firstSeenAtMs: mediaStartedAtMs },
        ],
        egress: [{ egressId: "eg-ada", status: "active", error: "", trackId: "TR_ada" }],
      }),
    );
    assert.equal(health.health.severity, "healthy");
    assert.equal(health.health.state, "recording");
  });

  it("treats a failed status read as critical and not Unknown", () => {
    const health = assessCaptureHealth(
      captureInput({ statusReadOk: false, statusError: "timeout" }),
    );
    assert.equal(health.health.severity, "critical");
    assert.equal(health.health.label, "Critical");
    assert.doesNotMatch(health.health.detail, /Unknown/);
    assert.equal(health.drafts[0]?.detection, "status_read_failed");
  });

  it("keeps a failed egress critical until a gap covers it", () => {
    const uncovered = assessCaptureHealth(
      captureInput({
        egress: [{ egressId: "eg-1", status: "failed", error: "bucket rejected", trackId: "TR_ada" }],
      }),
    );
    assert.equal(uncovered.health.severity, "critical");
    assert.match(uncovered.health.detail, /bucket rejected/);

    const covered = assessCaptureHealth(
      captureInput({
        egress: [{ egressId: "eg-1", status: "failed", error: "bucket rejected", trackId: "TR_ada" }],
        gaps: [gap({ detection: "egress_failed", egressId: "eg-1", trackId: "TR_ada", endOffsetMs: 1000 })],
      }),
    );
    assert.equal(covered.health.severity, "healthy");
    assert.equal(covered.drafts.length, 0);
  });

  it("stays critical when a covered failure still has a publishing microphone", () => {
    const health = assessCaptureHealth(
      captureInput({
        publishing: [
          { participantIdentity: "ada", trackId: "TR_ada", firstSeenAtMs: mediaStartedAtMs },
        ],
        egress: [{ egressId: "eg-1", status: "failed", error: "", trackId: "TR_ada" }],
        gaps: [gap({ detection: "egress_failed", egressId: "eg-1", trackId: "TR_ada" })],
      }),
    );
    assert.equal(health.health.severity, "critical");
    assert.equal(health.drafts.some((draft) => draft.detection === "microphone_unmatched"), true);
  });

  it("requires the stored file to cover publishing time minus gaps", () => {
    const track = {
      trackId: "TR_ada",
      participantIdentity: "ada",
      firstSeenAtMs: mediaStartedAtMs,
      lastSeenAtMs: mediaStartedAtMs + 61_000,
      unpublishedAtMs: mediaStartedAtMs + 61_000,
      fileOpened: true,
      fileDurationMs: 50_000,
      fileStartedAtMs: mediaStartedAtMs + 400,
    };
    const short = assessCaptureHealth(
      captureInput({
        roomClosed: true,
        nowMs: mediaStartedAtMs + 70_000,
        egress: [{ egressId: "eg-1", status: "complete", error: "", trackId: "TR_ada" }],
        tracks: [track],
      }),
    );
    assert.equal(short.health.severity, "critical");
    assert.equal(short.drafts[0]?.detection, "duration_short");

    const explained = assessCaptureHealth(
      captureInput({
        roomClosed: true,
        nowMs: mediaStartedAtMs + 70_000,
        egress: [{ egressId: "eg-1", status: "complete", error: "", trackId: "TR_ada" }],
        tracks: [track],
        gaps: [
          gap({
            detection: "microphone_unmatched",
            trackId: "TR_ada",
            startOffsetMs: 0,
            endOffsetMs: 12_000,
          }),
        ],
      }),
    );
    assert.equal(explained.health.severity, "healthy");
    assert.equal(explained.health.state, "finished");
    assert.equal(explained.clockDeltaMs, 400);
  });

  it("is critical when a completed file cannot be opened", () => {
    const health = assessCaptureHealth(
      captureInput({
        roomClosed: true,
        egress: [{ egressId: "eg-1", status: "complete", error: "", trackId: "TR_ada" }],
        tracks: [
          {
            trackId: "TR_ada",
            participantIdentity: "ada",
            firstSeenAtMs: mediaStartedAtMs,
            lastSeenAtMs: mediaStartedAtMs + 10_000,
            unpublishedAtMs: mediaStartedAtMs + 10_000,
            fileOpened: false,
            fileDurationMs: 10_000,
            fileStartedAtMs: mediaStartedAtMs,
          },
        ],
      }),
    );
    assert.equal(health.health.severity, "critical");
    assert.equal(health.drafts[0]?.detection, "file_missing");
  });

  it("parses egress locations and track ids", () => {
    assert.equal(liveKitTimestampMs(BigInt("1700000000000000000")), 1_700_000_000_000);
    assert.equal(liveKitTimestampMs(1_700_000_000_000), 1_700_000_000_000);
    assert.equal(
      trackIdFromEgressFile("meetings/v2-1/ada-MICROPHONE-TR_abc123"),
      "TR_abc123",
    );
    assert.deepEqual(parseCaptureObjectLocation("s3://board-recordings/meetings/a.ogg", "other"), {
      bucket: "board-recordings",
      key: "meetings/a.ogg",
    });
    assert.deepEqual(
      parseCaptureObjectLocation("meetings/v2-1/ada.ogg", "board-recordings"),
      { bucket: "board-recordings", key: "meetings/v2-1/ada.ogg" },
    );
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

describe("live recognition cues", () => {
  it("keeps original utterances off the historical transcript clock math", () => {
    assert.equal(normalizeRecognitionText("  Stairwell   F "), "Stairwell F");
    assert.equal(normalizeRecognitionText("   "), null);
    assert.deepEqual(recognitionCueOffsets({ endOffsetMs: 4200, durationMs: 2700 }), {
      startOffsetMs: 1500,
      endOffsetMs: 4200,
    });
    assert.equal(
      isDuplicateRecognitionCue({
        previous: { speakerIdentity: "ada", text: "Stairwell F", startOffsetMs: 1500 },
        next: { speakerIdentity: "ada", text: "Stairwell F", startOffsetMs: 1800 },
      }),
      true,
    );
    assert.equal(
      isDuplicateRecognitionCue({
        previous: { speakerIdentity: "ada", text: "Stairwell F", startOffsetMs: 1500 },
        next: { speakerIdentity: "ada", text: "Passed", startOffsetMs: 1600 },
      }),
      false,
    );
  });

  it("keeps meeting titles, the active leaf, and a short hangover", () => {
    const leaves = [
      {
        id: "steam",
        title: "Steam Room Heat Pump",
        sourceText: "Trace Consulting Group signed the proposal for $48,000. Approved.",
      },
      {
        id: "roof",
        title: "Roof Replacement",
        sourceText: "Absolute Roofing Ltd will start in June.",
      },
    ];
    const onSteam = vocabularyFocus({
      leaves,
      navigation: [{ agendaItemId: "steam", unscheduled: false, mediaOffsetMs: 0 }],
      nowOffsetMs: 10_000,
    });
    assert.equal(onSteam.hangoverLeafId, null);
    const steamHints = liveVocabularyPhrases({ leaves, ...onSteam });
    assert.ok(steamHints.phrases.includes("Trace Consulting Group"));
    assert.ok(steamHints.phrases.includes("Steam Room Heat Pump"));
    assert.ok(steamHints.phrases.includes("Roof Replacement"));
    assert.equal(
      steamHints.phrases.some((phrase) => phrase.includes("48,000") || phrase === "Approved"),
      false,
    );

    const justMoved = vocabularyFocus({
      leaves,
      navigation: [
        { agendaItemId: "steam", unscheduled: false, mediaOffsetMs: 0 },
        { agendaItemId: "roof", unscheduled: false, mediaOffsetMs: 20_000 },
      ],
      nowOffsetMs: 30_000,
    });
    assert.equal(justMoved.activeLeafId, "roof");
    assert.equal(justMoved.hangoverLeafId, "steam");
    const during = liveVocabularyPhrases({ leaves, ...justMoved });
    assert.ok(during.phrases.includes("Trace Consulting Group"));
    assert.ok(during.phrases.includes("Absolute Roofing Ltd"));

    const later = vocabularyFocus({
      leaves,
      navigation: [
        { agendaItemId: "steam", unscheduled: false, mediaOffsetMs: 0 },
        { agendaItemId: "roof", unscheduled: false, mediaOffsetMs: 20_000 },
      ],
      nowOffsetMs: 20_000 + LIVE_VOCABULARY_HANGOVER_MS + 1,
    });
    assert.equal(later.hangoverLeafId, null);
    const after = liveVocabularyPhrases({ leaves, ...later });
    assert.equal(after.phrases.includes("Trace Consulting Group"), false);
    assert.ok(after.phrases.includes("Absolute Roofing Ltd"));
  });

  it("suggests a near name and leaves the original caption unchanged", () => {
    const original = "Trace Consultin Group signed for $48,000 and it was approved.";
    const proposals = proposeVocabularyCorrections(original, [
      "Trace Consulting Group",
      "$48,000",
      "Approved",
    ]);
    assert.deepEqual(proposals, [
      { heardText: "Trace Consultin Group", proposedText: "Trace Consulting Group" },
    ]);
    assert.equal(originalRecognitionText(original), original);
  });
});

describe("speech grammar assignment", () => {
  it("does not throw when the browser rejects a grammar list and null", () => {
    const recognition = {
      set grammars(_value: unknown) {
        throw new TypeError(
          "Failed to set the 'grammars' property on 'SpeechRecognition': Failed to convert value to 'SpeechGrammarList'.",
        );
      },
      get grammars() {
        return null;
      },
    };
    assert.doesNotThrow(() => applySpeechGrammar(recognition, { length: 1 } as SpeechGrammarList));
    assert.doesNotThrow(() => applySpeechGrammar(recognition, null));
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
    assert.match(LIVE_TRANSCRIPT_INSERT_GAP, /meetings_v2_live_recognition_cues/);
    assert.doesNotMatch(LIVE_TRANSCRIPT_INSERT_GAP, /No recognizer is connected/);
  });
});
