/**
 * V3 minutes check and deterministic draft.
 * Run: npx tsx --test scripts/test-meeting-v3-minutes-draft.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assembleMeetingsV3Minutes } from "../lib/meeting-v3/minutes-draft";
import { collectMeetingsV3ValidationFindings } from "../lib/meeting-v3/minutes-validation";
import type { MeetingsV3DraftSourceItem } from "../lib/meeting-v3/minutes-draft";

function item(overrides: Partial<MeetingsV3DraftSourceItem> & Pick<MeetingsV3DraftSourceItem, "id" | "itemNumber" | "title">): MeetingsV3DraftSourceItem {
  return {
    sectionLabel: "Management Report",
    itemType: "discussion_approval",
    conclusion: {
      status: "ratified",
      discussion: "The board approved the work.",
      quote: "The board approved the work.",
      packageQuote: null,
      openReference: false,
    },
    reviewIssues: [],
    ...overrides,
  };
}

describe("v3 minutes check", () => {
  it("keeps a discussed topic and flags an unclear one", () => {
    const findings = collectMeetingsV3ValidationFindings([
      item({
        id: "a",
        itemNumber: "4.A",
        title: "Carpet",
        conclusion: {
          status: "discussed",
          discussion: "The board talked about the carpet.",
          quote: null,
          openReference: false,
        },
      }),
      item({
        id: "b",
        itemNumber: "4.B",
        title: "Gym rules",
        conclusion: {
          status: "unclear",
          discussion: "",
          quote: null,
          openReference: false,
        },
      }),
    ]);
    assert.deepEqual(findings.map((finding) => finding.code), ["unclear_conclusion"]);
  });

  it("does not treat an open package reference as settled", () => {
    const findings = collectMeetingsV3ValidationFindings([
      item({
        id: "a",
        itemNumber: "4.A",
        title: "Valve",
        conclusion: {
          status: "ratified",
          discussion: "Proceed with the recommended option.",
          quote: "Proceed with the recommended option.",
          openReference: true,
        },
      }),
    ]);
    assert.equal(findings[0]?.code, "open_reference");
  });
});

describe("v3 minutes draft", () => {
  it("places a supported approval in the management report and leaves an open topic unsettled", () => {
    const assembled = assembleMeetingsV3Minutes({
      title: "Minutes - 2026-08-12",
      meetingDate: "2026-08-12",
      openPointCount: 1,
      items: [
        item({ id: "a", itemNumber: "4.A", title: "Hot water valve" }),
        item({
          id: "b",
          itemNumber: "4.B",
          title: "Gym rules",
          itemType: "discussion_topic",
          conclusion: {
            status: "unclear",
            discussion: "",
            quote: null,
            openReference: false,
          },
        }),
      ],
    });
    assert.equal(assembled.document.managementReport.itemsForApproval.length, 1);
    assert.equal(assembled.document.managementReport.itemsForApproval[0]?.status, "Motion carried.");
    assert.equal(assembled.document.managementReport.itemsForDiscussion[0]?.status, "Outcome not recorded.");
    assert.match(assembled.markdown, /Working draft/);
    assert.match(assembled.markdown, /Hot water valve/);
    assert.doesNotMatch(assembled.document.managementReport.itemsForDiscussion[0]?.summary ?? "", /Motion carried/);
  });
});
