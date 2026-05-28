import { readFileSync } from "fs";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { minutesSchemaV2Gemini } from "../lib/minutes/schema-v2-gemini.ts";

const key = readFileSync(".env.local", "utf8")
  .match(/GEMINI_API_KEY=(.+)/)?.[1]
  ?.trim();
const client = new GoogleGenerativeAI(key);
const model = "gemini-3.5-flash";
const props = minutesSchemaV2Gemini.properties;

async function test(name, properties, required) {
  try {
    const m = client.getGenerativeModel({
      model,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties,
          required,
        },
      },
    });
    await m.generateContent("test");
    console.log(name, "OK");
    return true;
  } catch {
    console.log(name, "FAIL");
    return false;
  }
}

const order = [
  "metadata",
  "attendance",
  "management_report",
  "call_to_order",
  "special_presentations",
  "approval_of_previous_minutes",
  "financial_matters",
  "correspondence",
  "new_or_other_business",
  "date_of_next_meeting",
  "termination",
  "post_termination_sections",
  "restricted_records_addendum",
];

const built = {};
const req = [];
for (const key of order) {
  built[key] = props[key];
  if (["metadata", "attendance", "management_report"].includes(key)) {
    req.push(key);
  }
  await test(`through-${key}`, { ...built }, [...req]);
}
