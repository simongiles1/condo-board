/**
 * V3 wizard stage order.
 * Run: npx tsx --test scripts/test-meeting-v3-wizard.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MEETINGS_V3_WIZARD_STEPS, meetingsV3WizardProgress } from "../lib/meeting-v3/wizard";

describe("v3 wizard progress", () => {
  it("starts on extract before any pages exist", () => {
    const progress = meetingsV3WizardProgress({
      pageCount: 0,
      correctedPageCount: 0,
      agendaItemCount: 0,
    });
    assert.equal(progress.activeId, "extract");
    assert.equal(progress.finished, false);
    assert.deepEqual(progress.steps.map((step) => step.state), ["current", "upcoming"]);
  });

  it("moves to the agenda only after every page is corrected", () => {
    const partial = meetingsV3WizardProgress({
      pageCount: 4,
      correctedPageCount: 3,
      agendaItemCount: 0,
    });
    assert.equal(partial.activeId, "extract");

    const ready = meetingsV3WizardProgress({
      pageCount: 4,
      correctedPageCount: 4,
      agendaItemCount: 0,
    });
    assert.equal(ready.activeId, "agenda");
    assert.deepEqual(ready.steps.map((step) => step.state), ["complete", "current"]);
  });

  it("finishes on the last stage once the agenda exists", () => {
    const progress = meetingsV3WizardProgress({
      pageCount: 4,
      correctedPageCount: 4,
      agendaItemCount: 12,
    });
    assert.equal(progress.finished, true);
    assert.equal(progress.activeId, "agenda");
    assert.equal(progress.completedCount, MEETINGS_V3_WIZARD_STEPS.length);
  });

  it("does not treat an agenda as done when the extract is incomplete", () => {
    const progress = meetingsV3WizardProgress({
      pageCount: 4,
      correctedPageCount: 1,
      agendaItemCount: 12,
    });
    assert.equal(progress.activeId, "extract");
    assert.equal(progress.steps[1]?.state, "upcoming");
  });
});
