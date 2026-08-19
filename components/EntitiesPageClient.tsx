"use client";

import { useEffect, useRef, useState } from "react";

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
import {
  CONTACT_PERSONS_PAGE_SIZE,
  personDisplayName,
  type ContactRegistryPersonSummary,
} from "@/lib/contacts/registry-shared";
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

function PanelSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
    </div>
  );
}

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

  const [persons, setPersons] = useState(initialPersons);
  const [emails, setEmails] = useState(initialEmails);
  const [stats, setStats] = useState(initialStats);
  const [activity, setActivity] = useState(initialActivity);
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [orgStats, setOrgStats] = useState(initialOrgStats);
  const [projects, setProjects] = useState(initialProjects);
  const [projectStats, setProjectStats] = useState(initialProjectStats);
  const [equipment, setEquipment] = useState(initialEquipment);
  const [equipmentStats, setEquipmentStats] = useState(initialEquipmentStats);
  const [mailboxes, setMailboxes] = useState(initialMailboxes);
  const [mailboxStats, setMailboxStats] = useState(initialMailboxStats);

  const loadedTabs = useRef(new Set<EntityKindTab>([resolvedTab]));
  const [loadingTab, setLoadingTab] = useState<EntityKindTab | null>(null);

  useEffect(() => {
    setEntityTab(resolvedTab);
  }, [resolvedTab]);

  useEffect(() => {
    if (loadedTabs.current.has(entityTab)) return;
    let cancelled = false;
    setLoadingTab(entityTab);

    async function loadTab(tab: EntityKindTab) {
      if (tab === "contacts") {
        const [personsRes, emailsRes, activityRes] = await Promise.all([
          fetch(
            `/api/contacts/registry?view=persons&limit=${CONTACT_PERSONS_PAGE_SIZE}&offset=0&skipVerifiedMentions=1`,
          ),
          fetch("/api/contacts/registry?view=emails&limit=500"),
          fetch("/api/contacts/registry?view=activity&limit=100"),
        ]);
        const [personsJson, emailsJson, activityJson] = await Promise.all([
          personsRes.json() as Promise<{
            persons?: ContactRegistryPersonSummary[];
            stats?: Stats;
          }>,
          emailsRes.json() as Promise<{ emails?: ContactEmailIndexRow[] }>,
          activityRes.json() as Promise<{
            activity?: ContactMergeActivityRow[];
          }>,
        ]);
        if (cancelled) return;
        const nextPersons = (personsJson.persons ?? []).map((p) => ({
          ...p,
          displayName: personDisplayName(p),
        }));
        setPersons(nextPersons);
        setEmails(emailsJson.emails ?? []);
        setActivity(activityJson.activity ?? []);
        if (personsJson.stats) setStats(personsJson.stats);
        loadedTabs.current.add(tab);
        return;
      }
      if (tab === "organizations") {
        const res = await fetch("/api/organizations/registry?limit=500");
        const json = (await res.json()) as {
          organizations?: OrgFingerprintSummary[];
          stats?: OrgFingerprintListStats;
        };
        if (cancelled) return;
        setOrganizations(json.organizations ?? []);
        if (json.stats) setOrgStats(json.stats);
        loadedTabs.current.add(tab);
        return;
      }
      if (tab === "projects") {
        const res = await fetch("/api/projects/registry?limit=500");
        const json = (await res.json()) as {
          projects?: ProjectFingerprintSummary[];
          stats?: ProjectFingerprintListStats;
        };
        if (cancelled) return;
        setProjects(json.projects ?? []);
        if (json.stats) setProjectStats(json.stats);
        loadedTabs.current.add(tab);
        return;
      }
      if (tab === "equipment") {
        const res = await fetch("/api/equipment/registry?limit=500");
        const json = (await res.json()) as {
          equipment?: EquipmentRegistrySummary[];
          stats?: EquipmentRegistryStats;
        };
        if (cancelled) return;
        setEquipment(json.equipment ?? []);
        if (json.stats) setEquipmentStats(json.stats);
        loadedTabs.current.add(tab);
        return;
      }
      const res = await fetch("/api/contacts/registry?view=mailboxes");
      const json = (await res.json()) as {
        mailboxes?: SharedMailboxSummary[];
        stats?: SharedMailboxStats;
      };
      if (cancelled) return;
      setMailboxes(json.mailboxes ?? []);
      if (json.stats) setMailboxStats(json.stats);
      loadedTabs.current.add(tab);
    }

    void loadTab(entityTab).finally(() => {
      if (!cancelled) setLoadingTab(null);
    });
    return () => {
      cancelled = true;
    };
  }, [entityTab]);

  function selectTab(id: EntityKindTab) {
    setEntityTab(id);
    window.history.replaceState(window.history.state, "", `/knowledge/entities?tab=${id}`);
  }

  const tabBusy = loadingTab === entityTab;

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

      {tabBusy ? (
        <PanelSkeleton />
      ) : entityTab === "contacts" ? (
        <ContactsRegistryClient
          initialPersons={persons}
          initialEmails={emails}
          initialStats={stats}
          initialActivity={activity}
        />
      ) : entityTab === "organizations" ? (
        <OrganizationsRegistryClient
          key={`orgs-${organizations.length}-${orgStats.organizationCount}`}
          initialOrganizations={organizations}
          initialStats={orgStats}
        />
      ) : entityTab === "projects" ? (
        <ProjectsRegistryClient
          key={`projects-${projects.length}-${projectStats.projectCount}`}
          initialProjects={projects}
          initialStats={projectStats}
        />
      ) : entityTab === "mailboxes" ? (
        <SharedMailboxesClient
          key={`mailboxes-${mailboxes.length}-${mailboxStats.mailboxCount}`}
          initialMailboxes={mailboxes}
          initialStats={mailboxStats}
        />
      ) : (
        <EquipmentRegistryClient
          key={`equipment-${equipment.length}-${equipmentStats.equipmentCount}`}
          initialEquipment={equipment}
          initialStats={equipmentStats}
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
