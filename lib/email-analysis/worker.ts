import { randomUUID } from "crypto";

import { eq } from "drizzle-orm";

import {
  mergeExtractionDocuments,
  validateEmailExtraction,
  type EmailExtractionDocument,
} from "@/lib/email-analysis/schema";
import {
  buildAttachmentUserPrompt,
  buildEmailAnalysisSystemPrompt,
  buildEmailBodyUserPrompt,
} from "@/lib/email-analysis/prompts";
import { persistExtractionDocument, deleteExtractionEntities } from "@/lib/email-analysis/persist";
import {
  closeCrossThreadCalendarInviteItems,
  reconcileThreadActionItems,
} from "@/lib/email-analysis/action-item-reconciliation";
import { semanticDeduplicateIncomingActionItems } from "@/lib/email-analysis/action-item-dedup";
import { reconcileThreadEquipment } from "@/lib/email-analysis/equipment-reconciliation";
import { reconcileThreadCalendar } from "@/lib/email-analysis/calendar-reconciliation";
import { reconcileThreadEntities } from "@/lib/email-analysis/entity-reconciliation";
import { compileRegistryPromptSection } from "@/lib/building/equipment-registry";
import { detectAdditionalContactEmailsForThread } from "@/lib/entities/contact-emails";
import { loadEntityExclusionsPromptSection } from "@/lib/entities/entity-exclusions";
import {
  compileSkillPromptSection,
  mergeSkillProposals,
} from "@/lib/email-analysis/extraction-skill";
import {
  findExistingAttachmentExtraction,
  findHasValueByContentHash,
  getEmailAttachments,
  getThreadContext,
  preprocessEmailMessage,
} from "@/lib/email-analysis/preprocess";
import {
  beginEmailAnalysis,
  clearActiveQueueForEmail,
  completeEmailAnalysis,
  enqueueEmailsAnalysisPending,
  failEmailAnalysis,
} from "@/lib/email-analysis/queue";
import { getAnalysisSettings } from "@/lib/email-analysis/settings";
import { getDb } from "@/lib/db";
import {
  emailAttachments,
  emails,
  extractionSources,
} from "@/lib/db/schema";
import {
  downloadEmailAttachment,
  readCachedAttachment,
} from "@/lib/gmail/attachments";
import {
  generateEmailExtraction,
} from "@/lib/gemini/client";
import { extractPdfText } from "@/lib/parsers/pdf";
import { unwrapJsonCodeBlock } from "@/lib/gemini/parse-output";
import {
  estimateCostUsdForCalls,
  serializeAiUsage,
  type GeminiUsageCall,
} from "@/lib/gemini/usage";

/** Raw bytes; base64 encoding adds ~33% to the Gemini request payload. */
const MAX_INLINE_ATTACHMENT_BYTES = 14 * 1024 * 1024;
const MAX_EXTRACTED_PDF_TEXT_CHARS = 400_000;

function isPdfAttachment(mimeType: string, filename: string): boolean {
  return (
    mimeType.toLowerCase().includes("pdf") ||
    filename.toLowerCase().endsWith(".pdf")
  );
}

function isTextAttachment(mimeType: string, filename: string): boolean {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = filename.toLowerCase();
  return (
    lowerMime.startsWith("text/") ||
    lowerMime.includes("json") ||
    lowerMime.includes("xml") ||
    lowerMime === "message/rfc822" ||
    lowerName.endsWith(".ics") ||
    lowerName.endsWith(".eml") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".txt")
  );
}

function isGeminiDocumentError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /document has no pages|unable to process input document|invalid document/i.test(
    error.message,
  );
}

export type AnalyzeEmailResult = {
  sourceId: string;
  emailId: string;
  threadId: string | null;
  document: EmailExtractionDocument;
  counts: Record<string, number>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    modelName: string;
    calls: GeminiUsageCall[];
  };
  reprocessed: boolean;
};

function parseExtractionJson(raw: string): EmailExtractionDocument {
  const { jsonText } = unwrapJsonCodeBlock(raw);
  const parsed = JSON.parse(jsonText) as unknown;
  const { document, errors } = validateEmailExtraction(parsed);
  if (errors.length) {
    throw new Error(`Extraction validation failed: ${errors.join("; ")}`);
  }
  return document;
}

function attachmentHasValue(doc: EmailExtractionDocument): boolean {
  return doc.has_value !== false;
}

function minimalLowValueAttachmentDoc(
  filename: string,
  role?: string,
): EmailExtractionDocument {
  return {
    has_value: false,
    attachment_role: role,
    document_type: "decorative_attachment",
    tags: ["low_value_attachment"],
    summary: `Attachment "${filename}" classified as non-substantive.`,
  };
}

async function extractWithGemini(input: {
  systemInstruction: string;
  userText: string;
  modelName: string;
  maxOutputTokens: number;
  fileParts?: Array<{ mimeType: string; data: Buffer }>;
  step: string;
}): Promise<{ document: EmailExtractionDocument; calls: GeminiUsageCall[] }> {
  const result = await generateEmailExtraction({
    systemInstruction: input.systemInstruction,
    userText: input.userText,
    modelName: input.modelName,
    maxOutputTokens: input.maxOutputTokens,
    fileParts: input.fileParts,
    step: input.step,
  });

  return {
    document: parseExtractionJson(result.text),
    calls: result.usageCalls,
  };
}

async function extractAttachmentDocument(input: {
  bytes: Buffer;
  mimeType: string;
  filename: string;
  subject?: string;
  from?: string;
  attachmentId: string;
  modelName: string;
  maxOutputTokens: number;
  systemInstruction: string;
}): Promise<{ document: EmailExtractionDocument; calls: GeminiUsageCall[] }> {
  const attachmentPrompt = buildAttachmentUserPrompt({
    filename: input.filename,
    mimeType: input.mimeType,
    subject: input.subject,
    from: input.from,
  });
  const step = `attachment_${input.attachmentId}`;

  const extractFromText = async (text: string, textStep: string) =>
    extractWithGemini({
      systemInstruction: input.systemInstruction,
      userText: `${attachmentPrompt}

--- EXTRACTED PDF TEXT ---
${text}`,
      modelName: input.modelName,
      maxOutputTokens: input.maxOutputTokens,
      step: textStep,
    });

  const extractFromPdfText = async () => {
    const text = await extractPdfText(input.bytes);
    if (!text.trim()) {
      throw new Error(
        `Could not extract text from PDF attachment "${input.filename}". The file may be image-only or encrypted.`,
      );
    }

    const clipped =
      text.length > MAX_EXTRACTED_PDF_TEXT_CHARS
        ? `${text.slice(0, MAX_EXTRACTED_PDF_TEXT_CHARS)}\n\n[Text truncated — attachment exceeded ${MAX_EXTRACTED_PDF_TEXT_CHARS} characters.]`
        : text;

    const { document, calls } = await extractFromText(clipped, `${step}_text`);
    return { document, calls };
  };

  if (isPdfAttachment(input.mimeType, input.filename)) {
    if (input.bytes.length <= MAX_INLINE_ATTACHMENT_BYTES) {
      try {
        const { document, calls } = await extractWithGemini({
          systemInstruction: input.systemInstruction,
          userText: attachmentPrompt,
          modelName: input.modelName,
          maxOutputTokens: input.maxOutputTokens,
          fileParts: [{ mimeType: "application/pdf", data: input.bytes }],
          step,
        });
        return { document, calls };
      } catch (error) {
        if (!isGeminiDocumentError(error)) throw error;
      }
    }

    return extractFromPdfText();
  }

  if (isTextAttachment(input.mimeType, input.filename)) {
    const text = input.bytes.toString("utf8");
    const clipped =
      text.length > MAX_EXTRACTED_PDF_TEXT_CHARS
        ? `${text.slice(0, MAX_EXTRACTED_PDF_TEXT_CHARS)}\n\n[Text truncated — attachment exceeded ${MAX_EXTRACTED_PDF_TEXT_CHARS} characters.]`
        : text;

    return extractFromText(clipped, `${step}_text`);
  }

  if (!input.mimeType.toLowerCase().startsWith("image/")) {
    // CONCERN: Unsupported binary attachments are recorded as metadata-only until a parser is added.
    return {
      document: {
        document_type: "unsupported_attachment",
        summary: `Attachment "${input.filename}" was not analyzed because Gemini does not support inline ${input.mimeType} content.`,
        tags: ["unsupported_attachment"],
        entities: [
          {
            type: "attachment",
            value: input.filename,
            context: input.mimeType,
          },
        ],
      },
      calls: [],
    };
  }

  if (input.bytes.length > MAX_INLINE_ATTACHMENT_BYTES) {
    throw new Error(
      `Attachment "${input.filename}" is too large to analyze (${input.bytes.length} bytes).`,
    );
  }

  try {
    const { document, calls } = await extractWithGemini({
      systemInstruction: input.systemInstruction,
      userText: attachmentPrompt,
      modelName: input.modelName,
      maxOutputTokens: input.maxOutputTokens,
      fileParts: [{ mimeType: input.mimeType, data: input.bytes }],
      step,
    });
    return { document, calls };
  } catch (error) {
    if (isGeminiDocumentError(error)) {
      throw new Error(
        `Gemini could not read attachment "${input.filename}". The file may be corrupt or unsupported.`,
      );
    }
    throw error;
  }
}

export async function analyzeEmail(input: {
  emailId: string;
  reprocess?: boolean;
  triggeredByUserId?: string | null;
}): Promise<AnalyzeEmailResult> {
  const db = getDb();
  const settings = await getAnalysisSettings();

  const [email] = await db.select().from(emails).where(eq(emails.id, input.emailId));
  if (!email) throw new Error("Email not found.");

  if (email.processedAt && !input.reprocess) {
    const [existing] = await db
      .select()
      .from(extractionSources)
      .where(
        eq(extractionSources.sourceId, email.id),
      )
      .limit(1);

    if (existing) {
      await clearActiveQueueForEmail(email.id);
      const document = JSON.parse(
        existing.rawExtractionJson,
      ) as EmailExtractionDocument;
      return {
        sourceId: existing.id,
        emailId: email.id,
        threadId: email.threadId,
        document,
        counts: {},
        usage: {
          inputTokens: existing.totalInputTokens,
          outputTokens: existing.totalOutputTokens,
          totalTokens: existing.totalInputTokens + existing.totalOutputTokens,
          costUsd: Number(existing.totalCostUsd),
          modelName: existing.modelName,
          calls: [],
        },
        reprocessed: false,
      };
    }
  }

  const queueId = await beginEmailAnalysis(email.id);
  const analysisStartedAt = Date.now();

  try {
  if (input.reprocess) {
    const prior = await db
      .select()
      .from(extractionSources)
      .where(eq(extractionSources.sourceId, email.id));
    for (const row of prior) {
      await deleteExtractionEntities(row.id);
    }
  }

  const skill = await compileSkillPromptSection();
  const registry = await compileRegistryPromptSection();
  const excludedEntitiesSection = await loadEntityExclusionsPromptSection();
  const systemInstruction = buildEmailAnalysisSystemPrompt({
    skillPromptSection: skill.promptSection,
    registryPromptSection: registry.promptSection,
    excludedEntitiesSection,
  });

  const bodyUnique = await preprocessEmailMessage(email.id);
  const thread = await getThreadContext(email.threadId);
  const attachments = await getEmailAttachments(email.id);

  const allCalls: GeminiUsageCall[] = [];
  const partialDocs: EmailExtractionDocument[] = [];

  const bodyPrompt = buildEmailBodyUserPrompt({
    from: email.fromAddress,
    subject: email.subject,
    receivedAt: email.receivedAt,
    bodyTextUnique: bodyUnique,
    threadSubject: thread?.subject,
  });

  const { document: bodyDoc, calls: bodyCalls } = await extractWithGemini({
    systemInstruction,
    userText: bodyPrompt,
    modelName: settings.analysisModel,
    maxOutputTokens: settings.maxOutputTokens,
    step: "email_body",
  });

  partialDocs.push(bodyDoc);
  allCalls.push(...bodyCalls);

  for (const attachment of attachments) {
    if (!attachment.gmailAttachmentId) continue;

    let bytes: Buffer;
    let contentHash: string;
    let mimeType = attachment.mimeType;
    let filename = attachment.filename;

    if (attachment.contentHash && attachment.cachedFilePath) {
      contentHash = attachment.contentHash;
      const ext = attachment.cachedFilePath.match(/\.[^.]+$/)?.[0] ?? ".bin";
      const cached = await readCachedAttachment(contentHash, ext);
      if (!cached) {
        const downloaded = await downloadEmailAttachment({
          attachmentId: attachment.id,
          emailId: email.id,
        });
        bytes = downloaded.bytes;
        contentHash = downloaded.contentHash;
        mimeType = downloaded.mimeType;
        filename = downloaded.filename;
      } else {
        bytes = cached;
      }
    } else {
      const downloaded = await downloadEmailAttachment({
        attachmentId: attachment.id,
        emailId: email.id,
      });
      bytes = downloaded.bytes;
      contentHash = downloaded.contentHash;
      mimeType = downloaded.mimeType;
      filename = downloaded.filename;
    }

    const nowIso = new Date().toISOString();

    const cachedHasValue = await findHasValueByContentHash(contentHash);
    if (cachedHasValue !== null && !input.reprocess) {
      await db
        .update(emailAttachments)
        .set({
          contentHash,
          processedAt: nowIso,
          hasValue: cachedHasValue,
        })
        .where(eq(emailAttachments.id, attachment.id));

      if (cachedHasValue) {
        const existing = await findExistingAttachmentExtraction(contentHash);
        if (existing) {
          partialDocs.push(
            JSON.parse(existing.rawExtractionJson) as EmailExtractionDocument,
          );
        }
      } else {
        partialDocs.push(minimalLowValueAttachmentDoc(filename));
      }
      continue;
    }

    const existing = await findExistingAttachmentExtraction(contentHash);
    if (existing && !input.reprocess) {
      const existingDoc = JSON.parse(
        existing.rawExtractionJson,
      ) as EmailExtractionDocument;
      const hasValue = attachmentHasValue(existingDoc);

      await db
        .update(emailAttachments)
        .set({
          contentHash,
          processedAt: nowIso,
          hasValue,
        })
        .where(eq(emailAttachments.id, attachment.id));

      partialDocs.push(
        hasValue
          ? existingDoc
          : minimalLowValueAttachmentDoc(filename, existingDoc.attachment_role),
      );
      continue;
    }

    const result = await extractAttachmentDocument({
      bytes,
      mimeType,
      filename,
      subject: email.subject,
      from: email.fromAddress,
      attachmentId: attachment.id,
      modelName: settings.analysisModel,
      maxOutputTokens: settings.maxOutputTokens,
      systemInstruction,
    });
    const attachmentDoc = result.document;
    const hasValue = attachmentHasValue(attachmentDoc);
    allCalls.push(...result.calls);

    partialDocs.push(
      hasValue
        ? attachmentDoc
        : minimalLowValueAttachmentDoc(filename, attachmentDoc.attachment_role),
    );

    await db
      .update(emailAttachments)
      .set({
        contentHash,
        processedAt: nowIso,
        hasValue,
      })
      .where(eq(emailAttachments.id, attachment.id));
  }

  const merged = mergeExtractionDocuments(partialDocs);
  const now = new Date().toISOString();
  const sourceId = randomUUID();
  const processingDurationMs = Date.now() - analysisStartedAt;

  let actionItemsDeduped = 0;
  if (email.threadId && merged.action_items?.length) {
    try {
      const dedup = await semanticDeduplicateIncomingActionItems({
        threadId: email.threadId,
        newItems: merged.action_items,
        modelName: settings.analysisModel,
      });
      merged.action_items = dedup.insertItems;
      allCalls.push(...dedup.calls);
      actionItemsDeduped = dedup.supersedeOpenIds.length;
    } catch (error) {
      console.error("[email-analysis:action-item-dedup]", {
        emailId: email.id,
        threadId: email.threadId,
        error: error instanceof Error ? error.message : "Semantic dedup failed",
      });
    }
  }

  await db.insert(extractionSources).values({
    id: sourceId,
    sourceType: "email_message",
    sourceId: email.id,
    emailThreadId: email.threadId,
    processedAt: now,
    modelName: settings.analysisModel,
    extractionVersion: settings.extractionVersion,
    skillVersionId: skill.skillVersionId,
    contentHash: null,
    rawExtractionJson: JSON.stringify(merged),
    aiUsageJson: serializeAiUsage({ runs: [] }),
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: "0",
    processingDurationMs,
    triggeredByUserId: input.triggeredByUserId ?? null,
  });

  const { counts } = await persistExtractionDocument({
    sourceId,
    emailThreadId: email.threadId,
    document: merged,
  });
  if (actionItemsDeduped) {
    counts.action_items_deduped = actionItemsDeduped;
  }

  if (email.threadId) {
    try {
      const reconciliation = await reconcileThreadActionItems({
        threadId: email.threadId,
        analyzedEmailId: email.id,
        modelName: settings.analysisModel,
      });
      allCalls.push(...reconciliation.calls);
      if (reconciliation.completed || reconciliation.superseded) {
        counts.action_items_reconciled =
          (counts.action_items_reconciled ?? 0) +
          reconciliation.completed +
          reconciliation.superseded;
      }
    } catch (error) {
      console.error("[email-analysis:action-item-reconcile]", {
        emailId: email.id,
        threadId: email.threadId,
        error: error instanceof Error ? error.message : "Reconciliation failed",
      });
    }

    try {
      const crossThreadClosed = await closeCrossThreadCalendarInviteItems({
        emailId: email.id,
      });
      if (crossThreadClosed) {
        counts.action_items_cross_thread_closed =
          (counts.action_items_cross_thread_closed ?? 0) + crossThreadClosed;
      }
    } catch (error) {
      console.error("[email-analysis:action-item-cross-thread]", {
        emailId: email.id,
        error:
          error instanceof Error
            ? error.message
            : "Cross-thread calendar invite closure failed",
      });
    }

    try {
      const entityReconciliation = await reconcileThreadEntities({
        threadId: email.threadId,
        sourceId,
        modelName: settings.analysisModel,
      });
      allCalls.push(...entityReconciliation.calls);
      if (entityReconciliation.afterCount !== entityReconciliation.beforeCount) {
        counts.entities_reconciled =
          (counts.entities_reconciled ?? 0) +
          Math.max(0, entityReconciliation.beforeCount - entityReconciliation.afterCount);
      }
    } catch (error) {
      console.error("[email-analysis:entity-reconcile]", {
        emailId: email.id,
        threadId: email.threadId,
        error: error instanceof Error ? error.message : "Entity reconciliation failed",
      });
    }

    try {
      const equipmentReconciliation = await reconcileThreadEquipment({
        threadId: email.threadId,
        sourceId,
        modelName: settings.analysisModel,
      });
      allCalls.push(...equipmentReconciliation.calls);
      if (equipmentReconciliation.afterCount !== equipmentReconciliation.beforeCount) {
        counts.equipment_reconciled =
          (counts.equipment_reconciled ?? 0) +
          Math.max(
            0,
            equipmentReconciliation.beforeCount - equipmentReconciliation.afterCount,
          );
      }
    } catch (error) {
      console.error("[email-analysis:equipment-reconcile]", {
        emailId: email.id,
        threadId: email.threadId,
        error:
          error instanceof Error
            ? error.message
            : "Equipment reconciliation failed",
      });
    }

    try {
      const calendarReconciliation = await reconcileThreadCalendar({
        threadId: email.threadId,
        modelName: settings.analysisModel,
      });
      allCalls.push(...calendarReconciliation.calls);
      if (calendarReconciliation.afterCount !== calendarReconciliation.beforeCount) {
        counts.calendar_reconciled =
          (counts.calendar_reconciled ?? 0) +
          Math.max(
            0,
            calendarReconciliation.beforeCount - calendarReconciliation.afterCount,
          );
      }
    } catch (error) {
      console.error("[email-analysis:calendar-reconcile]", {
        emailId: email.id,
        threadId: email.threadId,
        error:
          error instanceof Error
            ? error.message
            : "Calendar reconciliation failed",
      });
    }

    try {
      const additionalEmailsDetected = await detectAdditionalContactEmailsForThread({
        threadId: email.threadId,
        sourceId,
      });
      if (additionalEmailsDetected) {
        counts.additional_emails_detected =
          (counts.additional_emails_detected ?? 0) + additionalEmailsDetected;
      }
    } catch (error) {
      console.error("[email-analysis:additional-email-detect]", {
        emailId: email.id,
        threadId: email.threadId,
        error:
          error instanceof Error
            ? error.message
            : "Additional email detection failed",
      });
    }
  }

  const totalInput = allCalls.reduce((s, c) => s + c.inputTokens, 0);
  const totalOutput = allCalls.reduce((s, c) => s + c.outputTokens, 0);
  const costUsd = estimateCostUsdForCalls(allCalls);

  console.info("[email-analysis:complete]", {
    emailId: email.id,
    subject: email.subject,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    costUsd,
    processingDurationMs,
    modelName: settings.analysisModel,
  });

  await db
    .update(extractionSources)
    .set({
      aiUsageJson: serializeAiUsage({
        runs: allCalls.map((call) => ({
          id: randomUUID(),
          kind: "email_analysis" as const,
          label: call.step,
          ranAt: now,
          modelName: call.modelName,
          inputTokens: call.inputTokens,
          outputTokens: call.outputTokens,
          totalTokens: call.totalTokens,
          costUsd: estimateCostUsdForCalls([call]),
        })),
      }),
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCostUsd: String(costUsd),
    })
    .where(eq(extractionSources.id, sourceId));

  const skillUpdates = await mergeSkillProposals({
    discoveredFacts: merged.discovered_facts,
    proposedNewConcepts: merged.proposed_new_concepts,
    emailId: email.id,
    sourceId,
  });
  if (skill.tokenEstimate || skillUpdates.created || skillUpdates.updated) {
    console.info("[email-analysis:skill]", {
      emailId: email.id,
      skillVersion: skill.skillVersionNumber,
      skillPromptTokens: skill.tokenEstimate,
      includedSkillEntries: skill.includedEntryCount,
      skillUpdates,
    });
  }

  await db
    .update(emails)
    .set({ processedAt: now })
    .where(eq(emails.id, email.id));

  await completeEmailAnalysis(queueId);

  return {
    sourceId,
    emailId: email.id,
    threadId: email.threadId,
    document: merged,
    counts,
    usage: {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      costUsd,
      modelName: settings.analysisModel,
      calls: allCalls,
    },
    reprocessed: Boolean(input.reprocess),
  };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed.";
    await failEmailAnalysis(queueId, message);
    throw error;
  }
}

export async function analyzeEmailBatch(input: {
  emailIds: string[];
  reprocess?: boolean;
  triggeredByUserId?: string | null;
}): Promise<AnalyzeEmailResult[]> {
  await enqueueEmailsAnalysisPending(input.emailIds);

  const results: AnalyzeEmailResult[] = [];
  for (const emailId of input.emailIds) {
    results.push(
      await analyzeEmail({
        emailId,
        reprocess: input.reprocess,
        triggeredByUserId: input.triggeredByUserId,
      }),
    );
  }
  return results;
}

export async function analyzeAllUnprocessed(input: {
  reprocess?: boolean;
  limit?: number;
  triggeredByUserId?: string | null;
}): Promise<AnalyzeEmailResult[]> {
  const db = getDb();
  const rows = await db.select({ id: emails.id }).from(emails).limit(input.limit ?? 10_000);
  const unprocessed = [];
  for (const row of rows) {
    const [email] = await db.select().from(emails).where(eq(emails.id, row.id));
    if (email && (!email.processedAt || input.reprocess)) {
      unprocessed.push(email.id);
    }
  }
  return analyzeEmailBatch({
    emailIds: unprocessed,
    reprocess: input.reprocess,
    triggeredByUserId: input.triggeredByUserId,
  });
}

/** Classify a single stored attachment and persist has_value (for backfill). */
export async function classifyEmailAttachmentHasValue(input: {
  attachmentId: string;
  emailId: string;
}): Promise<boolean> {
  const db = getDb();
  const settings = await getAnalysisSettings();
  const skill = await compileSkillPromptSection();
  const registry = await compileRegistryPromptSection();
  const excludedEntitiesSection = await loadEntityExclusionsPromptSection();
  const systemInstruction = buildEmailAnalysisSystemPrompt({
    skillPromptSection: skill.promptSection,
    registryPromptSection: registry.promptSection,
    excludedEntitiesSection,
  });

  const [attachment] = await db
    .select()
    .from(emailAttachments)
    .where(eq(emailAttachments.id, input.attachmentId));

  if (!attachment?.gmailAttachmentId) {
    throw new Error("Attachment is missing Gmail attachment id.");
  }

  const [email] = await db
    .select()
    .from(emails)
    .where(eq(emails.id, input.emailId));

  if (!email) {
    throw new Error("Email not found.");
  }

  let bytes: Buffer;
  let contentHash: string;
  let mimeType = attachment.mimeType;
  let filename = attachment.filename;

  if (attachment.contentHash && attachment.cachedFilePath) {
    contentHash = attachment.contentHash;
    const ext = attachment.cachedFilePath.match(/\.[^.]+$/)?.[0] ?? ".bin";
    const cached = await readCachedAttachment(contentHash, ext);
    if (!cached) {
      const downloaded = await downloadEmailAttachment({
        attachmentId: attachment.id,
        emailId: email.id,
      });
      bytes = downloaded.bytes;
      contentHash = downloaded.contentHash;
      mimeType = downloaded.mimeType;
      filename = downloaded.filename;
    } else {
      bytes = cached;
    }
  } else {
    const downloaded = await downloadEmailAttachment({
      attachmentId: attachment.id,
      emailId: email.id,
    });
    bytes = downloaded.bytes;
    contentHash = downloaded.contentHash;
    mimeType = downloaded.mimeType;
    filename = downloaded.filename;
  }

  const cachedHasValue = await findHasValueByContentHash(contentHash);
  if (cachedHasValue !== null) {
    await db
      .update(emailAttachments)
      .set({
        contentHash,
        processedAt: new Date().toISOString(),
        hasValue: cachedHasValue,
      })
      .where(eq(emailAttachments.id, attachment.id));
    return cachedHasValue;
  }

  const result = await extractAttachmentDocument({
    bytes,
    mimeType,
    filename,
    subject: email.subject,
    from: email.fromAddress,
    attachmentId: attachment.id,
    modelName: settings.analysisModel,
    maxOutputTokens: settings.maxOutputTokens,
    systemInstruction,
  });
  const hasValue = attachmentHasValue(result.document);

  await db
    .update(emailAttachments)
    .set({
      contentHash,
      processedAt: new Date().toISOString(),
      hasValue,
    })
    .where(eq(emailAttachments.id, attachment.id));

  return hasValue;
}
