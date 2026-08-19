/**
 * Per-email mention presence vs thread-wide evidence.
 * Run: npx tsx --test scripts/test-contact-mention-presence.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mentionCardAppearsInEmail,
  mentionSearchBody,
  resolveMentionUniqueBody,
  sourceCardContributedToMerged,
  sourceEmailIdsForMergedCard,
  textHasNameToken,
} from "../lib/contacts/mention-presence";

const shawnaReply = {
  subject: "Re: TSCC 2517: Sharing request for in person meeting with board",
  bodyText:
    "I am fine with having Mr. Fayyaz join us virtually at 6pm. Thanks, Shawna",
  fromAddress: "shawna.greenspan@gmail.com",
  toAddresses: ["studiopm@iccpropertymanagement.com"],
  ccAddresses: [
    "pgartenburg@gmail.com",
    "m.lethbridge@studiorichmond.ca",
    "bkafi@iccpropertymanagement.com",
  ],
};

describe("textHasNameToken", () => {
  it("matches a whole first name", () => {
    assert.equal(textHasNameToken("Hi Judy, thanks", "Judy"), true);
  });

  it("does not match a prefix inside a longer word", () => {
    assert.equal(textHasNameToken("Annual meeting", "Ann"), false);
  });
});

describe("mentionCardAppearsInEmail", () => {
  it("rejects a first-name card that is not on the message", () => {
    assert.equal(
      mentionCardAppearsInEmail({ first_name: "Judy" }, shawnaReply),
      false,
    );
  });

  it("accepts a first name in the authored body", () => {
    assert.equal(
      mentionCardAppearsInEmail({ first_name: "Shawna" }, shawnaReply),
      true,
    );
  });

  it("accepts a mailbox on To/From even when the given name is absent", () => {
    assert.equal(
      mentionCardAppearsInEmail(
        {
          first_name: "Judy",
          last_name: "Statham",
          email: "jstatham@iccpropertymanagement.com",
        },
        {
          ...shawnaReply,
          toAddresses: [
            "Judy Statham <jstatham@iccpropertymanagement.com>",
          ],
        },
      ),
      true,
    );
  });

  it("accepts a display name on the To line for a name-only card", () => {
    assert.equal(
      mentionCardAppearsInEmail(
        { first_name: "Judy" },
        {
          ...shawnaReply,
          toAddresses: ["Judy Statham <jstatham@iccpropertymanagement.com>"],
        },
      ),
      true,
    );
  });

  it("ignores a first name that only appears in quoted reply history", () => {
    const judyParagraph =
      "The team has 24/7 access to ICC's emergency response line, and Judy's contact details are readily available for direct on-site support.";
    assert.equal(
      mentionCardAppearsInEmail(
        { first_name: "Judy" },
        {
          subject: "Re: TSCC 2517: Sharing request for in person meeting with board",
          bodyText: [
            "Hello Kathy,",
            "",
            "See below.",
            "",
            "From: Bonnie Kafi",
            "Sent: Thursday, September 11, 2025 8:06 AM",
            "",
            judyParagraph,
          ].join("\n"),
          bodyTextStrictUnique: "Hello Kathy,\n\nSee below.",
          fromAddress: "kc.sahadath@gmail.com",
          toAddresses: ["bkafi@iccpropertymanagement.com"],
        },
      ),
      false,
    );
  });

  it("uses an empty stored strict unique instead of falling back to authored unique", () => {
    assert.equal(
      mentionSearchBody({
        bodyText: "Judy can help with this?",
        bodyTextUnique: "Judy can help with this?",
        bodyTextStrictUnique: "",
      }),
      "",
    );
  });

  it("still counts the original message whose unique body named the person", () => {
    assert.equal(
      mentionCardAppearsInEmail(
        { first_name: "Judy" },
        {
          subject: "Re: TSCC 2517: Sharing request for in person meeting with board",
          bodyText:
            "The team has 24/7 access to ICC's emergency response line, and Judy's contact details are readily available for direct on-site support.",
          bodyTextStrictUnique:
            "The team has 24/7 access to ICC's emergency response line, and Judy's contact details are readily available for direct on-site support.",
          fromAddress: "bkafi@iccpropertymanagement.com",
          toAddresses: ["kc.sahadath@gmail.com"],
        },
      ),
      true,
    );
  });
});

describe("resolveMentionUniqueBody", () => {
  it("matches mentionSearchBody when unique columns are stored", () => {
    const email = {
      bodyText: "full body with quoted Judy history",
      bodyTextUnique: "authored plus leftover quotes",
      bodyTextStrictUnique: "Excellent, thank you. Perhaps Judy can help?",
    };
    assert.equal(
      resolveMentionUniqueBody(email, "live-computed unique"),
      mentionSearchBody(email),
    );
    assert.match(resolveMentionUniqueBody(email), /Judy can help/);
  });

  it("uses live unique only when stored unique columns are missing", () => {
    assert.equal(
      resolveMentionUniqueBody(
        { bodyText: "full body" },
        "live unique with Judy",
      ),
      "live unique with Judy",
    );
  });
});

describe("sourceCardContributedToMerged", () => {
  it("treats a first-name stub as evidence for the richer merged card", () => {
    assert.equal(
      sourceCardContributedToMerged(
        { first_name: "Judy" },
        {
          first_name: "Judy",
          last_name: "Statham",
          email: "jstatham@iccpropertymanagement.com",
        },
      ),
      true,
    );
  });

  it("does not mix two people who only share a first name", () => {
    assert.equal(
      sourceCardContributedToMerged(
        { first_name: "Judy", last_name: "Woo" },
        { first_name: "Judy", last_name: "Statham" },
      ),
      false,
    );
  });

  it("matches on shared mailbox even when the source card is email-only", () => {
    assert.equal(
      sourceCardContributedToMerged(
        { email: "studiopm@iccpropertymanagement.com" },
        {
          first_name: "Haider",
          last_name: "Mukadam",
          email: "studiopm@iccpropertymanagement.com",
        },
      ),
      true,
    );
  });
});

describe("sourceEmailIdsForMergedCard", () => {
  it("attributes only emails whose pass-3 cards belong to the merged person", () => {
    const cardsByEmailId = new Map([
      ["shawna-reply", [{ first_name: "Shawna", last_name: "Greenspan" }]],
      ["bonnie-fwd", [{ first_name: "Judy" }]],
      ["unrelated", [{ first_name: "Bonnie" }]],
    ]);
    const result = sourceEmailIdsForMergedCard({
      merged: {
        first_name: "Judy",
        last_name: "Statham",
        email: "jstatham@iccpropertymanagement.com",
      },
      threadEmailIds: [
        "shawna-reply",
        "bonnie-fwd",
        "unrelated",
        "no-pass-3",
      ],
      cardsByEmailId,
    });
    assert.deepEqual(result.attributed, ["bonnie-fwd"]);
    assert.deepEqual(result.missingPass3, ["no-pass-3"]);
  });
});
