import {
  entityTypeBadgeClass,
  type DedupedEntity,
} from "@/lib/email/entity-dedup";
import {
  formatProvenanceLabel,
  groupEntitiesForAudit,
  isAuditEntityType,
  type ContactAuditGroup,
  type EntityAuditInput,
  type EntityProvenance,
  type EntityWithProvenance,
} from "@/lib/email/entity-grouping";
import type { ExtractionAuditItem } from "@/lib/email/extraction-audit";
import type { ThreadEntityReviewGroup } from "@/lib/entities/entity-review";

function parseEntityFromAuditItem(item: ExtractionAuditItem): DedupedEntity | null {
  if (item.entity) {
    return {
      type: item.entity.type,
      value: item.entity.value,
      contexts: item.entity.contexts,
    };
  }

  const match = item.summary.match(/^([^:]+):\s*(.+?)(?:\s+—\s+(.*))?$/);
  if (!match) return null;

  return {
    type: match[1].trim(),
    value: match[2].trim(),
    contexts: match[3] ? [match[3].trim()] : [],
  };
}

function auditItemsToEntityInputs(
  items: ExtractionAuditItem[],
): EntityAuditInput[] {
  const inputs: EntityAuditInput[] = [];

  for (const item of items) {
    const entity = parseEntityFromAuditItem(item);
    if (!entity || !isAuditEntityType(entity.type)) continue;

    inputs.push({
      type: entity.type,
      value: entity.value,
      contexts: entity.contexts,
      sourceEmailId: item.sourceEmailId,
      sourceEmailFrom: item.sourceEmailFrom,
      sourceEmailSubject: item.sourceEmailSubject,
      vendorCandidate: item.entity?.vendorCandidate,
    });
  }

  return inputs;
}

function sourceKey(source: EntityProvenance): string {
  return `${source.emailId ?? ""}|${source.emailFrom ?? ""}|${source.emailSubject ?? ""}`;
}

function ContactField({
  label,
  entity,
  highlightEmailId,
  multiSource,
}: {
  label: string;
  entity: EntityWithProvenance;
  highlightEmailId?: string | null;
  multiSource: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${entityTypeBadgeClass(entity.type)}`}
          >
            {label}
          </span>
          <span className="font-medium text-slate-900">{entity.value}</span>
        </div>
      </div>
      {multiSource ? (
        <div className="flex flex-wrap justify-end gap-1">
          {entity.sources.map((source) => {
            const highlighted =
              highlightEmailId && source.emailId === highlightEmailId;
            return (
              <span
                key={sourceKey(source)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${
                  highlighted
                    ? "bg-teal-50 text-teal-800 ring-teal-200"
                    : "bg-slate-100 text-slate-600 ring-slate-200"
                }`}
                title={source.emailSubject ?? source.emailFrom ?? undefined}
              >
                {formatProvenanceLabel(source)}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ContactAuditCard({
  group,
  highlightEmailId,
  multiSource,
  reviewStatus,
}: {
  group: ContactAuditGroup;
  highlightEmailId?: string | null;
  multiSource: boolean;
  reviewStatus?: "pending" | "approved";
}) {
  const title =
    group.person?.value ??
    group.org?.value ??
    group.phone?.value ??
    group.unit?.value ??
    "Contact";

  const fields = [group.person, group.org, group.phone, group.unit].filter(
    Boolean,
  );
  const hasMultipleFields = fields.length > 1;

  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {reviewStatus === "approved" ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-200">
            Approved
          </span>
        ) : null}
        {reviewStatus === "pending" ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-amber-200">
            Pending review
          </span>
        ) : null}
        <p className="font-semibold text-slate-900">{title}</p>
        {group.vendorCandidate ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-amber-200">
            Vendor candidate
          </span>
        ) : null}
      </div>

      <div
        className={`space-y-2 ${hasMultipleFields ? "mt-2 border-t border-slate-200/80 pt-2" : "mt-2"}`}
      >
        {group.person ? (
          <ContactField
            label="person"
            entity={group.person}
            highlightEmailId={highlightEmailId}
            multiSource={multiSource}
          />
        ) : null}
        {group.org ? (
          <ContactField
            label="org"
            entity={group.org}
            highlightEmailId={highlightEmailId}
            multiSource={multiSource}
          />
        ) : null}
        {group.phone ? (
          <ContactField
            label="phone"
            entity={group.phone}
            highlightEmailId={highlightEmailId}
            multiSource={multiSource}
          />
        ) : null}
        {group.unit ? (
          <ContactField
            label="unit"
            entity={group.unit}
            highlightEmailId={highlightEmailId}
            multiSource={multiSource}
          />
        ) : null}
      </div>

      {group.linkContext ? (
        <p className="mt-2 whitespace-pre-wrap border-l-2 border-slate-200 pl-2 text-xs leading-relaxed text-slate-600">
          {group.linkContext}
        </p>
      ) : null}
    </li>
  );
}

export function NamedEntitiesList({
  items,
  highlightEmailId,
}: {
  items: ExtractionAuditItem[];
  highlightEmailId?: string | null;
}) {
  const inputs = auditItemsToEntityInputs(items);
  const groups = groupEntitiesForAudit(inputs);
  const uniqueSources = new Set(
    inputs.map(
      (input) =>
        `${input.sourceEmailId ?? ""}|${input.sourceEmailFrom ?? ""}|${input.sourceEmailSubject ?? ""}`,
    ),
  );
  const multiSource = uniqueSources.size > 1;

  if (groups.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No contacts or organizations were extracted for audit.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {multiSource ? (
        <p className="text-xs text-slate-500">
          All people and organizations found in this thread, grouped by shared email
          context. Teal tags show which email each field came from. Amber{" "}
          <span className="font-medium">Vendor candidate</span> marks orgs the AI
          also flagged for vendor review — confirm or reclassify on Insights.
        </p>
      ) : (
        <p className="text-xs text-slate-500">
          All people and organizations found in this extraction. Amber{" "}
          <span className="font-medium">Vendor candidate</span> marks orgs also
          flagged under Vendors &amp; contracts for your review.
        </p>
      )}
      <ul className="space-y-2">
        {groups.map((group) => (
          <ContactAuditCard
            key={group.key}
            group={group}
            highlightEmailId={highlightEmailId}
            multiSource={multiSource}
          />
        ))}
      </ul>
    </div>
  );
}

export function ThreadEntityReviewList({
  groups,
}: {
  groups: ThreadEntityReviewGroup[];
}) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No named entities saved for this thread yet.
      </p>
    );
  }

  const approvedCount = groups.filter(
    (group) => group.reviewStatus === "approved",
  ).length;
  const pendingCount = groups.length - approvedCount;

  return (
    <div className="space-y-3">
      {approvedCount > 0 && pendingCount > 0 ? (
        <p className="text-xs text-slate-500">
          {approvedCount} approved contact{approvedCount === 1 ? "" : "s"},{" "}
          {pendingCount} pending review.
        </p>
      ) : null}
      <ul className="space-y-2">
        {groups.map((group) => (
          <ContactAuditCard
            key={`${group.key}:${group.reviewStatus}`}
            group={group}
            multiSource={false}
            reviewStatus={group.reviewStatus}
          />
        ))}
      </ul>
    </div>
  );
}

export function ApprovedEntitiesList({
  groups,
}: {
  groups: ContactAuditGroup[];
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <p className="text-sm text-slate-600">
          No approved contacts yet. Review extracted entities above after analyzing
          emails.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {groups.map((group) => (
        <ContactAuditCard
          key={group.key}
          group={group}
          multiSource={false}
        />
      ))}
    </ul>
  );
}

export function NamedEntitiesInsightsGrid({
  entities,
}: {
  entities: Array<{ type: string; value: string; context?: string | null }>;
}) {
  const groups = groupEntitiesForAudit(
    entities
      .filter((entity) => isAuditEntityType(entity.type))
      .map((entity) => ({
        type: entity.type,
        value: entity.value,
        contexts: entity.context ? [entity.context] : [],
        sourceEmailId: null,
        sourceEmailFrom: null,
        sourceEmailSubject: null,
      })),
  );

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <p className="text-sm text-slate-600">
          No contacts or organizations yet. Analyze emails to populate people and
          vendors mentioned in correspondence.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {groups.map((group) => {
        const title =
          group.person?.value ??
          group.org?.value ??
          group.phone?.value ??
          "Contact";

        return (
          <div
            key={group.key}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <p className="font-semibold text-slate-900">{title}</p>
            <div className="mt-2 space-y-1.5 text-sm text-slate-700">
              {group.org && group.org.value !== title ? (
                <p>{group.org.value}</p>
              ) : null}
              {group.phone ? <p>{group.phone.value}</p> : null}
              {group.unit ? <p>Unit {group.unit.value}</p> : null}
            </div>
            {group.linkContext ? (
              <p className="mt-2 line-clamp-2 text-xs text-slate-500">
                {group.linkContext}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
