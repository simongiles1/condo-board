import { readFileSync } from "fs";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { minutesSchemaV2Gemini } from "../lib/minutes/schema-v2-gemini.ts";

const key = readFileSync(".env.local", "utf8")
  .match(/GEMINI_API_KEY=(.+)/)?.[1]
  ?.trim();
const client = new GoogleGenerativeAI(key);
const model = "gemini-3.5-flash";

async function test(name, generationConfig) {
  try {
    const m = client.getGenerativeModel({ model, generationConfig });
    const r = await m.generateContent('Say hello in JSON');
    console.log(name, "OK", r.response.text().slice(0, 100));
    return true;
  } catch (e) {
    console.log(name, "FAIL", e.message?.slice(0, 300));
    return false;
  }
}

const simpleSchema = {
  type: SchemaType.OBJECT,
  properties: { hello: { type: SchemaType.STRING } },
  required: ["hello"],
};

console.log("Testing", model);
await test("plain", { temperature: 0.2, maxOutputTokens: 1024 });
await test("json-no-schema", {
  temperature: 0.2,
  maxOutputTokens: 1024,
  responseMimeType: "application/json",
});
await test("json-simple-schema", {
  temperature: 0.2,
  maxOutputTokens: 1024,
  responseMimeType: "application/json",
  responseSchema: simpleSchema,
});
await test("json-thinking0", {
  temperature: 0.2,
  maxOutputTokens: 1024,
  responseMimeType: "application/json",
  thinkingConfig: { thinkingBudget: 0 },
  responseSchema: simpleSchema,
});
await test("full-minutes-schema", {
  temperature: 0.2,
  maxOutputTokens: 8192,
  responseMimeType: "application/json",
  responseSchema: minutesSchemaV2Gemini,
});
await test("full-minutes-schema-thinking0", {
  temperature: 0.2,
  maxOutputTokens: 8192,
  responseMimeType: "application/json",
  thinkingConfig: { thinkingBudget: 0 },
  responseSchema: minutesSchemaV2Gemini,
});
