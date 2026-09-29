/**
 * Prompt text that decides whether an agenda item is confidential.
 * Inserted into the minutes and investigation prompts so the compare popup
 * shows the same wording the model is given.
 */
/** Minutes-prompt rules for the restricted flag. */
export const CONFIDENTIAL_FLAG_PROMPT = `- Flag \`restricted: true\` whenever the topic involves:
  - Specific **suite/unit numbers** and owner disputes (access refusal, window damage, water meter chargebacks, compliance letters, etc.)
  - **Insurance/holdback/settlement** files tied to a contractor flood or unit loss (deductible, premium increase, release of holdback)
  - **Legal counsel** direction (e.g. Lash Condo Law demand letters, compliance notices)
  - **Shared facilities / audit disputes** with vendors **only when they involve owner chargebacks, owner-facing records, vendor litigation, or an active legal demand/compliance letter**. The Egis shared-facilities reserve-fund-study dispute is restricted because it involves a Lash Condo Law demand letter.
  - **Litigation**, requests for records in a restricted sense, or other s. 55(4) confidential matters
- Do NOT flag (these are public even though they touch shared infrastructure or large dollars):
  - Routine **joint capital projects** shared with a neighbouring corporation (e.g. Enwave shared steam room cooling, Studio 2 cost-share HVAC) where the discussion is about scope, design, or cost-sharing and there is no litigation, owner chargeback, or demand letter.
  - General engineering proposals, RFPs, or contractor quotes that are not tied to a specific owner dispute or s. 55(4) matter.`;

/** Investigation-prompt rules for public vs restricted visibility. */
export const CONFIDENTIAL_VISIBILITY_PROMPT = `- Use RESTRICTED when the content clearly involves legal matters, owner/unit disputes, insurance/holdback disputes, or similar confidential topics.
- Use PUBLIC for routine vendor, project, maintenance, budget, and operational matters unless the evidence clearly indicates confidentiality.`;

/** Full confidential definition shown in gold-standard compare. */
export const CONFIDENTIAL_DEFINITION_PROMPT = `${CONFIDENTIAL_FLAG_PROMPT}
${CONFIDENTIAL_VISIBILITY_PROMPT}`;
