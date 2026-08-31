export const runtime = "nodejs";

import React from "react";

import { pdf } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2MinutesDrafts } from "@/lib/db/schema";
import { validateMinutesV2 } from "@/lib/minutes/schema-v2";
import MinutesPdfDocV2 from "@/lib/pdf/MinutesPdfDocV2";
import { parsePdfMarginsFromSearchParams } from "@/lib/pdf/margins";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const margins = parsePdfMarginsFromSearchParams(searchParams);
  const disposition = searchParams.get("download") === "1" ? "attachment" : "inline";
  const db = getDb();

  const [meeting, draft] = await Promise.all([
    db.select().from(meetingsV2).where(eq(meetingsV2.id, id)),
    db
      .select()
      .from(meetingsV2MinutesDrafts)
      .where(eq(meetingsV2MinutesDrafts.meetingV2Id, id))
      .orderBy(meetingsV2MinutesDrafts.createdAt),
  ]);

  if (!meeting[0]) {
    return new Response("Meeting not found.", { status: 404 });
  }
  const latestDraft = draft.at(-1);
  if (!latestDraft?.summaryJson) {
    return new Response("No generated draft found for this meeting.", { status: 404 });
  }

  let parsedSummary: unknown;
  try {
    parsedSummary = JSON.parse(latestDraft.summaryJson);
  } catch {
    return new Response("Draft metadata is invalid.", { status: 500 });
  }
  if (!isRecord(parsedSummary)) {
    return new Response("This draft does not contain structured v2 minutes.", { status: 400 });
  }

  const docData = parsedSummary.minutesV2?.data || parsedSummary.minutesV2 || parsedSummary.data || parsedSummary;
  const validated = validateMinutesV2(docData);
  if (!validated.value) {
    return new Response(
      `Saved v2 minutes are invalid: ${validated.errors.join(" ")}`,
      { status: 500 },
    );
  }

  const doc = React.createElement(MinutesPdfDocV2, {
    document: validated.value,
    margins,
  }) as Parameters<typeof pdf>[0];

  const instance = pdf(doc);
  const blob = await instance.toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  const filenameSafe = encodeURIComponent(
    `${meeting[0].meetingDate}-${meeting[0].title}`.replace(/[^\w\d\-]+/g, "_"),
  );

  return new Response(arrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="meeting-v2-draft-${filenameSafe}.pdf"`,
    },
  });
}
