function collectErrorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current != null && !seen.has(current)) {
    seen.add(current);

    if (current instanceof Error) {
      parts.push(current.message);
      const enriched = current as Error & { code?: string; detail?: string };
      if (enriched.code) parts.push(`code=${enriched.code}`);
      if (enriched.detail) parts.push(enriched.detail);
      current = current.cause;
      continue;
    }

    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (typeof record.message === "string") parts.push(record.message);
      if (typeof record.detail === "string") parts.push(record.detail);
      if (typeof record.code === "string") parts.push(`code=${record.code}`);
      current = record.cause;
      continue;
    }

    parts.push(String(current));
    break;
  }

  return parts.join(" | ");
}

export function formatAuthDbError(
  error: unknown,
  action: "Sign up" | "Login" = "Sign up",
): string {
  const message = collectErrorText(error);

  if (message.includes('relation "app_users" does not exist')) {
    return "Accounts table is missing. Remove DATABASE_URL from Coolify env vars, redeploy, and check migrate logs.";
  }

  if (message.includes('column "first_name"') || message.includes('column "last_name"')) {
    return "Accounts table schema is outdated. Redeploy so migrate can update it.";
  }

  if (
    message.includes("ECONNREFUSED") ||
    message.includes("ENOTFOUND") ||
    message.includes("getaddrinfo")
  ) {
    return "Database connection failed. Remove DATABASE_URL from Coolify env vars and redeploy.";
  }

  if (message.includes("duplicate key") || message.includes("app_users_email_unique")) {
    return "An account with this email already exists. Try signing in instead.";
  }

  if (message.includes("check constraint") && message.includes("role")) {
    return "Accounts role constraint is outdated. Redeploy so migrate can update it.";
  }

  if (message.includes("Failed query") && message.includes("app_users")) {
    return `${action} could not reach the accounts table. Redeploy the latest code and check migrate logs for "Verified app_users table exists."`;
  }

  const cause = message.includes(" | ") ? message.split(" | ").pop() : message;
  return `${action} failed: ${cause ?? "Unknown database error."}`;
}
