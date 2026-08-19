export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  backfillSparsePersonsToMentions,
  previewContactMentionBackfill,
} from "@/lib/contacts/mention-backfill";
import {
  attachUnresolvedMentionGroup,
  createPersonFromUnresolvedMentionGroup,
  loadMentionQueueGroups,
} from "@/lib/contacts/mention-queue";
import {
  getRegistryStats,
  loadContactDuplicateGroups,
  loadContactEmailIndex,
  loadContactMergeActivity,
  loadContactRegistryPersons,
  loadSharedMailboxes,
} from "@/lib/contacts/registry-load";
import {
  processPendingRegistryIngests,
  sweepSharedMailboxConflicts,
} from "@/lib/contacts/registry-queue";
import {
  coalesceWeakEmailDuplicatePersons,
  manualMergeManyPersons,
} from "@/lib/contacts/registry-apply";
import { cleanupSharedMailboxRegistry } from "@/lib/contacts/registry-cleanup";
import { proposeDuplicateMerges } from "@/lib/contacts/duplicate-merge-propose";
import { severContactPersonField } from "@/lib/contacts/sever-person-field";
import {
  parseContactPersonListSort,
  personDisplayName,
} from "@/lib/contacts/registry-shared";

export async function GET(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "persons";
  const limit = Math.min(
    2000,
    Math.max(1, Number(url.searchParams.get("limit") ?? 200) || 200),
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const sort = parseContactPersonListSort(url.searchParams.get("sort"));
  const skipVerifiedMentions =
    url.searchParams.get("skipVerifiedMentions") === "1" ||
    url.searchParams.get("skipVerifiedMentions") === "true";

  if (view === "emails") {
    const emails = await loadContactEmailIndex(limit);
    const stats = await getRegistryStats();
    return NextResponse.json({ view: "emails", emails, stats });
  }

  if (view === "mailboxes") {
    const { mailboxes, stats } = await loadSharedMailboxes();
    return NextResponse.json({ view: "mailboxes", mailboxes, stats });
  }

  if (view === "activity") {
    const activity = await loadContactMergeActivity(limit);
    const stats = await getRegistryStats();
    return NextResponse.json({ view: "activity", activity, stats });
  }

  if (view === "stats") {
    const stats = await getRegistryStats();
    return NextResponse.json({ view: "stats", stats });
  }

  if (view === "duplicates") {
    const [groups, stats] = await Promise.all([
      loadContactDuplicateGroups(),
      getRegistryStats(),
    ]);
    return NextResponse.json({
      view: "duplicates",
      groups,
      stats,
      groupCount: groups.length,
    });
  }

  if (view === "mentions") {
    const [queue, stats] = await Promise.all([
      loadMentionQueueGroups({
        view: url.searchParams.get("mentionView"),
      }),
      getRegistryStats(),
    ]);
    return NextResponse.json({
      view: "mentions",
      mentionView: queue.view,
      groups: queue.groups,
      mentionStats: queue.stats,
      stats,
      groupCount: queue.groups.length,
    });
  }

  const [persons, stats] = await Promise.all([
    loadContactRegistryPersons({
      limit,
      offset,
      sort,
      skipVerifiedMentions,
    }),
    getRegistryStats(),
  ]);
  const total = stats.personCount;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(totalPages, Math.floor(offset / limit) + 1);
  return NextResponse.json({
    view: "persons",
    stats,
    persons: persons.map((p) => ({
      ...p,
      displayName: personDisplayName(p),
    })),
    pagination: {
      offset,
      limit,
      page,
      pageSize: limit,
      total,
      totalPages,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  let body: {
    action?: string;
    limit?: number;
    modelId?: string;
    email?: string;
    sourcePersonId?: string;
    sourcePersonIds?: string[];
    targetPersonId?: string;
    personId?: string;
    memberIds?: string[];
    field?: string;
    value?: string;
    groupId?: string;
    mentionIds?: string[];
    dryRun?: boolean;
    forceHarvest?: boolean;
    harvestLimit?: number;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.action === "propose_duplicate_merges") {
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds : [];
    try {
      const outcome = await proposeDuplicateMerges({
        memberIds,
        modelId: body.modelId ?? null,
      });
      if (!outcome.ok) {
        return NextResponse.json({ error: outcome.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, ...outcome.result });
    } catch (error) {
      console.error("[contacts:propose_duplicate_merges]", error);
      return NextResponse.json(
        { error: "Could not propose duplicate merges." },
        { status: 500 },
      );
    }
  }

  if (body.action === "sweep") {
    try {
      const result = await sweepSharedMailboxConflicts({
        modelId: body.modelId ?? null,
        limit: body.limit ?? 20,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      console.error("[contacts:sweep]", error);
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "Sweep failed.",
        },
        { status: 500 },
      );
    }
  }

  if (body.action === "coalesce") {
    try {
      const result = await coalesceWeakEmailDuplicatePersons();
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      console.error("[contacts:coalesce]", error);
      return NextResponse.json(
        { error: "Could not coalesce mailbox stubs." },
        { status: 500 },
      );
    }
  }

  if (body.action === "cleanup_shared") {
    try {
      const result = await cleanupSharedMailboxRegistry({
        dryRun: false,
        emailFilter:
          typeof body.email === "string" && body.email.trim()
            ? body.email.trim()
            : null,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      console.error("[contacts:cleanup_shared]", error);
      return NextResponse.json(
        { error: "Shared-mailbox cleanup failed." },
        { status: 500 },
      );
    }
  }

  if (body.action === "merge") {
    const sourcePersonIds = Array.isArray(body.sourcePersonIds)
      ? body.sourcePersonIds
      : body.sourcePersonId
        ? [body.sourcePersonId]
        : [];
    const result = await manualMergeManyPersons({
      sourcePersonIds,
      targetPersonId: body.targetPersonId ?? "",
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      survivorId: result.survivorId,
      merged: result.merged,
    });
  }

  if (body.action === "attach_mentions") {
    try {
      const result = await attachUnresolvedMentionGroup({
        groupId: body.groupId ?? "",
        personId: body.personId ?? body.targetPersonId ?? "",
        mentionIds: Array.isArray(body.mentionIds)
          ? body.mentionIds.filter(
              (id: unknown): id is string =>
                typeof id === "string" && id.trim().length > 0,
            )
          : undefined,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json(result);
    } catch (error) {
      console.error("[contacts:attach_mentions]", error);
      return NextResponse.json(
        { error: "Could not attach mention group." },
        { status: 500 },
      );
    }
  }

  if (body.action === "create_person_from_mentions") {
    try {
      const result = await createPersonFromUnresolvedMentionGroup({
        groupId: body.groupId ?? "",
        mentionIds: Array.isArray(body.mentionIds)
          ? body.mentionIds.filter(
              (id: unknown): id is string =>
                typeof id === "string" && id.trim().length > 0,
            )
          : undefined,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json(result);
    } catch (error) {
      console.error("[contacts:create_person_from_mentions]", error);
      return NextResponse.json(
        { error: "Could not create a person from those mentions." },
        { status: 500 },
      );
    }
  }

  if (body.action === "preview_convert_stubs") {
    try {
      const preview = await previewContactMentionBackfill();
      return NextResponse.json({ ok: true, ...preview });
    } catch (error) {
      console.error("[contacts:preview_convert_stubs]", error);
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not preview stub conversion.",
        },
        { status: 500 },
      );
    }
  }

  if (body.action === "convert_stubs") {
    try {
      const result = await backfillSparsePersonsToMentions({
        dryRun: body.dryRun === true,
        forceHarvest: body.forceHarvest === true,
        harvestLimit:
          typeof body.harvestLimit === "number" && body.harvestLimit > 0
            ? Math.min(200, body.harvestLimit)
            : undefined,
      });
      return NextResponse.json({
        ok: true,
        ...result,
        details: result.details.slice(0, 40),
      });
    } catch (error) {
      console.error("[contacts:convert_stubs]", error);
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not convert sparse stubs.",
        },
        { status: 500 },
      );
    }
  }
  if (body.action === "deny_field") {
    const field = body.field ?? "";
    if (
      field !== "email" &&
      field !== "phone" &&
      field !== "title" &&
      field !== "name_alias"
    ) {
      return NextResponse.json(
        { error: "Unsupported field for deny_field." },
        { status: 400 },
      );
    }
    const result = await severContactPersonField({
      personId: body.personId ?? "",
      field,
      value: body.value ?? "",
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  // Default: process pending fingerprint merges into registry (mention-ordered).
  try {
    const result = await processPendingRegistryIngests({
      limit: body.limit ?? 25,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[contacts:backfill]", error);
    const message =
      error instanceof Error
        ? error.message
        : "Could not process pending merges.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
