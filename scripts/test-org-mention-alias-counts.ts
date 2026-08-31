/**
 * Per-alias organization mention email counts.
 * Run: npx tsx --test scripts/test-org-mention-alias-counts.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatAliasMentionEmailCount,
  mentionEmailCountForAlias,
  orgMentionNameKey,
  tallyResolvedOrgMentionEmails,
} from "../lib/organizations/mention-shared";

describe("tallyResolvedOrgMentionEmails", () => {
  it("counts distinct emails per alias without summing into the org total", () => {
    const tallied = tallyResolvedOrgMentionEmails([
      {
        organizationId: "consulting",
        nameKey: orgMentionNameKey("TCG"),
        sourceEmailId: "e1",
      },
      {
        organizationId: "consulting",
        nameKey: orgMentionNameKey("TCG"),
        sourceEmailId: "e1",
      },
      {
        organizationId: "consulting",
        nameKey: orgMentionNameKey("Trace"),
        sourceEmailId: "e2",
      },
      {
        organizationId: "consulting",
        nameKey: orgMentionNameKey("Trace Consulting Group Ltd."),
        sourceEmailId: "e3",
      },
    ]);

    assert.equal(tallied.byOrganizationId.get("consulting"), 3);
    assert.equal(
      tallied.byOrganizationIdAndNameKey.get("consulting")?.get("tcg"),
      1,
    );
    assert.equal(
      tallied.byOrganizationIdAndNameKey.get("consulting")?.get("trace"),
      1,
    );
    const aliasSum = [...(tallied.byOrganizationIdAndNameKey.get("consulting") ?? [])]
      .map(([, count]) => count)
      .reduce((sum, count) => sum + count, 0);
    assert.equal(aliasSum, 3);
    assert.notEqual(aliasSum, tallied.byOrganizationId.get("consulting")! + 1);
  });

  it("keeps org total as a union when one email mentions two aliases", () => {
    const tallied = tallyResolvedOrgMentionEmails([
      {
        organizationId: "consulting",
        nameKey: orgMentionNameKey("TCG"),
        sourceEmailId: "e1",
      },
      {
        organizationId: "consulting",
        nameKey: orgMentionNameKey("Trace"),
        sourceEmailId: "e1",
      },
    ]);

    assert.equal(tallied.byOrganizationId.get("consulting"), 1);
    assert.equal(
      tallied.byOrganizationIdAndNameKey.get("consulting")?.get("tcg"),
      1,
    );
    assert.equal(
      tallied.byOrganizationIdAndNameKey.get("consulting")?.get("trace"),
      1,
    );
  });

  it("skips rows without a resolved org or source email", () => {
    const tallied = tallyResolvedOrgMentionEmails([
      { organizationId: null, nameKey: "tcg", sourceEmailId: "e1" },
      { organizationId: "consulting", nameKey: "tcg", sourceEmailId: null },
      { organizationId: "consulting", nameKey: null, sourceEmailId: "e2" },
    ]);

    assert.equal(tallied.byOrganizationId.get("consulting"), 1);
    assert.equal(
      tallied.byOrganizationIdAndNameKey.get("consulting")?.get("tcg"),
      undefined,
    );
  });
});

describe("mentionEmailCountForAlias", () => {
  it("looks up by normalized name key and treats missing as zero", () => {
    const counts = { tcg: 12, trace: 2 };
    assert.equal(mentionEmailCountForAlias(counts, "TCG"), 12);
    assert.equal(mentionEmailCountForAlias(counts, "Trace"), 2);
    assert.equal(mentionEmailCountForAlias(counts, "Trace Consulting"), 0);
    assert.equal(mentionEmailCountForAlias(undefined, "TCG"), 0);
  });
});

describe("formatAliasMentionEmailCount", () => {
  it("shows an em dash when zero", () => {
    assert.equal(formatAliasMentionEmailCount(0), "—");
    assert.equal(formatAliasMentionEmailCount(1), "1 email");
    assert.equal(formatAliasMentionEmailCount(12), "12 emails");
  });
});
