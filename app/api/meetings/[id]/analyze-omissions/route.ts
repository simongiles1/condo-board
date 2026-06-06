export const runtime = "nodejs";

import { readFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { meetings } from "@/lib/db/schema";
import { generateOmissionsAnalysis } from "@/lib/gemini/client";
import {
  parseOmissionsResponse,
  parseTodoOmissionsResponse,
} from "@/lib/gemini/parse-output";
import {
  OMISSIONS_SYSTEM_PROMPT,
  TODO_OMISSIONS_SYSTEM_PROMPT,
} from "@/lib/gemini/prompts";
import {
  appendAiUsageRun,
  buildOmissionsAnalysisRun,
} from "@/lib/gemini/usage";
import { serializeOmissionsAnalysis } from "@/lib/minutes/omissions-schema";
import { extractPdfText } from "@/lib/parsers/pdf";
import { vttToReadableTranscript } from "@/lib/parsers/vtt";
import { omissionsModelOverridesFromBody } from "@/lib/settings/model-settings";
import {
  inputTruncationWarning,
  PROMPT_INPUT_LIMITS,
  sliceForPrompt,
} from "@/lib/gemini/prompt-input-limits";

function buildMinutesOmissionsPrompt(
  title: string,
  meetingDate: string,
  minutesJson: string,
  boardPackage: string | null,
  transcript: string,
): string {
  const boardPackageBlock = boardPackage?.trim()
    ? `BOARD MEETING PACKAGE / MANAGEMENT REPORT (authoritative for ratification line items, amounts, contractors)
<<<
${boardPackage}
>>>

`
    : "";

  return `Meeting: ${title}
Meeting date: ${meetingDate}

OFFICIAL MINUTES JSON (compare against this)
<<<
${minutesJson}
>>>

${boardPackageBlock}FACTUAL TRANSCRIPT (authoritative for discussion and decisions)
<<<
${transcript}
>>>`;
}

function buildOmissionsJsonRetryPrompt(basePrompt: string): string {
  return `${basePrompt}

CRITICAL RETRY — YOUR PREVIOUS RESPONSE WAS NOT VALID JSON:
Re-emit ONLY a single bare JSON object matching the omissions_v1 schema (no markdown fences, no commentary).
Required keys: schema_version, analyzed_at, omissions (array), no_significant_omissions (boolean when empty).
Each omission needs merge_action, target_section, topic, missing_detail, why_it_matters, and agenda_item with non-empty topic and summary.`;
}

async function runMinutesOmissionsAnalysis(options: {
  systemInstruction: string;
  userText: string;
  modelName?: string;
}) {
  const maxAttempts = 2;
  let userText = options.userText;
  let lastGeneration: Awaited<ReturnType<typeof generateOmissionsAnalysis>> | null =
    null;
  let lastParse: ReturnType<typeof parseOmissionsResponse> | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const generation = await generateOmissionsAnalysis({
      systemInstruction: options.systemInstruction,
      userText,
      modelName: options.modelName,
    });
    const parsed = parseOmissionsResponse(generation.text);

    lastGeneration = generation;
    lastParse = parsed;

    if (parsed.analysis) {
      return { generation, parsed };
    }

    console.error("[meetings:analyze-omissions:minutes-parse-failure]", {
      attempt,
      errors: parsed.errors,
      warnings: parsed.warnings,
      truncated: generation.truncated,
      finishReason: generation.finishReason,
      retryCount: generation.retryCount,
      rawTextLength: generation.text.length,
      rawTextPreview: generation.text.slice(0, 2000),
      rawTextTail: generation.text.slice(-500),
    });

    if (attempt < maxAttempts - 1) {
      userText = buildOmissionsJsonRetryPrompt(options.userText);
    }
  }

  return {
    generation: lastGeneration!,
    parsed: lastParse!,
  };
}

function buildTodosOmissionsPrompt(
  title: string,
  meetingDate: string,
  todosMarkdown: string,
  transcript: string,
): string {
  return `Meeting: ${title}
Meeting date: ${meetingDate}

OFFICIAL TO-DO LIST MARKDOWN (compare against this)
<<<
${todosMarkdown}
>>>

FACTUAL TRANSCRIPT (authoritative)
<<<
${transcript}
>>>`;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const { modelMinutes, modelTodos } = omissionsModelOverridesFromBody(body);

  try {
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

    if (!meeting.todosContent?.trim()) {
      return NextResponse.json(
        { error: "Meeting has no To-Do list to compare." },
        { status: 400 },
      );
    }

    const absolute = path.resolve(process.cwd(), meeting.vttFilePath);
    const uploadRoot = path.resolve(process.cwd(), "uploads", id);

    if (!absolute.startsWith(uploadRoot)) {
      return NextResponse.json(
        { error: "Invalid transcript path." },
        { status: 400 },
      );
    }

    const vttContent = await readFile(absolute, "utf8");
    const readableTranscript = vttToReadableTranscript(vttContent);

    if (!readableTranscript.trim()) {
      return NextResponse.json(
        { error: "Transcript file is empty or unreadable." },
        { status: 400 },
      );
    }

    let boardPackageText: string | null = null;
    const boardPackageWarnings: string[] = [];

    if (meeting.boardPackageFilePath?.trim()) {
      const boardPackageAbsolute = path.resolve(
        process.cwd(),
        meeting.boardPackageFilePath,
      );

      if (!boardPackageAbsolute.startsWith(uploadRoot)) {
        return NextResponse.json(
          { error: "Invalid board package path." },
          { status: 400 },
        );
      }

      try {
        const boardPackageBuffer = await readFile(boardPackageAbsolute);
        const extractedBoardPackage = await extractPdfText(boardPackageBuffer);
        if (!extractedBoardPackage.trim()) {
          boardPackageWarnings.push(
            "Board package PDF yielded no selectable text; omissions analysis used transcript only.",
          );
        } else {
          const boardPackageInput = sliceForPrompt(
            extractedBoardPackage,
            PROMPT_INPUT_LIMITS.boardPackage,
          );
          boardPackageText = boardPackageInput.text;
          if (boardPackageInput.truncated) {
            boardPackageWarnings.push(
              inputTruncationWarning(
                "Board package PDF",
                boardPackageInput,
                PROMPT_INPUT_LIMITS.boardPackage,
              ),
            );
          }
        }
      } catch (error) {
        console.error("[meetings:analyze-omissions:board-package]", error);
        boardPackageWarnings.push(
          "Could not read board package PDF; omissions analysis used transcript only.",
        );
      }
    } else {
      boardPackageWarnings.push(
        "No board package on file for this meeting; omissions analysis used transcript only.",
      );
    }

    const transcriptInput = sliceForPrompt(
      readableTranscript,
      PROMPT_INPUT_LIMITS.transcript,
    );
    const minutesJsonInput = sliceForPrompt(
      meeting.minutesJson,
      PROMPT_INPUT_LIMITS.minutesJson,
    );
    const todosMarkdownInput = sliceForPrompt(
      meeting.todosContent,
      PROMPT_INPUT_LIMITS.todosMarkdown,
    );
    const promptInputWarnings: string[] = [];

    if (transcriptInput.truncated) {
      promptInputWarnings.push(
        inputTruncationWarning(
          "Meeting transcript",
          transcriptInput,
          PROMPT_INPUT_LIMITS.transcript,
        ),
      );
    }

    if (minutesJsonInput.truncated) {
      promptInputWarnings.push(
        inputTruncationWarning(
          "Minutes JSON",
          minutesJsonInput,
          PROMPT_INPUT_LIMITS.minutesJson,
        ),
      );
    }

    if (todosMarkdownInput.truncated) {
      promptInputWarnings.push(
        inputTruncationWarning(
          "To-Do list markdown",
          todosMarkdownInput,
          PROMPT_INPUT_LIMITS.todosMarkdown,
        ),
      );
    }

    const minutesUserText = buildMinutesOmissionsPrompt(
      meeting.title,
      meeting.meetingDate,
      minutesJsonInput.text,
      boardPackageText,
      transcriptInput.text,
    );

    const todosUserText = buildTodosOmissionsPrompt(
      meeting.title,
      meeting.meetingDate,
      todosMarkdownInput.text,
      transcriptInput.text,
    );

    const [minutesResult, todosGeneration] = await Promise.all([
      runMinutesOmissionsAnalysis({
        systemInstruction: OMISSIONS_SYSTEM_PROMPT,
        userText: minutesUserText,
        modelName: modelMinutes,
      }),
      generateOmissionsAnalysis({
        systemInstruction: TODO_OMISSIONS_SYSTEM_PROMPT,
        userText: todosUserText,
        modelName: modelTodos,
      }),
    ]);

    const minutesGeneration = minutesResult.generation;
    const parsedMinutes = minutesResult.parsed;
    const parsedTodos = parseTodoOmissionsResponse(todosGeneration.text);

    if (!parsedMinutes.analysis) {
      return NextResponse.json(
        {
          error: "Minutes omissions analysis failed validation.",
          details: parsedMinutes.errors,
          warnings: [
            ...parsedMinutes.warnings,
            ...parsedTodos.warnings,
          ],
        },
        { status: 422 },
      );
    }

    if (parsedTodos.errors.length > 0) {
      return NextResponse.json(
        {
          error: "To-Do list omissions analysis failed validation.",
          details: parsedTodos.errors,
          warnings: [
            ...parsedMinutes.warnings,
            ...parsedTodos.warnings,
          ],
        },
        { status: 422 },
      );
    }

    const analyzedAt = new Date().toISOString();
    const analysisWithTimestamp = {
      ...parsedMinutes.analysis,
      analyzedAt: parsedMinutes.analysis.analyzedAt || analyzedAt,
      todosOmissions: parsedTodos.omissions,
      ...(parsedTodos.noSignificantTodosOmissions
        ? { noSignificantTodosOmissions: true }
        : {}),
    };

    const serialized = serializeOmissionsAnalysis(analysisWithTimestamp);
    const combinedUsage = {
      inputTokens:
        minutesGeneration.usage.inputTokens + todosGeneration.usage.inputTokens,
      outputTokens:
        minutesGeneration.usage.outputTokens +
        todosGeneration.usage.outputTokens,
      totalTokens:
        minutesGeneration.usage.totalTokens + todosGeneration.usage.totalTokens,
    };
    const omissionsUsageRun = buildOmissionsAnalysisRun({
      id: randomUUID(),
      ranAt: analysisWithTimestamp.analyzedAt,
      modelName: minutesGeneration.modelName,
      usage: combinedUsage,
      existingJson: meeting.aiUsageJson,
    });
    const aiUsageJson = appendAiUsageRun(meeting.aiUsageJson, omissionsUsageRun);

    await db
      .update(meetings)
      .set({ omissionsAnalysisJson: serialized, aiUsageJson })
      .where(eq(meetings.id, id));

    const warnings = [
      ...parsedMinutes.warnings,
      ...parsedTodos.warnings,
      ...boardPackageWarnings,
      ...promptInputWarnings,
    ];
    if (minutesGeneration.truncated || todosGeneration.truncated) {
      warnings.push(
        "Analysis output may be truncated. Re-run if results look incomplete.",
      );
    }

    if (minutesGeneration.retryCount > 0) {
      warnings.push(
        `Minutes omissions output was continued with ${minutesGeneration.retryCount} extra call(s) after hitting the token limit.`,
      );
    }

    return NextResponse.json({
      analysis: analysisWithTimestamp,
      warnings: warnings.length ? warnings : undefined,
      aiUsageJson,
    });
  } catch (error) {
    console.error("[meetings:analyze-omissions]", error);
    return NextResponse.json(
      { error: "Could not analyze omissions." },
      { status: 500 },
    );
  }
}
