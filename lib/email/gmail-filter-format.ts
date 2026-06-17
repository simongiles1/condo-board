/** Gmail filter From field: `a@x.com OR b@y.com` */
export function formatGmailOrEmailList(addresses: string[]): string {
  const normalized = [
    ...new Set(
      addresses
        .map((address) => address.trim().toLowerCase())
        .filter((address) => address.includes("@")),
    ),
  ];
  return normalized.join(" OR ");
}
