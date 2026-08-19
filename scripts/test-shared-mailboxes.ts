/**
 * Shared-mailbox grouping and occupancy timeline tests.
 * Run: npx tsx --test scripts/test-shared-mailboxes.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSharedMailboxes,
  formatOccupancyRange,
  occupancyBarPercent,
  occupancyTimelineBounds,
  sharedMailboxStats,
  type SharedMailboxPersonInfo,
} from "../lib/contacts/shared-mailboxes";

function person(
  partial: Partial<SharedMailboxPersonInfo> & { id: string },
): SharedMailboxPersonInfo {
  return {
    firstName: null,
    lastName: null,
    sparseStub: false,
    mentionWeight: 0,
    currentOrganizationName: null,
    ...partial,
  };
}

describe("buildSharedMailboxes", () => {
  it("keeps addresses with two or more people and drops exclusive mailboxes", () => {
    const persons = new Map([
      ["a", person({ id: "a", firstName: "Bonnie", lastName: "Kafi" })],
      ["b", person({ id: "b", firstName: "Haider", lastName: "Mukadam" })],
      ["c", person({ id: "c", firstName: "Solo", lastName: "User" })],
    ]);
    const mailboxes = buildSharedMailboxes(
      [
        {
          email: "studiopm@iccpropertymanagement.com",
          personId: "a",
          validFrom: "2020-01-01",
          validTo: "2024-08-01",
        },
        {
          email: "studiopm@iccpropertymanagement.com",
          personId: "b",
          validFrom: "2024-08-01",
          validTo: null,
        },
        {
          email: "solo@example.com",
          personId: "c",
          validFrom: "2023-01-01",
          validTo: null,
        },
      ],
      persons,
    );

    assert.equal(mailboxes.length, 1);
    assert.equal(mailboxes[0]!.email, "studiopm@iccpropertymanagement.com");
    assert.equal(mailboxes[0]!.occupantCount, 2);
    assert.equal(mailboxes[0]!.currentPersonName, "Haider Mukadam");
    assert.equal(mailboxes[0]!.occupants[0]!.personName, "Bonnie Kafi");
    assert.equal(mailboxes[0]!.occupants[0]!.isCurrent, false);
    assert.equal(mailboxes[0]!.occupants[1]!.personName, "Haider Mukadam");
    assert.equal(mailboxes[0]!.occupants[1]!.isCurrent, true);
  });

  it("collapses multiple occupancy rows for the same person into one occupant", () => {
    const persons = new Map([
      ["a", person({ id: "a", firstName: "Bonnie" })],
      ["b", person({ id: "b", firstName: "Haider" })],
    ]);
    const mailboxes = buildSharedMailboxes(
      [
        {
          email: "desk@example.com",
          personId: "a",
          validFrom: "2020-01-01",
          validTo: "2021-01-01",
          evidenceJson: '[{"emailId":"e1","receivedAt":"2020-06-01"}]',
        },
        {
          email: "desk@example.com",
          personId: "a",
          validFrom: "2023-01-01",
          validTo: "2023-06-01",
          evidenceJson: "[]",
        },
        {
          email: "desk@example.com",
          personId: "b",
          validFrom: "2024-01-01",
          validTo: null,
        },
      ],
      persons,
    );

    assert.equal(mailboxes[0]!.occupantCount, 2);
    const bonnie = mailboxes[0]!.occupants.find((o) => o.personId === "a");
    assert.ok(bonnie);
    assert.equal(bonnie.ranges.length, 2);
    assert.equal(bonnie.ranges[0]!.evidenceCount, 1);
    assert.equal(bonnie.ranges[1]!.validFrom, "2023-01-01");
  });

  it("normalizes email casing when grouping occupants", () => {
    const persons = new Map([
      ["a", person({ id: "a", firstName: "Ann" })],
      ["b", person({ id: "b", firstName: "Ben" })],
    ]);
    const mailboxes = buildSharedMailboxes(
      [
        {
          email: "Desk@Example.com",
          personId: "a",
          validFrom: "2020-01-01",
          validTo: "2021-01-01",
        },
        {
          email: "desk@example.com",
          personId: "b",
          validFrom: "2021-01-01",
          validTo: null,
        },
      ],
      persons,
    );
    assert.equal(mailboxes.length, 1);
    assert.equal(mailboxes[0]!.email, "desk@example.com");
    assert.equal(mailboxes[0]!.occupantCount, 2);
  });

  it("counts unique people across mailboxes for stats", () => {
    const persons = new Map([
      ["a", person({ id: "a", firstName: "Ann" })],
      ["b", person({ id: "b", firstName: "Ben" })],
      ["c", person({ id: "c", firstName: "Cam" })],
    ]);
    const mailboxes = buildSharedMailboxes(
      [
        {
          email: "one@example.com",
          personId: "a",
          validFrom: "2020-01-01",
          validTo: "2021-01-01",
        },
        {
          email: "one@example.com",
          personId: "b",
          validFrom: "2021-01-01",
          validTo: null,
        },
        {
          email: "two@example.com",
          personId: "b",
          validFrom: "2022-01-01",
          validTo: "2023-01-01",
        },
        {
          email: "two@example.com",
          personId: "c",
          validFrom: "2023-01-01",
          validTo: null,
        },
      ],
      persons,
    );
    assert.deepEqual(sharedMailboxStats(mailboxes), {
      mailboxCount: 2,
      occupantCount: 3,
    });
  });
});

describe("occupancy timeline", () => {
  it("formats closed and open-ended ranges", () => {
    assert.equal(formatOccupancyRange("2020-01-15T12:00:00.000Z", "2024-08-01"), "2020-01-15 → 2024-08-01");
    assert.equal(formatOccupancyRange("2024-08-01", null), "2024-08-01 → present");
    assert.equal(formatOccupancyRange(null, null), "unknown dates");
  });

  it("places successive occupants on a shared axis without overlap", () => {
    const nowMs = Date.parse("2024-01-01T00:00:00.000Z");
    const bounds = occupancyTimelineBounds(
      [
        { validFrom: "2020-01-01T00:00:00.000Z", validTo: "2022-01-01T00:00:00.000Z", evidenceCount: 1 },
        { validFrom: "2022-01-01T00:00:00.000Z", validTo: "2024-01-01T00:00:00.000Z", evidenceCount: 1 },
      ],
      nowMs,
    );
    assert.ok(bounds);
    const first = occupancyBarPercent(
      "2020-01-01T00:00:00.000Z",
      "2022-01-01T00:00:00.000Z",
      bounds,
      nowMs,
    );
    const second = occupancyBarPercent(
      "2022-01-01T00:00:00.000Z",
      "2024-01-01T00:00:00.000Z",
      bounds,
      nowMs,
    );
    assert.equal(Math.round(first.left), 0);
    assert.equal(Math.round(first.width), 50);
    assert.equal(Math.round(second.left), 50);
    assert.equal(Math.round(second.width), 50);
  });

  it("extends an open-ended current occupant to now", () => {
    const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const bounds = occupancyTimelineBounds(
      [
        { validFrom: "2024-01-01T00:00:00.000Z", validTo: "2025-01-01T00:00:00.000Z", evidenceCount: 1 },
        { validFrom: "2025-01-01T00:00:00.000Z", validTo: null, evidenceCount: 1 },
      ],
      nowMs,
    );
    assert.ok(bounds);
    assert.equal(bounds.endMs, nowMs);
    const current = occupancyBarPercent(
      "2025-01-01T00:00:00.000Z",
      null,
      bounds,
      nowMs,
    );
    assert.ok(current.left > 40);
    assert.ok(current.left + current.width > 99);
  });
});
