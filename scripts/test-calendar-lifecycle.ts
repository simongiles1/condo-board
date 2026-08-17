/**
 * Google Calendar-style event lifecycle (cancel / reschedule / new invite).
 * Run: npx tsx --test scripts/test-calendar-lifecycle.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyCalendarWritesToState,
  calendarStartAt,
  collapseDuplicateScheduledMeetings,
  eventDateKey,
  foldCalendarHarvests,
  planCalendarLifecycle,
  replayCalendarLifecycleMutations,
  type ExistingCalendarEvent,
} from "../lib/email-analysis/calendar-lifecycle";
import { formatEventClockTime } from "../lib/format/datetime";
import {
  mergeEventHighlightExtractions,
  parseEventHighlightJson,
} from "../lib/email-analysis/event-highlight-shared";

function meeting(overrides: Partial<ExistingCalendarEvent> = {}): ExistingCalendarEvent {
  return {
    id: "evt-july-30",
    eventType: "meeting",
    startAt: "2026-07-30T19:00:00",
    status: "scheduled",
    title: "Board meeting",
    description: null,
    dedupKey: "meeting|2026-07-30",
    ...overrides,
  };
}

describe("calendarStartAt", () => {
  it("keeps date-only when time is missing", () => {
    assert.equal(calendarStartAt("2026-07-21"), "2026-07-21");
  });

  it("appends HH:MM as a local ISO datetime", () => {
    assert.equal(calendarStartAt("2026-08-02", "19:00"), "2026-08-02T19:00:00");
  });

  it("uses the start of a harvested time range", () => {
    assert.equal(
      calendarStartAt("2026-07-21", "09:00-17:00"),
      "2026-07-21T09:00:00",
    );
  });

  it("ignores non-clock times", () => {
    assert.equal(calendarStartAt("2026-07-21", "afternoon"), "2026-07-21");
  });
});

describe("formatEventClockTime", () => {
  it("returns null for date-only values", () => {
    assert.equal(formatEventClockTime("2026-07-21"), null);
  });

  it("formats a valid ISO datetime", () => {
    assert.equal(formatEventClockTime("2026-08-06T18:00:00"), "6:00 p.m.");
  });

  it("formats the start of a leftover harvest range without throwing", () => {
    assert.equal(
      formatEventClockTime("2026-07-21T09:00-17:00:00"),
      "9:00 a.m.",
    );
  });
});

describe("planCalendarLifecycle", () => {
  it("cancels an existing meeting without leaving a calendar row", () => {
    const writes = planCalendarLifecycle({
      existing: [meeting()],
      cancellations: [
        {
          date: "2026-07-30",
          source_quote: "This meeting has been cancelled",
        },
      ],
    });

    assert.deepEqual(writes, [{ op: "cancel", eventId: "evt-july-30" }]);
    assert.equal(
      writes.some((write) => write.op === "insert"),
      false,
    );
  });

  it("adds a new invite after a prior cancellation (Teams cancel then new invite)", () => {
    const afterCancel = planCalendarLifecycle({
      existing: [meeting()],
      cancellations: [{ date: "2026-07-30" }],
    });
    assert.equal(afterCancel[0]?.op, "cancel");

    const afterNewInvite = planCalendarLifecycle({
      existing: [meeting({ status: "cancelled" })],
      meetings: [
        {
          type: "Board",
          date: "2026-08-02",
          time: "19:00",
          source_quote: "Microsoft Teams meeting",
        },
      ],
    });

    assert.equal(afterNewInvite.length, 1);
    assert.equal(afterNewInvite[0]?.op, "insert");
    if (afterNewInvite[0]?.op === "insert") {
      assert.equal(afterNewInvite[0].startAt, "2026-08-02T19:00:00");
      assert.equal(afterNewInvite[0].eventType, "meeting");
      assert.notEqual(afterNewInvite[0].dedupKey.includes("2026-07-30"), true);
    }
  });

  it("moves the same event when one email reschedules Wednesday to Thursday", () => {
    const writes = planCalendarLifecycle({
      existing: [meeting()],
      reschedules: [
        {
          original_date: "2026-07-30",
          original_time: "19:00",
          new_date: "2026-08-02",
          new_time: "19:00",
          type: "Board",
          source_quote: "moved from July 30 to August 2",
        },
      ],
    });

    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.op, "move");
    if (writes[0]?.op === "move") {
      assert.equal(writes[0].eventId, "evt-july-30");
      assert.equal(writes[0].startAt, "2026-08-02T19:00:00");
    }
  });

  it("does not insert a duplicate when reschedule and meetings[] both name the new date", () => {
    const writes = planCalendarLifecycle({
      existing: [meeting()],
      reschedules: [
        {
          original_date: "2026-07-30",
          new_date: "2026-08-02",
          type: "Board",
        },
      ],
      meetings: [{ type: "Board", date: "2026-08-02" }],
    });

    assert.equal(writes.filter((write) => write.op === "move").length, 1);
    assert.equal(writes.filter((write) => write.op === "insert").length, 0);
    assert.equal(writes.filter((write) => write.op === "cancel").length, 0);
  });

  it("treats cancel + new meeting in the same extract as close then add (new id)", () => {
    const writes = planCalendarLifecycle({
      existing: [meeting()],
      cancellations: [{ date: "2026-07-30" }],
      meetings: [{ type: "Board", date: "2026-08-02", time: "19:00" }],
    });

    assert.deepEqual(
      writes.map((write) => write.op),
      ["cancel", "insert"],
    );
    if (writes[1]?.op === "insert") {
      assert.equal(writes[1].startAt, "2026-08-02T19:00:00");
    }
  });

  it("ignores proposed dates when no confirmed meeting/cancel/reschedule arrays are present", () => {
    const writes = planCalendarLifecycle({
      existing: [meeting()],
    });
    assert.deepEqual(writes, []);
  });

  it("does not resurrect a cancelled meeting when inserting a later date", () => {
    const writes = planCalendarLifecycle({
      existing: [meeting({ status: "cancelled" })],
      meetings: [{ type: "Board", date: "2026-08-02" }],
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.op, "insert");
  });

  it("persists dated inspections as calendar occurrences", () => {
    const writes = planCalendarLifecycle({
      existing: [],
      inspections: [
        {
          type: "Fire alarm",
          date: "2026-09-12",
          result: "Passed",
          source_quote: "fire alarm inspection on Sept 12",
        },
      ],
    });
    assert.equal(writes.length, 1);
    if (writes[0]?.op === "insert") {
      assert.equal(writes[0].eventType, "inspection");
      assert.equal(writes[0].title, "Fire alarm inspection");
      assert.equal(writes[0].startAt, "2026-09-12");
    }
  });

  it("keeps dated maintenance as free-text calendar titles without inventing assets", () => {
    const writes = planCalendarLifecycle({
      existing: [],
      maintenanceEvents: [
        {
          equipment: "booster pump",
          action: "Site review visit",
          date: "2026-09-01",
        },
      ],
    });
    assert.equal(writes.length, 1);
    if (writes[0]?.op === "insert") {
      assert.equal(writes[0].eventType, "maintenance");
      assert.equal(writes[0].title, "Site review visit: booster pump");
    }
  });
});

describe("event harvest parse → planCalendarLifecycle", () => {
  it("drops a leaked meetings[] row on a cancelled date so cancel cannot resurrect", () => {
    const extraction = parseEventHighlightJson(
      JSON.stringify({
        meetings: [
          {
            type: "Board",
            date: "2026-07-30",
            source_quote: "This meeting has been cancelled",
          },
        ],
        meeting_cancellations: [
          {
            date: "2026-07-30",
            source_quote: "This meeting has been cancelled",
          },
        ],
      }),
    );

    assert.equal(extraction.meetings.length, 0);
    assert.equal(extraction.meeting_cancellations.length, 1);

    const writes = planCalendarLifecycle({
      existing: [meeting()],
      cancellations: extraction.meeting_cancellations,
      meetings: extraction.meetings,
    });
    assert.deepEqual(writes, [{ op: "cancel", eventId: "evt-july-30" }]);
    assert.equal(
      writes.some((write) => write.op === "insert"),
      false,
    );
  });

  it("treats same-email reschedule as a move, not cancel + insert", () => {
    const extraction = parseEventHighlightJson(
      JSON.stringify({
        meeting_reschedules: [
          {
            original_date: "2026-07-30",
            original_time: "19:00",
            new_date: "2026-08-02",
            new_time: "19:00",
            type: "Board",
            source_quote: "moved from July 30 to August 2",
          },
        ],
        meeting_cancellations: [{ date: "2026-07-30" }],
        meetings: [{ type: "Board", date: "2026-08-02", time: "19:00" }],
      }),
    );

    assert.equal(extraction.meeting_reschedules.length, 1);
    assert.equal(extraction.meeting_cancellations.length, 0);
    assert.equal(extraction.meetings.length, 0);

    const writes = planCalendarLifecycle({
      existing: [meeting()],
      reschedules: extraction.meeting_reschedules,
      cancellations: extraction.meeting_cancellations,
      meetings: extraction.meetings,
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.op, "move");
    if (writes[0]?.op === "move") {
      assert.equal(writes[0].eventId, "evt-july-30");
      assert.equal(writes[0].startAt, "2026-08-02T19:00:00");
    }
  });

  it("keeps cancel + later new invite as close then add (new id)", () => {
    const extraction = parseEventHighlightJson(
      JSON.stringify({
        meeting_cancellations: [{ date: "2026-07-30" }],
        meetings: [{ type: "Board", date: "2026-08-02", time: "19:00" }],
      }),
    );

    assert.equal(extraction.meeting_cancellations.length, 1);
    assert.equal(extraction.meetings.length, 1);

    const writes = planCalendarLifecycle({
      existing: [meeting()],
      cancellations: extraction.meeting_cancellations,
      meetings: extraction.meetings,
    });
    assert.deepEqual(
      writes.map((write) => write.op),
      ["cancel", "insert"],
    );
  });

  it("merges chunked harvest JSON without turning a move into close-then-add", () => {
    const merged = mergeEventHighlightExtractions([
      parseEventHighlightJson(
        JSON.stringify({
          meeting_reschedules: [
            {
              original_date: "2026-07-30",
              new_date: "2026-08-02",
              type: "Board",
            },
          ],
        }),
      ),
      parseEventHighlightJson(
        JSON.stringify({
          meetings: [{ type: "Board", date: "2026-08-02" }],
        }),
      ),
    ]);

    assert.equal(merged.meeting_reschedules.length, 1);
    assert.equal(merged.meetings.length, 0);

    const writes = planCalendarLifecycle({
      existing: [meeting()],
      reschedules: merged.meeting_reschedules,
      meetings: merged.meetings,
    });
    assert.equal(writes.filter((write) => write.op === "move").length, 1);
    assert.equal(writes.filter((write) => write.op === "insert").length, 0);
  });
});

describe("cross-thread / out-of-order harvest apply", () => {
  const invite = {
    meetings: [
      { type: "Board", date: "2026-07-30", time: "19:00" },
    ],
  };
  const cancel = {
    cancellations: [{ date: "2026-07-30" }],
  };
  const reschedule = {
    reschedules: [
      {
        original_date: "2026-07-30",
        original_time: "19:00",
        new_date: "2026-08-02",
        new_time: "19:00",
        type: "Board",
      },
    ],
  };

  function liveOn(events: ExistingCalendarEvent[], date: string) {
    return events.filter(
      (event) =>
        event.status === "scheduled" && eventDateKey(event.startAt) === date,
    );
  }

  it("leaves a ghost meeting when a cancel is applied before the invite exists", () => {
    const reverse = foldCalendarHarvests([], [cancel, invite]);
    assert.equal(liveOn(reverse, "2026-07-30").length, 1);
  });

  it("rebuild in receivedAt order closes that cancel", () => {
    const rebuilt = foldCalendarHarvests([], [invite, cancel]);
    assert.equal(liveOn(rebuilt, "2026-07-30").length, 0);
  });

  it("replay mutations after reverse persist closes the ghost invite", () => {
    const dirty = foldCalendarHarvests([], [cancel, invite]);
    const replayed = replayCalendarLifecycleMutations(dirty, [invite, cancel]);
    assert.equal(liveOn(replayed, "2026-07-30").length, 0);
  });

  it("replay reschedule after reverse persist plus collapse leaves one meeting on the new date", () => {
    const dirty = foldCalendarHarvests([], [reschedule, invite]);
    assert.equal(liveOn(dirty, "2026-07-30").length, 1);
    assert.equal(liveOn(dirty, "2026-08-02").length, 1);

    const replayed = replayCalendarLifecycleMutations(dirty, [
      invite,
      reschedule,
    ]);
    const collapsed = applyCalendarWritesToState(
      replayed,
      collapseDuplicateScheduledMeetings(replayed),
    );
    const live = collapsed.filter((event) => event.status === "scheduled");
    assert.equal(live.length, 1);
    assert.equal(eventDateKey(live[0]!.startAt), "2026-08-02");
  });
});
