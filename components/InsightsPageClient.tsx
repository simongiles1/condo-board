"use client";

import { useMemo, useState } from "react";

import { AdditionalEmailReviewPanel } from "@/components/AdditionalEmailReviewPanel";
import { BudgetYoYChart } from "@/components/BudgetYoYChart";
import { EditableApprovedEntitiesList } from "@/components/EditableApprovedEntitiesList";
import { EditableApprovedOrganizationsGrid } from "@/components/EditableApprovedOrganizationsGrid";
import { EntityReviewPanel } from "@/components/EntityReviewPanel";
import {
  EquipmentTimeline,
  EquipmentViewToggle,
  filterEquipmentEvents,
  type MaintenanceEvent,
} from "@/components/EquipmentTimeline";
import {
  ExtractionSidePanel,
  type ExtractionPanelTarget,
} from "@/components/ExtractionSidePanel";
import { InsightSourceEmailsBadge } from "@/components/InsightSourceEmailsBadge";
import {
  InsightsTabStrip,
  type InsightsTabId,
} from "@/components/InsightsTabStrip";
import { InsightsSubTabStrip } from "@/components/InsightsSubTabStrip";
import type { BuildingEmailReference } from "@/lib/building/resolve-source-email";
import type { PendingAdditionalEmail } from "@/lib/entities/contact-emails";
import {
  getEntityGroupKind,
  isOrganizationOnlyGroup,
  isPersonContactGroup,
  type ApprovedOrganizationCard,
  type ApprovedOrganizationOption,
  type EntityReviewGroup,
} from "@/lib/entities/entity-review";
import type { OrganizationRoleOption } from "@/lib/vendors/organization-roles";

type EntityKindTab = "all" | "contacts" | "organizations" | "other";

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

type BudgetPoint = {
  fiscalYear: number;
  category: string;
  budgeted: number;
  actual: number;
};

type EntityReviewGroupWithSources = EntityReviewGroup & {
  sourceEmails: BuildingEmailReference[];
};

type ApprovedOrganizationCardWithSources = ApprovedOrganizationCard & {
  sourceEmails: BuildingEmailReference[];
};

type ActionItemRow = {
  id: string;
  source: "meeting" | "email";
  assignee: string | null;
  description: string | null;
  deadline: string | null;
  context: string | null;
  sourceEmails: BuildingEmailReference[];
};

type Props = {
  events: MaintenanceEvent[];
  budgetSeries: BudgetPoint[];
  pendingGroups: EntityReviewGroupWithSources[];
  approvedGroups: EntityReviewGroupWithSources[];
  approvedOrganizations: ApprovedOrganizationOption[];
  approvedOrganizationCards: ApprovedOrganizationCardWithSources[];
  pendingAdditionalEmails: PendingAdditionalEmail[];
  actionItems: ActionItemRow[];
  customOrganizationRoles: OrganizationRoleOption[];
};

function emptyState(message: string) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <p className="text-sm text-slate-600">{message}</p>
    </div>
  );
}

export function InsightsPageClient({
  events,
  budgetSeries,
  pendingGroups,
  approvedGroups,
  approvedOrganizations,
  approvedOrganizationCards,
  pendingAdditionalEmails,
  actionItems,
  customOrganizationRoles,
}: Props) {
  const pendingEntityCount =
    pendingGroups.length + pendingAdditionalEmails.length;
  const approvedContactCount = useMemo(
    () => approvedGroups.filter((group) => isPersonContactGroup(group)).length,
    [approvedGroups],
  );

  const [activeTab, setActiveTab] = useState<InsightsTabId>("entities");
  const [entityKindTab, setEntityKindTab] = useState<EntityKindTab>("all");
  const [showAllEquipment, setShowAllEquipment] = useState(false);
  const [extractionTarget, setExtractionTarget] =
    useState<ExtractionPanelTarget | null>(null);

  function openSourceEmail(emailId: string) {
    setExtractionTarget({ kind: "email", emailId });
  }

  const visibleEquipmentEvents = useMemo(
    () => filterEquipmentEvents(events, showAllEquipment),
    [events, showAllEquipment],
  );

  const hiddenEquipmentCount = useMemo(
    () => events.length - filterEquipmentEvents(events, false).length,
    [events],
  );

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

  const counts = useMemo(
    () => ({
      entities: pendingEntityCount,
      contacts: approvedContactCount,
      equipment: visibleEquipmentEvents.length,
      budget: budgetSeries.length,
      "approved-organizations": approvedOrganizationCards.length,
      "action-items": actionItems.length,
    }),
    [
      pendingEntityCount,
      approvedContactCount,
      visibleEquipmentEvents.length,
      budgetSeries.length,
      approvedOrganizationCards.length,
      actionItems.length,
    ],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="shrink-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Knowledge base
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">Insights</h1>
      </div>

      <div className="shrink-0">
        <InsightsTabStrip
          active={activeTab}
          onChange={setActiveTab}
          counts={counts}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "equipment" ? (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">
                Equipment &amp; maintenance
              </h2>
              <EquipmentViewToggle
                showAll={showAllEquipment}
                onChange={setShowAllEquipment}
                hiddenCount={hiddenEquipmentCount}
              />
            </div>
            <EquipmentTimeline
              events={visibleEquipmentEvents}
              onOpenSourceEmail={openSourceEmail}
            />
          </section>
        ) : null}

        {activeTab === "budget" ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">
              Budget year-over-year
            </h2>
            <BudgetYoYChart series={budgetSeries} />
          </section>
        ) : null}

        {activeTab === "entities" ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
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

            <div className="space-y-4">
              {filteredPendingGroups.length > 0 ? (
                <EntityReviewPanel
                  pendingGroups={filteredPendingGroups}
                  approvedOrganizations={approvedOrganizations}
                  customOrganizationRoles={customOrganizationRoles}
                  onOpenSourceEmail={openSourceEmail}
                />
              ) : null}
              {showAdditionalEmails ? (
                <AdditionalEmailReviewPanel
                  pendingEmails={pendingAdditionalEmails}
                />
              ) : null}
              {filteredPendingCount === 0
                ? emptyState(
                    pendingEntityCount === 0 && entityKindTab === "all"
                      ? "No entities waiting for review."
                      : "No entities match this filter.",
                  )
                : null}
            </div>
          </section>
        ) : null}

        {activeTab === "contacts" ? (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Contacts ({approvedContactCount})
            </h2>
            <EditableApprovedEntitiesList
              groups={approvedGroups.filter((group) =>
                isPersonContactGroup(group),
              )}
              approvedOrganizations={approvedOrganizations}
              customOrganizationRoles={customOrganizationRoles}
              onOpenSourceEmail={openSourceEmail}
            />
          </section>
        ) : null}

        {activeTab === "approved-organizations" ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">
              Organizations ({approvedOrganizationCards.length})
            </h2>
            <EditableApprovedOrganizationsGrid
              organizations={approvedOrganizationCards}
              customOrganizationRoles={customOrganizationRoles}
              onOpenSourceEmail={openSourceEmail}
            />
          </section>
        ) : null}

        {activeTab === "action-items" ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">
              Unified action items ({actionItems.length})
            </h2>
            {actionItems.length > 0 ? (
              <div className="space-y-2">
                {actionItems.map((item) => (
                  <div
                    key={`${item.source}-${item.id}`}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {item.description}
                      </p>
                      {item.sourceEmails.length > 0 ? (
                        <InsightSourceEmailsBadge
                          emails={item.sourceEmails}
                          onOpenEmail={openSourceEmail}
                        />
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {item.assignee} · {item.source} · {item.context}
                      {item.deadline ? ` · due ${item.deadline}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              emptyState("No open action items yet.")
            )}
          </section>
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
