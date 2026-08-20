export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  isProjectEvidenceField,
  loadProjectFieldEvidence,
  PROJECT_EVIDENCE_DEFAULT_PAGE_SIZE,
  PROJECT_EVIDENCE_MAX_PAGE_SIZE,
} from "@/lib/projects/registry-evidence";

function parsePositiveInt(
  raw: string | null,
  fallback: number,
  max?: number,
): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  if (max != null) return Math.min(max, n);
  return n;
}

export async function GET(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId")?.trim() ?? "";
  const fieldRaw = url.searchParams.get("field") ?? "";
  const value = url.searchParams.get("value")?.trim() ?? "";
  const projectName = url.searchParams.get("projectName")?.trim() ?? "";
  const page = parsePositiveInt(url.searchParams.get("page"), 1);
  const pageSize = parsePositiveInt(
    url.searchParams.get("pageSize"),
    PROJECT_EVIDENCE_DEFAULT_PAGE_SIZE,
    PROJECT_EVIDENCE_MAX_PAGE_SIZE,
  );

  if (!isProjectEvidenceField(fieldRaw)) {
    return NextResponse.json(
      {
        error:
          "field must be source_emails, name, name_alias, year_hint, phase, contractor, location, or equipment_mentions.",
      },
      { status: 400 },
    );
  }
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required." }, { status: 400 });
  }
  if (fieldRaw !== "source_emails" && !value) {
    return NextResponse.json({ error: "value is required." }, { status: 400 });
  }

  try {
    const evidence = await loadProjectFieldEvidence({
      projectId,
      projectName,
      field: fieldRaw,
      value,
      page,
      pageSize,
    });
    if (!evidence) {
      return NextResponse.json(
        { error: "Could not load evidence." },
        { status: 400 },
      );
    }
    return NextResponse.json({ evidence });
  } catch (error) {
    console.error("[projects:evidence]", error);
    return NextResponse.json(
      { error: "Could not load evidence." },
      { status: 500 },
    );
  }
}
