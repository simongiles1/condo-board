export function formatAuthDbError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('relation "app_users" does not exist')) {
    return "Accounts database is not set up yet. Redeploy and check migrate logs.";
  }

  if (
    message.includes("ECONNREFUSED") ||
    message.includes("ENOTFOUND") ||
    message.includes("getaddrinfo")
  ) {
    return "Database connection failed. Check DATABASE_URL in deployment settings.";
  }

  if (message.includes("duplicate key") && message.includes("app_users")) {
    return "An account with this email already exists.";
  }

  return `Sign up failed: ${message}`;
}
