export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  saveRiserTemplate,
  standardizeRiserType,
} from "@/lib/building/floor-plans";
import type { RiserTypeTemplate } from "@/lib/building/floor-plan-riser-templates";

export async function POST(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  try {
    const body = (await request.json()) as {
      typeId?: unknown;
      template?: unknown;
      planIds?: unknown;
      autoOrient?: unknown;
    };

    if (typeof body.typeId !== "string" || !body.typeId.trim()) {
      return NextResponse.json(
        { error: "typeId is required." },
        { status: 400 },
      );
    }

    if (!body.template || typeof body.template !== "object") {
      return NextResponse.json(
        { error: "template object is required." },
        { status: 400 },
      );
    }

    const template = body.template as RiserTypeTemplate;
    const planIds = Array.isArray(body.planIds)
      ? body.planIds.filter((id): id is string => typeof id === "string")
      : undefined;
    const autoOrient = typeof body.autoOrient === "boolean" ? body.autoOrient : undefined;

    const result = await standardizeRiserType({
      typeId: body.typeId.trim(),
      template,
      planIds,
      autoOrient,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not standardize risers.";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  try {
    const body = (await request.json()) as {
      template?: unknown;
    };

    if (!body.template || typeof body.template !== "object") {
      return NextResponse.json(
        { error: "template object is required." },
        { status: 400 },
      );
    }

    const template = body.template as RiserTypeTemplate;
    if (typeof template.typeId !== "string" || !template.typeId.trim()) {
      return NextResponse.json(
        { error: "template.typeId is required." },
        { status: 400 },
      );
    }

    const result = await saveRiserTemplate(template);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save template.";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
