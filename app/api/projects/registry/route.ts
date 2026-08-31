export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  parseEntityListLimit,
  parseEntityListOffset,
} from "@/lib/entities/registry-page";
import { recordProjectFieldDenial } from "@/lib/projects/field-denials";
import {
  invalidateProjectFingerprintSummariesCache,
  loadProjectDuplicateGroups,
  loadProjectFingerprintSummaries,
  parseProjectFingerprintListSort,
} from "@/lib/projects/fingerprint-list";
import { manualMergeManyProjects } from "@/lib/projects/manual-merge";
import {
  getProjectMentionStats,
  loadProjectMentionQueueGroups,
} from "@/lib/projects/mention-queue";
import { refreshProjectEntitiesAndResolveMentions } from "@/lib/projects/mention-resolve";

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

  if (view === "mention_stats") {
    try {
      const mentionStats = await getProjectMentionStats();
      return NextResponse.json({ view: "mention_stats", mentionStats });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not load project mention stats.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (view === "mentions") {
    const mentionView = url.searchParams.get("mentionView");
    const started = Date.now();
    console.info("[projects:registry] mentions start", { mentionView });
    try {
      const queue = await loadProjectMentionQueueGroups({
        view: mentionView,
      });
      console.info("[projects:registry] mentions done", {
        mentionView: queue.view,
        groups: queue.groups.length,
        ms: Date.now() - started,
      });
      return NextResponse.json({
        view: "mentions",
        mentionView: queue.view,
        groups: queue.groups,
        mentionStats: queue.stats,
        groupCount: queue.groups.length,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not load project mentions.";
      console.error("[projects:registry] mentions failed", {
        mentionView,
        ms: Date.now() - started,
        error: message,
      });
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const limit = parseEntityListLimit(url.searchParams.get("limit"));
  const offset = parseEntityListOffset(url.searchParams.get("offset"));
  const sort = parseProjectFingerprintListSort(url.searchParams.get("sort"));

  try {
    const [{ projects, stats }, mentionStats] = await Promise.all([
      loadProjectFingerprintSummaries({
        limit,
        offset,
        sort,
      }),
      getProjectMentionStats().catch(() => null),
    ]);
    return NextResponse.json({ projects, stats, mentionStats });
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
    limit?: number;
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

  if (body.action === "resolve_mentions") {
    try {
      const result = await refreshProjectEntitiesAndResolveMentions({
        limit: body.limit ?? 8000,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not resolve project mentions.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (body.action !== "merge") {
    return NextResponse.json(
      {
        error:
          'Unsupported action. Use action: "merge", "deny_field", or "resolve_mentions".',
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
