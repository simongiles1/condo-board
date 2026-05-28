import { readFileSync } from "fs";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const key = readFileSync(".env.local", "utf8")
  .match(/GEMINI_API_KEY=(.+)/)?.[1]
  ?.trim();
const client = new GoogleGenerativeAI(key);
const model = "gemini-3.5-flash";

function buildSchema(useEnum, useSubItems) {
  const motionSchema = {
    type: SchemaType.OBJECT,
    properties: {
      moved_by: { type: SchemaType.STRING },
      seconded_by: { type: SchemaType.STRING },
      resolution_text: { type: SchemaType.STRING },
      status: useEnum
        ? {
            type: SchemaType.STRING,
            format: "enum",
            enum: ["Motion carried.", "Motion defeated.", "Deferred."],
          }
        : { type: SchemaType.STRING },
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

  const leaf = {
    type: SchemaType.OBJECT,
    properties: {
      topic: { type: SchemaType.STRING },
      summary: { type: SchemaType.STRING },
      motion: motionSchema,
      action_items: { type: SchemaType.ARRAY, items: actionItemSchema },
      status: { type: SchemaType.STRING },
    },
    required: ["topic", "summary"],
  };

  const agendaItemSchema = {
    type: SchemaType.OBJECT,
    properties: {
      topic: { type: SchemaType.STRING },
      summary: { type: SchemaType.STRING },
      motion: motionSchema,
      action_items: { type: SchemaType.ARRAY, items: actionItemSchema },
      ...(useSubItems
        ? { sub_items: { type: SchemaType.ARRAY, items: leaf } }
        : {}),
      status: { type: SchemaType.STRING },
    },
    required: ["topic", "summary"],
  };

  return {
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
      attendance: {
        type: SchemaType.OBJECT,
        properties: {
          present: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                name: { type: SchemaType.STRING },
                title_or_role: { type: SchemaType.STRING },
              },
              required: ["name", "title_or_role"],
            },
          },
          by_invitation: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { name: { type: SchemaType.STRING }, title_or_role: { type: SchemaType.STRING } }, required: ["name", "title_or_role"] } },
          guests: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { name: { type: SchemaType.STRING }, title_or_role: { type: SchemaType.STRING } }, required: ["name", "title_or_role"] } },
          regrets: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { name: { type: SchemaType.STRING }, title_or_role: { type: SchemaType.STRING } }, required: ["name", "title_or_role"] } },
        },
      },
      management_report: {
        type: SchemaType.OBJECT,
        properties: {
          items_for_ratification: { type: SchemaType.ARRAY, items: agendaItemSchema },
          items_for_approval: { type: SchemaType.ARRAY, items: agendaItemSchema },
          items_for_information: { type: SchemaType.ARRAY, items: agendaItemSchema },
          items_for_discussion: { type: SchemaType.ARRAY, items: agendaItemSchema },
        },
      },
      financial_matters: { type: SchemaType.ARRAY, items: agendaItemSchema },
      correspondence: { type: SchemaType.ARRAY, items: agendaItemSchema },
      new_or_other_business: { type: SchemaType.ARRAY, items: agendaItemSchema },
    },
    required: ["metadata", "attendance", "management_report"],
  };
}

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

await test("no-enum-no-sub", buildSchema(false, false));
await test("enum-no-sub", buildSchema(true, false));
await test("no-enum-sub", buildSchema(false, true));
await test("enum-sub", buildSchema(true, true));
