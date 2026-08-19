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
  const [
    persons,
    emails,
    stats,
    activity,
    orgList,
    projectList,
    equipmentList,
    mailboxList,
  ] =
    await Promise.all([
      loadContactRegistryPersons({
        limit: CONTACT_PERSONS_PAGE_SIZE,
        offset: 0,
        sort: "mentions-desc",
      }),
      loadContactEmailIndex(500),
      getRegistryStats(),
      loadContactMergeActivity(100),
      loadOrgFingerprintSummaries({ limit: 500 }),
      loadProjectFingerprintSummaries({ limit: 500 }),
      loadEquipmentRegistry({ limit: 500 }),
      loadSharedMailboxes(),
    ]);

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
      initialOrganizations={orgList.organizations}
      initialOrgStats={orgList.stats}
      initialProjects={projectList.projects}
      initialProjectStats={projectList.stats}
      initialEquipment={equipmentList.equipment}
      initialEquipmentStats={equipmentList.stats}
      initialMailboxes={mailboxList.mailboxes}
      initialMailboxStats={mailboxList.stats}
    />
  );
}
