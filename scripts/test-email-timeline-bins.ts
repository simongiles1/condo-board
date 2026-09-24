import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyMonthlyRollingAverage,
  applyMonthlyRollingAverageMulti,
  binEmailsByTime,
  binEmailsByTimeMulti,
  messageMatchesTimelineSender,
} from "@/lib/email/timeline-bins";

describe("messageMatchesTimelineSender", () => {
  it("matches from and cc case-insensitively", () => {
    assert.equal(
      messageMatchesTimelineSender(
        "Bonnie Kafi <BKAFI@iccpropertymanagement.com>",
        "[]",
        "bkafi@iccpropertymanagement.com",
      ),
      true,
    );
    assert.equal(
      messageMatchesTimelineSender(
        "other@example.com",
        '["studiopm@iccpropertymanagement.com"]',
        "studiopm@iccpropertymanagement.com",
      ),
      true,
    );
    assert.equal(
      messageMatchesTimelineSender("a@b.com", "[]", "c@d.com"),
      false,
    );
  });
});

describe("monthly rolling average", () => {
  it("averages trailing monthly counts", () => {
    const monthly = [
      { key: "2024-01", label: "Jan 2024", count: 10 },
      { key: "2024-02", label: "Feb 2024", count: 20 },
      { key: "2024-03", label: "Mar 2024", count: 30 },
    ];
    const averaged = applyMonthlyRollingAverage(monthly, 2);
    assert.equal(averaged[0]?.count, 10);
    assert.equal(averaged[1]?.count, 15);
    assert.equal(averaged[2]?.count, 25);
  });

  it("is applied via month_avg_3 bin size", () => {
    const bins = binEmailsByTime(
      [
        "2024-01-15T12:00:00.000Z",
        "2024-02-10T12:00:00.000Z",
        "2024-02-20T12:00:00.000Z",
        "2024-03-05T12:00:00.000Z",
      ],
      "month_avg_3",
    );
    assert.equal(bins.length, 3);
    assert.equal(bins[0]?.count, 1);
    assert.equal(bins[1]?.count, 1.5);
    assert.equal(bins[2]?.count, 4 / 3);
  });

  it("averages each sender series in multi bins", () => {
    const bins = applyMonthlyRollingAverageMulti(
      [
        {
          key: "2024-01",
          label: "Jan",
          count: 4,
          bySenderId: { bonnie: 3, haider: 1 },
        },
        {
          key: "2024-02",
          label: "Feb",
          count: 2,
          bySenderId: { bonnie: 2, haider: 0 },
        },
      ],
      2,
    );
    assert.equal(bins[1]?.bySenderId.bonnie, 2.5);
    assert.equal(bins[1]?.bySenderId.haider, 0.5);
  });
});

describe("binEmailsByTimeMulti", () => {
  it("keeps distinct message count separate from per-sender slices", () => {
    const bins = binEmailsByTimeMulti(
      [
        {
          receivedAt: "2024-06-03T12:00:00.000Z",
          senderIds: ["bonnie", "haider"],
        },
        {
          receivedAt: "2024-06-03T15:00:00.000Z",
          senderIds: ["bonnie"],
        },
      ],
      "week",
    );

    assert.equal(bins.length, 1);
    assert.equal(bins[0]?.count, 2);
    assert.equal(bins[0]?.bySenderId.bonnie, 2);
    assert.equal(bins[0]?.bySenderId.haider, 1);
  });
});
