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
import { vttToReadableTranscript } from "@/lib/parsers/vtt";
import { omissionsModelOverridesFromBody } from "@/lib/settings/model-settings";

function buildMinutesOmissionsPrompt(
  title: string,
  meetingDate: string,
  minutesJson: string,
  transcript: string,
): string {
  return `Meeting: ${title}
Meeting date: ${meetingDate}

OFFICIAL MINUTES JSON (compare against this)
<<<
${minutesJson.slice(0, 120000)}
>>>

FACTUAL TRANSCRIPT (authoritative)
<<<
${transcript.slice(0, 200000)}
>>>`;
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
${todosMarkdown.slice(0, 80000)}
>>>

FACTUAL TRANSCRIPT (authoritative)
<<<
${transcript.slice(0, 200000)}
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

    const minutesUserText = buildMinutesOmissionsPrompt(
      meeting.title,
      meeting.meetingDate,
      meeting.minutesJson,
      readableTranscript,
    );

    const todosUserText = buildTodosOmissionsPrompt(
      meeting.title,
      meeting.meetingDate,
      meeting.todosContent,
      readableTranscript,
    );

    const [minutesGeneration, todosGeneration] = await Promise.all([
      generateOmissionsAnalysis({
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

    const parsedMinutes = parseOmissionsResponse(minutesGeneration.text);
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

    const warnings = [...parsedMinutes.warnings, ...parsedTodos.warnings];
    if (minutesGeneration.truncated || todosGeneration.truncated) {
      warnings.push(
        "Analysis output may be truncated. Re-run if results look incomplete.",
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
