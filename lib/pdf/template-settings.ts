import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { pdfTemplateSettings } from "@/lib/db/schema";
import {
  DEFAULT_PDF_MARGINS,
  normalizePdfMargins,
  type PdfMargins,
} from "@/lib/pdf/margins";

const SETTINGS_ID = "default";

function rowToMargins(row: typeof pdfTemplateSettings.$inferSelect): PdfMargins {
  return normalizePdfMargins({
    top: row.top,
    bottom: row.bottom,
    left: row.left,
    right: row.right,
    pageOneRuleTop: row.pageOneRuleTop,
    headerRuleTop: row.headerRuleTop,
  });
}

export async function getPdfTemplateSettings(): Promise<PdfMargins> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(pdfTemplateSettings)
    .where(eq(pdfTemplateSettings.id, SETTINGS_ID));

  if (!row) {
    return DEFAULT_PDF_MARGINS;
  }

  return rowToMargins(row);
}

export async function updatePdfTemplateSettings(
  patch: Partial<PdfMargins>,
): Promise<PdfMargins> {
  const db = getDb();
  const now = new Date().toISOString();
  const current = await getPdfTemplateSettings();
  const next = normalizePdfMargins({ ...current, ...patch });

  await db
    .insert(pdfTemplateSettings)
    .values({
      id: SETTINGS_ID,
      top: next.top,
      bottom: next.bottom,
      left: next.left,
      right: next.right,
      pageOneRuleTop: next.pageOneRuleTop,
      headerRuleTop: next.headerRuleTop,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pdfTemplateSettings.id,
      set: {
        top: next.top,
        bottom: next.bottom,
        left: next.left,
        right: next.right,
        pageOneRuleTop: next.pageOneRuleTop,
        headerRuleTop: next.headerRuleTop,
        updatedAt: now,
      },
    });

  return next;
}
