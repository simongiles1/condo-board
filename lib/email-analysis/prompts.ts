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

action_items[]: internal asks, requests, or to-dos. Use this for anything that is not a calendar-worthy event/deadline. Set deadline ONLY if the email explicitly states a firm hard date by which the action must be completed (e.g. "must be filed by 2026-08-01"). Do NOT set deadline to the date the email was sent or the date of a related meeting if no actual due date is stated. Phrases like "share any thoughts", "please review", "let me know", "respond when you can", or "before the next meeting" are NOT firm deadlines — omit the deadline field for those.

When in doubt, prefer omitting a fact over fabricating a date or status.

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
  "entities": [{ "type": "person"|"org"|"unit"|"date"|"amount", "value", "context" }],
  "discovered_facts": [{ "concept_name", "fields": object, "source_quote", "confidence": "high"|"medium"|"low" }],
  "proposed_new_concepts": [{ "name", "description", "suggested_fields": [{ "name", "type", "description" }], "source_quote" }]
}`;

export const EMAIL_ANALYSIS_SYSTEM_PROMPT = EMAIL_ANALYSIS_BASE_SYSTEM_PROMPT;

export function buildEmailAnalysisSystemPrompt(input: {
  skillPromptSection?: string;
} = {}): string {
  return `${EMAIL_ANALYSIS_BASE_SYSTEM_PROMPT}${input.skillPromptSection ?? ""}`;
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
Analyze the attached file and extract all relevant structured facts.`;
}

export function buildMergeUserPrompt(chunks: string[]): string {
  return `Merge these partial extraction JSON objects into one:

${chunks.map((chunk, i) => `--- CHUNK ${i + 1} ---\n${chunk}`).join("\n\n")}`;
}
