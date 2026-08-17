"use client";

import { useMemo, useState } from "react";

import { AdditionalEmailReviewPanel } from "@/components/AdditionalEmailReviewPanel";
import { EntityReviewPanel } from "@/components/EntityReviewPanel";
import {
  ExtractionSidePanel,
  type ExtractionPanelTarget,
} from "@/components/ExtractionSidePanel";
import { InsightsSubTabStrip } from "@/components/InsightsSubTabStrip";
import type { PendingAdditionalEmail } from "@/lib/entities/contact-emails";
import {
  getEntityGroupKind,
  isOrganizationOnlyGroup,
  isPersonContactGroup,
  type ApprovedOrganizationOption,
  type EntityReviewGroup,
} from "@/lib/entities/entity-review";
import type { BuildingEmailReference } from "@/lib/building/resolve-source-email";
import type { OrganizationRoleOption } from "@/lib/vendors/organization-roles";

type EntityKindTab = "all" | "contacts" | "organizations" | "other";

type EntityReviewGroupWithSources = EntityReviewGroup & {
  sourceEmails: BuildingEmailReference[];
};

function filterGroupsByKind(
  groups: EntityReviewGroup[],
  kind: EntityKindTab,
): EntityReviewGroup[] {
  if (kind === "all") return groups;
  if (kind === "contacts") {
    return groups.filter((group) => isPersonContactGroup(group));
  }
  if (kind === "organizations") {
    return groups.filter((group) => isOrganizationOnlyGroup(group));
  }
  return groups.filter((group) => getEntityGroupKind(group) === "other");
}

export function InsightsQueueClient({
  pendingGroups,
  pendingAdditionalEmails,
  approvedOrganizations,
  customOrganizationRoles,
}: {
  pendingGroups: EntityReviewGroupWithSources[];
  pendingAdditionalEmails: PendingAdditionalEmail[];
  approvedOrganizations: ApprovedOrganizationOption[];
  customOrganizationRoles: OrganizationRoleOption[];
}) {
  const [entityKindTab, setEntityKindTab] = useState<EntityKindTab>("all");
  const [extractionTarget, setExtractionTarget] =
    useState<ExtractionPanelTarget | null>(null);

  const pendingEntityCount =
    pendingGroups.length + pendingAdditionalEmails.length;

  const entityKindCounts = useMemo(() => {
    const otherGroupCount = pendingGroups.filter(
      (group) => getEntityGroupKind(group) === "other",
    ).length;

    return {
      all: pendingGroups.length + pendingAdditionalEmails.length,
      contacts: pendingGroups.filter((group) => isPersonContactGroup(group))
        .length,
      organizations: pendingGroups.filter((group) =>
        isOrganizationOnlyGroup(group),
      ).length,
      other: otherGroupCount + pendingAdditionalEmails.length,
    };
  }, [pendingGroups, pendingAdditionalEmails.length]);

  const filteredPendingGroups = useMemo(
    () => filterGroupsByKind(pendingGroups, entityKindTab),
    [pendingGroups, entityKindTab],
  );

  const showAdditionalEmails =
    pendingAdditionalEmails.length > 0 &&
    (entityKindTab === "all" || entityKindTab === "other");

  const filteredPendingCount =
    filteredPendingGroups.length +
    (showAdditionalEmails ? pendingAdditionalEmails.length : 0);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="shrink-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Insights
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">
          Extraction review queue
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Approve or correct entities extracted from email before they join the
          Knowledge registry.
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Unapproved entities
        </h2>
        <InsightsSubTabStrip
          ariaLabel="Entity type filter"
          tabs={[
            { id: "all", label: "All" },
            { id: "contacts", label: "Contacts" },
            { id: "organizations", label: "Organizations" },
            { id: "other", label: "Other" },
          ]}
          active={entityKindTab}
          onChange={setEntityKindTab}
          counts={entityKindCounts}
        />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {filteredPendingGroups.length > 0 ? (
          <EntityReviewPanel
            pendingGroups={filteredPendingGroups}
            approvedOrganizations={approvedOrganizations}
            customOrganizationRoles={customOrganizationRoles}
            onOpenSourceEmail={(emailId) =>
              setExtractionTarget({ kind: "email", emailId })
            }
          />
        ) : null}
        {showAdditionalEmails ? (
          <AdditionalEmailReviewPanel pendingEmails={pendingAdditionalEmails} />
        ) : null}
        {filteredPendingCount === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <p className="text-sm text-slate-600">
              {pendingEntityCount === 0 && entityKindTab === "all"
                ? "No entities waiting for review."
                : "No entities match this filter."}
            </p>
          </div>
        ) : null}
      </div>

      <ExtractionSidePanel
        target={extractionTarget}
        processingEntries={[]}
        onClose={() => setExtractionTarget(null)}
      />
    </section>
  );
}
