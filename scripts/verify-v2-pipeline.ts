import { mkdir, writeFile } from "fs/promises";
import path from "path";
import React from "react";
import { pdf } from "@react-pdf/renderer";
import Database from "better-sqlite3";

import MinutesPdfDoc from "../lib/pdf/MinutesPdfDoc";
import MinutesPdfDocV2 from "../lib/pdf/MinutesPdfDocV2";
import { validateMinutesJson } from "../lib/minutes/schema";
import {
  parseMinutesJsonEnvelope,
  validateMinutesV2,
  wrapMinutesV2,
  type MinutesDocumentV2,
} from "../lib/minutes/schema-v2";
import { v2ToMarkdown } from "../lib/minutes/v2-to-markdown";

const root = path.join(__dirname, "..");
const outDir = path.join(root, "data", "verify-output");

const sampleV2Data: MinutesDocumentV2 = {
  metadata: {
    corporationName: "Toronto Standard Condominium Corporation No. 2517",
    meetingDate: "2026-03-23",
    meetingTime: "6:00 p.m.",
    meetingPlatform: "virtually",
  },
  attendance: {
    present: [
      { name: "Shawna Greenspan", titleOrRole: "President" },
      { name: "Paul Gartenburg", titleOrRole: "Secretary" },
    ],
    byInvitation: [
      {
        name: "Bonnie Kafi",
        titleOrRole: "Property Manager",
        company: "ICC Property Management",
      },
    ],
    guests: [],
    regrets: [{ name: "Michael Lethbridge", titleOrRole: "Treasurer" }],
  },
  callToOrder: {
    time: "6:01 p.m.",
    chairName: "S. Greenspan",
  },
  specialPresentations: [],
  approvalOfPreviousMinutes: [
    {
      previousMeetingDate: "2026-02-25",
      amendmentsNoted: true,
      motion: {
        movedBy: "S. Greenspan",
        secondedBy: "P. Gartenburg",
        resolutionText:
          "the minutes of the Board meeting dated February 25, 2026 be approved as amended.",
        status: "Motion carried.",
      },
    },
  ],
  financialMatters: [
    {
      topic: "Unaudited Financial Statements",
      summary:
        "The unaudited financial statements and variance report for the month ended February 28, 2026 were presented for review.",
      actionItems: [],
      subItems: [
        {
          topic: "Insurance Deductible",
          summary:
            "A query was raised as to whether the insurance deductible amount was added to the Reserve Fund, as previously agreed.",
          actionItems: [
            {
              assignee: "Management",
              taskDescription:
                "is directed to follow up on whether the insurance deductible amount was added to the Reserve Fund.",
            },
          ],
          subItems: [],
        },
      ],
    },
  ],
  managementReport: {
    itemsForRatification: [
      {
        topic: "Status Certificates",
        summary: "The following motion was presented for ratification:",
        motion: {
          movedBy: "S. Greenspan",
          secondedBy: "P. Gartenburg",
          resolutionText:
            "IT BE DULY RATIFIED that the status certificate be updated with the legal wording received from Lash Condo Law regarding the riser expansion engineering findings.",
          status: "Motion carried.",
        },
        actionItems: [],
        subItems: [],
      },
    ],
    itemsForApproval: [
      {
        topic: "Public Item A",
        summary: "First public approval item for verification.",
        actionItems: [],
        subItems: [],
      },
      {
        topic: "Public Item B",
        summary: "Second public approval item for verification.",
        actionItems: [],
        subItems: [],
      },
      {
        topic: "Suite 610 Request for Records",
        summary:
          "The Board reviewed the request for records proposal from Suite 610 related to the riser engineering findings.",
        actionItems: [],
        subItems: [],
        restricted: true,
      },
      {
        topic: "Suite 3101 Request for Records",
        summary:
          "The Board reviewed the request for records proposal from Suite 3101 related to the riser engineering findings.",
        actionItems: [],
        subItems: [],
        restricted: true,
      },
    ],
    itemsForInformation: [],
    itemsForDiscussion: [],
  },
  correspondence: [],
  newOrOtherBusiness: [],
  dateOfNextMeeting: {
    date: "2026-04-29",
    time: "6:00 p.m.",
  },
  termination: { time: "9:01 p.m." },
  postTerminationSections: [
    {
      title: "Budget Discussion",
      items: [
        {
          topic: "2026-2027 Budget",
          summary:
            "After the Recording Secretary was excused, the Board, Management, and Assistant Management held a discussion on the 2026-2027 budget.",
          actionItems: [],
          subItems: [],
        },
      ],
    },
  ],
};

async function renderPdf(
  element: Parameters<typeof pdf>[0],
  filename: string,
): Promise<void> {
  const instance = pdf(element);
  const blob = await instance.toBlob();
  const buffer = Buffer.from(await blob.arrayBuffer());
  await writeFile(path.join(outDir, filename), buffer);
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });

  const validated = validateMinutesV2(sampleV2Data);
  if (!validated.value) {
    throw new Error(`Sample v2 invalid: ${validated.errors.join(" ")}`);
  }

  const envelope = wrapMinutesV2(validated.value);
  await writeFile(
    path.join(outDir, "sample-v2.json"),
    JSON.stringify(envelope, null, 2),
    "utf-8",
  );

  const markdown = v2ToMarkdown(validated.value);
  await writeFile(path.join(outDir, "sample-v2.md"), markdown, "utf-8");

  await renderPdf(
    React.createElement(MinutesPdfDocV2, { document: validated.value }) as Parameters<typeof pdf>[0],
    "sample-v2.pdf",
  );

  const db = new Database(path.join(root, "data", "app.db"));
  const row = db
    .prepare(
      "SELECT id, minutes_json FROM meetings WHERE minutes_json IS NOT NULL LIMIT 1",
    )
    .get() as { id: string; minutes_json: string } | undefined;

  if (row?.minutes_json) {
    const parsed = parseMinutesJsonEnvelope(row.minutes_json);
    if (parsed.version === "v2" && parsed.v2) {
        await renderPdf(
          React.createElement(MinutesPdfDocV2, { document: parsed.v2 }) as Parameters<typeof pdf>[0],
          `legacy-row-v2-${row.id}.pdf`,
        );
      console.log(`Rendered existing v2 meeting ${row.id}`);
    } else {
      const { value } = validateMinutesJson(
        parsed.v1Raw ?? JSON.parse(row.minutes_json),
      );
      if (value) {
        await renderPdf(
          React.createElement(MinutesPdfDoc, { document: value }) as Parameters<typeof pdf>[0],
          `legacy-row-v1-${row.id}.pdf`,
        );
        console.log(`Rendered existing v1 meeting ${row.id}`);
      }
    }
  } else {
    console.log("No existing meeting with minutes_json in database.");
  }

  db.close();
  console.log(`Verification artifacts written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
