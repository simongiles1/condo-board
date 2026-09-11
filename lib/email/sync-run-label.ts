/** Human-readable Gmail import counts for sync history and ingest summaries. */
export function formatSyncImportResultLabel(
  messagesAdded: number,
  messagesSkipped: number,
): string {
  const added = `${messagesAdded.toLocaleString()} new`;
  if (messagesSkipped <= 0) return added;
  const skipped = `${messagesSkipped.toLocaleString()} already in archive`;
  return `${added} · ${skipped}`;
}

export function formatSyncImportResultDetail(
  messagesAdded: number,
  messagesSkipped: number,
): string {
  if (messagesAdded === 0 && messagesSkipped === 0) {
    return "No allowlist mail was processed.";
  }
  const parts: string[] = [];
  parts.push(
    `${messagesAdded.toLocaleString()} new email${messagesAdded === 1 ? "" : "s"} added to the archive.`,
  );
  if (messagesSkipped > 0) {
    parts.push(
      `${messagesSkipped.toLocaleString()} message${messagesSkipped === 1 ? "" : "s"} were already imported (or could not be parsed) and were skipped.`,
    );
  }
  return parts.join(" ");
}
