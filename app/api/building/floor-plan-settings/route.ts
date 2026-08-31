export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import type { DrawColorPreset } from "@/lib/building/floor-plan-annotations";
import { updateFloorPlanSettings } from "@/lib/building/floor-plans";

export async function PATCH(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;
  try {
    const body = (await request.json()) as {
      registrationLabel?: string;
      registrationPlanId?: string | null;
      pinReferencePlanId?: string | null;
      drawColorPresets?: unknown;
    };
    const settings = await updateFloorPlanSettings({
      registrationLabel:
        typeof body.registrationLabel === "string"
          ? body.registrationLabel
          : undefined,
      registrationPlanId:
        body.registrationPlanId === null
          ? null
          : typeof body.registrationPlanId === "string"
            ? body.registrationPlanId
            : undefined,
      pinReferencePlanId:
        body.pinReferencePlanId === null
          ? null
          : typeof body.pinReferencePlanId === "string"
            ? body.pinReferencePlanId
            : undefined,
      drawColorPresets:
        body.drawColorPresets != null
          ? (body.drawColorPresets as DrawColorPreset[])
          : undefined,
    });
    return NextResponse.json(settings);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save settings.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
