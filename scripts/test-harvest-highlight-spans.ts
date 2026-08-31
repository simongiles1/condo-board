/**
 * Harvest highlight span nesting tests.
 * Run: npx tsx --test scripts/test-harvest-highlight-spans.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildHarvestMarkTree,
  findFlexibleQuoteRange,
  harvestMentionPaintsFromPayload,
  locateSentenceQuoteRange,
  resolveHarvestSpans,
  resolveSubjectHarvestSpans,
} from "../lib/email-analysis/harvest-highlight-spans";

describe("findFlexibleQuoteRange", () => {
  it("matches verbatim quotes case-insensitively", () => {
    const text = "Hello Shawna, additional insulation was identified.";
    const range = findFlexibleQuoteRange(
      text,
      "Additional insulation was identified",
    );
    assert.ok(range);
    assert.equal(text.slice(range!.start, range!.end), "additional insulation was identified");
  });

  it("matches quotes when whitespace differs", () => {
    const text = "Applied System  Technology was requested";
    const range = findFlexibleQuoteRange(
      text,
      "Applied System Technology was requested",
    );
    assert.ok(range);
    assert.equal(range!.start, 0);
  });
});

describe("buildHarvestMarkTree", () => {
  it("nests a contact name inside a longer event quote", () => {
    const text = "TCG attended Unit 211 with Applied System Technology.";
    const tree = buildHarvestMarkTree(
      resolveHarvestSpans({
        text,
        contact: {
          contact_names: [],
          phones: [],
          job_titles: [],
          company_names: ["Applied System Technology"],
        },
        events: [
          {
            type: "maintenance",
            title: "Insulation: piping",
            sourceQuote: "TCG attended Unit 211 with Applied System Technology.",
          },
        ],
      }),
    );

    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.layers[0]!.group, "event");
    assert.equal(tree[0]!.children.length, 1);
    assert.equal(tree[0]!.children[0]!.layers[0]!.group, "contact");
    assert.equal(
      text.slice(tree[0]!.children[0]!.start, tree[0]!.children[0]!.end),
      "Applied System Technology",
    );
  });

  it("stacks contact company and org name on the same range", () => {
    const text = "Call Applied System Technology tomorrow.";
    const tree = buildHarvestMarkTree(
      resolveHarvestSpans({
        text,
        contact: {
          contact_names: [],
          phones: [],
          job_titles: [],
          company_names: ["Applied System Technology"],
        },
        org: {
          organization_names: ["Applied System Technology"],
          phones: [],
          organization_roles: [],
          websites: [],
        },
      }),
    );

    assert.equal(tree.length, 1);
    const groups = tree[0]!.layers.map((layer) => layer.group);
    assert.deepEqual(groups, ["contact", "organization"]);
    assert.equal(tree[0]!.layers[0]!.group, "contact");
  });

  it("splits a partial overlap so the shorter span stays intact", () => {
    const text = "abcdefghij";
    const tree = buildHarvestMarkTree([
      {
        group: "event",
        type: "maintenance",
        start: 0,
        end: 7,
        title: "event",
      },
      {
        group: "contact",
        type: "contact_name",
        start: 5,
        end: 10,
        title: "name",
      },
    ]);

    const groups = tree.map((node) => node.layers[0]!.group);
    assert.ok(groups.includes("event"));
    assert.ok(groups.includes("contact"));
    const contact = tree.find((node) => node.layers[0]!.group === "contact")!;
    assert.equal(contact.start, 5);
    assert.equal(contact.end, 10);
  });

  it("clips a bloated to-do source quote to the ask sentence", () => {
    const ask = "Please send the AGM package to the owners by Friday.";
    const text = `Hi Paul.\n\n${ask}\nThe rest of this email is a long status dump.`;
    const tree = buildHarvestMarkTree(
      resolveHarvestSpans({
        text,
        todos: [
          {
            title: "Send AGM package",
            sourceQuote: text,
          },
        ],
      }),
    );
    const todo = tree.find((node) => node.layers[0]!.group === "todo");
    assert.ok(todo);
    assert.equal(text.slice(todo!.start, todo!.end), ask);
  });
});

describe("locateSentenceQuoteRange", () => {
  it("clips a whole-email quote to the extracting sentence, skipping a greeting", () => {
    const text = [
      "Hi Paul.",
      "",
      "Please send the AGM package to the owners by Friday.",
      "The rest of this email is a long status dump about maglocks and elevators and boilers and the garage drain that does not belong on the to-do highlight.",
    ].join("\n");
    const range = locateSentenceQuoteRange(text, text);
    assert.ok(range);
    assert.equal(
      text.slice(range!.start, range!.end),
      "Please send the AGM package to the owners by Friday.",
    );
  });

  it("keeps a short verbatim quote and expands it to the sentence", () => {
    const text = "Management is directed to follow up with ICC about the maglock.";
    const range = locateSentenceQuoteRange(
      text,
      "follow up with ICC about the maglock",
    );
    assert.ok(range);
    assert.equal(text.slice(range!.start, range!.end), text);
  });

  it("does not paint a paragraph-length stored quote as the whole unique body", () => {
    const ask = "Can you please confirm whether the reserve fund study is still on track for September?";
    const filler =
      " Meanwhile we also discussed the roof, the garage, the elevators, the boilers, the chiller, the fountain, and several invoices that are unrelated to this ask.";
    const text = `${ask}${filler}`;
    const range = locateSentenceQuoteRange(text, text);
    assert.ok(range);
    const painted = text.slice(range!.start, range!.end);
    assert.ok(painted.length < text.length);
    assert.ok(painted.includes("reserve fund study"));
    assert.ok(!painted.includes("several invoices"));
  });
});

describe("harvest mention paints", () => {
  it("paints only the unique stored span, not every Trace substring", () => {
    const text = "Please call Trace about the pumps, then trace the wire.";
    const paints = harvestMentionPaintsFromPayload({
      org: [
        {
          id: "m1",
          rawName: "Trace",
          start: 12,
          end: 17,
          status: "unresolved",
          resolvedOrganizationId: null,
          candidates: [
            { id: "consulting", name: "Trace Consulting" },
            { id: "fire", name: "Trace Fire" },
          ],
        },
      ],
    });
    const spans = resolveHarvestSpans({
      text,
      org: {
        organization_names: ["Trace"],
        phones: [],
        organization_roles: [],
        websites: [],
      },
      mentionPaints: paints,
    });
    const orgNameSpans = spans.filter((span) => span.type === "organization_name");
    assert.equal(orgNameSpans.length, 1);
    assert.equal(text.slice(orgNameSpans[0]!.start, orgNameSpans[0]!.end), "Trace");
    assert.equal(orgNameSpans[0]!.unresolved, true);
  });

  it("locates a unique mention when stored offsets are missing", () => {
    const text = "Please go ahead with the proposal you presented from trace";
    const paints = harvestMentionPaintsFromPayload(
      {
        org: [
          {
            id: "m1",
            rawName: "trace",
            start: null,
            end: null,
            status: "unresolved",
            resolvedOrganizationId: null,
            candidates: [
              { id: "consulting", name: "Trace Consulting Group" },
              { id: "fire", name: "Trace Fire" },
            ],
          },
        ],
      },
      text,
    );
    assert.equal(paints.length, 1);
    assert.equal(text.slice(paints[0]!.start, paints[0]!.end), "trace");
    assert.equal(paints[0]!.unresolved, true);
    assert.equal(paints[0]!.candidates.length, 2);
  });
});

describe("subject harvest spans", () => {
  const subject =
    "URGENT: TSCC 2573 Board Meeting with Trace and HVAC contractors";

  it("paints a subject-only org mention with unresolved styling", () => {
    const spans = resolveSubjectHarvestSpans({
      text: subject,
      org: {
        organization_names: ["Trace"],
        phones: [],
        organization_roles: [],
        websites: [],
      },
      mentions: {
        org: [
          {
            id: "m1",
            rawName: "Trace",
            start: null,
            end: null,
            status: "unresolved",
            resolvedOrganizationId: null,
            candidates: [
              { id: "consulting", name: "Trace Consulting" },
              { id: "fire", name: "Trace Fire" },
            ],
          },
        ],
      },
    });
    const orgNameSpans = spans.filter((span) => span.type === "organization_name");
    assert.equal(orgNameSpans.length, 1);
    assert.equal(subject.slice(orgNameSpans[0]!.start, orgNameSpans[0]!.end), "Trace");
    assert.equal(orgNameSpans[0]!.unresolved, true);
    assert.equal(orgNameSpans[0]!.mentionId, "m1");
  });

  it("paints a confirmed mention as a solid (not unresolved) mark", () => {
    const spans = resolveSubjectHarvestSpans({
      text: subject,
      mentions: {
        org: [
          {
            id: "m2",
            rawName: "Trace",
            start: 400,
            end: 405,
            status: "confirmed",
            resolvedOrganizationId: "consulting",
            candidates: [],
          },
        ],
      },
    });
    assert.equal(spans.length, 1);
    assert.equal(subject.slice(spans[0]!.start, spans[0]!.end), "Trace");
    assert.equal(spans[0]!.unresolved, false);
  });

  it("paints short extraction names in the subject when mentions are absent", () => {
    const spans = resolveSubjectHarvestSpans({
      text: subject,
      org: {
        organization_names: ["Trace"],
        phones: [],
        organization_roles: [],
        websites: [],
      },
    });
    const orgNameSpans = spans.filter((span) => span.type === "organization_name");
    assert.equal(orgNameSpans.length, 1);
    assert.equal(subject.slice(orgNameSpans[0]!.start, orgNameSpans[0]!.end), "Trace");
    assert.equal(orgNameSpans[0]!.unresolved, undefined);
  });

  it("does not paint Trace inside Traceroute", () => {
    const spans = resolveSubjectHarvestSpans({
      text: "Follow up on Traceroute logs",
      org: {
        organization_names: ["Trace"],
        phones: [],
        organization_roles: [],
        websites: [],
      },
      mentions: {
        org: [
          {
            id: "m3",
            rawName: "Trace",
            start: null,
            end: null,
            status: "unresolved",
            resolvedOrganizationId: null,
            candidates: [],
          },
        ],
      },
    });
    assert.equal(spans.length, 0);
  });

  it("still paints other extraction names when a mention covers Trace", () => {
    const spans = resolveSubjectHarvestSpans({
      text: subject,
      org: {
        organization_names: ["Trace", "TSCC 2573"],
        phones: [],
        organization_roles: [],
        websites: [],
      },
      mentions: {
        org: [
          {
            id: "m1",
            rawName: "Trace",
            start: null,
            end: null,
            status: "unresolved",
            resolvedOrganizationId: null,
            candidates: [],
          },
        ],
      },
    });
    const painted = spans.map((span) => subject.slice(span.start, span.end)).sort();
    assert.deepEqual(painted, ["TSCC 2573", "Trace"]);
    const trace = spans.find((span) => span.mentionId === "m1");
    assert.equal(trace?.unresolved, true);
  });
});

describe("project contractor vs organization", () => {
  const emptyProject = {
    project_names: [] as string[],
    year_hints: [] as string[],
    phases: [] as string[],
    contractors: [] as string[],
    locations: [] as string[],
  };

  it("paints a unique vendor nickname as organization, not project", () => {
    const text = "Please go ahead with the proposal you presented from trace";
    const spans = resolveHarvestSpans({
      text,
      org: {
        organization_names: ["Trace"],
        phones: [],
        organization_roles: [],
        websites: [],
      },
      project: {
        ...emptyProject,
        project_names: ["trace"],
        contractors: ["trace"],
      },
    });
    const painted = spans.filter(
      (span) => text.slice(span.start, span.end).toLowerCase() === "trace",
    );
    assert.equal(painted.length, 1);
    assert.equal(painted[0]!.group, "organization");
    assert.equal(painted[0]!.type, "organization_name");
    assert.equal(
      spans.some((span) => span.group === "project"),
      false,
    );
  });

  it("reclassifies a project contractor when org harvest missed the nickname", () => {
    const text = "Please go ahead with the proposal you presented from trace";
    const spans = resolveHarvestSpans({
      text,
      project: {
        ...emptyProject,
        contractors: ["trace"],
      },
    });
    assert.equal(spans.length, 1);
    assert.equal(spans[0]!.group, "organization");
    assert.equal(text.slice(spans[0]!.start, spans[0]!.end), "trace");
  });

  it("does not paint a non-unique contractor nickname as org or project", () => {
    const text = "Please call Trace about the pumps, then trace the wire.";
    const spans = resolveHarvestSpans({
      text,
      project: {
        ...emptyProject,
        contractors: ["Trace"],
      },
    });
    assert.equal(spans.length, 0);
  });

  it("keeps a work-name project paint beside a contractor-as-org", () => {
    const text =
      "Applied System Technology will start riser replacement next week.";
    const spans = resolveHarvestSpans({
      text,
      org: {
        organization_names: ["Applied System Technology"],
        phones: [],
        organization_roles: [],
        websites: [],
      },
      project: {
        ...emptyProject,
        project_names: ["riser replacement"],
        contractors: ["Applied System Technology"],
      },
    });
    const ast = spans.filter(
      (span) => text.slice(span.start, span.end) === "Applied System Technology",
    );
    assert.ok(ast.length >= 1);
    assert.ok(ast.every((span) => span.group === "organization"));
    const work = spans.find(
      (span) => text.slice(span.start, span.end) === "riser replacement",
    );
    assert.equal(work?.group, "project");
    assert.equal(work?.type, "project_name");
  });

  it("does not stack a project contractor layer on a subject org mention", () => {
    const subject =
      "URGENT: TSCC 2573 Board Meeting with Trace and HVAC contractors";
    const spans = resolveSubjectHarvestSpans({
      text: subject,
      org: {
        organization_names: ["Trace"],
        phones: [],
        organization_roles: [],
        websites: [],
      },
      project: {
        ...emptyProject,
        contractors: ["Trace"],
      },
      mentions: {
        org: [
          {
            id: "m1",
            rawName: "Trace",
            start: null,
            end: null,
            status: "unresolved",
            resolvedOrganizationId: null,
            candidates: [
              { id: "consulting", name: "Trace Consulting Group" },
              { id: "fire", name: "Trace Fire" },
            ],
          },
        ],
      },
    });
    const trace = spans.filter(
      (span) => subject.slice(span.start, span.end) === "Trace",
    );
    assert.equal(trace.length, 1);
    assert.equal(trace[0]!.group, "organization");
    assert.equal(trace[0]!.unresolved, true);
    assert.equal(trace[0]!.mentionId, "m1");
    assert.equal(trace[0]!.candidates?.length, 2);
    assert.equal(
      spans.some((span) => span.group === "project"),
      false,
    );
  });
});
