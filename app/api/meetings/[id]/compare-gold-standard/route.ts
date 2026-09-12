export const runtime = "nodejs";
export const maxDuration = 300;

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { meetings } from "@/lib/db/schema";
import {
  meetingsV2,
  meetingsV2AgendaItems,
  meetingsV2MinutesDrafts,
} from "@/lib/db/schema";
import { formatGeminiApiErrorMessage } from "@/lib/gemini/client";
import {
  appendAiUsageRun,
  buildGoldStandardValidationRun,
} from "@/lib/gemini/usage";
import { serializeGoldStandardValidation } from "@/lib/minutes/gold-standard-schema";
import { buildAiMinutesConcepts } from "@/lib/minutes/gold-standard-ai-concepts";
import {
  extractGoldStandardMinutesText,
  runGoldStandardComparePipeline,
} from "@/lib/minutes/gold-standard-compare-pipeline";
import { saveMeetingV2GoldStandardArtifact } from "@/lib/meeting-v2/service";
import type { MeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const formData = await req.formData();
    const goldStandardFile = formData.get("goldStandardPdf");
    const reuseStored =
      formData.get("reuseStored") === "1" ||
      formData.get("reuseStored") === "true";

    const db = getDb();

    const [meeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, id));

    const [v2Meeting] = await db
      .select()
      .from(meetingsV2)
      .where(eq(meetingsV2.id, id));

    if (!meeting && !v2Meeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    let minutesJsonToCompare = meeting?.minutesJson?.trim() ?? "";
    if (!minutesJsonToCompare && v2Meeting) {
      const [v2Draft] = await db
        .select()
        .from(meetingsV2MinutesDrafts)
        .where(eq(meetingsV2MinutesDrafts.meetingV2Id, id))
        .orderBy(desc(meetingsV2MinutesDrafts.createdAt))
        .limit(1);

      if (v2Draft?.summaryJson) {
        minutesJsonToCompare = v2Draft.summaryJson;
      } else if (v2Draft?.contentMarkdown) {
        minutesJsonToCompare = v2Draft.contentMarkdown;
      }
    }

    if (!minutesJsonToCompare) {
      return NextResponse.json(
        {
          error:
            "No structured minutes or draft found to compare. Please generate a minutes draft first.",
        },
        { status: 400 },
      );
    }

    const existingSettings = (v2Meeting?.settings as MeetingV2Settings) || {};
    const storedGoldPath =
      existingSettings.goldStandardFilePath ??
      meeting?.goldStandardFilePath ??
      null;

    let goldStandardFilePath = storedGoldPath;
    let pdfBuffer: Buffer | null = null;
    let originalFilename = "gold-standard.pdf";
    let mimeType = "application/pdf";

    if (goldStandardFile instanceof File && goldStandardFile.size > 0) {
      const uploadRoot = path.resolve(process.cwd(), "uploads", id);
      await mkdir(uploadRoot, { recursive: true });
      const goldStandardAbsolute = path.join(uploadRoot, "gold-standard.pdf");
      pdfBuffer = Buffer.from(await goldStandardFile.arrayBuffer());
      await writeFile(goldStandardAbsolute, pdfBuffer);
      goldStandardFilePath = path
        .relative(process.cwd(), goldStandardAbsolute)
        .replace(/\\/g, "/");
      originalFilename = goldStandardFile.name || originalFilename;
      mimeType = goldStandardFile.type || mimeType;
    } else if (reuseStored && storedGoldPath) {
      const absolute = path.resolve(process.cwd(), storedGoldPath);
      pdfBuffer = await readFile(absolute);
      goldStandardFilePath = storedGoldPath;
    } else {
      return NextResponse.json(
        { error: "A gold standard PDF file is required." },
        { status: 400 },
      );
    }

    const goldStandardAbsolute = path.resolve(
      process.cwd(),
      goldStandardFilePath,
    );
    const extractedGold = await extractGoldStandardMinutesText({
      buffer: pdfBuffer,
      pdfPath: goldStandardAbsolute,
    });
    if (!extractedGold.text.trim()) {
      return NextResponse.json(
        {
          error:
            "Gold standard PDF yielded no text. Upload a text-based or Docling-readable PDF.",
        },
        { status: 400 },
      );
    }

    const agendaItems = v2Meeting
      ? await db
          .select({
            id: meetingsV2AgendaItems.id,
            title: meetingsV2AgendaItems.title,
            itemNumber: meetingsV2AgendaItems.itemNumber,
            sectionLabel: meetingsV2AgendaItems.sectionLabel,
          })
          .from(meetingsV2AgendaItems)
          .where(eq(meetingsV2AgendaItems.meetingV2Id, id))
      : [];

    const aiConcepts = buildAiMinutesConcepts(minutesJsonToCompare, agendaItems);
    const meetingTitle = meeting?.title || v2Meeting?.title || "Board Meeting";
    const meetingDate = meeting?.meetingDate || v2Meeting?.meetingDate || "";

    const pipeline = await runGoldStandardComparePipeline({
      goldText: extractedGold.text,
      aiConcepts,
      meetingTitle,
      meetingDate,
    });

    const serialized = serializeGoldStandardValidation(pipeline.validation);
    const baseUsageJson = meeting?.aiUsageJson ?? null;
    const validationUsageRun = buildGoldStandardValidationRun({
      id: randomUUID(),
      ranAt: pipeline.validation.analyzedAt,
      modelName: pipeline.modelName,
      usage: pipeline.usage,
      existingJson: baseUsageJson,
    });
    const aiUsageJson = appendAiUsageRun(baseUsageJson, validationUsageRun);

    if (meeting) {
      await db
        .update(meetings)
        .set({
          goldStandardFilePath,
          goldStandardValidationJson: serialized,
          aiUsageJson,
        })
        .where(eq(meetings.id, id));
    }

    if (v2Meeting) {
      const nextSettings: MeetingV2Settings = {
        ...existingSettings,
        goldStandardFilePath,
        goldStandardValidationJson: serialized,
        goldStandardValidationRuns: [
          ...(existingSettings.goldStandardValidationRuns ?? []),
          {
            id: validationUsageRun.id,
            label: validationUsageRun.label,
            ranAt: validationUsageRun.ranAt,
            modelName: validationUsageRun.modelName,
            inputTokens: validationUsageRun.inputTokens,
            outputTokens: validationUsageRun.outputTokens,
            totalTokens: validationUsageRun.totalTokens,
          },
        ],
      };
      await db
        .update(meetingsV2)
        .set({
          settings: nextSettings,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(meetingsV2.id, id));

      try {
        await saveMeetingV2GoldStandardArtifact(
          id,
          goldStandardFilePath,
          originalFilename,
          mimeType,
          null,
        );
      } catch (artifactErr) {
        console.error(
          "[meetings:compare-gold-standard] Failed to save V2 source artifact:",
          artifactErr,
        );
      }
    }

    const warnings = [...pipeline.warnings];
    if (extractedGold.doclingPageCount === 0) {
      warnings.push(
        "IBM Docling was unavailable; gold minutes were extracted with local PDF text.",
      );
    }
    if (pipeline.truncated) {
      warnings.push(
        "A compare stage may be truncated. Re-run if a concept looks incomplete.",
      );
    }
    if (pipeline.retryCount > 0) {
      warnings.push(
        `Compare output was continued with ${pipeline.retryCount} extra call(s) after hitting the token limit.`,
      );
    }

    return NextResponse.json({
      validation: pipeline.validation,
      warnings: warnings.length ? warnings : undefined,
      aiUsageJson,
    });
  } catch (error) {
    console.error("[meetings:compare-gold-standard]", error);
    const friendly = formatGeminiApiErrorMessage(error);
    const billingBlocked =
      friendly?.includes("credits") || friendly?.includes("spending cap");
    return NextResponse.json(
      {
        error:
          friendly ??
          (error instanceof Error
            ? error.message
            : "Could not compare against gold standard."),
      },
      { status: billingBlocked ? 402 : 500 },
    );
  }
}
