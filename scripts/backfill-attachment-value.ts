import { backfillAttachmentValues } from "../lib/email-analysis/backfill-attachment-value";

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

backfillAttachmentValues({ limit })
  .then((result) => {
    console.info("[backfill-attachment-value:complete]", result);
    process.exit(result.failed > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error("[backfill-attachment-value:fatal]", error);
    process.exit(1);
  });
