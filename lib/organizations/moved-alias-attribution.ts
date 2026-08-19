/** Re-bucket org source-email counts when an alias was moved to another card. */

import type { OrgEntityCard } from "@/lib/email-analysis/org-highlight-shared";
import {
  orgCardMatchesAttachmentTarget,
  type OrgFieldAttachment,
} from "@/lib/organizations/field-attachments";
import {
  normalizeOrgDeniedValue,
  normalizeOrgNameKey,
  orgIdentityKey,
} from "@/lib/organizations/field-denials";

export type OrgNameSighting = {
  emailId: string;
  name: string;
  identityKeys: string[];
};

export type OrgEmailBucket = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  aliases?: string[];
  emailIds: Set<string>;
};

function harvestNameKeys(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const keys = new Set<string>();
  const denied = normalizeOrgDeniedValue("name_alias", trimmed);
  if (denied) keys.add(denied);
  const compact = normalizeOrgNameKey(trimmed);
  if (compact) keys.add(compact);
  return [...keys];
}

/**
 * Map harvest name keys (lowercase + punctuation-stripped) to the target org
 * that now owns that alias. Later attachments win when two moves share a name.
 */
export function movedAliasTargetByNameKey(
  attachments: OrgFieldAttachment[],
  mergeMap: Map<string, string> = new Map(),
): Map<string, OrgFieldAttachment> {
  const out = new Map<string, OrgFieldAttachment>();
  for (const attachment of attachments) {
    if (attachment.field !== "name_alias") continue;
    const resolved: OrgFieldAttachment = {
      ...attachment,
      orgKey: mergeMap.get(attachment.orgKey) ?? attachment.orgKey,
    };
    for (const key of harvestNameKeys(attachment.attachedValue)) {
      out.set(key, resolved);
    }
    if (attachment.valueKey) out.set(attachment.valueKey, resolved);
  }
  return out;
}

function targetForHarvestName(
  name: string,
  byNameKey: Map<string, OrgFieldAttachment>,
): OrgFieldAttachment | null {
  for (const key of harvestNameKeys(name)) {
    const hit = byNameKey.get(key);
    if (hit) return hit;
  }
  return null;
}

function orgIsAttachmentTarget(
  org: Pick<OrgEmailBucket, "id" | "name" | "email" | "phone" | "website" | "aliases">,
  attachment: OrgFieldAttachment,
  mergeMap: Map<string, string>,
): boolean {
  const card: OrgEntityCard = {
    name: org.name,
    organization_role: null,
    email: org.email,
    phone: org.phone,
    website: org.website,
    aliases: [...(org.aliases ?? [])],
  };
  if (orgCardMatchesAttachmentTarget(card, attachment, mergeMap)) return true;
  return (
    orgIdentityKey(card) === attachment.orgKey || org.id === attachment.orgKey
  );
}

export function rebuildOrgEmailIdsFromSightings<T extends OrgEmailBucket>(params: {
  organizations: T[];
  nameSightings: OrgNameSighting[];
  attachments: OrgFieldAttachment[];
  mergeMap?: Map<string, string>;
}): T[] {
  const mergeMap = params.mergeMap ?? new Map();
  const byNameKey = movedAliasTargetByNameKey(params.attachments, mergeMap);

  return params.organizations.map((org) => {
    const ids = new Set<string>();
    const primaryKey = normalizeOrgNameKey(org.name);

    for (const row of params.nameSightings) {
      const aliasTarget = targetForHarvestName(row.name, byNameKey);
      const rowKey = normalizeOrgNameKey(row.name);
      if (!rowKey) continue;

      if (aliasTarget && orgIsAttachmentTarget(org, aliasTarget, mergeMap)) {
        ids.add(row.emailId);
        continue;
      }

      if (primaryKey && rowKey === primaryKey && !aliasTarget) {
        ids.add(row.emailId);
      }
    }

    return { ...org, emailIds: ids };
  });
}

/**
 * Emails harvested under a moved alias follow that alias to the target card.
 * Uses persisted attachments, so moves that already happened still re-bucket.
 *
 * Dual-name emails stay on both: if the same email also harvested the source
 * card's remaining name, it is not removed from the source.
 *
 * @deprecated Prefer rebuildOrgEmailIdsFromSightings with pass-3 sightings.
 */
export function applyMovedAliasEmailAttribution<T extends OrgEmailBucket>(params: {
  organizations: T[];
  attachments: OrgFieldAttachment[];
  sightings: OrgNameSighting[];
  mergeMap?: Map<string, string>;
}): T[] {
  const mergeMap = params.mergeMap ?? new Map();
  const byNameKey = movedAliasTargetByNameKey(params.attachments, mergeMap);
  if (byNameKey.size === 0 || params.sightings.length === 0) {
    return params.organizations;
  }

  const byEmail = new Map<string, OrgNameSighting[]>();
  for (const sighting of params.sightings) {
    const emailId = sighting.emailId.trim();
    const name = sighting.name.trim();
    if (!emailId || !name) continue;
    const list = byEmail.get(emailId) ?? [];
    list.push(sighting);
    byEmail.set(emailId, list);
  }

  const addByTargetId = new Map<string, Set<string>>();
  const removeByIdentity = new Map<string, Set<string>>();

  function addTo(map: Map<string, Set<string>>, key: string, emailId: string) {
    if (!key) return;
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(emailId);
  }

  for (const [emailId, rows] of byEmail) {
    const keptIdentities = new Set<string>();
    const displacedIdentities = new Set<string>();
    const targets: OrgFieldAttachment[] = [];

    for (const row of rows) {
      const target = targetForHarvestName(row.name, byNameKey);
      if (target) {
        targets.push(target);
        for (const key of row.identityKeys) displacedIdentities.add(key);
      } else {
        for (const key of row.identityKeys) keptIdentities.add(key);
      }
    }

    if (targets.length === 0) continue;

    for (const target of targets) {
      addTo(addByTargetId, target.orgKey, emailId);
      if (target.nameKey) addTo(addByTargetId, `name:${target.nameKey}`, emailId);
    }

    for (const key of displacedIdentities) {
      if (keptIdentities.has(key)) continue;
      addTo(removeByIdentity, key, emailId);
    }
  }

  if (addByTargetId.size === 0 && removeByIdentity.size === 0) {
    return params.organizations;
  }

  return params.organizations.map((org) => {
    const nextIds = new Set(org.emailIds);
    const cardKey = orgIdentityKey({
      name: org.name,
      organization_role: null,
      email: org.email,
      phone: org.phone,
      website: org.website,
      aliases: [...(org.aliases ?? [])],
    });

    const removeKeys = [org.id, cardKey];
    for (const key of removeKeys) {
      const stolen = removeByIdentity.get(key);
      if (!stolen) continue;
      for (const emailId of stolen) nextIds.delete(emailId);
    }

    for (const attachment of params.attachments) {
      if (attachment.field !== "name_alias") continue;
      if (!orgIsAttachmentTarget(org, attachment, mergeMap)) continue;
      const extra =
        addByTargetId.get(attachment.orgKey) ??
        (attachment.nameKey ? addByTargetId.get(`name:${attachment.nameKey}`) : null);
      if (!extra) continue;
      for (const emailId of extra) nextIds.add(emailId);
    }

    return { ...org, emailIds: nextIds };
  });
}
