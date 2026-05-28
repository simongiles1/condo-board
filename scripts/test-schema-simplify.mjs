import { readFileSync } from "fs";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const key = readFileSync(".env.local", "utf8")
  .match(/GEMINI_API_KEY=(.+)/)?.[1]
  ?.trim();
const client = new GoogleGenerativeAI(key);
const model = "gemini-3.5-flash";

const simpleAgenda = {
  type: SchemaType.OBJECT,
  properties: {
    topic: { type: SchemaType.STRING },
    summary: { type: SchemaType.STRING },
  },
  required: ["topic", "summary"],
};

const mgmt = {
  type: SchemaType.OBJECT,
  properties: {
    items_for_ratification: { type: SchemaType.ARRAY, items: simpleAgenda },
    items_for_approval: { type: SchemaType.ARRAY, items: simpleAgenda },
    items_for_information: { type: SchemaType.ARRAY, items: simpleAgenda },
    items_for_discussion: { type: SchemaType.ARRAY, items: simpleAgenda },
  },
};

async function test(name, schema) {
  try {
    const m = client.getGenerativeModel({
      model,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });
    await m.generateContent("test");
    console.log(name, "OK");
  } catch {
    console.log(name, "FAIL");
  }
}

await test("mgmt+financial-simple", {
  type: SchemaType.OBJECT,
  properties: {
    management_report: mgmt,
    financial_matters: { type: SchemaType.ARRAY, items: simpleAgenda },
  },
  required: ["management_report", "financial_matters"],
});

await test("mgmt+financial-full-ish", {
  type: SchemaType.OBJECT,
  properties: {
    management_report: mgmt,
    financial_matters: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          topic: { type: SchemaType.STRING },
          summary: { type: SchemaType.STRING },
          motion: {
            type: SchemaType.OBJECT,
            properties: {
              moved_by: { type: SchemaType.STRING },
              seconded_by: { type: SchemaType.STRING },
              resolution_text: { type: SchemaType.STRING },
              status: { type: SchemaType.STRING },
            },
          },
          action_items: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                assignee: { type: SchemaType.STRING },
                task_description: { type: SchemaType.STRING },
              },
            },
          },
          sub_items: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                topic: { type: SchemaType.STRING },
                summary: { type: SchemaType.STRING },
              },
            },
          },
        },
        required: ["topic", "summary"],
      },
    },
  },
  required: ["management_report", "financial_matters"],
});
