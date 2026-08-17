/** Consumer / free-mail domains that must not drive domain→org affiliation priors. */

const CONSUMER_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.ca",
  "outlook.com",
  "outlook.ca",
  "live.com",
  "live.ca",
  "msn.com",
  "yahoo.com",
  "yahoo.ca",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "mail.com",
  "gmx.com",
  "gmx.ca",
  "zoho.com",
  "yandex.com",
  "fastmail.com",
  "hey.com",
]);

export function extractEmailDomain(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email
    .slice(at + 1)
    .trim()
    .toLowerCase();
}

export function isConsumerEmailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const d = domain.trim().toLowerCase();
  if (!d) return false;
  if (CONSUMER_EMAIL_DOMAINS.has(d)) return true;
  // Subdomains of known consumer hosts (e.g. mail.google.com) are rare on From:
  // addresses; keep the check exact for predictability.
  return false;
}

/** Corporate sender domains eligible for domain→org affiliation priors. */
export function isCorporateEmailDomain(domain: string | null | undefined): boolean {
  if (!domain?.trim()) return false;
  return !isConsumerEmailDomain(domain);
}

export function websiteHost(website: string | null | undefined): string {
  if (!website?.trim()) return "";
  let raw = website.trim().toLowerCase();
  if (!raw.includes("://")) raw = `https://${raw}`;
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      ?.trim() ?? "";
  }
}
