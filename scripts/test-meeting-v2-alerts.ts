/**
 * Meeting V2 overview alerts: blocking severity, newest-first, lastError dedupe.
 * Run: npx tsx --test scripts/test-meeting-v2-alerts.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMeetingV2Alerts,
  type MeetingV2ExtractionQuality,
} from "../lib/meeting-v2/extraction-diagnostics";

function quality(
  overrides: Partial<MeetingV2ExtractionQuality> = {},
): MeetingV2ExtractionQuality {
  return {
    mode: "section_fallback",
    likelyIncomplete: true,
    pageLikeTitleCount: 0,
    suspiciousTitleCount: 0,
    note: "DeepSeek ran, but the output still looks like one PDF section per agenda item instead of real meeting topics.",
    issueCode: "section_shaped_output",
    extractorUsed: "deepseek_incremental",
    deepSeekKeyConfigured: true,
    agendaChunkSnapshots: 4,
    extractionRun: {
      extractor: "deepseek_incremental",
      deepSeekKeyConfigured: true,
      completedAt: "2026-09-04T20:00:00.000Z",
      agendaItemCount: 31,
    },
    ...overrides,
  };
}

describe("buildMeetingV2Alerts", () => {
  it("treats section-shaped output as a pipeline stop, not a warning", () => {
    const alerts = buildMeetingV2Alerts({
      extractionQuality: quality(),
      integrityNote: "Evidence contexts are missing for one or more agenda items.",
      isConsistent: false,
      lastError:
        "DeepSeek ran, but the output still looks like one PDF section per agenda item instead of real meeting topics.",
      pipelineState: "gathering_evidence",
      updatedAt: "2026-09-04T21:00:00.000Z",
    });

    const shape = alerts.find((alert) => alert.id === "section-shaped-output");
    const integrity = alerts.find((alert) => alert.id === "pipeline-progress");
    assert.ok(shape);
    assert.equal(shape.severity, "error");
    assert.equal(shape.blocksPipeline, true);
    assert.ok(integrity);
    assert.equal(integrity.severity, "error");
    assert.equal(integrity.blocksPipeline, true);
  });

  it("omits a lastError that restates the extraction quality note", () => {
    const alerts = buildMeetingV2Alerts({
      extractionQuality: quality(),
      integrityNote: "Evidence contexts are missing.",
      isConsistent: false,
      lastError:
        "DeepSeek ran, but the output still looks like one PDF section per agenda item instead of real meeting topics.",
      pipelineState: "gathering_evidence",
      updatedAt: "2026-09-04T21:00:00.000Z",
    });

    assert.equal(
      alerts.some((alert) => alert.id === "last-error"),
      false,
    );
  });

  it("lists newest first and marks the first card as latest", () => {
    const alerts = buildMeetingV2Alerts({
      extractionQuality: quality(),
      integrityNote: "Evidence contexts are missing.",
      isConsistent: false,
      lastError: "A later distinct pipeline failure.",
      pipelineState: "gathering_evidence",
      updatedAt: "2026-09-04T21:00:00.000Z",
    });

    assert.ok(alerts.length >= 2);
    assert.equal(alerts[0]?.id, "last-error");
    assert.equal(alerts[0]?.severity, "error");
    assert.equal(alerts[0]?.occurredAt, "2026-09-04T21:00:00.000Z");
    assert.ok(
      Date.parse(alerts[0]?.occurredAt ?? "") >=
        Date.parse(alerts[alerts.length - 1]?.occurredAt ?? ""),
    );
  });
});
