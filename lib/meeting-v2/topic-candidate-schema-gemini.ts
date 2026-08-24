import { SchemaType, type ResponseSchema } from "@google/generative-ai";

const sourceEvidenceSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    sourceType: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["DOCUMENT_PAGE"],
    },
    pageNumber: { type: SchemaType.NUMBER },
    evidenceRole: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["PRIMARY_TOPIC_DEFINITION", "SUPPORTING_ATTACHMENT"],
    },
  },
  required: ["sourceType", "pageNumber", "evidenceRole"],
};

const mergeHintSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    targetDescription: { type: SchemaType.STRING },
    relationship: {
      type: SchemaType.STRING,
      format: "enum",
      enum: [
        "SAME_TOPIC_SUPPORTING_ATTACHMENT",
        "POSSIBLE_DUPLICATE",
        "RELATED_TOPIC",
      ],
    },
    confidence: { type: SchemaType.NUMBER },
  },
  required: ["targetDescription", "relationship", "confidence"],
};

const candidateConfidenceSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    topicExistence: { type: SchemaType.NUMBER },
    parentSection: { type: SchemaType.NUMBER },
    category: { type: SchemaType.NUMBER },
    visibility: { type: SchemaType.NUMBER },
  },
  required: ["topicExistence", "parentSection", "category", "visibility"],
};

const topicCandidateSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    candidateId: { type: SchemaType.STRING },
    canonicalTitle: { type: SchemaType.STRING },
    sourceTitle: { type: SchemaType.STRING },
    parentSection: {
      type: SchemaType.STRING,
      format: "enum",
      enum: [
        "SPECIAL_PRESENTATIONS",
        "APPROVAL_OF_PREVIOUS_MINUTES",
        "FINANCIAL_MATTERS",
        "MANAGEMENT_REPORT_RATIFICATION",
        "MANAGEMENT_REPORT_APPROVAL",
        "MANAGEMENT_REPORT_INFORMATION",
        "MANAGEMENT_REPORT_DISCUSSION",
        "WORK_COMPLETED",
        "CORRESPONDENCE",
        "NEW_OR_OTHER_BUSINESS",
        "POST_TERMINATION",
        "UNKNOWN",
      ],
    },
    category: {
      type: SchemaType.STRING,
      format: "enum",
      enum: [
        "RATIFICATION",
        "APPROVAL",
        "DISCUSSION",
        "INFORMATION",
        "ACTION_REVIEW",
        "PRESENTATION",
        "CORRESPONDENCE",
        "OTHER_BUSINESS",
        "LIFECYCLE",
        "UNKNOWN",
      ],
    },
    visibility: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["PUBLIC", "RESTRICTED", "UNKNOWN"],
    },
    expectedDecision: {
      type: SchemaType.STRING,
      format: "enum",
      enum: [
        "BOARD_APPROVAL_REQUIRED",
        "BOARD_RATIFICATION_REQUIRED",
        "INFORMATION_ONLY",
        "ACTION_REVIEW",
        "UNKNOWN",
      ],
    },
    sourceEvidence: {
      type: SchemaType.ARRAY,
      items: sourceEvidenceSchema,
    },
    mergeHints: {
      type: SchemaType.ARRAY,
      items: mergeHintSchema,
    },
    confidence: candidateConfidenceSchema,
    warnings: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
  },
  required: [
    "candidateId",
    "canonicalTitle",
    "sourceTitle",
    "parentSection",
    "category",
    "visibility",
    "expectedDecision",
    "sourceEvidence",
    "mergeHints",
    "confidence",
    "warnings",
  ],
};

export const topicCandidateSchemaGeminiSlim: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    schemaVersion: { type: SchemaType.STRING },
    candidates: {
      type: SchemaType.ARRAY,
      items: topicCandidateSchema,
    },
  },
  required: ["schemaVersion", "candidates"],
};
