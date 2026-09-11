export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  getAllowlistImportPreview,
} from "@/lib/gmail/allowlist-preview";
import { getAllowlistEmails } from "@/lib/gmail/queries";
import { getNextSyncCatchupPreview } from "@/lib/gmail/sync-import-preview";

export type AllowlistPreviewResponse = {
  threadCount: number;
  emailCount: number;
  importedThreadCount: number;
  importedEmailCount: number;
  remainingThreadCount: number;
  remainingEmailCount: number;
  nextSync: Awaited<ReturnType<typeof getNextSyncCatchupPreview>>;
};

export async function POST(req: Request) {
  try {
    let body: { emails?: string[] } = {};
    try {
      body = (await req.json()) as { emails?: string[] };
    } catch {
      body = {};
    }

    const emails =
      Array.isArray(body.emails) && body.emails.length > 0
        ? body.emails
        : await getAllowlistEmails();

    const [importPreview, nextSync] = await Promise.all([
      getAllowlistImportPreview(emails),
      getNextSyncCatchupPreview(emails),
    ]);

    if (!importPreview) {
      return NextResponse.json(
        { error: "Personal Gmail is not connected." },
        { status: 503 },
      );
    }

    const response: AllowlistPreviewResponse = {
      ...importPreview,
      remainingThreadCount: Math.max(
        0,
        importPreview.threadCount - importPreview.importedThreadCount,
      ),
      remainingEmailCount: Math.max(
        0,
        importPreview.emailCount - importPreview.importedEmailCount,
      ),
      nextSync,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[email:allowlist:preview]", error);
    return NextResponse.json(
      { error: "Could not estimate allowlist import size." },
      { status: 500 },
    );
  }
}
