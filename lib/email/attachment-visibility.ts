export type AttachmentVisibilitySurface =
  | "inbox"
  | "emailDetail"
  | "sidePanel"
  | "files"
  | "calendar";

export type AttachmentVisibilitySettings = Record<
  AttachmentVisibilitySurface,
  boolean
>;

export const ATTACHMENT_VISIBILITY_SURFACES: AttachmentVisibilitySurface[] = [
  "inbox",
  "emailDetail",
  "sidePanel",
  "files",
  "calendar",
];

export const ATTACHMENT_VISIBILITY_SURFACE_LABELS: Record<
  AttachmentVisibilitySurface,
  string
> = {
  inbox: "Inbox attachment lists",
  emailDetail: "Email detail view",
  sidePanel: "Email side panel",
  files: "Files page",
  calendar: "Calendar event sources",
};

export function filterVisibleAttachments<
  T extends { hasValue?: boolean | null },
>(
  attachments: T[],
  surface: AttachmentVisibilitySurface,
  settings: AttachmentVisibilitySettings,
): T[] {
  if (settings[surface]) return attachments;
  return attachments.filter((attachment) => attachment.hasValue !== false);
}

export function countVisibleAttachments<
  T extends { hasValue?: boolean | null },
>(
  attachments: T[],
  surface: AttachmentVisibilitySurface,
  settings: AttachmentVisibilitySettings,
): number {
  return filterVisibleAttachments(attachments, surface, settings).length;
}
