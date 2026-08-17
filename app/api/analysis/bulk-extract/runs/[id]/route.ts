export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  getBulkExtractRun,
  updateBulkExtractRun,
  type BulkExtractRunPatch,
  type BulkExtractRunStatus,
} from "@/lib/email-analysis/bulk-extract-runs";

type RouteContext = { params: Promise<{ id: string }> };

const STATUSES = new Set<BulkExtractRunStatus>([
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  const { id } = await context.params;
  try {
    const run = await getBulkExtractRun(id);
    if (!run) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    return NextResponse.json({ run });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load bulk extract run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  const { id } = await context.params;
  try {
    const body = (await request.json()) as BulkExtractRunPatch & {
      status?: string;
    };

    if (body.status != null && !STATUSES.has(body.status as BulkExtractRunStatus)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }

    const patch: BulkExtractRunPatch = {};
    if (body.status) patch.status = body.status as BulkExtractRunStatus;
    if (typeof body.completedThreads === "number") {
      patch.completedThreads = body.completedThreads;
    }
    if (typeof body.completedEmails === "number") {
      patch.completedEmails = body.completedEmails;
    }
    if (typeof body.failedThreads === "number") {
      patch.failedThreads = body.failedThreads;
    }
    if (typeof body.currentThreadIndex === "number") {
      patch.currentThreadIndex = body.currentThreadIndex;
    }
    if ("currentThreadId" in body) patch.currentThreadId = body.currentThreadId ?? null;
    if ("currentThreadSubject" in body) {
      patch.currentThreadSubject = body.currentThreadSubject ?? null;
    }
    if ("currentEmailId" in body) patch.currentEmailId = body.currentEmailId ?? null;
    if ("currentEmailLabel" in body) {
      patch.currentEmailLabel = body.currentEmailLabel ?? null;
    }
    if ("currentPass" in body) {
      patch.currentPass =
        body.currentPass === null || typeof body.currentPass === "number"
          ? body.currentPass
          : undefined;
    }
    if ("currentEmailIndex" in body) {
      patch.currentEmailIndex =
        body.currentEmailIndex === null ||
        typeof body.currentEmailIndex === "number"
          ? body.currentEmailIndex
          : undefined;
    }
    if ("currentEmailTotal" in body) {
      patch.currentEmailTotal =
        body.currentEmailTotal === null ||
        typeof body.currentEmailTotal === "number"
          ? body.currentEmailTotal
          : undefined;
    }
    if (typeof body.totalCostUsd === "number" && Number.isFinite(body.totalCostUsd)) {
      patch.totalCostUsd = Math.max(0, body.totalCostUsd);
    }
    if ("lastError" in body) patch.lastError = body.lastError ?? null;

    const run = await updateBulkExtractRun(id, patch);
    if (!run) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    return NextResponse.json({ run });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not update bulk extract run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
