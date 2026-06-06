import { relations } from "drizzle-orm";
import { boolean, integer, pgTable, text } from "drizzle-orm/pg-core";

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

/** Board-wide consolidated to-do list (merged from meeting checklists). */
export const globalTodos = pgTable("global_todos", {
  id: text("id").primaryKey(),
  assignee: text("assignee").notNull(),
  role: text("role").notNull(),
  description: text("description").notNull(),
  deadline: text("deadline"),
  completed: boolean("completed").notNull().default(false),
  completedAt: text("completed_at"),
  sourceMeetingId: text("source_meeting_id").references(() => meetings.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const globalTodosRelations = relations(globalTodos, ({ one }) => ({
  sourceMeeting: one(meetings, {
    fields: [globalTodos.sourceMeetingId],
    references: [meetings.id],
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
  trigger: text("trigger", { enum: ["cron", "manual", "backfill"] }).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  messagesAdded: integer("messages_added").notNull().default(0),
  messagesSkipped: integer("messages_skipped").notNull().default(0),
  errors: text("errors"),
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
  bodyTextUnique: text("body_text_unique"),
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
});

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
  name: text("name"),
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
}));

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

export const equipmentAssets = pgTable("equipment_assets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
  category: text("category"),
  installDate: text("install_date"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const vendors = pgTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  contactJson: text("contact_json"),
  servicesJson: text("services_json"),
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
  sourceQuote: text("source_quote"),
  sourceId: text("source_id")
    .notNull()
    .references(() => extractionSources.id, { onDelete: "cascade" }),
  dedupKey: text("dedup_key"),
  createdAt: text("created_at").notNull(),
});

export const entityMentions = pgTable("entity_mentions", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityValue: text("entity_value").notNull(),
  context: text("context"),
  sourceId: text("source_id")
    .notNull()
    .references(() => extractionSources.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
});

export const calendarEvents = pgTable("calendar_events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  eventType: text("event_type").notNull(),
  startAt: text("start_at").notNull(),
  endAt: text("end_at"),
  description: text("description"),
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
