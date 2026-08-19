/**
 * Contact mention fingerprint + discrete resolver tests.
 * Run: npx tsx --test scripts/test-contact-mentions.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMentionBlockingKeys,
  contactMentionFingerprint,
  inferRawCompanyFromHighlights,
  mentionFirstOrgKey,
  mentionMatchingFirstNameKey,
  personMeetsProvisionalPrior,
} from "../lib/contacts/mention-shared";
import {
  decideContactMentionResolution,
  personFullNameAppearsInSubject,
  shouldRetractProvisionalMention,
  type MentionResolveCandidate,
} from "../lib/contacts/mention-resolve-shared";
import { emptyContactHighlightExtraction } from "../lib/email-analysis/contact-highlight-shared";

function person(
  partial: Partial<MentionResolveCandidate> & { id: string },
): MentionResolveCandidate {
  return {
    firstName: "Dan",
    lastName: "Miller",
    sourceEmailCount: 50,
    mentionWeight: 50,
    ...partial,
  };
}

describe("mentionMatchingFirstNameKey", () => {
  it("treats a trailing middle initial as the same given name", () => {
    assert.equal(mentionMatchingFirstNameKey("John P."), "john");
    assert.equal(mentionMatchingFirstNameKey("John P"), "john");
    assert.equal(mentionMatchingFirstNameKey("John"), "john");
  });

  it("keeps a two-word given name", () => {
    assert.equal(mentionMatchingFirstNameKey("Mary Ann"), "mary ann");
  });
});

describe("contactMentionFingerprint", () => {
  it("is stable across casing and treats company as part of identity", () => {
    const a = contactMentionFingerprint({
      first_name: "Dan",
      last_name: null,
      email: null,
      phone: null,
      job_title: null,
      raw_company: "XYZ Consulting Group",
    });
    const b = contactMentionFingerprint({
      first_name: "dan",
      last_name: null,
      email: null,
      phone: null,
      job_title: null,
      raw_company: "xyz consulting group",
    });
    assert.equal(a, b);
    const withoutCompany = contactMentionFingerprint({
      first_name: "Dan",
      last_name: null,
      email: null,
      phone: null,
      job_title: null,
      raw_company: null,
    });
    assert.notEqual(a, withoutCompany);
  });
});

describe("inferRawCompanyFromHighlights", () => {
  it("keeps an explicit company on the card", () => {
    const extraction = emptyContactHighlightExtraction();
    extraction.company_names = ["Other Inc"];
    assert.equal(
      inferRawCompanyFromHighlights(
        { raw_company: "XYZ Consulting" },
        extraction,
      ),
      "XYZ Consulting",
    );
  });

  it("copies the only pass-1/2 company when the card omitted it", () => {
    const extraction = emptyContactHighlightExtraction();
    extraction.company_names = ["XYZ Consulting Group"];
    assert.equal(
      inferRawCompanyFromHighlights({ raw_company: null }, extraction),
      "XYZ Consulting Group",
    );
  });

  it("does not guess when several companies appear", () => {
    const extraction = emptyContactHighlightExtraction();
    extraction.company_names = ["XYZ", "ICC"];
    assert.equal(
      inferRawCompanyFromHighlights({ raw_company: null }, extraction),
      null,
    );
  });
});

describe("mention blocking keys", () => {
  it("includes first and first_org keys", () => {
    const keys = buildMentionBlockingKeys({
      first_name: "Dan",
      last_name: null,
      email: null,
      phone: null,
      job_title: null,
      raw_company: "XYZ Consulting Group",
    });
    assert.ok(keys.includes("first:dan"));
    assert.equal(
      mentionFirstOrgKey({
        firstName: "Dan",
        rawCompany: "XYZ Consulting Group",
      }),
      "dan|xyz consulting group",
    );
    assert.ok(keys.some((key) => key.startsWith("first_org:dan|")));
  });
});

describe("decideContactMentionResolution", () => {
  it("confirms on exact email before org heuristics", () => {
    const decision = decideContactMentionResolution({
      exactPersonByEmailId: "p-email",
      exactPersonByPhoneId: "p-phone",
      participantMatches: [person({ id: "p-thread" })],
      firstOrgMatches: [person({ id: "p-org" })],
      firstNameCanonicalMatches: [person({ id: "p-first" })],
    });
    assert.equal(decision.status, "confirmed");
    assert.equal(decision.personId, "p-email");
    assert.equal(decision.reason, "exact_key_email");
  });

  it("confirms a unique thread participant", () => {
    const decision = decideContactMentionResolution({
      exactPersonByEmailId: null,
      exactPersonByPhoneId: null,
      participantMatches: [person({ id: "p-thread" })],
      firstOrgMatches: [],
      firstNameCanonicalMatches: [],
    });
    assert.equal(decision.status, "confirmed");
    assert.equal(decision.reason, "thread_participant");
  });

  it("provisionally attaches unique first+org when the person is well-known", () => {
    const decision = decideContactMentionResolution({
      exactPersonByEmailId: null,
      exactPersonByPhoneId: null,
      participantMatches: [],
      firstOrgMatches: [person({ id: "dan-miller", sourceEmailCount: 50 })],
      firstNameCanonicalMatches: [],
    });
    assert.equal(decision.status, "provisional");
    assert.equal(decision.reason, "unique_first_plus_org_provisional");
    assert.equal(decision.personId, "dan-miller");
  });

  it("does not auto-attach unique first+org when the person is thinly mentioned", () => {
    const decision = decideContactMentionResolution({
      exactPersonByEmailId: null,
      exactPersonByPhoneId: null,
      participantMatches: [],
      firstOrgMatches: [
        person({ id: "new-dan", sourceEmailCount: 1, mentionWeight: 1 }),
      ],
      firstNameCanonicalMatches: [],
    });
    assert.equal(decision.status, "unresolved");
    assert.equal(decision.reason, "unique_first_plus_org_thin");
    assert.equal(decision.personId, null);
  });

  it("leaves two Dans at the same org unresolved", () => {
    const decision = decideContactMentionResolution({
      exactPersonByEmailId: null,
      exactPersonByPhoneId: null,
      participantMatches: [],
      firstOrgMatches: [
        person({ id: "dan-miller" }),
        person({ id: "dan-smith", lastName: "Smith" }),
      ],
      firstNameCanonicalMatches: [],
    });
    assert.equal(decision.status, "unresolved");
    assert.equal(decision.reason, "first_plus_org_ambiguous");
  });

  it("confirms a unique first+last even when the person is thinly mentioned", () => {
    const decision = decideContactMentionResolution({
      exactPersonByEmailId: null,
      exactPersonByPhoneId: null,
      participantMatches: [],
      firstLastMatches: [
        person({
          id: "haider-mukadam",
          firstName: "Haider",
          lastName: "Mukadam",
          sourceEmailCount: 2,
          mentionWeight: 2,
        }),
      ],
      firstOrgMatches: [],
      firstNameCanonicalMatches: [],
    });
    assert.equal(decision.status, "confirmed");
    assert.equal(decision.reason, "unique_first_last");
    assert.equal(decision.personId, "haider-mukadam");
  });

  it("leaves two people with the same first+last unresolved", () => {
    const decision = decideContactMentionResolution({
      exactPersonByEmailId: null,
      exactPersonByPhoneId: null,
      participantMatches: [],
      firstLastMatches: [
        person({ id: "haider-1", firstName: "Haider", lastName: "Mukadam" }),
        person({ id: "haider-2", firstName: "Haider", lastName: "Mukadam" }),
      ],
      firstOrgMatches: [],
      firstNameCanonicalMatches: [],
    });
    assert.equal(decision.status, "unresolved");
    assert.equal(decision.reason, "first_last_ambiguous");
  });

  it("confirms a first-name-only mention when the subject names one person", () => {
    const decision = decideContactMentionResolution({
      exactPersonByEmailId: null,
      exactPersonByPhoneId: null,
      participantMatches: [],
      subjectNameMatches: [
        person({
          id: "haider-mukadam",
          firstName: "Haider",
          lastName: "Mukadam",
          sourceEmailCount: 2,
          mentionWeight: 2,
        }),
      ],
      firstOrgMatches: [],
      firstNameCanonicalMatches: [
        person({
          id: "haider-mukadam",
          firstName: "Haider",
          lastName: "Mukadam",
          sourceEmailCount: 2,
          mentionWeight: 2,
        }),
        person({
          id: "haider-other",
          firstName: "Haider",
          lastName: "Khan",
          sourceEmailCount: 10,
          mentionWeight: 10,
        }),
      ],
    });
    assert.equal(decision.status, "confirmed");
    assert.equal(decision.reason, "unique_name_in_subject");
    assert.equal(decision.personId, "haider-mukadam");
  });
});

describe("personFullNameAppearsInSubject", () => {
  it("matches a reply subject that already has the full name", () => {
    assert.equal(
      personFullNameAppearsInSubject({
        firstName: "Haider",
        lastName: "Mukadam",
        subject: "Re: Haider Mukadam - Condominium Manager",
      }),
      true,
    );
  });

  it("does not match a different last name in the same subject", () => {
    assert.equal(
      personFullNameAppearsInSubject({
        firstName: "Haider",
        lastName: "Khan",
        subject: "Re: Haider Mukadam - Condominium Manager",
      }),
      false,
    );
  });
});

describe("shouldRetractProvisionalMention", () => {
  it("retracts first+org provisionals when a second person collides", () => {
    assert.equal(
      shouldRetractProvisionalMention({
        reason: "unique_first_plus_org_provisional",
        firstOrgKey: "dan|xyz consulting group",
        firstNameKey: "dan",
        collidingFirstOrgKeys: new Set(["dan|xyz consulting group"]),
        collidingFirstNameKeys: new Set(),
      }),
      true,
    );
  });

  it("does not retract confirmed or unrelated keys", () => {
    assert.equal(
      shouldRetractProvisionalMention({
        reason: "exact_key_email",
        firstOrgKey: "dan|xyz consulting group",
        firstNameKey: "dan",
        collidingFirstOrgKeys: new Set(["dan|xyz consulting group"]),
        collidingFirstNameKeys: new Set(["dan"]),
      }),
      false,
    );
  });
});

describe("personMeetsProvisionalPrior", () => {
  it("accepts high mention weight as well as source email count", () => {
    assert.equal(personMeetsProvisionalPrior({ sourceEmailCount: 8 }), true);
    assert.equal(
      personMeetsProvisionalPrior({ sourceEmailCount: 0, mentionWeight: 8 }),
      true,
    );
    assert.equal(
      personMeetsProvisionalPrior({ sourceEmailCount: 2, mentionWeight: 2 }),
      false,
    );
  });
});
