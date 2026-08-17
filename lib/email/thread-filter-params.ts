export type EmailAddressField = "from" | "cc" | "both";

export type EmailInboxView = "messages" | "threads";

export type EmailDetailScope = "message" | "thread";

export const EMAIL_MESSAGE_SCOPE: EmailDetailScope = "message";
export const EMAIL_THREAD_SCOPE: EmailDetailScope = "thread";

export type EmailThreadFilters = {
  fromAddresses?: string[];
  field: EmailAddressField;
  startedChainOnly?: boolean;
  processedOnly?: boolean;
  subject?: string;
  receivedBefore?: string;
  receivedAfter?: string;
  page?: number;
  view: EmailInboxView;
};

const DEFAULT_FIELD: EmailAddressField = "both";
const DEFAULT_VIEW: EmailInboxView = "threads";

export function parseEmailThreadFilters(
  searchParams: Record<string, string | string[] | undefined>,
): EmailThreadFilters {
  const rawPage = pickParam(searchParams.page);
  const page = Number.parseInt(rawPage ?? "1", 10);

  const fieldParam = pickParam(searchParams.field);
  const field: EmailAddressField =
    fieldParam === "from" || fieldParam === "cc" || fieldParam === "both"
      ? fieldParam
      : DEFAULT_FIELD;

  const fromAddresses = pickParamArray(searchParams.from);
  const startedChainOnly = pickParam(searchParams.startedChain) === "1";
  const processedOnly = pickParam(searchParams.processed) === "1";

  const viewParam = pickParam(searchParams.view);
  const view: EmailInboxView =
    viewParam === "messages" || viewParam === "threads" ? viewParam : DEFAULT_VIEW;

  const subject = normalizeSubjectFilter(pickParam(searchParams.subject));

  return {
    fromAddresses: fromAddresses.length > 0 ? fromAddresses : undefined,
    field,
    startedChainOnly:
      startedChainOnly && fromAddresses.length > 0 ? true : undefined,
    processedOnly: processedOnly ? true : undefined,
    subject,
    receivedBefore: pickParam(searchParams.receivedBefore) || undefined,
    receivedAfter: pickParam(searchParams.receivedAfter) || undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    view,
  };
}

export function hasActiveFilters(filters: EmailThreadFilters): boolean {
  return Boolean(
    filters.fromAddresses?.length ||
      filters.processedOnly ||
      filters.subject ||
      filters.receivedBefore ||
      filters.receivedAfter,
  );
}

export function buildEmailThreadSearchParams(
  filters: EmailThreadFilters,
): URLSearchParams {
  const params = new URLSearchParams();

  for (const email of filters.fromAddresses ?? []) {
    params.append("from", email);
  }
  if (filters.field !== DEFAULT_FIELD) params.set("field", filters.field);
  if (filters.startedChainOnly) params.set("startedChain", "1");
  if (filters.processedOnly) params.set("processed", "1");
  if (filters.subject) params.set("subject", filters.subject);
  if (filters.receivedBefore) params.set("receivedBefore", filters.receivedBefore);
  if (filters.receivedAfter) params.set("receivedAfter", filters.receivedAfter);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  if (filters.view !== DEFAULT_VIEW) params.set("view", filters.view);

  return params;
}

export function emailThreadsPageHref(filters: EmailThreadFilters, page = 1): string {
  const params = buildEmailThreadSearchParams({ ...filters, page });
  const qs = params.toString();
  return qs ? `/knowledge/emails?${qs}` : "/knowledge/emails";
}

export function parseEmailDetailScope(
  searchParams: Record<string, string | string[] | undefined>,
): EmailDetailScope {
  return pickParam(searchParams.scope) === EMAIL_MESSAGE_SCOPE
    ? EMAIL_MESSAGE_SCOPE
    : EMAIL_THREAD_SCOPE;
}

export function emailMessageDetailHref(
  messageId: string,
  filters?: EmailThreadFilters,
): string {
  const params = filters
    ? buildEmailThreadSearchParams({ ...filters, view: "messages", page: 1 })
    : new URLSearchParams();
  params.set("scope", EMAIL_MESSAGE_SCOPE);
  return `/knowledge/emails/${messageId}?${params.toString()}`;
}

export function emailThreadDetailHref(threadId: string): string {
  return `/knowledge/emails/${threadId}`;
}

export function emailDetailBackHref(
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const scope = parseEmailDetailScope(searchParams);
  const filters = parseEmailThreadFilters(searchParams);
  if (scope === EMAIL_MESSAGE_SCOPE) {
    return emailThreadsPageHref({ ...filters, view: "messages" });
  }
  return emailThreadsPageHref({ ...filters, view: "threads" });
}

export function searchParamsToFilterRecord(
  searchParams: URLSearchParams,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    result[key] = values.length === 1 ? values[0] : values;
  }
  return result;
}

function pickParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeSubjectFilter(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function pickParamArray(value: string | string[] | undefined): string[] {
  if (!value) return [];

  const rawValues = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of rawValues) {
    for (const part of raw.split(",")) {
      const normalized = part.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}
