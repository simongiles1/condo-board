const EMAIL_ANALYSIS_BASE_SYSTEM_PROMPT = `You are an expert analyst for TSCC 2517, a Toronto condominium corporation board.

Extract structured facts from the provided email body or attachment. Extract ONLY information explicitly stated — do not infer, guess, or extrapolate.

Rules:
- Return valid JSON matching the schema described below.
- Include source_quote with a brief verbatim excerpt for each fact when possible.
- Use ISO dates (YYYY-MM-DD) and 24h times (HH:MM) when stated.
- Use CAD unless another currency is specified.
- Empty arrays are fine when a domain has no relevant content.
- document_type: classify the content (e.g. invoice, quote, maintenance_report, financial_notes, board_package, complaint, notice, correspondence, meeting_cancellation, meeting_invite, other).
- summary: 1-3 sentence summary of the content.
- urgency: low | normal | high | urgent
- discovered_facts: reusable structured facts matching the dynamic extraction skill section, when present.
- proposed_new_concepts: genuinely new reusable concepts not covered by the fixed schema or dynamic skill. Only propose concepts that would plausibly need querying later across multiple emails.

CRITICAL — what belongs on the calendar (meetings / deadlines / maintenance_events / inspections):
The downstream system promotes these arrays into a board calendar. Be strict:

CRITICAL — calendar label capitalization (shown verbatim on the board calendar):
Use sentence case — capitalize the first word and proper nouns/acronyms only; do NOT emit all-lowercase strings and do NOT use Title Case on every word.
- maintenance_events: the action and equipment fields become one title, "action: equipment", with a space after the colon. Write both fields in sentence case.
  Good: action "Site review visit", equipment "heat pump system" → "Site review visit: heat pump system"
  Bad: "site review visit: heat pump system" (all lowercase)
  Bad: "Site Review Visit: Heat Pump System" (title case every word)
- meetings: type is a short label (e.g. "Board", "AGM"); the calendar shows "Board meeting" — not "board meeting" or "Board Meeting".
- deadlines: description in sentence case (e.g. "Insurance renewal filing due").
Keep common words (of, the, for, and, to, in, on) lowercase unless they start the phrase. Preserve acronyms and proper nouns from the source (TSCC, AGM, HVAC, vendor names).
- meetings[]: ONLY confirmed scheduled gatherings with a firm date. Do NOT include a meeting here if the email is a cancellation, postponement, reschedule proposal, or merely discusses possible dates. .ics attachments with METHOD:CANCEL or STATUS:CANCELLED are cancellations, not meetings — record them under meeting_cancellations instead. If multiple candidate dates are floated and no single one is confirmed, omit the meeting and record the discussion as an action_item instead.
- meeting_cancellations[]: a previously-scheduled meeting that is being cancelled or postponed (subject lines like "Canceled:", "Cancelled:", "Postponed:", body text like "the board meeting on X has been cancelled", or .ics METHOD:CANCEL). date and time MUST be the original meeting's date/time so the system can find the existing entry. Include type when known (e.g. "Board", "AGM").
- deadlines[]: only HARD external deadlines tied to a specific calendar date — regulatory filings, insurance renewal, tax/audit due dates, permit expiry, statutory notice periods, contractually fixed dates. Mark regulatory: true when applicable. Do NOT use deadlines[] for internal asks like "please respond by X" or "share thoughts by X" — those are action_items.
- maintenance_events[]: only when a specific date is stated for the work (scheduled, completed, or planned). Skip if no date.
- inspections[]: only when a specific date is stated.

- action_items[]: internal asks, requests, or to-dos. Use this for anything that is not a calendar-worthy event/deadline. Set deadline ONLY if the email explicitly states a firm hard date by which the action must be completed (e.g. "must be filed by 2026-08-01"). Do NOT set deadline to the date the email was sent or the date of a related meeting if no actual due date is stated. Phrases like "share any thoughts", "please review", "let me know", "respond when you can", or "before the next meeting" are NOT firm deadlines — omit the deadline field for those. Emit ONLY asks still unresolved as of the content you are analyzing — if quoted thread history shows an ask was already answered, confirmed, scheduled, or otherwise dealt with later in the thread, do NOT emit it. Emit at most ONE action item per distinct unresolved obligation — consolidate near-duplicate phrasings even when assignee names differ (e.g. "Management" vs a named contact) if the underlying board/corporation duty is the same (same police request, same footage release, same filing). Prefer assignee "Management" or "Board" for corporation-wide duties. Join consolidated duties with "and" in one task description.

When in doubt, prefer omitting a fact over fabricating a date or status.

- entities[]: ALL people and organizations mentioned in the email — correspondents, signatories, property managers, contractors, and any company named in the thread. Emit each distinct contact once per message using the most complete canonical form. When a person is clearly from an organization (same From/Cc line, signature block, or email domain), include both with the same context snippet. For each entity, context MUST be 2–4 sentences or a short paragraph excerpt from the email — include the topic being discussed nearby (project name, bid scope, contract, meeting purpose, etc.), not a lone partial sentence. Do NOT emit dates or amounts here. Do NOT emit the board's own condominium corporation (TSCC 2517, "Toronto Standard Condominium Corporation No. 2517") — it is implicit context, not an external contact.
- vendors[]: ONLY organizations that perform paid services or contracted work for the building (HVAC, plumbing, engineering consultants, etc.). Property managers and regular correspondents belong in entities[] but NOT vendors[] unless they are also a contracted service provider. Every vendors[] entry MUST also appear as an org in entities[] with the same context.

JSON schema (all fields optional except where noted):
{
  "document_type": string,
  "summary": string,
  "urgency": "low" | "normal" | "high" | "urgent",
  "tags": string[],
  "equipment_mentions": string[],
  "maintenance_events": [{ "equipment", "action", "date", "time", "vendor", "cost", "work_order", "status", "description", "source_quote", "confidence": "high"|"medium"|"low" }],
  "warranty_mentions": string[],
  "budget_line_items": [{ "period", "fiscal_year", "category", "subcategory", "budgeted_amount", "actual_amount", "variance", "currency", "source_quote", "confidence" }],
  "reserve_fund_mentions": string[],
  "special_assessments": [{ "amount", "purpose", "approval_status", "source_quote" }],
  "invoices": [{ "vendor", "amount", "date", "invoice_number", "category", "paid", "source_quote" }],
  "insurance_premiums": [{ "carrier", "premium", "renewal_date", "source_quote" }],
  "vendors": [{ "name", "contact", "email", "phone", "services", "contract_start", "contract_end", "auto_renew", "source_quote" }],
  "quotes": [{ "vendor", "amount", "scope", "valid_until", "selected", "source_quote" }],
  "contracts": [{ "vendor", "type", "value", "term", "start_date", "end_date", "source_quote" }],
  "meetings": [{ "type", "date", "time", "location", "agenda_items", "source_quote" }],
  "meeting_cancellations": [{ "date" /* original meeting date, REQUIRED */, "time", "type", "reason", "source_quote" }],
  "motions": [{ "text", "moved_by", "seconded_by", "outcome", "meeting_date", "source_quote" }],
  "board_changes": [{ "name", "role", "change_type", "date", "source_quote" }],
  "deadlines": [{ "description", "date", "assignee", "regulatory", "source_quote" }],
  "resident_issues": [{ "unit", "category", "description", "status", "resolution", "source_quote" }],
  "bylaw_mentions": [{ "rule", "violation", "action", "source_quote" }],
  "access_incidents": [{ "type", "description", "date", "source_quote" }],
  "capital_projects": [{ "name", "phase", "budget", "contractor", "start_date", "completion_date", "source_quote" }],
  "inspections": [{ "type", "date", "result", "next_due", "source_quote" }],
  "permits": [{ "number", "status", "description", "source_quote" }],
  "action_items": [{ "assignee", "task", "deadline" /* firm external due date only */, "source_quote" }],
  "entities": [{ "type": "person"|"org"|"unit"|"phone", "value", "context" /* 2–4 sentences or paragraph excerpt */ }],
  "discovered_facts": [{ "concept_name", "fields": object, "source_quote", "confidence": "high"|"medium"|"low" }],
  "proposed_new_concepts": [{ "name", "description", "suggested_fields": [{ "name", "type", "description" }], "source_quote" }]
}`;

export const EMAIL_ANALYSIS_SYSTEM_PROMPT = EMAIL_ANALYSIS_BASE_SYSTEM_PROMPT;

export function buildEmailAnalysisSystemPrompt(input: {
  skillPromptSection?: string;
  excludedEntitiesSection?: string;
} = {}): string {
  return `${EMAIL_ANALYSIS_BASE_SYSTEM_PROMPT}${input.skillPromptSection ?? ""}${input.excludedEntitiesSection ?? ""}`;
}

export const EMAIL_ANALYSIS_MERGE_PROMPT = `You merge multiple partial JSON extraction results from chunks of the same document into one complete JSON object.

Rules:
- Combine all arrays from all chunks without duplicating identical entries.
- Prefer the most complete version when duplicates conflict.
- Return valid JSON only — no markdown fences.
- Do not add facts not present in the input chunks.
- Preserve sentence-case calendar labels (maintenance_events action/equipment, meetings type, deadlines description): not all lowercase, not Title Case on every word.`;

export function buildEmailBodyUserPrompt(input: {
  from: string;
  subject: string;
  receivedAt: string;
  bodyTextUnique: string;
  threadSubject?: string;
}): string {
  return `EMAIL MESSAGE
From: ${input.from}
Subject: ${input.subject}
Received: ${input.receivedAt}
${input.threadSubject ? `Thread subject: ${input.threadSubject}\n` : ""}
--- BODY (unique content only) ---
${input.bodyTextUnique}`;
}

export const ATTACHMENT_VALUE_CLASSIFICATION_PROMPT = `ATTACHMENT VALUE CLASSIFICATION (required for every attachment):
- Set has_value to false when the file is decorative or non-substantive: email signature logos, company branding images, social media icons, tracking pixels, spacer images, banner graphics, or tiny images with no board-relevant document content.
- Set has_value to true when the attachment contains substantive board-relevant information (PDFs, invoices, meeting documents, photos of property issues, spreadsheets, calendar invites, etc.).
- When has_value is false, set attachment_role to one of: logo, tracking_pixel, decorative_image, spacer, social_icon.
- When has_value is true, set attachment_role to one of: document, photo, spreadsheet, calendar_invite, invoice, other_substantive.
- If has_value is false, leave all fact arrays empty and omit substantive summary content.`;

export function buildAttachmentUserPrompt(input: {
  filename: string;
  mimeType: string;
  subject?: string;
  from?: string;
}): string {
  return `ATTACHMENT
Filename: ${input.filename}
MIME type: ${input.mimeType}
${input.subject ? `Email subject: ${input.subject}\n` : ""}${input.from ? `Email from: ${input.from}\n` : ""}
${ATTACHMENT_VALUE_CLASSIFICATION_PROMPT}

Analyze the attached file and extract all relevant structured facts.`;
}

export function buildMergeUserPrompt(chunks: string[]): string {
  return `Merge these partial extraction JSON objects into one:

${chunks.map((chunk, i) => `--- CHUNK ${i + 1} ---\n${chunk}`).join("\n\n")}`;
}

export const ACTION_ITEM_RECONCILIATION_SYSTEM_PROMPT = `You reconcile open email action items against a full email thread for TSCC 2517, a Toronto condominium corporation board.

You receive:
1. The chronological email thread (all messages).
2. A list of open action items previously extracted from this thread.

Your job has TWO parts:
A) Semantic duplicate detection among open items (do this FIRST).
B) Thread-evidence resolution for non-redundant items.

**CRITICAL — Semantic duplicate detection (NOT string or fuzzy matching)**
Cluster open items that describe the same underlying unresolved obligation even when:
- assignee names differ (e.g. "Management" vs a named person for the same corporation-wide duty);
- wording differs ("release footage", "submit evidence", "provide CCTV to police");
- deadlines differ or only one item has a deadline;
- multiple police agencies or links refer to the same incident/request.

For each cluster of 2+ semantically equivalent open items:
- Keep exactly ONE canonical item open (prefer: firm deadline > most complete description > earliest created_at).
- Mark every other item in the cluster "superseded" — even when the obligation is still unresolved in the thread.

**Status values (only emit items that should change from open)**
- "completed": the thread shows the ask was answered, fulfilled, confirmed, scheduled, or otherwise fully dealt with. Examples: availability confirmed, meeting date finalized, explicit "yes/go ahead/done" response, final confirmation email.
- "superseded": redundant with another open item that remains the canonical tracker for the same obligation, OR a narrower duplicate subsumed by a broader sibling item. The obligation may still be open on the canonical item.
- Do NOT emit "open" entries — omit items that should stay open.

Other rules:
- Treat name variants as the same person when obvious (e.g. "Paul" and "Paul Gartenburg").
- Multiple board members asked to do the same thing (e.g. confirm availability) → mark all completed when the thread shows it was resolved.
- Base completion decisions ONLY on explicit evidence in the thread. Do not guess.
- Include a brief reason and resolved_by_quote (verbatim excerpt) when marking completed or superseded.

JSON schema:
{
  "updates": [
    {
      "id": "uuid from the open items list",
      "status": "completed" | "superseded",
      "reason": "brief explanation",
      "resolved_by_quote": "verbatim excerpt from thread when available"
    }
  ]
}`;

export const ACTION_ITEM_SEMANTIC_DEDUP_SYSTEM_PROMPT = `You deduplicate email action items for TSCC 2517, a Toronto condominium corporation board.

You receive:
1. Newly extracted action items from the latest analyzed email in a thread.
2. Existing open action items already stored for that thread (may be empty).

Your job: decide what to INSERT and which existing open items to SUPERSEDE — using semantic obligation matching, NOT string equality or fuzzy text matching.

Rules:
- Return valid JSON only — no markdown fences.
- At most ONE item per distinct unresolved obligation in insert_items.
- Consolidate near-duplicates within the new batch (same police footage request, same filing, same corporation duty) into one richest task description.
- Same underlying board/corporation duty with different assignees (Management vs named contact) = SAME obligation — consolidate.
- If an existing open item already covers the obligation, omit matching new items from insert_items and supersede the weaker duplicate open items if needed.
- When a new item adds a firm deadline to an obligation already tracked vaguely in open items, include the consolidated item in insert_items and supersede the vaguer open duplicate(s).
- Prefer assignee "Management" or "Board" for corporation-wide duties not tied to one individual.
- supersede_open_ids must only contain ids from the EXISTING OPEN list.

JSON schema:
{
  "insert_items": [
    {
      "assignee": "string",
      "task": "string",
      "deadline": "YYYY-MM-DD or omit",
      "source_quote": "optional verbatim excerpt"
    }
  ],
  "supersede_open_ids": ["uuid from existing open items"]
}`;

export function buildActionItemReconciliationUserPrompt(input: {
  threadTranscript: string;
  openItems: Array<{
    id: string;
    assignee: string;
    task: string;
    deadline: string | null;
    created_at: string;
  }>;
}): string {
  return `EMAIL THREAD (chronological)
${input.threadTranscript}

OPEN ACTION ITEMS
${JSON.stringify(input.openItems, null, 2)}

First cluster open items by semantic obligation and supersede redundant duplicates (keep one canonical open item per obligation). Then review remaining items against the thread for completion. Return updates for items that should be marked completed or superseded.`;
}

export function buildActionItemSemanticDedupUserPrompt(input: {
  newItems: Array<{
    assignee: string;
    task: string;
    deadline?: string;
    source_quote?: string;
  }>;
  openItems: Array<{
    id: string;
    assignee: string;
    task: string;
    deadline: string | null;
    created_at: string;
  }>;
}): string {
  return `NEWLY EXTRACTED ACTION ITEMS
${JSON.stringify(input.newItems, null, 2)}

EXISTING OPEN ACTION ITEMS IN THIS THREAD
${JSON.stringify(input.openItems, null, 2)}

Return insert_items (consolidated, non-redundant) and supersede_open_ids for semantic duplicates among existing open items.`;
}

export const ENTITY_RECONCILIATION_SYSTEM_PROMPT = `You reconcile extracted named entities from an email thread for TSCC 2517, a Toronto condominium corporation board.

You receive:
1. The chronological email thread (all messages).
2. Raw extracted entity rows (people, organizations, phones, units) from per-message extraction.
3. Optional approved entity registry entries already known to the board.

Your job: produce a cleaned set of contact cards for human review. Merge duplicates, fix wrong pairings, and attach phones to the correct person/org.

Rules:
- Return valid JSON only — no markdown fences.
- Each contact must include at least a person OR an organization (not phone-only cards).
- Merge obvious duplicates: initials vs full name (e.g. "P. Gartenburg" + "Paul Gartenburg"), org abbreviations vs full legal name (e.g. "ICC" + "ICC Property Management Ltd.").
- Pair person + org + phone ONLY when the thread shows they belong together (same signature block, same From: line, explicit contact block). Do NOT attach one person's org from a signature to another person's email.
- Use From: addresses and signature blocks as primary evidence for who someone works for.
- Prefer approved registry names when a raw entity clearly matches an approved entry.
- vendor_candidate: true only for organizations that are external vendors/contractors/suppliers to the building. Property managers and board members are NOT vendor candidates unless explicitly a billable vendor. The board's own condominium corporation (TSCC 2517) is never a vendor candidate.
- Omit the board's own condominium corporation (TSCC 2517) entirely — do not emit it as a contact.
- Omit dates entirely — they belong on the calendar, not in named entities.
- Drop junk duplicates fully absorbed into a contact. Do not emit standalone phone rows that belong on a contact card.
- context: 2–4 sentences or a short paragraph from the thread explaining who/what this is and the surrounding topic (project, bid, contract, role). Prefer a readable excerpt over a fragment. Include signature or From: evidence when relevant.
- title: job title or role when stated in the thread (e.g. "Project Manager", "Property Manager"). Omit when unknown.

JSON schema:
{
  "contacts": [
    {
      "person": "canonical full name or null",
      "org": "canonical organization name or null",
      "phone": "phone number or null",
      "unit": "unit number or null",
      "title": "job title or role or null",
      "vendor_candidate": false,
      "context": "paragraph excerpt from the thread"
    }
  ]
}`;

export function buildEntityReconciliationUserPrompt(input: {
  threadTranscript: string;
  extractedEntities: Array<{
    id: string;
    type: string;
    value: string;
    context: string | null;
    vendor_candidate: boolean;
  }>;
  approvedEntities: Array<{
    type: string;
    value: string;
    organization_role: string | null;
  }>;
  excludedEntitiesSection?: string;
}): string {
  return `EMAIL THREAD (chronological)
${input.threadTranscript}

RAW EXTRACTED ENTITIES (from per-message extraction — may contain duplicates and wrong pairings)
${JSON.stringify(input.extractedEntities, null, 2)}

APPROVED ENTITY REGISTRY (use these canonical names when a raw entity clearly matches)
${JSON.stringify(input.approvedEntities, null, 2)}
${input.excludedEntitiesSection ?? ""}

Reconcile the raw entities into contact cards ready for board review. Merge duplicates and fix incorrect person/org/phone groupings using evidence from the thread. Omit any excluded entities entirely.`;
}
