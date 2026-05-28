import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const { getGmailClient } = await import("../lib/gmail/client.ts");

const { gmail, connection } = await getGmailClient("dedicated");
const profile = await gmail.users.getProfile({ userId: "me" });
const inbox = await gmail.users.messages.list({
  userId: "me",
  q: "in:inbox -in:spam -in:trash",
  maxResults: 8,
});

console.log("Stored connection:", connection.emailAddress);
console.log("Live Gmail profile:", {
  emailAddress: profile.data.emailAddress,
  messagesTotal: profile.data.messagesTotal,
  threadsTotal: profile.data.threadsTotal,
  historyId: profile.data.historyId,
});

console.log("\nInbox sample (what initial sync imports):");
for (const message of inbox.data.messages ?? []) {
  if (!message.id) continue;
  const response = await gmail.users.messages.get({
    userId: "me",
    id: message.id,
    format: "metadata",
    metadataHeaders: ["From", "Subject", "To"],
  });
  const headers = Object.fromEntries(
    (response.data.payload?.headers ?? []).map((header) => [
      header.name ?? "",
      header.value ?? "",
    ]),
  );
  console.log(`- ${headers.Subject?.slice(0, 90)}`);
  console.log(`  From: ${headers.From}`);
}
