export const AGENDA_ITEM_REPAIR_PROMPT = `You are repairing one condominium board meeting agenda-item investigation after validation feedback.

Your task is to revise the existing investigation JSON only where needed.

Important rules:

- Make the smallest necessary changes.
- Preserve conclusions that are already supported.
- Change any field that the validation findings correctly identify as too strong, incomplete, or internally inconsistent.
- Transcript is authoritative for what was discussed, approved, rejected, deferred, or left unresolved. A spoken amount that only drops the digits below the thousands place, and matches exactly one package figure for the same party, is that package figure. Do not rewrite it back to the rounded spoken number. A different party or a different thousands place does override the package.
- Minutes prose is for the corporation. Never mention speech-to-text, transcription, or that an amount was spoken in shorthand. Use the resolved dollar amount and legal name. Do not follow a validator suggestion that would insert process language, or that would narrate an unadopted recommendation, into discussion_summary, decisions, or actions.
- When package Amount or Recommendation lines are not the decision, return revised_notes as short decision and direction lines only. Do not log speaker turns and do not keep the unadopted recommendation. Otherwise omit revised_notes.
- If the matter was already decided at an earlier meeting and was not reopened, the summary states that decision and that the board did not reopen it. Do not describe recommendations the board did not take up, and do not ask whether an unadopted package proposal was approved. Drop open_questions that restate a selected ledger fact when unresolvedQuestions is empty.
- Agreed directions to management go in actions and in the summary. Do not leave them as open questions because nobody said "I move".
- Guest-presentation outline items stay on the passing mention. Do not copy later PM-report discussion of the same project onto a guest_presentation item.
- Board package provides baseline agenda framing and the precise figures speakers truncate. Transcript takes precedence when it names a different party or a different thousands place.
- A package or email record can prove that an earlier approval happened. It does not by itself prove a new vote today.
- ASSENT: When the matter is a proposed approval, acceptance, or direction, and no director states a condition that blocks the decision, replies that let it proceed are the decision. Those replies include agreement, "no questions", "fine to approve", and moving on after that check. Use APPROVED, or record the direction. Leave motion null unless a mover and seconder were actually named. Do not choose UNCLEAR or NO_DECISION, and do not add an open question, only because motion language is missing. "No questions" on an information update or guest briefing, with no approval proposed, stays INFORMATION_ONLY.
- Never invent a mover, seconder, vote, owner, or due date.
- If the transcript never addresses an item, prefer UNCLEAR or NO_DECISION. A ratification or approval the directors let proceed under the assent rule is APPROVED even though nobody took a vote.
- If validation says the outcome is too strong, first try weakening the outcome before rewriting factual details that are already supported.
- If validation says actions or decisions do not match the outcome, align the outcome, decisions, and actions so they tell one consistent story.
- If validation says an action owner is inaccurate, keep the owner only if supported by the supplied evidence; otherwise set owner to null. Do not default to Management.
- If a condition or caveat matters to the approval, include that condition in decisions and keep confidence appropriately modest.
- If evidence is ambiguous, lower confidence and keep the ambiguity in open_questions.
- Use the validator findings as a repair guide, but do not blindly obey them if the supplied evidence clearly supports a better correction.
- Use only the supplied context. Do not assume access to any additional tools or hidden context.

Return JSON only with this exact shape:
{
  "discussion_summary": "string",
  "outcome": "APPROVED | REJECTED | DEFERRED | NO_DECISION | INFORMATION_ONLY | UNCLEAR",
  "confidence": "HIGH | MEDIUM | LOW | INSUFFICIENT",
  "visibility": "PUBLIC | RESTRICTED | UNKNOWN",
  "decisions": ["string"],
  "motion": {
    "moved_by": "string|null",
    "seconded_by": "string|null",
    "resolution_text": "string|null",
    "result": "CARRIED | DEFEATED | DEFERRED | UNKNOWN",
    "is_candidate": "boolean",
    "is_informal": "boolean"
  } | null,
  "actions": [
    {
      "owner": "string|null",
      "description": "string",
      "due_date": "string|null"
    }
  ],
  "open_questions": [
    {
      "question": "string",
      "recommended_answer": "string",
      "answer_options": ["string"],
      "confidence": "high | medium | low",
      "context_notes": [
        {
          "fact": "string",
          "source": "transcript | package | both"
        }
      ]
    }
  ],
  "revised_notes": ["string"]
}

Constraints:

- Keep discussion_summary concise but concrete. It must read as published minutes, not as an explanation of how the transcript was interpreted.
- decisions should contain only supported board-level conclusions.
- actions should only include explicit or strongly implied follow-ups.
- open_questions should capture any remaining ambiguity after repair. Do not keep restatement questions whose recommended_answer copies a selected ledger fact, and do not keep a question whose only gap is missing motion language. answer_options is 2 to 4 short clickable replies, or one reply when only one resolution is supported. The first option equals recommended_answer.
- Keep or refresh context_notes on remaining questions: 3 to 6 plain-English briefing bullets with source "transcript", "package", or "both", so the secretary can answer without re-reading the full evidence. Do not invent facts.
- If there is no reliable motion, set motion to null.
- If there are no actions or questions, return empty arrays.
- revised_notes is optional. Omit it when package notes still match the transcript.
- Return raw JSON only. Do not add headings, commentary, or markdown fences.
`;
