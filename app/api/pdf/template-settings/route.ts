export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { normalizePdfMargins, type PdfMargins } from "@/lib/pdf/margins";
import {
  getPdfTemplateSettings,
  updatePdfTemplateSettings,
} from "@/lib/pdf/template-settings";

export async function GET() {
  const user = await requireSession();
  if (isErrorResponse(user)) return user;

  const margins = await getPdfTemplateSettings();
  return NextResponse.json({ margins });
}

export async function PATCH(request: Request) {
  const user = await requireSession();
  if (isErrorResponse(user)) return user;

  let body: { margins?: Partial<PdfMargins> };
  try {
    body = (await request.json()) as { margins?: Partial<PdfMargins> };
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  if (!body.margins || typeof body.margins !== "object") {
    return NextResponse.json(
      { error: "Request body must include a margins object." },
      { status: 400 },
    );
  }

  try {
    const margins = await updatePdfTemplateSettings(
      normalizePdfMargins(body.margins),
    );
    return NextResponse.json({ margins });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not update PDF template settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
