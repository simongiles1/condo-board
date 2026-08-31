/**
 * Contact mention queue grouping tests.
 * Run: npx tsx --test scripts/test-contact-mention-queue.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMentionQueueGroups,
  extractMentionContextSnippet,
  filterAttachMentionIds,
  formatToLinePreview,
  mentionQueueGroupId,
  mentionQueueGroupRef,
  parseMentionQueueGroupId,
  pickRichestMentionCard,
  rowsForMentionQueueView,
  type MentionQueueRow,
} from "../lib/contacts/mention-queue-shared";

function row(
  partial: Partial<MentionQueueRow> & { id: string },
): MentionQueueRow {
  return {
    firstName: "Dan",
    lastName: null,
    email: null,
    phone: null,
    rawCompany: null,
    jobTitle: null,
    rolePhrase: null,
    mentionKind: "referred",
    firstNameKey: "dan",
    firstOrgKey: null,
    fingerprint: `fp-${partial.id}`,
    resolutionStatus: "unresolved",
    resolutionReason: "insufficient",
    resolvedPersonId: null,
    sourceEmailId: `email-${partial.id}`,
    threadId: "thread-1",
    subject: "Hello",
    receivedAt: "2026-01-01T00:00:00.000Z",
    fromAddress: "a@example.com",
    toAddresses: "[]",
    contextSnippet: null,
    ...partial,
  };
}

describe("mentionQueueGroupRef", () => {
  it("prefers first+org over first name", () => {
    const ref = mentionQueueGroupRef(
      row({
        id: "1",
        firstOrgKey: "dan|xyz consulting",
        rawCompany: "XYZ Consulting",
      }),
    );
    assert.deepEqual(ref, { kind: "first_org", key: "dan|xyz consulting" });
    assert.equal(parseMentionQueueGroupId(mentionQueueGroupId(ref))?.key, ref.key);
  });

  it("prefers first+last over first+org so full names leave the first-name pile", () => {
    const ref = mentionQueueGroupRef(
      row({
        id: "orm",
        firstName: "John P.",
        lastName: "Ormstrom",
        firstNameKey: "john p",
        firstOrgKey: "john p|lash law",
        rawCompany: "Lash Law",
      }),
    );
    assert.deepEqual(ref, { kind: "first_last", key: "john|ormstrom" });
  });

  it("falls back to first name when company is missing", () => {
    const ref = mentionQueueGroupRef(row({ id: "2" }));
    assert.deepEqual(ref, { kind: "first_name", key: "dan" });
  });
});

describe("formatToLinePreview", () => {
  it("shows a crowded To-line with overflow", () => {
    const json = JSON.stringify([
      "Dan One <dan1@example.com>",
      "Dan Two <dan2@example.com>",
      "Dan Three <dan3@example.com>",
      "Dan Four <dan4@example.com>",
    ]);
    assert.equal(formatToLinePreview(json), "Dan One, Dan Two, Dan Three +1");
  });
});

describe("buildMentionQueueGroups", () => {
  it("clusters first+org separately from first-name-only Dans", () => {
    const groups = buildMentionQueueGroups(
      [
        row({
          id: "a",
          firstOrgKey: "dan|xyz",
          rawCompany: "XYZ",
          receivedAt: "2026-02-01T00:00:00.000Z",
        }),
        row({
          id: "b",
          firstOrgKey: "dan|xyz",
          rawCompany: "XYZ",
          sourceEmailId: "email-b",
        }),
        row({ id: "c", firstNameKey: "dan" }),
      ],
      [
        {
          id: "person-dan",
          firstName: "Dan",
          displayName: "Dan Miller",
          sourceEmailCount: 40,
          currentOrganizationName: "XYZ",
        },
      ],
    );

    assert.equal(groups.length, 2);
    const org = groups.find((g) => g.kind === "first_org");
    const first = groups.find((g) => g.kind === "first_name");
    assert.ok(org);
    assert.ok(first);
    assert.equal(org.mentionCount, 2);
    assert.equal(org.emailCount, 2);
    assert.equal(org.label.includes("XYZ"), true);
    assert.equal(org.candidates[0]?.displayName, "Dan Miller");
    assert.equal(first.mentionCount, 1);
    assert.equal(org.samples[0]?.mentionId, "a");
    assert.equal(org.samples[0]?.resolutionReason, "insufficient");
    assert.equal(org.samples[0]?.rolePhrase, null);
  });

  it("copies role_phrase and resolution_reason onto samples", () => {
    const groups = buildMentionQueueGroups([
      row({
        id: "haider",
        firstName: "Haider",
        lastName: "Mukadam",
        jobTitle: "Property Manager",
        rolePhrase: "property manager",
        resolutionReason: "unique_first_plus_org_provisional",
        firstNameKey: "haider",
      }),
    ]);
    const sample = groups[0]?.samples[0];
    assert.equal(sample?.rolePhrase, "property manager");
    assert.equal(sample?.resolutionReason, "unique_first_plus_org_provisional");
  });

  it("keeps full-name Johns out of the first-name-only bucket", () => {
    const groups = buildMentionQueueGroups([
      row({
        id: "full",
        firstName: "John",
        lastName: "Ormstrom",
        firstNameKey: "john",
      }),
      row({
        id: "bare",
        firstName: "John",
        lastName: null,
        firstNameKey: "john",
      }),
    ]);
    assert.equal(groups.length, 2);
    const full = groups.find((g) => g.kind === "first_last");
    const first = groups.find((g) => g.kind === "first_name");
    assert.ok(full);
    assert.ok(first);
    assert.equal(full.label, "John Ormstrom");
    assert.equal(full.mentionCount, 1);
    assert.equal(first.mentionCount, 1);
    assert.equal(
      rowsForMentionQueueView(
        [
          row({
            id: "full",
            firstName: "John",
            lastName: "Ormstrom",
          }),
          row({ id: "bare", firstName: "John", lastName: null }),
        ],
        "full_name",
      ).map((r) => r.id).join(),
      "full",
    );
    assert.equal(
      rowsForMentionQueueView(
        [
          row({
            id: "full",
            firstName: "John",
            lastName: "Ormstrom",
          }),
          row({ id: "bare", firstName: "John", lastName: null }),
        ],
        "unresolved",
      ).map((r) => r.id).join(),
      "bare",
    );
  });

  it("keeps every mention as a sample so the review list is complete", () => {
    const groups = buildMentionQueueGroups(
      Array.from({ length: 9 }, (_, index) =>
        row({
          id: String(index),
          contextSnippet: `Please ask Dan about item ${index}.`,
        }),
      ),
    );
    assert.equal(groups[0]?.samples.length, 9);
    assert.equal(groups[0]?.samples[0]?.contextSnippet?.includes("Dan"), true);
  });
});

describe("extractMentionContextSnippet", () => {
  it("keeps 100 characters before and after a whole-name match", () => {
    const before = "x".repeat(120);
    const after = "y".repeat(120);
    const snippet = extractMentionContextSnippet(
      `${before} Please ask Judy about the pump ${after}`,
      ["Judy"],
    );
    assert.ok(snippet);
    assert.equal(snippet.startsWith("…"), true);
    assert.equal(snippet.endsWith("…"), true);
    assert.equal(snippet.includes("Please ask Judy about the pump"), true);
    const judyAt = snippet.indexOf("Judy");
    const beforeMatch = snippet.slice(snippet.startsWith("…") ? 1 : 0, judyAt);
    const afterMatch = snippet.slice(judyAt + "Judy".length, snippet.endsWith("…") ? -1 : undefined);
    assert.equal(beforeMatch.length, 100);
    assert.equal(afterMatch.length, 100);
  });

  it("prefers a longer full-name match over the first name alone", () => {
    const gap = "later ".repeat(30);
    const snippet = extractMentionContextSnippet(
      `Call Judy today. ${gap}Judy Statham confirmed the quote.`,
      ["Judy Statham", "Judy"],
    );
    assert.equal(snippet?.includes("Judy Statham confirmed"), true);
    assert.equal(snippet?.includes("Call Judy today"), false);
  });

  it("does not take a name that is only a prefix of a longer word", () => {
    assert.equal(extractMentionContextSnippet("Annual meeting agenda", ["Ann"]), null);
  });
});

describe("filterAttachMentionIds", () => {
  it("keeps the whole group when no subset is requested", () => {
    assert.deepEqual(filterAttachMentionIds(["a", "b", "c"], undefined), [
      "a",
      "b",
      "c",
    ]);
  });

  it("intersects requested ids with the group", () => {
    assert.deepEqual(filterAttachMentionIds(["a", "b", "c"], ["b", "z", "a"]), [
      "a",
      "b",
    ]);
  });
});

describe("pickRichestMentionCard", () => {
  it("prefers a mention that already has an email", () => {
    const card = pickRichestMentionCard([
      {
        firstName: "John",
        lastName: "Ormstrom",
        email: null,
        phone: null,
        jobTitle: "Counsel",
        rawCompany: "OLF",
      },
      {
        firstName: "John",
        lastName: "Ormstrom",
        email: "jormston@olflaw.com",
        phone: null,
        jobTitle: null,
        rawCompany: null,
      },
    ]);
    assert.equal(card?.email, "jormston@olflaw.com");
  });
});
