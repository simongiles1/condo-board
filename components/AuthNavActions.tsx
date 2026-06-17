"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ModelSettingsDialog } from "@/components/ModelSettingsDialog";
import type { UserRole } from "@/lib/auth/roles";
import type { AttachmentVisibilitySettings } from "@/lib/email/attachment-visibility";
import {
  DEFAULT_PDF_MARGINS,
  loadPdfMargins,
  savePdfMargins,
  type PdfMargins,
} from "@/lib/pdf/margins";
import {
  DEFAULT_ATTACHMENT_VISIBILITY_SETTINGS,
  loadAttachmentVisibilitySettings,
  saveAttachmentVisibilitySettings,
} from "@/lib/settings/attachment-visibility-settings";
import {
  DEFAULT_MODEL_SETTINGS,
  loadModelSettings,
  saveModelSettings,
  type ModelSettings,
} from "@/lib/settings/model-settings";

function emailInitials(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

export function AuthNavActions({
  email,
  role,
}: {
  email: string | null;
  role: UserRole | null;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const isSuperAdmin = role === "super_admin";

  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<ModelSettings>(DEFAULT_MODEL_SETTINGS);
  const [pdfMargins, setPdfMargins] = useState<PdfMargins>(DEFAULT_PDF_MARGINS);
  const [attachmentVisibility, setAttachmentVisibility] =
    useState<AttachmentVisibilitySettings>(DEFAULT_ATTACHMENT_VISIBILITY_SETTINGS);

  const initials = email ? emailInitials(email) : "U";

  useEffect(() => {
    setSettings(loadModelSettings());
    setPdfMargins(loadPdfMargins());
    setAttachmentVisibility(loadAttachmentVisibilitySettings());
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function logout() {
    setMenuOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function openSettings() {
    setMenuOpen(false);
    setSettingsOpen(true);
  }

  function openEmailSettings() {
    setMenuOpen(false);
    router.push("/settings");
  }

  function handleSave(
    next: ModelSettings,
    nextMargins: PdfMargins,
    nextAttachmentVisibility: AttachmentVisibilitySettings,
  ) {
    setSettings(next);
    setPdfMargins(nextMargins);
    setAttachmentVisibility(nextAttachmentVisibility);
    saveModelSettings(next);
    savePdfMargins(nextMargins);
    saveAttachmentVisibilitySettings(nextAttachmentVisibility);
    setSettingsOpen(false);
  }

  return (
    <>
      <div ref={rootRef} className="relative inline-flex">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="User menu"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          title="User menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-teal-700 bg-teal-700 text-sm font-semibold text-white shadow-sm hover:border-teal-800 hover:bg-teal-800"
        >
          {initials}
        </button>

        {menuOpen ? (
          <div
            role="menu"
            aria-label="User menu"
            className="absolute right-0 top-[calc(100%+0.375rem)] z-20 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            {email ? (
              <div className="border-b border-slate-100 px-3 py-2">
                <p className="truncate text-sm text-slate-700">{email}</p>
              </div>
            ) : null}

            <button
              type="button"
              role="menuitem"
              onClick={openSettings}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <SettingsIcon />
              Settings
            </button>

            {isSuperAdmin ? (
              <button
                type="button"
                role="menuitem"
                onClick={openEmailSettings}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <EmailSettingsIcon />
                Email settings
              </button>
            ) : null}

            {email ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => void logout()}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <LogoutIcon />
                Sign out
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ModelSettingsDialog
        open={settingsOpen}
        settings={settings}
        pdfMargins={pdfMargins}
        attachmentVisibility={attachmentVisibility}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSave}
      />
    </>
  );
}

function SettingsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0 text-slate-500"
      aria-hidden="true"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EmailSettingsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0 text-slate-500"
      aria-hidden="true"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0 text-slate-500"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}
