"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ATTACHMENT_VISIBILITY_SURFACES,
  type AttachmentVisibilitySettings,
  type AttachmentVisibilitySurface,
} from "@/lib/email/attachment-visibility";

export const ATTACHMENT_VISIBILITY_STORAGE_KEY =
  "condo-board-attachment-visibility";

export const ATTACHMENT_VISIBILITY_CHANGED_EVENT =
  "attachment-visibility-changed";

/** All false = hide low-value attachments on every surface by default. */
export const DEFAULT_ATTACHMENT_VISIBILITY_SETTINGS: AttachmentVisibilitySettings =
  {
    inbox: false,
    emailDetail: false,
    sidePanel: false,
    files: false,
    calendar: false,
  };

export function normalizeAttachmentVisibilitySettings(
  input: Partial<AttachmentVisibilitySettings> | null | undefined,
): AttachmentVisibilitySettings {
  const normalized = { ...DEFAULT_ATTACHMENT_VISIBILITY_SETTINGS };
  for (const surface of ATTACHMENT_VISIBILITY_SURFACES) {
    if (typeof input?.[surface] === "boolean") {
      normalized[surface] = input[surface];
    }
  }
  return normalized;
}

export function loadAttachmentVisibilitySettings(): AttachmentVisibilitySettings {
  if (typeof window === "undefined") {
    return DEFAULT_ATTACHMENT_VISIBILITY_SETTINGS;
  }

  try {
    const raw = localStorage.getItem(ATTACHMENT_VISIBILITY_STORAGE_KEY);
    if (!raw) return DEFAULT_ATTACHMENT_VISIBILITY_SETTINGS;
    return normalizeAttachmentVisibilitySettings(
      JSON.parse(raw) as Partial<AttachmentVisibilitySettings>,
    );
  } catch {
    return DEFAULT_ATTACHMENT_VISIBILITY_SETTINGS;
  }
}

export function saveAttachmentVisibilitySettings(
  settings: AttachmentVisibilitySettings,
): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeAttachmentVisibilitySettings(settings);
  localStorage.setItem(
    ATTACHMENT_VISIBILITY_STORAGE_KEY,
    JSON.stringify(normalized),
  );
  window.dispatchEvent(new CustomEvent(ATTACHMENT_VISIBILITY_CHANGED_EVENT));
}

export function useAttachmentVisibilitySettings(): AttachmentVisibilitySettings {
  const [settings, setSettings] = useState<AttachmentVisibilitySettings>(
    DEFAULT_ATTACHMENT_VISIBILITY_SETTINGS,
  );

  const refresh = useCallback(() => {
    setSettings(loadAttachmentVisibilitySettings());
  }, []);

  useEffect(() => {
    refresh();

    function onChanged() {
      refresh();
    }

    window.addEventListener(ATTACHMENT_VISIBILITY_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(ATTACHMENT_VISIBILITY_CHANGED_EVENT, onChanged);
    };
  }, [refresh]);

  return settings;
}

export function updateAttachmentVisibilitySurface(
  current: AttachmentVisibilitySettings,
  surface: AttachmentVisibilitySurface,
  enabled: boolean,
): AttachmentVisibilitySettings {
  return { ...current, [surface]: enabled };
}
