export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  createBulkExtractRun,
  listBulkExtractRuns,
  type BulkExtractKind,
} from "@/lib/email-analysis/bulk-extract-runs";
import { kickBulkExtractWorker } from "@/lib/email-analysis/bulk-extract-worker";
import { isContactHighlightModel } from "@/lib/email-analysis/contact-highlight-models";
import { isEventHighlightModel } from "@/lib/email-analysis/event-highlight-models";
import { isTodoHighlightModel } from "@/lib/email-analysis/todo-highlight-models";
import { isOrgHighlightModel } from "@/lib/email-analysis/org-highlight-models";
import { isProjectHighlightModel } from "@/lib/email-analysis/project-highlight-models";
import { listBulkExtractTargets } from "@/lib/email-analysis/bulk-extract-targets";

export async function GET(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get("limit") ?? "40");
    const limit = Number.isFinite(limitRaw) ? limitRaw : 40;
    const runs = await listBulkExtractRuns(limit);
    return NextResponse.json({ runs });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not list bulk extract runs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const body = (await request.json()) as {
      kind?: string;
      model?: string;
    };

    const kind: BulkExtractKind | null =
      body.kind === "contacts" ||
      body.kind === "organizations" ||
      body.kind === "projects" ||
      body.kind === "events" ||
      body.kind === "todos"
        ? body.kind
        : null;
    if (!kind) {
      return NextResponse.json(
        { error: "kind must be contacts, organizations, projects, events, or todos." },
        { status: 400 },
      );
    }

    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!model) {
      return NextResponse.json({ error: "model is required." }, { status: 400 });
    }
    if (kind === "contacts" && !isContactHighlightModel(model)) {
      return NextResponse.json(
        { error: "Unsupported contact extraction model." },
        { status: 400 },
      );
    }
    if (kind === "organizations" && !isOrgHighlightModel(model)) {
      return NextResponse.json(
        { error: "Unsupported organization extraction model." },
        { status: 400 },
      );
    }
    if (kind === "projects" && !isProjectHighlightModel(model)) {
      return NextResponse.json(
        { error: "Unsupported project extraction model." },
        { status: 400 },
      );
    }
    if (kind === "events" && !isEventHighlightModel(model)) {
      return NextResponse.json(
        { error: "Unsupported event extraction model." },
        { status: 400 },
      );
    }
    if (kind === "todos" && !isTodoHighlightModel(model)) {
      return NextResponse.json(
        { error: "Unsupported to-do extraction model." },
        { status: 400 },
      );
    }

    const { totalThreads, totalEmails } = await listBulkExtractTargets();
    if (totalEmails === 0) {
      return NextResponse.json(
        { error: "No emails to extract." },
        { status: 400 },
      );
    }

    const run = await createBulkExtractRun({
      kind,
      modelId: model,
      totalThreads,
      totalEmails,
    });

    kickBulkExtractWorker(run.id);

    return NextResponse.json({ run });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not start bulk extract run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
