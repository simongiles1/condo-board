import assert from "node:assert/strict";

import {
  formatSyncImportResultDetail,
  formatSyncImportResultLabel,
} from "../lib/email/sync-run-label.ts";

assert.equal(formatSyncImportResultLabel(44, 18), "44 new · 18 already in archive");
assert.equal(formatSyncImportResultLabel(0, 0), "0 new");
assert.equal(formatSyncImportResultLabel(3, 0), "3 new");
assert.match(
  formatSyncImportResultDetail(44, 18),
  /44 new email/,
);
assert.match(formatSyncImportResultDetail(44, 18), /18 message/);

console.log("sync-run-label ok");
