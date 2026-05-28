export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getEmailAttachmentContent } from "@/lib/gmail/attachments";
import { attachmentKind } from "@/lib/email/attachment-display";

type RouteContext = { params: Promise<{ id: string }> };

function contentDisposition(filename: string, inline: boolean): string {
  const encoded = encodeURIComponent(filename);
  const type = inline ? "inline" : "attachment";
  return `${type}; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encoded}`;
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const forceDownload = searchParams.get("download") === "1";

  try {
    const { bytes, filename, mimeType } = await getEmailAttachmentContent(id);
    const kind = attachmentKind(mimeType);
    const inline = !forceDownload && (kind === "image" || kind === "pdf");
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;

    return new NextResponse(body, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": contentDisposition(filename, inline),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load attachment.";

    if (message === "Attachment not found.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
