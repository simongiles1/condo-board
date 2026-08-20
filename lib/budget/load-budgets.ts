import { readFile } from "fs/promises";
import { desc, eq } from "drizzle-orm";

import {
  classifyBudgetFilename,
  rankOperatingBudgetFilename,
} from "@/lib/budget/classify-documents";
import {
  mergeParsedBudgetDocuments,
  parseBudgetMarkdown,
  toBudgetLineItems,
  type RankedBudgetParse,
} from "@/lib/budget/parse-markdown";
import type { BudgetPageData, BudgetYearDocument } from "@/lib/budget/types";
import { getDb } from "@/lib/db";
import {
  attachmentDocuments,
  emailAttachments,
  emails,
} from "@/lib/db/schema";
import { resolveAttachmentStoragePath } from "@/lib/email/attachment-markdown-shared";

async function readMarkdown(markdownPath: string | null): Promise<string | null> {
  if (!markdownPath) return null;
  try {
    return await readFile(resolveAttachmentStoragePath(markdownPath), "utf8");
  } catch {
    return null;
  }
}

export async function loadBudgetPageData(): Promise<BudgetPageData> {
  const db = getDb();
  const rows = await db
    .select({
      id: emailAttachments.id,
      filename: emailAttachments.filename,
      mimeType: emailAttachments.mimeType,
      sizeBytes: emailAttachments.sizeBytes,
      contentHash: emailAttachments.contentHash,
      receivedAt: emails.receivedAt,
      parseStatus: attachmentDocuments.parseStatus,
      markdownPath: attachmentDocuments.markdownPath,
    })
    .from(emailAttachments)
    .innerJoin(emails, eq(emailAttachments.emailId, emails.id))
    .leftJoin(
      attachmentDocuments,
      eq(emailAttachments.contentHash, attachmentDocuments.contentHash),
    )
    .orderBy(desc(emails.receivedAt));

  const bestByHash = new Map<
    string,
    (typeof rows)[number] & { fiscalYearStart: number; rank: number }
  >();

  for (const row of rows) {
    const classified = classifyBudgetFilename(row.filename);
    if (
      !classified ||
      !classified.isThisCorporation ||
      classified.kind !== "operating-budget" ||
      classified.fiscalYearStart == null
    ) {
      continue;
    }

    const hash = row.contentHash ?? row.id;
    const rank = rankOperatingBudgetFilename(row.filename);
    const existing = bestByHash.get(hash);
    if (
      !existing ||
      rank > existing.rank ||
      (rank === existing.rank && row.receivedAt > existing.receivedAt)
    ) {
      bestByHash.set(hash, {
        ...row,
        fiscalYearStart: classified.fiscalYearStart,
        rank,
      });
    }
  }

  const candidates = [...bestByHash.values()];
  const parsedDocs: RankedBudgetParse[] = [];
  const extractedHashes = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.parseStatus !== "parsed") continue;
    const markdown = await readMarkdown(candidate.markdownPath);
    if (!markdown) continue;
    const parsed = parseBudgetMarkdown(markdown);
    if (!parsed.lines.length) continue;
    parsedDocs.push({
      rank: candidate.rank,
      receivedAt: candidate.receivedAt,
      parsed,
    });
    extractedHashes.add(candidate.contentHash ?? candidate.id);
  }

  const lines = toBudgetLineItems(mergeParsedBudgetDocuments(parsedDocs));
  const yearSet = new Set<number>();
  for (const candidate of candidates) yearSet.add(candidate.fiscalYearStart);
  for (const line of lines) {
    for (const year of Object.keys(line.byYear)) yearSet.add(Number(year));
  }

  const primaryHashByYear = new Map<number, string>();
  for (const candidate of candidates) {
    const hash = candidate.contentHash ?? candidate.id;
    if (!extractedHashes.has(hash)) continue;
    const currentHash = primaryHashByYear.get(candidate.fiscalYearStart);
    const current = currentHash
      ? candidates.find((item) => (item.contentHash ?? item.id) === currentHash)
      : undefined;
    if (
      !current ||
      candidate.rank > current.rank ||
      (candidate.rank === current.rank &&
        candidate.receivedAt > current.receivedAt)
    ) {
      primaryHashByYear.set(candidate.fiscalYearStart, hash);
    }
  }

  const documents: BudgetYearDocument[] = candidates
    .map((candidate) => {
      const hash = candidate.contentHash ?? candidate.id;
      return {
        id: candidate.id,
        filename: candidate.filename,
        mimeType: candidate.mimeType,
        sizeBytes: candidate.sizeBytes,
        receivedAt: candidate.receivedAt,
        fiscalYearStart: candidate.fiscalYearStart,
        parseStatus: candidate.parseStatus,
        usedForExtraction: extractedHashes.has(hash),
        isPrimarySource: primaryHashByYear.get(candidate.fiscalYearStart) === hash,
      };
    })
    .sort((a, b) => {
      if (b.fiscalYearStart !== a.fiscalYearStart) {
        return b.fiscalYearStart - a.fiscalYearStart;
      }
      if (a.isPrimarySource !== b.isPrimarySource) {
        return a.isPrimarySource ? -1 : 1;
      }
      if (a.usedForExtraction !== b.usedForExtraction) {
        return a.usedForExtraction ? -1 : 1;
      }
      return b.receivedAt.localeCompare(a.receivedAt);
    });

  return {
    years: [...yearSet].sort((a, b) => a - b),
    documents,
    lines,
  };
}
