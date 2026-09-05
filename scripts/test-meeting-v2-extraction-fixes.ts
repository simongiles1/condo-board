/**
 * Tests for Meeting V2 extraction quality detection, agenda sorting, and Docling helpers.
 * Run: npx tsx --test scripts/test-meeting-v2-extraction-fixes.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeExtractionQuality } from "../lib/meeting-v2/extraction-diagnostics";
import { inferHeadingFromMarkdown, isEmailAttachmentPage } from "../lib/meeting-v2/pdf";

describe("analyzeExtractionQuality", () => {
  it("does not false-positive halt on DeepSeek items with sourceSectionId", () => {
    // 31 extracted items from DeepSeek, each having sourceSectionId populated from page mapping
    const extractedItems = [
      { title: "Approval of Previous Minutes: June 30, 2026", sourceSectionId: "sec-2", itemType: "approval_of_previous_minutes" },
      { title: "Booster Pump", sourceSectionId: "sec-2", itemType: "discussion_approval" },
      { title: "Meeting with Eng. Ryan Ratcliff from TCG to discuss projects", sourceSectionId: "sec-2", itemType: "guest_presentation" },
      { title: "Review and approval of the unaudited financial statements for June 2026", sourceSectionId: "sec-2", itemType: "financial_matters" },
      { title: "Riser Expansion", sourceSectionId: "sec-2", itemType: "discussion_approval" },
      { title: "Generator Fuel Delivery Upgrade", sourceSectionId: "sec-2", itemType: "discussion_approval" },
      { title: "Ratification of email decisions", sourceSectionId: "sec-3", itemType: "ratification_line_item" },
      { title: "Items completed", sourceSectionId: "sec-3", itemType: "completed_items" },
      { title: "Items for discussion", sourceSectionId: "sec-3", itemType: "discussion_topic" },
    ];

    const documentSections = [
      { title: "Management Report" },
      { title: "TSCC 2517" },
      { title: "Property Management Report:" },
      { title: "B. Review and approval of projects :" },
      { title: "Please find the Trace Consulting Group tender analysis report" },
    ];

    const result = analyzeExtractionQuality({
      agendaItems: extractedItems,
      documentSectionCount: documentSections.length,
      documentSections,
      extractionRun: {
        extractor: "deepseek_incremental",
        deepSeekKeyConfigured: true,
        completedAt: new Date().toISOString(),
        agendaItemCount: extractedItems.length,
      },
      agendaChunkSnapshots: 4,
      deepSeekKeyConfigured: true,
      lastError: null,
    });

    assert.equal(result.issueCode, "none");
    assert.equal(result.mode, "semantic");
    assert.equal(result.likelyIncomplete, false);
  });

  it("detects literal section fallback when items are agenda_section or match section titles", () => {
    const fallbackItems = [
      { title: "Management Report", sourceSectionId: "sec-1", itemType: "agenda_section" },
      { title: "TSCC 2517", sourceSectionId: "sec-2", itemType: "agenda_section" },
      { title: "Property Management Report", sourceSectionId: "sec-3", itemType: "agenda_section" },
      { title: "Review and approval of projects", sourceSectionId: "sec-4", itemType: "agenda_section" },
    ];

    const documentSections = [
      { title: "Management Report" },
      { title: "TSCC 2517" },
      { title: "Property Management Report" },
      { title: "Review and approval of projects" },
    ];

    const result = analyzeExtractionQuality({
      agendaItems: fallbackItems,
      documentSectionCount: documentSections.length,
      documentSections,
      extractionRun: {
        extractor: "section_fallback",
        deepSeekKeyConfigured: false,
        completedAt: new Date().toISOString(),
        agendaItemCount: fallbackItems.length,
      },
      agendaChunkSnapshots: 0,
      deepSeekKeyConfigured: false,
      lastError: null,
    });

    assert.equal(result.issueCode, "no_deepseek_key");
    assert.equal(result.mode, "section_fallback");
    assert.equal(result.likelyIncomplete, true);
  });
});

describe("inferHeadingFromMarkdown", () => {
  it("extracts markdown headers over random body lines", () => {
    const md = `TSCC 2517
# AGENDA
Call to Order
1. Meeting with Eng. Ryan Ratcliff`;

    assert.equal(inferHeadingFromMarkdown(md), "AGENDA");
  });

  it("extracts subheadings when no top-level header exists", () => {
    const md = `Page header text
## Property Management Report:
Items discussed today...`;

    assert.equal(inferHeadingFromMarkdown(md), "Property Management Report:");
  });
});

describe("isEmailAttachmentPage", () => {
  it("detects email attachment headers", () => {
    const emailText = `From: Judy Statham <jstatham@iccpropertymanagement.com>
Sent: Tuesday, August 4, 2026 11:22 AM
To: Shawna Greenspan <president@tscc2517.com>
Subject: Re: Booster pump repair quotes`;

    assert.equal(isEmailAttachmentPage(emailText), true);
  });

  it("does not flag ordinary report pages that mention emails", () => {
    const reportText = `Property Management Report:
We received the tender analysis report and related email from Ryan Ratcliff.
Recommendation is to proceed with contractor B.`;

    assert.equal(isEmailAttachmentPage(reportText), false);
  });
});
