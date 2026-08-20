/** Client-safe project-highlight types and helpers (no DB / Gemini imports). */

import { chunkContactHighlightText } from "@/lib/email-analysis/contact-highlight-shared";
import {
  foldProjectNames,
  joinProjectMultiValue,
  mergeProjectMultiValues,
  normalizeProjectNameKey,
  normalizeProjectYearHint,
  splitProjectMultiValue,
} from "@/lib/projects/project-multi-values";

export { chunkContactHighlightText as chunkProjectHighlightText };

export const PROJECT_HIGHLIGHT_TYPES = [
  "project_name",
  "year_hint",
  "phase",
  "contractor",
  "location",
] as const;

export type ProjectHighlightType = (typeof PROJECT_HIGHLIGHT_TYPES)[number];

export type ProjectHighlightExtraction = {
  project_names: string[];
  year_hints: string[];
  phases: string[];
  contractors: string[];
  locations: string[];
};

export type ProjectHighlightSpan = {
  type: ProjectHighlightType;
  text: string;
  start?: number;
  end?: number;
};

export type ProjectTextSegment = {
  text: string;
  type: ProjectHighlightType | null;
};

export const PROJECT_HIGHLIGHT_CLASS: Record<ProjectHighlightType, string> = {
  project_name:
    "rounded-sm bg-orange-200/90 text-orange-950 box-decoration-clone px-0.5",
  year_hint:
    "rounded-sm bg-slate-200/90 text-slate-950 box-decoration-clone px-0.5",
  phase: "rounded-sm bg-sky-200/90 text-sky-950 box-decoration-clone px-0.5",
  contractor:
    "rounded-sm bg-teal-200/90 text-teal-950 box-decoration-clone px-0.5",
  location:
    "rounded-sm bg-lime-200/90 text-lime-950 box-decoration-clone px-0.5",
};

export const PROJECT_HIGHLIGHT_LABELS: Record<ProjectHighlightType, string> = {
  project_name: "Project",
  year_hint: "Year",
  phase: "Phase",
  contractor: "Contractor",
  location: "Location",
};

export function emptyProjectHighlightExtraction(): ProjectHighlightExtraction {
  return {
    project_names: [],
    year_hints: [],
    phases: [],
    contractors: [],
    locations: [],
  };
}

export const PROJECT_SCOPES = [
  "building",
  "multi_unit",
  "unit",
  "unknown",
] as const;

export type ProjectScope = (typeof PROJECT_SCOPES)[number];

export const PROJECT_SCOPE_LABELS: Record<ProjectScope, string> = {
  building: "Building-wide",
  multi_unit: "Multi-unit",
  unit: "Unit",
  unknown: "Unknown",
};

/** Prefix match for firm names: "Applied" vs "Applied System Technology". */
export function isOrgStyleNameMatch(aKey: string, bKey: string): boolean {
  if (!aKey || !bKey) return false;
  if (aKey === bKey) return true;
  const shorter = aKey.length <= bKey.length ? aKey : bKey;
  const longer = aKey.length <= bKey.length ? bKey : aKey;
  const shortTokens = shorter.split(" ").filter(Boolean);
  if (shorter.length < 6 && shortTokens.length < 2) return false;
  return longer.startsWith(`${shorter} `);
}

export function projectNameCollidesWithContractor(
  name: string | null | undefined,
  contractor: string | null | undefined,
): boolean {
  const nameKey = normalizeProjectNameKey(name);
  if (!nameKey) return false;
  for (const firm of splitProjectMultiValue(contractor)) {
    const firmKey = normalizeProjectNameKey(firm);
    if (isOrgStyleNameMatch(nameKey, firmKey)) return true;
  }
  return false;
}

export function projectNameMatchesOrgIdentities(
  name: string | null | undefined,
  orgNameKeys: ReadonlySet<string>,
): boolean {
  const nameKey = normalizeProjectNameKey(name);
  if (!nameKey || orgNameKeys.size === 0) return false;
  if (orgNameKeys.has(nameKey)) return true;
  for (const orgKey of orgNameKeys) {
    if (isOrgStyleNameMatch(nameKey, orgKey)) return true;
  }
  return false;
}

/**
 * Minting gate rules 1–3: a card is a project only when it has a work-name
 * that is not the contractor and not an organization identity.
 */
export function cardPassesNameMintingGate(
  card: Pick<ProjectEntityCard, "name" | "contractor">,
  orgNameKeys: ReadonlySet<string> = new Set(),
): boolean {
  const name = card.name?.trim() ?? "";
  if (!name) return false;
  if (projectNameCollidesWithContractor(name, card.contractor)) return false;
  if (projectNameMatchesOrgIdentities(name, orgNameKeys)) return false;
  return true;
}

export function filterMintedProjectCards(
  cards: ProjectEntityCard[],
  orgNameKeys: ReadonlySet<string> = new Set(),
): ProjectEntityCard[] {
  return cards.filter((card) => cardPassesNameMintingGate(card, orgNameKeys));
}

export function parseProjectScope(raw: unknown): ProjectScope | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "building" || key === "building_wide") return "building";
  if (key === "multi_unit" || key === "multiunit") return "multi_unit";
  if (key === "unit" || key === "unit_specific") return "unit";
  if (key === "unknown") return "unknown";
  return null;
}

const PROJECT_UNIT_REF_RE =
  /\b(?:units?|suites?|apt\.?|apartments?)\s*#?\s*(\d{1,5})\b/gi;

/** Infer scope from location when the model omitted it. */
export function deriveProjectScopeFromLocation(
  location: string | null | undefined,
): ProjectScope | null {
  const parts = splitProjectMultiValue(location);
  if (parts.length === 0) return null;
  const unitIds = new Set<string>();
  for (const part of parts) {
    for (const match of part.matchAll(PROJECT_UNIT_REF_RE)) {
      if (match[1]) unitIds.add(match[1]);
    }
    const clustered = part.match(
      /\bunits?\s+#?(\d{1,5})(?:\s*(?:,|&|and|\/|\+)\s*#?(\d{1,5}))+/i,
    );
    if (clustered) {
      for (const n of part.match(/\d{1,5}/g) ?? []) unitIds.add(n);
    }
  }
  if (unitIds.size >= 2) return "multi_unit";
  if (unitIds.size === 1) return "unit";
  return "building";
}

export function resolveProjectScope(
  card: Pick<ProjectEntityCard, "scope" | "location">,
): ProjectScope | null {
  if (card.scope && card.scope !== "unknown") return card.scope;
  const derived = deriveProjectScopeFromLocation(card.location);
  if (derived) return derived;
  return card.scope ?? null;
}

export function preferProjectScope(
  a: ProjectScope | null | undefined,
  b: ProjectScope | null | undefined,
): ProjectScope | null {
  const left = a ?? null;
  const right = b ?? null;
  if (!left) return right;
  if (!right) return left;
  if (left === right) return left;
  if (left === "unknown") return right;
  if (right === "unknown") return left;
  return left;
}

export function buildProjectHighlightDomainContext(): string {
  return `Domain context: These emails concern Studio 1, a condominium corporation. A PROJECT is a named, time-bounded body of work the Board would put on a tracker: capital/improvement jobs (maglock installation, EV charging, envelope repair, boiler replacement tender), remediation (a flood across units 204/304, stack leak restoration), or a discrete campaign (2026 window cleaning, kitchen stack cleaning, reserve fund study). It is NOT a vendor or contractor company, NOT a person, NOT a single meeting, NOT one to-do ("get three quotes"), NOT a complaint thread with no named job, NOT a one-off missed service call, and NOT the physical asset itself (that is equipment). Vague "we should look at X someday" is not a project. Bid options and component SKUs are not new projects. The project NAME is the work (riser replacement, window cleaning), never the contractor doing it. Location is a specific place in the building (unit 201, ninth floor amenity space, P1, roof, garage, front doors). Never use generic words as a location: building, property, site, condo, premises, facility.`;
}

export function buildProjectHighlightSystemPrompt(): string {
  return `You extract building-project identity fields from a single email excerpt.

${buildProjectHighlightDomainContext()}

Return ONLY valid JSON with this exact shape:
{
  "project_names": string[],
  "year_hints": string[],
  "phases": string[],
  "contractors": string[],
  "locations": string[]
}

Rules:
- Extract only values that literally appear in the excerpt (copy exact substrings as written).
- project_names: names of the WORK as written (e.g. "maglock installation", "EV charging", "window cleaning"). Not person names. Not company or contractor names — those go in contractors[] only.
- year_hints: years or fiscal years tied to a project (e.g. "2024", "FY2025"). Do not emit unrelated dates like a meeting Tuesday.
- phases: planning, tender, quote, in progress, complete, cancelled, on hold — only if written or clearly implied by those words.
- contractors: vendor / contractor firm names attached to the job, as written.
- locations: specific places for the job as written (unit 201, ninth floor amenity space, P1, front doors, roof, garage). Do not extract generic words (building, property, site, condo, premises, facility) or phrases whose only content is those words ("the building", "throughout the building").
- Do not invent values. If none for a field, use [].
- Deduplicate case-insensitively within each array.
- Ignore quoted reply history if somehow present; focus on the given excerpt only.`;
}

export function buildProjectHighlightUserPrompt(highlightedText: string): string {
  return `EMAIL EXCERPT (unique / authored highlight for this message)

---
${highlightedText}
---

Extract project_names, year_hints, phases, contractors, and locations as JSON.`;
}

export function buildProjectHighlightSecondPassSystemPrompt(): string {
  return `You are doing a SECOND PASS over a single email excerpt to find building-project identity fields that were MISSED in the first pass.

${buildProjectHighlightDomainContext()}

Return ONLY valid JSON with this exact shape:
{
  "project_names": string[],
  "year_hints": string[],
  "phases": string[],
  "contractors": string[],
  "locations": string[]
}

Rules:
- You are given the email excerpt AND the first-pass extractions.
- Return ONLY values that literally appear in the excerpt AND were not already found in the first pass.
- Copy exact substrings as written (do not normalize or invent).
- Do not repeat anything already listed in the first-pass JSON (case-insensitive match).
- Do not invent values. If nothing was missed, return empty arrays for every field.
- Deduplicate case-insensitively within each array.
- Ignore quoted reply history if somehow present; focus on the given excerpt only.`;
}

export function buildProjectHighlightSecondPassUserPrompt(
  highlightedText: string,
  priorExtraction: ProjectHighlightExtraction,
): string {
  return `EMAIL EXCERPT (unique / authored highlight for this message)

---
${highlightedText}
---

FIRST-PASS EXTRACTIONS (already found — do not repeat these)
\`\`\`json
${JSON.stringify(priorExtraction, null, 2)}
\`\`\`

Find any missed project_names, year_hints, phases, contractors, and locations. Return ONLY newly found values as JSON.`;
}

function lowerSet(values: string[]): Set<string> {
  return new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean));
}

export function diffProjectHighlightExtractions(
  prior: ProjectHighlightExtraction,
  candidate: ProjectHighlightExtraction,
): ProjectHighlightExtraction {
  const priorNames = lowerSet(prior.project_names);
  const priorYears = lowerSet(prior.year_hints);
  const priorPhases = lowerSet(prior.phases);
  const priorContractors = lowerSet(prior.contractors);
  const priorLocations = lowerSet(prior.locations);

  return {
    project_names: candidate.project_names.filter(
      (v) => !priorNames.has(v.trim().toLowerCase()),
    ),
    year_hints: candidate.year_hints.filter(
      (v) => !priorYears.has(v.trim().toLowerCase()),
    ),
    phases: candidate.phases.filter(
      (v) => !priorPhases.has(v.trim().toLowerCase()),
    ),
    contractors: candidate.contractors.filter(
      (v) => !priorContractors.has(v.trim().toLowerCase()),
    ),
    locations: candidate.locations.filter(
      (v) => !priorLocations.has(v.trim().toLowerCase()),
    ),
  };
}

export function mergeProjectHighlightExtractions(
  parts: ProjectHighlightExtraction[],
): ProjectHighlightExtraction {
  return {
    project_names: asStringArray(parts.flatMap((p) => p.project_names)),
    year_hints: asStringArray(parts.flatMap((p) => p.year_hints)),
    phases: asStringArray(parts.flatMap((p) => p.phases)),
    contractors: asStringArray(parts.flatMap((p) => p.contractors)),
    locations: filterProjectLocations(parts.flatMap((p) => p.locations)),
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

const PROJECT_LOCATION_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "around",
  "across",
  "at",
  "entire",
  "for",
  "in",
  "inside",
  "of",
  "on",
  "or",
  "our",
  "outside",
  "that",
  "the",
  "their",
  "this",
  "throughout",
  "to",
  "whole",
  "within",
  "your",
]);

const PROJECT_GENERIC_LOCATION_TOKENS = new Set([
  "apartment",
  "apartments",
  "area",
  "areas",
  "building",
  "buildings",
  "communities",
  "community",
  "complex",
  "complexes",
  "condo",
  "condominium",
  "condominiums",
  "condos",
  "development",
  "developments",
  "facilities",
  "facility",
  "floor",
  "floors",
  "here",
  "home",
  "house",
  "level",
  "levels",
  "location",
  "locations",
  "onsite",
  "place",
  "places",
  "premises",
  "properties",
  "property",
  "residence",
  "residences",
  "room",
  "rooms",
  "site",
  "sites",
  "space",
  "spaces",
  "suite",
  "suites",
  "there",
  "tower",
  "towers",
  "unit",
  "units",
]);

/** True for unit 201 / ninth floor amenity; false for "building" / "the property". */
export function isSpecificProjectLocation(value: string): boolean {
  const tokens = value
    .trim()
    .toLowerCase()
    .replace(/['\u2019]s\b/g, "")
    .replace(/['\u2019]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !PROJECT_LOCATION_STOPWORDS.has(token));
  if (tokens.length === 0) return false;
  return tokens.some((token) => !PROJECT_GENERIC_LOCATION_TOKENS.has(token));
}

function filterProjectLocations(values: string[]): string[] {
  return asStringArray(values).filter(isSpecificProjectLocation);
}

function filterProjectLocationField(value: string | null): string | null {
  if (!value) return null;
  return joinProjectMultiValue(
    splitProjectMultiValue(value).filter(isSpecificProjectLocation),
  );
}

export function parseProjectHighlightExtraction(
  raw: unknown,
): ProjectHighlightExtraction {
  if (!raw || typeof raw !== "object") {
    return emptyProjectHighlightExtraction();
  }
  const obj = raw as Record<string, unknown>;
  return {
    project_names: asStringArray(obj.project_names),
    year_hints: asStringArray(obj.year_hints),
    phases: asStringArray(obj.phases),
    contractors: asStringArray(obj.contractors),
    locations: filterProjectLocations(asStringArray(obj.locations)),
  };
}

export function parseProjectHighlightJson(text: string): ProjectHighlightExtraction {
  const trimmed = text.trim();
  if (!trimmed) return emptyProjectHighlightExtraction();
  try {
    return parseProjectHighlightExtraction(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return parseProjectHighlightExtraction(
          JSON.parse(trimmed.slice(start, end + 1)),
        );
      } catch {
        return emptyProjectHighlightExtraction();
      }
    }
    return emptyProjectHighlightExtraction();
  }
}

export function toProjectHighlightSpans(
  extraction: ProjectHighlightExtraction,
): ProjectHighlightSpan[] {
  const spans: ProjectHighlightSpan[] = [];
  for (const text of extraction.project_names) {
    spans.push({ type: "project_name", text });
  }
  for (const text of extraction.year_hints) {
    spans.push({ type: "year_hint", text });
  }
  for (const text of extraction.phases) {
    spans.push({ type: "phase", text });
  }
  for (const text of extraction.contractors) {
    spans.push({ type: "contractor", text });
  }
  for (const text of extraction.locations) {
    if (!isSpecificProjectLocation(text)) continue;
    spans.push({ type: "location", text });
  }
  spans.sort((a, b) => b.text.length - a.text.length);
  return spans;
}

export function projectExtractionHasAny(
  extraction: ProjectHighlightExtraction,
): boolean {
  return (
    extraction.project_names.length > 0 ||
    extraction.year_hints.length > 0 ||
    extraction.phases.length > 0 ||
    extraction.contractors.length > 0 ||
    extraction.locations.length > 0
  );
}

export type ProjectEntityCard = {
  name: string | null;
  year_hint: string | null;
  phase: string | null;
  contractor: string | null;
  location: string | null;
  equipment_mentions: string | null;
  scope?: ProjectScope | null;
  aliases?: string[];
};

export type ProjectFingerprintResult = {
  entity_cards: ProjectEntityCard[];
};

export function emptyProjectFingerprintResult(): ProjectFingerprintResult {
  return { entity_cards: [] };
}

export function emptyProjectEntityCard(): ProjectEntityCard {
  return {
    name: null,
    year_hint: null,
    phase: null,
    contractor: null,
    location: null,
    equipment_mentions: null,
    scope: null,
    aliases: [],
  };
}

function nullableTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseProjectAliases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function parseProjectEntityCard(raw: unknown): ProjectEntityCard | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const card: ProjectEntityCard = {
    name: nullableTrimmedString(obj.name),
    year_hint: nullableTrimmedString(obj.year_hint),
    phase: nullableTrimmedString(obj.phase),
    contractor: nullableTrimmedString(obj.contractor),
    location: filterProjectLocationField(nullableTrimmedString(obj.location)),
    equipment_mentions: nullableTrimmedString(obj.equipment_mentions),
    scope: parseProjectScope(obj.scope),
    aliases: parseProjectAliases(obj.aliases),
  };
  if (!cardPassesNameMintingGate(card)) return null;
  card.scope = resolveProjectScope(card);
  return card;
}

export function parseProjectFingerprintResult(
  raw: unknown,
): ProjectFingerprintResult {
  if (!raw || typeof raw !== "object") {
    return emptyProjectFingerprintResult();
  }
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.entity_cards) ? obj.entity_cards : [];
  const entity_cards: ProjectEntityCard[] = [];
  for (const item of list) {
    const card = parseProjectEntityCard(item);
    if (card) entity_cards.push(card);
  }
  return { entity_cards };
}

export function parseProjectFingerprintJson(text: string): ProjectFingerprintResult {
  const trimmed = text.trim();
  if (!trimmed) return emptyProjectFingerprintResult();
  try {
    return parseProjectFingerprintResult(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return parseProjectFingerprintResult(
          JSON.parse(trimmed.slice(start, end + 1)),
        );
      } catch {
        return emptyProjectFingerprintResult();
      }
    }
    return emptyProjectFingerprintResult();
  }
}

export function projectCardDisplayName(card: ProjectEntityCard): string {
  const name = card.name?.trim();
  if (name) {
    const year = normalizeProjectYearHint(card.year_hint);
    return year ? `${name} (${year})` : name;
  }
  return "Unknown project";
}

export function projectEntityCardHasAny(card: ProjectEntityCard): boolean {
  return Boolean(
    card.name ||
      card.year_hint ||
      card.phase ||
      card.contractor ||
      card.location ||
      card.equipment_mentions,
  );
}

/**
 * Option C identity: name plus year when a year is present.
 * "Maglock 2024" and "Maglock 2026" stay separate until a human merges them.
 */
export function projectIdentityKey(card: ProjectEntityCard): string {
  const name = normalizeProjectNameKey(card.name);
  const year = normalizeProjectYearHint(card.year_hint);
  if (name && year) return `name:${name}|year:${year}`;
  if (name) return `name:${name}`;
  if (year) return `year:${year}|empty:${projectCardDisplayName(card).toLowerCase()}`;
  return `empty:${projectCardDisplayName(card).toLowerCase()}`;
}

export type ProjectFingerprintEmailContext = {
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  bodyText: string;
};

export function buildProjectFingerprintSystemPrompt(): string {
  return `You build project fingerprints (entity cards) for building projects mentioned in ONE email message.

${buildProjectHighlightDomainContext()}

Return ONLY valid JSON with this exact shape:
{
  "entity_cards": [
    {
      "name": string | null,
      "year_hint": string | null,
      "phase": string | null,
      "contractor": string | null,
      "location": string | null,
      "equipment_mentions": string | null,
      "scope": "building" | "multi_unit" | "unit" | "unknown" | null
    }
  ]
}

You receive:
1) Header fields for this message (From, To, Cc, Subject)
2) The full body of this single message (not the whole thread)
3) Prior highlight extractions (project names, years, phases, contractors, locations)

Rules:
- Create one entity card per distinct PROJECT you can identify from this message. name is REQUIRED. It must be the work-name, never a company or person.
- Do NOT emit a card when the only identity is a contractor/vendor (those are organizations, harvested separately). Leave contractor on a card that already has a work-name.
- Do NOT emit a card whose name equals or is a shortened form of contractor.
- If the same named job appears with two different years (e.g. maglock 2024 vs maglock 2026), those are TWO cards. Do not collapse them.
- Other fields may be sparse. Fill only fields supported by evidence; leave others null. name must still be present.
- year_hint: a year or fiscal year for THAT job when the email ties one. Do not copy a meeting date.
- location: a specific place (unit 201, ninth floor amenity space, P1, roof). Never "building", "property", "site", or other generic words.
- equipment_mentions: physical systems the job is about (boiler, maglocks), as written. Do not invent registry IDs.
- scope: building = whole building / common element / amenity / roof / garage; multi_unit = two or more named units; unit = a single unit/suite; unknown if not evidenced. Prefer location evidence over guessing.
- Do NOT invent missing pieces.
- Deduplicate: one card per project identity in this message (same name + same year).
- Ignore quoted reply history if somehow present.`;
}

export function buildProjectFingerprintUserPrompt(
  email: ProjectFingerprintEmailContext,
  priorExtraction: ProjectHighlightExtraction,
): string {
  const toLine =
    email.toAddresses.length > 0 ? email.toAddresses.join(", ") : "(none)";
  const ccLine =
    email.ccAddresses.length > 0 ? email.ccAddresses.join(", ") : "(none)";

  return `EMAIL HEADERS (this message only)
From: ${email.fromAddress || "(unknown)"}
To: ${toLine}
Cc: ${ccLine}
Subject: ${email.subject || "(none)"}

EMAIL BODY (this message only)
---
${email.bodyText.trim() || "(empty)"}
---

PRIOR HIGHLIGHT EXTRACTIONS (pass 1 + any pass 2 finds, merged)
\`\`\`json
${JSON.stringify(priorExtraction, null, 2)}
\`\`\`

Build entity_cards fingerprints as JSON.`;
}

export type SourcedProjectEntityCard = ProjectEntityCard & {
  source_email_id: string;
  source_label: string;
};

export function buildProjectFingerprintMergeSystemPrompt(): string {
  return `You merge project fingerprint entity cards from multiple emails in the SAME thread into a unique set of projects.

${buildProjectHighlightDomainContext()}

Return ONLY valid JSON with this exact shape:
{
  "entity_cards": [
    {
      "name": string | null,
      "year_hint": string | null,
      "phase": string | null,
      "contractor": string | null,
      "location": string | null,
      "equipment_mentions": string | null,
      "scope": "building" | "multi_unit" | "unit" | "unknown" | null
    }
  ]
}

You receive a list of entity cards produced per-email (pass 3). The same project often appears multiple times with sparse vs richer fields. You can see the whole thread, so apply the minting gate here.

Minting gate — DROP the card (do not emit it) when:
- name is missing, or name is a company/person, or name equals / is a shortened form of contractor.
- The 3-part boundary test fails on this THREAD:
  1. Multi-step or multi-party: more than a single inbox reply, or a contractor is engaged for a body of work.
  2. Non-routine: not a one-off missed appointment, not a complaint with no named job, not a standing vendor relationship with no current campaign.
  3. Discrete lifecycle: identifiable start / active work / completion — including a scheduled campaign (window cleaning 2026) or remediation (flood in 204/304).
Keep: capital/improvement jobs, multi-unit floods/restoration, discrete cleaning campaigns, reserve fund studies, design/tender work.
Drop: vendor names as projects, noise/vibration complaints with no named job, a contractor who did not show for a service call.

Other merge rules:
- Output ONE card per distinct project identity. name is required.
- Merge when the normalized name matches AND the year matches (including both missing a year).
- NEVER merge two cards that share a name but have different years (maglock 2024 vs maglock 2026 stay separate). A human will merge them later if they are the same initiative.
- When merging, keep non-null fields; prefer the most complete name; keep contractor/location/phase/equipment/scope when any source has it. Do not invent values.
- scope: building / multi_unit / unit / unknown. Prefer a specific value over unknown. Do not invent.
- If two cards have conflicting non-null values for the same field, prefer the longer/more specific value; never invent a compromise.
- Drop empty cards and contractor-only cards.
- Output cards only — no source_email_id / source_label fields.`;
}

export function buildProjectFingerprintMergeUserPrompt(
  cards: SourcedProjectEntityCard[],
): string {
  return `ENTITY CARDS FROM PASS 3 (per-email fingerprints; may contain duplicates across messages)

\`\`\`json
${JSON.stringify(cards, null, 2)}
\`\`\`

Merge into a unique entity_cards list as JSON.`;
}

function preferString(a: string | null, b: string | null): string | null {
  const left = a?.trim() || null;
  const right = b?.trim() || null;
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function preferRicherProjectEntityCard(
  a: ProjectEntityCard,
  b: ProjectEntityCard,
): ProjectEntityCard {
  const aName = a.name?.trim() || null;
  const bName = b.name?.trim() || null;
  const preferB = Boolean(bName && (!aName || bName.length > aName.length));
  const folded = foldProjectNames({
    preferredName: preferB ? bName : aName,
    otherName: preferB ? aName : bName,
    preferredAliases: preferB ? b.aliases : a.aliases,
    otherAliases: preferB ? a.aliases : b.aliases,
  });
  return {
    name: folded.name,
    year_hint: preferString(a.year_hint, b.year_hint),
    phase: preferString(a.phase, b.phase),
    contractor: mergeProjectMultiValues(a.contractor, b.contractor),
    location: filterProjectLocationField(
      mergeProjectMultiValues(a.location, b.location),
    ),
    equipment_mentions: mergeProjectMultiValues(
      a.equipment_mentions,
      b.equipment_mentions,
    ),
    scope: preferProjectScope(
      resolveProjectScope(a),
      resolveProjectScope(b),
    ),
    aliases: folded.aliases,
  };
}

/**
 * Guarantee at most one card per identity key (name + year when present).
 * Same name with different years stay separate.
 */
export function coalesceProjectEntityCards(
  cards: ProjectEntityCard[],
  orgNameKeys: ReadonlySet<string> = new Set(),
): ProjectEntityCard[] {
  const byKey = new Map<string, ProjectEntityCard>();

  for (const card of cards) {
    if (!cardPassesNameMintingGate(card, orgNameKeys)) continue;
    const key = projectIdentityKey(card);
    if (key.startsWith("empty:")) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...card,
        scope: resolveProjectScope(card),
        aliases: [...(card.aliases ?? [])],
      });
      continue;
    }
    byKey.set(key, preferRicherProjectEntityCard(existing, card));
  }

  return [...byKey.values()];
}

/**
 * Unique project cards for a harvest badge. Falls back to named spans so
 * phase/location marks are not counted as extra projects.
 */
export function uniqueProjectHarvestCount(
  cards: ProjectEntityCard[],
  extraction: ProjectHighlightExtraction,
): number {
  const unique = coalesceProjectEntityCards(cards);
  if (unique.length > 0) return unique.length;
  const contractorKeys = new Set(
    extraction.contractors.map((value) => normalizeProjectNameKey(value)),
  );
  return extraction.project_names.filter((name) => {
    const key = normalizeProjectNameKey(name);
    if (!key) return false;
    if (contractorKeys.has(key)) return false;
    for (const firm of contractorKeys) {
      if (isOrgStyleNameMatch(key, firm)) return false;
    }
    return true;
  }).length;
}
