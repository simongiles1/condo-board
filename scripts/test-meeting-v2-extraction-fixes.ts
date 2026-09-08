/**
 * Tests for Meeting V2 extraction quality detection, agenda sorting, and Docling helpers.
 * Run: npx tsx --test scripts/test-meeting-v2-extraction-fixes.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeExtractionQuality } from "../lib/meeting-v2/extraction-diagnostics";
import {
  agendaTitlesMatch,
  filterRedundantAddToAgendaDiscrepancies,
  resolveTranscriptDiscrepancyKind,
} from "../lib/meeting-v2/transcript-discrepancies";
import {
  inferHeadingFromMarkdown,
  isEmailAttachmentPage,
  buildSemanticDocumentSections,
} from "../lib/meeting-v2/pdf";
import { chunkDocumentPages } from "../lib/meeting-v2/chunking";
import { parseVttToMergedCues, mergedCuesToSegmentRows } from "../lib/meeting-v2/transcript";
import {
  normalizeTopic,
  normalizeDiscrepancies,
  normalizeWorkflowState,
} from "../lib/meeting-v2/agenda-ai";
import {
  flattenBoardPackageAgenda,
  normalizeBoardPackageAgendaSkeleton,
} from "../lib/meeting-v2/board-package-agenda";
import {
  applyAgendaHierarchyCorrections,
  buildAgendaOutlineTree,
  compareAgendaItemCodes,
  decorateAgendaOutlineTree,
  planAdHocPlacement,
} from "../lib/meeting-v2/agenda-outline";

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

describe("Docling Semantic Section Chunking", () => {
  it("groups pages cleanly into semantic sections instead of arbitrary rolling windows", () => {
    const pages = [
      { pageNumber: 1, text: "# Board Meeting Package\nTSCC 2517 - July 2026", extractedText: "# Board Meeting Package\nTSCC 2517 - July 2026" },
      { pageNumber: 2, text: "# AGENDA\n1. Meeting with Ryan Ratcliff\nA. Booster Pump\nB. Riser Expansion\n2. Approval of Minutes\n3. Financial Statements\n4. Property Management Report", extractedText: "# AGENDA\n1. Meeting with Ryan Ratcliff\nA. Booster Pump\nB. Riser Expansion\n2. Approval of Minutes\n3. Financial Statements\n4. Property Management Report" },
      { pageNumber: 3, text: "# 1. Meeting with Eng. Ryan Ratcliff from TCG to discuss projects\nDiscussion on booster pump specifications and tender requirements.", extractedText: "# 1. Meeting with Eng. Ryan Ratcliff from TCG to discuss projects\nDiscussion on booster pump specifications and tender requirements." },
      { pageNumber: 4, text: "Further engineering calculations and drawings for booster pump system.", extractedText: "Further engineering calculations and drawings for booster pump system." },
      { pageNumber: 5, text: "# 2. Review and Approval of Minutes of June 30, 2026\nMinutes reviewed.", extractedText: "# 2. Review and Approval of Minutes of June 30, 2026\nMinutes reviewed." },
      { pageNumber: 6, text: "# 4. Property Management Report:\nManagement activity summary for July 2026.", extractedText: "# 4. Property Management Report:\nManagement activity summary for July 2026." },
    ];

    const sections = buildSemanticDocumentSections(pages);
    assert.equal(sections.length, 5);
    assert.equal(sections[0].title, "Management Report Cover");
    assert.equal(sections[1].title, "AGENDA");
    assert.equal(sections[2].title, "1. Meeting with Eng. Ryan Ratcliff from TCG to discuss projects");
    assert.equal(sections[2].startPage, 3);
    assert.equal(sections[2].endPage, 4);
    assert.equal(sections[3].title, "2. Review and Approval of Minutes of June 30, 2026");
    assert.equal(sections[4].title, "4. Property Management Report:");

    const chunks = chunkDocumentPages(
      pages.map((p, idx) => ({ id: `page-${p.pageNumber}`, pageNumber: p.pageNumber, text: p.text, sortOrder: idx })),
      sections,
    );
    assert.equal(chunks.length, 5);
    const ryanSectionChunk = chunks.find((c) =>
      c.text.includes("[SECTION: 1. Meeting with Eng. Ryan Ratcliff"),
    );
    assert.ok(ryanSectionChunk);
    assert.deepEqual(ryanSectionChunk?.pageNumbers, [3, 4]);
  });
});

describe("Readable Transcript Ingestion (Speaker-Turn Paragraphing)", () => {
  it("merges consecutive same-speaker cues into unified conversational segments", () => {
    const rawVtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Ryan Ratcliff>Good evening everyone.</v>

00:00:04.100 --> 00:00:07.500
<v Ryan Ratcliff>I want to walk you through the booster pump proposal.</v>

00:00:07.600 --> 00:00:10.000
<v Ryan Ratcliff>The current pumps have reached end of life.</v>

00:00:10.500 --> 00:00:13.000
<v Shawna Greenspan>Thanks Ryan, what is the warranty period?</v>

00:00:13.200 --> 00:00:16.000
<v Ryan Ratcliff>Standard manufacturer warranty is 5 years.</v>`;

    const merged = parseVttToMergedCues(rawVtt);
    assert.equal(merged.length, 3);
    assert.equal(merged[0].speaker, "Ryan Ratcliff");
    assert.equal(merged[0].text, "Good evening everyone. I want to walk you through the booster pump proposal. The current pumps have reached end of life.");
    assert.equal(merged[0].start, "00:00:01.000");
    assert.equal(merged[0].end, "00:00:10.000");

    assert.equal(merged[1].speaker, "Shawna Greenspan");
    assert.equal(merged[1].text, "Thanks Ryan, what is the warranty period?");

    assert.equal(merged[2].speaker, "Ryan Ratcliff");
    assert.equal(merged[2].text, "Standard manufacturer warranty is 5 years.");

    const rows = mergedCuesToSegmentRows(merged, {
      meetingId: "meeting-123",
      sourceArtifactId: "artifact-vtt",
      startSequence: 0,
    });
    assert.equal(rows.length, 3);
    assert.equal(rows[0].text, merged[0].text);
    assert.equal(rows[0].speakerLabel, "Ryan Ratcliff");
  });
});

describe("Dual-Source Agenda Extraction & Synthesis", () => {
  it("normalizes topics with discussionStatus, consolidation reason, and ranges", () => {
    const rawTopic = {
      title: "Booster Pump",
      sectionLabel: "1. Meeting with Eng. Ryan Ratcliff (TCG)",
      itemType: "discussion_approval",
      sourcePages: [2, 3, 4],
      discussionStatus: "discussed" as const,
      discussionTimestampRange: "00:00:01 - 00:45:00",
      consolidationReason: "Unified Ryan Ratcliff presentation with Management Report duplicate item 4.B.1",
    };

    const normalized = normalizeTopic(rawTopic);
    assert.ok(normalized);
    assert.equal(normalized.title, "Booster Pump");
    assert.equal(normalized.discussionStatus, "discussed");
    assert.equal(normalized.discussionTimestampRange, "00:00:01 - 00:45:00");
    assert.equal(normalized.consolidationReason, "Unified Ryan Ratcliff presentation with Management Report duplicate item 4.B.1");
  });

  it("extracts and normalizes discrepancies for unaligned transcript discussions", () => {
    const rawDiscrepancies = [
      {
        transcriptRange: [15, 22],
        timestamp: "00:24:18",
        speaker: "Shawna Greenspan",
        snippet: "We need to discuss emergency repairs to the garage exhaust fan.",
        suggestedTitle: "Garage Exhaust Fan Emergency Repair",
        suggestedSection: "Property Management Report",
        clarificationQuestion: "The board discussed garage exhaust fan emergency repairs which was not on the agenda. Include as ad-hoc agenda item?",
      },
    ];

    const normalized = normalizeDiscrepancies(rawDiscrepancies);
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].suggestedTitle, "Garage Exhaust Fan Emergency Repair");
    assert.equal(normalized[0].timestamp, "00:24:18");
    assert.deepEqual(normalized[0].transcriptRange, [15, 22]);
    assert.ok(normalized[0].clarificationQuestion.includes("garage exhaust fan"));
  });

  it("normalizes complete workflow state including documentTopics and discrepancies", () => {
    const rawState = {
      documentTopics: [
        {
          title: "Booster Pump Replacement",
          sectionLabel: "1. Meeting with Eng. Ryan Ratcliff",
          sourcePages: [2, 3, 4],
          discussionStatus: "discussed",
        },
        {
          title: "Generator Fuel Delivery Upgrade",
          sectionLabel: "1. Meeting with Eng. Ryan Ratcliff",
          sourcePages: [2, 5],
          discussionStatus: "not_discussed",
        },
      ],
      extraTopics: [
        {
          title: "Garage Door Sensor Replacement",
          sectionLabel: "Ad-hoc Discussion",
          itemType: "ad_hoc_discussion",
          discussionStatus: "ad_hoc",
        },
      ],
      discrepancies: [
        {
          transcriptRange: [30, 35],
          timestamp: "01:12:00",
          snippet: "Tenant complaints regarding hallway HVAC noise.",
          suggestedTitle: "Hallway HVAC Noise Complaints",
          clarificationQuestion: "Should hallway HVAC noise complaints be added as an agenda item?",
        },
      ],
    };

    const result = normalizeWorkflowState(rawState, {
      documentTopics: [],
      extraTopics: [],
      rawNotes: [],
      uncertainties: [],
      discrepancies: [],
    });

    assert.equal(result.documentTopics.length, 2);
    assert.equal(result.documentTopics[0].title, "Booster Pump Replacement");
    assert.equal(result.documentTopics[0].discussionStatus, "discussed");
    assert.equal(result.documentTopics[1].title, "Generator Fuel Delivery Upgrade");
    assert.equal(result.documentTopics[1].discussionStatus, "not_discussed");

    assert.equal(result.extraTopics.length, 1);
    assert.equal(result.extraTopics[0].discussionStatus, "ad_hoc");

    assert.equal(result.discrepancies?.length, 1);
    assert.equal(result.discrepancies?.[0].suggestedTitle, "Hallway HVAC Noise Complaints");
  });

  it("deduplicates discrepancies when the model echoes existing ids", () => {
    const existing = {
      id: "disc-034-1",
      transcriptRange: [10, 20] as [number, number],
      timestamp: "00:10:00",
      snippet: "Discussion about hallway HVAC noise.",
      suggestedTitle: "Hallway HVAC Noise",
      clarificationQuestion: "Should hallway HVAC noise be added as an agenda item?",
    };

    const result = normalizeWorkflowState(
      { discrepancies: [existing] },
      {
        documentTopics: [],
        extraTopics: [],
        uncertainties: [],
        discrepancies: [existing],
      },
    );

    assert.equal(result.discrepancies?.length, 1);
    assert.equal(result.discrepancies?.[0].id, "disc-034-1");
  });
});

describe("transcript discrepancy deduplication", () => {
  it("matches agenda titles with punctuation and casing differences", () => {
    assert.equal(
      agendaTitlesMatch(
        "Carpet Cleaning Oversight and Scheduling",
        "carpet cleaning oversight and scheduling",
      ),
      true,
    );
    assert.equal(
      agendaTitlesMatch(
        "Fire Alarm Activation from Studio 2 - System Malfunction Inquiry",
        "Fire Alarm Activation from Studio 2",
      ),
      true,
    );
  });

  it("drops add_to_agenda discrepancies already on the candidate agenda", () => {
    const filtered = filterRedundantAddToAgendaDiscrepancies(
      [
        {
          id: "disc-carpet",
          suggestedTitle: "Carpet Cleaning Oversight and Scheduling",
          clarificationQuestion: "Should carpet cleaning be added?",
        },
        {
          id: "inquiry-ryan",
          kind: "status_inquiry" as const,
          suggestedTitle: "Meeting with Eng. Ryan Ratcliff from TCG",
          clarificationQuestion: "Should this be marked Not Discussed?",
        },
      ],
      [
        "Ad-hoc items",
        "Carpet Cleaning Oversight and Scheduling",
        "Lint Trap Miscommunication with TES",
      ],
    );

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, "inquiry-ryan");
    assert.equal(resolveTranscriptDiscrepancyKind(filtered[0]), "status_inquiry");
  });
});

describe("Hierarchical board-package agenda outline", () => {
  it("inserts Property Management Report before Date/Adjournment when the TOC skipped it", () => {
    const normalized = normalizeBoardPackageAgendaSkeleton({
      meetingTitle: "Board Meeting",
      agendaItems: [
        { itemNumber: "1", title: "Meeting with Eng. Ryan Ratcliff from TCG, to discuss projects" },
        { itemNumber: "2", title: "Review and Approval of Minutes of June 30, 2026" },
        { itemNumber: "3", title: "Review and approval of the unaudited financial statements for June 2026" },
        { itemNumber: "4", title: "Date and time of the next Board Meeting" },
        { itemNumber: "5", title: "Adjournment" },
      ],
    });

    assert.deepEqual(
      normalized.agendaItems.map((item) => `${item.itemNumber}. ${item.title}`),
      [
        "1. Meeting with Eng. Ryan Ratcliff from TCG, to discuss projects",
        "2. Review and Approval of Minutes of June 30, 2026",
        "3. Review and approval of the unaudited financial statements for June 2026",
        "4. Property Management Report",
        "5. Date and time of the next Board Meeting",
        "6. Adjournment",
      ],
    );
    assert.ok(normalized.agendaItems[3].subSections?.some((section) => section.code === "4.D"));
  });

  it("flattens the official outline plus third-level PM report items", () => {
    const topics = flattenBoardPackageAgenda({
      meetingTitle: "Board Meeting",
      agendaItems: [
        {
          itemNumber: "1",
          title: "Meeting with Eng. Ryan Ratcliff from TCG, to discuss projects",
          sourcePages: [2],
          subItems: [
            { title: "Booster Pump", sourcePages: [2] },
            { title: "Riser Expansion", sourcePages: [2] },
          ],
        },
        {
          itemNumber: "2",
          title: "Review and Approval of Minutes of June 30, 2026",
          sourcePages: [2],
        },
        {
          itemNumber: "3",
          title: "Review and approval of the unaudited financial statements for June 2026",
          sourcePages: [2],
        },
        {
          itemNumber: "4",
          title: "Property Management Report",
          sourcePages: [6],
          subSections: [
            {
              code: "4.A",
              title: "Ratification of email decisions made since the last board meeting.",
              items: [
                {
                  itemCode: "4.A.1",
                  title: "Steam Room Heat Pump Design, Tender and Construction Review",
                  sourcePages: [6],
                },
              ],
            },
            {
              code: "4.B",
              title: "Review and approval of the project",
              items: [{ itemCode: "4.B.1", title: "Booster Pump Replacement", sourcePages: [7] }],
            },
            { code: "4.C", title: "Items completed.", items: [] },
            {
              code: "4.D",
              title: "The items for discussion",
              items: [
                { itemCode: "4.D.1", title: "2026 Annual General Meeting - Tentative Date", sourcePages: [12] },
                {
                  itemCode: "4.D.12",
                  title: "Share Reserve Fund Information - Condominium Consumer Protection (CAO)",
                  sourcePages: [12],
                },
              ],
            },
          ],
        },
        { itemNumber: "5", title: "Date and time of the next Board Meeting", sourcePages: [2] },
        { itemNumber: "6", title: "Adjournment", sourcePages: [2] },
      ],
    });

    assert.deepEqual(
      topics.map((topic) => topic.itemNumber),
      [
        "1",
        "1.A",
        "1.B",
        "2",
        "3",
        "4",
        "4.A",
        "4.A.1",
        "4.B",
        "4.B.1",
        "4.C",
        "4.D",
        "4.D.a",
        "4.D.l",
        "5",
        "6",
      ],
    );
    assert.equal(topics.find((topic) => topic.itemNumber === "4.D.l")?.title.includes("CAO"), true);
  });

  it("nests 4.D.l under 4.D and places 4.E ad-hoc items before Date", () => {
    const tree = buildAgendaOutlineTree([
      { id: "1", itemNumber: "1", title: "Meeting with Eng. Ryan Ratcliff" },
      { id: "4", itemNumber: "4", title: "Property Management Report" },
      { id: "4d", itemNumber: "4.D", title: "The items for discussion" },
      { id: "4dl", itemNumber: "4.D.l", title: "Share Reserve Fund Information" },
      { id: "4e", itemNumber: "4.E", title: "Ad-hoc items" },
      { id: "4ea", itemNumber: "4.E.a", title: "Carpet Cleaning Oversight" },
      { id: "5", itemNumber: "5", title: "Date and time of the next Board Meeting" },
    ]);

    assert.equal(tree.map((node) => node.displayNumber).join(","), "1,4,5");
    const pm = tree.find((node) => node.item.id === "4");
    assert.ok(pm);
    assert.deepEqual(
      pm.children.map((child) => child.displayNumber),
      ["D", "E"],
    );
    assert.equal(pm.children[0].children[0].displayNumber, "l");
    assert.equal(pm.children[1].children[0].item.title, "Carpet Cleaning Oversight");

    const placement = planAdHocPlacement(["1", "4", "4.D", "4.D.l", "5"], 2, "4");
    assert.ok(placement);
    assert.equal(placement.sectionCode, "4.E");
    assert.equal(placement.sectionMissing, true);
    assert.deepEqual(placement.nextItemCodes, ["4.E.a", "4.E.b"]);
    assert.ok(compareAgendaItemCodes("4.E.a", "5") < 0);
  });

  it("expands parent transcript ranges to cover descendants", () => {
    const corrected = applyAgendaHierarchyCorrections([
      {
        id: "4",
        itemNumber: "4",
        title: "Property Management Report",
        discussionTimestampRange: "00:13:37 - 00:18:29",
      },
      {
        id: "4b",
        itemNumber: "4.B",
        title: "Review and approval of projects",
        discussionTimestampRange: "00:15:58 - 00:18:29",
      },
      {
        id: "4b1",
        itemNumber: "4.B.1",
        title: "Booster Pump Replacement",
        discussionTimestampRange: "00:15:58 - 01:17:28",
      },
      {
        id: "4b2",
        itemNumber: "4.B.2",
        title: "Heat Exchanger Plate Pack Replacement",
        discussionTimestampRange: "00:16:45 - 00:31:35",
      },
    ]);

    assert.equal(
      corrected.find((item) => item.id === "4")?.discussionTimestampRange,
      "00:13:37 - 01:17:28",
    );
    assert.equal(
      corrected.find((item) => item.id === "4b")?.discussionTimestampRange,
      "00:15:58 - 01:17:28",
    );
    assert.equal(
      corrected.find((item) => item.id === "4b1")?.discussionTimestampRange,
      "00:15:58 - 01:17:28",
    );
  });

  it("fills a 4.B numbering gap when top-level 5 is next-meeting admin", () => {
    const items = [
      { id: "4", itemNumber: "4", title: "Property Management Report" },
      { id: "4b", itemNumber: "4.B", title: "Review and approval of projects" },
      { id: "4b4", itemNumber: "4.B.4", title: "Heating Pump P-10A Seal Replacement" },
      {
        id: "4b6",
        itemNumber: "4.B.6",
        title: "Update on Shared Facilities Reserve Fund Study",
      },
      { id: "5", itemNumber: "5", title: "Date and time of the next Board Meeting" },
      { id: "6", itemNumber: "6", title: "Adjournment" },
    ];
    const tree = decorateAgendaOutlineTree(buildAgendaOutlineTree(items), {
      items,
      getTiming: () => null,
    });
    const sectionB = tree
      .find((node) => node.item.id === "4")
      ?.children.find((child) => child.item.id === "4b");
    assert.deepEqual(
      sectionB?.children.map((child) => child.displayNumber),
      ["4", "5"],
    );
  });
});

