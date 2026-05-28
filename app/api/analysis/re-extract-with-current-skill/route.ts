export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { compileSkillPromptSection } from "@/lib/email-analysis/extraction-skill";
import { analyzeEmailBatch } from "@/lib/email-analysis/worker";
import { getDb } from "@/lib/db";
import { extractionSources } from "@/lib/db/schema";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      confirm?: boolean;
      limit?: number;
    };

    if (!body.confirm) {
      return NextResponse.json(
        { error: "Confirmation required." },
        { status: 400 },
      );
    }

    const skill = await compileSkillPromptSection();
    const db = getDb();
    const rows = await db.select().from(extractionSources);
    const emailIds = [
      ...new Set(
        rows
          .filter(
            (row) =>
              row.sourceType === "email_message" &&
              row.skillVersionId !== skill.skillVersionId,
          )
          .map((row) => row.sourceId),
      ),
    ].slice(0, body.limit ?? 10_000);

    const results = await analyzeEmailBatch({
      emailIds,
      reprocess: true,
    });

    return NextResponse.json({
      currentSkillVersion: skill.skillVersionNumber,
      queuedCount: emailIds.length,
      processedCount: results.length,
      results,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Re-extraction failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
