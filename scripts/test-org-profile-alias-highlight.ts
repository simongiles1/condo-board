/**
 * Entity-profile org alias highlighting (all surfaces + focus/fade).
 * Run: npx tsx --test scripts/test-org-profile-alias-highlight.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  highlightMarkKind,
  orgProfilePreviewNeedles,
  snippetNeedlesForEmail,
} from "../lib/entities/entity-profile-shared";
import { highlightTextParts } from "../lib/organizations/registry-evidence-shared";

const primary = "Trace Consulting Group Ltd.";

describe("orgProfilePreviewNeedles", () => {
  it("keeps short aliases such as TCG and Trace", () => {
    const needles = orgProfilePreviewNeedles(primary, ["TCG", "Trace", primary]);
    assert.deepEqual(needles, [primary, "TCG", "Trace"]);
  });
});

describe("snippetNeedlesForEmail", () => {
  it("unions mention-span surfaces with every alias instead of replacing them", () => {
    const needles = snippetNeedlesForEmail({
      previewNeedles: orgProfilePreviewNeedles(primary, ["TCG", "Trace"]),
      highlightNeedles: ["Trace Consulting Group"],
      fallback: primary,
    });
    assert.ok(needles.includes(primary));
    assert.ok(needles.includes("TCG"));
    assert.ok(needles.includes("Trace"));
    assert.ok(needles.includes("Trace Consulting Group"));
  });
});

describe("highlightTextParts + highlightMarkKind", () => {
  it("paints TCG and Trace in the same snippet and fades siblings when one is focused", () => {
    const text =
      "Please call TCG about the roof. Trace will send the Trace Consulting Group Ltd. invoice.";
    const needles = orgProfilePreviewNeedles(primary, ["TCG", "Trace"]);
    const parts = highlightTextParts(text, needles);
    const hits = parts.filter((part) => part.hit);

    assert.deepEqual(
      hits.map((part) => part.text),
      ["TCG", "Trace", "Trace Consulting Group Ltd."],
    );
    assert.deepEqual(
      hits.map((part) => part.needle),
      ["TCG", "Trace", primary],
    );

    assert.equal(highlightMarkKind("TCG", "TCG"), "full");
    assert.equal(highlightMarkKind("Trace", "TCG"), "faded");
    assert.equal(highlightMarkKind(primary, "TCG"), "faded");
    assert.equal(highlightMarkKind("TCG", null), "full");
    assert.equal(highlightMarkKind("Trace", null), "full");
  });
});
