import { and, asc, eq } from "drizzle-orm";

import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { getDb } from "@/lib/db";
import {
  meetingsV2,
  meetingsV2AgendaItems,
  meetingsV2DocumentPages,
  meetingsV2SourceArtifacts,
} from "@/lib/db/schema";
import {
  DEEPSEEK_TOPIC_CANDIDATE_PASS1_TASK,
  DEEPSEEK_TOPIC_CANDIDATE_PASS2_TASK,
  DEEPSEEK_TOPIC_CANDIDATE_SHARED_PROMPT,
} from "@/lib/meeting-v2/topic-candidate-prompts";

export type TopicCandidate = {
  id: string;
  title: string;
  sourceTitle: string;
  sectionLabel: string;
  category: string;
  visibility: "PUBLIC" | "RESTRICTED" | "UNKNOWN";
  sourcePages: number[];
  origin: "deterministic" | "ai" | "reconciled";
  warnings: string[];
  score?: number;
};

type AiTopicCandidateDocument = {
  schemaVersion?: string;
  candidates?: Array<{
    candidateId?: string;
    canonicalTitle?: string;
    sourceTitle?: string;
    parentSection?: string;
    category?: string;
    visibility?: string;
    sourceEvidence?: Array<{
      sourceType?: string;
      pageNumber?: number;
      evidenceRole?: string;
    }>;
    confidence?: {
      topicExistence?: number;
    };
    warnings?: string[];
  }>;
};

type DeepSeekPass2Document = {
  final?: AiTopicCandidateDocument;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalize(value: string): string {
  return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeJsonParse(text: string): unknown {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  const extracted =
    firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed;
  return JSON.parse(
    extracted
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/,\s*([}\]])/g, "$1"),
  );
}

function mapParentSection(parentSection: string): string {
  switch (parentSection) {
    case "APPROVAL_OF_PREVIOUS_MINUTES":
      return "Approval of Previous Minutes";
    case "FINANCIAL_MATTERS":
      return "Financial Matters";
    case "SPECIAL_PRESENTATIONS":
      return "Special Presentations";
    case "MANAGEMENT_REPORT_RATIFICATION":
      return "Management Report / Ratification";
    case "MANAGEMENT_REPORT_APPROVAL":
      return "Management Report / Discussion and Approval";
    case "MANAGEMENT_REPORT_INFORMATION":
    case "MANAGEMENT_REPORT_DISCUSSION":
      return "Management Report / Discussion Topics";
    case "WORK_COMPLETED":
      return "Management Report / Items Completed";
    case "NEW_OR_OTHER_BUSINESS":
      return "New / Other Business";
    default:
      return "Unknown";
  }
}

function mapCategoryToItemType(category: string): string {
  switch (category) {
    case "RATIFICATION":
      return "ratification_line_item";
    case "APPROVAL":
      return "discussion_approval";
    case "DISCUSSION":
      return "discussion_topic";
    case "INFORMATION":
      return "discussion_topic";
    case "ACTION_REVIEW":
      return "discussion_topic";
    case "PRESENTATION":
      return "guest_presentation";
    case "OTHER_BUSINESS":
      return "new_other_business";
    default:
      return "other";
  }
}

function selectAiCandidatePages(
  pages: Array<typeof meetingsV2DocumentPages.$inferSelect>,
) {
  return [...pages]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .filter((page) => {
      const text = normalizeWhitespace(page.extractedText);
      return (
        page.pageNumber <= 12 ||
        /management report|board of directors meeting|agenda|the board.?s decision is required|management recommendation|items for ratification|items for board discussion|items for discussion|new \/ other business|work completed/i.test(
          text,
        )
      );
    })
    .slice(0, 18);
}

function buildAiTopicCandidateInput(
  meetingId: string,
  pages: Array<typeof meetingsV2DocumentPages.$inferSelect>,
): string {
  const body = pages
    .map((page) => {
      const text = normalizeWhitespace(page.extractedText).slice(0, 2600);
      return `PAGE ${page.pageNumber}\n${text}`;
    })
    .join("\n\n");

  return `Meeting ID: ${meetingId}

The following are extracted board-package pages. Some later pages may be attachments or supporting materials rather than distinct agenda topics.

${body}`;
}

function buildDeepSeekPass1Input(options: {
  meetingId: string;
  pages: Array<typeof meetingsV2DocumentPages.$inferSelect>;
}): string {
  return `${buildAiTopicCandidateInput(options.meetingId, options.pages)}

${DEEPSEEK_TOPIC_CANDIDATE_PASS1_TASK}`;
}

function buildDeepSeekPass2Input(options: {
  meetingId: string;
  pages: Array<typeof meetingsV2DocumentPages.$inferSelect>;
  pass1Text: string;
}): string {
  return `${buildAiTopicCandidateInput(options.meetingId, options.pages)}

INITIAL EXTRACTION JSON
${options.pass1Text}

${DEEPSEEK_TOPIC_CANDIDATE_PASS2_TASK}`;
}

function normalizeAiTopicCandidates(value: unknown): TopicCandidate[] {
  const document = (value && typeof value === "object" ? value : {}) as AiTopicCandidateDocument;
  const candidates = Array.isArray(document.candidates) ? document.candidates : [];

  const normalizedCandidates: TopicCandidate[] = [];

  for (const [index, candidate] of candidates.entries()) {
    const title = normalizeWhitespace(asString(candidate.canonicalTitle));
    if (!title) continue;

    const sourcePages = (candidate.sourceEvidence ?? [])
      .flatMap((entry) => {
        const page = asNumber(entry.pageNumber);
        return page !== null ? [Math.trunc(page)] : [];
      })
      .filter((page, pageIndex, pages) => pages.indexOf(page) === pageIndex)
      .sort((a, b) => a - b);

    normalizedCandidates.push({
      id: asString(candidate.candidateId) || `ai-${index + 1}`,
      title,
      sourceTitle: normalizeWhitespace(asString(candidate.sourceTitle)) || title,
      sectionLabel: mapParentSection(asString(candidate.parentSection)),
      category: normalizeWhitespace(asString(candidate.category)) || "UNKNOWN",
      visibility:
        asString(candidate.visibility) === "PUBLIC" ||
        asString(candidate.visibility) === "RESTRICTED" ||
        asString(candidate.visibility) === "UNKNOWN"
          ? (asString(candidate.visibility) as TopicCandidate["visibility"])
          : "UNKNOWN",
      sourcePages,
      origin: "ai",
      warnings: Array.isArray(candidate.warnings)
        ? candidate.warnings.filter((warning): warning is string => typeof warning === "string")
        : [],
      score: candidate.confidence?.topicExistence,
    });
  }

  return normalizedCandidates;
}

function deterministicToCandidates(
  agendaItems: Array<typeof meetingsV2AgendaItems.$inferSelect>,
): TopicCandidate[] {
  return [...agendaItems]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => ({
      id: item.id,
      title: item.title,
      sourceTitle: item.sourceText ?? item.title,
      sectionLabel: item.sectionLabel ?? "Unknown",
      category: item.itemType,
      visibility: "UNKNOWN" as const,
      sourcePages: (() => {
        try {
          const parsed = JSON.parse(item.sourcePagesJson) as unknown;
          return Array.isArray(parsed)
            ? parsed.filter((page): page is number => typeof page === "number")
            : [];
        } catch {
          return [];
        }
      })(),
      origin: "deterministic" as const,
      warnings: [],
    }));
}

export async function listTopicCandidates(meetingId: string): Promise<TopicCandidate[]> {
  const db = getDb();
  const [pages, agendaItems] = await Promise.all([
    db
      .select()
      .from(meetingsV2DocumentPages)
      .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2DocumentPages.pageNumber)),
    db
      .select()
      .from(meetingsV2AgendaItems)
      .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2AgendaItems.sortOrder)),
  ]);

  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    return deterministicToCandidates(agendaItems);
  }

  const candidatePages = selectAiCandidatePages(pages);
  if (candidatePages.length === 0) return deterministicToCandidates(agendaItems);

  const pass1 = await generateDeepSeekJson({
    systemInstruction: DEEPSEEK_TOPIC_CANDIDATE_SHARED_PROMPT,
    userText: buildDeepSeekPass1Input({ meetingId, pages: candidatePages }),
    modelName: "deepseek-v4-flash",
    maxOutputTokens: 8192,
    temperature: 0,
    thinking: false,
  });
  const pass1Parsed = safeJsonParse(pass1.text);

  const pass2 = await generateDeepSeekJson({
    systemInstruction: DEEPSEEK_TOPIC_CANDIDATE_SHARED_PROMPT,
    userText: buildDeepSeekPass2Input({
      meetingId,
      pages: candidatePages,
      pass1Text: pass1.text,
    }),
    modelName: "deepseek-v4-flash",
    maxOutputTokens: 12288,
    temperature: 0,
    thinking: false,
  });
  const pass2Parsed = safeJsonParse(pass2.text) as DeepSeekPass2Document;
  const finalDocument = pass2Parsed.final ?? (pass1Parsed as AiTopicCandidateDocument);

  return normalizeAiTopicCandidates(finalDocument);
}

export async function buildAiAgendaCandidates(meetingId: string): Promise<
  Array<{
    title: string;
    normalizedTitle: string;
    sectionLabel: string;
    itemType: string;
    sourcePages: number[];
    sourceText: string | null;
    warnings: string[];
  }>
> {
  const db = getDb();
  const [meeting, pages, boardPackage] = await Promise.all([
    db.select().from(meetingsV2).where(eq(meetingsV2.id, meetingId)),
    db
      .select()
      .from(meetingsV2DocumentPages)
      .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2DocumentPages.pageNumber)),
    db
      .select()
      .from(meetingsV2SourceArtifacts)
      .where(
        and(
          eq(meetingsV2SourceArtifacts.meetingV2Id, meetingId),
          eq(meetingsV2SourceArtifacts.type, "board_package"),
        ),
      ),
  ]);

  if (!meeting[0]) {
    throw new Error(`V2 meeting ${meetingId} was not found.`);
  }
  if (!boardPackage[0]) {
    throw new Error("Board package artifact not found for meeting.");
  }

  const candidates = await listTopicCandidates(meetingId);
  return candidates.map((candidate) => ({
    title: candidate.title,
    normalizedTitle: normalize(candidate.title),
    sectionLabel: candidate.sectionLabel,
    itemType: mapCategoryToItemType(candidate.category),
    sourcePages: candidate.sourcePages,
    sourceText: candidate.sourceTitle || candidate.title,
    warnings: candidate.warnings,
  }));
}
