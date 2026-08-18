/**
 * Contact evidence + weak mailbox-stub helpers.
 * Run: npx tsx --test scripts/test-contact-evidence.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyAttributeEvidenceMatch,
  classifyPersonEvidenceMatch,
  evidenceMessageMatchesAttribute,
  evidenceMessageMatchesPerson,
  evidenceMessageMatchesPersonOrAttributes,
} from "../lib/contacts/registry-evidence";
import {
  bodyPreviewAroundMention,
  hasContentMatch,
  isParticipationMatchReason,
} from "../lib/contacts/registry-evidence-shared";
import {
  isNamelessPerson,
  isWeakNameVariantOf,
  parseIncomingCardSourceEmailIds,
  planMailboxIdentityMerges,
} from "../lib/contacts/registry-shared";

describe("parseIncomingCardSourceEmailIds", () => {
  it("reads sourceEmailIds from stored incoming cards", () => {
    assert.deepEqual(
      parseIncomingCardSourceEmailIds(
        JSON.stringify({ sourceEmailIds: ["a", "b", ""] }),
      ),
      ["a", "b"],
    );
    assert.deepEqual(parseIncomingCardSourceEmailIds("not json"), []);
  });
});

describe("mailbox stub helpers", () => {
  it("treats Haider M as a weak variant of Haider Mukadam", () => {
    assert.equal(
      isWeakNameVariantOf(
        { firstName: "Haider", lastName: "M" },
        { firstName: "Haider", lastName: "Mukadam" },
      ),
      true,
    );
  });

  it("does not treat two full different names as weak variants", () => {
    assert.equal(
      isWeakNameVariantOf(
        { firstName: "Bonnie", lastName: "Kafi" },
        { firstName: "Haider", lastName: "Mukadam" },
      ),
      false,
    );
  });

  it("detects nameless cards", () => {
    assert.equal(isNamelessPerson({ first_name: null, last_name: null }), true);
    assert.equal(
      isNamelessPerson({ firstName: "Haider", lastName: null }),
      false,
    );
  });
});

describe("planMailboxIdentityMerges", () => {
  it("folds Haider stubs into Mukadam even when Bonnie has more mentions", () => {
    const bonnie = {
      id: "bonnie",
      firstName: "Bonnie",
      lastName: "Kafi",
      mentionWeight: 13642,
    };
    const mukadam = {
      id: "mukadam",
      firstName: "Haider",
      lastName: "Mukadam",
      mentionWeight: 5080,
    };
    const haiderM = {
      id: "haider-m",
      firstName: "Haider",
      lastName: "M",
      mentionWeight: 9,
    };
    const haider = {
      id: "haider",
      firstName: "Haider",
      lastName: null,
      mentionWeight: 0,
    };
    const plans = planMailboxIdentityMerges([
      bonnie,
      mukadam,
      haiderM,
      haider,
    ]);
    assert.equal(plans.length, 1);
    assert.equal(plans[0]?.survivor.id, "mukadam");
    assert.deepEqual(
      plans[0]?.absorbed.map((p) => p.id).sort(),
      ["haider", "haider-m"],
    );
  });

  it("does not merge distinct full names on the same mailbox", () => {
    const plans = planMailboxIdentityMerges([
      {
        id: "bonnie",
        firstName: "Bonnie",
        lastName: "Kafi",
        mentionWeight: 100,
      },
      {
        id: "haider",
        firstName: "Haider",
        lastName: "Mukadam",
        mentionWeight: 50,
      },
    ]);
    assert.equal(plans.length, 0);
  });
});

describe("evidenceMessageMatchesAttribute", () => {
  it("keeps email evidence when address is only in From/To headers", () => {
    assert.equal(
      evidenceMessageMatchesAttribute({
        kind: "email",
        attributeValue: "studiopm@iccpropertymanagement.com",
        hasName: false,
        person: { firstName: null, lastName: null },
        searchText: "Dear Residents, the office will close early.",
        fromAddress: "studiopm@iccpropertymanagement.com",
        toAddresses: ["board@example.com"],
        ccAddresses: [],
      }),
      true,
    );
  });

  it("still requires person-anchored title hits in the body", () => {
    assert.equal(
      evidenceMessageMatchesAttribute({
        kind: "title",
        attributeValue: "Condominium Manager",
        hasName: true,
        person: { firstName: "Haider", lastName: "Mukadam" },
        searchText: "Jane Doe, Condominium Manager\nHello board",
        fromAddress: "someone@example.com",
        toAddresses: [],
        ccAddresses: [],
      }),
      false,
    );
  });
});

describe("evidenceMessageMatchesPerson", () => {
  it("matches on last name without requiring a short first initial", () => {
    assert.equal(
      evidenceMessageMatchesPerson({
        hasName: true,
        person: { firstName: "J.", lastName: "MacLeod" },
        searchText: "Please loop in MacLeod on the elevator bid.",
        displayName: "J. MacLeod",
      }),
      true,
    );
  });

  it("does not match unrelated bodies for named people", () => {
    assert.equal(
      evidenceMessageMatchesPerson({
        hasName: true,
        person: { firstName: "J.", lastName: "MacLeod" },
        searchText: "Please loop in Ryan Ratcliff tomorrow.",
        displayName: "J. MacLeod",
      }),
      false,
    );
  });
});

describe("evidenceMessageMatchesPersonOrAttributes", () => {
  it("counts email-header evidence when the name is absent from the body", () => {
    assert.equal(
      evidenceMessageMatchesPersonOrAttributes({
        person: { firstName: "Ruth", lastName: "Savage" },
        displayName: "Ruth Savage",
        hasName: true,
        searchText: "Hi James, thanks for the GIC options.",
        fromAddress: "james.goodenough@scotiawealth.com",
        toAddresses: ["adam@example.com"],
        ccAddresses: ["ruth.savage@scotiawealth.com"],
        attributes: {
          emails: ["ruth.savage@scotiawealth.com"],
          phones: [],
          titles: [],
        },
      }),
      true,
    );
  });

  it("still rejects thread emails that match neither name nor attributes", () => {
    assert.equal(
      evidenceMessageMatchesPersonOrAttributes({
        person: { firstName: "Adam", lastName: null },
        displayName: "Adam",
        hasName: true,
        searchText: "Thanks John — I can sign tonight.",
        fromAddress: "shawna@example.com",
        toAddresses: ["board@example.com"],
        ccAddresses: [],
        attributes: { emails: [], phones: [], titles: [] },
      }),
      false,
    );
  });
});

describe("classifyPersonEvidenceMatch", () => {
  it("labels Cc-only participation without a body name hit", () => {
    const reasons = classifyPersonEvidenceMatch({
      person: { firstName: "Amanda", lastName: "Benaim" },
      displayName: "Amanda Benaim",
      hasName: true,
      searchText: "Approved",
      fromAddress: "gary@togrealty.com",
      toAddresses: ["board@example.com"],
      ccAddresses: ["benaim24@hotmail.com"],
      attributes: {
        emails: ["benaim24@hotmail.com"],
        phones: [],
        titles: [],
      },
    });
    assert.deepEqual(reasons, ["email_cc"]);
    assert.equal(hasContentMatch(reasons), false);
    assert.equal(reasons.every(isParticipationMatchReason), true);
  });

  it("returns both name and From when both match", () => {
    const reasons = classifyPersonEvidenceMatch({
      person: { firstName: "Amanda", lastName: "Benaim" },
      displayName: "Amanda Benaim",
      hasName: true,
      searchText: "Thanks Amanda Benaim for the update.",
      fromAddress: "benaim24@hotmail.com",
      toAddresses: ["board@example.com"],
      ccAddresses: [],
      attributes: {
        emails: ["benaim24@hotmail.com"],
        phones: [],
        titles: [],
      },
    });
    assert.ok(reasons.includes("name_in_body"));
    assert.ok(reasons.includes("email_from"));
    assert.equal(hasContentMatch(reasons), true);
  });
});

describe("classifyAttributeEvidenceMatch", () => {
  it("separates From vs body address hits", () => {
    assert.deepEqual(
      classifyAttributeEvidenceMatch({
        kind: "email",
        attributeValue: "benaim24@hotmail.com",
        hasName: true,
        person: { firstName: "Amanda", lastName: "Benaim" },
        searchText: "Approved",
        fromAddress: "gary@togrealty.com",
        toAddresses: ["benaim24@hotmail.com"],
        ccAddresses: [],
      }),
      ["email_to"],
    );
  });
});

describe("bodyPreviewAroundMention", () => {
  it("centers the preview on the first mention with ellipsis", () => {
    const prefix = "A".repeat(80);
    const suffix = "B".repeat(80);
    const text = `${prefix} Amanda Benaim ${suffix}`;
    const preview = bodyPreviewAroundMention({
      text,
      needles: ["Amanda Benaim"],
      contextChars: 50,
    });
    assert.ok(preview.startsWith("…"));
    assert.ok(preview.endsWith("…"));
    assert.ok(preview.includes("Amanda Benaim"));
    assert.ok(!preview.startsWith("AAA"));
  });

  it("falls back to the start when no needle matches", () => {
    const preview = bodyPreviewAroundMention({
      text: "Hello board, please review the package.",
      needles: ["Amanda Benaim"],
    });
    assert.equal(preview.startsWith("Hello board"), true);
  });
});
