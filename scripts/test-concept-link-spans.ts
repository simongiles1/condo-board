/**
 * Wikipedia-style concept link spans: stored entity names in free text.
 * Run: npx tsx --test scripts/test-concept-link-spans.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildConceptMatcher,
  calendarEventConceptAliases,
  conceptsUsedInTexts,
  findConceptLinkSpans,
  type LinkedConcept,
} from "../lib/entities/concept-links";

function concept(partial: Omit<LinkedConcept, "aliases"> & { aliases: string[] }): LinkedConcept {
  return partial;
}

function matchedText(
  text: string,
  concepts: LinkedConcept[],
  todayKey = "2026-08-15",
) {
  const matcher = buildConceptMatcher(concepts, { todayKey });
  return findConceptLinkSpans(text, matcher).map((span) => ({
    text: text.slice(span.start, span.end),
    ids: span.conceptIds,
    kind: span.kind,
  }));
}

const joseph = concept({
  id: "person-joseph",
  kind: "person",
  displayName: "Joseph",
  aliases: ["Joseph"],
});

const tcg = concept({
  id: "org-tcg",
  kind: "organization",
  displayName: "TCG",
  aliases: ["TCG"],
});

const ast = concept({
  id: "org-ast",
  kind: "organization",
  displayName: "Applied System Technology",
  aliases: ["Applied System Technology", "AST"],
});

const pump = concept({
  id: "eq-p12a",
  kind: "equipment",
  displayName: "DHW Pump P-12A",
  aliases: ["DHW Pump P-12A", "P-12A"],
});

describe("findConceptLinkSpans", () => {
  it("highlights a stored person's name", () => {
    const text =
      "Review the legal opinion response from Joseph regarding the reserve fund";
    const hits = matchedText(text, [joseph]);
    assert.deepEqual(hits, [
      { text: "Joseph", ids: ["person-joseph"], kind: "person" },
    ]);
  });

  it("highlights organization names and acronyms", () => {
    const text =
      "Return to the site together with TCG to complete work with Applied System Technology";
    const hits = matchedText(text, [tcg, ast]);
    assert.deepEqual(
      hits.map((hit) => hit.text),
      ["TCG", "Applied System Technology"],
    );
  });

  it("keeps the longest match when aliases overlap", () => {
    const system = concept({
      id: "org-system",
      kind: "organization",
      displayName: "System",
      aliases: ["System"],
    });
    const text = "Call Applied System Technology tomorrow.";
    const hits = matchedText(text, [ast, system]);
    assert.deepEqual(
      hits.map((hit) => hit.text),
      ["Applied System Technology"],
    );
  });

  it("does not match a name inside a longer word", () => {
    const ann = concept({
      id: "person-ann",
      kind: "person",
      displayName: "Ann",
      aliases: ["Ann"],
    });
    const hits = matchedText("Annual inspection for Ann.", [ann]);
    assert.deepEqual(
      hits.map((hit) => hit.text),
      ["Ann"],
    );
  });

  it("matches hyphenated equipment ids", () => {
    const text = "Quote for replacement of the DHW Pump P-12A motor";
    const hits = matchedText(text, [pump]);
    assert.deepEqual(
      hits.map((hit) => hit.text),
      ["DHW Pump P-12A"],
    );
  });

  it("matches an alias at a possessive boundary", () => {
    const hits = matchedText("Review TCG's piping recommendation.", [tcg]);
    assert.deepEqual(
      hits.map((hit) => hit.text),
      ["TCG"],
    );
  });

  it("matches flexible whitespace in multi-word names", () => {
    const hits = matchedText(
      "Call Applied System  Technology tomorrow.",
      [ast],
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.ids[0], "org-ast");
  });

  it("stacks every stored person who shares the same alias", () => {
    const josephLee = concept({
      id: "person-joseph-lee",
      kind: "person",
      displayName: "Joseph Lee",
      aliases: ["Joseph", "Joseph Lee"],
    });
    const hits = matchedText("Ask Joseph for the opinion.", [joseph, josephLee]);
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0]!.ids.sort(), ["person-joseph", "person-joseph-lee"]);
  });

  it("skips stopwords and tiny aliases even if they are on the card", () => {
    const noisy = concept({
      id: "org-board",
      kind: "organization",
      displayName: "Board of Directors",
      aliases: ["Board of Directors", "Board", "Email", "to", "AB"],
    });
    const text = "Email the Board of Directors to review this.";
    const hits = matchedText(text, [noisy]);
    assert.deepEqual(
      hits.map((hit) => hit.text),
      ["Board of Directors"],
    );
  });

  it("filters the catalog to concepts that appear in the given texts", () => {
    const used = conceptsUsedInTexts(
      ["Ask Joseph to call TCG."],
      [joseph, tcg, ast, pump],
    );
    assert.deepEqual(
      used.map((item) => item.id).sort(),
      ["org-tcg", "person-joseph"],
    );
  });
});

const june30Meeting = concept({
  id: "evt-june-30",
  kind: "event",
  displayName: "Board meeting",
  aliases: calendarEventConceptAliases("Board meeting", "2026-06-30"),
  event: {
    title: "Board meeting",
    eventType: "meeting",
    startAt: "2026-06-30",
    description: null,
  },
});

const june30Meeting2025 = concept({
  id: "evt-june-30-2025",
  kind: "event",
  displayName: "Board meeting",
  aliases: calendarEventConceptAliases("Board meeting", "2025-06-30"),
  event: {
    title: "Board meeting",
    eventType: "meeting",
    startAt: "2025-06-30",
    description: null,
  },
});

const june23Meeting = concept({
  id: "evt-june-23",
  kind: "event",
  displayName: "Board meeting",
  aliases: calendarEventConceptAliases("Board meeting", "2026-06-23"),
  event: {
    title: "Board meeting",
    eventType: "meeting",
    startAt: "2026-06-23",
    description: null,
  },
});

describe("calendarEventConceptAliases", () => {
  it("pairs the event date with the title, including ordinals and year", () => {
    const aliases = calendarEventConceptAliases("Board meeting", "2026-06-30");
    for (const expected of [
      "June 30 Board meeting",
      "June 30th Board meeting",
      "June 30, 2026 Board meeting",
      "June 30th, 2026 Board meeting",
      "June 30, 2026, Board meeting",
      "Board meeting on June 30",
    ]) {
      assert.ok(
        aliases.includes(expected),
        `missing alias ${JSON.stringify(expected)}`,
      );
    }
  });

  it("also aliases a parenthetical-stripped title", () => {
    const aliases = calendarEventConceptAliases(
      "Board meeting (pump 12A approved)",
      "2026-06-30",
    );
    assert.ok(aliases.includes("June 30 Board meeting"));
    assert.ok(aliases.includes("June 30 Board meeting (pump 12A approved)"));
  });
});

describe("findConceptLinkSpans calendar events", () => {
  it("highlights a dated board-meeting phrase in a harvested to-do", () => {
    const text =
      "Provide update on steps taken to address noise/vibration issues since the June 30 board meeting";
    const hits = matchedText(text, [june30Meeting, june23Meeting]);
    assert.deepEqual(hits, [
      {
        text: "June 30 board meeting",
        ids: ["evt-june-30"],
        kind: "event",
      },
    ]);
  });

  it("does not treat a bare board meeting as a specific calendar row", () => {
    const hits = matchedText(
      "Provide an update since the board meeting regarding the noise concerns",
      [june30Meeting, june23Meeting],
    );
    assert.deepEqual(hits, []);
  });

  it("keeps June 23 and June 30 meetings distinct", () => {
    const text =
      "Follow up from the June 23 board meeting before the June 30th board meeting";
    const hits = matchedText(text, [june30Meeting, june23Meeting]);
    assert.deepEqual(
      hits.map((hit) => ({ text: hit.text, ids: hit.ids })),
      [
        { text: "June 23 board meeting", ids: ["evt-june-23"] },
        { text: "June 30th board meeting", ids: ["evt-june-30"] },
      ],
    );
  });

  it("yearless June 30 board meeting resolves to the most recent past year, not every annual repeat", () => {
    const text =
      "Provide update on steps taken to address noise/vibration issues since the June 30 board meeting";
    const hits = matchedText(text, [june30Meeting, june30Meeting2025]);
    assert.deepEqual(hits, [
      {
        text: "June 30 board meeting",
        ids: ["evt-june-30"],
        kind: "event",
      },
    ]);
  });

  it("still links a year-qualified phrase to that year's meeting", () => {
    const hits = matchedText(
      "Follow up from the June 30, 2025 board meeting",
      [june30Meeting, june30Meeting2025],
    );
    assert.deepEqual(hits, [
      {
        text: "June 30, 2025 board meeting",
        ids: ["evt-june-30-2025"],
        kind: "event",
      },
    ]);
  });

  it("still stacks two meetings on the same calendar day", () => {
    const duplicate = concept({
      id: "evt-june-30-dup",
      kind: "event",
      displayName: "Board meeting",
      aliases: calendarEventConceptAliases("Board meeting", "2026-06-30"),
      event: {
        title: "Board meeting",
        eventType: "meeting",
        startAt: "2026-06-30",
        description: null,
      },
    });
    const hits = matchedText(
      "Follow up from the June 30 board meeting",
      [june30Meeting, duplicate],
    );
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0]!.ids.sort(), ["evt-june-30", "evt-june-30-dup"]);
  });
});
