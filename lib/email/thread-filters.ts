import { and, gte, isNotNull, like, lte, or, sql, type SQL } from "drizzle-orm";

import { emails } from "@/lib/db/schema";

export type {
  EmailAddressField,
  EmailInboxView,
  EmailThreadFilters,
} from "./thread-filter-params";
export {
  buildEmailThreadSearchParams,
  emailDetailBackHref,
  emailMessageDetailHref,
  emailThreadDetailHref,
  emailThreadsPageHref,
  EMAIL_MESSAGE_SCOPE,
  EMAIL_THREAD_SCOPE,
  hasActiveFilters,
  parseEmailDetailScope,
  parseEmailThreadFilters,
  searchParamsToFilterRecord,
} from "./thread-filter-params";
export type { EmailDetailScope } from "./thread-filter-params";

import type { EmailAddressField, EmailThreadFilters } from "./thread-filter-params";

function buildAddressMatchCondition(
  address: string,
  field: EmailAddressField,
): SQL {
  const term = `%${address}%`;
  if (field === "from") {
    return like(emails.fromAddress, term);
  }
  if (field === "cc") {
    return like(emails.ccAddresses, term);
  }
  return or(like(emails.fromAddress, term), like(emails.ccAddresses, term))!;
}

function buildStarterAddressMatchSql(
  address: string,
  field: EmailAddressField,
): SQL {
  const term = `%${address}%`;
  if (field === "from") {
    return sql`starter.from_address LIKE ${term}`;
  }
  if (field === "cc") {
    return sql`starter.cc_addresses LIKE ${term}`;
  }
  return sql`(starter.from_address LIKE ${term} OR starter.cc_addresses LIKE ${term})`;
}

function buildThreadStarterCondition(
  fromAddresses: string[],
  field: EmailAddressField,
): SQL {
  const addressMatches = fromAddresses.map((address) =>
    buildStarterAddressMatchSql(address, field),
  );
  const addressOr =
    addressMatches.length === 1
      ? addressMatches[0]
      : sql`(${sql.join(addressMatches, sql` OR `)})`;

  return sql`${emails.threadId} IN (
    SELECT starter.thread_id
    FROM emails AS starter
    INNER JOIN (
      SELECT thread_id, MIN(received_at) AS first_at
      FROM emails
      GROUP BY thread_id
    ) AS first_in_thread
      ON first_in_thread.thread_id = starter.thread_id
      AND first_in_thread.first_at = starter.received_at
    WHERE ${addressOr}
  )`;
}

export function buildThreadFilterWhere(filters: EmailThreadFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.fromAddresses?.length) {
    const addressConditions = filters.fromAddresses.map((address) =>
      buildAddressMatchCondition(address, filters.field),
    );
    conditions.push(
      addressConditions.length === 1
        ? addressConditions[0]
        : or(...addressConditions)!,
    );

    if (filters.startedChainOnly) {
      conditions.push(
        buildThreadStarterCondition(filters.fromAddresses, filters.field),
      );
    }
  }

  if (filters.receivedBefore) {
    conditions.push(lte(emails.receivedAt, filters.receivedBefore));
  }

  if (filters.receivedAfter) {
    conditions.push(gte(emails.receivedAt, filters.receivedAfter));
  }

  if (filters.subject) {
    const term = `%${filters.subject.toLowerCase()}%`;
    conditions.push(sql`LOWER(${emails.subject}) LIKE ${term}`);
  }

  if (filters.processedOnly) {
    conditions.push(isNotNull(emails.processedAt));
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}
