import { readFileSync } from "fs";
import { generateMinutesV2 } from "../lib/gemini/client.ts";
import { MINUTES_SYSTEM_PROMPT } from "../lib/gemini/prompts.ts";
import { parseMinutesV2Response } from "../lib/gemini/parse-output.ts";

async function main() {
  const result = await generateMinutesV2({
    systemInstruction: MINUTES_SYSTEM_PROMPT,
    userText: `Meeting: Test
Meeting date: 2026-03-23

REFERENCE PDF TEXT (STYLE ONLY)
<<<
1. CALL TO ORDER
2. APPROVAL OF PREVIOUS MINUTES
>>>

FACTUAL TRANSCRIPT (AUTHORITATIVE)
<<<
Shawna Greenspan called the meeting to order at 6:01 p.m.
The board approved the February 25, 2026 minutes. Motion by Shawna Greenspan, seconded by Paul Gartenburg. Motion carried.
>>>`,
  });

  console.log("usedResponseSchema", result.usedResponseSchema);
  console.log("truncated", result.truncated);
  console.log("text length", result.text.length);

  const parsed = parseMinutesV2Response(result.text);
  console.log("valid", Boolean(parsed.document));
  console.log("errors", parsed.errors);
  console.log("warnings", parsed.warnings.slice(0, 3));
}

main().catch(console.error);
