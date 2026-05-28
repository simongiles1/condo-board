export const runtime = "nodejs";

import React from "react";

import { pdf } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";

import MinutesPdfDoc from "@/lib/pdf/MinutesPdfDoc";
import MinutesPdfDocV2 from "@/lib/pdf/MinutesPdfDocV2";
import { getDb } from "@/lib/db";
import { meetings } from "@/lib/db/schema";
import { parseMinutesJsonEnvelope } from "@/lib/minutes/schema-v2";
import { validateMinutesJson } from "@/lib/minutes/schema";
import { parsePdfMarginsFromSearchParams } from "@/lib/pdf/margins";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const margins = parsePdfMarginsFromSearchParams(searchParams);
  const db = getDb();

  const [record] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, id));

  if (!record) {
    return new Response("Meeting not found", { status: 404 });
  }

  if (!record.minutesJson?.trim()) {
    return new Response(
      "This meeting has no structured minutes data. Regenerate the meeting (transcript + reference PDF) to produce PDF-ready minutes, or contact support.",
      { status: 400 },
    );
  }

  const envelope = parseMinutesJsonEnvelope(record.minutesJson);

  if (envelope.version === "v2" && envelope.v2) {
    const doc = React.createElement(MinutesPdfDocV2, {
      document: envelope.v2,
      margins,
    }) as Parameters<typeof pdf>[0];

    const instance = pdf(doc);
    const blob = await instance.toBlob();
    const arrayBuffer = await blob.arrayBuffer();

    const filenameSafe = encodeURIComponent(
      `${record.meetingDate}-${record.title}`.replace(/[^\w\d\-]+/g, "_"),
    );

    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="minutes-${filenameSafe}.pdf"`,
      },
    });
  }

  const v1Data = envelope.v1Raw ?? JSON.parse(record.minutesJson);
  const { value, errors } = validateMinutesJson(v1Data);
  if (!value) {
    return new Response(
      `Structured minutes are invalid: ${errors.join(" ")}`,
      { status: 500 },
    );
  }

  const doc = React.createElement(MinutesPdfDoc, {
    document: value,
  }) as Parameters<typeof pdf>[0];

  const instance = pdf(doc);
  const blob = await instance.toBlob();
  const arrayBuffer = await blob.arrayBuffer();

  const filenameSafe = encodeURIComponent(
    `${record.meetingDate}-${record.title}`.replace(/[^\w\d\-]+/g, "_"),
  );

  return new Response(arrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="minutes-${filenameSafe}.pdf"`,
    },
  });
}
