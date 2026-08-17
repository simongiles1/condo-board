export const runtime = "nodejs";

import { readFile } from "fs/promises";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { getDb } from "@/lib/db";
import { attachmentDocuments, emailAttachments } from "@/lib/db/schema";
import {
  isVisionImageExt,
  isVisionImageMime,
  normalizeVisionImageMime,
  visionImageMimeFromExt,
} from "@/lib/email/attachment-vision-image-shared";
import { resolveCachedPdfAbsolutePath } from "@/lib/dev/golden-attachments";
import { readCachedAttachment } from "@/lib/gmail/attachments";
import { extractPdfPages } from "@/lib/pdf/extract-pages";

type RouteContext = { params: Promise<{ hash: string }> };

export async function GET(request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  const { hash } = await context.params;
  const contentHash = hash?.trim().toLowerCase() ?? "";
  if (!contentHash || !/^[a-f0-9]{64}$/.test(contentHash)) {
    return NextResponse.json({ error: "Invalid content hash." }, { status: 400 });
  }

  const pageParam = new URL(request.url).searchParams.get("page");
  const pageNo = pageParam != null ? Number(pageParam) : null;
  const wantPage =
    pageNo != null && Number.isInteger(pageNo) && pageNo >= 1 ? pageNo : null;

  try {
    const db = getDb();
    const [doc] = await db
      .select({
        ext: attachmentDocuments.ext,
        mimeType: attachmentDocuments.mimeType,
      })
      .from(attachmentDocuments)
      .where(eq(attachmentDocuments.contentHash, contentHash))
      .limit(1);

    const ext = doc?.ext || ".pdf";
    const isImage =
      (doc?.mimeType != null && isVisionImageMime(doc.mimeType)) ||
      isVisionImageExt(ext);

    let bytes: Buffer | null = null;
    bytes = await readCachedAttachment(contentHash, ext);
    if (!bytes && isImage) {
      for (const candidate of [".png", ".jpg", ".jpeg", ".gif", ".webp"]) {
        if (candidate === ext) continue;
        bytes = await readCachedAttachment(contentHash, candidate);
        if (bytes) break;
      }
    }
    if (!bytes && ext !== ".pdf") {
      bytes = await readCachedAttachment(contentHash, ".pdf");
    }
    if (!bytes) {
      const absolute = await resolveCachedPdfAbsolutePath(contentHash);
      if (absolute) bytes = await readFile(absolute);
    }

    if (!bytes) {
      return NextResponse.json(
        { error: isImage ? "Cached image not found on disk." : "Cached PDF not found on disk." },
        { status: 404 },
      );
    }

    let outBytes: Buffer | Uint8Array = bytes;
    if (!isImage && wantPage != null) {
      try {
        outBytes = await extractPdfPages(bytes, [wantPage]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not extract page.";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    const [meta] = await db
      .select({ filename: emailAttachments.filename })
      .from(emailAttachments)
      .where(eq(emailAttachments.contentHash, contentHash))
      .limit(1);

    const contentType = isImage
      ? (doc?.mimeType && isVisionImageMime(doc.mimeType)
          ? normalizeVisionImageMime(doc.mimeType)
          : null) ??
        visionImageMimeFromExt(ext) ??
        "application/octet-stream"
      : "application/pdf";

    const fallbackName = isImage
      ? `${contentHash}${ext.startsWith(".") ? ext : `.${ext}`}`
      : `${contentHash}.pdf`;
    const baseName = meta?.filename?.trim() || fallbackName;
    const filename =
      !isImage && wantPage != null
        ? baseName.replace(/\.pdf$/i, "") + `-p${wantPage}.pdf`
        : baseName;
    const encoded = encodeURIComponent(filename);
    const body = Buffer.from(outBytes);

    return new NextResponse(
      body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer,
      {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `inline; filename="${filename.replace(/[\r\n"]/g, "")}"; filename*=UTF-8''${encoded}`,
          "Cache-Control": "private, max-age=60",
        },
      },
    );
  } catch (error) {
    console.error("[analysis:page-vision:file]", error);
    return NextResponse.json(
      { error: "Could not load attachment file." },
      { status: 500 },
    );
  }
}
