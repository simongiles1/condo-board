/**
 * Organization mention decision function.
 * Run: npx tsx --test scripts/test-org-mention-resolve.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectPaintedOrgMentionSurfaces,
  locateUniqueSurfaceSpan,
  orgSurfacesMissingMentions,
} from "../lib/organizations/mention-shared";
import {
  collectOrgMentionCandidates,
  decideOrgMentionResolution,
  type OrgMentionSearchDocument,
} from "../lib/organizations/mention-resolve-shared";

function org(
  partial: Partial<OrgMentionSearchDocument> & { id: string; name: string },
): OrgMentionSearchDocument {
  return {
    aliases: [],
    email: null,
    website: null,
    ...partial,
  };
}

const consulting = org({
  id: "consulting",
  name: "Trace Consulting Group Ltd.",
  aliases: ["Trace Consulting Group", "TCG", "Trace"],
  email: "bob@traceconsulting.com",
  website: "traceconsulting.com",
});
const fire = org({
  id: "fire",
  name: "Trace Fire Group",
  aliases: ["TFG", "Trace Fire"],
  email: "desk@tracefiregroup.com",
  website: "tracefiregroup.com",
});
const maintenance = org({
  id: "maintenance",
  name: "Trace Maintenance Group",
  website: "www.tracemaintenancegroup.com",
});
const docs = [consulting, fire, maintenance];

describe("collectOrgMentionCandidates", () => {
  it("treats Trace as a prefix of all three Trace-* firms", () => {
    const collected = collectOrgMentionCandidates("Trace", docs);
    assert.deepEqual(collected.prefixIds.sort(), [
      "consulting",
      "fire",
      "maintenance",
    ]);
    assert.deepEqual(collected.exactSurfaceIds, ["consulting"]);
    assert.equal(collected.distinctiveIds.length, 0);
  });

  it("treats TCG as an exact surface alias, not a prefix", () => {
    const collected = collectOrgMentionCandidates("TCG", docs);
    assert.deepEqual(collected.exactSurfaceIds, ["consulting"]);
    assert.deepEqual(collected.prefixIds, []);
    assert.equal(collected.distinctiveIds.length, 0);
  });

  it("collapses a leftover name-key stub into the email-keyed consulting row", () => {
    const nameStub = org({
      id: "consulting-name",
      name: "Trace Consulting Group Ltd.",
    });
    const collected = collectOrgMentionCandidates("Trace", [
      ...docs,
      nameStub,
    ]);
    assert.deepEqual(collected.prefixIds.sort(), [
      "consulting",
      "fire",
      "maintenance",
    ]);
    assert.ok(!collected.prefixIds.includes("consulting-name"));
    assert.deepEqual(collected.exactSurfaceIds, ["consulting"]);
  });
});

describe("decideOrgMentionResolution", () => {
  it("does not auto-confirm Trace onto Consulting when Fire and Maintenance exist", () => {
    const decision = decideOrgMentionResolution({
      rawName: "Trace",
      headerDomains: [],
      affiliatedOrganizationIds: [],
      documents: docs,
    });
    assert.equal(decision.status, "unresolved");
    assert.equal(decision.organizationId, null);
    assert.ok(decision.candidateOrganizationIds.includes("consulting"));
    assert.ok(decision.candidateOrganizationIds.includes("fire"));
    assert.ok(decision.candidateOrganizationIds.includes("maintenance"));
  });

  it("confirms a distinctive legal name", () => {
    const decision = decideOrgMentionResolution({
      rawName: "Trace Fire Group",
      headerDomains: [],
      affiliatedOrganizationIds: [],
      documents: docs,
    });
    assert.equal(decision.status, "confirmed");
    assert.equal(decision.organizationId, "fire");
    assert.equal(decision.reason, "unique_distinctive_name");
  });

  it("confirms unique TCG when it is not a prefix of another org", () => {
    const decision = decideOrgMentionResolution({
      rawName: "TCG",
      headerDomains: [],
      affiliatedOrganizationIds: [],
      documents: docs,
    });
    assert.equal(decision.status, "confirmed");
    assert.equal(decision.organizationId, "consulting");
    assert.equal(decision.reason, "unique_surface_alias");
  });

  it("confirms a unique header domain", () => {
    const decision = decideOrgMentionResolution({
      rawName: "Trace",
      headerDomains: ["tracefiregroup.com"],
      affiliatedOrganizationIds: [],
      documents: docs,
    });
    assert.equal(decision.status, "confirmed");
    assert.equal(decision.organizationId, "fire");
    assert.equal(decision.reason, "unique_header_domain");
  });

  it("confirms a unique mailbox on the mention card", () => {
    const decision = decideOrgMentionResolution({
      rawName: "Trace",
      email: "bob@traceconsulting.com",
      headerDomains: [],
      affiliatedOrganizationIds: [],
      documents: docs,
    });
    assert.equal(decision.status, "confirmed");
    assert.equal(decision.organizationId, "consulting");
    assert.equal(decision.reason, "exact_key_email");
  });

  it("provisionally attaches a unique affiliated contact", () => {
    const decision = decideOrgMentionResolution({
      rawName: "Trace",
      headerDomains: [],
      affiliatedOrganizationIds: ["consulting"],
      documents: docs,
    });
    assert.equal(decision.status, "provisional");
    assert.equal(decision.organizationId, "consulting");
    assert.equal(decision.reason, "unique_affiliated_contact");
  });

  it("still confirms the legal name when a name-only duplicate entity exists", () => {
    const nameStub = org({
      id: "consulting-name",
      name: "Trace Consulting Group Ltd.",
    });
    const decision = decideOrgMentionResolution({
      rawName: "Trace Consulting Group Ltd.",
      headerDomains: [],
      affiliatedOrganizationIds: [],
      documents: [consulting, nameStub, fire, maintenance],
    });
    assert.equal(decision.status, "confirmed");
    assert.equal(decision.organizationId, "consulting");
    assert.equal(decision.reason, "unique_distinctive_name");
  });
});

describe("painted org mention surfaces", () => {
  it("keeps a contractor nickname that pass-3 org cards missed", () => {
    const surfaces = collectPaintedOrgMentionSurfaces({
      orgNames: ["Pliteq inc."],
      orgCardNames: ["Pliteq inc.", "ICC Property Management"],
      contractors: ["trace"],
      projectCardContractors: ["trace"],
    });
    assert.deepEqual(
      surfaces.map((name) => name.toLowerCase()).sort(),
      ["icc property management", "pliteq inc.", "trace"],
    );
    const missing = orgSurfacesMissingMentions(surfaces, [
      "pliteq inc",
      "icc property management",
    ]);
    assert.deepEqual(missing, ["trace"]);
  });

  it("does not duplicate a name that already has a mention row", () => {
    const missing = orgSurfacesMissingMentions(
      ["Trace", "trace", "Pliteq inc."],
      ["trace"],
    );
    assert.deepEqual(missing, ["Pliteq inc."]);
  });
});

describe("locateUniqueSurfaceSpan", () => {
  it("stores a span when Trace appears once", () => {
    const span = locateUniqueSurfaceSpan(
      "Please call Trace about the pumps.",
      "Trace",
    );
    assert.deepEqual(span, { start: 12, end: 17 });
  });

  it("leaves offsets null when Trace and the verb both appear", () => {
    const span = locateUniqueSurfaceSpan(
      "I talked to Trace and then you can trace the wire.",
      "Trace",
    );
    assert.equal(span, null);
  });
});
