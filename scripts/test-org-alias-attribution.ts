/**
 * Per-message org email counts after alias / mailbox moves.
 * Run: npx tsx --test scripts/test-org-alias-attribution.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OrgFieldAttachment } from "../lib/organizations/field-attachments";
import { orgSurfaceCollidesOnRoster } from "../lib/organizations/mention-shared";
import {
  rebuildOrgEmailIdsFromSightings,
  type OrgEmailBucket,
  type OrgNameSighting,
} from "../lib/organizations/moved-alias-attribution";

function attachment(
  partial: Pick<OrgFieldAttachment, "orgKey" | "attachedValue"> &
    Partial<OrgFieldAttachment>,
): OrgFieldAttachment {
  const attachedValue = partial.attachedValue;
  return {
    id: partial.id ?? "att",
    orgKey: partial.orgKey,
    field: partial.field ?? "name_alias",
    attachedValue,
    valueKey: attachedValue.trim().toLowerCase(),
    nameKey: partial.nameKey ?? null,
    createdAt: partial.createdAt ?? "",
  };
}

function org(
  partial: Pick<OrgEmailBucket, "id" | "name"> & Partial<OrgEmailBucket>,
): OrgEmailBucket {
  return {
    id: partial.id,
    name: partial.name,
    email: partial.email ?? null,
    phone: partial.phone ?? null,
    website: partial.website ?? null,
    aliases: [...(partial.aliases ?? [])],
    emailIds: new Set(partial.emailIds ?? []),
  };
}

function idsOf(orgs: OrgEmailBucket[], id: string): string[] {
  const row = orgs.find((item) => item.id === id);
  assert.ok(row, `missing org ${id}`);
  return [...row.emailIds].sort();
}

describe("rebuildOrgEmailIdsFromSightings", () => {
  const studio = org({
    id: "name:studio on richmond management office",
    name: "Studio on Richmond Management Office",
    emailIds: new Set(["e1", "e2", "e3", "e4", "e5"]),
  });
  const icc = org({
    id: "email:jwilson@icc.test",
    name: "ICC Property Management Ltd.",
    email: "jwilson@icc.test",
    emailIds: new Set(["e6", "e7"]),
  });
  const tscc = org({
    id: "name:tscc 2517",
    name: "TSCC 2517",
    emailIds: new Set(["e8"]),
  });

  it("splits alias harvest names onto target cards; studio keeps primary-name only", () => {
    const nameSightings: OrgNameSighting[] = [
      { emailId: "e1", name: "TSCC 2517 Management Office", identityKeys: [] },
      { emailId: "e2", name: "TSCC 2517 Management Office", identityKeys: [] },
      { emailId: "e3", name: "Studio on Richmond Management Office", identityKeys: [] },
      { emailId: "e4", name: "Studio on Richmond Management Office", identityKeys: [] },
      { emailId: "e5", name: "Studio on Richmond Management Office", identityKeys: [] },
      { emailId: "e6", name: "ICC Property Management Ltd.", identityKeys: [] },
      { emailId: "e7", name: "ICC Property Management Ltd.", identityKeys: [] },
    ];
    const next = rebuildOrgEmailIdsFromSightings({
      organizations: [
        studio,
        {
          ...icc,
          aliases: ["TSCC 2517 Management Office"],
        },
        tscc,
      ],
      nameSightings,
      attachments: [
        attachment({
          orgKey: "email:jwilson@icc.test",
          attachedValue: "TSCC 2517 Management Office",
          nameKey: "icc property management ltd",
        }),
      ],
    });

    assert.deepEqual(idsOf(next, studio.id), ["e3", "e4", "e5"]);
    assert.deepEqual(idsOf(next, icc.id), ["e1", "e2", "e6", "e7"]);
    assert.deepEqual(idsOf(next, tscc.id), []);
  });

  it("does not count every message with a pinned mailbox globally", () => {
    const next = rebuildOrgEmailIdsFromSightings({
      organizations: [studio, icc],
      nameSightings: [
        { emailId: "e1", name: "ICC Property Management Ltd.", identityKeys: [] },
        { emailId: "e2", name: "ICC Property Management Ltd.", identityKeys: [] },
        { emailId: "e3", name: "Studio on Richmond Management Office", identityKeys: [] },
      ],
      attachments: [
        attachment({
          field: "email",
          orgKey: "name:studio on richmond management office",
          attachedValue: "jwilson@icc.test",
          nameKey: "studio on richmond management office",
        }),
      ],
    });

    assert.deepEqual(idsOf(next, studio.id), ["e3"]);
    assert.deepEqual(idsOf(next, icc.id), ["e1", "e2"]);
  });

  it("keeps dual-name emails on studio when also harvested under primary name", () => {
    const next = rebuildOrgEmailIdsFromSightings({
      organizations: [studio, icc],
      nameSightings: [
        { emailId: "e1", name: "TSCC 2517 Management Office", identityKeys: [] },
        { emailId: "e1", name: "Studio on Richmond Management Office", identityKeys: [] },
      ],
      attachments: [
        attachment({
          orgKey: "email:jwilson@icc.test",
          attachedValue: "TSCC 2517 Management Office",
        }),
      ],
    });

    assert.deepEqual(idsOf(next, studio.id), ["e1"]);
    assert.deepEqual(idsOf(next, icc.id), ["e1"]);
  });

  it("counts unique short aliases like TCG, not prefix-colliding Trace", () => {
    const trace = org({
      id: "name:trace consulting group ltd",
      name: "Trace Consulting Group Ltd.",
      aliases: ["Trace Consulting Group", "Trace", "TCG"],
    });
    const fire = org({
      id: "name:trace fire group",
      name: "Trace Fire Group",
    });
    const next = rebuildOrgEmailIdsFromSightings({
      organizations: [trace, fire],
      nameSightings: [
        { emailId: "a", name: "Trace Consulting Group Ltd.", identityKeys: [] },
        { emailId: "b", name: "Trace Consulting Group", identityKeys: [] },
        { emailId: "c", name: "Trace", identityKeys: [] },
        { emailId: "d", name: "Trace Fire Group", identityKeys: [] },
        { emailId: "e", name: "TCG", identityKeys: [] },
      ],
      attachments: [],
    });
    assert.deepEqual(idsOf(next, trace.id), ["a", "b", "e"]);
    assert.deepEqual(idsOf(next, fire.id), ["d"]);
  });
});

describe("orgSurfaceCollidesOnRoster", () => {
  const roster = [
    {
      name: "Trace Consulting Group Ltd.",
      aliases: ["TCG", "Trace"],
    },
    { name: "Trace Fire Group", aliases: ["TFG"] },
  ];

  it("flags Trace as a prefix of another primary and keeps unique TCG", () => {
    const owner = roster[0]!.name;
    assert.equal(orgSurfaceCollidesOnRoster("Trace", owner, roster), true);
    assert.equal(orgSurfaceCollidesOnRoster("TCG", owner, roster), false);
    assert.equal(
      orgSurfaceCollidesOnRoster("Trace Consulting Group", owner, roster),
      false,
    );
  });
});
