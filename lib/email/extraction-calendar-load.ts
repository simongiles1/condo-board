import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  attachmentDocuments,
  contactHighlightExtractions,
  emailAttachments,
  emails,
  eventHighlightExtractions,
  organizationHighlightExtractions,
  todoHighlightExtractions,
} from "@/lib/db/schema";
import {
  buildExtractionCalendar,
  listExtractionCalendarYears,
  resolveExtractionCalendarYear,
  torontoTodayKey,
  type EmailExtractionRow,
  type ExtractionCalendarResponse,
} from "@/lib/email/extraction-calendar";
import {
  buildThreadFilterWhere,
  hasActiveFilters,
  type EmailThreadFilters,
} from "@/lib/email/thread-filters";

function parseYear(value: string | null): number | null {
  if (!value) return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1970 || year > 2100) return null;
  return year;
}

export async function loadExtractionCalendar(input: {
  filters: EmailThreadFilters;
  year: string | null;
}): Promise<ExtractionCalendarResponse> {
  const db = getDb();
  const filterWhere = buildThreadFilterWhere(input.filters);
  const filtersActive = hasActiveFilters(input.filters);
  const today = torontoTodayKey();
  const todayYear = Number(today.slice(0, 4));

  const emailQuery = db
    .select({
      id: emails.id,
      receivedAt: emails.receivedAt,
    })
    .from(emails);
  const emailRows = filterWhere
    ? await emailQuery.where(filterWhere)
    : await emailQuery;

  const years = listExtractionCalendarYears(
    emailRows.map((row) => row.receivedAt),
  );
  const year = resolveExtractionCalendarYear(
    years,
    parseYear(input.year),
    todayYear,
  );

  if (emailRows.length === 0) {
    return {
      ...buildExtractionCalendar([], year, today),
      years,
      filtersActive,
    };
  }

  const contactWhere = filterWhere
    ? and(isNull(contactHighlightExtractions.error), filterWhere)
    : isNull(contactHighlightExtractions.error);
  const orgWhere = filterWhere
    ? and(isNull(organizationHighlightExtractions.error), filterWhere)
    : isNull(organizationHighlightExtractions.error);
  const eventWhere = filterWhere
    ? and(isNull(eventHighlightExtractions.error), filterWhere)
    : isNull(eventHighlightExtractions.error);
  const todoWhere = filterWhere
    ? and(isNull(todoHighlightExtractions.error), filterWhere)
    : isNull(todoHighlightExtractions.error);

  const attachmentQuery = db
    .select({
      emailId: emailAttachments.emailId,
      eligible: sql<number>`MAX(CASE WHEN ${emailAttachments.hasValue} IS DISTINCT FROM FALSE THEN 1 ELSE 0 END)`.mapWith(
        Number,
      ),
      allParsed: sql<number>`MIN(CASE WHEN ${emailAttachments.hasValue} IS NOT DISTINCT FROM FALSE THEN 1 WHEN ${attachmentDocuments.parseStatus} = 'parsed' THEN 1 ELSE 0 END)`.mapWith(
        Number,
      ),
    })
    .from(emailAttachments)
    .leftJoin(
      attachmentDocuments,
      eq(emailAttachments.contentHash, attachmentDocuments.contentHash),
    )
    .innerJoin(emails, eq(emailAttachments.emailId, emails.id));

  const [attachmentRows, contactRows, orgRows, eventRows, todoRows] = await Promise.all([
    filterWhere
      ? attachmentQuery.where(filterWhere).groupBy(emailAttachments.emailId)
      : attachmentQuery.groupBy(emailAttachments.emailId),
    db
      .selectDistinct({ emailId: contactHighlightExtractions.emailId })
      .from(contactHighlightExtractions)
      .innerJoin(emails, eq(contactHighlightExtractions.emailId, emails.id))
      .where(contactWhere),
    db
      .selectDistinct({ emailId: organizationHighlightExtractions.emailId })
      .from(organizationHighlightExtractions)
      .innerJoin(
        emails,
        eq(organizationHighlightExtractions.emailId, emails.id),
      )
      .where(orgWhere),
    db
      .selectDistinct({ emailId: eventHighlightExtractions.emailId })
      .from(eventHighlightExtractions)
      .innerJoin(emails, eq(eventHighlightExtractions.emailId, emails.id))
      .where(eventWhere),
    db
      .selectDistinct({ emailId: todoHighlightExtractions.emailId })
      .from(todoHighlightExtractions)
      .innerJoin(emails, eq(todoHighlightExtractions.emailId, emails.id))
      .where(todoWhere),
  ]);

  const attachmentsByEmail = new Map(
    attachmentRows.map((row) => [
      row.emailId,
      {
        eligible: row.eligible > 0,
        extracted: row.eligible > 0 && row.allParsed > 0,
      },
    ]),
  );
  const contactIds = new Set(contactRows.map((row) => row.emailId));
  const orgIds = new Set(orgRows.map((row) => row.emailId));
  const eventIds = new Set(eventRows.map((row) => row.emailId));
  const todoIds = new Set(todoRows.map((row) => row.emailId));

  const extractionRows: EmailExtractionRow[] = [];
  for (const row of emailRows) {
    const attachments = attachmentsByEmail.get(row.id);
    extractionRows.push({
      receivedAt: row.receivedAt,
      hasEligibleAttachment: attachments?.eligible ?? false,
      attachmentsExtracted: attachments?.extracted ?? false,
      contactExtracted: contactIds.has(row.id),
      organizationExtracted: orgIds.has(row.id),
      eventExtracted: eventIds.has(row.id),
      todoExtracted: todoIds.has(row.id),
    });
  }

  return {
    ...buildExtractionCalendar(extractionRows, year, today),
    years,
    filtersActive,
  };
}
