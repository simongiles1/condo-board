import { readFileSync } from "fs";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const key = readFileSync(".env.local", "utf8")
  .match(/GEMINI_API_KEY=(.+)/)?.[1]
  ?.trim();
const client = new GoogleGenerativeAI(key);
const model = "gemini-3.5-flash";

const motionSchema = {
  type: SchemaType.OBJECT,
  properties: {
    moved_by: { type: SchemaType.STRING },
    seconded_by: { type: SchemaType.STRING },
    resolution_text: { type: SchemaType.STRING },
    status: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["Motion carried.", "Motion defeated.", "Deferred."],
    },
  },
  required: ["moved_by", "seconded_by", "resolution_text", "status"],
};

const actionItemSchema = {
  type: SchemaType.OBJECT,
  properties: {
    assignee: { type: SchemaType.STRING },
    task_description: { type: SchemaType.STRING },
  },
  required: ["assignee", "task_description"],
};

const attendeeSchema = {
  type: SchemaType.OBJECT,
  properties: {
    name: { type: SchemaType.STRING },
    title_or_role: { type: SchemaType.STRING },
    company: { type: SchemaType.STRING },
  },
  required: ["name", "title_or_role"],
};

const agendaItemLeafSchema = {
  type: SchemaType.OBJECT,
  properties: {
    topic: { type: SchemaType.STRING },
    summary: { type: SchemaType.STRING },
    cost_mentioned: { type: SchemaType.NUMBER },
    contractor_mentioned: { type: SchemaType.STRING },
    motion: motionSchema,
    action_items: { type: SchemaType.ARRAY, items: actionItemSchema },
    status: {
      type: SchemaType.STRING,
      format: "enum",
      enum: [
        "Motion carried.",
        "Motion defeated.",
        "Deferred.",
        "Pending.",
        "Information only.",
        "No action required.",
      ],
    },
  },
  required: ["topic", "summary"],
};

const agendaItemSchema = {
  type: SchemaType.OBJECT,
  properties: {
    topic: { type: SchemaType.STRING },
    summary: { type: SchemaType.STRING },
    cost_mentioned: { type: SchemaType.NUMBER },
    contractor_mentioned: { type: SchemaType.STRING },
    motion: motionSchema,
    action_items: { type: SchemaType.ARRAY, items: actionItemSchema },
    sub_items: { type: SchemaType.ARRAY, items: agendaItemLeafSchema },
    status: {
      type: SchemaType.STRING,
      format: "enum",
      enum: [
        "Motion carried.",
        "Motion defeated.",
        "Deferred.",
        "Pending.",
        "Information only.",
        "No action required.",
      ],
    },
  },
  required: ["topic", "summary"],
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
    return true;
  } catch (e) {
    console.log(name, "FAIL");
    return false;
  }
}

await test("agendaItemLeaf", agendaItemLeafSchema);
await test("agendaItem", agendaItemSchema);
await test("motion", motionSchema);
await test("agenda-array", {
  type: SchemaType.OBJECT,
  properties: { items: { type: SchemaType.ARRAY, items: agendaItemSchema } },
});
await test("mgmt-report", {
  type: SchemaType.OBJECT,
  properties: {
    items_for_ratification: { type: SchemaType.ARRAY, items: agendaItemSchema },
    items_for_approval: { type: SchemaType.ARRAY, items: agendaItemSchema },
    items_for_information: { type: SchemaType.ARRAY, items: agendaItemSchema },
    items_for_discussion: { type: SchemaType.ARRAY, items: agendaItemSchema },
  },
});
