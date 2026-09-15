import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import MinutesPdfDocV2 from "../lib/pdf/MinutesPdfDocV2";
import { validateMinutesV2, type AgendaItemV2 } from "../lib/minutes/schema-v2";
import { v2ToMarkdown } from "../lib/minutes/v2-to-markdown";

it("exports the complete agenda with stable public and restricted numbering", async () => {
  const item = (topic: string, restricted = false, subItems: AgendaItemV2[] = []): AgendaItemV2 => ({
    topic, restricted, summary: `${topic} was discussed.`, actionItems: [], subItems,
  });
  const doc = validateMinutesV2({
    metadata: { corporationName: "Example Condominium Corporation", meetingDate: "2026-08-12", meetingTime: "" },
    attendance: { present: [], byInvitation: [], guests: [], regrets: [] },
    specialPresentations: [item("Public presentation"), item("Private presentation", true)],
    approvalOfPreviousMinutes: [],
    financialMatters: [item("Public financial report"), item("Private financial report", true), item("Later financial report")],
    managementReport: { itemsForApproval: [item("Alpha maintenance"), item("Beta maintenance"), item("Confidential contract", true), item("Delta maintenance")],
      itemsForRatification: [], itemsForInformation: [], itemsForDiscussion: [] },
    correspondence: [item("Private correspondence", true)],
    newOrOtherBusiness: [item("Mixed parent", false, [item("First public child"), item("Restricted child", true), item("Third public child")])],
    postTerminationSections: [],
  }).value!;
  assert.ok(doc);
  const bytes = await renderToBuffer(<MinutesPdfDocV2 document={doc} />);
  // Optional local visual QA output; normal test runs leave no artifacts.
  if (process.env.MEETING_V2_PDF_QA_DIR) {
    await mkdir(process.env.MEETING_V2_PDF_QA_DIR, { recursive: true });
    await writeFile(path.join(process.env.MEETING_V2_PDF_QA_DIR, "meeting-v2-regression.pdf"), bytes);
  }
  const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      pages.push(content.items.map(entry => "str" in entry ? entry.str : "").join(" "));
    }
    const text = pages.join("\n").replace(/\s+/g, " ");
    const [publicText, restrictedText] = text.split("ADDENDUM TO THE MINUTES");
    assert.ok(restrictedText, "PDF must have a restricted addendum");
    assert.match(publicText, /\(b\)\s*Beta maintenance/);
    assert.match(publicText, /\(d\)\s*Delta maintenance/);
    assert.match(publicText, /3\.3\s*Later financial report/);
    assert.doesNotMatch(publicText, /Confidential contract|Private presentation|Private correspondence|Restricted child/);
    assert.match(restrictedText, /\(c\)\s*Confidential contract/);
    assert.match(restrictedText, /3\.2\s*Private financial report/);
    assert.match(restrictedText, /ii\)\s*Restricted child/);
    assert.match(restrictedText, /Private presentation/);
    assert.match(restrictedText, /Private correspondence/);
    assert.doesNotMatch(text, /unanimously|6:00 pm|Seconded by|no further business/i);
    const markdown = v2ToMarkdown(doc);
    assert.ok(markdown.indexOf("Public presentation") < markdown.indexOf("FINANCIAL MATTERS"));
    assert.match(markdown, /adjournment time was not recorded/);
  } finally { await loadingTask.destroy(); }
});
