import { readFileSync } from "fs";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const key = readFileSync(".env.local", "utf8")
  .match(/GEMINI_API_KEY=(.+)/)?.[1]
  ?.trim();
const client = new GoogleGenerativeAI(key);
const model = "gemini-3.5-flash";

function slimAgendaItem() {
  const motion = {
    type: SchemaType.OBJECT,
    properties: {
      moved_by: { type: SchemaType.STRING },
      seconded_by: { type: SchemaType.STRING },
      resolution_text: { type: SchemaType.STRING },
      status: { type: SchemaType.STRING },
    },
    required: ["moved_by", "seconded_by", "resolution_text", "status"],
  };
  const action = {
    type: SchemaType.OBJECT,
    properties: {
      assignee: { type: SchemaType.STRING },
      task_description: { type: SchemaType.STRING },
    },
    required: ["assignee", "task_description"],
  };
  const subLeaf = {
    type: SchemaType.OBJECT,
    properties: {
      topic: { type: SchemaType.STRING },
      summary: { type: SchemaType.STRING },
      motion,
      action_items: { type: SchemaType.ARRAY, items: action },
      status: { type: SchemaType.STRING },
    },
    required: ["topic", "summary"],
  };
  return {
    type: SchemaType.OBJECT,
    properties: {
      topic: { type: SchemaType.STRING },
      summary: { type: SchemaType.STRING },
      motion,
      action_items: { type: SchemaType.ARRAY, items: action },
      sub_items: { type: SchemaType.ARRAY, items: subLeaf },
      status: { type: SchemaType.STRING },
    },
    required: ["topic", "summary"],
  };
}

function buildFullSlim() {
  const agenda = slimAgendaItem();
  const attendee = {
    type: SchemaType.OBJECT,
    properties: {
      name: { type: SchemaType.STRING },
      title_or_role: { type: SchemaType.STRING },
      company: { type: SchemaType.STRING },
    },
    required: ["name", "title_or_role"],
  };
  const mgmt = {
    type: SchemaType.OBJECT,
    properties: {
      items_for_ratification: { type: SchemaType.ARRAY, items: agenda },
      items_for_approval: { type: SchemaType.ARRAY, items: agenda },
      items_for_information: { type: SchemaType.ARRAY, items: agenda },
      items_for_discussion: { type: SchemaType.ARRAY, items: agenda },
    },
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
          meeting_location: { type: SchemaType.STRING },
          meeting_platform: { type: SchemaType.STRING },
        },
        required: ["corporation_name", "meeting_date", "meeting_time"],
      },
      attendance: {
        type: SchemaType.OBJECT,
        properties: {
          present: { type: SchemaType.ARRAY, items: attendee },
          by_invitation: { type: SchemaType.ARRAY, items: attendee },
          guests: { type: SchemaType.ARRAY, items: attendee },
          regrets: { type: SchemaType.ARRAY, items: attendee },
        },
      },
      call_to_order: {
        type: SchemaType.OBJECT,
        properties: {
          time: { type: SchemaType.STRING },
          chair_name: { type: SchemaType.STRING },
        },
      },
      special_presentations: { type: SchemaType.ARRAY, items: agenda },
      approval_of_previous_minutes: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            previous_meeting_date: { type: SchemaType.STRING },
            amendments_noted: { type: SchemaType.BOOLEAN },
            motion: {
              type: SchemaType.OBJECT,
              properties: {
                moved_by: { type: SchemaType.STRING },
                seconded_by: { type: SchemaType.STRING },
                resolution_text: { type: SchemaType.STRING },
                status: { type: SchemaType.STRING },
              },
              required: ["moved_by", "seconded_by", "resolution_text", "status"],
            },
          },
        },
      },
      financial_matters: { type: SchemaType.ARRAY, items: agenda },
      management_report: mgmt,
      correspondence: { type: SchemaType.ARRAY, items: agenda },
      new_or_other_business: { type: SchemaType.ARRAY, items: agenda },
      date_of_next_meeting: {
        type: SchemaType.OBJECT,
        properties: {
          date: { type: SchemaType.STRING },
          time: { type: SchemaType.STRING },
          location: { type: SchemaType.STRING },
        },
      },
      termination: {
        type: SchemaType.OBJECT,
        properties: { time: { type: SchemaType.STRING } },
      },
      post_termination_sections: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            title: { type: SchemaType.STRING },
            items: { type: SchemaType.ARRAY, items: agenda },
          },
          required: ["title", "items"],
        },
      },
      restricted_records_addendum: {
        type: SchemaType.OBJECT,
        properties: {
          management_report_continued: mgmt,
          other_confidential_matters: { type: SchemaType.ARRAY, items: agenda },
        },
      },
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
  } catch (e) {
    console.log(name, "FAIL", e.message?.slice(0, 120));
  }
}

await test("full-slim-no-enums", buildFullSlim());
