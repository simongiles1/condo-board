import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2DocumentPages } from "@/lib/db/schema-v2";
import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { canonicalLeafItemCode } from "@/lib/meeting-v2/agenda-outline";

export type BoardPackageAgendaSkeleton = {
  meetingTitle: string;
  meetingDate?: string;
  agendaItems: Array<{
    itemNumber: string;
    title: string;
    subItems?: string[];
    subSections?: Array<{
      code: string;
      title: string;
    }>;
  }>;
};

export type AgendaSubItem = {
  itemCode: string;
  title: string;
  sourcePages: number[];
  summary?: string;
  financials?: {
    amount?: string;
    reserveEligible?: boolean;
    notes?: string;
  };
  contractorsOrVendors?: string[];
  attachmentReferences?: string[];
  managementRecommendation?: string;
};

export type DetailedAgendaSection = {
  code: string;
  title: string;
  items: AgendaSubItem[];
};

export type DetailedAgendaItem = {
  itemNumber: string;
  title: string;
  sourcePages: number[];
  summary?: string;
  subItems?: Array<{
    title: string;
    sourcePages: number[];
    summary?: string;
  }>;
  subSections?: DetailedAgendaSection[];
};

export type FullBoardPackageAgenda = {
  meetingTitle: string;
  meetingDate?: string;
  agendaItems: DetailedAgendaItem[];
};

const DEFAULT_PM_SUBSECTIONS = [
  { codeSuffix: "A", title: "Ratification of email decisions made since the last board meeting." },
  { codeSuffix: "B", title: "Review and approval of the project" },
  { codeSuffix: "C", title: "Items completed." },
  { codeSuffix: "D", title: "The items for discussion" },
] as const;

export function normalizeBoardPackageAgendaSkeleton(
  skeleton: BoardPackageAgendaSkeleton,
): BoardPackageAgendaSkeleton {
  const items = Array.isArray(skeleton.agendaItems) ? [...skeleton.agendaItems] : [];
  const isDate = (title: string) => /date and time of the next/i.test(title);
  const isAdjournment = (title: string) => /^\s*adjournment\b/i.test(title);
  const isPmReport = (title: string) => /property management report/i.test(title);

  const dateItems = items.filter((item) => isDate(item.title));
  const adjournItems = items.filter((item) => isAdjournment(item.title));
  const core = items.filter((item) => !isDate(item.title) && !isAdjournment(item.title));

  let pm = core.find((item) => isPmReport(item.title));
  if (!pm) {
    pm = {
      itemNumber: String(core.length + 1),
      title: "Property Management Report",
      subSections: [],
    };
    core.push(pm);
  }
  if (!pm.subSections || pm.subSections.length === 0) {
    pm.subSections = DEFAULT_PM_SUBSECTIONS.map((section) => ({
      code: `${pm!.itemNumber}.${section.codeSuffix}`,
      title: section.title,
    }));
  }

  const trailing = [
    ...(dateItems.length > 0
      ? dateItems
      : [{ itemNumber: "5", title: "Date and time of the next Board Meeting" }]),
    ...(adjournItems.length > 0 ? adjournItems : [{ itemNumber: "6", title: "Adjournment" }]),
  ];

  const rebuilt = [...core, ...trailing].map((item, index) => {
    const itemNumber = String(index + 1);
    return {
      ...item,
      itemNumber,
      subSections: item.subSections?.map((section) => ({
        ...section,
        code: section.code.replace(/^\d+/, itemNumber),
      })),
    };
  });

  return {
    ...skeleton,
    agendaItems: rebuilt,
  };
}

function inferTopLevelItemType(title: string): string {
  const normalized = title.toLowerCase();
  if (normalized.includes("approval of minutes")) return "approval_of_previous_minutes";
  if (normalized.includes("financial statement")) return "financial_matters";
  if (normalized.includes("meeting with")) return "guest_presentation";
  if (normalized.includes("property management report")) return "agenda_section";
  if (normalized.includes("ratification")) return "ratification_line_item";
  if (normalized.includes("items completed")) return "completed_items";
  if (normalized.includes("ad-hoc") || normalized.includes("ad hoc")) return "ad_hoc_discussion";
  return "discussion_topic";
}

function inferSectionItemType(title: string): string {
  const normalized = title.toLowerCase();
  if (normalized.includes("ratification")) return "ratification_line_item";
  if (normalized.includes("review and approval")) return "discussion_approval";
  if (normalized.includes("completed")) return "completed_items";
  if (normalized.includes("ad-hoc") || normalized.includes("ad hoc")) return "ad_hoc_discussion";
  return "discussion_topic";
}

type PageExtractedItem = {
  sectionCode: string;
  itemCode?: string;
  title: string;
  isContinuationOfPrevious?: boolean;
  summary?: string;
  financials?: {
    amount?: string;
    reserveEligible?: boolean;
    notes?: string;
  };
  contractorsOrVendors?: string[];
  attachmentReferences?: string[];
  managementRecommendation?: string;
};

const DISCOVERY_PROMPT = `You are an expert condominium governance analyst.
Your task is to locate and extract the official meeting agenda outline from the beginning of the board package.

Guidelines:
- Search for the formal Agenda or Table of Contents (usually within the first few pages).
- Extract the official numbered business items (e.g. Item 1, Item 2, Item 3, Item 4, Item 5, Item 6).
- If lines like "Call to Order" or "Ratification of Agenda" appear before Item 1 without a number, do NOT label them as Item 1. Maintain the document's actual numbered items (e.g. if "1. Meeting with Eng. Ryan Ratcliff..." is numbered 1, keep it as itemNumber "1").
- For items like "Property Management Report", extract its sub-sections (e.g. "A. Ratification of email decisions...", "B. Review and approval of projects...", "C. Items completed...", "D. The items for discussion...") with codes like "4.A", "4.B", "4.C", "4.D".
- If the printed Agenda/TOC jumps from Financial Statements to "Date and time of the next Board Meeting", that does NOT mean Property Management Report is missing. The later management-report body (sections A–D) IS that numbered agenda item. Insert it before Date/Adjournment.
- Always keep Date/Adjournment as the last numbered official items. Never place them before the Property Management Report body.
- For presentation items with listed projects (e.g. "Meeting with Engineer... A. Booster Pump, B. Riser Expansion"), record those in subItems. These outline bullets stay under item 1; they are not the same slots as later Property Management Report project items.
- DO NOT extract details, paragraphs, or vendor quotes yet. Only extract the clean outline structure.

Return strict JSON:
{
  "meetingTitle": "string",
  "meetingDate": "string | null",
  "agendaItems": [
    {
      "itemNumber": "1",
      "title": "Meeting with Eng. Ryan Ratcliff from TCG, to discuss projects",
      "subItems": ["Booster Pump", "Riser Expansion", "Tender Analysis for the Generator Fuel Delivery Upgrade and Exhaust Project"]
    },
    {
      "itemNumber": "2",
      "title": "Review and Approval of Minutes of June 30, 2026"
    },
    {
      "itemNumber": "3",
      "title": "Review and approval of the unaudited financial statements for June 2026"
    },
    {
      "itemNumber": "4",
      "title": "Property Management Report",
      "subSections": [
        { "code": "4.A", "title": "Ratification of email decisions made since the last board meeting." },
        { "code": "4.B", "title": "Review and approval of projects" },
        { "code": "4.C", "title": "Items completed." },
        { "code": "4.D", "title": "The items for discussion" }
      ]
    },
    {
      "itemNumber": "5",
      "title": "Date and time of the next Board Meeting"
    },
    {
      "itemNumber": "6",
      "title": "Adjournment"
    }
  ]
}`;

const PAGE_EXTRACT_PROMPT = `You are analyzing a single page of a condominium board package to extract business matters into the official agenda structure.

You will receive:
1. "agendaOutline": The official agenda outline (item numbers and subsection codes like 1, 2, 3, 4.A, 4.B, 4.C, 4.D, 5, 6).
2. "lastActiveItem": The title and itemCode of the most recent item from previous pages.
3. "pageNumber": The current page number.
4. "pageText": The exact text of this page.

Your task:
Extract all distinct business items, projects, or discussion points presented on this page.

Rules:
1. Keep the hierarchy aligned:
   - If Section "B. Review and approval of projects" (code 4.B) is active, all numbered project items (e.g. 1, 2, 3, 4, 5, 6, 7) belong under "4.B" (e.g. "4.B.5", "4.B.6", "4.B.7"), NOT 4.D.
   - Copy the printed project number into itemCode. "5. Update on Shared Facilities..." is "4.B.5". Do not skip 5 or 6 because the agenda outline also has top-level items 5 and 6.
   - Section 4.D ("The items for discussion") begins only when the text explicitly introduces "D. Items for Discussion:".
   - Never assign package items to 4.E. That slot is reserved for transcript-only ad-hoc matters.
2. Distinct numbered or titled items on the page (e.g. "1. Steam Room Heat Pump...", "2. Main Lobby / Elevator Lobby...") are SEPARATE items ("isContinuationOfPrevious": false).
3. "isContinuationOfPrevious" should ONLY be true if the top of this page is a paragraph, pricing table, or recommendation continuing the item from "lastActiveItem" without introducing a new heading or project number.
4. Guest-presentation outline bullets (1.A, 1.B, 1.C) stay under item 1. A later Property Management Report project about the same work (4.B.1) is a different outline slot — do not collapse them.

For each item on this page:
- "sectionCode": which agenda section/subsection it belongs to (e.g. "1", "2", "3", "4.A", "4.B", "4.C", "4.D", "5", "6").
- "itemCode": specific sub-item code if numbered/lettered (e.g. "4.A.1", "4.A.2", "4.B.1", "4.B.2", "4.D.1", "4.D.2", etc.).
- "title": concise, accurate title of the project or matter.
- "isContinuationOfPrevious": boolean (true ONLY if continuing previous page's unfinished item).
- "summary": 1-2 sentence factual summary of the matter on this page.
- "financials": { "amount": "...", "reserveEligible": boolean, "notes": "..." } if stated.
- "contractorsOrVendors": list of contractor/vendor company names mentioned.
- "attachmentReferences": e.g. ["pages 152-156"] if referenced.
- "managementRecommendation": management's stated recommendation if present.

If the page is purely administrative (cover page, distribution list, blank), return {"items": []}.

Return strict JSON:
{
  "items": [
    {
      "sectionCode": "4.B",
      "itemCode": "4.B.1",
      "title": "Booster Pump Replacement - Base Specification and Alternative Options",
      "isContinuationOfPrevious": false,
      "summary": "Management discussed with TCG why Ambient Mechanical's base bid is preferred.",
      "financials": { "amount": "$214,194.00 plus HST", "reserveEligible": true },
      "contractorsOrVendors": ["Ambient Mechanical", "Trace Consulting Group"],
      "attachmentReferences": ["pages 15-26"],
      "managementRecommendation": "Award contract to Ambient Mechanical"
    }
  ]
}`;

function enrichAgendaSubItem(target: AgendaSubItem, item: PageExtractedItem, pageNumber: number) {
  if (!target.sourcePages.includes(pageNumber)) {
    target.sourcePages.push(pageNumber);
  }
  if (item.summary) {
    target.summary = `${target.summary || ""} ${item.summary}`.trim();
  }
  if (item.financials) {
    target.financials = { ...target.financials, ...item.financials };
  }
  if (item.contractorsOrVendors) {
    target.contractorsOrVendors = Array.from(
      new Set([...(target.contractorsOrVendors || []), ...item.contractorsOrVendors]),
    );
  }
  if (item.attachmentReferences) {
    target.attachmentReferences = Array.from(
      new Set([...(target.attachmentReferences || []), ...item.attachmentReferences]),
    );
  }
  if (item.managementRecommendation) {
    target.managementRecommendation = item.managementRecommendation;
  }
}

function ensureAgendaSection(
  agenda: FullBoardPackageAgenda,
  sectionCode: string,
): DetailedAgendaSection | null {
  const match = sectionCode.trim().match(/^(\d+)\.([A-Za-z])$/);
  if (!match) return null;

  const itemNumber = match[1];
  const letter = match[2].toUpperCase();
  const normalizedCode = `${itemNumber}.${letter}`;
  const parent = agenda.agendaItems.find((ai) => ai.itemNumber === itemNumber);
  if (!parent) return null;

  parent.subSections = parent.subSections || [];
  let section = parent.subSections.find((s) => s.code.toLowerCase() === normalizedCode.toLowerCase());
  if (!section) {
    const fallback = DEFAULT_PM_SUBSECTIONS.find((entry) => entry.codeSuffix === letter);
    section = {
      code: normalizedCode,
      title: fallback?.title || letter,
      items: [],
    };
    parent.subSections.push(section);
  }
  return section;
}

function mergePageItemsIntoAgenda(
  agenda: FullBoardPackageAgenda,
  extractedItems: PageExtractedItem[],
  pageNumber: number,
  previousLast: AgendaSubItem | null,
): AgendaSubItem | null {
  let lastItem: AgendaSubItem | null = previousLast;

  for (const item of extractedItems) {
    const targetSection =
      agenda.agendaItems
        .flatMap((ai) => ai.subSections || [])
        .find((s) => s.code.toLowerCase() === item.sectionCode.toLowerCase()) ||
      ensureAgendaSection(agenda, item.sectionCode);

    const targetTopItem = agenda.agendaItems.find((ai) => ai.itemNumber === item.sectionCode);

    if (item.isContinuationOfPrevious && lastItem) {
      enrichAgendaSubItem(lastItem, item, pageNumber);
      continue;
    }

    if (targetSection) {
      const existing = targetSection.items.find(
        (existing) =>
          (item.itemCode && existing.itemCode === item.itemCode) ||
          existing.title.toLowerCase() === item.title.toLowerCase(),
      );

      if (existing) {
        enrichAgendaSubItem(existing, item, pageNumber);
        lastItem = existing;
      } else {
        const newItem: AgendaSubItem = {
          itemCode: canonicalLeafItemCode(targetSection.code, targetSection.items.length, item.itemCode),
          title: item.title,
          sourcePages: [pageNumber],
          summary: item.summary,
          financials: item.financials,
          contractorsOrVendors: item.contractorsOrVendors,
          attachmentReferences: item.attachmentReferences,
          managementRecommendation: item.managementRecommendation,
        };
        targetSection.items.push(newItem);
        lastItem = newItem;
      }
    } else if (targetTopItem) {
      if (!targetTopItem.sourcePages.includes(pageNumber)) {
        targetTopItem.sourcePages.push(pageNumber);
      }
      if (item.summary) {
        targetTopItem.summary = `${targetTopItem.summary || ""} ${item.summary}`.trim();
      }

      if (item.itemCode && !targetTopItem.subSections?.length) {
        const existingChild = targetTopItem.subItems?.find(
          (sub) => sub.title.toLowerCase() === item.title.toLowerCase(),
        );
        if (existingChild) {
          if (!existingChild.sourcePages.includes(pageNumber)) {
            existingChild.sourcePages.push(pageNumber);
          }
          if (item.summary) {
            existingChild.summary = `${existingChild.summary || ""} ${item.summary}`.trim();
          }
        } else {
          targetTopItem.subItems = targetTopItem.subItems || [];
          targetTopItem.subItems.push({
            title: item.title,
            sourcePages: [pageNumber],
            summary: item.summary,
          });
        }
      }
    }
  }

  return lastItem;
}

export async function extractBoardPackageAgendaJson(options: {
  meetingId: string;
  maxPages?: number;
  onProgress?: (progress: { current: number; total: number; label: string }) => Promise<void> | void;
}): Promise<FullBoardPackageAgenda> {
  const db = getDb();
  const pages = await db
    .select({
      pageNumber: meetingsV2DocumentPages.pageNumber,
      heading: meetingsV2DocumentPages.pageHeading,
      text: meetingsV2DocumentPages.extractedText,
    })
    .from(meetingsV2DocumentPages)
    .where(eq(meetingsV2DocumentPages.meetingV2Id, options.meetingId))
    .orderBy(asc(meetingsV2DocumentPages.pageNumber));

  if (pages.length === 0) {
    throw new Error(`No extracted pages found in database for meeting ${options.meetingId}`);
  }

  // Look at up to the core report pages (defaults to 15 pages or page count)
  const corePages = pages.slice(0, options.maxPages ?? 15);
  const total = corePages.length + 1; // 1 for discovery + page count

  await options.onProgress?.({
    current: 1,
    total,
    label: "Discovering Master Agenda outline from board package...",
  });

  const initialPagesText = pages
    .slice(0, 3)
    .map((p) => `--- PAGE ${p.pageNumber} ---\n${p.text}`)
    .join("\n\n");

  const skeletonResponse = await generateDeepSeekJson({
    systemInstruction: DISCOVERY_PROMPT,
    userText: initialPagesText,
    modelName: "deepseek-v4-flash",
    temperature: 0,
    thinking: false,
  });

  const skeleton = normalizeBoardPackageAgendaSkeleton(
    JSON.parse(skeletonResponse.text) as BoardPackageAgendaSkeleton,
  );

  const fullAgenda: FullBoardPackageAgenda = {
    meetingTitle: skeleton.meetingTitle || "Board Meeting",
    meetingDate: skeleton.meetingDate || undefined,
    agendaItems: skeleton.agendaItems.map((item) => ({
      itemNumber: item.itemNumber,
      title: item.title,
      sourcePages: [],
      subItems: item.subItems?.map((s) => ({ title: s, sourcePages: [] })),
      subSections: item.subSections?.map((sec) => ({
        code: sec.code,
        title: sec.title,
        items: [],
      })),
    })),
  };

  const agendaOutlineSummary = fullAgenda.agendaItems.map((item) => ({
    itemNumber: item.itemNumber,
    title: item.title,
    subSections: item.subSections?.map((s) => ({ code: s.code, title: s.title })),
  }));

  let lastActiveItem: AgendaSubItem | null = null;
  let pageIdx = 0;

  for (const page of corePages) {
    pageIdx++;
    await options.onProgress?.({
      current: 1 + pageIdx,
      total,
      label: `Extracting agenda details from page ${page.pageNumber}...`,
    });

    const pageExtractResponse = await generateDeepSeekJson({
      systemInstruction: PAGE_EXTRACT_PROMPT,
      userText: JSON.stringify(
        {
          agendaOutline: agendaOutlineSummary,
          lastActiveItem: lastActiveItem
            ? { itemCode: lastActiveItem.itemCode, title: lastActiveItem.title }
            : null,
          pageNumber: page.pageNumber,
          pageText: page.text,
        },
        null,
        2,
      ),
      modelName: "deepseek-v4-flash",
      temperature: 0,
      thinking: false,
    });

    try {
      const parsed = JSON.parse(pageExtractResponse.text) as { items: PageExtractedItem[] };
      const items = parsed.items || [];
      if (items.length > 0) {
        const updatedLast = mergePageItemsIntoAgenda(
          fullAgenda,
          items,
          page.pageNumber,
          lastActiveItem,
        );
        if (updatedLast) {
          lastActiveItem = updatedLast;
        }
      }
    } catch (err) {
      console.warn(`[agenda-builder] Could not parse extraction on page ${page.pageNumber}:`, err);
    }
  }

  return fullAgenda;
}

export type FlattenedAgendaTopic = {
  itemNumber: string;
  sectionLabel: string;
  title: string;
  itemType: string;
  sourcePages: number[];
  summary?: string;
  financials?: {
    amount?: string;
    reserveEligible?: boolean;
    notes?: string;
  };
  contractorsOrVendors?: string[];
  attachmentReferences?: string[];
  managementRecommendation?: string;
};

/** Converts the hierarchical FullBoardPackageAgenda into outline-coded reviewable topics */
export function flattenBoardPackageAgenda(agenda: FullBoardPackageAgenda): FlattenedAgendaTopic[] {
  const topics: FlattenedAgendaTopic[] = [];

  for (const item of agenda.agendaItems) {
    topics.push({
      itemNumber: item.itemNumber,
      sectionLabel: item.title,
      title: item.title,
      itemType: inferTopLevelItemType(item.title),
      sourcePages: item.sourcePages.length > 0 ? item.sourcePages : [],
      summary: item.summary,
    });

    if (item.subItems && item.subItems.length > 0) {
      item.subItems.forEach((subItem, index) => {
        topics.push({
          itemNumber: `${item.itemNumber}.${alphaUpper(index)}`,
          sectionLabel: item.title,
          title: subItem.title,
          itemType: "guest_presentation",
          sourcePages: subItem.sourcePages,
          summary: subItem.summary,
        });
      });
    }

    if (item.subSections && item.subSections.length > 0) {
      for (const section of item.subSections) {
        topics.push({
          itemNumber: section.code,
          sectionLabel: item.title,
          title: section.title,
          itemType: inferSectionItemType(section.title),
          sourcePages: [],
        });

        section.items.forEach((subItem, index) => {
          const sectionType = inferSectionItemType(section.title);
          topics.push({
            itemNumber: canonicalLeafItemCode(section.code, index, subItem.itemCode),
            sectionLabel: `${item.title}: ${section.title}`,
            title: subItem.title,
            itemType:
              sectionType === "ratification_line_item" || sectionType === "discussion_approval"
                ? sectionType
                : "discussion_topic",
            sourcePages: subItem.sourcePages,
            summary: subItem.summary,
            financials: subItem.financials,
            contractorsOrVendors: subItem.contractorsOrVendors,
            attachmentReferences: subItem.attachmentReferences,
            managementRecommendation: subItem.managementRecommendation,
          });
        });
      }
    }
  }

  return topics;
}

function alphaUpper(index: number): string {
  return index >= 0 && index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}
