import { NextResponse } from "next/server";

import {
  loadItemDebugRun,
  parseItemDebugModelId,
  parseItemDebugStepKey,
  runItemDebugStep,
  saveItemDebugPrompts,
} from "@/lib/meeting-v2/item-debug";
import { isItemDebugStepKey } from "@/lib/meeting-v2/item-debug-models";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; itemId: string; runId: string }> },
) {
  try {
    const { id, itemId, runId } = await params;
    const run = await loadItemDebugRun(id, itemId, runId);
    return NextResponse.json({ run }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[v2/item-debug run GET]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load debug run" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string; runId: string }> },
) {
  try {
    const { id, itemId, runId } = await params;
    const body = (await req.json()) as {
      steps?: Array<{
        key?: unknown;
        modelId?: unknown;
        thinking?: unknown;
        systemPrompt?: unknown;
        userPrompt?: unknown;
      }>;
    };
    const steps = (body.steps ?? [])
      .filter((step) => typeof step.key === "string" && isItemDebugStepKey(step.key))
      .map((step) => ({
        key: parseItemDebugStepKey(step.key),
        modelId: step.modelId !== undefined ? parseItemDebugModelId(step.modelId) : undefined,
        thinking: typeof step.thinking === "boolean" ? step.thinking : undefined,
        systemPrompt: typeof step.systemPrompt === "string" ? step.systemPrompt : undefined,
        userPrompt: typeof step.userPrompt === "string" ? step.userPrompt : undefined,
      }));
    const run = await saveItemDebugPrompts({
      meetingId: id,
      agendaItemId: itemId,
      runId,
      steps,
    });
    return NextResponse.json({ run });
  } catch (error) {
    console.error("[v2/item-debug run PATCH]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save debug run" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string; runId: string }> },
) {
  try {
    const { id, itemId, runId } = await params;
    const body = (await req.json()) as {
      stepKey?: unknown;
      modelId?: unknown;
      thinking?: unknown;
      systemPrompt?: unknown;
      userPrompt?: unknown;
    };
    const run = await runItemDebugStep({
      meetingId: id,
      agendaItemId: itemId,
      runId,
      stepKey: parseItemDebugStepKey(body.stepKey),
      modelId: body.modelId !== undefined ? parseItemDebugModelId(body.modelId) : undefined,
      thinking: typeof body.thinking === "boolean" ? body.thinking : undefined,
      systemPrompt: typeof body.systemPrompt === "string" ? body.systemPrompt : undefined,
      userPrompt: typeof body.userPrompt === "string" ? body.userPrompt : undefined,
    });
    return NextResponse.json({ run });
  } catch (error) {
    console.error("[v2/item-debug run POST]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run debug step" },
      { status: 500 },
    );
  }
}
