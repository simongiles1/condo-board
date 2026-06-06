/** Public app origin for redirects behind reverse proxies (Coolify, etc.). */
export function getAppBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
