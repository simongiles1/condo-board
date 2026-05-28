import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { analysisSettings } from "@/lib/db/schema";
import {
  DEFAULT_ANALYSIS_MODEL,
  type AnalysisSettings,
} from "@/lib/email-analysis/settings-shared";

export {
  AVAILABLE_ANALYSIS_MODELS,
  DEFAULT_ANALYSIS_MODEL,
  formatAnalysisModelOptionLabel,
  isAllowedAnalysisModel,
  type AnalysisSettings,
} from "@/lib/email-analysis/settings-shared";

const SETTINGS_ID = "default";

function envModel(): string {
  return (
    process.env.GEMINI_MODEL_EMAIL_ANALYSIS?.trim() || DEFAULT_ANALYSIS_MODEL
  );
}

function envMaxTokens(): number {
  return Number(process.env.GEMINI_MAX_OUTPUT_TOKENS_EMAIL_ANALYSIS ?? 65536);
}

export async function getAnalysisSettings(): Promise<AnalysisSettings> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(analysisSettings)
    .where(eq(analysisSettings.id, SETTINGS_ID));

  if (!row) {
    return {
      analysisModel: envModel(),
      mergeModel: null,
      maxOutputTokens: envMaxTokens(),
      extractionVersion: 1,
    };
  }

  return {
    analysisModel: row.analysisModel || envModel(),
    mergeModel: row.mergeModel,
    maxOutputTokens: row.maxOutputTokens || envMaxTokens(),
    extractionVersion: row.extractionVersion,
  };
}

export async function updateAnalysisSettings(
  patch: Partial<AnalysisSettings>,
): Promise<AnalysisSettings> {
  const db = getDb();
  const now = new Date().toISOString();
  const current = await getAnalysisSettings();

  const next: AnalysisSettings = {
    analysisModel: patch.analysisModel ?? current.analysisModel,
    mergeModel:
      patch.mergeModel !== undefined ? patch.mergeModel : current.mergeModel,
    maxOutputTokens: patch.maxOutputTokens ?? current.maxOutputTokens,
    extractionVersion: patch.extractionVersion ?? current.extractionVersion,
  };

  await db
    .insert(analysisSettings)
    .values({
      id: SETTINGS_ID,
      analysisModel: next.analysisModel,
      mergeModel: next.mergeModel,
      maxOutputTokens: next.maxOutputTokens,
      extractionVersion: next.extractionVersion,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: analysisSettings.id,
      set: {
        analysisModel: next.analysisModel,
        mergeModel: next.mergeModel,
        maxOutputTokens: next.maxOutputTokens,
        extractionVersion: next.extractionVersion,
        updatedAt: now,
      },
    });

  return next;
}
