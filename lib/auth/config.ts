export function isAuthEnabled(): boolean {
  return process.env.AUTH_ENABLED === "true";
}
