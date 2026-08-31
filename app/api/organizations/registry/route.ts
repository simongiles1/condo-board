export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  parseEntityListLimit,
  parseEntityListOffset,
} from "@/lib/entities/registry-page";
import {
  moveOrganizationField,
  moveOrganizationFieldToPerson,
} from "@/lib/organizations/field-attachments";
import { recordOrganizationFieldDenial } from "@/lib/organizations/field-denials";
import {
  loadOrgDuplicateGroups,
  loadOrgFingerprintSummaries,
  parseOrgFingerprintListSort,
  invalidateOrgFingerprintSummariesCache,
} from "@/lib/organizations/fingerprint-list";
import { manualMergeManyOrganizations } from "@/lib/organizations/manual-merge";
import {
  backfillOrgMentionsFromHarvest,
  previewOrgMentionBackfill,
} from "@/lib/organizations/mention-backfill";

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

  if (view === "mention_backfill") {
    try {
      const preview = await previewOrgMentionBackfill();
      return NextResponse.json({ ok: true, view: "mention_backfill", ...preview });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not load organization mention backfill status.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const limit = parseEntityListLimit(url.searchParams.get("limit"));
  const offset = parseEntityListOffset(url.searchParams.get("offset"));
  const sort = parseOrgFingerprintListSort(url.searchParams.get("sort"));

  try {
    const { organizations, stats } = await loadOrgFingerprintSummaries({
      limit,
      offset,
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
    sourceOrganizationName?: string | null;
    targetOrganizationName?: string | null;
    targetPersonId?: string;
    dryRun?: boolean;
    force?: boolean;
    harvestLimit?: number;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.action === "preview_mention_backfill") {
    try {
      const preview = await previewOrgMentionBackfill();
      return NextResponse.json({ ok: true, ...preview });
    } catch (error) {
      console.error("[organizations:preview_mention_backfill]", error);
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not preview organization mention backfill.",
        },
        { status: 500 },
      );
    }
  }

  if (body.action === "backfill_mentions") {
    try {
      const result = await backfillOrgMentionsFromHarvest({
        dryRun: body.dryRun === true,
        force: body.force === true,
        harvestLimit:
          typeof body.harvestLimit === "number" && body.harvestLimit > 0
            ? Math.min(200, body.harvestLimit)
            : undefined,
      });
      if (!result.dryRun) {
        invalidateOrgFingerprintSummariesCache();
      }
      return NextResponse.json({
        ok: true,
        ...result,
        details: result.details.slice(0, 40),
      });
    } catch (error) {
      console.error("[organizations:backfill_mentions]", error);
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not backfill organization mentions.",
        },
        { status: 500 },
      );
    }
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
    invalidateOrgFingerprintSummariesCache();
    return NextResponse.json({ ok: true, denial: result.denial });
  }

  if (body.action === "move_field") {
    const result = await moveOrganizationField({
      sourceOrganizationId: body.sourceOrganizationId ?? body.organizationId ?? "",
      targetOrganizationId: body.targetOrganizationId ?? "",
      field: body.field ?? "",
      value: body.value ?? "",
      sourceOrganizationName: body.sourceOrganizationName ?? body.organizationName,
      targetOrganizationName: body.targetOrganizationName,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    invalidateOrgFingerprintSummariesCache();
    return NextResponse.json({ ok: true });
  }

  if (body.action === "move_field_to_person") {
    const result = await moveOrganizationFieldToPerson({
      sourceOrganizationId: body.sourceOrganizationId ?? body.organizationId ?? "",
      targetPersonId: body.targetPersonId ?? "",
      field: body.field ?? "",
      value: body.value ?? "",
      sourceOrganizationName: body.sourceOrganizationName ?? body.organizationName,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    invalidateOrgFingerprintSummariesCache();
    return NextResponse.json({ ok: true, message: result.message });
  }

  if (body.action !== "merge") {
    return NextResponse.json(
      {
        error:
          'Unsupported action. Use action: "merge", "deny_field", "move_field", or "move_field_to_person".',
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
  invalidateOrgFingerprintSummariesCache();
  return NextResponse.json({
    ok: true,
    survivorId: result.survivorKey,
    merged: result.merged,
  });
}
