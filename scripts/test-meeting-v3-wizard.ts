/**
 * V3 wizard stage order.
 * Run: npx tsx --test scripts/test-meeting-v3-wizard.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MEETINGS_V3_WIZARD_STEPS, meetingsV3WizardProgress, parseMeetingsV3WizardStepId } from "../lib/meeting-v3/wizard";

const base = {
  agendaItemCount: 0,
  attachmentsLinked: false,
  factsResolved: false,
  transcriptSegmented: false,
  factsGrouped: false,
  agendaContentEndsAtPage: null as number | null,
};

describe("v3 wizard progress", () => {
  it("starts on extract before any pages exist", () => {
    const progress = meetingsV3WizardProgress({
      ...base,
      pageCount: 0,
      correctedPageCount: 0,
    });
    assert.equal(progress.activeId, "extract");
    assert.equal(progress.finished, false);
    assert.deepEqual(
      progress.steps.map((step) => step.state),
      ["current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"],
    );
  });

  it("moves to the agenda only after every agenda page is corrected", () => {
    const partial = meetingsV3WizardProgress({
      ...base,
      pageCount: 4,
      correctedPageCount: 3,
    });
    assert.equal(partial.activeId, "extract");

    const ready = meetingsV3WizardProgress({
      ...base,
      pageCount: 4,
      correctedPageCount: 4,
    });
    assert.equal(ready.activeId, "agenda");
    assert.deepEqual(
      ready.steps.map((step) => step.state),
      ["complete", "current", "upcoming", "upcoming", "upcoming", "upcoming"],
    );
  });

  it("finishes extract when agenda pages are corrected even if attachment pages exist", () => {
    const progress = meetingsV3WizardProgress({
      ...base,
      pageCount: 216,
      correctedPageCount: 12,
      agendaContentEndsAtPage: 12,
    });
    assert.equal(progress.activeId, "agenda");
    assert.deepEqual(
      progress.steps.map((step) => step.state),
      ["complete", "current", "upcoming", "upcoming", "upcoming", "upcoming"],
    );
  });

  it("moves to attachments once the agenda exists", () => {
    const progress = meetingsV3WizardProgress({
      ...base,
      pageCount: 4,
      correctedPageCount: 4,
      agendaItemCount: 12,
    });
    assert.equal(progress.finished, false);
    assert.equal(progress.activeId, "attachments");
    assert.deepEqual(
      progress.steps.map((step) => step.state),
      ["complete", "complete", "current", "upcoming", "upcoming", "upcoming"],
    );
  });

  it("moves to facts once attachment pages have been linked", () => {
    const progress = meetingsV3WizardProgress({
      ...base,
      pageCount: 4,
      correctedPageCount: 4,
      agendaItemCount: 12,
      attachmentsLinked: true,
    });
    assert.equal(progress.finished, false);
    assert.equal(progress.activeId, "facts");
    assert.deepEqual(
      progress.steps.map((step) => step.state),
      ["complete", "complete", "complete", "current", "upcoming", "upcoming"],
    );
  });

  it("moves to the transcript once quoted facts have been stored", () => {
    const progress = meetingsV3WizardProgress({
      ...base,
      pageCount: 4,
      correctedPageCount: 4,
      agendaItemCount: 12,
      attachmentsLinked: true,
      factsResolved: true,
    });
    assert.equal(progress.finished, false);
    assert.equal(progress.activeId, "transcript");
    assert.deepEqual(
      progress.steps.map((step) => step.state),
      ["complete", "complete", "complete", "complete", "current", "upcoming"],
    );
  });

  it("moves to sources once the transcript has been segmented", () => {
    const progress = meetingsV3WizardProgress({
      ...base,
      pageCount: 4,
      correctedPageCount: 4,
      agendaItemCount: 12,
      attachmentsLinked: true,
      factsResolved: true,
      transcriptSegmented: true,
    });
    assert.equal(progress.finished, false);
    assert.equal(progress.activeId, "sources");
    assert.deepEqual(
      progress.steps.map((step) => step.state),
      ["complete", "complete", "complete", "complete", "complete", "current"],
    );
  });

  it("finishes once quoted facts have been grouped by source", () => {
    const progress = meetingsV3WizardProgress({
      ...base,
      pageCount: 4,
      correctedPageCount: 4,
      agendaItemCount: 12,
      attachmentsLinked: true,
      factsResolved: true,
      transcriptSegmented: true,
      factsGrouped: true,
    });
    assert.equal(progress.finished, true);
    assert.equal(progress.activeId, "sources");
    assert.equal(progress.completedCount, MEETINGS_V3_WIZARD_STEPS.length);
  });

  it("does not treat an agenda as done when the extract is incomplete", () => {
    const progress = meetingsV3WizardProgress({
      ...base,
      pageCount: 4,
      correctedPageCount: 1,
      agendaItemCount: 12,
      attachmentsLinked: true,
      factsResolved: true,
    });
    assert.equal(progress.activeId, "extract");
    assert.equal(progress.steps[1]?.state, "upcoming");
    assert.equal(progress.steps[2]?.state, "upcoming");
    assert.equal(progress.steps[3]?.state, "upcoming");
    assert.equal(progress.steps[4]?.state, "upcoming");
    assert.equal(progress.steps[5]?.state, "upcoming");
  });
});

describe("v3 wizard step query param", () => {
  it("parses known step ids and rejects unknown values", () => {
    assert.equal(parseMeetingsV3WizardStepId("attachments"), "attachments");
    assert.equal(parseMeetingsV3WizardStepId("sources"), "sources");
    assert.equal(parseMeetingsV3WizardStepId(""), null);
    assert.equal(parseMeetingsV3WizardStepId("agenda-extra"), null);
    assert.equal(parseMeetingsV3WizardStepId(null), null);
  });
});
