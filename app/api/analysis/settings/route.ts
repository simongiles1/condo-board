export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  AVAILABLE_ANALYSIS_MODELS,
  getAnalysisSettings,
  isAllowedAnalysisModel,
  updateAnalysisSettings,
} from "@/lib/email-analysis/settings";

export async function GET() {
  const settings = await getAnalysisSettings();
  return NextResponse.json({
    settings,
    availableModels: AVAILABLE_ANALYSIS_MODELS,
  });
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      analysisModel?: string;
      mergeModel?: string | null;
      maxOutputTokens?: number;
    };

    if (
      body.analysisModel !== undefined &&
      !isAllowedAnalysisModel(body.analysisModel)
    ) {
      return NextResponse.json(
        { error: "Invalid analysis model." },
        { status: 400 },
      );
    }

    if (
      body.mergeModel != null &&
      body.mergeModel !== "" &&
      !isAllowedAnalysisModel(body.mergeModel)
    ) {
      return NextResponse.json({ error: "Invalid merge model." }, { status: 400 });
    }

    const settings = await updateAnalysisSettings(body);
    return NextResponse.json({ settings });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
