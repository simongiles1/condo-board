"use client";

import { useEffect, useState } from "react";

import { ContactsRegistryClient } from "@/components/ContactsRegistryClient";
import { EquipmentRegistryClient } from "@/components/EquipmentRegistryClient";
import { MentionsChartDialog } from "@/components/MentionsChartDialog";
import { OrganizationsRegistryClient } from "@/components/OrganizationsRegistryClient";
import { ProjectsRegistryClient } from "@/components/ProjectsRegistryClient";
import { SharedMailboxesClient } from "@/components/SharedMailboxesClient";
import type {
  ContactEmailIndexRow,
  ContactMergeActivityRow,
} from "@/lib/contacts/registry-load";
import type { ContactRegistryPersonSummary } from "@/lib/contacts/registry-shared";
import type {
  EquipmentRegistryStats,
  EquipmentRegistrySummary,
} from "@/lib/equipment/registry";
import {
  type EntityKindTab,
  parseEntityKindTab,
} from "@/lib/nav/structure";
import type {
  OrgFingerprintListStats,
  OrgFingerprintSummary,
} from "@/lib/organizations/fingerprint-list";
import type {
  ProjectFingerprintListStats,
  ProjectFingerprintSummary,
} from "@/lib/projects/fingerprint-list";
import type {
  SharedMailboxStats,
  SharedMailboxSummary,
} from "@/lib/contacts/shared-mailboxes";

type PersonRow = ContactRegistryPersonSummary & { displayName: string };

type Stats = {
  personCount: number;
  emailCount: number;
  sparseStubCount: number;
  pendingMergeCount: number;
  mergeDecisionCount?: number;
  ingestCompletedCount?: number;
  mentionTotalCount?: number;
  mentionConfirmedCount?: number;
  mentionProvisionalCount?: number;
  mentionUnresolvedCount?: number;
};

const ENTITY_TABS: Array<{ id: EntityKindTab; label: string }> = [
  { id: "contacts", label: "Contacts" },
  { id: "organizations", label: "Organizations" },
  { id: "projects", label: "Projects" },
  { id: "equipment", label: "Equipment" },
  { id: "mailboxes", label: "Shared mailboxes" },
];

export function EntitiesPageClient({
  initialTab,
  initialPersons,
  initialEmails,
  initialStats,
  initialActivity = [],
  initialOrganizations = [],
  initialOrgStats = {
    organizationCount: 0,
    mergeCount: 0,
    emailCount: 0,
  },
  initialProjects = [],
  initialProjectStats = {
    projectCount: 0,
    mergeCount: 0,
    emailCount: 0,
  },
  initialEquipment = [],
  initialEquipmentStats = {
    equipmentCount: 0,
    eventCount: 0,
  },
  initialMailboxes = [],
  initialMailboxStats = {
    mailboxCount: 0,
    occupantCount: 0,
  },
}: {
  initialTab?: string;
  initialPersons: PersonRow[];
  initialEmails: ContactEmailIndexRow[];
  initialStats: Stats;
  initialActivity?: ContactMergeActivityRow[];
  initialOrganizations?: OrgFingerprintSummary[];
  initialOrgStats?: OrgFingerprintListStats;
  initialProjects?: ProjectFingerprintSummary[];
  initialProjectStats?: ProjectFingerprintListStats;
  initialEquipment?: EquipmentRegistrySummary[];
  initialEquipmentStats?: EquipmentRegistryStats;
  initialMailboxes?: SharedMailboxSummary[];
  initialMailboxStats?: SharedMailboxStats;
}) {
  const resolvedTab = parseEntityKindTab(initialTab);
  const [entityTab, setEntityTab] = useState<EntityKindTab>(resolvedTab);
  const [chartOpen, setChartOpen] = useState(false);

  useEffect(() => {
    setEntityTab(resolvedTab);
  }, [resolvedTab]);

  function selectTab(id: EntityKindTab) {
    setEntityTab(id);
    window.history.replaceState(window.history.state, "", `/knowledge/entities?tab=${id}`);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">Entities</h1>
          {entityTab !== "mailboxes" ? (
            <button
              type="button"
              onClick={() => setChartOpen(true)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Mention frequency
            </button>
          ) : null}
        </div>

        <div
          className="mt-4 inline-flex max-w-full flex-wrap rounded-xl border border-slate-200 bg-slate-100 p-1"
          role="tablist"
          aria-label="Entity kinds"
        >
          {ENTITY_TABS.map((tab) => {
            const selected = entityTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => selectTab(tab.id)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  selected
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {entityTab === "contacts" ? (
        <ContactsRegistryClient
          initialPersons={initialPersons}
          initialEmails={initialEmails}
          initialStats={initialStats}
          initialActivity={initialActivity}
        />
      ) : entityTab === "organizations" ? (
        <OrganizationsRegistryClient
          initialOrganizations={initialOrganizations}
          initialStats={initialOrgStats}
        />
      ) : entityTab === "projects" ? (
        <ProjectsRegistryClient
          initialProjects={initialProjects}
          initialStats={initialProjectStats}
        />
      ) : entityTab === "mailboxes" ? (
        <SharedMailboxesClient
          initialMailboxes={initialMailboxes}
          initialStats={initialMailboxStats}
        />
      ) : (
        <EquipmentRegistryClient
          initialEquipment={initialEquipment}
          initialStats={initialEquipmentStats}
        />
      )}

      <MentionsChartDialog
        open={chartOpen}
        onClose={() => setChartOpen(false)}
        initialEntity={
          entityTab === "organizations"
            ? "organizations"
            : entityTab === "projects"
              ? "projects"
              : "contacts"
        }
      />
    </div>
  );
}
