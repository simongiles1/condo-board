/**
 * Contact duplicate-group clustering tests.
 * Run: npx tsx --test scripts/test-duplicate-groups.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildContactDuplicateGroups } from "../lib/contacts/duplicate-groups";
import type { ContactRegistryPersonSummary } from "../lib/contacts/registry-shared";

function person(
  partial: Partial<ContactRegistryPersonSummary> & { id: string },
): ContactRegistryPersonSummary {
  return {
    firstName: null,
    lastName: null,
    nameAliases: [],
    mentionWeight: 0,
    sourceEmailCount: 0,
    sparseStub: false,
    currentOrganizationId: null,
    currentOrganizationName: null,
    emails: [],
    phones: [],
    titles: [],
    ...partial,
  };
}

describe("buildContactDuplicateGroups", () => {
  it("groups all cards that share a first name and counts first-name-only stubs", () => {
    const groups = buildContactDuplicateGroups([
      person({ id: "1", firstName: "Mark", sourceEmailCount: 1 }),
      person({ id: "2", firstName: "Mark", sourceEmailCount: 1 }),
      person({ id: "3", firstName: "mark", lastName: "Smith", sourceEmailCount: 5 }),
      person({ id: "4", firstName: "Mark", lastName: "Jones", sourceEmailCount: 3 }),
      person({ id: "5", firstName: "Paul", lastName: "Gartenburg", sourceEmailCount: 10 }),
    ]);

    const mark = groups.find((g) => g.id === "name:mark");
    assert.ok(mark);
    assert.equal(mark.kind, "first_name");
    assert.equal(mark.memberCount, 4);
    assert.equal(mark.firstNameOnlyCount, 2);
    assert.equal(mark.label, "Mark");
    // First-name-only stubs sort ahead of full names.
    assert.equal(mark.members[0]!.firstNameOnly, true);
    assert.equal(mark.members[1]!.firstNameOnly, true);

    assert.equal(
      groups.some((g) => g.id === "name:paul"),
      false,
      "unique first names should not appear",
    );
  });

  it("surfaces shared emails including nameless stubs with occupancy ranges", () => {
    const shared = "studiopm@iccpropertymanagement.com";
    const groups = buildContactDuplicateGroups([
      person({
        id: "a",
        emails: [
          {
            id: "e1",
            email: shared,
            validFrom: "2020-01-01",
            validTo: "2022-06-01",
          },
        ],
      }),
      person({
        id: "b",
        firstName: "Shawna",
        lastName: "Greenspan",
        emails: [
          {
            id: "e2",
            email: shared,
            validFrom: "2022-06-02",
            validTo: null,
          },
        ],
        sourceEmailCount: 8,
      }),
      person({
        id: "c",
        firstName: "Other",
        emails: [
          {
            id: "e3",
            email: "alone@example.com",
            validFrom: null,
            validTo: null,
          },
        ],
      }),
    ]);

    const emailGroup = groups.find((g) => g.id === `email:${shared}`);
    assert.ok(emailGroup);
    assert.equal(emailGroup.kind, "email");
    assert.equal(emailGroup.memberCount, 2);
    assert.equal(emailGroup.namelessCount, 1);
    assert.equal(emailGroup.members[0]!.nameless, true);
    assert.equal(
      groups.some((g) => g.id === "email:alone@example.com"),
      false,
    );
  });

  it("sorts groups by member count descending", () => {
    const groups = buildContactDuplicateGroups([
      person({ id: "1", firstName: "Ann" }),
      person({ id: "2", firstName: "Ann" }),
      person({ id: "3", firstName: "Bob" }),
      person({ id: "4", firstName: "Bob" }),
      person({ id: "5", firstName: "Bob" }),
    ]);
    assert.equal(groups[0]!.label, "Bob");
    assert.equal(groups[0]!.memberCount, 3);
    assert.equal(groups[1]!.label, "Ann");
    assert.equal(groups[1]!.memberCount, 2);
  });
});
