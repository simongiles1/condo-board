import { readFileSync } from "fs";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const key = readFileSync(".env.local", "utf8")
  .match(/GEMINI_API_KEY=(.+)/)?.[1]
  ?.trim();
const client = new GoogleGenerativeAI(key);

const minimalTopLevel = {
  type: SchemaType.OBJECT,
  properties: {
    metadata: {
      type: SchemaType.OBJECT,
      properties: {
        corporation_name: { type: SchemaType.STRING },
        meeting_date: { type: SchemaType.STRING },
        meeting_time: { type: SchemaType.STRING },
      },
      required: ["corporation_name", "meeting_date", "meeting_time"],
    },
    attendance: { type: SchemaType.OBJECT, properties: {} },
    management_report: { type: SchemaType.OBJECT, properties: {} },
    financial_matters: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: {} } },
    new_or_other_business: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: {} } },
  },
  required: ["metadata", "attendance", "management_report"],
};

for (const model of ["gemini-3.5-flash", "gemini-2.0-flash"]) {
  try {
    const m = client.getGenerativeModel({
      model,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
        responseSchema: minimalTopLevel,
      },
    });
    await m.generateContent("test");
    console.log(model, "minimal-top-level OK");
  } catch (e) {
    console.log(model, "minimal-top-level FAIL");
  }
}
