export const runtime = "nodejs";

import { readFile } from "fs/promises";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  readGoldenManifest,
  resolveCachedPdfAbsolutePath,
} from "@/lib/dev/golden-attachments";
import {
  profilePdfPages,
  summarizeProfiles,
} from "@/lib/pdf/page-profile";

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
    const profiles = await profilePdfPages(bytes);
    const summary = summarizeProfiles(profiles);

    return NextResponse.json({ contentHash, profiles, summary });
  } catch (error) {
    console.error("[golden-attachments:profile]", error);
    const message =
      error instanceof Error ? error.message : "Could not profile PDF.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
