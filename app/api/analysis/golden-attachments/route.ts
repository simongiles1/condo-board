export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  isPageRouteLabel,
  labelingProgress,
  readGoldenManifest,
  upsertDocumentPages,
  writeGoldenManifest,
  type GoldenManifestPage,
} from "@/lib/dev/golden-attachments";

export async function GET() {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const manifest = await readGoldenManifest();
    return NextResponse.json(
      {
        manifest,
        progress: labelingProgress(manifest),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("[golden-attachments:get]", error);
    const message =
      error instanceof Error ? error.message : "Could not load golden manifest.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const body = (await request.json()) as {
      documentId?: string;
      pages?: GoldenManifestPage[];
    };

    const documentId = body.documentId?.trim();
    if (!documentId) {
      return NextResponse.json(
        { error: "documentId is required." },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.pages)) {
      return NextResponse.json(
        { error: "pages must be an array." },
        { status: 400 },
      );
    }

    for (const page of body.pages) {
      if (
        !page ||
        !Number.isFinite(page.pageNo) ||
        !isPageRouteLabel(page.expectedRoute)
      ) {
        return NextResponse.json(
          {
            error:
              "Each page needs pageNo (number) and expectedRoute (text|vision|ambiguous).",
          },
          { status: 400 },
        );
      }
    }

    const current = await readGoldenManifest();
    const next = upsertDocumentPages(current, documentId, body.pages);
    await writeGoldenManifest(next);

    return NextResponse.json({
      ok: true,
      manifest: next,
      progress: labelingProgress(next),
    });
  } catch (error) {
    console.error("[golden-attachments:put]", error);
    const message =
      error instanceof Error ? error.message : "Could not save labels.";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
