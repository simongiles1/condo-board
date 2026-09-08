import { readFile } from "fs/promises";
import path from "path";

import {
  checkIbmDoclingHealth,
  convertPagesWithIbmDocling,
  listIbmDoclingCredentials,
  listIbmMarkdownArtifacts,
} from "@/lib/email/docling-ibm";
import {
  pickLiveIbmCredential,
  syncIbmDoclingSlotsFromEnv,
} from "@/lib/email/ibm-docling-slots";
import { getIbmDoclingSpendSummary } from "@/lib/email/ibm-docling-spend";

async function main() {
  await syncIbmDoclingSlotsFromEnv();
  const creds = listIbmDoclingCredentials();
  const live = await pickLiveIbmCredential();
  const spend = await getIbmDoclingSpendSummary();
  const health = await checkIbmDoclingHealth();

  console.log(
    JSON.stringify(
      {
        credSlots: creds.map((c) => c.slot),
        liveSlot: live?.slot ?? null,
        health,
        accounts: spend.accounts.map((a) => ({
          slot: a.envSlot,
          exhausted: a.exhaustedAt,
          reason: a.exhaustedReason,
          pages: a.pagesUsed,
          trial: a.trialPages,
          active: a.isActive,
        })),
      },
      null,
      2,
    ),
  );

  const hash =
    process.argv[2]?.trim() ||
    "127963d340ae8f2e8b0e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f8e8f";
  const pdfPath = path.join(
    process.cwd(),
    "data",
    "email-attachments",
    `${hash}.pdf`,
  );

  try {
    await readFile(pdfPath);
  } catch {
    console.log("no local pdf for convert probe — skipping convert test");
    return;
  }

  console.log("convert probe", { hash, pdfPath, slot: live?.slot });
  const result = await convertPagesWithIbmDocling({
    pdfPath,
    pages: [1],
    filename: `${hash}.pdf`,
  });
  console.log(
    JSON.stringify(
      {
        pages: result.pages.length,
        billedPages: result.billedPages,
        sample: result.pages[0]?.markdown?.slice(0, 200),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
