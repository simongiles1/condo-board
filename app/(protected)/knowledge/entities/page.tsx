export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { EntitiesPageClient } from "@/components/EntitiesPageClient";
import {
  getRegistryStats,
  loadContactEmailIndex,
  loadContactMergeActivity,
  loadContactRegistryPersons,
  loadSharedMailboxes,
} from "@/lib/contacts/registry-load";
import {
  CONTACT_PERSONS_PAGE_SIZE,
  personDisplayName,
} from "@/lib/contacts/registry-shared";
import { loadEquipmentRegistry } from "@/lib/equipment/registry";
import { parseEntityKindTab } from "@/lib/nav/structure";
import { loadOrgFingerprintSummaries } from "@/lib/organizations/fingerprint-list";
import { loadProjectFingerprintSummaries } from "@/lib/projects/fingerprint-list";

export default async function EntitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tabParam = params.tab;
  const initialTab = parseEntityKindTab(
    Array.isArray(tabParam) ? tabParam[0] : tabParam,
  );

  const started = Date.now();
  // Only the visible tab is loaded on the server. The other tabs fetch on
  // first click so Contacts / Todos / nav is not blocked by org rebuilds.
  const [
    persons,
    emails,
    stats,
    activity,
    orgList,
    projectList,
    equipmentList,
    mailboxList,
  ] = await Promise.all([
    initialTab === "contacts"
      ? loadContactRegistryPersons({
          limit: CONTACT_PERSONS_PAGE_SIZE,
          offset: 0,
          sort: "mentions-desc",
          skipVerifiedMentions: true,
        })
      : Promise.resolve([]),
    initialTab === "contacts"
      ? loadContactEmailIndex(500)
      : Promise.resolve([]),
    initialTab === "contacts"
      ? getRegistryStats()
      : Promise.resolve({
          personCount: 0,
          emailCount: 0,
          sparseStubCount: 0,
          pendingMergeCount: 0,
          mergeDecisionCount: 0,
          ingestCompletedCount: 0,
          mentionTotalCount: 0,
          mentionConfirmedCount: 0,
          mentionProvisionalCount: 0,
          mentionUnresolvedCount: 0,
        }),
    initialTab === "contacts"
      ? loadContactMergeActivity(100)
      : Promise.resolve([]),
    initialTab === "organizations"
      ? loadOrgFingerprintSummaries({ limit: 500 })
      : Promise.resolve(null),
    initialTab === "projects"
      ? loadProjectFingerprintSummaries({ limit: 500 })
      : Promise.resolve(null),
    initialTab === "equipment"
      ? loadEquipmentRegistry({ limit: 500 })
      : Promise.resolve(null),
    initialTab === "mailboxes"
      ? loadSharedMailboxes()
      : Promise.resolve(null),
  ]);
  console.info("[entities:page]", {
    tab: initialTab,
    ms: Date.now() - started,
  });

  return (
    <EntitiesPageClient
      initialTab={initialTab}
      initialPersons={persons.map((p) => ({
        ...p,
        displayName: personDisplayName(p),
      }))}
      initialEmails={emails}
      initialStats={stats}
      initialActivity={activity}
      initialOrganizations={orgList?.organizations ?? []}
      initialOrgStats={
        orgList?.stats ?? {
          organizationCount: 0,
          mergeCount: 0,
          emailCount: 0,
        }
      }
      initialProjects={projectList?.projects ?? []}
      initialProjectStats={
        projectList?.stats ?? {
          projectCount: 0,
          mergeCount: 0,
          emailCount: 0,
        }
      }
      initialEquipment={equipmentList?.equipment ?? []}
      initialEquipmentStats={
        equipmentList?.stats ?? {
          equipmentCount: 0,
          eventCount: 0,
        }
      }
      initialMailboxes={mailboxList?.mailboxes ?? []}
      initialMailboxStats={
        mailboxList?.stats ?? {
          mailboxCount: 0,
          occupantCount: 0,
        }
      }
    />
  );
}
