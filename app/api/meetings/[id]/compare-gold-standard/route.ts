export const runtime = "nodejs";

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { meetings } from "@/lib/db/schema";
import { generateOmissionsAnalysis } from "@/lib/gemini/client";
import { parseGoldStandardValidationResponse } from "@/lib/gemini/parse-output";
import { GOLD_STANDARD_VALIDATION_SYSTEM_PROMPT } from "@/lib/gemini/prompts";
import {
  inputTruncationWarning,
  PROMPT_INPUT_LIMITS,
  sliceForPrompt,
} from "@/lib/gemini/prompt-input-limits";
import {
  appendAiUsageRun,
  buildGoldStandardValidationRun,
} from "@/lib/gemini/usage";
import { serializeGoldStandardValidation } from "@/lib/minutes/gold-standard-schema";
import { extractPdfText } from "@/lib/parsers/pdf";

function buildGoldStandardValidationPrompt(
  title: string,
  meetingDate: string,
  minutesJson: string,
  goldStandardText: string,
): string {
  return `Meeting: ${title}
Meeting date: ${meetingDate}

AI-GENERATED MINUTES JSON (compare against this)
<<<
${minutesJson}
>>>

GOLD STANDARD MINUTES TEXT (from approved PDF)
<<<
${goldStandardText}
>>>`;
}

function buildValidationJsonRetryPrompt(basePrompt: string): string {
  return `${basePrompt}

CRITICAL RETRY — YOUR PREVIOUS RESPONSE WAS NOT VALID JSON:
Re-emit ONLY a single bare JSON object matching the validation_v1 schema (no markdown fences, no commentary).
Required keys: schema_version, analyzed_at, validation_score, score_rationale, generated_only (array), gold_only (array).
Each finding needs id, topic, detail, and significance (critical | moderate | minor).`;
}

async function runGoldStandardValidation(options: {
  systemInstruction: string;
  userText: string;
  modelName?: string;
}) {
  const maxAttempts = 2;
  let userText = options.userText;
  let lastGeneration: Awaited<ReturnType<typeof generateOmissionsAnalysis>> | null =
    null;
  let lastParse: ReturnType<typeof parseGoldStandardValidationResponse> | null =
    null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const generation = await generateOmissionsAnalysis({
      systemInstruction: options.systemInstruction,
      userText,
      modelName: options.modelName,
    });
    const parsed = parseGoldStandardValidationResponse(generation.text);

    lastGeneration = generation;
    lastParse = parsed;

    if (parsed.validation) {
      return { generation, parsed };
    }

    console.error("[meetings:compare-gold-standard:parse-failure]", {
      attempt,
      errors: parsed.errors,
      warnings: parsed.warnings,
      truncated: generation.truncated,
      finishReason: generation.finishReason,
      retryCount: generation.retryCount,
      rawTextLength: generation.text.length,
      rawTextPreview: generation.text.slice(0, 2000),
    });

    if (attempt < maxAttempts - 1) {
      userText = buildValidationJsonRetryPrompt(options.userText);
    }
  }

  return {
    generation: lastGeneration!,
    parsed: lastParse!,
  };
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const formData = await req.formData();
    const goldStandardFile = formData.get("goldStandardPdf");

    if (!(goldStandardFile instanceof File) || goldStandardFile.size === 0) {
      return NextResponse.json(
        { error: "A gold standard PDF file is required." },
        { status: 400 },
      );
    }

    const db = getDb();

    const [meeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, id));

    if (!meeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    if (!meeting.minutesJson?.trim()) {
      return NextResponse.json(
        { error: "Meeting has no structured minutes JSON to compare." },
        { status: 400 },
      );
    }

    const uploadRoot = path.resolve(process.cwd(), "uploads", id);
    await mkdir(uploadRoot, { recursive: true });

    const goldStandardAbsolute = path.join(uploadRoot, "gold-standard.pdf");
    const pdfBuffer = Buffer.from(await goldStandardFile.arrayBuffer());
    await writeFile(goldStandardAbsolute, pdfBuffer);

    const goldStandardFilePath = path
      .relative(process.cwd(), goldStandardAbsolute)
      .replace(/\\/g, "/");

    const extractedGoldStandard = await extractPdfText(pdfBuffer);
    if (!extractedGoldStandard.trim()) {
      return NextResponse.json(
        {
          error:
            "Gold standard PDF yielded no selectable text. Upload a text-based PDF.",
        },
        { status: 400 },
      );
    }

    const minutesJsonInput = sliceForPrompt(
      meeting.minutesJson,
      PROMPT_INPUT_LIMITS.minutesJson,
    );
    const goldStandardInput = sliceForPrompt(
      extractedGoldStandard,
      PROMPT_INPUT_LIMITS.goldStandardPdf,
    );

    const promptInputWarnings: string[] = [];

    if (minutesJsonInput.truncated) {
      promptInputWarnings.push(
        inputTruncationWarning(
          "AI minutes JSON",
          minutesJsonInput,
          PROMPT_INPUT_LIMITS.minutesJson,
        ),
      );
    }

    if (goldStandardInput.truncated) {
      promptInputWarnings.push(
        inputTruncationWarning(
          "Gold standard PDF text",
          goldStandardInput,
          PROMPT_INPUT_LIMITS.goldStandardPdf,
        ),
      );
    }

    const userText = buildGoldStandardValidationPrompt(
      meeting.title,
      meeting.meetingDate,
      minutesJsonInput.text,
      goldStandardInput.text,
    );

    const { generation, parsed } = await runGoldStandardValidation({
      systemInstruction: GOLD_STANDARD_VALIDATION_SYSTEM_PROMPT,
      userText,
    });

    if (!parsed.validation) {
      return NextResponse.json(
        {
          error: "Gold standard validation failed.",
          details: parsed.errors,
          warnings: parsed.warnings,
        },
        { status: 422 },
      );
    }

    const analyzedAt = new Date().toISOString();
    const validationWithTimestamp = {
      ...parsed.validation,
      analyzedAt: parsed.validation.analyzedAt || analyzedAt,
    };

    const serialized = serializeGoldStandardValidation(validationWithTimestamp);
    const validationUsageRun = buildGoldStandardValidationRun({
      id: randomUUID(),
      ranAt: validationWithTimestamp.analyzedAt,
      modelName: generation.modelName,
      usage: generation.usage,
      existingJson: meeting.aiUsageJson,
    });
    const aiUsageJson = appendAiUsageRun(
      meeting.aiUsageJson,
      validationUsageRun,
    );

    await db
      .update(meetings)
      .set({
        goldStandardFilePath,
        goldStandardValidationJson: serialized,
        aiUsageJson,
      })
      .where(eq(meetings.id, id));

    const warnings = [...parsed.warnings, ...promptInputWarnings];
    if (generation.truncated) {
      warnings.push(
        "Validation output may be truncated. Re-run if results look incomplete.",
      );
    }
    if (generation.retryCount > 0) {
      warnings.push(
        `Validation output was continued with ${generation.retryCount} extra call(s) after hitting the token limit.`,
      );
    }

    return NextResponse.json({
      validation: validationWithTimestamp,
      warnings: warnings.length ? warnings : undefined,
      aiUsageJson,
    });
  } catch (error) {
    console.error("[meetings:compare-gold-standard]", error);
    return NextResponse.json(
      { error: "Could not compare against gold standard." },
      { status: 500 },
    );
  }
}
