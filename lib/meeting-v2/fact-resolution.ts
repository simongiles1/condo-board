import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { FACT_RESOLUTION_PROMPT, parseFactResolution, type EvidenceSource } from "./evidence-contract";

export async function resolveAgendaFacts(input: {
  agenda: { title: string; itemNumber: string | null; itemType: string };
  sources: EvidenceSource[];
}, complete = generateDeepSeekJson) {
  const attempts: Array<{ request: unknown; response: string; error?: string; usage: unknown; model: string }> = [];
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const request = { ...input, ...(feedback ? { correctionRequired: feedback } : {}) };
    const completion = await complete({ systemInstruction: FACT_RESOLUTION_PROMPT,
      userText: JSON.stringify(request), modelName: "deepseek-v4-flash", temperature: 0,
      thinking: false, maxOutputTokens: 8192, requestTimeoutMs: 90_000 });
    const trace = { request, response: completion.text, usage: completion.usage, model: completion.modelName };
    try {
      const facts = parseFactResolution(JSON.parse(completion.text), input.sources);
      if (!facts.facts.length && input.sources.some(s => s.kind === "transcript" && s.association === "direct")) {
        throw new Error("Direct discussion was supplied but no facts were addressed.");
      }
      attempts.push(trace);
      return { facts, attempts };
    } catch (error) {
      feedback = error instanceof Error ? error.message : String(error);
      attempts.push({ ...trace, error: feedback });
    }
  }
  throw new Error(`Fact resolution failed: ${feedback}`);
}
