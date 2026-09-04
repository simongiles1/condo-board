import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const meetingsV2 = pgTable("meetings_v2", {
  id: text("id").primaryKey(),
  sourceKey: text("source_key").notNull().unique(),
  title: text("title").notNull(),
  meetingDate: text("meeting_date").notNull(),
  pipelineState: text("pipeline_state", {
    enum: [
      "created",
      "ingesting",
      "ingested",
      "extracting",
      "extracted",
      "gathering_evidence",
      "evidence_gathered",
      "investigating",
      "investigated",
      "validating",
      "validated",
      "failed",
    ],
  }).notNull().default("created"),
  currentStep: text("current_step"),
  progressPercent: integer("progress_percent").default(0),
  lastError: text("last_error"),
  settings: jsonb("settings").$type<{ autonomyTemperature?: number }>().default({}),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const meetingsV2SourceArtifacts = pgTable(
  "meetings_v2_source_artifacts",
  {
    id: text("id").primaryKey(),
    meetingV2Id: text("meeting_v2_id")
      .notNull()
      .references(() => meetingsV2.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "transcript",
        "board_package",
        "attachment",
        "style_reference_minutes",
        "gold_standard_minutes",
      ],
    }).notNull(),
    referenceClassification: text("reference_classification", {
      enum: [
        "input_only",
        "style_reference",
        "gold_standard",
        "output_reference",
      ],
    }),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type"),
    storagePath: text("storage_path").notNull(),
    checksum: text("checksum").notNull(),
    sizeBytes: integer("size_bytes"),
    pageCount: integer("page_count"),
    createdAt: text("created_at").notNull(),
  }
);

export const meetingsV2TranscriptSegments = pgTable(
  "meetings_v2_transcript_segments",
  {
    id: text("id").primaryKey(),
    meetingV2Id: text("meeting_v2_id")
      .notNull()
      .references(() => meetingsV2.id, { onDelete: "cascade" }),
    sourceArtifactId: text("source_artifact_id")
      .notNull()
      .references(() => meetingsV2SourceArtifacts.id, {
        onDelete: "cascade",
      }),
    sequence: integer("sequence").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    startTimestamp: text("start_timestamp").notNull(),
    endTimestamp: text("end_timestamp").notNull(),
    speakerLabel: text("speaker_label"),
    text: text("text").notNull(),
    rawCueId: text("raw_cue_id"),
  }
);

export const meetingsV2DocumentPages = pgTable(
  "meetings_v2_document_pages",
  {
    id: text("id").primaryKey(),
    meetingV2Id: text("meeting_v2_id")
      .notNull()
      .references(() => meetingsV2.id, { onDelete: "cascade" }),
    sourceArtifactId: text("source_artifact_id")
      .notNull()
      .references(() => meetingsV2SourceArtifacts.id, {
        onDelete: "cascade",
      }),
    pageNumber: integer("page_number").notNull(),
    pageHeading: text("page_heading"),
    extractedText: text("extracted_text").notNull(),
    imagePath: text("image_path"),
    createdAt: text("created_at").notNull(),
  }
);

export const meetingsV2DocumentSections = pgTable(
  "meetings_v2_document_sections",
  {
    id: text("id").primaryKey(),
    meetingV2Id: text("meeting_v2_id")
      .notNull()
      .references(() => meetingsV2.id, { onDelete: "cascade" }),
    sourceArtifactId: text("source_artifact_id")
      .notNull()
      .references(() => meetingsV2SourceArtifacts.id, {
        onDelete: "cascade",
      }),
    title: text("title").notNull(),
    startPage: integer("start_page").notNull(),
    endPage: integer("end_page").notNull(),
    summary: text("summary"),
    sortOrder: integer("sort_order").notNull(),
    createdAt: text("created_at").notNull(),
  }
);

export const meetingsV2DocumentChunks = pgTable(
  "meetings_v2_document_chunks",
  {
    id: text("id").primaryKey(),
    meetingV2Id: text("meeting_v2_id")
      .notNull()
      .references(() => meetingsV2.id, { onDelete: "cascade" }),
    sourceArtifactId: text("source_artifact_id")
      .notNull()
      .references(() => meetingsV2SourceArtifacts.id, {
        onDelete: "cascade",
      }),
    chunkKey: text("chunk_key").notNull(),
    chunkKind: text("chunk_kind", {
      enum: ["document", "transcript"],
    }).notNull(),
    sortOrder: integer("sort_order").notNull(),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    sequenceStart: integer("sequence_start"),
    sequenceEnd: integer("sequence_end"),
    startTimestamp: text("start_timestamp"),
    endTimestamp: text("end_timestamp"),
    text: text("text").notNull(),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
  }
);

export const meetingsV2AgendaChunkSnapshots = pgTable(
  "meetings_v2_agenda_chunk_snapshots",
  {
    id: text("id").primaryKey(),
    meetingV2Id: text("meeting_v2_id")
      .notNull()
      .references(() => meetingsV2.id, { onDelete: "cascade" }),
    chunkId: text("chunk_id")
      .notNull()
      .references(() => meetingsV2DocumentChunks.id, { onDelete: "cascade" }),
    chunkKind: text("chunk_kind", {
      enum: ["document", "transcript"],
    }).notNull(),
    sortOrder: integer("sort_order").notNull(),
    noChange: boolean("no_change").notNull().default(false),
    beforeStateJson: text("before_state_json").notNull(),
    afterStateJson: text("after_state_json").notNull(),
    requestJson: text("request_json"),
    responseText: text("response_text"),
    parsedJson: text("parsed_json"),
    usageJson: text("usage_json"),
    estimatedCostUsd: text("estimated_cost_usd"),
    createdAt: text("created_at").notNull(),
  }
);

export const meetingsV2AgendaItems = pgTable(
  "meetings_v2_agenda_items",
  {
    id: text("id").primaryKey(),
    meetingV2Id: text("meeting_v2_id")
      .notNull()
      .references(() => meetingsV2.id, { onDelete: "cascade" }),
    sourceArtifactId: text("source_artifact_id").references(
      () => meetingsV2SourceArtifacts.id,
      {
        onDelete: "set null",
      }
    ),
    sourceSectionId: text("source_section_id").references(
      () => meetingsV2DocumentSections.id,
      {
        onDelete: "set null",
      }
    ),
    sectionLabel: text("section_label"),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    itemNumber: text("item_number"),
    itemType: text("item_type").notNull(),
    sourcePagesJson: text("source_pages_json").notNull(),
    sourceText: text("source_text"),
    sortOrder: integer("sort_order").notNull(),
    createdAt: text("created_at").notNull(),
  }
);

export const meetingsV2AgendaItemEvidence = pgTable(
  "meetings_v2_agenda_item_evidence",
  {
    id: text("id").primaryKey(),
    meetingV2Id: text("meeting_v2_id")
      .notNull()
      .references(() => meetingsV2.id, { onDelete: "cascade" }),
    agendaItemId: text("agenda_item_id")
      .notNull()
      .references(() => meetingsV2AgendaItems.id, { onDelete: "cascade" }),
    sourceType: text("source_type", {
      enum: ["transcript_segment", "document_page", "document_section"],
    }).notNull(),
    sourceId: text("source_id").notNull(),
    rationale: text("rationale"),
    relevanceScore: integer("relevance_score").notNull(),
    snippet: text("snippet"),
    createdAt: text("created_at").notNull(),
  }
);

export const meetingsV2AgendaItemContexts = pgTable(
  "meetings_v2_agenda_item_contexts",
  {
    id: text("id").primaryKey(),
    meetingV2Id: text("meeting_v2_id")
      .notNull()
      .references(() => meetingsV2.id, { onDelete: "cascade" }),
    agendaItemId: text("agenda_item_id")
      .notNull()
      .references(() => meetingsV2AgendaItems.id, { onDelete: "cascade" }),
    contextJson: text("context_json").notNull(),
    assembledContextText: text("assembled_context_text").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  }
);

export const meetingsV2AgendaItemInvestigations = pgTable(
  "meetings_v2_agenda_item_investigations",
  {
    id: text("id").primaryKey(),
    meetingV2Id: text("meeting_v2_id")
      .notNull()
      .references(() => meetingsV2.id, { onDelete: "cascade" }),
    agendaItemId: text("agenda_item_id")
      .notNull()
      .references(() => meetingsV2AgendaItems.id, { onDelete: "cascade" }),
    discussionSummary: text("discussion_summary").notNull(),
    outcome: text("outcome").notNull(),
    confidence: text("confidence").notNull(),
    visibility: text("visibility").notNull(),
    decisionsJson: text("decisions_json").notNull(),
    motionJson: text("motion_json"),
    actionsJson: text("actions_json").notNull(),
    openQuestionsJson: text("open_questions_json").notNull(),
    userAnswersJson: text("user_answers_json"),
    modelName: text("model_name"),
    usageJson: text("usage_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  }
);

export const meetingsV2ValidationResults = pgTable(
  "meetings_v2_validation_results",
  {
    id: text("id").primaryKey(),
    meetingV2Id: text("meeting_v2_id")
      .notNull()
      .references(() => meetingsV2.id, { onDelete: "cascade" }),
    agendaItemId: text("agenda_item_id")
      .notNull()
      .references(() => meetingsV2AgendaItems.id, { onDelete: "cascade" }),
    validationType: text("validation_type").notNull(),
    severity: text("severity", {
      enum: ["error", "warning", "info"],
    }).notNull(),
    code: text("code").notNull(),
    message: text("message").notNull(),
    detailsJson: text("details_json"),
    createdAt: text("created_at").notNull(),
  }
);

export const meetingsV2MinutesDrafts = pgTable(
  "meetings_v2_minutes_drafts",
  {
    id: text("id").primaryKey(),
    meetingV2Id: text("meeting_v2_id")
      .notNull()
      .references(() => meetingsV2.id, { onDelete: "cascade" }),
    format: text("format").notNull(),
    title: text("title").notNull(),
    contentMarkdown: text("content_markdown").notNull(),
    summaryJson: text("summary_json"),
    modelName: text("model_name"),
    usageJson: text("usage_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  }
);

export const meetingsV2Relations = relations(meetingsV2, ({ many }) => ({
  sourceArtifacts: many(meetingsV2SourceArtifacts),
  transcriptSegments: many(meetingsV2TranscriptSegments),
  documentPages: many(meetingsV2DocumentPages),
  documentSections: many(meetingsV2DocumentSections),
  documentChunks: many(meetingsV2DocumentChunks),
  agendaChunkSnapshots: many(meetingsV2AgendaChunkSnapshots),
  agendaItems: many(meetingsV2AgendaItems),
  agendaItemEvidence: many(meetingsV2AgendaItemEvidence),
  agendaItemContexts: many(meetingsV2AgendaItemContexts),
  agendaItemInvestigations: many(meetingsV2AgendaItemInvestigations),
  validationResults: many(meetingsV2ValidationResults),
  minutesDrafts: many(meetingsV2MinutesDrafts),
}));

export const meetingsV2SourceArtifactsRelations = relations(
  meetingsV2SourceArtifacts,
  ({ one, many }) => ({
    meetingV2: one(meetingsV2, {
      fields: [meetingsV2SourceArtifacts.meetingV2Id],
      references: [meetingsV2.id],
    }),
    transcriptSegments: many(meetingsV2TranscriptSegments),
    documentPages: many(meetingsV2DocumentPages),
    documentSections: many(meetingsV2DocumentSections),
    agendaItems: many(meetingsV2AgendaItems),
  })
);

export const meetingsV2AgendaItemsRelations = relations(
  meetingsV2AgendaItems,
  ({ one, many }) => ({
    meetingV2: one(meetingsV2, {
      fields: [meetingsV2AgendaItems.meetingV2Id],
      references: [meetingsV2.id],
    }),
    sourceArtifact: one(meetingsV2SourceArtifacts, {
      fields: [meetingsV2AgendaItems.sourceArtifactId],
      references: [meetingsV2SourceArtifacts.id],
    }),
    sourceSection: one(meetingsV2DocumentSections, {
      fields: [meetingsV2AgendaItems.sourceSectionId],
      references: [meetingsV2DocumentSections.id],
    }),
    evidence: many(meetingsV2AgendaItemEvidence),
    contexts: many(meetingsV2AgendaItemContexts),
    investigations: many(meetingsV2AgendaItemInvestigations),
    validationResults: many(meetingsV2ValidationResults),
  })
);
