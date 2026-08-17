"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ExtractContactsButton,
  type ContactHighlightsByEmailId,
} from "@/components/ExtractContactsButton";
import {
  EmailThreadMessages,
  type ThreadMessage,
} from "@/components/EmailThreadMessages";
import { resolveHighlightedExcerpt } from "@/lib/email/highlight-unique";
import { formatDateTime } from "@/lib/format/datetime";

type Props = {
  messages: ThreadMessage[];
  hideAttachments?: boolean;
  /** Show the contact-extract button above the collapsible messages. */
  enableContactExtract?: boolean;
};

/** Same text the UI marks teal — used as the LLM excerpt so spans align. */
function highlightedSectionText(message: ThreadMessage): string {
  return resolveHighlightedExcerpt(
    message.bodyDisplay.content,
    message.bodyTextUnique,
  );
}

/** Authored body for fingerprinting (this message only, not the thread). */
function fingerprintBodyText(message: ThreadMessage): string {
  const unique = message.bodyTextUnique?.trim();
  if (unique) return unique;
  return message.bodyText.trim();
}

function emailFilterLabel(message: ThreadMessage): string {
  const when = formatDateTime(message.receivedAt);
  const from = message.fromAddress || "(unknown)";
  const subject = message.subject?.trim() || "(no subject)";
  const shortSubject =
    subject.length > 48 ? `${subject.slice(0, 48).trimEnd()}…` : subject;
  return `${when} · ${from} · ${shortSubject}`;
}

/**
 * Client wrapper so contact-extraction state can drive per-message highlights
 * without lifting state into the RSC page.
 */
export function EmailThreadView({
  messages,
  hideAttachments = false,
  enableContactExtract = true,
}: Props) {
  const [contactExtractions, setContactExtractions] =
    useState<ContactHighlightsByEmailId | null>(null);
  const [uniqueContentOnly, setUniqueContentOnly] = useState(false);

  const handleActiveExtractions = useCallback(
    (value: ContactHighlightsByEmailId | null) => {
      setContactExtractions(value);
    },
    [],
  );

  useEffect(() => {
    setContactExtractions(null);
    setUniqueContentOnly(false);
  }, [messages]);

  const extractItems = messages.map((message) => ({
    emailId: message.id,
    highlightedText: highlightedSectionText(message),
    subject: message.subject,
    fromAddress: message.fromAddress,
    toAddresses: message.toAddresses,
    ccAddresses: message.ccAddresses ?? [],
    bodyText: fingerprintBodyText(message),
    label: emailFilterLabel(message),
  }));
  const extractKey = messages.map((message) => message.id).join(",");

  return (
    <div className="space-y-4">
      {enableContactExtract && messages.length > 0 ? (
        <ExtractContactsButton
          key={extractKey}
          items={extractItems}
          onActiveExtractions={handleActiveExtractions}
          uniqueContentOnly={uniqueContentOnly}
          onUniqueContentOnlyChange={setUniqueContentOnly}
        />
      ) : null}

      <EmailThreadMessages
        messages={messages}
        hideAttachments={hideAttachments}
        contactExtractions={contactExtractions}
        uniqueContentOnly={uniqueContentOnly}
      />
    </div>
  );
}
