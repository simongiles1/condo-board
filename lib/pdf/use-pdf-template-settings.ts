"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_PDF_MARGINS,
  loadPdfMargins,
  normalizePdfMargins,
  PDF_MARGINS_STORAGE_KEY,
  pdfMarginsEqual,
  type PdfMargins,
} from "@/lib/pdf/margins";

type UsePdfTemplateSettingsResult = {
  margins: PdfMargins;
  loading: boolean;
  saveMargins: (next: PdfMargins) => Promise<PdfMargins>;
};

async function fetchPdfTemplateSettings(): Promise<PdfMargins> {
  const response = await fetch("/api/pdf/template-settings");
  if (!response.ok) {
    throw new Error("Could not load PDF template settings.");
  }

  const body = (await response.json()) as { margins?: Partial<PdfMargins> };
  return normalizePdfMargins(body.margins);
}

async function persistPdfTemplateSettings(
  margins: PdfMargins,
): Promise<PdfMargins> {
  const response = await fetch("/api/pdf/template-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ margins: normalizePdfMargins(margins) }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Could not save PDF template settings.");
  }

  const payload = (await response.json()) as { margins?: Partial<PdfMargins> };
  return normalizePdfMargins(payload.margins);
}

async function loadPdfTemplateSettingsWithMigration(): Promise<PdfMargins> {
  const serverMargins = await fetchPdfTemplateSettings();
  const localMargins = loadPdfMargins();
  const hasLocalCustomizations = !pdfMarginsEqual(
    localMargins,
    DEFAULT_PDF_MARGINS,
  );
  const serverIsDefault = pdfMarginsEqual(serverMargins, DEFAULT_PDF_MARGINS);

  if (hasLocalCustomizations && serverIsDefault) {
    const migrated = await persistPdfTemplateSettings(localMargins);
    if (typeof window !== "undefined") {
      localStorage.removeItem(PDF_MARGINS_STORAGE_KEY);
    }
    return migrated;
  }

  return serverMargins;
}

export function usePdfTemplateSettings(): UsePdfTemplateSettingsResult {
  const [margins, setMargins] = useState<PdfMargins>(DEFAULT_PDF_MARGINS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void loadPdfTemplateSettingsWithMigration()
      .then((next) => {
        if (!cancelled) {
          setMargins(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMargins(loadPdfMargins());
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const saveMargins = useCallback(async (next: PdfMargins) => {
    const saved = await persistPdfTemplateSettings(next);
    setMargins(saved);
    if (typeof window !== "undefined") {
      localStorage.removeItem(PDF_MARGINS_STORAGE_KEY);
    }
    return saved;
  }, []);

  return { margins, loading, saveMargins };
}
