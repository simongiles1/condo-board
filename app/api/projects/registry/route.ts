export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { recordProjectFieldDenial } from "@/lib/projects/field-denials";
import {
  invalidateProjectFingerprintSummariesCache,
  loadProjectDuplicateGroups,
  loadProjectFingerprintSummaries,
  parseProjectFingerprintListSort,
} from "@/lib/projects/fingerprint-list";
import { manualMergeManyProjects } from "@/lib/projects/manual-merge";

export async function GET(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  const url = new URL(request.url);
  const view = url.searchParams.get("view");

  if (view === "duplicates") {
    try {
      const groups = await loadProjectDuplicateGroups();
      return NextResponse.json({ groups, view: "duplicates" });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not load project duplicate groups.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const limit = Math.min(
    2000,
    Math.max(1, Number(url.searchParams.get("limit") ?? 500) || 500),
  );
  const sort = parseProjectFingerprintListSort(url.searchParams.get("sort"));

  try {
    const { projects, stats } = await loadProjectFingerprintSummaries({
      limit,
      sort,
    });
    return NextResponse.json({ projects, stats });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load project fingerprints.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  let body: {
    action?: string;
    sourceProjectId?: string;
    sourceProjectIds?: string[];
    targetProjectId?: string;
    projectId?: string;
    field?: string;
    value?: string;
    projectName?: string | null;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.action === "deny_field") {
    const result = await recordProjectFieldDenial({
      projectId: body.projectId ?? "",
      field: body.field ?? "",
      value: body.value ?? "",
      projectName: body.projectName,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    invalidateProjectFingerprintSummariesCache();
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

  const sourceProjectIds = Array.isArray(body.sourceProjectIds)
    ? body.sourceProjectIds
    : body.sourceProjectId
      ? [body.sourceProjectId]
      : [];
  const result = await manualMergeManyProjects({
    sourceProjectIds,
    targetProjectId: body.targetProjectId ?? "",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  invalidateProjectFingerprintSummariesCache();
  return NextResponse.json({
    ok: true,
    survivorId: result.survivorKey,
    merged: result.merged,
  });
}
