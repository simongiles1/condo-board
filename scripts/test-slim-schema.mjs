import { readFileSync } from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { minutesSchemaV2GeminiSlim } from "../lib/minutes/schema-v2-gemini.ts";

const key = readFileSync(".env.local", "utf8")
  .match(/GEMINI_API_KEY=(.+)/)?.[1]
  ?.trim();
const client = new GoogleGenerativeAI(key);

try {
  const m = client.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 512,
      responseMimeType: "application/json",
      responseSchema: minutesSchemaV2GeminiSlim,
    },
  });
  await m.generateContent("test");
  console.log("slim OK");
} catch (e) {
  console.log("slim FAIL", e.message?.slice(0, 120));
}
