import { extractMailboxEmail } from "@/lib/email/address-display";

/** Gmail filter From field: `a@x.com OR b@y.com` */
export function formatGmailOrEmailList(addresses: string[]): string {
  const normalized = [
    ...new Set(
      addresses
        .map((address) => extractMailboxEmail(address)?.trim().toLowerCase())
        .filter((address): address is string => Boolean(address?.includes("@"))),
    ),
  ];
  return normalized.join(" OR ");
}
