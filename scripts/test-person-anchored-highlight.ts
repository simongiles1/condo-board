/**
 * Person-anchored highlight tests.
 * Run: npx tsx --test scripts/test-person-anchored-highlight.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildEvidenceHighlightSpans,
  buildPersonAnchoredMentionSpans,
  textHasPersonAnchoredMention,
} from "../lib/contacts/person-anchored-highlight";
import { computeThreadUniqueBodies } from "../lib/email/thread-unique-content";
import { buildHighlightedSegments } from "../lib/email-analysis/contact-highlight-shared";

describe("person-anchored title mentions", () => {
  const haider = { firstName: "Haider", lastName: "Mukadam" };

  it("highlights Condominium Manager only near Haider, not another person", () => {
    const text = [
      "Haider Mukadam, Condominium Manager",
      "Jane Doe, Condominium Manager at Building X",
    ].join("\n");

    const spans = buildPersonAnchoredMentionSpans({
      text,
      person: haider,
      mentionText: "Condominium Manager",
      mentionType: "job_title",
    });

    const titleSpans = spans.filter((s) => s.type === "job_title");
    assert.equal(titleSpans.length, 1);
    assert.equal(titleSpans[0]!.start, text.indexOf("Condominium Manager"));
    assert.ok(
      titleSpans[0]!.end! < text.indexOf("Jane Doe"),
      "should not mark Jane's title",
    );

    const segments = buildHighlightedSegments(text, spans);
    const markedTitles = segments.filter((s) => s.type === "job_title");
    assert.equal(markedTitles.length, 1);
    assert.equal(markedTitles[0]!.text, "Condominium Manager");
  });

  it("treats signature-style name-then-title on the next line as anchored", () => {
    const text = "Haider Mukadam\nCondominium Manager\nICC Property Management";
    assert.equal(
      textHasPersonAnchoredMention({
        text,
        person: haider,
        mentionText: "Condominium Manager",
      }),
      true,
    );
  });

  it("treats same-line title+name as anchored even beyond proximity", () => {
    const pad = "x".repeat(300);
    const text = `Haider Mukadam${pad}Condominium Manager\nOther line`;
    assert.equal(
      textHasPersonAnchoredMention({
        text,
        person: haider,
        mentionText: "Condominium Manager",
      }),
      true,
    );
  });

  it("does not treat a far off-line title as belonging to the person", () => {
    const text = [
      "Haider Mukadam greets the board.",
      "x".repeat(200),
      "Someone else is the Condominium Manager elsewhere.",
    ].join("\n");
    assert.equal(
      textHasPersonAnchoredMention({
        text,
        person: haider,
        mentionText: "Condominium Manager",
      }),
      false,
    );
  });

  it("does not count a title that only appears in quoted reply history", () => {
    const original = {
      id: "m1",
      receivedAt: "2026-06-02T12:00:00.000Z",
      bodyText: [
        "Many thanks,",
        "",
        "Haider Mukadam, OLCM-L",
        "Assistant Condominium Manager",
        "",
        "Studio on Richmond",
      ].join("\n"),
    };
    const reply = {
      id: "m2",
      receivedAt: "2026-06-17T12:00:00.000Z",
      bodyText: [
        "Hi Haider,",
        "",
        "Thanks for the explanation.",
        "",
        "On Jun 2 Haider wrote:",
        "> Many thanks,",
        "> Haider Mukadam, OLCM-L",
        "> Assistant Condominium Manager",
      ].join("\n"),
    };

    const unique = computeThreadUniqueBodies([original, reply]);
    assert.equal(
      textHasPersonAnchoredMention({
        text: unique.get("m1") ?? "",
        person: haider,
        mentionText: "Assistant Condominium Manager",
      }),
      true,
    );
    assert.equal(
      textHasPersonAnchoredMention({
        text: unique.get("m2") ?? "",
        person: haider,
        mentionText: "Assistant Condominium Manager",
      }),
      false,
    );
  });

  it("buildEvidenceHighlightSpans marks name + title together", () => {
    const text =
      "Please contact Haider Mukadam, Assistant Condominium Manager.";
    const spans = buildEvidenceHighlightSpans({
      text,
      person: haider,
      mentionText: "Assistant Condominium Manager",
      mentionType: "job_title",
    });
    assert.ok(spans.some((s) => s.type === "job_title"));
    assert.ok(spans.some((s) => s.type === "contact_name"));
  });
});
