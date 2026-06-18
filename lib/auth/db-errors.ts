function collectErrorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  while (current instanceof Error) {
    parts.push(current.message);
    current = current.cause;
  }

  if (current != null && !(current instanceof Error)) {
    parts.push(String(current));
  }

  return parts.join(" | ");
}

export function formatAuthDbError(error: unknown): string {
  const message = collectErrorText(error);

  if (message.includes('relation "app_users" does not exist')) {
    return "Accounts database is not set up yet. Redeploy and check migrate logs.";
  }

  if (message.includes('column "first_name"') || message.includes('column "last_name"')) {
    return "Accounts database schema is outdated. Redeploy so migrate can update it.";
  }

  if (
    message.includes("ECONNREFUSED") ||
    message.includes("ENOTFOUND") ||
    message.includes("getaddrinfo")
  ) {
    return "Database connection failed. Check DATABASE_URL in deployment settings.";
  }

  if (message.includes("duplicate key") || message.includes("app_users_email_unique")) {
    return "An account with this email already exists. Try signing in instead.";
  }

  if (message.includes("check constraint") && message.includes("role")) {
    return "Accounts database role constraint is outdated. Redeploy so migrate can update it.";
  }

  const cause = message.includes(" | ") ? message.split(" | ").pop() : message;
  return cause?.startsWith("Sign up failed:")
    ? cause
    : `Sign up failed: ${cause ?? "Unknown database error."}`;
}
