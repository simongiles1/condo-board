/**
 * GitHub-style extraction calendar grid (Sunday–Saturday weeks, Toronto dates).
 * Run: npx tsx --test scripts/test-extraction-calendar.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aggregateExtractionDays,
  buildExtractionCalendar,
  conceptSliverLevel,
  conceptSliverPaint,
  listExtractionCalendarYears,
  resolveExtractionCalendarYear,
  torontoDateKey,
  type EmailExtractionRow,
} from "../lib/email/extraction-calendar";

function email(
  receivedAt: string,
  overrides: Partial<EmailExtractionRow> = {},
): EmailExtractionRow {
  return {
    receivedAt,
    hasEligibleAttachment: false,
    attachmentsExtracted: false,
    contactExtracted: false,
    organizationExtracted: false,
    projectExtracted: false,
    eventExtracted: false,
    todoExtracted: false,
    ...overrides,
  };
}

describe("torontoDateKey", () => {
  it("maps a winter afternoon UTC instant to the Toronto calendar day", () => {
    assert.equal(torontoDateKey("2026-01-15T18:00:00.000Z"), "2026-01-15");
  });

  it("rolls back across midnight Eastern", () => {
    assert.equal(torontoDateKey("2026-01-16T03:00:00.000Z"), "2026-01-15");
  });
});

describe("buildExtractionCalendar", () => {
  it("pads 2026 to Sunday–Saturday weeks including Dec 28 2025", () => {
    const calendar = buildExtractionCalendar([], 2026, "2026-08-15");
    const firstDay = calendar.weeks[0]?.days[0];
    const lastDay = calendar.weeks.at(-1)?.days.at(-1);

    assert.equal(firstDay?.date, "2025-12-28");
    assert.equal(firstDay?.inYear, false);
    assert.equal(lastDay?.date, "2027-01-02");
    assert.equal(lastDay?.inYear, false);
    assert.ok(calendar.weeks.every((week) => week.days.length === 7));
    assert.equal(calendar.weeks[0]?.monthLabel, "Jan");
  });

  it("aggregates same-day emails and ignores out-of-year padding", () => {
    const calendar = buildExtractionCalendar(
      [
        email("2026-03-12T15:00:00.000Z", {
          contactExtracted: true,
          todoExtracted: true,
        }),
        email("2026-03-12T18:00:00.000Z", {
          hasEligibleAttachment: true,
          attachmentsExtracted: false,
        }),
        email("2025-12-30T15:00:00.000Z", { contactExtracted: true }),
      ],
      2026,
      "2026-08-15",
    );

    const mar12 = calendar.weeks
      .flatMap((week) => week.days)
      .find((day) => day.date === "2026-03-12");

    assert.equal(mar12?.emailCount, 2);
    assert.equal(mar12?.concepts.attachment.eligible, 1);
    assert.equal(mar12?.concepts.attachment.extracted, 0);
    assert.equal(mar12?.concepts.contact.extracted, 1);
    assert.equal(mar12?.concepts.equipment.eligible, 2);
    assert.equal(mar12?.concepts.equipment.extracted, 0);
    assert.equal(mar12?.concepts.todo.extracted, 1);

    assert.equal(calendar.totalEmails, 2);
    assert.equal(calendar.totals.contact.extracted, 1);
    assert.equal(calendar.weeks[0]?.days[2]?.date, "2025-12-30");
    assert.equal(calendar.weeks[0]?.days[2]?.emailCount, 0);
  });

  it("labels the week that contains the first of the month", () => {
    const calendar = buildExtractionCalendar([], 2026, "2026-08-15");
    const labeled = calendar.weeks
      .filter((week) => week.monthLabel)
      .map((week) => week.monthLabel);

    assert.deepEqual(labeled, [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]);
  });
});

describe("aggregateExtractionDays", () => {
  it("does not mark emails without valued attachments as attachment-eligible", () => {
    const days = aggregateExtractionDays([
      email("2026-04-01T16:00:00.000Z", { hasEligibleAttachment: false }),
    ]);
    const day = days.get("2026-04-01");
    assert.equal(day?.concepts.attachment.eligible, 0);
    assert.equal(day?.emailCount, 1);
  });
});

describe("conceptSliverLevel", () => {
  it("keeps unimplemented lanes disabled even when emails exist", () => {
    assert.equal(
      conceptSliverLevel("equipment", { eligible: 4, extracted: 0 }),
      "disabled",
    );
    assert.equal(
      conceptSliverLevel("todo", { eligible: 4, extracted: 0 }),
      "none",
    );
  });

  it("uses coverage ratio for implemented lanes", () => {
    assert.equal(conceptSliverLevel("contact", { eligible: 0, extracted: 0 }), "empty");
    assert.equal(conceptSliverLevel("contact", { eligible: 2, extracted: 0 }), "none");
    assert.equal(conceptSliverLevel("contact", { eligible: 4, extracted: 1 }), "low");
    assert.equal(conceptSliverLevel("contact", { eligible: 4, extracted: 2 }), "mid");
    assert.equal(conceptSliverLevel("contact", { eligible: 4, extracted: 4 }), "full");
  });
});

describe("conceptSliverPaint", () => {
  it("hides unfinished work until show-missing is on", () => {
    assert.equal(
      conceptSliverPaint("attachment", { eligible: 2, extracted: 0 }, false),
      "empty",
    );
    assert.equal(
      conceptSliverPaint("attachment", { eligible: 2, extracted: 0 }, true),
      "full",
    );
  });

  it("in show-missing, keeps lane colors and hides completed coverage", () => {
    assert.equal(
      conceptSliverPaint("contact", { eligible: 4, extracted: 4 }, true),
      "empty",
    );
    assert.equal(
      conceptSliverPaint("event", { eligible: 4, extracted: 0 }, true),
      "full",
    );
    assert.equal(
      conceptSliverPaint("attachment", { eligible: 4, extracted: 1 }, true),
      "mid",
    );
    assert.equal(
      conceptSliverPaint("contact", { eligible: 4, extracted: 2 }, false),
      "mid",
    );
  });

  it("never treats a day with nothing to extract as missing", () => {
    assert.equal(
      conceptSliverPaint("attachment", { eligible: 0, extracted: 0 }, true),
      "empty",
    );
    assert.equal(
      conceptSliverPaint("equipment", { eligible: 4, extracted: 0 }, true),
      "disabled",
    );
  });
});

describe("year helpers", () => {
  it("lists years newest first and prefers today when present", () => {
    const years = listExtractionCalendarYears([
      "2024-06-01T12:00:00.000Z",
      "2026-01-02T12:00:00.000Z",
      "2025-12-01T12:00:00.000Z",
    ]);
    assert.deepEqual(years, [2026, 2025, 2024]);
    assert.equal(resolveExtractionCalendarYear(years, null, 2026), 2026);
    assert.equal(resolveExtractionCalendarYear(years, 2024, 2026), 2024);
    assert.equal(resolveExtractionCalendarYear(years, 1999, 2026), 2026);
  });
});
