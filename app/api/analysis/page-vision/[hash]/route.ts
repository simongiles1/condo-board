export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { getPageVisionDocumentDetail } from "@/lib/email/page-vision-lab";
import { processVisionForDocument } from "@/lib/email/page-vision";

type RouteContext = { params: Promise<{ hash: string }> };

function parseHash(raw: string | undefined): string | null {
  const contentHash = raw?.trim().toLowerCase() ?? "";
  if (!contentHash || !/^[a-f0-9]{64}$/.test(contentHash)) return null;
  return contentHash;
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  const { hash } = await context.params;
  const contentHash = parseHash(hash);
  if (!contentHash) {
    return NextResponse.json({ error: "Invalid content hash." }, { status: 400 });
  }

  try {
    const detail = await getPageVisionDocumentDetail(contentHash);
    if (!detail) {
      return NextResponse.json(
        { error: "Document not found in page profiles." },
        { status: 404 },
      );
    }
    return NextResponse.json(detail);
  } catch (error) {
    console.error("[analysis:page-vision:detail]", error);
    return NextResponse.json(
      { error: "Could not load page-vision document." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  const { hash } = await context.params;
  const contentHash = parseHash(hash);
  if (!contentHash) {
    return NextResponse.json({ error: "Invalid content hash." }, { status: 400 });
  }

  try {
    let pageNos: number[] | undefined;
    let force = false;
    try {
      const body = (await request.json()) as {
        pageNos?: unknown;
        force?: unknown;
      };
      if (Array.isArray(body.pageNos)) {
        pageNos = body.pageNos
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 1);
      }
      force = body.force === true;
    } catch {
      // empty body = process all pending for hash
    }

    const result = await processVisionForDocument({
      contentHash,
      pageNos,
      force: force || Boolean(pageNos && pageNos.length > 0),
    });

    const detail = await getPageVisionDocumentDetail(contentHash);
    return NextResponse.json({ result, detail });
  } catch (error) {
    console.error("[analysis:page-vision:run]", error);
    const message =
      error instanceof Error ? error.message : "Page vision failed.";
    const missingConfig = message.includes("GEMINI_API_KEY");
    return NextResponse.json(
      { error: message },
      { status: missingConfig ? 503 : 500 },
    );
  }
}
