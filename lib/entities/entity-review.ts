/** Build entity review groups and match against approved registry. */

import {
  entityDedupKey,
  entitiesMatch,
  normalizeOrgName,
  normalizePersonName,
} from "@/lib/email/entity-dedup";
import {
  groupEntitiesForAudit,
  isAuditEntityType,
  type ContactAuditGroup,
  type EntityAuditInput,
} from "@/lib/email/entity-grouping";

export type EntityMentionRow = {
  id: string;
  entityType: string;
  entityValue: string;
  context: string | null;
  reviewStatus: string;
  organizationRole: string | null;
  vendorCandidate: boolean;
  dedupKey: string | null;
  personTitle?: string | null;
  linkedOrganizationName?: string | null;
  contactEmail?: string | null;
  sourceId?: string | null;
};

export type ApprovedOrganizationOption = {
  name: string;
  organizationRole: string | null;
};

export type ApprovedOrganizationCard = ApprovedOrganizationOption & {
  vendorId: string | null;
  mentionIds: string[];
  contactEmail?: string | null;
  phone?: string | null;
};

export function extractEmailFromText(text: string | null | undefined): string {
  if (!text?.trim()) return "";

  const fromMatch = text.match(/From:\s*<?([\w.+-]+@[\w.-]+\.\w+)>?/i);
  if (fromMatch) return fromMatch[1].toLowerCase();

  const match = text.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return match?.[0].toLowerCase() ?? "";
}

export function splitPersonName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const trimmed = fullName.trim();
  if (!trimmed) return { firstName: "", lastName: "" };

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

export function joinPersonName(firstName: string, lastName: string): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
}

function contextNameMatchesPerson(
  contextName: string,
  personName: string,
): boolean {
  const normalizedContext = normalizePersonName(contextName);
  const normalizedPerson = normalizePersonName(personName);
  if (!normalizedContext || !normalizedPerson) return false;
  if (normalizedContext === normalizedPerson) return true;
  return (
    normalizedPerson.startsWith(`${normalizedContext} `) ||
    normalizedContext.startsWith(`${normalizedPerson} `)
  );
}

/** Parse "Name, Title, Organization" signature-style context lines. */
export function parseStructuredContactContext(
  context: string,
  personName?: string,
): { title?: string; org?: string } {
  const trimmed = context.trim();
  if (!trimmed) return {};

  const parts = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return {};

  const [namePart, titlePart, ...orgParts] = parts;
  const org = orgParts.join(", ").trim();
  if (!titlePart || !org) return {};

  if (personName && !contextNameMatchesPerson(namePart, personName)) {
    return {};
  }

  return { title: titlePart, org };
}

export function findMatchingApprovedOrganization(
  orgName: string,
  options: ApprovedOrganizationOption[],
): ApprovedOrganizationOption | undefined {
  const trimmed = orgName.trim();
  if (!trimmed) return undefined;

  return options.find((option) =>
    entitiesMatch(
      { type: "org", value: option.name },
      { type: "org", value: trimmed },
    ),
  );
}

export function getExtractedOrgNameForGroup(group: EntityReviewGroup): string {
  return (
    group.extractedOrgName?.trim() ||
    group.org?.value?.trim() ||
    ""
  );
}

export function sortEntityReviewGroupsForApproval(
  groups: EntityReviewGroup[],
): EntityReviewGroup[] {
  return [...groups].sort((a, b) => {
    const aIsOrg = Boolean(a.org) && !a.person;
    const bIsOrg = Boolean(b.org) && !b.person;
    if (aIsOrg !== bIsOrg) return aIsOrg ? -1 : 1;

    const aLabel =
      a.person?.value ?? a.org?.value ?? a.unit?.value ?? "";
    const bLabel =
      b.person?.value ?? b.org?.value ?? b.unit?.value ?? "";
    return aLabel.localeCompare(bLabel);
  });
}

export function isPersonContactGroup(group: EntityReviewGroup): boolean {
  return Boolean(group.person);
}

export function isOrganizationOnlyGroup(group: EntityReviewGroup): boolean {
  return Boolean(group.org) && !group.person;
}

export type EntityGroupKind = "contacts" | "organizations" | "other";

export function getEntityGroupKind(group: EntityReviewGroup): EntityGroupKind {
  if (isPersonContactGroup(group)) return "contacts";
  if (isOrganizationOnlyGroup(group)) return "organizations";
  return "other";
}

export type EditableEntityKind = "contact" | "organization";

export function entityKindFromGroup(group: EntityReviewGroup): EditableEntityKind {
  return isPersonContactGroup(group) ? "contact" : "organization";
}

export function targetEntityTypeFromKind(
  kind: EditableEntityKind,
): "person" | "org" {
  return kind === "contact" ? "person" : "org";
}

export function applyEntityKindChange(
  draft: {
    entityKind: EditableEntityKind;
    firstName: string;
    lastName: string;
    orgValue: string;
  },
  nextKind: EditableEntityKind,
): Pick<
  {
    entityKind: EditableEntityKind;
    firstName: string;
    lastName: string;
    orgValue: string;
  },
  "entityKind" | "firstName" | "lastName" | "orgValue"
> {
  if (draft.entityKind === nextKind) {
    return {
      entityKind: nextKind,
      firstName: draft.firstName,
      lastName: draft.lastName,
      orgValue: draft.orgValue,
    };
  }

  if (nextKind === "contact") {
    const trimmedOrg = draft.orgValue.trim();
    if (trimmedOrg && !draft.firstName.trim() && !draft.lastName.trim()) {
      const parts = trimmedOrg.split(/\s+/);
      return {
        entityKind: nextKind,
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
        orgValue: draft.orgValue,
      };
    }

    return {
      entityKind: nextKind,
      firstName: draft.firstName,
      lastName: draft.lastName,
      orgValue: draft.orgValue,
    };
  }

  const joinedName = joinPersonName(draft.firstName, draft.lastName);
  return {
    entityKind: nextKind,
    firstName: draft.firstName,
    lastName: draft.lastName,
    orgValue: joinedName || draft.orgValue,
  };
}

export type EntityReviewGroup = ContactAuditGroup & {
  mentionIds: string[];
  /** Job title parsed from extraction metadata or context snippet. */
  personTitle?: string | null;
  /** Organization this contact belongs to (may still be pending approval). */
  extractedOrgName?: string | null;
  /** Approved email addresses linked to this person contact. */
  contactEmails?: string[];
};

export function isUsefulContactGroup(group: ContactAuditGroup): boolean {
  return Boolean(group.person || group.org || group.unit);
}

function collectMentionIds(group: ContactAuditGroup): string[] {
  const ids = new Set<string>();
  for (const field of [group.person, group.org, group.phone, group.unit]) {
    if (!field) continue;
    for (const mentionId of field.mentionIds) {
      ids.add(mentionId);
    }
  }
  return [...ids];
}

export function entityMentionToAuditInput(row: EntityMentionRow): EntityAuditInput {
  return {
    type: row.entityType,
    value: row.entityValue,
    contexts: row.context ? [row.context] : [],
    mentionId: row.id,
    vendorCandidate: row.vendorCandidate,
    sourceEmailId: null,
    sourceEmailFrom: null,
    sourceEmailSubject: null,
  };
}

export function buildEntityReviewGroups(
  rows: EntityMentionRow[],
): EntityReviewGroup[] {
  const inputs = rows
    .filter((row) => isAuditEntityType(row.entityType))
    .map(entityMentionToAuditInput);

  const groups = groupEntitiesForAudit(inputs)
    .filter(isUsefulContactGroup)
    .map((group) => ({
      ...group,
      mentionIds: collectMentionIds(group),
    }))
    .filter((group) => group.mentionIds.length > 0);

  return applyLinkedOrganizations(groups, rows).map((group) =>
    enrichGroupWithPersonMetadata(group, rows),
  );
}

function enrichGroupWithPersonMetadata(
  group: EntityReviewGroup,
  rows: EntityMentionRow[],
): EntityReviewGroup {
  if (!group.person) {
    return group;
  }

  const personRow = rows.find(
    (row) =>
      row.entityType === "person" &&
      group.person?.mentionIds.includes(row.id),
  );

  const contextText = [
    group.linkContext,
    ...(group.person.contexts ?? []),
    ...(group.org?.contexts ?? []),
  ]
    .filter(Boolean)
    .join(" ");

  const parsed = parseStructuredContactContext(
    contextText,
    group.person.value,
  );

  const extractedOrgName =
    group.org?.value?.trim() ||
    personRow?.linkedOrganizationName?.trim() ||
    parsed.org ||
    null;

  const personTitle = personRow?.personTitle?.trim() || parsed.title || null;

  return {
    ...group,
    personTitle,
    extractedOrgName,
  };
}

function findOrgRowForName(
  rows: EntityMentionRow[],
  orgName: string,
): EntityMentionRow | undefined {
  return rows.find(
    (row) =>
      row.entityType === "org" &&
      entitiesMatch(
        { type: "org", value: row.entityValue },
        { type: "org", value: orgName },
      ),
  );
}

function orgFieldFromRow(row: EntityMentionRow) {
  return {
    type: "org" as const,
    value: row.entityValue,
    contexts: row.context ? [row.context] : [],
    sources: [{ emailId: null, emailFrom: null, emailSubject: null }],
    vendorCandidate: row.vendorCandidate,
    mentionIds: [row.id],
  };
}

function applyLinkedOrganizations(
  groups: EntityReviewGroup[],
  rows: EntityMentionRow[],
): EntityReviewGroup[] {
  return groups.map((group) => {
    if (group.org || !group.person) return group;

    const personRow = rows.find(
      (row) =>
        row.entityType === "person" &&
        group.person?.mentionIds.includes(row.id) &&
        row.linkedOrganizationName?.trim(),
    );
    if (!personRow?.linkedOrganizationName) return group;

    const orgRow = findOrgRowForName(rows, personRow.linkedOrganizationName);
    if (!orgRow) return group;

    const mergedOrg = orgFieldFromRow(orgRow);
    return {
      ...group,
      org: mergedOrg,
      mentionIds: [...new Set([...group.mentionIds, ...mergedOrg.mentionIds])],
    };
  });
}

export function splitGroupsForReview(
  groups: EntityReviewGroup[],
): EntityReviewGroup[] {
  const split: EntityReviewGroup[] = [];

  for (const group of groups) {
    if (group.person && group.org) {
      const personMentionIds = [
        ...(group.person.mentionIds ?? []),
        ...(group.phone?.mentionIds ?? []),
      ];
      split.push({
        ...group,
        key: `${group.key}:person`,
        org: undefined,
        mentionIds: [...new Set(personMentionIds)],
      });

      split.push({
        ...group,
        key: `${group.key}:org`,
        person: undefined,
        phone: undefined,
        unit: undefined,
        personTitle: null,
        extractedOrgName: group.org?.value ?? group.extractedOrgName ?? null,
        mentionIds: [...new Set(group.org.mentionIds ?? [])],
      });
      continue;
    }

    split.push(group);
  }

  return split;
}

export function buildApprovedOrganizationOptions(
  rows: EntityMentionRow[],
  vendors: Array<{ name: string; organizationRole: string | null }>,
): ApprovedOrganizationOption[] {
  const options = new Map<string, ApprovedOrganizationOption>();

  for (const vendor of vendors) {
    const key = normalizeOrgName(vendor.name);
    if (!key) continue;
    options.set(key, {
      name: vendor.name,
      organizationRole: vendor.organizationRole,
    });
  }

  for (const row of rows) {
    if (row.reviewStatus !== "approved" || row.entityType !== "org") continue;
    const key = normalizeOrgName(row.entityValue);
    if (!key || options.has(key)) continue;
    options.set(key, {
      name: row.entityValue,
      organizationRole: row.organizationRole,
    });
  }

  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function collectMatchingOrgMentionIds(
  rows: EntityMentionRow[],
  orgName: string,
): string[] {
  return rows
    .filter(
      (row) =>
        row.reviewStatus === "approved" &&
        row.entityType === "org" &&
        entitiesMatch(
          { type: "org", value: row.entityValue },
          { type: "org", value: orgName },
        ),
    )
    .map((row) => row.id);
}

function firstMatchingOrgRow(
  rows: EntityMentionRow[],
  orgName: string,
): EntityMentionRow | undefined {
  return rows.find(
    (row) =>
      row.reviewStatus === "approved" &&
      row.entityType === "org" &&
      entitiesMatch(
        { type: "org", value: row.entityValue },
        { type: "org", value: orgName },
      ),
  );
}

export function buildApprovedOrganizationCards(
  rows: EntityMentionRow[],
  vendors: Array<{
    id: string;
    name: string;
    organizationRole: string | null;
  }>,
): ApprovedOrganizationCard[] {
  const cards: ApprovedOrganizationCard[] = [];
  const seenKeys = new Set<string>();

  for (const vendor of vendors) {
    const key = normalizeOrgName(vendor.name);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    const orgRow = firstMatchingOrgRow(rows, vendor.name);
    cards.push({
      name: vendor.name,
      organizationRole: vendor.organizationRole,
      vendorId: vendor.id,
      mentionIds: collectMatchingOrgMentionIds(rows, vendor.name),
      contactEmail: orgRow?.contactEmail,
    });
  }

  for (const row of rows) {
    if (row.reviewStatus !== "approved" || row.entityType !== "org") continue;
    const key = normalizeOrgName(row.entityValue);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    cards.push({
      name: row.entityValue,
      organizationRole: row.organizationRole,
      vendorId: null,
      mentionIds: collectMatchingOrgMentionIds(rows, row.entityValue),
      contactEmail: row.contactEmail,
    });
  }

  return cards.sort((a, b) => a.name.localeCompare(b.name));
}

export function findApprovedEntityMatch(
  approvedRows: EntityMentionRow[],
  entity: { type: string; value: string },
): EntityMentionRow | undefined {
  return approvedRows.find(
    (row) =>
      row.reviewStatus === "approved" &&
      entitiesMatch(
        { type: row.entityType, value: row.entityValue },
        entity,
      ),
  );
}

export function buildEntityDedupKey(entity: {
  type: string;
  value: string;
}): string {
  return entityDedupKey(entity);
}

export type ThreadEntityReviewGroup = EntityReviewGroup & {
  reviewStatus: "pending" | "approved";
};

export function attachContactEmailsToGroups(
  groups: EntityReviewGroup[],
  rows: EntityMentionRow[],
  emailsByPerson: Map<string, string[]>,
): EntityReviewGroup[] {
  return groups.map((group) => {
    if (!group.person) return group;

    const personRow = rows.find(
      (row) =>
        row.entityType === "person" &&
        group.person?.mentionIds.includes(row.id),
    );
    const dedupKey =
      personRow?.dedupKey?.trim() ||
      buildEntityDedupKey({ type: "person", value: group.person.value });
    const contactEmails = emailsByPerson.get(dedupKey);
    if (!contactEmails?.length) return group;

    return {
      ...group,
      contactEmails,
    };
  });
}
