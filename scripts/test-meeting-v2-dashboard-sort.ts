/**
 * V2 pipeline list sort when several workspaces share one meeting date.
 * Run: npx tsx --test scripts/test-meeting-v2-dashboard-sort.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareMeetingsV2ListRows } from "../lib/meeting-v2/dashboard-list-sort";

describe("V2 dashboard list sort", () => {
  it("puts the newest workspace first when the meeting date matches", () => {
    const rows = [
      {
        meetingDate: "2026-08-12",
        createdAt: "2026-09-27T15:58:36.608Z",
        title: "Minutes - 2026-08-12 v20",
      },
      {
        meetingDate: "2026-08-12",
        createdAt: "2026-09-27T17:53:06.669Z",
        title: "Meeting - 2026-08-12 v22",
      },
      {
        meetingDate: "2026-08-12",
        createdAt: "2026-09-27T16:44:55.226Z",
        title: "Meeting - 2026-08-12 v21",
      },
    ];

    rows.sort((left, right) => compareMeetingsV2ListRows(left, right, "desc"));

    assert.equal(rows[0]?.title, "Meeting - 2026-08-12 v22");
    assert.equal(rows[1]?.title, "Meeting - 2026-08-12 v21");
    assert.equal(rows[2]?.title, "Minutes - 2026-08-12 v20");
  });
});
