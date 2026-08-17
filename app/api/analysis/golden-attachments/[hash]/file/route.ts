export const runtime = "nodejs";

import { readFile } from "fs/promises";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  readGoldenManifest,
  resolveCachedPdfAbsolutePath,
} from "@/lib/dev/golden-attachments";

type RouteContext = { params: Promise<{ hash: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  const { hash } = await context.params;
  const contentHash = hash?.trim().toLowerCase();
  if (!contentHash || !/^[a-f0-9]{64}$/.test(contentHash)) {
    return NextResponse.json({ error: "Invalid content hash." }, { status: 400 });
  }

  try {
    const manifest = await readGoldenManifest();
    const allowed = manifest.documents.some(
      (d) => d.contentHash === contentHash,
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "Hash is not in the golden-set manifest." },
        { status: 404 },
      );
    }

    const filePath = await resolveCachedPdfAbsolutePath(contentHash);
    if (!filePath) {
      return NextResponse.json(
        { error: "Cached PDF not found on disk." },
        { status: 404 },
      );
    }

    const bytes = await readFile(filePath);
    const doc = manifest.documents.find((d) => d.contentHash === contentHash);
    const filename = doc?.filename?.trim() || `${contentHash}.pdf`;
    const encoded = encodeURIComponent(filename);

    return new NextResponse(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename.replace(/[\r\n"]/g, "")}"; filename*=UTF-8''${encoded}`,
          "Cache-Control": "private, max-age=3600",
        },
      },
    );
  } catch (error) {
    console.error("[golden-attachments:file]", error);
    return NextResponse.json(
      { error: "Could not load golden-set PDF." },
      { status: 500 },
    );
  }
}
