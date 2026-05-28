import { SchemaType, type ResponseSchema } from "@google/generative-ai";

/**
 * Full semantic schema for documentation / future use.
 * NOTE: This schema exceeds Gemini API complexity limits when sent as
 * `responseSchema` (400 INVALID_ARGUMENT). Generation uses JSON mode +
 * `validateMinutesV2()` instead. See `minutesSchemaV2GeminiSlim`.
 */

const motionSchema: ResponseSchema = {
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

const actionItemSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    assignee: { type: SchemaType.STRING },
    task_description: { type: SchemaType.STRING },
  },
  required: ["assignee", "task_description"],
};

const attendeeSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    name: { type: SchemaType.STRING },
    title_or_role: { type: SchemaType.STRING },
    company: { type: SchemaType.STRING },
  },
  required: ["name", "title_or_role"],
};

/** Leaf agenda item (roman sub-items i, ii, iii under a letter item). */
const agendaItemLeafSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    topic: { type: SchemaType.STRING },
    summary: { type: SchemaType.STRING },
    cost_mentioned: { type: SchemaType.NUMBER },
    contractor_mentioned: { type: SchemaType.STRING },
    motion: motionSchema,
    action_items: {
      type: SchemaType.ARRAY,
      items: actionItemSchema,
    },
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
    restricted: { type: SchemaType.BOOLEAN },
  },
  required: ["topic", "summary"],
};

/** Top-level / letter-marked agenda item with optional roman sub-items. */
const agendaItemSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    topic: { type: SchemaType.STRING },
    summary: { type: SchemaType.STRING },
    cost_mentioned: { type: SchemaType.NUMBER },
    contractor_mentioned: { type: SchemaType.STRING },
    motion: motionSchema,
    action_items: {
      type: SchemaType.ARRAY,
      items: actionItemSchema,
    },
    sub_items: {
      type: SchemaType.ARRAY,
      items: agendaItemLeafSchema,
    },
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
    restricted: { type: SchemaType.BOOLEAN },
  },
  required: ["topic", "summary"],
};

const managementReportSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    items_for_ratification: {
      type: SchemaType.ARRAY,
      items: agendaItemSchema,
    },
    items_for_approval: {
      type: SchemaType.ARRAY,
      items: agendaItemSchema,
    },
    items_for_information: {
      type: SchemaType.ARRAY,
      items: agendaItemSchema,
    },
    items_for_discussion: {
      type: SchemaType.ARRAY,
      items: agendaItemSchema,
    },
  },
};

/** Gemini responseSchema for structured minutes extraction (v2 data object only). */
export const minutesSchemaV2Gemini: ResponseSchema = {
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
        present: { type: SchemaType.ARRAY, items: attendeeSchema },
        by_invitation: { type: SchemaType.ARRAY, items: attendeeSchema },
        guests: { type: SchemaType.ARRAY, items: attendeeSchema },
        regrets: { type: SchemaType.ARRAY, items: attendeeSchema },
      },
    },
    call_to_order: {
      type: SchemaType.OBJECT,
      properties: {
        time: { type: SchemaType.STRING },
        chair_name: { type: SchemaType.STRING },
      },
    },
    special_presentations: {
      type: SchemaType.ARRAY,
      items: agendaItemSchema,
    },
    approval_of_previous_minutes: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          previous_meeting_date: { type: SchemaType.STRING },
          amendments_noted: { type: SchemaType.BOOLEAN },
          motion: motionSchema,
        },
      },
    },
    financial_matters: {
      type: SchemaType.ARRAY,
      items: agendaItemSchema,
    },
    management_report: managementReportSchema,
    correspondence: {
      type: SchemaType.ARRAY,
      items: agendaItemSchema,
    },
    new_or_other_business: {
      type: SchemaType.ARRAY,
      items: agendaItemSchema,
    },
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
      properties: {
        time: { type: SchemaType.STRING },
      },
    },
    post_termination_sections: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING },
          items: { type: SchemaType.ARRAY, items: agendaItemSchema },
        },
        required: ["title", "items"],
      },
    },
  },
  required: ["metadata", "attendance", "management_report"],
};

/**
 * Lightweight top-level schema that fits within Gemini responseSchema limits.
 * Agenda items require topic + summary so the model cannot emit empty placeholders.
 * Motions/actions/sub_items are optional fields enforced by prompt + validateMinutesV2().
 */
const slimAgendaItemSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    topic: { type: SchemaType.STRING },
    summary: { type: SchemaType.STRING },
    restricted: { type: SchemaType.BOOLEAN },
  },
  required: ["topic", "summary"],
};

const slimAttendeeSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    name: { type: SchemaType.STRING },
    title_or_role: { type: SchemaType.STRING },
    company: { type: SchemaType.STRING },
  },
  required: ["name", "title_or_role"],
};

export const minutesSchemaV2GeminiSlim: ResponseSchema = {
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
        present: { type: SchemaType.ARRAY, items: slimAttendeeSchema },
        by_invitation: { type: SchemaType.ARRAY, items: slimAttendeeSchema },
        guests: { type: SchemaType.ARRAY, items: slimAttendeeSchema },
        regrets: { type: SchemaType.ARRAY, items: slimAttendeeSchema },
      },
    },
    call_to_order: {
      type: SchemaType.OBJECT,
      properties: {
        time: { type: SchemaType.STRING },
        chair_name: { type: SchemaType.STRING },
      },
    },
    special_presentations: {
      type: SchemaType.ARRAY,
      items: slimAgendaItemSchema,
    },
    approval_of_previous_minutes: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          previous_meeting_date: { type: SchemaType.STRING },
          amendments_noted: { type: SchemaType.BOOLEAN },
        },
      },
    },
    financial_matters: {
      type: SchemaType.ARRAY,
      items: slimAgendaItemSchema,
    },
    management_report: {
      type: SchemaType.OBJECT,
      properties: {
        items_for_ratification: {
          type: SchemaType.ARRAY,
          items: slimAgendaItemSchema,
        },
        items_for_approval: {
          type: SchemaType.ARRAY,
          items: slimAgendaItemSchema,
        },
        items_for_information: {
          type: SchemaType.ARRAY,
          items: slimAgendaItemSchema,
        },
        items_for_discussion: {
          type: SchemaType.ARRAY,
          items: slimAgendaItemSchema,
        },
      },
    },
    correspondence: {
      type: SchemaType.ARRAY,
      items: slimAgendaItemSchema,
    },
    new_or_other_business: {
      type: SchemaType.ARRAY,
      items: slimAgendaItemSchema,
    },
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
      properties: {
        time: { type: SchemaType.STRING },
      },
    },
    post_termination_sections: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING },
          items: { type: SchemaType.ARRAY, items: slimAgendaItemSchema },
        },
        required: ["title", "items"],
      },
    },
  },
  required: ["metadata", "attendance", "management_report"],
};
