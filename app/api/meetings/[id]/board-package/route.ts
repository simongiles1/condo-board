export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  loadMeetingBoardPackage,
  loadMeetingBoardPackageMeta,
} from "@/lib/meeting-v2/board-package";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const wantsMeta = new URL(req.url).searchParams.get("meta") === "1";

  try {
    if (wantsMeta) {
      const result = await loadMeetingBoardPackageMeta(id);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json(result.payload);
    }

    const result = await loadMeetingBoardPackage(id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { buffer, fileName } = result.payload;
    const safeFileName = fileName.replace(/[^\w.\-() ]+/g, "_");

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeFileName}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error("[meetings:board-package]", error);
    return NextResponse.json(
      { error: "Could not load board package." },
      { status: 500 },
    );
  }
}
