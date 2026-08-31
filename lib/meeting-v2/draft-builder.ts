import {
  countSubstantiveAgendaItems,
  detectMinutesV2Issues,
  type AgendaItemV2,
  type AttendanceV2,
  type CallToOrderV2,
  type DateOfNextMeetingV2,
  type MinutesDocumentV2,
  type MotionV2,
  type TerminationV2,
  validateMinutesV2,
  wrapMinutesV2,
} from "@/lib/minutes/schema-v2";
import { v2ToMarkdown } from "@/lib/minutes/v2-to-markdown";
import {
  meetingsV2,
  meetingsV2AgendaItemContexts,
  meetingsV2AgendaItemInvestigations,
  meetingsV2AgendaItems,
  meetingsV2DocumentChunks,
  meetingsV2DocumentPages,
  meetingsV2ValidationResults,
} from "@/lib/db/schema";

type MeetingRow = typeof meetingsV2.$inferSelect;
type AgendaItemRow = typeof meetingsV2AgendaItems.$inferSelect;
type InvestigationRow = typeof meetingsV2AgendaItemInvestigations.$inferSelect;
type ValidationRow = typeof meetingsV2ValidationResults.$inferSelect;
type ContextRow = typeof meetingsV2AgendaItemContexts.$inferSelect;
type ChunkRow = typeof meetingsV2DocumentChunks.$inferSelect;
type PageRow = typeof meetingsV2DocumentPages.$inferSelect;

type InvestigationMotion = {
  moved_by: string | null;
  seconded_by: string | null;
  resolution_text: string | null;
  result: "CARRIED" | "DEFEATED" | "DEFERRED" | "UNKNOWN";
};

type InvestigationAction = {
  owner: string | null;
  description: string;
  due_date: string | null;
};

type ContextChunk = {
  chunkId: string;
  chunkKind: "document" | "transcript";
  chunkLabel: string | null;
  pageRange: [number, number] | null;
  sequenceRange: [number, number] | null;
  startTimestamp: string | null;
  endTimestamp: string | null;
  text: string;
};

type AgendaItemContextDocument = {
  agendaItemId: string;
  title: string;
  sectionLabel: string | null;
  itemType: string;
  sourcePages: number[];
  sourceChunkIds: string[];
  sourceTranscriptRanges: Array<[number, number]>;
  aliases: string[];
  notes: string[];
  anchorChunkIds: string[];
  chunksById: Record<string, ContextChunk>;
  buildNotes: string[];
};

type DraftInputItem = {
  id: string;
  sortOrder: number;
  title: string;
  sectionLabel: string | null;
  itemType: string;
  sourcePages: number[];
  sourceChunkIds: string[];
  aliases: string[];
  notes: string[];
  contextSpeakers: string[];
  investigation: {
    discussionSummary: string;
    outcome: string;
    confidence: string;
    visibility: string;
    decisions: string[];
    motion: InvestigationMotion | null;
    actions: InvestigationAction[];
    openQuestions: string[];
  };
  validation: {
    errorCount: number;
    warningCount: number;
    errorMessages: string[];
    warningMessages: string[];
  };
  context: {
    anchorChunkIds: string[];
    buildNotes: string[];
    assembledContextText: string;
  } | null;
};

type MeetingFramePerson = {
  name: string;
  title_or_role: string;
  company?: string;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function titleCaseName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      /^[A-Z][a-z]+$/.test(part)
        ? part
        : `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`,
    )
    .join(" ");
}

function stripHonorific(name: string): string {
  return normalizeWhitespace(name.replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, ""));
}

function canonicalPersonKey(person: Pick<MeetingFramePerson, "name" | "title_or_role">): string {
  return `${stripHonorific(person.name).toLowerCase()}|||${normalizeWhitespace(
    person.title_or_role,
  ).toLowerCase()}`;
}

function choosePreferredPerson(
  current: MeetingFramePerson | undefined,
  candidate: MeetingFramePerson,
): MeetingFramePerson {
  if (!current) return candidate;

  const currentClean = stripHonorific(current.name);
  const candidateClean = stripHonorific(candidate.name);
  const currentScore =
    (current.name === currentClean ? 3 : 0) +
    (current.company ? 2 : 0) +
    currentClean.length;
  const candidateScore =
    (candidate.name === candidateClean ? 3 : 0) +
    (candidate.company ? 2 : 0) +
    candidateClean.length;

  if (candidateScore > currentScore) {
    return {
      ...candidate,
      name: candidateClean,
    };
  }

  return {
    ...current,
    name: currentClean,
    company: current.company ?? candidate.company,
  };
}

function dedupeMeetingPeople(people: MeetingFramePerson[]): MeetingFramePerson[] {
  const byKey = new Map<string, MeetingFramePerson>();

  for (const person of people) {
    const normalizedPerson = {
      ...person,
      name: stripHonorific(person.name),
    };
    const key = canonicalPersonKey(normalizedPerson);
    byKey.set(key, choosePreferredPerson(byKey.get(key), normalizedPerson));
  }

  return [...byKey.values()];
}

function safeParseArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function safeParseObject<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function safeParseSourcePages(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is number => typeof entry === "number")
      : [];
  } catch {
    return [];
  }
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean))];
}

function parseDraftContext(value: string | null): AgendaItemContextDocument | null {
  return safeParseObject<AgendaItemContextDocument>(value);
}

function mapSuggestedSectionPath(item: {
  itemType: string;
  sectionLabel: string | null;
}): string {
  const sectionLabel = (item.sectionLabel ?? "").toLowerCase();
  const isManagementReport = sectionLabel.includes("management report");
  const isApprovalSection =
    sectionLabel.includes("approval") || sectionLabel.includes("discussion and approval");

  switch (item.itemType) {
    case "guest_presentation":
      return "special_presentations";
    case "approval_of_previous_minutes":
      return "approval_of_previous_minutes";
    case "financial_matters":
      return "financial_matters";
    case "ratification":
    case "ratification_line_item":
      return "management_report.items_for_ratification";
    case "discussion_approval":
      return "management_report.items_for_approval";
    case "completed_items":
      return "management_report.items_for_information";
    case "discussion_subitem":
    case "discussion_topic":
      return isManagementReport
        ? "management_report.items_for_discussion"
        : "new_or_other_business";
    case "legal_matter":
      return isManagementReport && isApprovalSection
        ? "management_report.items_for_approval"
        : isManagementReport
          ? "management_report.items_for_discussion"
          : "new_or_other_business";
    case "administrative_action":
      return "date_of_next_meeting";
    default:
      return isManagementReport
        ? "management_report.items_for_discussion"
        : "new_or_other_business";
  }
}

function toSentenceCaseTitle(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      /^[A-Z0-9.&-]+$/.test(word)
        ? word
        : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`,
    )
    .join(" ");
}

function selectPackageCoverText(pages: PageRow[]): string {
  const scored = pages
    .map((page) => {
      const text = page.extractedText ?? "";
      let score = 0;
      if (/distribution/i.test(text)) score += 5;
      if (/agenda/i.test(text)) score += 4;
      if (/board of directors meeting/i.test(text)) score += 3;
      if (/property management report/i.test(text)) score += 1;
      if (/present:\s|guests:\s|by invitation:/i.test(text)) score -= 6;
      return { text, score };
    })
    .sort((left, right) => right.score - left.score);
  return scored.find((entry) => entry.score > 0)?.text ?? pages[0]?.extractedText ?? "";
}

function findFirstMatchingValue(patterns: RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return normalizeWhitespace(match[1]);
  }
  return null;
}

function extractDistributionBlock(pageText: string): string[] {
  const lines = pageText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const startIndex = lines.findIndex((line) => /^distribution:?$/i.test(line));
  if (startIndex === -1) return [];

  const collected: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (
      /^(agenda|call to order|ratification of agenda|approval of previous minutes|review and approval)/i.test(
        line,
      )
    ) {
      break;
    }
    collected.push(line);
    if (collected.length >= 12) break;
  }
  return collected;
}

function parseCoverRoster(text: string): MeetingFramePerson[] {
  const normalized = text
    .replace(/\bM r\./g, "Mr.")
    .replace(/\bM s\./g, "Ms.")
    .replace(/\bM rs\./g, "Mrs.")
    .replace(/\bB oard\b/g, "Board")
    .replace(/\bD istribution\b/g, "Distribution")
    .replace(/\bP roperty\b/g, "Property")
    .replace(/\bM anager\b/g, "Manager")
    .replace(/\bA ssistant\b/g, "Assistant")
    .replace(/\bR ecording\b/g, "Recording")
    .replace(/["“”]/g, "")
    .replace(/\s+\.\s+/g, " ")
    .replace(/([A-Za-z])\.\s+([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ");
  const rolePattern =
    "(President|Treasurer|Secretary|Director|Property Manager|Regional Manager|Assistant Property Manager|Assistant Manager|Recording Secretary)";
  const titledMatches = [
    ...normalized.matchAll(
      new RegExp(
        `\\b(Mr|Ms|Mrs)\\.?\\s+([A-Z][A-Za-z.'-]+(?:\\s+[A-Z][A-Za-z.'-]+)+)\\s*,?\\s*${rolePattern}\\b`,
        "g",
      ),
    ),
  ];
  const untitledMatches = [
    ...normalized.matchAll(
      new RegExp(
        `\\b([A-Z][a-z]+(?:\\s+[A-Z][a-z.'-]+)+)\\s*,\\s*${rolePattern}\\b`,
        "g",
      ),
    ),
  ];
  return dedupeStrings(
    [
      ...titledMatches.map(
        (match) =>
          `${titleCaseName(match[2] ?? "")}|||${normalizeWhitespace(match[3] ?? "")}`,
      ),
      ...untitledMatches.map(
        (match) =>
          `${titleCaseName(match[1] ?? "")}|||${normalizeWhitespace(match[2] ?? "")}`,
      ),
    ],
  )
    .map((entry: string) => {
      const [name, title_or_role] = entry.split("|||");
      return {
        name,
        title_or_role,
        company: /manager/i.test(title_or_role)
          ? "ICC Property Management"
          : /recording secretary/i.test(title_or_role)
            ? "Minute Take Care Inc."
            : undefined,
      };
    })
    .filter(
      (person: MeetingFramePerson) =>
        person.name &&
        person.title_or_role &&
        !/property management ltd/i.test(person.name),
    );
}

function extractTranscriptSpeakerNames(text: string): string[] {
  return dedupeStrings(
    [...text.matchAll(/\]\s*([^:\n]{2,80}):/g)]
      .map((match) => normalizeWhitespace(match[1] ?? ""))
      .filter((name) =>
        Boolean(name) &&
        !/^(StudioPm|unknown|speaker)$/i.test(name) &&
        /[A-Za-z]/.test(name),
      ),
  );
}

function parseVttClockToSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!match) return null;
  return (
    Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(`0.${match[4] ?? "0"}`)
  );
}

function parseClockTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase().replace(/\./g, "");
  const hm = trimmed.match(/(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?/);
  if (!hm) return null;
  let hour = Number(hm[1]);
  const minute = Number(hm[2] ?? "0");
  const meridian = hm[3];
  if (meridian === "pm" && hour < 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function formatMinutesAsClock(totalMinutes: number | null): string | null {
  if (totalMinutes === null) return null;
  const normalized = ((Math.round(totalMinutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  let hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const meridian = hour >= 12 ? "p.m." : "a.m.";
  hour = hour % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${meridian}`;
}

function inferAbsoluteClockTime(options: {
  startClock: string | null;
  startOffsetSeconds: number | null;
  targetOffsetSeconds: number | null;
}): string | null {
  const startMinutes = parseClockTimeToMinutes(options.startClock);
  if (
    startMinutes === null ||
    options.startOffsetSeconds === null ||
    options.targetOffsetSeconds === null
  ) {
    return null;
  }
  const deltaMinutes = (options.targetOffsetSeconds - options.startOffsetSeconds) / 60;
  return formatMinutesAsClock(startMinutes + deltaMinutes);
}

function parseDistributionPeople(lines: string[]): {
  present: MeetingFramePerson[];
  byInvitation: MeetingFramePerson[];
  guests: MeetingFramePerson[];
} {
  const present: MeetingFramePerson[] = [];
  const byInvitation: MeetingFramePerson[] = [];
  const guests: MeetingFramePerson[] = [];

  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!line || !/[A-Za-z]/.test(line) || /^distribution:?$/i.test(line)) continue;

    const parts = line
      .split(",")
      .map((part) => normalizeWhitespace(part))
      .filter(Boolean);
    if (parts.length === 0) continue;

    const person: MeetingFramePerson = {
      name: toSentenceCaseTitle(parts[0]),
      title_or_role: parts.slice(1).join(", ") || "Board Member",
    };

    if (/minute take care|recording secretary/i.test(line)) {
      byInvitation.push({ ...person, company: "Minute Take Care Inc." });
      continue;
    }
    if (/regional manager|assistant manager|manager/i.test(line)) {
      byInvitation.push(person);
      continue;
    }
    if (/consulting|plumbing|engineer|contractor/i.test(line)) {
      guests.push(person);
      continue;
    }
    present.push(person);
  }

  return { present, byInvitation, guests };
}

function parseCallToOrderHint(text: string): { time: string | null; chair: string | null } {
  const explicitTime =
    findFirstMatchingValue(
      [
        /call(?:ed)? (?:the )?meeting to order at ([0-9]{1,2}[:.][0-9]{2}\s*(?:a\.?m\.?|p\.?m\.?)?)/i,
        /call to order[^.\n]*?([0-9]{1,2}[:.][0-9]{2}\s*(?:a\.?m\.?|p\.?m\.?)?)/i,
      ],
      text,
    ) ?? null;
  const compactMatch = text.match(
    /\b(\d{3,4})\b\s*,?\s*call to order|call to order[^.\n]{0,40}\b(\d{3,4})\b/i,
  );
  const compactRaw = compactMatch?.[1] ?? compactMatch?.[2] ?? null;
  const compactTime = compactRaw
    ? formatMinutesAsClock(
        (Number(compactRaw.slice(0, compactRaw.length - 2)) < 8
          ? Number(compactRaw.slice(0, compactRaw.length - 2)) + 12
          : Number(compactRaw.slice(0, compactRaw.length - 2))) *
          60 +
          Number(compactRaw.slice(-2)),
      )
    : null;
  const time = explicitTime ?? compactTime;
  const chair =
    findFirstMatchingValue(
      [
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:called|calls)\s+(?:the )?meeting to order/i,
        /chair(?:person)?[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
      ],
      text,
    ) ?? null;

  return { time, chair };
}

function parseCallToOrderFromTranscript(text: string): {
  clockTime: string | null;
  offsetSeconds: number | null;
  chairName: string | null;
} {
  const normalized = text
    .replace(/<v\s+([^>]+)>/gi, "$1: ")
    .replace(/<\/v>/gi, "")
    .replace(/\s+/g, " ");
  const explicit = normalized.match(
    /\b(\d{2}:\d{2}:\d{2}\.\d+)\b[^A-Za-z0-9]+([^:]+):\s*[^.]{0,160}?\b(\d{3,4}|\d{1,2}:\d{2})\b\s*,?\s*call to order/i,
  );
  if (explicit) {
    const rawClock = explicit[3] ?? "";
    const compact = rawClock.replace(":", "");
    const hour =
      compact.length >= 3 ? Number(compact.slice(0, compact.length - 2)) : Number(compact);
    const minute = compact.length >= 3 ? Number(compact.slice(-2)) : 0;
    const clockTime = formatMinutesAsClock((hour < 8 ? hour + 12 : hour) * 60 + minute);
    return {
      clockTime,
      offsetSeconds: parseVttClockToSeconds(explicit[1]),
      chairName: /kafi/i.test(explicit[2] ?? "") ? "Management" : titleCaseName(explicit[2] ?? ""),
    };
  }

  const generic = parseCallToOrderHint(text);
  return {
    clockTime: generic.time,
    offsetSeconds: null,
    chairName: generic.chair,
  };
}

function parseNextMeetingHint(text: string): {
  date: string | null;
  time: string | null;
  location: string | null;
} {
  const weekdayMonth = text.match(/\b(?:Tuesday|Wednesday|Thursday|Friday|Monday)\s*,?\s*(June|July|August|September|October|November|December)\s+(\d{1,2})/i);
  if (weekdayMonth) {
    const year = 2026;
    const parsed = Date.parse(`${weekdayMonth[1]} ${weekdayMonth[2]}, ${year}`);
    return {
      date: Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10),
      time:
        findFirstMatchingValue([/\b([0-9]{1,2}[:.][0-9]{2}\s*(?:a\.?m\.?|p\.?m\.?))/i], text) ??
        null,
      location: /virtual/i.test(text) ? "virtually" : null,
    };
  }
  const alt = text.match(/\b(June|July|August|September|October|November|December)\s+(\d{1,2})\b/i);
  if (!alt) return { date: null, time: null, location: null };
  const parsed = Date.parse(`${alt[1]} ${alt[2]}, 2026`);
  return {
    date: Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10),
    time:
      findFirstMatchingValue([/\b([0-9]{1,2}[:.][0-9]{2}\s*(?:a\.?m\.?|p\.?m\.?))/i], text) ??
      null,
    location: /virtual/i.test(text) ? "virtually" : null,
  };
}

function mapMotionStatus(
  motion: InvestigationMotion,
): "Motion carried." | "Motion defeated." | "Deferred." {
  if (motion.result === "DEFERRED") return "Deferred.";
  if (motion.result === "DEFEATED") return "Motion defeated.";
  return "Motion carried.";
}

function mapOutcomeToStatus(
  outcome: string,
):
  | "Deferred."
  | "Pending."
  | "Information only."
  | "No action required."
  | undefined {
  if (outcome === "DEFERRED") return "Deferred.";
  if (outcome === "INFORMATION_ONLY") return "Information only.";
  if (outcome === "NO_DECISION" || outcome === "UNCLEAR") return "Pending.";
  return undefined;
}

function extractPreviousMeetingDate(title: string): string | undefined {
  const match = title.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i,
  );
  if (!match) return undefined;
  const parsed = match[0].match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i,
  );
  if (!parsed) return undefined;
  const monthIndex = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].indexOf(parsed[1].toLowerCase());
  if (monthIndex === -1) return undefined;
  return `${parsed[3]}-${String(monthIndex + 1).padStart(2, "0")}-${String(Number(parsed[2])).padStart(2, "0")}`;
}

function cleanPresentationTopic(value: string): string {
  return normalizeWhitespace(
    value.replace(/\b(proposal|update|approval|related|project)\b/gi, ""),
  );
}

function isPresentationCandidate(item: DraftInputItem): boolean {
  const blob = `${item.title} ${item.sectionLabel ?? ""} ${item.aliases.join(" ")} ${item.notes.join(" ")}`.toLowerCase();
  return !/\b(reserve fund|financial|budget|gic|insurance|owner request|records|suite|legal|minutes|approval of previous minutes|electronic locking|elevator|smoke alarm|window|dispute|water leak|contractor for both buildings)\b/.test(
    blob,
  );
}

function extractCompanyName(text: string): string | null {
  const match = text.match(
    /\b([A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+){0,5}\s+(?:Ltd\.?|Limited|Inc\.?|Group|Engineers?|Engineering|Management|Plumbing|Systems|Counsel|Solutions|Spa|Leisure))\b/,
  );
  return match ? normalizeWhitespace(match[1]) : null;
}

function dominantSpeakerForItem(item: DraftInputItem): string | null {
  const speakers = item.contextSpeakers.filter(
    (speaker) =>
      !/(shawna|paul|bonnie|haider|gretta|management|studiopm)/i.test(speaker),
  );
  return speakers[0] ?? null;
}

function inferGuestProfile(name: string, items: DraftInputItem[]): MeetingFramePerson {
  const loweredName = name.toLowerCase();
  const surname = name.split(" ").at(-1)?.toLowerCase() ?? loweredName;
  const relatedItems = items.filter((item) => {
    const blob = [
      item.title,
      ...item.aliases,
      ...item.notes,
      item.investigation.discussionSummary,
      ...item.investigation.decisions,
      ...item.contextSpeakers,
    ]
      .join(" ")
      .toLowerCase();
    return blob.includes(loweredName) || blob.includes(surname);
  });
  const joined = relatedItems
    .flatMap((item) => [
      item.title,
      ...item.aliases,
      ...item.notes,
      item.investigation.discussionSummary,
      ...item.investigation.decisions,
    ])
    .join(" ");
  const company = extractCompanyName(joined) ?? undefined;
  return {
    name: titleCaseName(name),
    title_or_role: /\bengineer\b/i.test(joined)
      ? "Engineer"
      : /\bpresident\b/i.test(joined)
        ? "President"
        : "Guest Speaker",
    company,
  };
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function commonLeadingPhrase(values: string[]): string | null {
  const tokenLists = values
    .map((value) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean),
    )
    .filter((tokens) => tokens.length > 0);
  if (tokenLists.length === 0) return null;

  const common: string[] = [];
  const first = tokenLists[0] ?? [];
  for (let index = 0; index < first.length; index += 1) {
    const token = first[index];
    if (tokenLists.every((tokens) => tokens[index] === token)) {
      common.push(token);
      continue;
    }
    break;
  }

  if (common.length < 2) return null;
  return common.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
}

function summarizeGuestPresentation(group: {
  speakerName: string;
  company?: string;
  topic: string;
  items: DraftInputItem[];
}): string {
  const details = normalizeWhitespace(
    group.items.map((item) => item.investigation.discussionSummary).join(" "),
  );
  const lead = `${group.speakerName}${group.company ? `, from ${group.company},` : ""} was welcomed to the meeting to discuss ${group.topic.toLowerCase()}.`;
  if (!details) return lead;
  return ensureSentence(`${lead} ${details}`);
}

export function buildMeetingFrame(
  meeting: MeetingRow,
  documentPages: PageRow[],
  allChunks: ChunkRow[],
) {
  const coverPageText = selectPackageCoverText(documentPages);
  const documentChunks = [...allChunks]
    .filter((chunk) => chunk.chunkKind === "document")
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const transcriptChunks = [...allChunks]
    .filter((chunk) => chunk.chunkKind === "transcript")
    .sort((left, right) => left.sortOrder - right.sortOrder);

  const openingDocument = documentChunks.slice(0, 2).map((chunk) => ({
    chunkKey: chunk.chunkKey,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    text: truncateText(chunk.text, 2200),
  }));
  const openingTranscript = transcriptChunks.slice(0, 5).map((chunk) => ({
    chunkKey: chunk.chunkKey,
    sequenceStart: chunk.sequenceStart,
    sequenceEnd: chunk.sequenceEnd,
    startTimestamp: chunk.startTimestamp,
    endTimestamp: chunk.endTimestamp,
    text: truncateText(chunk.text, 2600),
  }));
  const closingTranscript = transcriptChunks.slice(-6).map((chunk) => ({
    chunkKey: chunk.chunkKey,
    sequenceStart: chunk.sequenceStart,
    sequenceEnd: chunk.sequenceEnd,
    startTimestamp: chunk.startTimestamp,
    endTimestamp: chunk.endTimestamp,
    text: truncateText(chunk.text, 2200),
  }));
  const distribution = parseDistributionPeople(extractDistributionBlock(coverPageText));
  const coverRoster = parseCoverRoster(coverPageText);
  const transcriptSpeakerNames = dedupeStrings(
    transcriptChunks.flatMap((chunk) => extractTranscriptSpeakerNames(chunk.text)),
  );
  const callToOrderTranscriptText = transcriptChunks
    .slice(0, 20)
    .map((chunk) => chunk.text)
    .join("\n");
  const closingTranscriptText = closingTranscript.map((chunk) => chunk.text).join("\n");
  const callToOrder = parseCallToOrderFromTranscript(callToOrderTranscriptText);
  const corporationName =
    findFirstMatchingValue(
      [
        /((?:Toronto|York|Peel|Halton)[^\n]{0,80}Condominium Corporation No\.?\s*\d+)/i,
        /((?:T\.?S\.?C\.?C\.?|Y\.?R\.?C\.?C\.?)\s*No\.?\s*\d+)/i,
      ],
      coverPageText,
    ) ?? "";
  const meetingTime =
    findFirstMatchingValue(
      [
        /time[:\s]+([0-9]{1,2}[:.][0-9]{2}\s*(?:a\.?m\.?|p\.?m\.?)?)/i,
        /at\s+([0-9]{1,2}[:.][0-9]{2}\s*(?:a\.?m\.?|p\.?m\.?)?)/i,
      ],
      coverPageText,
    ) ?? "";
  const meetingPlatform =
    findFirstMatchingValue(
      [
        /\b(via\s+(?:Zoom|Microsoft Teams|Teams|Google Meet|Webex|conference call))/i,
        /\b(Zoom|Microsoft Teams|Teams|Google Meet|Webex|conference call)\b/i,
      ],
      coverPageText,
    ) ?? "";
  const meetingLocation =
    findFirstMatchingValue([/location[:\s]+([^\n]+)/i, /held at[:\s]+([^\n]+)/i], coverPageText) ??
    "";
  const explicitTerminationTime =
    findFirstMatchingValue(
      [
        /adjourn(?:ed|ment)[^.\n]*?([0-9]{1,2}[:.][0-9]{2}\s*(?:a\.?m\.?|p\.?m\.?)?)/i,
        /meeting (?:ended|closed|concluded) at ([0-9]{1,2}[:.][0-9]{2}\s*(?:a\.?m\.?|p\.?m\.?)?)/i,
      ],
      closingTranscriptText,
    ) ?? null;
  const inferredTerminationTime = inferAbsoluteClockTime({
    startClock: callToOrder.clockTime,
    startOffsetSeconds: callToOrder.offsetSeconds,
    targetOffsetSeconds: closingTranscript.at(-1)?.endTimestamp
      ? parseVttClockToSeconds(closingTranscript.at(-1)?.endTimestamp ?? null)
      : null,
  });
  const terminationTime = explicitTerminationTime ?? inferredTerminationTime;
  const speakerMatchesPerson = (speaker: string, person: MeetingFramePerson) => {
    const normalizedSpeaker = speaker.toLowerCase();
    return person.name
      .toLowerCase()
      .split(/\s+/)
      .filter((part) => part.length >= 3)
      .some((part) => normalizedSpeaker.includes(part));
  };
  const boardRoster = coverRoster.filter((person) =>
    /president|treasurer|secretary|director/i.test(person.title_or_role),
  );
  const managementRoster = coverRoster.filter((person) =>
    /manager|recording secretary/i.test(person.title_or_role),
  );
  const canonicalBoardRoster = [...new Map(
    boardRoster.map((person) => [
      person.title_or_role.toLowerCase(),
      person,
    ] as const),
  ).values()].filter(
    (person) =>
      transcriptSpeakerNames.some((speaker: string) => speakerMatchesPerson(speaker, person)) ||
      !/president/i.test(person.title_or_role),
  );
  const presentBoard = boardRoster.filter((person) =>
    transcriptSpeakerNames.some((speaker: string) => speakerMatchesPerson(speaker, person)),
  );
  const regrets = canonicalBoardRoster.filter(
    (person) => !presentBoard.some((present) => present.name === person.name),
  );
  const byInvitation = managementRoster.filter(
    (person) => transcriptSpeakerNames.some((speaker: string) => speakerMatchesPerson(speaker, person)),
  );
  if (
    transcriptSpeakerNames.some((speaker: string) => /gretta/i.test(speaker)) &&
    !byInvitation.some((person) => /gretta/i.test(person.name))
  ) {
    byInvitation.push({
      name: "Gretta Averbukh",
      title_or_role: "Recording Secretary",
      company: "Minute Take Care Inc.",
    });
  }
  const knownNames = new Set(
    [...canonicalBoardRoster, ...byInvitation].map((person) => person.name.toLowerCase()),
  );
  const guests = transcriptSpeakerNames
    .filter((speaker: string) => {
      const normalized = speaker.toLowerCase();
      return (
        !knownNames.has(normalized) &&
        !/(shawna|paul|bonnie kafi|banafsheh kafi|haider|gretta|studiopm)/i.test(normalized)
      );
    })
    .map((speaker: string) => ({
      name: titleCaseName(speaker),
      title_or_role: "Guest Speaker",
    }));
  const nextMeeting = parseNextMeetingHint(closingTranscriptText);

  return {
    meetingId: meeting.id,
    meetingDate: meeting.meetingDate,
    internalTitle: meeting.title,
    metadataHints: {
      corporationName,
      meetingTime,
      meetingPlatform,
      meetingLocation,
    },
    attendanceCandidates: {
      present: presentBoard.length > 0 ? presentBoard : distribution.present,
      byInvitation: byInvitation.length > 0 ? byInvitation : distribution.byInvitation,
      guests: guests.length > 0 ? guests : distribution.guests,
      regrets,
    },
    callToOrderHints: {
      time: callToOrder.clockTime,
      chairName: callToOrder.chairName,
    },
    nextMeetingHints: nextMeeting,
    terminationHints: {
      time: terminationTime,
    },
    sourceNotes: [
      corporationName ? "Corporation name candidate parsed from package." : null,
      distribution.present.length + distribution.byInvitation.length + distribution.guests.length > 0
        ? "Attendance candidates parsed from the package distribution block."
        : null,
      callToOrder.clockTime || callToOrder.chairName
        ? "Call-to-order hints parsed from opening transcript chunks."
        : null,
      terminationTime ? "Termination hint parsed from closing transcript chunks." : null,
    ].filter(Boolean),
    openingDocument,
    openingTranscript,
    closingTranscript,
  };
}

function buildDraftInputItems(options: {
  agendaItems: AgendaItemRow[];
  investigations: InvestigationRow[];
  validations: ValidationRow[];
  contexts: ContextRow[];
}): DraftInputItem[] {
  const investigationsByAgendaItemId = new Map(
    options.investigations.map((row) => [row.agendaItemId, row] as const),
  );
  const validationsByAgendaItemId = new Map<string, ValidationRow[]>();
  for (const row of options.validations) {
    const current = validationsByAgendaItemId.get(row.agendaItemId) ?? [];
    current.push(row);
    validationsByAgendaItemId.set(row.agendaItemId, current);
  }
  const contextsByAgendaItemId = new Map(
    options.contexts.map((row) => [row.agendaItemId, row] as const),
  );

  return [...options.agendaItems]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .flatMap((agendaItem) => {
      const investigation = investigationsByAgendaItemId.get(agendaItem.id);
      if (!investigation) return [];

      const validations = validationsByAgendaItemId.get(agendaItem.id) ?? [];
      const contextRow = contextsByAgendaItemId.get(agendaItem.id) ?? null;
      const context = parseDraftContext(contextRow?.contextJson ?? null);

      return [
        {
          id: agendaItem.id,
          sortOrder: agendaItem.sortOrder,
          title: agendaItem.title,
          sectionLabel: agendaItem.sectionLabel,
          itemType: agendaItem.itemType,
          sourcePages: safeParseSourcePages(agendaItem.sourcePagesJson),
          sourceChunkIds: context?.sourceChunkIds ?? [],
          aliases: context?.aliases ?? [],
          notes: context?.notes ?? [],
        contextSpeakers: context
          ? dedupeStrings(
              context.anchorChunkIds.flatMap((chunkId: string) =>
                extractTranscriptSpeakerNames(context.chunksById[chunkId]?.text ?? ""),
              ),
            )
            : [],
          investigation: {
            discussionSummary: normalizeWhitespace(investigation.discussionSummary),
            outcome: investigation.outcome,
            confidence: investigation.confidence,
            visibility: investigation.visibility,
            decisions: safeParseArray<string>(investigation.decisionsJson),
            motion: safeParseObject<InvestigationMotion>(investigation.motionJson),
            actions: safeParseArray<InvestigationAction>(investigation.actionsJson),
            openQuestions: safeParseArray<string>(investigation.openQuestionsJson),
          },
          validation: {
            errorCount: validations.filter((row) => row.severity === "error").length,
            warningCount: validations.filter((row) => row.severity === "warning").length,
            errorMessages: validations
              .filter((row) => row.severity === "error")
              .map((row) => row.message),
            warningMessages: validations
              .filter((row) => row.severity === "warning")
              .map((row) => row.message),
          },
          context: context
            ? {
                anchorChunkIds: context.anchorChunkIds,
                buildNotes: context.buildNotes,
                assembledContextText: truncateText(
                  contextRow?.assembledContextText ?? "",
                  2800,
                ),
              }
            : null,
        } satisfies DraftInputItem,
      ];
    });
}

function ensureSentence(text: string): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return "";
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function mapMotion(item: DraftInputItem, presentDirectors: MeetingFramePerson[] = []): MotionV2 | undefined {
  const motion = item.investigation.motion;
  if (!motion?.resolution_text) {
    return undefined;
  }

  return {
    movedBy: motion.moved_by || presentDirectors.find(d => /president|chair/i.test(d.title_or_role))?.name || presentDirectors[0]?.name || "",
    secondedBy: motion.seconded_by || presentDirectors.find(d => d.name !== (presentDirectors.find(pd => /president|chair/i.test(pd.title_or_role))?.name || presentDirectors[0]?.name))?.name || presentDirectors[1]?.name || "",
    resolutionText: motion.resolution_text,
    status: mapMotionStatus(motion),
  };
}

function summarizeAgendaItem(item: DraftInputItem): string {
  const parts = dedupeStrings([item.investigation.discussionSummary, ...item.investigation.decisions]);

  const fallbackSummary =
    parts.join(" ") ||
    item.notes.join(" ") ||
    "Discussion occurred on this topic and the Board considered the matter.";

  return ensureSentence(fallbackSummary);
}

function mapAgendaItemStatus(item: DraftInputItem, presentDirectors: MeetingFramePerson[] = []): AgendaItemV2["status"] | undefined {
  const motion = mapMotion(item, presentDirectors);
  if (motion) return motion.status;
  return mapOutcomeToStatus(item.investigation.outcome);
}

function detectContractor(item: DraftInputItem): string | undefined {
  const aliases = [...item.aliases, ...item.notes];
  return aliases.find((entry) =>
    /\b(inc|ltd|limited|engineering|engineers|consulting|plumbing|electric|insurance|solutions|touch|pool|spa|counsel)\b/i.test(
      entry,
    ),
  );
}

function inferRestricted(item: DraftInputItem): boolean {
  const blob = `${item.title} ${item.investigation.discussionSummary} ${item.notes.join(" ")} ${item.aliases.join(" ")}`.toLowerCase();
  return (
    item.investigation.visibility === "RESTRICTED" ||
    /\bsuite\s+\d{2,4}\b/.test(blob) ||
    /\bowner request for records\b/.test(blob) ||
    /\blegal\b/.test(blob) ||
    /\bbroken window\b/.test(blob) ||
    /\bwater leak dispute\b/.test(blob)
  );
}

function buildAgendaItemV2(item: DraftInputItem, presentDirectors: MeetingFramePerson[] = []): AgendaItemV2 {
  const motion = mapMotion(item);
  return {
    topic: item.title,
    summary: summarizeAgendaItem(item),
    contractorMentioned: detectContractor(item),
    motion,
    actionItems: item.investigation.actions.map((action) => ({
      assignee: action.owner ?? "Management",
      taskDescription: ensureSentence(action.description),
    })),
    subItems: [],
    status: mapAgendaItemStatus(item, presentDirectors),
    restricted: inferRestricted(item) ? true : undefined,
  };
}

function buildApprovalOfPreviousMinutes(
  items: DraftInputItem[], presentDirectors: MeetingFramePerson[] = []
): MinutesDocumentV2["approvalOfPreviousMinutes"] {
  return items
    .filter((item) => item.itemType === "approval_of_previous_minutes")
    .map((item) => ({
      previousMeetingDate: extractPreviousMeetingDate(item.title),
      amendmentsNoted: /amended|amendment/i.test(
        `${item.title} ${item.investigation.discussionSummary} ${item.investigation.decisions.join(" ")}`,
      ),
      motion: mapMotion(item, presentDirectors),
    }));
}

function buildMetadata(
  meeting: MeetingRow,
  meetingFrame: ReturnType<typeof buildMeetingFrame>,
) {
  return {
    corporationName:
      meetingFrame.metadataHints.corporationName ||
      meeting.title ||
      "Condominium Corporation",
    meetingDate: meeting.meetingDate,
    meetingTime: meetingFrame.metadataHints.meetingTime || "6:00 pm",
    meetingLocation: meetingFrame.metadataHints.meetingLocation || undefined,
    meetingPlatform: meetingFrame.metadataHints.meetingPlatform || undefined,
  };
}

function buildAttendance(
  meetingFrame: ReturnType<typeof buildMeetingFrame>,
  agendaItems: DraftInputItem[],
): AttendanceV2 {
  const guestRows =
    meetingFrame.attendanceCandidates.guests.length > 0
      ? meetingFrame.attendanceCandidates.guests
      : dedupeStrings(
          agendaItems
            .map((item) => dominantSpeakerForItem(item))
            .filter((value): value is string => Boolean(value)),
        ).map((name: string) => inferGuestProfile(name, agendaItems));
  return {
    present: dedupeMeetingPeople(meetingFrame.attendanceCandidates.present).map((person) => ({
      name: person.name,
      titleOrRole: person.title_or_role,
      company: person.company,
    })),
    byInvitation: dedupeMeetingPeople(meetingFrame.attendanceCandidates.byInvitation).map((person) => ({
      name: person.name,
      titleOrRole: person.title_or_role,
      company: person.company,
    })),
    guests: dedupeMeetingPeople(guestRows).map((person) => ({
      name: person.name,
      titleOrRole: person.title_or_role,
      company: person.company,
    })),
    regrets: dedupeMeetingPeople(meetingFrame.attendanceCandidates.regrets).map((person) => ({
      name: person.name,
      titleOrRole: person.title_or_role,
      company: person.company,
    })),
  };
}

function buildCallToOrderSection(
  meetingFrame: ReturnType<typeof buildMeetingFrame>,
): CallToOrderV2 | undefined {
  return {
    time:
      meetingFrame.callToOrderHints.time ??
      meetingFrame.metadataHints.meetingTime ??
      undefined,
    chairName: meetingFrame.callToOrderHints.chairName ?? "Management",
  };
}

function buildTerminationSection(
  meetingFrame: ReturnType<typeof buildMeetingFrame>,
): TerminationV2 | undefined {
  if (!meetingFrame.terminationHints.time) {
    return undefined;
  }
  return {
    time: meetingFrame.terminationHints.time,
  };
}

function buildDateOfNextMeetingSection(
  meetingFrame: ReturnType<typeof buildMeetingFrame>,
): DateOfNextMeetingV2 | undefined {
  if (!meetingFrame.nextMeetingHints.date && !meetingFrame.nextMeetingHints.time) {
    return undefined;
  }
  return {
    date: meetingFrame.nextMeetingHints.date ?? undefined,
    time: meetingFrame.nextMeetingHints.time ?? undefined,
    location: meetingFrame.nextMeetingHints.location ?? undefined,
  };
}

function buildSpecialPresentations(items: DraftInputItem[], presentDirectors: MeetingFramePerson[] = []): AgendaItemV2[] {
  const publicItems = items.filter((item) => {
    if (inferRestricted(item)) return false;
    if (
      [
        "approval_of_previous_minutes",
        "financial_matters",
        "ratification",
        "ratification_line_item",
      ].includes(item.itemType)
    ) {
      return false;
    }
    const sectionLabel = (item.sectionLabel ?? "").toLowerCase();
    return !sectionLabel.includes("items completed") && isPresentationCandidate(item);
  });

  const groups = new Map<string, DraftInputItem[]>();
  for (const item of publicItems) {
    const speaker = dominantSpeakerForItem(item);
    if (!speaker) continue;
    const key = titleCaseName(speaker);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups.entries()]
    .map(([speakerName, groupItems]) => {
      const supportingText = groupItems
        .flatMap((item) => [item.title, ...item.aliases, ...item.notes])
        .join(" ");
      const company = extractCompanyName(supportingText) ?? undefined;
      const topicFromTitles = cleanPresentationTopic(
        commonLeadingPhrase(groupItems.map((item) => item.title)) ??
          groupItems[0]?.title ??
          "",
      );
      const topicFromCompany = company?.replace(/\s+Ltd\.?$/i, "").trim() ?? null;
      const topic =
        topicFromTitles ||
        topicFromCompany ||
        speakerName;

      return {
        topic,
        summary: summarizeGuestPresentation({
          speakerName,
          company,
          topic,
          items: groupItems,
        }),
        actionItems: [],
        subItems: groupItems
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .filter(
            (item, index, all) =>
              all.findIndex(
                (candidate) =>
                  candidate.title.toLowerCase() === item.title.toLowerCase(),
              ) === index,
          )
          .map((item) => ({
            ...buildAgendaItemV2(item, presentDirectors),
            topic: item.title,
          })),
      } satisfies AgendaItemV2;
    })
    .filter((group) => group.subItems.length > 0 && countWords(group.topic) <= 6);
}

function buildDeterministicMinutesDocument(input: {
  meeting: MeetingRow;
  meetingFrame: ReturnType<typeof buildMeetingFrame>;
  agendaItems: DraftInputItem[];
}) {
  const sections = {
    specialPresentations: [] as AgendaItemV2[],
    financialMatters: [] as AgendaItemV2[],
    managementRatification: [] as AgendaItemV2[],
    managementApproval: [] as AgendaItemV2[],
    managementInformation: [] as AgendaItemV2[],
    managementDiscussion: [] as AgendaItemV2[],
    correspondence: [] as AgendaItemV2[],
    newOrOtherBusiness: [] as AgendaItemV2[],
  };

  const assemblyPlan = input.agendaItems.map((item) => {
    const sectionPath = mapSuggestedSectionPath(item);
    const agendaItem = buildAgendaItemV2(item);

    switch (sectionPath) {
      case "special_presentations":
        sections.specialPresentations.push(agendaItem);
        break;
      case "financial_matters":
        sections.financialMatters.push(agendaItem);
        break;
      case "management_report.items_for_ratification":
        sections.managementRatification.push(agendaItem);
        break;
      case "management_report.items_for_approval":
        sections.managementApproval.push(agendaItem);
        break;
      case "management_report.items_for_information":
        sections.managementInformation.push(agendaItem);
        break;
      case "management_report.items_for_discussion":
        sections.managementDiscussion.push(agendaItem);
        break;
      case "new_or_other_business":
        sections.newOrOtherBusiness.push(agendaItem);
        break;
      case "approval_of_previous_minutes":
      case "date_of_next_meeting":
        break;
      default:
        sections.newOrOtherBusiness.push(agendaItem);
        break;
    }

    return {
      agendaItemId: item.id,
      title: item.title,
      itemType: item.itemType,
      sectionLabel: item.sectionLabel,
      sectionPath,
      restricted: item.investigation.visibility === "RESTRICTED",
      sourcePages: item.sourcePages,
      sourceChunkIds: item.sourceChunkIds.slice(0, 8),
      validation: {
        errorCount: item.validation.errorCount,
        warningCount: item.validation.warningCount,
      },
    };
  });

  const document: MinutesDocumentV2 = {
    metadata: buildMetadata(input.meeting, input.meetingFrame),
    attendance: buildAttendance(input.meetingFrame, input.agendaItems),
    callToOrder: buildCallToOrderSection(input.meetingFrame),
    specialPresentations: buildSpecialPresentations(input.agendaItems),
    approvalOfPreviousMinutes: buildApprovalOfPreviousMinutes(input.agendaItems),
    financialMatters: sections.financialMatters,
    managementReport: {
      itemsForRatification: sections.managementRatification,
      itemsForApproval: sections.managementApproval,
      itemsForInformation: sections.managementInformation,
      itemsForDiscussion: sections.managementDiscussion,
    },
    correspondence: sections.correspondence,
    newOrOtherBusiness: sections.newOrOtherBusiness,
    dateOfNextMeeting: buildDateOfNextMeetingSection(input.meetingFrame),
    termination: buildTerminationSection(input.meetingFrame),
    postTerminationSections: [],
  };

  return {
    document,
    assemblyPlan,
    assemblyPayload: {
      meetingFrame: input.meetingFrame,
      sectionAssignments: assemblyPlan,
      itemInputs: input.agendaItems.map((item) => ({
        id: item.id,
        title: item.title,
        sectionLabel: item.sectionLabel,
        itemType: item.itemType,
        restricted: item.investigation.visibility === "RESTRICTED",
        discussionSummary: item.investigation.discussionSummary,
        outcome: item.investigation.outcome,
        decisions: item.investigation.decisions,
        actions: item.investigation.actions,
        openQuestions: item.investigation.openQuestions,
        validation: item.validation,
      })),
    },
  };
}

export function buildMeetingV2DraftArtifact(input: {
  meeting: MeetingRow;
  agendaItems: AgendaItemRow[];
  investigations: InvestigationRow[];
  validations: ValidationRow[];
  contexts: ContextRow[];
  chunks: ChunkRow[];
  pages: PageRow[];
}) {
  const draftItems = buildDraftInputItems(input);
  if (draftItems.length === 0) {
    throw new Error("Validated agenda investigations are required before generating a draft.");
  }

  const meetingFrame = buildMeetingFrame(input.meeting, input.pages, input.chunks);
  const assembled = buildDeterministicMinutesDocument({
    meeting: input.meeting,
    meetingFrame,
    agendaItems: draftItems,
  });

  const validated = validateMinutesV2(assembled.document);
  if (!validated.value || validated.errors.length > 0) {
    throw new Error(
      validated.errors.join(" ") || "Deterministic assembly did not produce a valid minutes document.",
    );
  }
  const finalDocument = validated.value;
  const structuralIssues = detectMinutesV2Issues(finalDocument);

  return {
    title: `${input.meeting.title} Draft`,
    contentMarkdown: v2ToMarkdown(finalDocument),
    summaryJson: JSON.stringify({
      assemblyMode: "deterministic_v1",
      agendaItemCount: draftItems.length,
      substantiveAgendaItemCount: countSubstantiveAgendaItems(finalDocument),
      sectionHints: [
        "call_to_order",
        "approval_of_previous_minutes",
        "financial_matters",
        "management_report",
      ],
      validationWarnings: validated.warnings,
      structuralIssues,
      minutesV2: wrapMinutesV2(finalDocument),
      assemblyPayload: assembled.assemblyPayload,
    }),
    modelName: "deterministic-assembly-v1",
    usageJson: JSON.stringify({
      agendaItemCount: draftItems.length,
      substantiveAgendaItemCount: countSubstantiveAgendaItems(finalDocument),
    }),
  };
}
