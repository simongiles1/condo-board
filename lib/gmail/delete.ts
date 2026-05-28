import { getGmailClient } from "./client";

/** Move a message to Trash in the dedicated condo Gmail mailbox only. */
export async function trashDedicatedGmailMessage(
  gmailMessageId: string,
): Promise<void> {
  const { gmail } = await getGmailClient("dedicated");

  await gmail.users.messages.trash({
    userId: "me",
    id: gmailMessageId,
  });
}
