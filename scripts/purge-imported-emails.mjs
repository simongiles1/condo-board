import Database from "better-sqlite3";

const db = new Database("./data/app.db");

const before = {
  emails: db.prepare("SELECT COUNT(*) AS c FROM emails").get().c,
  threads: db.prepare("SELECT COUNT(*) AS c FROM email_threads").get().c,
  syncRuns: db.prepare("SELECT COUNT(*) AS c FROM sync_runs").get().c,
};

console.log("Before:", before);

const cleanup = db.transaction(() => {
  const deletedEmails = db.prepare("DELETE FROM emails").run().changes;
  const deletedThreads = db.prepare("DELETE FROM email_threads").run().changes;
  const deletedSyncRuns = db.prepare("DELETE FROM sync_runs").run().changes;
  const deletedConnections = db.prepare("DELETE FROM gmail_connections").run().changes;

  return {
    deletedEmails,
    deletedThreads,
    deletedSyncRuns,
    deletedConnections,
  };
});

const result = cleanup();

console.log("Removed:", result);
console.log("After:", {
  emails: db.prepare("SELECT COUNT(*) AS c FROM emails").get().c,
  threads: db.prepare("SELECT COUNT(*) AS c FROM email_threads").get().c,
  syncRuns: db.prepare("SELECT COUNT(*) AS c FROM sync_runs").get().c,
  connections: db
    .prepare("SELECT account_type, email_address, last_history_id FROM gmail_connections")
    .all(),
});
