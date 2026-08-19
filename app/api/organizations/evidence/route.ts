export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  isOrgEvidenceField,
  loadOrgFieldEvidence,
  ORG_EVIDENCE_DEFAULT_PAGE_SIZE,
  ORG_EVIDENCE_MAX_PAGE_SIZE,
} from "@/lib/organizations/registry-evidence";

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
  const organizationId = url.searchParams.get("organizationId")?.trim() ?? "";
  const fieldRaw = url.searchParams.get("field") ?? "";
  const value = url.searchParams.get("value")?.trim() ?? "";
  const organizationName = url.searchParams.get("organizationName")?.trim() ?? "";
  const page = parsePositiveInt(url.searchParams.get("page"), 1);
  const pageSize = parsePositiveInt(
    url.searchParams.get("pageSize"),
    ORG_EVIDENCE_DEFAULT_PAGE_SIZE,
    ORG_EVIDENCE_MAX_PAGE_SIZE,
  );

  if (!isOrgEvidenceField(fieldRaw)) {
    return NextResponse.json(
      {
        error:
          "field must be name, name_alias, organization_role, email, phone, or website.",
      },
      { status: 400 },
    );
  }
  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId is required." },
      { status: 400 },
    );
  }
  if (!value) {
    return NextResponse.json({ error: "value is required." }, { status: 400 });
  }

  try {
    const evidence = await loadOrgFieldEvidence({
      organizationId,
      organizationName,
      field: fieldRaw,
      value,
      page,
      pageSize,
    });
    if (!evidence) {
      return NextResponse.json({ error: "Could not load evidence." }, { status: 400 });
    }
    return NextResponse.json({ evidence });
  } catch (error) {
    console.error("[organizations:evidence]", error);
    return NextResponse.json(
      { error: "Could not load evidence." },
      { status: 500 },
    );
  }
}
