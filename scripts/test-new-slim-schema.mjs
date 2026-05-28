import { readFileSync } from "fs";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const key = readFileSync(".env.local", "utf8")
  .match(/GEMINI_API_KEY=(.+)/)?.[1]
  ?.trim();
const client = new GoogleGenerativeAI(key);

const motion = { type: SchemaType.OBJECT, properties: { moved_by: { type: SchemaType.STRING }, seconded_by: { type: SchemaType.STRING }, resolution_text: { type: SchemaType.STRING }, status: { type: SchemaType.STRING } } };
const action = { type: SchemaType.OBJECT, properties: { assignee: { type: SchemaType.STRING }, task_description: { type: SchemaType.STRING } }, required: ["assignee", "task_description"] };
const subLeaf = { type: SchemaType.OBJECT, properties: { topic: { type: SchemaType.STRING }, summary: { type: SchemaType.STRING }, motion, action_items: { type: SchemaType.ARRAY, items: action }, status: { type: SchemaType.STRING } }, required: ["topic", "summary"] };
const agenda = { type: SchemaType.OBJECT, properties: { topic: { type: SchemaType.STRING }, summary: { type: SchemaType.STRING }, motion, action_items: { type: SchemaType.ARRAY, items: action }, sub_items: { type: SchemaType.ARRAY, items: subLeaf }, status: { type: SchemaType.STRING } }, required: ["topic", "summary"] };

const schema = {
  type: SchemaType.OBJECT,
  properties: {
    metadata: { type: SchemaType.OBJECT, properties: { corporation_name: { type: SchemaType.STRING }, meeting_date: { type: SchemaType.STRING }, meeting_time: { type: SchemaType.STRING } }, required: ["corporation_name", "meeting_date", "meeting_time"] },
    attendance: { type: SchemaType.OBJECT, properties: {} },
    financial_matters: { type: SchemaType.ARRAY, items: agenda },
    management_report: { type: SchemaType.OBJECT, properties: {
      items_for_ratification: { type: SchemaType.ARRAY, items: agenda },
      items_for_approval: { type: SchemaType.ARRAY, items: agenda },
      items_for_information: { type: SchemaType.ARRAY, items: agenda },
      items_for_discussion: { type: SchemaType.ARRAY, items: agenda },
    } },
    new_or_other_business: { type: SchemaType.ARRAY, items: agenda },
    call_to_order: { type: SchemaType.OBJECT, properties: { time: { type: SchemaType.STRING }, chair_name: { type: SchemaType.STRING } } },
    termination: { type: SchemaType.OBJECT, properties: { time: { type: SchemaType.STRING } } },
  },
  required: ["metadata", "attendance", "management_report"],
};

try {
  const m = client.getGenerativeModel({ model: "gemini-3.5-flash", generationConfig: { temperature: 0.2, maxOutputTokens: 512, responseMimeType: "application/json", responseSchema: schema } });
  await m.generateContent("test");
  console.log("OK with sub_items");
} catch (e) {
  console.log("FAIL", e.message?.slice(0, 120));
}
