export const runtime = "nodejs";

import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import {
  generateMinutesV2,
  generateTodos,
} from "@/lib/gemini/client";
import { MINUTES_SYSTEM_PROMPT, TODO_SYSTEM_PROMPT } from "@/lib/gemini/prompts";
import {
  buildInitialProcessingRun,
  serializeAiUsage,
  type GeminiUsageCall,
} from "@/lib/gemini/usage";
import {
  parseMinutesV2Response,
  unwrapMarkdownCodeBlock,
  validateTodosOutput,
} from "@/lib/gemini/parse-output";
import { getDb } from "@/lib/db";
import { meetings, meetingsV2 } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";
import {
  isMinutesV2TooSparse,
  shouldRetryForRestrictedAddendum,
  wrapMinutesV2,
} from "@/lib/minutes/schema-v2";
import { v2ToMarkdown } from "@/lib/minutes/v2-to-markdown";
import { extractPdfText } from "@/lib/parsers/pdf";
import { vttToReadableTranscript } from "@/lib/parsers/vtt";
import { mainRunModelOverridesFromFormData } from "@/lib/settings/model-settings";
import {
  inputTruncationWarning,
  PROMPT_INPUT_LIMITS,
  sliceForPrompt,
} from "@/lib/gemini/prompt-input-limits";

export const maxDuration = 300;

const MAX_MINUTES_ATTEMPTS = 3;

function buildCompletenessRetryPrompt(basePrompt: string): string {
  return `${basePrompt}

CRITICAL RETRY — YOUR PREVIOUS JSON WAS INCOMPLETE (attendance-only or empty agenda items).
Re-read the ENTIRE transcript above and produce COMPLETE minutes:
- call_to_order with chair_name and time
- approval_of_previous_minutes when prior minutes were approved
- financial_matters and management_report items for every contract, ratification, or discussion topic (include EVERY section 4.1 ratification line item from the board package, even if batch-approved in the transcript)
- motions with moved_by, seconded_by, resolution_text, status on every approval
- new_or_other_business, date_of_next_meeting, termination when stated
- special_presentations for extended guest segments (sub_items per distinct point; guest departure times when stated)
- brief informational items even without debate (status-only findings, quote counts, satisfactory inspections)
- For confidential s. 55(4) topics (suite disputes, holdback/insurance settlements, legal/compliance matters), keep them in their natural bucket and set "restricted": true on each item. Place restricted items at the END of their bucket array.
- Never use empty topic/summary; use [] for empty buckets.`;
}

function buildRestrictedAddendumRetryPrompt(basePrompt: string): string {
  return `${basePrompt}

CRITICAL RETRY — RESTRICTED ITEMS MISSING OR MISPLACED:
Your previous JSON either failed to flag confidential topics with "restricted": true, or it placed confidential detail in public-only wording.
Re-read the ENTIRE transcript and:
- Find every suite-specific dispute, insurance/holdback settlement, legal/compliance matter, or s. 55(4) topic (e.g. Suite 2702 access, Suite 817 window, Suite 2005 meter, New Water holdback, Egis reserve dispute).
- Put each one in its NATURAL bucket (management_report.items_for_approval, items_for_discussion, items_for_ratification, items_for_information, financial_matters, new_or_other_business, etc.) and set "restricted": true directly on that agenda_item.
- Place restricted items at the END of their bucket array, after all public items in the same bucket.
- Do NOT use a separate "restricted_records_addendum" object — the schema no longer has one. The renderer sequesters items via the inline "restricted" flag.
- Remove suite numbers, holdback dollar amounts, and legal dispute detail from any item that is NOT flagged restricted.
Each restricted item needs non-empty topic and summary; include motions and action_items when stated.`;
}

function buildValidationRetryPrompt(
  basePrompt: string,
  errors: string[],
): string {
  return `${basePrompt}

CRITICAL RETRY — YOUR PREVIOUS JSON FAILED SCHEMA VALIDATION:
${errors.map((e) => `- ${e}`).join("\n")}

Re-emit the COMPLETE JSON document as a SINGLE bare JSON object (no markdown fences, no envelope wrapper).
Required top-level keys with these exact snake_case names:
- metadata: { corporation_name, meeting_date, meeting_time, meeting_platform?, meeting_location? }
- attendance: { present[], by_invitation[], guests[], regrets[] }
- call_to_order, special_presentations[], approval_of_previous_minutes[],
  financial_matters[], management_report, correspondence[],
  new_or_other_business[], date_of_next_meeting, termination,
  post_termination_sections[]
Each agenda item may set "restricted": true to sequester it into the Restricted Records Addendum at render time.
The "metadata" block MUST be present at the root level and MUST include non-empty corporation_name and meeting_date (ISO YYYY-MM-DD).
Do NOT wrap the document in { "schema_version": ..., "data": ... } — emit the bare document only.`;
}

function assertFile(value: unknown): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value;
}

function buildMinutesPrompt(
  referencePdf: string,
  boardPackage: string,
  transcript: string,
  meetingDate: string,
  title: string,
): string {
  return `Meeting: ${title}
Meeting date: ${meetingDate}

REFERENCE PDF TEXT (STYLE + STRUCTURAL CUES ONLY — NO FACTUAL USE)
<<<
${referencePdf}
>>>

BOARD MEETING PACKAGE / MANAGEMENT REPORT (FACTUAL — authoritative for agenda structure, ratification line items, contractor names, dollar amounts, quote dates)
<<<
${boardPackage}
>>>

FACTUAL TRANSCRIPT (AUTHORITATIVE for discussion, decisions, motions carried, and who said what — merged speaker blocks with timestamps)
<<<
${transcript}
>>>`;
}

function buildPromptInputWarnings(
  referencePdf: ReturnType<typeof sliceForPrompt>,
  boardPackage: ReturnType<typeof sliceForPrompt>,
  transcript: ReturnType<typeof sliceForPrompt>,
): string[] {
  const warnings: string[] = [];

  if (referencePdf.truncated) {
    warnings.push(
      inputTruncationWarning(
        "Reference minutes PDF",
        referencePdf,
        PROMPT_INPUT_LIMITS.referencePdf,
      ),
    );
  }

  if (boardPackage.truncated) {
    warnings.push(
      inputTruncationWarning(
        "Board package PDF",
        boardPackage,
        PROMPT_INPUT_LIMITS.boardPackage,
      ),
    );
  }

  if (transcript.truncated) {
    warnings.push(
      inputTruncationWarning(
        "Meeting transcript",
        transcript,
        PROMPT_INPUT_LIMITS.transcript,
      ),
    );
  }

  return warnings;
}

function buildTodosPrompt(
  transcript: string,
  meetingDate: string,
  title: string,
): string {
  return `Meeting: ${title}
Meeting date: ${meetingDate}

TRANSCRIPT (AUTHORITATIVE — merged speaker blocks with timestamps)
<<<
${transcript}
>>>`;
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const { modelMinutes, modelTodos } = mainRunModelOverridesFromFormData(formData);

  const titleRaw = formData.get("title");
  const meetingDateRaw = formData.get("meetingDate");
  const transcriptFile = formData.get("transcript");
  let pdfFile = formData.get("referencePdf");
  if (pdfFile && typeof pdfFile === "object" && "size" in pdfFile && (pdfFile as File).size === 0) {
    pdfFile = null;
  }
  const boardPackageFile = formData.get("boardPackage");

  if (
    typeof titleRaw !== "string" ||
    typeof meetingDateRaw !== "string" ||
    !titleRaw.trim()
  ) {
    return NextResponse.json(
      { error: "title and meetingDate are required" },
      { status: 400 },
    );
  }

  if (!assertFile(transcriptFile)) {
    return NextResponse.json(
      { error: "Microsoft Teams transcript (.vtt) is required." },
      { status: 400 },
    );
  }

  if (pdfFile && !assertFile(pdfFile)) {
    return NextResponse.json({ error: "Reference PDF is invalid." }, {
      status: 400,
    });
  }

  if (!assertFile(boardPackageFile)) {
    return NextResponse.json(
      { error: "Board meeting package / management report PDF is required." },
      { status: 400 },
    );
  }

  const referencePdfFile = assertFile(pdfFile) ? pdfFile : null;

  if (!transcriptFile.name.toLowerCase().endsWith(".vtt")) {
    return NextResponse.json({ error: "Transcript must be a .vtt file." }, {
      status: 400,
    });
  }

  if (referencePdfFile && !referencePdfFile.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Reference must be a .pdf file." }, {
      status: 400,
    });
  }

  if (!boardPackageFile.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json(
      { error: "Board package must be a .pdf file." },
      { status: 400 },
    );
  }

  const meetingId = randomUUID();

  const vttBuffer = Buffer.from(await transcriptFile.arrayBuffer());
  const pdfBuffer = referencePdfFile ? Buffer.from(await referencePdfFile.arrayBuffer()) : null;
  const boardPackageBuffer = Buffer.from(await boardPackageFile.arrayBuffer());

  let transcriptReadable: string;
  try {
    transcriptReadable = vttToReadableTranscript(vttBuffer.toString("utf-8"));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to parse VTT content." }, {
      status: 400,
    });
  }

  if (!transcriptReadable.trim()) {
    return NextResponse.json(
      { error: "Transcript was empty after parsing." },
      { status: 400 },
    );
  }

  let referenceStyle = "No reference style provided.";
  if (pdfBuffer) {
    try {
      referenceStyle = await extractPdfText(pdfBuffer);
    } catch (error) {
      console.error(error);
      return NextResponse.json(
        {
          error:
            "Could not extract text from the PDF — ensure text is selectable (not scanned).",
        },
        { status: 400 },
      );
    }

    if (!referenceStyle.trim()) {
      return NextResponse.json(
        {
          error:
            "Reference PDF yielded no selectable text — try exporting again from Acrobat.",
        },
        { status: 400 },
      );
    }
  }

  let boardPackageText: string;
  try {
    boardPackageText = await extractPdfText(boardPackageBuffer);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          "Could not extract text from the board package PDF — ensure text is selectable (not scanned).",
      },
      { status: 400 },
    );
  }

  if (!boardPackageText.trim()) {
    return NextResponse.json(
      {
        error:
          "Board package PDF yielded no selectable text — try exporting again from Acrobat.",
      },
      { status: 400 },
    );
  }

  const uploadRoot = path.join(process.cwd(), "uploads", meetingId);

  const referencePdfInput = sliceForPrompt(
    referenceStyle,
    PROMPT_INPUT_LIMITS.referencePdf,
  );
  const boardPackageInput = sliceForPrompt(
    boardPackageText,
    PROMPT_INPUT_LIMITS.boardPackage,
  );
  const transcriptInput = sliceForPrompt(
    transcriptReadable,
    PROMPT_INPUT_LIMITS.transcript,
  );
  const promptInputWarnings = buildPromptInputWarnings(
    referencePdfInput,
    boardPackageInput,
    transcriptInput,
  );

  try {
    const baseMinutesPrompt = buildMinutesPrompt(
      referencePdfInput.text,
      boardPackageInput.text,
      transcriptInput.text,
      meetingDateRaw,
      titleRaw.trim(),
    );

    let minutesUserText = baseMinutesPrompt;
    let minuteParse: ReturnType<typeof parseMinutesV2Response> | null = null;
    let minutesGeneration: Awaited<ReturnType<typeof generateMinutesV2>> | null =
      null;
    let completenessRetries = 0;
    let validationRetries = 0;
    let restrictedRetries = 0;
    const initialUsageCalls: GeminiUsageCall[] = [];

    for (let attempt = 0; attempt < MAX_MINUTES_ATTEMPTS; attempt += 1) {
      const isLastAttempt = attempt === MAX_MINUTES_ATTEMPTS - 1;

      minutesGeneration = await generateMinutesV2({
        systemInstruction: MINUTES_SYSTEM_PROMPT,
        userText: minutesUserText,
        modelName: modelMinutes,
        // JSON mode (no responseSchema) so motions, sub_items, and actions are preserved.
        responseSchema: null,
      });

      initialUsageCalls.push(
        ...minutesGeneration.usageCalls.map((call) => ({
          ...call,
          step:
            attempt === 0
              ? call.step
              : `minutes_retry_${attempt}_${call.step}`,
        })),
      );

      minuteParse = parseMinutesV2Response(minutesGeneration.text);

      if (!minuteParse.document) {
        console.error("[gemini:validation-failure]", {
          attempt,
          meetingId,
          errors: minuteParse.errors,
          warnings: minuteParse.warnings,
          finishReason: minutesGeneration.finishReason,
          truncated: minutesGeneration.truncated,
          rawTextLength: minutesGeneration.text.length,
          rawTextPreview: minutesGeneration.text.slice(0, 4000),
          rawTextTail: minutesGeneration.text.slice(-1000),
        });

        if (isLastAttempt) {
          const message =
            minuteParse.errors.join(" ") ||
            "Could not parse structured minutes JSON.";
          throw new Error(message);
        }

        validationRetries += 1;
        minutesUserText = buildValidationRetryPrompt(
          baseMinutesPrompt,
          minuteParse.errors,
        );
        continue;
      }

      const tooSparse = isMinutesV2TooSparse(
        minuteParse.document,
        minutesGeneration.text.length,
      );
      const needsRestricted = shouldRetryForRestrictedAddendum(
        minuteParse.document,
        transcriptReadable,
        minuteParse.warnings,
      );

      if (!tooSparse && !needsRestricted) {
        break;
      }

      if (isLastAttempt) {
        if (tooSparse) {
          throw new Error(
            "Gemini returned incomplete minutes after multiple attempts. Try again or switch GEMINI_MODEL_MINUTES to a long-context model.",
          );
        }
        break;
      }

      if (needsRestricted) {
        restrictedRetries += 1;
        minutesUserText = buildRestrictedAddendumRetryPrompt(baseMinutesPrompt);
        continue;
      }

      completenessRetries += 1;
      minutesUserText = buildCompletenessRetryPrompt(baseMinutesPrompt);
    }

    if (!minuteParse?.document || !minutesGeneration) {
      throw new Error("Minutes generation did not produce a document.");
    }

    const minuteStructuralWarnings = [
      ...promptInputWarnings,
      ...minuteParse.warnings,
    ];

    if (minutesGeneration.truncated) {
      minuteStructuralWarnings.push(
        "Gemini hit the output token limit even after retry.",
      );
    }

    if (minutesGeneration.retryCount > 0) {
      minuteStructuralWarnings.push(
        `Recovered partial minutes with ${minutesGeneration.retryCount} retry call(s).`,
      );
    }

    if (completenessRetries > 0) {
      minuteStructuralWarnings.push(
        `Initial extraction was incomplete; retried ${completenessRetries} time(s) for fuller coverage.`,
      );
    }

    if (validationRetries > 0) {
      minuteStructuralWarnings.push(
        `Initial JSON failed schema validation; retried ${validationRetries} time(s).`,
      );
    }

    if (restrictedRetries > 0) {
      minuteStructuralWarnings.push(
        `Restricted addendum was missing or incomplete; retried ${restrictedRetries} time(s).`,
      );
    }

    if (!minutesGeneration.usedResponseSchema) {
      minuteStructuralWarnings.push(
        "Minutes extracted in JSON mode (full schema including motions); validated locally.",
      );
    }

    const envelope = wrapMinutesV2(minuteParse.document);
    const minutesMarkdown = v2ToMarkdown(minuteParse.document);
    const minutesJsonString = JSON.stringify(envelope);

    const todosGeneration = await generateTodos({
      systemInstruction: TODO_SYSTEM_PROMPT,
      userText: buildTodosPrompt(
        transcriptInput.text,
        meetingDateRaw,
        titleRaw.trim(),
      ),
      modelName: modelTodos,
    });

    initialUsageCalls.push(...todosGeneration.usageCalls);

    const todoParse = unwrapMarkdownCodeBlock(todosGeneration.text);

    const todosStructuralWarnings = [
      ...(transcriptInput.truncated
        ? [
            inputTruncationWarning(
              "Meeting transcript",
              transcriptInput,
              PROMPT_INPUT_LIMITS.transcript,
            ),
          ]
        : []),
      ...validateTodosOutput(todoParse.markdown),
    ];

    await mkdir(uploadRoot, { recursive: true });

    const vttAbsolute = path.join(uploadRoot, "transcript.vtt");
    const pdfAbsolute = path.join(uploadRoot, "reference.pdf");
    const boardPackageAbsolute = path.join(uploadRoot, "board-package.pdf");

    await writeFile(vttAbsolute, vttBuffer);
    if (pdfBuffer) {
      await writeFile(pdfAbsolute, pdfBuffer);
    }
    await writeFile(boardPackageAbsolute, boardPackageBuffer);

    const db = getDb();
    const createdAt = new Date().toISOString();
    const initialUsageRun = buildInitialProcessingRun({
      id: randomUUID(),
      ranAt: createdAt,
      calls: initialUsageCalls,
    });

    await db.insert(meetings).values({
      id: meetingId,
      meetingDate: meetingDateRaw,
      title: titleRaw.trim(),
      status: "draft",
      minutesContent: minutesMarkdown,
      minutesJson: minutesJsonString,
      todosContent: todoParse.markdown,
      vttFilePath: path
        .relative(process.cwd(), vttAbsolute)
        .replace(/\\/g, "/"),
      pdfFilePath: pdfBuffer ? path
        .relative(process.cwd(), pdfAbsolute)
        .replace(/\\/g, "/") : "",
      boardPackageFilePath: path
        .relative(process.cwd(), boardPackageAbsolute)
        .replace(/\\/g, "/"),
      createdAt,
      aiUsageJson: serializeAiUsage({ runs: [initialUsageRun] }),
    });

    // Also insert a shadow copy for the new V2 asynchronous pipeline
    await db.insert(meetingsV2).values({
      id: meetingId,
      sourceKey: meetingId,
      title: titleRaw.trim(),
      meetingDate: meetingDateRaw,
      pipelineState: "created",
      currentStep: "Ready to start",
      progressPercent: 0,
      lastError: null,
      createdAt,
      updatedAt: createdAt,
    });

    // Trigger the background V2 extraction pipeline
    await inngest.send({
      name: "meeting-v2/pipeline.start",
      data: { meetingId },
    });

    const allMinuteWarnings = [...minuteStructuralWarnings];
    const allTodoWarnings = [
      ...todoParse.warnings,
      ...todosStructuralWarnings,
    ];

    console.info("[gemini:warnings]", {
      minutesFinishReason: minutesGeneration.finishReason,
      minutesRetryCount: minutesGeneration.retryCount,
      completenessRetries,
      validationRetries,
      unwrapMinuteWarnings: minuteParse.warnings,
      minuteStructuralWarnings,
      todosFinishReason: todosGeneration.finishReason,
      unwrapTodoWarnings: todoParse.warnings,
      todosStructuralWarnings,
    });

    return NextResponse.json({
      id: meetingId,
      warnings: {
        minuteWarnings: allMinuteWarnings,
        todoWarnings: allTodoWarnings,
      },
    });
  } catch (error) {
    await rm(uploadRoot, { recursive: true, force: true });
    console.error(error);

    const message =
      error instanceof Error
        ? error.message
        : "Gemini pipeline failed unexpectedly.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
