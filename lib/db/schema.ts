import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const meetings = pgTable("meetings", {
  id: text("id").primaryKey(),
  meetingDate: text("meeting_date").notNull(),
  title: text("title").notNull(),
  status: text("status", { enum: ["draft", "finalized"] }).notNull(),
  minutesContent: text("minutes_content").notNull(),
  /** Structured minutes for PDF export; nullable for legacy rows. */
  minutesJson: text("minutes_json"),
  /** Cached transcript-vs-minutes omissions analysis JSON. */
  omissionsAnalysisJson: text("omissions_analysis_json"),
  /** Token usage and estimated cost per AI run (initial processing + omissions). */
  aiUsageJson: text("ai_usage_json"),
  todosContent: text("todos_content").notNull(),
  /** When meeting todos were last merged into the global checklist. */
  globalTodosMergedAt: text("global_todos_merged_at"),
  vttFilePath: text("vtt_file_path").notNull(),
  pdfFilePath: text("pdf_file_path").notNull(),
  /** Board package / management report PDF used as factual source at generation. */
  boardPackageFilePath: text("board_package_file_path"),
  /** Uploaded gold-standard minutes PDF for validation comparison. */
  goldStandardFilePath: text("gold_standard_file_path"),
  /** Cached AI-generated vs gold-standard validation JSON. */
  goldStandardValidationJson: text("gold_standard_validation_json"),
  createdAt: text("created_at").notNull(),
  finalizedAt: text("finalized_at"),
});

export const meetingsRelations = relations(meetings, ({ many }) => ({
  actionItems: many(actionItems),
}));

export const actionItems = pgTable("action_items", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id")
    .notNull()
    .references(() => meetings.id, { onDelete: "cascade" }),
  assignee: text("assignee").notNull(),
  role: text("role").notNull(),
  description: text("description").notNull(),
  deadline: text("deadline"),
  completed: boolean("completed").notNull().default(false),
  completedAt: text("completed_at"),
});

export const actionItemsRelations = relations(actionItems, ({ one }) => ({
  meeting: one(meetings, {
    fields: [actionItems.meetingId],
    references: [meetings.id],
  }),
}));

/** Board-wide consolidated to-do list (meetings, email harvest, manual). */
export const globalTodos = pgTable(
  "global_todos",
  {
    id: text("id").primaryKey(),
    assignee: text("assignee").notNull(),
    role: text("role").notNull(),
    description: text("description").notNull(),
    deadline: text("deadline"),
    completed: boolean("completed").notNull().default(false),
    completedAt: text("completed_at"),
    sourceMeetingId: text("source_meeting_id").references(() => meetings.id),
    sourceKind: text("source_kind", {
      enum: ["meeting", "email", "manual"],
    })
      .notNull()
      .default("meeting"),
    sourceExtractedActionItemId: text(
      "source_extracted_action_item_id",
    ).references((): AnyPgColumn => extractedActionItems.id, {
      onDelete: "cascade",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    sourceExtractedActionItemUnique: uniqueIndex(
      "global_todos_source_extracted_action_item_unique",
    ).on(table.sourceExtractedActionItemId),
  }),
);

export const globalTodosRelations = relations(globalTodos, ({ one }) => ({
  sourceMeeting: one(meetings, {
    fields: [globalTodos.sourceMeetingId],
    references: [meetings.id],
  }),
  sourceExtractedActionItem: one(extractedActionItems, {
    fields: [globalTodos.sourceExtractedActionItemId],
    references: [extractedActionItems.id],
  }),
}));

export const senderAllowlist = pgTable("sender_allowlist", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  notes: text("notes"),
  addedAt: text("added_at").notNull(),
});

export const emailSyncSettings = pgTable("email_sync_settings", {
  id: text("id").primaryKey(),
  syncCron: text("sync_cron").notNull().default("0 7 * * *"),
  schedulerEnabled: boolean("scheduler_enabled").notNull().default(true),
  /**
   * After ingest (cron or Sync now), harvest contacts/orgs/events/to-dos on
   * emails that do not already have that concept. Default off until the
   * historical to-do bulk is done.
   */
  harvestAfterSyncEnabled: boolean("harvest_after_sync_enabled")
    .notNull()
    .default(false),
  /** Deprecated: manual backfill cutoff; computed from dedicated sync instead. */
  backfillCutoffDate: text("backfill_cutoff_date"),
  updatedAt: text("updated_at").notNull(),
});

export const gmailConnections = pgTable("gmail_connections", {
  id: text("id").primaryKey(),
  accountType: text("account_type", {
    enum: ["personal_backfill", "dedicated"],
  }).notNull().unique(),
  emailAddress: text("email_address").notNull(),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  tokenExpiry: text("token_expiry"),
  lastHistoryId: text("last_history_id"),
  lastSyncAt: text("last_sync_at"),
  connectedAt: text("connected_at").notNull(),
});

export const syncRuns = pgTable("sync_runs", {
  id: text("id").primaryKey(),
  accountType: text("account_type", {
    enum: ["personal_backfill", "dedicated"],
  }).notNull(),
  trigger: text("trigger", {
    enum: ["cron", "manual", "backfill", "clear_all"],
  }).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  messagesAdded: integer("messages_added").notNull().default(0),
  messagesSkipped: integer("messages_skipped").notNull().default(0),
  errors: text("errors"),
});

export const emailForwardRuns = pgTable("email_forward_runs", {
  id: text("id").primaryKey(),
  status: text("status", {
    enum: ["queued", "running", "paused", "completed", "failed", "cancelled"],
  }).notNull(),
  targetEmail: text("target_email").notNull(),
  sourceQuery: text("source_query").notNull(),
  totalQueued: integer("total_queued").notNull().default(0),
  /** Unique Gmail threads among all matched messages (including skipped). */
  threadsMatched: integer("threads_matched"),
  forwardedCount: integer("forwarded_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  chunkSize: integer("chunk_size").notNull().default(50),
  chunkDelayMs: integer("chunk_delay_ms").notNull().default(120_000),
  nextChunkAt: text("next_chunk_at"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  lastError: text("last_error"),
});

export const emailForwardQueue = pgTable("email_forward_queue", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => emailForwardRuns.id, { onDelete: "cascade" }),
  gmailMessageId: text("gmail_message_id").notNull(),
  status: text("status", {
    enum: ["pending", "forwarded", "skipped", "failed"],
  })
    .notNull()
    .default("pending"),
  processedAt: text("processed_at"),
  error: text("error"),
});

/** Personal Gmail messages already forwarded to the dedicated mailbox. */
export const personalForwardedMessages = pgTable("personal_forwarded_messages", {
  gmailMessageId: text("gmail_message_id").primaryKey(),
  gmailThreadId: text("gmail_thread_id"),
  forwardRunId: text("forward_run_id").references(() => emailForwardRuns.id),
  forwardMessageIdHeader: text("forward_message_id_header"),
  forwardedAt: text("forwarded_at").notNull(),
});

export const emailThreads = pgTable("email_threads", {
  id: text("id").primaryKey(),
  gmailThreadId: text("gmail_thread_id").notNull().unique(),
  subject: text("subject").notNull(),
  lastMessageAt: text("last_message_at").notNull(),
});

export const emails = pgTable("emails", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").references(() => emailThreads.id),
  gmailMessageId: text("gmail_message_id").notNull().unique(),
  messageIdHeader: text("message_id_header"),
  inReplyTo: text("in_reply_to"),
  referencesHeader: text("references_header"),
  fromAddress: text("from_address").notNull(),
  toAddresses: text("to_addresses").notNull(),
  ccAddresses: text("cc_addresses").notNull().default("[]"),
  subject: text("subject").notNull(),
  bodyText: text("body_text").notNull(),
  bodyHtml: text("body_html"),
  // Authored block for LLM extraction (quotes/duplicate forwards removed; signatures kept).
  bodyTextUnique: text("body_text_unique"),
  // Stricter quote-stripped body for evidence panels / UI (prior messages removed).
  bodyTextStrictUnique: text("body_text_strict_unique"),
  receivedAt: text("received_at").notNull(),
  source: text("source", { enum: ["personal_backfill", "dedicated"] }).notNull(),
  syncRunId: text("sync_run_id").references(() => syncRuns.id),
  processedAt: text("processed_at"),
});

export const emailAttachments = pgTable("email_attachments", {
  id: text("id").primaryKey(),
  emailId: text("email_id")
    .notNull()
    .references(() => emails.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes"),
  gmailAttachmentId: text("gmail_attachment_id"),
  contentHash: text("content_hash"),
  cachedFilePath: text("cached_file_path"),
  processedAt: text("processed_at"),
  /** null = not yet classified; false = logo/tracking pixel/decorative */
  hasValue: boolean("has_value"),
  /** Populated when a pageable attachment (e.g. PDF) is downloaded and analyzed. */
  pageCount: integer("page_count"),
});

/**
 * Content-addressed Markdown conversion of attachment bytes (P0 substrate).
 * One row per unique file hash — shared across duplicate email_attachments rows.
 */
export const attachmentDocuments = pgTable("attachment_documents", {
  contentHash: text("content_hash").primaryKey(),
  mimeType: text("mime_type").notNull(),
  ext: text("ext").notNull(),
  markdownPath: text("markdown_path"),
  parseStatus: text("parse_status", {
    enum: [
      "pending",
      "parsing",
      "parsed",
      "unsupported",
      "failed",
      "needs_ocr",
    ],
  }).notNull(),
  parseError: text("parse_error"),
  parserName: text("parser_name"),
  markdownChars: integer("markdown_chars"),
  /** Cloudflare toMarkdown token count when available. */
  tokens: integer("tokens"),
  pageCount: integer("page_count"),
  /** markdown_chars / page_count when both known — quality gate for scanned PDFs. */
  charsPerPage: integer("chars_per_page"),
  sizeClass: text("size_class", { enum: ["short", "long"] }),
  attempts: integer("attempts").notNull().default(0),
  firstSeenAt: text("first_seen_at").notNull(),
  parsedAt: text("parsed_at"),
});

/**
 * Per-page layout profile for PDF attachments (pdfjs deterministic triage),
 * or synthetic single-page rows for image attachments (page vision).
 * One row per (content_hash, page_no). Used to route pages to text vs vision.
 */
export const attachmentDocumentPages = pgTable(
  "attachment_document_pages",
  {
    contentHash: text("content_hash")
      .notNull()
      .references(() => attachmentDocuments.contentHash, { onDelete: "cascade" }),
    pageNo: integer("page_no").notNull(),
    chars: integer("chars").notNull().default(0),
    /** Fraction of page area covered by text item bounding boxes (0–1). */
    textAreaRatio: text("text_area_ratio"),
    /** Estimated fraction of page area covered by painted images (0–1). */
    imageAreaRatio: text("image_area_ratio"),
    /** Count of constructPath operators (vector drawing density). */
    vectorOps: integer("vector_ops").notNull().default(0),
    hasTextLayer: boolean("has_text_layer").notNull().default(false),
    route: text("route", {
      enum: ["text", "vision", "ambiguous"],
    }).notNull(),
    visionStatus: text("vision_status", {
      enum: [
        "not_needed",
        "pending",
        "processing",
        "done",
        "failed",
        "skipped",
      ],
    })
      .notNull()
      .default("not_needed"),
    artifactPath: text("artifact_path"),
    visionError: text("vision_error"),
    visionAttempts: integer("vision_attempts").notNull().default(0),
    visionModel: text("vision_model"),
    visionInputTokens: integer("vision_input_tokens"),
    visionOutputTokens: integer("vision_output_tokens"),
    visionCostUsd: text("vision_cost_usd"),
    visionedAt: text("visioned_at"),
    profilerVersion: text("profiler_version").notNull(),
    profiledAt: text("profiled_at").notNull(),
  },
  (table) => ({
    pk: uniqueIndex("attachment_document_pages_hash_page_unique").on(
      table.contentHash,
      table.pageNo,
    ),
    routeIdx: index("attachment_document_pages_route_idx").on(table.route),
    visionIdx: index("attachment_document_pages_vision_status_idx").on(
      table.visionStatus,
    ),
  }),
);

/** Per-email contact highlight extraction (names, phones, titles, companies). */
export const contactHighlightExtractions = pgTable(
  "contact_highlight_extractions",
  {
    id: text("id").primaryKey(),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    extractionJson: text("extraction_json").notNull(),
    skipped: boolean("skipped").notNull().default(false),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costUsd: text("cost_usd"),
    apiModelName: text("api_model_name"),
    updatedAt: text("updated_at").notNull(),
    /** Second pass: only newly found values (diff vs first pass). Null = not run. */
    secondPassExtractionJson: text("second_pass_extraction_json"),
    secondPassSkipped: boolean("second_pass_skipped").notNull().default(false),
    secondPassError: text("second_pass_error"),
    secondPassInputTokens: integer("second_pass_input_tokens"),
    secondPassOutputTokens: integer("second_pass_output_tokens"),
    secondPassTotalTokens: integer("second_pass_total_tokens"),
    secondPassCostUsd: text("second_pass_cost_usd"),
    secondPassApiModelName: text("second_pass_api_model_name"),
    secondPassUpdatedAt: text("second_pass_updated_at"),
    /** Third pass: entity-card fingerprints JSON. Null = not run. */
    thirdPassExtractionJson: text("third_pass_extraction_json"),
    thirdPassSkipped: boolean("third_pass_skipped").notNull().default(false),
    thirdPassError: text("third_pass_error"),
    thirdPassInputTokens: integer("third_pass_input_tokens"),
    thirdPassOutputTokens: integer("third_pass_output_tokens"),
    thirdPassTotalTokens: integer("third_pass_total_tokens"),
    thirdPassCostUsd: text("third_pass_cost_usd"),
    thirdPassApiModelName: text("third_pass_api_model_name"),
    thirdPassUpdatedAt: text("third_pass_updated_at"),
  },
);

/**
 * Thread-scoped merge of pass-3 entity cards (4th pass).
 * One row per model + exact email-id set.
 */
export const contactFingerprintMerges = pgTable(
  "contact_fingerprint_merges",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id").notNull(),
    /** Sorted unique email ids joined by comma — unique with modelId. */
    emailIdsKey: text("email_ids_key").notNull(),
    emailIdsJson: text("email_ids_json").notNull(),
    entityCardsJson: text("entity_cards_json").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costUsd: text("cost_usd"),
    apiModelName: text("api_model_name"),
    error: text("error"),
    updatedAt: text("updated_at").notNull(),
  },
);

/** Per-email organization highlight extraction (names, phones, roles, websites). */
export const organizationHighlightExtractions = pgTable(
  "organization_highlight_extractions",
  {
    id: text("id").primaryKey(),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    extractionJson: text("extraction_json").notNull(),
    skipped: boolean("skipped").notNull().default(false),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costUsd: text("cost_usd"),
    apiModelName: text("api_model_name"),
    updatedAt: text("updated_at").notNull(),
    /** Second pass: only newly found values (diff vs first pass). Null = not run. */
    secondPassExtractionJson: text("second_pass_extraction_json"),
    secondPassSkipped: boolean("second_pass_skipped").notNull().default(false),
    secondPassError: text("second_pass_error"),
    secondPassInputTokens: integer("second_pass_input_tokens"),
    secondPassOutputTokens: integer("second_pass_output_tokens"),
    secondPassTotalTokens: integer("second_pass_total_tokens"),
    secondPassCostUsd: text("second_pass_cost_usd"),
    secondPassApiModelName: text("second_pass_api_model_name"),
    secondPassUpdatedAt: text("second_pass_updated_at"),
    /** Third pass: entity-card fingerprints JSON. Null = not run. */
    thirdPassExtractionJson: text("third_pass_extraction_json"),
    thirdPassSkipped: boolean("third_pass_skipped").notNull().default(false),
    thirdPassError: text("third_pass_error"),
    thirdPassInputTokens: integer("third_pass_input_tokens"),
    thirdPassOutputTokens: integer("third_pass_output_tokens"),
    thirdPassTotalTokens: integer("third_pass_total_tokens"),
    thirdPassCostUsd: text("third_pass_cost_usd"),
    thirdPassApiModelName: text("third_pass_api_model_name"),
    thirdPassUpdatedAt: text("third_pass_updated_at"),
  },
);

/**
 * Thread-scoped merge of pass-3 org entity cards (4th pass).
 * One row per model + exact email-id set.
 */
export const organizationFingerprintMerges = pgTable(
  "organization_fingerprint_merges",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id").notNull(),
    /** Sorted unique email ids joined by comma — unique with modelId. */
    emailIdsKey: text("email_ids_key").notNull(),
    emailIdsJson: text("email_ids_json").notNull(),
    entityCardsJson: text("entity_cards_json").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costUsd: text("cost_usd"),
    apiModelName: text("api_model_name"),
    error: text("error"),
    updatedAt: text("updated_at").notNull(),
  },
);

/**
 * Manual org merges from Entities → Organizations.
 * absorbed_key / survivor_key are org identity keys (email:… / name:…).
 */
export const organizationManualMerges = pgTable(
  "organization_manual_merges",
  {
    id: text("id").primaryKey(),
    absorbedKey: text("absorbed_key").notNull().unique(),
    survivorKey: text("survivor_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
);

/**
 * Negative associations: do not attach this field value to this organization.
 * name_key anchors the pair so denying an email does not ban it globally.
 */
export const organizationFieldDenials = pgTable(
  "organization_field_denials",
  {
    id: text("id").primaryKey(),
    /** Org identity key at deny time (email:… / name:… / …). */
    orgKey: text("org_key").notNull(),
    /** name | organization_role | email | phone | website | name_alias */
    field: text("field").notNull(),
    /** Normalized denied value (see field-denials.ts). */
    deniedValue: text("denied_value").notNull(),
    /** Normalized org name at deny time; preferred match key when set. */
    nameKey: text("name_key"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    orgFieldValueUnique: uniqueIndex(
      "organization_field_denials_org_field_value_unique",
    ).on(table.orgKey, table.field, table.deniedValue),
  }),
);

/**
 * Positive associations: attach this field value to this organization.
 * Inverse of organization_field_denials. Used to move an alias/email/phone/website
 * from one org card to another without merging the whole card.
 */
export const organizationFieldAttachments = pgTable(
  "organization_field_attachments",
  {
    id: text("id").primaryKey(),
    /** Target org identity key (email:… / name:… / …). */
    orgKey: text("org_key").notNull(),
    /** email | phone | website | name_alias */
    field: text("field").notNull(),
    /** Display string as shown on the source card. */
    attachedValue: text("attached_value").notNull(),
    /** Normalized value for uniqueness (see field-denials.ts). */
    valueKey: text("value_key").notNull(),
    /** Normalized target org name at attach time; preferred match key when set. */
    nameKey: text("name_key"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    orgFieldValueUnique: uniqueIndex(
      "organization_field_attachments_org_field_value_unique",
    ).on(table.orgKey, table.field, table.valueKey),
  }),
);

/**
 * Thin durable organization registry (materialized from fingerprint keys).
 * identity_key mirrors orgIdentityKey (email:… / name:… / web:… / phone:…).
 * Manual merges set merged_into_id and rewrite affiliations to the survivor.
 */
export const organizationEntities = pgTable(
  "organization_entities",
  {
    id: text("id").primaryKey(),
    identityKey: text("identity_key").notNull().unique(),
    name: text("name"),
    organizationRole: text("organization_role"),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    status: text("status", {
      enum: ["active", "merged"],
    })
      .notNull()
      .default("active"),
    mergedIntoId: text("merged_into_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    statusIdx: index("organization_entities_status_idx").on(table.status),
  }),
);

/** Per-email project highlight extraction (names, years, phases, contractors). */
export const projectHighlightExtractions = pgTable(
  "project_highlight_extractions",
  {
    id: text("id").primaryKey(),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    extractionJson: text("extraction_json").notNull(),
    skipped: boolean("skipped").notNull().default(false),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costUsd: text("cost_usd"),
    apiModelName: text("api_model_name"),
    updatedAt: text("updated_at").notNull(),
    secondPassExtractionJson: text("second_pass_extraction_json"),
    secondPassSkipped: boolean("second_pass_skipped").notNull().default(false),
    secondPassError: text("second_pass_error"),
    secondPassInputTokens: integer("second_pass_input_tokens"),
    secondPassOutputTokens: integer("second_pass_output_tokens"),
    secondPassTotalTokens: integer("second_pass_total_tokens"),
    secondPassCostUsd: text("second_pass_cost_usd"),
    secondPassApiModelName: text("second_pass_api_model_name"),
    secondPassUpdatedAt: text("second_pass_updated_at"),
    thirdPassExtractionJson: text("third_pass_extraction_json"),
    thirdPassSkipped: boolean("third_pass_skipped").notNull().default(false),
    thirdPassError: text("third_pass_error"),
    thirdPassInputTokens: integer("third_pass_input_tokens"),
    thirdPassOutputTokens: integer("third_pass_output_tokens"),
    thirdPassTotalTokens: integer("third_pass_total_tokens"),
    thirdPassCostUsd: text("third_pass_cost_usd"),
    thirdPassApiModelName: text("third_pass_api_model_name"),
    thirdPassUpdatedAt: text("third_pass_updated_at"),
  },
  (table) => ({
    emailModelUnique: uniqueIndex(
      "project_highlight_extractions_email_model_unique",
    ).on(table.emailId, table.modelId),
  }),
);

/**
 * Thread-scoped merge of pass-3 project entity cards (4th pass).
 * One row per model + exact email-id set.
 */
export const projectFingerprintMerges = pgTable(
  "project_fingerprint_merges",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id").notNull(),
    emailIdsKey: text("email_ids_key").notNull(),
    emailIdsJson: text("email_ids_json").notNull(),
    entityCardsJson: text("entity_cards_json").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costUsd: text("cost_usd"),
    apiModelName: text("api_model_name"),
    error: text("error"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    modelEmailsUnique: uniqueIndex(
      "project_fingerprint_merges_model_emails_unique",
    ).on(table.modelId, table.emailIdsKey),
  }),
);

/**
 * Manual project merges from Entities → Projects.
 * absorbed_key / survivor_key are project identity keys (name:…|year:…).
 */
export const projectManualMerges = pgTable(
  "project_manual_merges",
  {
    id: text("id").primaryKey(),
    absorbedKey: text("absorbed_key").notNull().unique(),
    survivorKey: text("survivor_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
);

/**
 * Negative associations: do not attach this field value to this project.
 */
export const projectFieldDenials = pgTable(
  "project_field_denials",
  {
    id: text("id").primaryKey(),
    projectKey: text("project_key").notNull(),
    /** name | year_hint | phase | contractor | location | equipment_mentions | name_alias */
    field: text("field").notNull(),
    deniedValue: text("denied_value").notNull(),
    nameKey: text("name_key"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectFieldValueUnique: uniqueIndex(
      "project_field_denials_project_field_value_unique",
    ).on(table.projectKey, table.field, table.deniedValue),
  }),
);

/**
 * Thin durable project registry (materialized from fingerprint keys).
 * identity_key is name:… or name:…|year:… — human merge decides if years
 * are the same initiative. Never slugify-only.
 */
export const projectEntities = pgTable(
  "project_entities",
  {
    id: text("id").primaryKey(),
    identityKey: text("identity_key").notNull().unique(),
    name: text("name"),
    yearHint: text("year_hint"),
    phase: text("phase"),
    contractor: text("contractor"),
    location: text("location"),
    equipmentMentions: text("equipment_mentions"),
    scope: text("scope", {
      enum: ["building", "multi_unit", "unit", "unknown"],
    }),
    status: text("status", {
      enum: ["active", "merged"],
    })
      .notNull()
      .default("active"),
    mergedIntoId: text("merged_into_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    statusIdx: index("project_entities_status_idx").on(table.status),
  }),
);

/** Per-email calendar event harvest (meetings, cancels, deadlines). */
export const eventHighlightExtractions = pgTable(
  "event_highlight_extractions",
  {
    id: text("id").primaryKey(),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    extractionJson: text("extraction_json").notNull(),
    skipped: boolean("skipped").notNull().default(false),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costUsd: text("cost_usd"),
    apiModelName: text("api_model_name"),
    /** extraction_sources row written by this harvest persist; replaced on re-run. */
    persistSourceId: text("persist_source_id"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    emailModelUnique: uniqueIndex(
      "event_highlight_extractions_email_model_unique",
    ).on(table.emailId, table.modelId),
  }),
);

/** Per-email to-do harvest (unresolved asks / action items). */
export const todoHighlightExtractions = pgTable(
  "todo_highlight_extractions",
  {
    id: text("id").primaryKey(),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    extractionJson: text("extraction_json").notNull(),
    skipped: boolean("skipped").notNull().default(false),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costUsd: text("cost_usd"),
    apiModelName: text("api_model_name"),
    /** extraction_sources row written by this harvest persist; replaced on re-run. */
    persistSourceId: text("persist_source_id"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    emailModelUnique: uniqueIndex(
      "todo_highlight_extractions_email_model_unique",
    ).on(table.emailId, table.modelId),
  }),
);

/**
 * Inbox-wide bulk contact/org/project/event/todo extraction jobs (modal on /emails).
 * Progress + cumulative cost are updated as the client walks threads.
 */
export const bulkExtractRuns = pgTable("bulk_extract_runs", {
  id: text("id").primaryKey(),
  kind: text("kind", {
    enum: ["contacts", "organizations", "projects", "events", "todos"],
  }).notNull(),
  modelId: text("model_id").notNull(),
  /**
   * all = entire inbox (UI bulk extract). missing = emails that lack a
   * successful harvest row for this kind (drip after ingest).
   */
  targetScope: text("target_scope", {
    enum: ["all", "missing"],
  })
    .notNull()
    .default("all"),
  status: text("status", {
    enum: ["running", "completed", "failed", "cancelled"],
  }).notNull(),
  totalThreads: integer("total_threads").notNull().default(0),
  totalEmails: integer("total_emails").notNull().default(0),
  completedThreads: integer("completed_threads").notNull().default(0),
  completedEmails: integer("completed_emails").notNull().default(0),
  failedThreads: integer("failed_threads").notNull().default(0),
  /** 1-based index of the thread currently being processed; 0 when idle. */
  currentThreadIndex: integer("current_thread_index").notNull().default(0),
  currentThreadId: text("current_thread_id"),
  currentThreadSubject: text("current_thread_subject"),
  currentEmailId: text("current_email_id"),
  currentEmailLabel: text("current_email_label"),
  currentPass: integer("current_pass"),
  currentEmailIndex: integer("current_email_index"),
  currentEmailTotal: integer("current_email_total"),
  /** Cumulative estimated USD for this run (string for precision parity). */
  totalCostUsd: text("total_cost_usd").notNull().default("0"),
  /** Wall-clock start of the current active stint; null when not running. */
  stintStartedAt: text("stint_started_at"),
  /** completedEmails at the start of the current/last stint (rate/ETA baseline). */
  completedEmailsAtStintStart: integer("completed_emails_at_stint_start")
    .notNull()
    .default(0),
  /** Cumulative active milliseconds from ended stints (excludes pauses). */
  activeElapsedMs: integer("active_elapsed_ms").notNull().default(0),
  startedAt: text("started_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  finishedAt: text("finished_at"),
  lastError: text("last_error"),
});

/**
 * Extraction backfill jobs (modal on Extraction lab).
 * Modes: docling_only | vision_only | full (Docling text + Gemini vision).
 * Progress + stint timing for rate/ETA; per-page Docling cache / vision status
 * are the durable checkpoints.
 */
export const doclingBackfillRuns = pgTable("docling_backfill_runs", {
  id: text("id").primaryKey(),
  status: text("status", {
    enum: ["running", "completed", "failed", "cancelled"],
  }).notNull(),
  /** docling_only | vision_only | full */
  mode: text("mode", {
    enum: ["docling_only", "vision_only", "full"],
  })
    .notNull()
    .default("docling_only"),
  /** Current phase while running: docling | vision */
  phase: text("phase", { enum: ["docling", "vision"] }),
  /** Null = process all pending docs; otherwise max docs for this run. */
  docLimit: integer("doc_limit"),
  totalDocs: integer("total_docs").notNull().default(0),
  /** Combined page budget (docling + vision) for ETA. */
  totalPages: integer("total_pages").notNull().default(0),
  totalDoclingPages: integer("total_docling_pages").notNull().default(0),
  totalVisionPages: integer("total_vision_pages").notNull().default(0),
  /** Corpus uncached text pages at run start (for extrapolation). */
  corpusUncachedPages: integer("corpus_uncached_pages").notNull().default(0),
  corpusPendingDocs: integer("corpus_pending_docs").notNull().default(0),
  corpusPendingVisionPages: integer("corpus_pending_vision_pages")
    .notNull()
    .default(0),
  corpusPendingVisionDocs: integer("corpus_pending_vision_docs")
    .notNull()
    .default(0),
  completedDocs: integer("completed_docs").notNull().default(0),
  completedPages: integer("completed_pages").notNull().default(0),
  completedDoclingPages: integer("completed_docling_pages").notNull().default(0),
  completedVisionPages: integer("completed_vision_pages").notNull().default(0),
  failedDocs: integer("failed_docs").notNull().default(0),
  /** sidecar | ibm — which Docling backend this run uses. */
  doclingProvider: text("docling_provider", {
    enum: ["sidecar", "ibm"],
  })
    .notNull()
    .default("sidecar"),
  /** ibm_docling_accounts.id when this run used the IBM API. */
  ibmAccountId: text("ibm_account_id"),
  /** Cumulative IBM Docling $ for this run (string for precision). */
  doclingCostUsd: text("docling_cost_usd").notNull().default("0"),
  /** Cumulative Gemini vision $ for this run (string for precision). */
  visionCostUsd: text("vision_cost_usd").notNull().default("0"),
  /** JSON string[] of content hashes planned for this run (resume cursor). */
  plannedHashesJson: text("planned_hashes_json").notNull().default("[]"),
  /** 1-based index of the doc currently being processed; 0 when idle. */
  currentDocIndex: integer("current_doc_index").notNull().default(0),
  currentContentHash: text("current_content_hash"),
  currentLabel: text("current_label"),
  currentPagesInDoc: integer("current_pages_in_doc"),
  stintStartedAt: text("stint_started_at"),
  completedPagesAtStintStart: integer("completed_pages_at_stint_start")
    .notNull()
    .default(0),
  activeElapsedMs: integer("active_elapsed_ms").notNull().default(0),
  startedAt: text("started_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  finishedAt: text("finished_at"),
  lastError: text("last_error"),
});

/**
 * IBM watsonx Docling trial slots for Extraction-lab spend tracking.
 * Credentials stay in .env.local (`DOCLING_IBM_URL` / `DOCLING_IBM_API_KEY`
 * plus `_2` `_3` `_4`). This table attributes billed pages and exhaustion
 * per env slot — keys are never stored.
 */
export const ibmDoclingAccounts = pgTable("ibm_docling_accounts", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  /** 1-based .env.local slot (`DOCLING_IBM_API_KEY` = 1, `_2` = 2, …). */
  envSlot: integer("env_slot"),
  /** Last path segment of the instance URL (not a secret). */
  instanceHint: text("instance_hint"),
  /** sha256 prefix of the API key — detects replacement without storing it. */
  keyFingerprint: text("key_fingerprint"),
  /** Trial page allowance (IBM 30-day trial is 5,000). */
  trialPages: integer("trial_pages").notNull().default(5000),
  notes: text("notes"),
  /** Live slot used for the next IBM convert. */
  isActive: boolean("is_active").notNull().default(false),
  /** Set when IBM returns 402 usage_limit_exceeded (or auth reject). */
  exhaustedAt: text("exhausted_at"),
  exhaustedReason: text("exhausted_reason"),
  billedPages: integer("billed_pages").notNull().default(0),
  billedUsd: text("billed_usd").notNull().default("0"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Global person registry (post thread pass-4).
 * One row = one human; emails/titles are time-bounded on child tables.
 */
export const contactPersons = pgTable("contact_persons", {
  id: text("id").primaryKey(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  /**
   * JSON string[] of former given names retained after merge/enrich
   * (e.g. first-name-only stubs absorbed into a fuller card).
   */
  nameAliasesJson: text("name_aliases_json"),
  /** Sum of source-email mentions contributing to this person. */
  mentionWeight: integer("mention_weight").notNull().default(0),
  /** True when card has only a first name (no last/email/phone). */
  sparseStub: boolean("sparse_stub").notNull().default(false),
  /**
   * UI denormalized pointer to the current approved affiliation org.
   * Source of truth remains person_organization_affiliations.
   */
  currentOrganizationId: text("current_organization_id").references(
    () => organizationEntities.id,
    { onDelete: "set null" },
  ),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Person ↔ organization affiliation edges (link layer; Step 2B).
 * Source of truth for employment / represents / board_of — not harvest fields.
 * Proposals stay pending until human approve/deny; AI never auto-applies.
 */
export const personOrganizationAffiliations = pgTable(
  "person_organization_affiliations",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => contactPersons.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationEntities.id, { onDelete: "cascade" }),
    /** Durable org identity key at write time (survives display renames). */
    organizationKey: text("organization_key").notNull(),
    relationType: text("relation_type", {
      enum: ["employed_at", "represents", "board_of"],
    })
      .notNull()
      .default("employed_at"),
    status: text("status", {
      enum: ["pending", "approved", "denied"],
    })
      .notNull()
      .default("pending"),
    source: text("source", {
      enum: [
        "domain_prior",
        "cooccurrence",
        "ai_adjudicated",
        "manual",
        "legacy_bridge",
      ],
    }).notNull(),
    confidence: text("confidence", {
      enum: ["high", "medium", "low"],
    })
      .notNull()
      .default("medium"),
    /** JSON: email ids, quotes, domain pair, candidate scores, AI rationale. */
    evidenceJson: text("evidence_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    reviewedAt: text("reviewed_at"),
  },
  (table) => ({
    personOrgUnique: uniqueIndex("person_org_affiliations_person_org_unique").on(
      table.personId,
      table.organizationId,
    ),
    personStatusIdx: index("person_org_affiliations_person_status_idx").on(
      table.personId,
      table.status,
    ),
    orgStatusIdx: index("person_org_affiliations_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
  }),
);

/** Email occupancy intervals — same address may appear on multiple people. */
export const contactPersonEmails = pgTable("contact_person_emails", {
  id: text("id").primaryKey(),
  personId: text("person_id")
    .notNull()
    .references(() => contactPersons.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  /** Inclusive start (ISO date or datetime from source emails). */
  validFrom: text("valid_from"),
  /** Inclusive end; null = still active / current when latest. */
  validTo: text("valid_to"),
  /** JSON: [{ emailId, receivedAt, mergeId? }] */
  evidenceJson: text("evidence_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const contactPersonPhones = pgTable("contact_person_phones", {
  id: text("id").primaryKey(),
  personId: text("person_id")
    .notNull()
    .references(() => contactPersons.id, { onDelete: "cascade" }),
  phone: text("phone").notNull(),
  phoneNormalized: text("phone_normalized").notNull(),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  evidenceJson: text("evidence_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const contactPersonTitles = pgTable("contact_person_titles", {
  id: text("id").primaryKey(),
  personId: text("person_id")
    .notNull()
    .references(() => contactPersons.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  evidenceJson: text("evidence_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Negative associations: do not attach this field value to this person.
 */
export const contactPersonFieldDenials = pgTable(
  "contact_person_field_denials",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => contactPersons.id, { onDelete: "cascade" }),
    /** email | phone | title | name_alias */
    field: text("field").notNull(),
    deniedValue: text("denied_value").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    personFieldValueUnique: uniqueIndex(
      "contact_person_field_denials_person_field_value_unique",
    ).on(table.personId, table.field, table.deniedValue),
  }),
);

/** Who currently owns an address for "now" lookups. */
export const contactEmailIndex = pgTable("contact_email_index", {
  email: text("email").primaryKey(),
  currentPersonId: text("current_person_id").references(() => contactPersons.id, {
    onDelete: "set null",
  }),
  updatedAt: text("updated_at").notNull(),
});

/** Audit log of AI merge / link decisions. */
export const contactMergeProposals = pgTable("contact_merge_proposals", {
  id: text("id").primaryKey(),
  action: text("action", {
    enum: ["merge", "link_email", "keep_separate", "enrich"],
  }).notNull(),
  incomingCardJson: text("incoming_card_json").notNull(),
  targetPersonId: text("target_person_id").references(() => contactPersons.id, {
    onDelete: "set null",
  }),
  resultPersonId: text("result_person_id").references(() => contactPersons.id, {
    onDelete: "set null",
  }),
  decisionJson: text("decision_json").notNull(),
  modelId: text("model_id"),
  fingerprintMergeId: text("fingerprint_merge_id").references(
    () => contactFingerprintMerges.id,
    { onDelete: "set null" },
  ),
  createdAt: text("created_at").notNull(),
});

/** Idempotent ingest of a thread pass-4 merge into the global registry. */
export const contactRegistryIngests = pgTable("contact_registry_ingests", {
  id: text("id").primaryKey(),
  fingerprintMergeId: text("fingerprint_merge_id")
    .notNull()
    .references(() => contactFingerprintMerges.id, { onDelete: "cascade" })
    .unique(),
  modelId: text("model_id").notNull(),
  status: text("status", {
    enum: ["pending", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  personsCreated: integer("persons_created").notNull().default(0),
  decisionsApplied: integer("decisions_applied").notNull().default(0),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
});

/**
 * Per-email contact observations. Sparse first-name cards stay here until
 * the resolver attaches them to a canonical contact_persons row.
 */
export const contactMentions = pgTable(
  "contact_mentions",
  {
    id: text("id").primaryKey(),
    sourceEmailId: text("source_email_id").references(() => emails.id, {
      onDelete: "cascade",
    }),
    fingerprintMergeId: text("fingerprint_merge_id").references(
      () => contactFingerprintMerges.id,
      { onDelete: "set null" },
    ),
    modelId: text("model_id"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    phone: text("phone"),
    jobTitle: text("job_title"),
    rawCompany: text("raw_company"),
    mentionKind: text("mention_kind", {
      enum: ["participant", "referred", "unknown"],
    })
      .notNull()
      .default("unknown"),
    fingerprint: text("fingerprint").notNull(),
    firstNameKey: text("first_name_key"),
    firstOrgKey: text("first_org_key"),
    blockingKeysJson: text("blocking_keys_json").notNull().default("[]"),
    resolutionStatus: text("resolution_status", {
      enum: ["unresolved", "provisional", "confirmed"],
    })
      .notNull()
      .default("unresolved"),
    resolvedPersonId: text("resolved_person_id").references(
      () => contactPersons.id,
      { onDelete: "set null" },
    ),
    resolvedOrganizationId: text("resolved_organization_id").references(
      () => organizationEntities.id,
      { onDelete: "set null" },
    ),
    resolutionReason: text("resolution_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    emailFingerprintUnique: uniqueIndex(
      "contact_mentions_email_fingerprint_unique",
    ).on(table.sourceEmailId, table.fingerprint),
    statusIdx: index("contact_mentions_status_idx").on(table.resolutionStatus),
    firstNameKeyIdx: index("contact_mentions_first_name_key_idx").on(
      table.firstNameKey,
    ),
    firstOrgKeyIdx: index("contact_mentions_first_org_key_idx").on(
      table.firstOrgKey,
    ),
    resolvedPersonIdx: index("contact_mentions_resolved_person_idx").on(
      table.resolvedPersonId,
    ),
    emailIdx: index("contact_mentions_email_idx").on(table.email),
  }),
);

/**
 * Human review queue for Telegram HITL. Contact holds skip auto-apply;
 * affiliation rows stay pending in person_organization_affiliations too.
 */
export const telegramReviewItems = pgTable(
  "telegram_review_items",
  {
    id: text("id").primaryKey(),
    kind: text("kind", {
      enum: ["contact_identity", "affiliation"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "approved", "denied"],
    })
      .notNull()
      .default("pending"),
    holdReason: text("hold_reason").notNull(),
    payloadJson: text("payload_json").notNull(),
    affiliationId: text("affiliation_id").references(
      () => personOrganizationAffiliations.id,
      { onDelete: "cascade" },
    ),
    fingerprintMergeId: text("fingerprint_merge_id").references(
      () => contactFingerprintMerges.id,
      { onDelete: "set null" },
    ),
    telegramChatId: text("telegram_chat_id"),
    telegramMessageId: integer("telegram_message_id"),
    createdAt: text("created_at").notNull(),
    reviewedAt: text("reviewed_at"),
    reviewedVia: text("reviewed_via", {
      enum: ["telegram", "ui"],
    }),
  },
  (table) => ({
    pendingCreatedIdx: index("telegram_review_items_pending_created_idx").on(
      table.status,
      table.createdAt,
    ),
    affiliationUnique: uniqueIndex("telegram_review_items_affiliation_unique").on(
      table.affiliationId,
    ),
  }),
);

/** Messages intentionally removed from the app but left in dedicated Gmail. */
export const emailSyncExclusions = pgTable("email_sync_exclusions", {
  gmailMessageId: text("gmail_message_id").primaryKey(),
  messageIdHeader: text("message_id_header"),
  excludedAt: text("excluded_at").notNull(),
});

export const appUsers = pgTable("app_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  role: text("role", { enum: ["super_admin", "admin", "user"] })
    .notNull()
    .default("user"),
  /** Personal Telegram chat id for HITL digest (not the shared bot token). */
  telegramChatId: text("telegram_chat_id"),
  createdAt: text("created_at").notNull(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const emailThreadsRelations = relations(emailThreads, ({ many }) => ({
  emails: many(emails),
}));

export const emailsRelations = relations(emails, ({ one, many }) => ({
  thread: one(emailThreads, {
    fields: [emails.threadId],
    references: [emailThreads.id],
  }),
  syncRun: one(syncRuns, {
    fields: [emails.syncRunId],
    references: [syncRuns.id],
  }),
  attachments: many(emailAttachments),
  contactHighlightExtractions: many(contactHighlightExtractions),
  organizationHighlightExtractions: many(organizationHighlightExtractions),
  todoHighlightExtractions: many(todoHighlightExtractions),
}));

export const contactHighlightExtractionsRelations = relations(
  contactHighlightExtractions,
  ({ one }) => ({
    email: one(emails, {
      fields: [contactHighlightExtractions.emailId],
      references: [emails.id],
    }),
  }),
);

export const organizationHighlightExtractionsRelations = relations(
  organizationHighlightExtractions,
  ({ one }) => ({
    email: one(emails, {
      fields: [organizationHighlightExtractions.emailId],
      references: [emails.id],
    }),
  }),
);

export const emailAttachmentsRelations = relations(
  emailAttachments,
  ({ one }) => ({
    email: one(emails, {
      fields: [emailAttachments.emailId],
      references: [emails.id],
    }),
  }),
);

export const analysisSettings = pgTable("analysis_settings", {
  id: text("id").primaryKey(),
  analysisModel: text("analysis_model")
    .notNull()
    .default("gemini-2.5-flash"),
  mergeModel: text("merge_model"),
  maxOutputTokens: integer("max_output_tokens").notNull().default(65536),
  extractionVersion: integer("extraction_version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});

export const analysisQueue = pgTable("analysis_queue", {
  id: text("id").primaryKey(),
  unitType: text("unit_type", {
    enum: ["email_message", "email_thread", "email_attachment"],
  }).notNull(),
  unitId: text("unit_id").notNull(),
  status: text("status", {
    enum: ["pending", "processing", "done", "failed"],
  })
    .notNull()
    .default("pending"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
});

export const extractionSkillEntries = pgTable("extraction_skill_entries", {
  id: text("id").primaryKey(),
  conceptName: text("concept_name").notNull().unique(),
  description: text("description").notNull(),
  suggestedFieldsJson: text("suggested_fields_json").notNull().default("[]"),
  exampleQuotesJson: text("example_quotes_json").notNull().default("[]"),
  exampleEmailIdsJson: text("example_email_ids_json").notNull().default("[]"),
  occurrenceCount: integer("occurrence_count").notNull().default(0),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  status: text("status", {
    enum: ["active", "archived", "merged"],
  })
    .notNull()
    .default("active"),
  mergedIntoId: text("merged_into_id"),
  category: text("category"),
  userNotes: text("user_notes"),
  /** null = skill-only (default). See lib/email/concept-routing.ts */
  routingDestinationId: text("routing_destination_id"),
  fieldMappingJson: text("field_mapping_json").notNull().default("{}"),
  routingOptionsJson: text("routing_options_json").notNull().default("{}"),
  routingConfiguredAt: text("routing_configured_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const extractionSkillVersions = pgTable("extraction_skill_versions", {
  id: text("id").primaryKey(),
  versionNumber: integer("version_number").notNull().unique(),
  snapshotJson: text("snapshot_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const extractionSkillAuditLog = pgTable("extraction_skill_audit_log", {
  id: text("id").primaryKey(),
  entryId: text("entry_id").references(() => extractionSkillEntries.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

export const extractionSources = pgTable("extraction_sources", {
  id: text("id").primaryKey(),
  sourceType: text("source_type", {
    enum: ["email_message", "email_attachment", "email_thread", "meeting"],
  }).notNull(),
  sourceId: text("source_id").notNull(),
  emailThreadId: text("email_thread_id").references(() => emailThreads.id),
  processedAt: text("processed_at").notNull(),
  modelName: text("model_name").notNull(),
  extractionVersion: integer("extraction_version").notNull().default(1),
  skillVersionId: text("skill_version_id").references(
    () => extractionSkillVersions.id,
  ),
  contentHash: text("content_hash"),
  rawExtractionJson: text("raw_extraction_json").notNull(),
  aiUsageJson: text("ai_usage_json"),
  totalInputTokens: integer("total_input_tokens").notNull().default(0),
  totalOutputTokens: integer("total_output_tokens").notNull().default(0),
  totalCostUsd: text("total_cost_usd").notNull().default("0"),
  processingDurationMs: integer("processing_duration_ms"),
  /** App user who triggered this analysis run, when applicable. */
  triggeredByUserId: text("triggered_by_user_id").references(() => appUsers.id),
});

export const discoveredFacts = pgTable("discovered_facts", {
  id: text("id").primaryKey(),
  conceptId: text("concept_id")
    .notNull()
    .references(() => extractionSkillEntries.id, { onDelete: "cascade" }),
  payloadJson: text("payload_json").notNull(),
  sourceQuote: text("source_quote"),
  confidence: text("confidence"),
  sourceId: text("source_id")
    .notNull()
    .references(() => extractionSources.id, { onDelete: "cascade" }),
  dedupKey: text("dedup_key"),
  createdAt: text("created_at").notNull(),
});

export const buildingEquipmentRegistry = pgTable("building_equipment_registry", {
  id: text("id").primaryKey(),
  canonicalName: text("canonical_name").notNull(),
  manufacturer: text("manufacturer"),
  model: text("model"),
  floor: integer("floor"),
  location: text("location"),
  drawingReference: text("drawing_reference"),
  category: text("category"),
  specsJson: text("specs_json"),
  positionJson: text("position_json"),
  createdAt: text("created_at").notNull(),
});

export const equipmentAssets = pgTable("equipment_assets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
  category: text("category"),
  installDate: text("install_date"),
  notes: text("notes"),
  kind: text("kind").notNull().default("equipment"),
  significance: text("significance").notNull().default("major"),
  manufacturer: text("manufacturer"),
  aliasesJson: text("aliases_json"),
  canonicalId: text("canonical_id").references((): AnyPgColumn => equipmentAssets.id, {
    onDelete: "set null",
  }),
  confidence: text("confidence"),
  source: text("source").notNull().default("extracted"),
  registryId: text("registry_id").references(() => buildingEquipmentRegistry.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at").notNull(),
});

export const vendors = pgTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  contactJson: text("contact_json"),
  servicesJson: text("services_json"),
  reviewStatus: text("review_status").notNull().default("approved"),
  organizationRole: text("organization_role"),
  createdAt: text("created_at").notNull(),
});

/** User-defined organization roles beyond the built-in set in organization-roles.ts. */
export const organizationRoleDefinitions = pgTable("organization_role_definitions", {
  id: text("id").primaryKey(),
  label: text("label").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

export const budgetCategories = pgTable("budget_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  parentId: text("parent_id"),
});

export const maintenanceEvents = pgTable("maintenance_events", {
  id: text("id").primaryKey(),
  equipmentId: text("equipment_id").references(() => equipmentAssets.id),
  equipmentName: text("equipment_name").notNull(),
  eventType: text("event_type").notNull(),
  occurredAt: text("occurred_at"),
  occurredTime: text("occurred_time"),
  vendorId: text("vendor_id").references(() => vendors.id),
  vendorName: text("vendor_name"),
  cost: text("cost"),
  workOrder: text("work_order"),
  status: text("status"),
  description: text("description"),
  sourceQuote: text("source_quote"),
  confidence: text("confidence"),
  sourceId: text("source_id")
    .notNull()
    .references(() => extractionSources.id, { onDelete: "cascade" }),
  dedupKey: text("dedup_key"),
  createdAt: text("created_at").notNull(),
});

export const budgetLineItems = pgTable("budget_line_items", {
  id: text("id").primaryKey(),
  categoryId: text("category_id").references(() => budgetCategories.id),
  categoryName: text("category_name").notNull(),
  subcategory: text("subcategory"),
  fiscalYear: integer("fiscal_year"),
  periodStart: text("period_start"),
  periodEnd: text("period_end"),
  budgetedAmount: text("budgeted_amount"),
  actualAmount: text("actual_amount"),
  variance: text("variance"),
  currency: text("currency").default("CAD"),
  sourceQuote: text("source_quote"),
  confidence: text("confidence"),
  sourceId: text("source_id")
    .notNull()
    .references(() => extractionSources.id, { onDelete: "cascade" }),
  dedupKey: text("dedup_key"),
  createdAt: text("created_at").notNull(),
});

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  vendorId: text("vendor_id").references(() => vendors.id),
  vendorName: text("vendor_name"),
  amount: text("amount").notNull(),
  invoiceDate: text("invoice_date"),
  invoiceNumber: text("invoice_number"),
  categoryName: text("category_name"),
  paid: boolean("paid"),
  sourceQuote: text("source_quote"),
  sourceId: text("source_id")
    .notNull()
    .references(() => extractionSources.id, { onDelete: "cascade" }),
  dedupKey: text("dedup_key"),
  createdAt: text("created_at").notNull(),
});

export const contracts = pgTable("contracts", {
  id: text("id").primaryKey(),
  vendorId: text("vendor_id").references(() => vendors.id),
  vendorName: text("vendor_name"),
  contractType: text("contract_type"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  value: text("value"),
  sourceQuote: text("source_quote"),
  sourceId: text("source_id")
    .notNull()
    .references(() => extractionSources.id, { onDelete: "cascade" }),
  dedupKey: text("dedup_key"),
  createdAt: text("created_at").notNull(),
});

export const residentIssues = pgTable("resident_issues", {
  id: text("id").primaryKey(),
  unit: text("unit"),
  category: text("category"),
  description: text("description").notNull(),
  status: text("status"),
  resolution: text("resolution"),
  openedAt: text("opened_at"),
  resolvedAt: text("resolved_at"),
  sourceQuote: text("source_quote"),
  sourceId: text("source_id")
    .notNull()
    .references(() => extractionSources.id, { onDelete: "cascade" }),
  dedupKey: text("dedup_key"),
  createdAt: text("created_at").notNull(),
});

export const capitalProjects = pgTable("capital_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phase: text("phase"),
  status: text("status"),
  budget: text("budget"),
  contractor: text("contractor"),
  startDate: text("start_date"),
  completionDate: text("completion_date"),
  sourceQuote: text("source_quote"),
  sourceId: text("source_id")
    .notNull()
    .references(() => extractionSources.id, { onDelete: "cascade" }),
  dedupKey: text("dedup_key"),
  createdAt: text("created_at").notNull(),
});

export const extractedActionItems = pgTable("extracted_action_items", {
  id: text("id").primaryKey(),
  assignee: text("assignee").notNull(),
  description: text("description").notNull(),
  deadline: text("deadline"),
  completed: boolean("completed").notNull().default(false),
  completedAt: text("completed_at"),
  meetingId: text("meeting_id").references(() => meetings.id),
  emailThreadId: text("email_thread_id").references(() => emailThreads.id),
  /** Stage 4: AGM prep etc. hang off a calendar occurrence. Unused until todos. */
  relatedEventId: text("related_event_id"),
  sourceQuote: text("source_quote"),
  sourceId: text("source_id")
    .notNull()
    .references(() => extractionSources.id, { onDelete: "cascade" }),
  dedupKey: text("dedup_key"),
  /**
   * open = working list; stale = harvested but older than the working window;
   * completed / superseded / dismissed are closed. Keep `completed` in sync.
   */
  lifecycleStatus: text("lifecycle_status", {
    enum: ["open", "completed", "superseded", "stale", "dismissed"],
  })
    .notNull()
    .default("open"),
  createdAt: text("created_at").notNull(),
});

export const entityMentions = pgTable("entity_mentions", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityValue: text("entity_value").notNull(),
  context: text("context"),
  contactEmail: text("contact_email"),
  reviewStatus: text("review_status").notNull().default("pending"),
  organizationRole: text("organization_role"),
  vendorCandidate: boolean("vendor_candidate").notNull().default(false),
  dedupKey: text("dedup_key"),
  personTitle: text("person_title"),
  linkedOrganizationName: text("linked_organization_name"),
  sourceId: text("source_id")
    .notNull()
    .references(() => extractionSources.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
});

/** Email addresses linked to an approved person contact (supports multiple per contact). */
export const contactEmails = pgTable("contact_emails", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  personDedupKey: text("person_dedup_key").notNull(),
  personName: text("person_name").notNull(),
  reviewStatus: text("review_status", {
    enum: ["pending", "approved", "rejected"],
  })
    .notNull()
    .default("pending"),
  context: text("context"),
  sourceId: text("source_id").references(() => extractionSources.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at").notNull(),
});

/** Board-flagged entities the AI must not extract (e.g. old employer signatures). */
export const entityExclusions = pgTable("entity_exclusions", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityValue: text("entity_value").notNull(),
  dedupKey: text("dedup_key").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull(),
});

export const calendarEvents = pgTable("calendar_events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  eventType: text("event_type").notNull(),
  startAt: text("start_at").notNull(),
  endAt: text("end_at"),
  description: text("description"),
  sourceQuote: text("source_quote"),
  /** scheduled = visible; cancelled = pulled off the calendar (Google Calendar). */
  status: text("status", { enum: ["scheduled", "cancelled"] })
    .notNull()
    .default("scheduled"),
  sourceId: text("source_id")
    .notNull()
    .references(() => extractionSources.id, { onDelete: "cascade" }),
  dedupKey: text("dedup_key"),
  createdAt: text("created_at").notNull(),
});

/** Product bugs and feature requests tracked from the Notes page. */
export const devNotes = pgTable("dev_notes", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["bug", "feature"] }).notNull(),
  status: text("status", {
    enum: ["open", "closed", "in_progress", "deferred"],
  })
    .notNull()
    .default("open"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  createdAt: text("created_at").notNull(),
});

export const devNoteScreenshots = pgTable("dev_note_screenshots", {
  id: text("id").primaryKey(),
  noteId: text("note_id")
    .notNull()
    .references(() => devNotes.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const devNotesRelations = relations(devNotes, ({ many }) => ({
  screenshots: many(devNoteScreenshots),
}));

export const devNoteScreenshotsRelations = relations(
  devNoteScreenshots,
  ({ one }) => ({
    note: one(devNotes, {
      fields: [devNoteScreenshots.noteId],
      references: [devNotes.id],
    }),
  }),
);

export const extractionSourcesRelations = relations(
  extractionSources,
  ({ one }) => ({
    thread: one(emailThreads, {
      fields: [extractionSources.emailThreadId],
      references: [emailThreads.id],
    }),
  }),
);
