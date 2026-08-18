/**
 * Person given-name preference / alias helper tests.
 * Run: npx tsx --test scripts/test-person-name.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectDiscardedNameAliases,
  finalizeNameAliases,
  givenNamesConflict,
  guessFirstNameFromDottedLocalPart,
  isAcceptableNameAlias,
  isGivenNameInitialExpansion,
  isGivenNameSpellingVariant,
  lastNamesCompatible,
  looksLikeMailboxLocalPart,
  personIdentitiesConflict,
  preferCompatibleLastName,
  preferPersonGivenName,
  sanitizeGivenNameAgainstEmails,
} from "../lib/contacts/person-name";
import {
  mergeEmailOccupancyDates,
  pickCurrentOccupancyPersonId,
  planSharedMailboxSuccession,
} from "../lib/contacts/registry-shared";

describe("preferPersonGivenName", () => {
  it("prefers real given name over email local-part", () => {
    assert.equal(
      preferPersonGivenName("pgartenburg", "Paul", [
        "pgartenburg@gmail.com",
      ]),
      "Paul",
    );
    assert.equal(
      preferPersonGivenName("Paul", "pgartenburg", [
        "pgartenburg@pliteq.com",
      ]),
      "Paul",
    );
  });

  it("prefers title-case / short name over jammed local-part lookalike", () => {
    assert.equal(
      preferPersonGivenName("jwilson", "James", []),
      "James",
    );
    assert.equal(
      preferPersonGivenName("bdossantos", "Bruno", []),
      "Bruno",
    );
  });

  it("prefers longer spelling only for the same stem (Ann → Anne)", () => {
    assert.equal(preferPersonGivenName("Haider", "Haider ", []), "Haider");
    assert.equal(preferPersonGivenName("Ann", "Anne", []), "Anne");
    assert.equal(preferPersonGivenName("Rob", "Robert", []), "Robert");
  });

  it("expands bare initials to the matching full given name", () => {
    assert.equal(preferPersonGivenName("M.", "Michael", []), "Michael");
    assert.equal(preferPersonGivenName("Michael", "M.", []), "Michael");
    assert.equal(
      preferPersonGivenName("M.", "Michael", [
        "m.lethbridge@studiorichmond.ca",
        "michael@studiorichmond.ca",
      ]),
      "Michael",
    );
  });

  it("keeps the existing name when unrelated given names conflict", () => {
    assert.equal(
      preferPersonGivenName("Paul", "Peter", ["pgartenburg@gmail.com"]),
      "Paul",
    );
    assert.equal(
      preferPersonGivenName("Peter", "Paul", ["pgartenburg@gmail.com"]),
      "Peter",
    );
  });
});

describe("isGivenNameSpellingVariant", () => {
  it("matches stem expansions but not initials or unrelated names", () => {
    assert.equal(isGivenNameSpellingVariant("Ann", "Anne"), true);
    assert.equal(isGivenNameSpellingVariant("Alex", "Alexandre"), true);
    assert.equal(isGivenNameSpellingVariant("P.", "Paul"), false);
    assert.equal(isGivenNameSpellingVariant("J", "John"), false);
    assert.equal(isGivenNameSpellingVariant("Paul", "Peter"), false);
    assert.equal(isGivenNameSpellingVariant("Joseph", "Paul"), false);
  });
});

describe("isGivenNameInitialExpansion", () => {
  it("matches single-letter initials to the fuller given name", () => {
    assert.equal(isGivenNameInitialExpansion("M.", "Michael"), true);
    assert.equal(isGivenNameInitialExpansion("Michael", "M"), true);
    assert.equal(isGivenNameInitialExpansion("J", "John"), true);
    assert.equal(isGivenNameInitialExpansion("P.", "Peter"), true);
    assert.equal(isGivenNameInitialExpansion("Ann", "Anne"), false);
    assert.equal(isGivenNameInitialExpansion("Paul", "Peter"), false);
  });
});

describe("isAcceptableNameAlias", () => {
  it("keeps stem expansions and near-typos; drops unrelated people", () => {
    assert.equal(isAcceptableNameAlias("Ann", "Anne"), true);
    assert.equal(isAcceptableNameAlias("Shawnna", "Shawna"), true);
    assert.equal(isAcceptableNameAlias("Lawrence", "Lawarence"), true);
    assert.equal(isAcceptableNameAlias("J", "John"), false);
    assert.equal(isAcceptableNameAlias("James", "John"), false);
    assert.equal(isAcceptableNameAlias("Haider", "Atif"), false);
    assert.equal(isAcceptableNameAlias("Studio", "Atif"), false);
    assert.equal(isAcceptableNameAlias("Bonnie", "Brian"), false);
  });
});

describe("finalizeNameAliases", () => {
  it("strips contaminated Also-known-as rows", () => {
    assert.deepEqual(
      finalizeNameAliases({
        kept: "John",
        lists: [["J", "James", "Jason", "JJohn", "Judy"]],
      }),
      [],
    );
    assert.deepEqual(
      finalizeNameAliases({
        kept: "Atif",
        lists: [["Haider", "John", "Margot", "Studio"]],
      }),
      [],
    );
    assert.deepEqual(
      finalizeNameAliases({
        kept: "Shawna",
        lists: [["Shawnna"]],
      }),
      ["Shawnna"],
    );
  });
});

describe("sanitizeGivenNameAgainstEmails", () => {
  it("clears first names that are mailbox local-parts", () => {
    assert.equal(
      sanitizeGivenNameAgainstEmails("pgartenburg", [
        "pgartenburg@gmail.com",
      ]),
      null,
    );
    assert.equal(
      sanitizeGivenNameAgainstEmails("Paul", ["pgartenburg@gmail.com"]),
      "Paul",
    );
  });

  it("keeps real given names that match a short local-part (adam@)", () => {
    assert.equal(
      sanitizeGivenNameAgainstEmails("Adam", [
        "adam@synthesisvaluations.com",
        "adam.n.johnson@gmail.com",
      ]),
      "Adam",
    );
  });

  it("keeps Michael even when michael@ is on the person", () => {
    assert.equal(
      sanitizeGivenNameAgainstEmails("Michael", [
        "m.lethbridge@studiorichmond.ca",
        "michael@studiorichmond.ca",
      ]),
      "Michael",
    );
  });
});

describe("looksLikeMailboxLocalPart", () => {
  it("flags jammed lowercase local-parts but not short given names", () => {
    assert.equal(looksLikeMailboxLocalPart("pgartenburg"), true);
    assert.equal(looksLikeMailboxLocalPart("jwilson"), true);
    assert.equal(looksLikeMailboxLocalPart("Paul"), false);
    assert.equal(looksLikeMailboxLocalPart("haider"), false);
  });
});

describe("collectDiscardedNameAliases", () => {
  it("keeps spelling-variant discarded names, skips local-parts and conflicts", () => {
    assert.deepEqual(
      collectDiscardedNameAliases({
        kept: "Paul",
        candidates: ["Paul", "pgartenburg", "P.", "Peter", "Joseph"],
        emails: ["pgartenburg@gmail.com"],
      }),
      [],
    );
    assert.deepEqual(
      collectDiscardedNameAliases({
        kept: "Anne",
        candidates: ["Ann", "Anne"],
        emails: [],
      }),
      ["Ann"],
    );
  });
});

describe("guessFirstNameFromDottedLocalPart", () => {
  it("recovers Shawna / Adam when last name matches", () => {
    assert.equal(
      guessFirstNameFromDottedLocalPart(
        "shawna.greenspan@gmail.com",
        "Greenspan",
      ),
      "Shawna",
    );
    assert.equal(
      guessFirstNameFromDottedLocalPart(
        "adam.n.johnson@gmail.com",
        "Johnson",
      ),
      "Adam",
    );
  });

  it("does not invent from jammed local-parts", () => {
    assert.equal(
      guessFirstNameFromDottedLocalPart("pgartenburg@gmail.com", "Gartenburg"),
      null,
    );
  });
});

describe("preferCompatibleLastName / lastNamesCompatible", () => {
  it("allows weak surname expansions and middle-initial forms", () => {
    assert.equal(lastNamesCompatible("S", "Singh"), true);
    assert.equal(lastNamesCompatible("Singh", "S"), true);
    assert.equal(lastNamesCompatible("J. Kempton", "Kempton"), true);
    assert.equal(lastNamesCompatible("Kempton", "Khurshid"), false);
    assert.equal(lastNamesCompatible("Singh", "Mukadam"), false);
  });

  it("never frankensteins unrelated surnames by length", () => {
    assert.equal(
      preferCompatibleLastName("Khurshid", "J. Kempton"),
      "Khurshid",
    );
    assert.equal(
      preferCompatibleLastName("Kempton", "J. Kempton"),
      "J. Kempton",
    );
    assert.equal(preferCompatibleLastName("S", "Singh"), "Singh");
    assert.equal(preferCompatibleLastName(null, "Singh"), "Singh");
  });
});

describe("personIdentitiesConflict", () => {
  it("detects studiopm succession people as distinct", () => {
    assert.equal(
      personIdentitiesConflict(
        { first_name: "Margot", last_name: "Kempton" },
        { firstName: "Atif", lastName: "Khurshid" },
      ),
      true,
    );
    assert.equal(
      personIdentitiesConflict(
        { first_name: "Mehal", last_name: "Singh" },
        { firstName: "Atif", lastName: "Singh" },
      ),
      true,
    );
    assert.equal(
      personIdentitiesConflict(
        { first_name: "Haider", last_name: "M" },
        { firstName: "Haider", lastName: "Mukadam" },
      ),
      false,
    );
    assert.equal(givenNamesConflict("Mehal", "Atif"), true);
    assert.equal(givenNamesConflict("Ann", "Anne"), false);
    assert.equal(givenNamesConflict("M.", "Michael"), false);
  });
});

describe("mergeEmailOccupancyDates", () => {
  it("does not reopen a closed range when incoming validTo is null", () => {
    assert.deepEqual(
      mergeEmailOccupancyDates({
        existingFrom: "2018-10-05",
        existingTo: "2021-03-01",
        incomingFrom: "2019-01-01",
        incomingTo: null,
      }),
      { validFrom: "2018-10-05", validTo: "2021-03-01" },
    );
  });

  it("does not rewind occupancy start from a later thread-wide dateMin", () => {
    assert.deepEqual(
      mergeEmailOccupancyDates({
        existingFrom: "2026-06-02",
        existingTo: "2026-08-14",
        incomingFrom: "2023-07-27",
        incomingTo: "2026-08-14",
      }),
      { validFrom: "2026-06-02", validTo: "2026-08-14" },
    );
  });

  it("extends or closes open ranges from concrete evidence ends", () => {
    assert.deepEqual(
      mergeEmailOccupancyDates({
        existingFrom: "2023-10-04",
        existingTo: null,
        incomingFrom: "2023-11-01",
        incomingTo: "2024-12-20",
      }),
      { validFrom: "2023-10-04", validTo: "2024-12-20" },
    );
    assert.deepEqual(
      mergeEmailOccupancyDates({
        existingFrom: "2023-10-04",
        existingTo: "2023-11-01",
        incomingFrom: null,
        incomingTo: "2024-12-20",
      }),
      { validFrom: "2023-10-04", validTo: "2024-12-20" },
    );
  });
});

describe("planSharedMailboxSuccession", () => {
  it("reopens the latest occupant and closes earlier ones", () => {
    const updates = planSharedMailboxSuccession([
      {
        id: "bonnie",
        personId: "b",
        validFrom: "2023-07-27",
        validTo: "2026-05-11",
      },
      {
        id: "haider",
        personId: "h",
        validFrom: "2023-07-27",
        validTo: "2026-08-14",
      },
    ]);
    assert.deepEqual(
      updates.find((u) => u.id === "haider"),
      { id: "haider", validTo: null },
    );
    assert.equal(updates.find((u) => u.id === "bonnie"), undefined);
  });
});

describe("pickCurrentOccupancyPersonId", () => {
  it("prefers later closed evidence over a stale open former occupant", () => {
    const id = pickCurrentOccupancyPersonId(
      [
        {
          personId: "bonnie",
          validFrom: "2023-07-27",
          validTo: null,
        },
        {
          personId: "haider",
          validFrom: "2023-07-27",
          validTo: "2026-08-14",
        },
      ],
      "2026-08-17T12:00:00.000Z",
    );
    assert.equal(id, "haider");
  });
});
