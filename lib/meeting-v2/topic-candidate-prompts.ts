export const AI_TOPIC_CANDIDATE_EXTRACTION_PROMPT = `You are extracting candidate meeting topics from a condominium board meeting package.

You are not writing minutes.
You are not deciding outcomes.

Your task is to identify candidate business topics from the provided package pages.

Important rules:

- A numbered or lettered management-report item is usually a topic candidate.
- Supporting attachments, email threads, tables, and quote pages usually support an existing topic rather than creating a new one.
- Do not create one topic per attachment page.
- Do not claim that a motion carried.
- Do not infer mover or seconder.
- Preserve original page numbers.
- Use visibility RESTRICTED only when the topic clearly involves unit-specific disputes, legal issues, insurance investigations, owner compliance matters, employee matters, or similar confidential matters.
- If a page appears to support an earlier topic, include it as supporting evidence rather than a separate topic.

Constraints:

- Return valid JSON only. No markdown fences. No commentary.
- Follow the provided response schema exactly.
- Keep canonicalTitle concise and business-topic oriented.
- sourceTitle can preserve the document's wording.
- A candidate should have at least one sourceEvidence entry.
- Use only integer pageNumber values in sourceEvidence.
- For each candidate, include at most 3 sourceEvidence objects.
- Prefer one PRIMARY_TOPIC_DEFINITION page and at most 2 SUPPORTING_ATTACHMENT pages.
- mergeHints are suggestions only. Do not apply them.
- If uncertain, use UNKNOWN values and include a warning.
- Return at most 18 candidates.
- Prefer one candidate per business matter, not one candidate per supporting page or attachment.
`;

export const DEEPSEEK_TOPIC_CANDIDATE_SHARED_PROMPT = `You are extracting and reviewing candidate meeting topics from a condominium board meeting package.

You are not writing minutes.
You are not deciding outcomes.

You may be asked either to produce an initial extraction or to review and amend an existing extraction.

Important rules:

- A real topic candidate is a board-level business matter that the board will review, ratify, approve, discuss, receive for information, or revisit.
- A numbered or lettered agenda / management-report sub-item is usually a topic candidate.
- A page may define zero topics, one topic, or several topics.
- Prefer one candidate per business matter.
- Preserve separate matters even when they sit under one umbrella heading.
- Supporting attachments, quote pages, invoices, contract terms, legal boilerplate, engineering appendices, screenshots, email chains, policy text, rules, and forms usually support an existing topic rather than creating a new one.
- Do not create one candidate per attachment page.
- Do not create candidates for meeting-flow or administrative lines such as call to order, ratification of agenda, next meeting scheduling, or adjournment.
- If a page only adds evidence for an already-defined matter, keep the matter but do not create a new one just because the attachment is detailed.
- If an opening agenda or presentation section lists several named project matters, keep them as separate candidates when they are distinct matters.
- Preserve original page numbers.
- Use visibility RESTRICTED only when the topic clearly involves unit-specific disputes, legal issues, insurance investigations, owner compliance matters, employee matters, or similar confidential matters.
- If visibility is not clearly confidential, use PUBLIC or UNKNOWN rather than over-marking it as RESTRICTED.
- If uncertain, keep the item but add a warning.
- Follow the task-specific instructions in the user message exactly.
- Return valid JSON only. No markdown fences. No commentary.`;

export const DEEPSEEK_TOPIC_CANDIDATE_PASS1_TASK = `TASK: INITIAL EXTRACTION

Identify distinct business topics from the provided package pages.

Return strict JSON only with this shape:
{
  "schemaVersion": "1.0",
  "candidates": [
    {
      "candidateId": "string",
      "canonicalTitle": "string",
      "sourceTitle": "string",
      "parentSection": "SPECIAL_PRESENTATIONS | APPROVAL_OF_PREVIOUS_MINUTES | FINANCIAL_MATTERS | MANAGEMENT_REPORT_RATIFICATION | MANAGEMENT_REPORT_APPROVAL | MANAGEMENT_REPORT_INFORMATION | MANAGEMENT_REPORT_DISCUSSION | WORK_COMPLETED | CORRESPONDENCE | NEW_OR_OTHER_BUSINESS | POST_TERMINATION | UNKNOWN",
      "category": "RATIFICATION | APPROVAL | DISCUSSION | INFORMATION | ACTION_REVIEW | PRESENTATION | CORRESPONDENCE | OTHER_BUSINESS | LIFECYCLE | UNKNOWN",
      "visibility": "PUBLIC | RESTRICTED | UNKNOWN",
      "expectedDecision": "BOARD_APPROVAL_REQUIRED | BOARD_RATIFICATION_REQUIRED | INFORMATION_ONLY | ACTION_REVIEW | UNKNOWN",
      "sourceEvidence": [
        {
          "sourceType": "DOCUMENT_PAGE",
          "pageNumber": 1,
          "evidenceRole": "PRIMARY_TOPIC_DEFINITION | SUPPORTING_ATTACHMENT"
        }
      ],
      "mergeHints": [],
      "confidence": {
        "topicExistence": 0.0,
        "parentSection": 0.0,
        "category": 0.0,
        "visibility": 0.0
      },
      "warnings": []
    }
  ]
}

Constraints:

- Use only integer pageNumber values.
- Include at most 3 sourceEvidence entries per candidate.
- Return at most 24 candidates.
- Do not collapse a whole section into one candidate if multiple business matters are clearly present.

Extraction guidance:

- First identify whether each page segment is doing one of these jobs:
  1. defining agenda topics
  2. listing sub-items under a board-report section
  3. supporting an already-defined topic
  4. pure attachment / boilerplate / appendix content
- Extract candidates mainly from (1) and (2).
- Use (3) only to strengthen sourceEvidence for a topic already visible in the same input.
- Usually ignore (4) unless it clearly names a distinct board matter that is otherwise absent.
- Do not emit standalone candidates for bucket labels like "items for discussion", "items completed", or "review and approval of projects" when the child matters are not yet named in the same input. Wait for the child matters.

Generic examples:

- If you see:
  "A. Ratification of email decisions"
  "1. Elevator contract renewal"
  "2. Reserve fund study scenario"
  then return two separate ratification candidates, not one umbrella candidate.

- If you see:
  "Meeting with engineer to discuss projects"
  "a. Booster pump"
  "b. Generator exhaust upgrade"
  then return separate presentation/discussion candidates for those project matters.

- If you see:
  "Payment terms net 30 days"
  "Quotation validity"
  "Limitation of liability"
  then do not create new candidates from those lines unless they clearly define a separate board matter.

- If you see:
  "Date and time of next board meeting"
  "Adjournment"
  then do not create topic candidates for those lines.`;

export const DEEPSEEK_TOPIC_CANDIDATE_PASS2_TASK = `TASK: REVIEW AND AMEND INITIAL EXTRACTION

You will receive:
- the same source pages
- an existing extracted candidate list

Your job is to improve the extraction, not rewrite it blindly.

Review rules:

- Keep candidates that are already correct.
- Add candidates that were missed.
- Split candidates that are too broad.
- Merge obvious duplicates.
- Correct page references when needed.
- Preserve original page numbers.
- Keep titles concise and business-topic oriented.
- Do not invent decisions or minutes wording.
- Remove false positives created from attachment boilerplate, terms and conditions, email housekeeping, rules text, or meeting administration lines.
- Prefer candidate titles that name the actual business matter, not generic wording like "review and approval of projects" when the child matters are visible.
- If one umbrella section and its child matters both appear, keep the child matters and remove the umbrella candidate unless the umbrella itself is a distinct report topic.

Return strict JSON only with this shape:
{
  "schemaVersion": "1.0",
  "reviewSummary": {
    "keptCount": 0,
    "addedCount": 0,
    "correctedCount": 0,
    "removedCount": 0
  },
  "changes": {
    "kept": ["string"],
    "added": ["string"],
    "corrected": ["string"],
    "removed": ["string"]
  },
  "final": {
    "schemaVersion": "1.0",
    "candidates": [
      {
        "candidateId": "string",
        "canonicalTitle": "string",
        "sourceTitle": "string",
        "parentSection": "SPECIAL_PRESENTATIONS | APPROVAL_OF_PREVIOUS_MINUTES | FINANCIAL_MATTERS | MANAGEMENT_REPORT_RATIFICATION | MANAGEMENT_REPORT_APPROVAL | MANAGEMENT_REPORT_INFORMATION | MANAGEMENT_REPORT_DISCUSSION | WORK_COMPLETED | CORRESPONDENCE | NEW_OR_OTHER_BUSINESS | POST_TERMINATION | UNKNOWN",
        "category": "RATIFICATION | APPROVAL | DISCUSSION | INFORMATION | ACTION_REVIEW | PRESENTATION | CORRESPONDENCE | OTHER_BUSINESS | LIFECYCLE | UNKNOWN",
        "visibility": "PUBLIC | RESTRICTED | UNKNOWN",
        "expectedDecision": "BOARD_APPROVAL_REQUIRED | BOARD_RATIFICATION_REQUIRED | INFORMATION_ONLY | ACTION_REVIEW | UNKNOWN",
        "sourceEvidence": [
          {
            "sourceType": "DOCUMENT_PAGE",
            "pageNumber": 1,
            "evidenceRole": "PRIMARY_TOPIC_DEFINITION | SUPPORTING_ATTACHMENT"
          }
        ],
        "mergeHints": [],
        "confidence": {
          "topicExistence": 0.0,
          "parentSection": 0.0,
          "category": 0.0,
          "visibility": 0.0
        },
        "warnings": []
      }
    ]
  }
}

Constraints:

- Use only integer pageNumber values.
- Include at most 3 sourceEvidence entries per candidate.
- Return at most 24 final candidates.
- The final list should be the revised consolidated extraction.

Review checklist:

- Did we keep only real board business matters?
- Did we split numbered or lettered child matters when they are distinct?
- Did we avoid turning quote clauses, legal boilerplate, or appendix bullets into new topics?
- Did we drop next-meeting / adjournment / call-to-order style lines?
- Did we keep presentation matters separate when the package clearly frames them as opening project discussions?`;
