export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { recordOrganizationFieldDenial } from "@/lib/organizations/field-denials";
import {
  loadOrgDuplicateGroups,
  loadOrgFingerprintSummaries,
  parseOrgFingerprintListSort,
} from "@/lib/organizations/fingerprint-list";
import { manualMergeManyOrganizations } from "@/lib/organizations/manual-merge";

export async function GET(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  const url = new URL(request.url);
  const view = url.searchParams.get("view");

  if (view === "duplicates") {
    try {
      const groups = await loadOrgDuplicateGroups();
      return NextResponse.json({ groups, view: "duplicates" });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not load organization duplicate groups.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const limit = Math.min(
    2000,
    Math.max(1, Number(url.searchParams.get("limit") ?? 500) || 500),
  );
  const sort = parseOrgFingerprintListSort(url.searchParams.get("sort"));

  try {
    const { organizations, stats } = await loadOrgFingerprintSummaries({
      limit,
      sort,
    });
    return NextResponse.json({ organizations, stats });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load organization fingerprints.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  let body: {
    action?: string;
    sourceOrganizationId?: string;
    sourceOrganizationIds?: string[];
    targetOrganizationId?: string;
    organizationId?: string;
    field?: string;
    value?: string;
    organizationName?: string | null;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.action === "deny_field") {
    const result = await recordOrganizationFieldDenial({
      organizationId: body.organizationId ?? "",
      field: body.field ?? "",
      value: body.value ?? "",
      organizationName: body.organizationName,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, denial: result.denial });
  }

  if (body.action !== "merge") {
    return NextResponse.json(
      {
        error:
          'Unsupported action. Use action: "merge" or action: "deny_field".',
      },
      { status: 400 },
    );
  }

  const sourceOrganizationIds = Array.isArray(body.sourceOrganizationIds)
    ? body.sourceOrganizationIds
    : body.sourceOrganizationId
      ? [body.sourceOrganizationId]
      : [];
  const result = await manualMergeManyOrganizations({
    sourceOrganizationIds,
    targetOrganizationId: body.targetOrganizationId ?? "",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    survivorId: result.survivorKey,
    merged: result.merged,
  });
}
