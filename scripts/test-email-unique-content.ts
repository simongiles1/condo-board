import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  emailHtmlToMarkdown,
  looksLikeEmailCssLeak,
  sanitizeEmailHtml,
  scrubEmailCssLeak,
} from "../lib/email/format-body-display";
import {
  resolveHighlightedExcerpt,
  resolveUniqueHighlightSplit,
  splitAtReplyQuote,
  splitBodyForHighlight,
} from "../lib/email/highlight-unique";
import {
  computeUniqueBodyText,
  stripQuotedReplyLines,
} from "../lib/email/quote-strip";
import {
  computeThreadAuthoredBodies,
  computeThreadUniqueBodies,
} from "../lib/email/thread-unique-content";

describe("stripQuotedReplyLines", () => {
  it("keeps the authored reply and drops On…wrote history", () => {
    const text = [
      "Thanks, that works for me.",
      "",
      "On Mon, Jan 1, 2024 at 9:00 AM Jane Doe <jane@example.com> wrote:",
      "> Can we meet Tuesday?",
      ">",
      "> Original question here.",
    ].join("\n");

    assert.equal(stripQuotedReplyLines(text), "Thanks, that works for me.");
  });

  it("cuts soft-wrapped On…wrote: attribution", () => {
    const text = [
      "Thank you,",
      "Shawna",
      "On Sun, Feb 22, 2026 at 10:16 PM Paul Gartenburg",
      "<pgartenburg@gmail.com> wrote:",
      "> prior message",
    ].join("\n");

    assert.equal(stripQuotedReplyLines(text), "Thank you,\nShawna");
  });

  it("keeps forwarded content from another chain", () => {
    const text = [
      "FYI — see below.",
      "",
      "---------- Forwarded message ---------",
      "From: Vendor <vendor@example.com>",
      "Date: Mon, Jan 1, 2024",
      "Subject: Invoice attached",
      "",
      "Please find the invoice for unit 1204.",
    ].join("\n");

    const result = stripQuotedReplyLines(text);
    assert.match(result, /FYI/);
    assert.match(result, /Forwarded message/);
    assert.match(result, /Please find the invoice/);
  });

  it("drops > quoted lines without discarding authored text above", () => {
    const text = ["My update.", "", "> old line from before"].join("\n");
    assert.equal(stripQuotedReplyLines(text), "My update.");
  });
});

describe("splitAtReplyQuote", () => {
  it("highlights authored prefix and keeps quoted history visible", () => {
    const full = "New reply text.\n\nOn Mon wrote:\n> old";
    const split = splitAtReplyQuote(full);
    assert.ok(split);
    assert.equal(split.highlighted.trim(), "New reply text.");
    assert.match(split.remainder, /On Mon wrote/);
  });

  it("highlights the entire body when there is no reply quote", () => {
    const full =
      "See updated from my dad.\n\n---------- Forwarded message ---------\nDad said hi.";
    const split = splitAtReplyQuote(full);
    assert.ok(split);
    assert.equal(split.highlighted, full);
    assert.equal(split.remainder, "");
  });
});

describe("splitBodyForHighlight", () => {
  it("highlights unique prefix inside the full body without dropping the rest", () => {
    const full = "New reply text.\n\nOn Mon wrote:\n> old";
    const unique = "New reply text.";
    const split = splitBodyForHighlight(full, unique);
    assert.ok(split);
    assert.equal(split.highlighted, "New reply text.");
    assert.match(split.remainder, /On Mon wrote/);
    assert.match(split.remainder, /old/);
  });

  it("highlights the entire body when unique equals full", () => {
    const split = splitBodyForHighlight("Only this", "Only this");
    assert.ok(split);
    assert.equal(split.highlighted, "Only this");
    assert.equal(split.remainder, "");
  });

  it("aligns plain unique text to markdown links in the display body", () => {
    const full = [
      "Paul Gartenburg, BESc. Pliteq inc. Project Engineer M: 647-588-7551 [www.pliteq.com](http://www.pliteq.com)",
      "",
      "---------- Forwarded message ---------",
      "From: Dad",
      "",
      "Prior message body here.",
    ].join("\n");
    const unique =
      "Paul Gartenburg, BESc. Pliteq inc. Project Engineer M: 647-588-7551 www.pliteq.com";
    const split = splitBodyForHighlight(full, unique);
    assert.ok(split);
    assert.match(split.highlighted, /Paul Gartenburg/);
    assert.match(split.highlighted, /pliteq/);
    assert.match(split.highlighted, /\]\(http:\/\/www\.pliteq\.com\)/);
    assert.doesNotMatch(split.highlighted, /Forwarded message/);
    assert.match(split.remainder, /Forwarded message/);
  });

  it("does not cut inside a markdown link split across lines", () => {
    const full = [
      "Paul Gartenburg [www.pliteq.com](",
      "http://www.pliteq.com)",
      "",
      "---------- Forwarded message ---------",
      "Dad body",
    ].join("\n");
    const unique = "Paul Gartenburg www.pliteq.com";
    const split = splitBodyForHighlight(full, unique);
    assert.ok(split);
    assert.match(split.highlighted, /www\.pliteq\.com/);
    assert.match(split.highlighted, /http:\/\/www\.pliteq\.com\)/);
    assert.doesNotMatch(split.remainder, /^http:/);
    assert.match(split.remainder, /Forwarded message/);
  });
});

describe("resolveUniqueHighlightSplit / resolveHighlightedExcerpt", () => {
  it("rejects nested On…wrote cuts that balloon past unique (Outlook stacks)", () => {
    const unique = [
      "Please find attached the draft.",
      "",
      "Dad",
      "",
      "John M. Gartenburg",
      "Tel. 416-595-1802",
    ].join("\n");

    const display = [
      unique,
      "",
      "From: Paul Gartenburg <paul@example.com>",
      "Sent: February 22, 2026 5:27 PM",
      "Subject: Fwd: Lethbridge",
      "",
      "See below notes from Shawna.",
      "",
      "Thank you Paul - clarifying the last section.",
      "",
      "Thanks,",
      "Shawna",
      "",
      "On Sun, Feb 22, 2026 at 4:51 PM Paul Gartenburg <paul@example.com> wrote:",
      "> prior message body that is very long and would inflate the excerpt",
    ].join("\n");

    const split = resolveUniqueHighlightSplit(display, unique);
    // unique aligns as a prefix here, so unique→display should win
    assert.ok(split);
    assert.doesNotMatch(split.highlighted, /See below notes from Shawna/);
    assert.doesNotMatch(split.highlighted, /On Sun/);

    // When unique cannot align (e.g. a prior-signature line was stripped),
    // reply-quote fallback must not balloon into nested quote history.
    const uniqueMissingStreet = [
      "Please find attached the draft.",
      "",
      "Dad",
      "",
      "John M. Gartenburg",
      "Suite 2000",
      "Toronto, Ontario",
      "Tel. 416-595-1802",
    ].join("\n");
    const displayWithStreet = [
      "Please find attached the draft.",
      "",
      "Dad",
      "",
      "John M. Gartenburg",
      "Suite 2000",
      "393 University Avenue",
      "Toronto, Ontario",
      "Tel. 416-595-1802",
      "",
      "From: Paul Gartenburg <paul@example.com>",
      "See below notes from Shawna.",
      "Thank you Paul - long quoted body about Michael and Lisa and ICC.",
      "",
      "On Sun, Feb 22, 2026 at 4:51 PM Paul Gartenburg <paul@example.com> wrote:",
      "> prior",
    ].join("\n");

    const failedAlign = resolveUniqueHighlightSplit(
      displayWithStreet,
      uniqueMissingStreet,
    );
    assert.equal(failedAlign, null);

    const excerpt = resolveHighlightedExcerpt(
      displayWithStreet,
      uniqueMissingStreet,
    );
    assert.equal(excerpt, uniqueMissingStreet);
    assert.doesNotMatch(excerpt, /See below notes from Shawna/);
    assert.doesNotMatch(excerpt, /393 University/);
  });
});

describe("computeThreadUniqueBodies", () => {
  it("extracts triangular reply growth down to each author's new text", () => {
    const messages = [
      {
        id: "a",
        receivedAt: "2024-01-01T10:00:00.000Z",
        bodyText: "Can we meet Tuesday?",
      },
      {
        id: "b",
        receivedAt: "2024-01-01T11:00:00.000Z",
        bodyText: [
          "Tuesday works.",
          "",
          "On Mon, Jane wrote:",
          "> Can we meet Tuesday?",
        ].join("\n"),
      },
      {
        id: "c",
        receivedAt: "2024-01-01T12:00:00.000Z",
        bodyText: [
          "Great, see you then.",
          "",
          "On Mon, Bob wrote:",
          "> Tuesday works.",
          ">",
          "> On Mon, Jane wrote:",
          "> Can we meet Tuesday?",
        ].join("\n"),
      },
    ];

    const unique = computeThreadUniqueBodies(messages);
    assert.equal(unique.get("a"), "Can we meet Tuesday?");
    assert.equal(unique.get("b"), "Tuesday works.");
    assert.equal(unique.get("c"), "Great, see you then.");
  });

  it("does not strip a forward that is new to the thread", () => {
    const messages = [
      {
        id: "a",
        receivedAt: "2024-01-01T10:00:00.000Z",
        bodyText: "Starting the thread.",
      },
      {
        id: "b",
        receivedAt: "2024-01-01T11:00:00.000Z",
        bodyText: [
          "Passing along the vendor note.",
          "",
          "---------- Forwarded message ---------",
          "From: Vendor <vendor@example.com>",
          "",
          "Roof repair quote is $4,200.",
          "",
          "On Mon, Alice wrote:",
          "> Starting the thread.",
        ].join("\n"),
      },
    ];

    const unique = computeThreadUniqueBodies(messages);
    const b = unique.get("b") ?? "";
    assert.match(b, /Passing along the vendor note/);
    assert.match(b, /Forwarded message/);
    assert.match(b, /Roof repair quote/);
    assert.doesNotMatch(b, /Starting the thread/);
  });

  it("dedupes a forward of an earlier thread message", () => {
    const messages = [
      {
        id: "a",
        receivedAt: "2024-01-01T10:00:00.000Z",
        bodyText: "Roof repair quote is $4,200.",
      },
      {
        id: "b",
        receivedAt: "2024-01-01T11:00:00.000Z",
        bodyText: [
          "See updated from my dad.",
          "",
          "---------- Forwarded message ---------",
          "From: Dad <dad@example.com>",
          "",
          "Roof repair quote is $4,200.",
        ].join("\n"),
      },
    ];

    const unique = computeThreadUniqueBodies(messages);
    const b = unique.get("b") ?? "";
    assert.match(b, /See updated from my dad/);
    assert.doesNotMatch(b, /Roof repair quote/);
    assert.doesNotMatch(b, /Forwarded message/);
  });

  it("dedupes a forward when Outlook/Gmail formatting differs", () => {
    const messages = [
      {
        id: "a",
        receivedAt: "2024-01-01T10:00:00.000Z",
        bodyText: [
          "Paul,",
          "",
          " ",
          "",
          "I suggest that you send the following to Joseph:",
          "",
          " ",
          "",
          '"Thanks for your email of February 10.  We agree with your recommendation."',
          "",
          "Dad",
        ].join("\n"),
      },
      {
        id: "b",
        receivedAt: "2024-01-01T11:00:00.000Z",
        bodyText: [
          "Paul Gartenburg, BESc. Pliteq inc.",
          "",
          "---------- Forwarded message ---------",
          "From: Dad <dad@example.com>",
          "Date: Sun, Feb 22, 2026 at 4:50 PM",
          "Subject: Lethbridge",
          "",
          "Paul,",
          "",
          "I suggest that you send the following to Joseph:",
          "",
          "“Thanks for your email of February 10.  We agree with your recommendation.”",
          "",
          "Dad",
        ].join("\n"),
      },
    ];

    const unique = computeThreadUniqueBodies(messages);
    const b = unique.get("b") ?? "";
    assert.match(b, /Paul Gartenburg/);
    assert.doesNotMatch(b, /Forwarded message/);
    assert.doesNotMatch(b, /I suggest that you send/);
    assert.doesNotMatch(b, /Thanks for your email/);
  });

  it("strict unique may drop a repeated signature; authored keeps it", () => {
    const signature =
      "Paul Gartenburg, BESc. Pliteq inc. Project Engineer M: 647-588-7551 www.pliteq.com";
    const shawnaBody =
      "Thank you Paul - clarifying the last section about the background.";
    const messages = [
      {
        id: "a",
        receivedAt: "2024-01-01T10:00:00.000Z",
        bodyText: [
          signature,
          "",
          "---------- Forwarded message ---------",
          "From: Dad <dad@example.com>",
          "",
          "Original dad body about the roof.",
        ].join("\n"),
      },
      {
        id: "shawna",
        receivedAt: "2024-01-01T10:30:00.000Z",
        bodyText: shawnaBody,
      },
      {
        id: "b",
        receivedAt: "2024-01-01T11:00:00.000Z",
        bodyText: [
          "See below notes from Shawna.",
          "",
          signature,
          "",
          "---------- Forwarded message ---------",
          "From: Shawna <shawna@example.com>",
          "",
          shawnaBody,
        ].join("\n"),
      },
    ];

    const unique = computeThreadUniqueBodies(messages);
    const authored = computeThreadAuthoredBodies(messages);
    const uniqueB = unique.get("b") ?? "";
    const authoredB = authored.get("b") ?? "";

    assert.match(uniqueB, /See below notes from Shawna/);
    assert.doesNotMatch(uniqueB, /647-588-7551/);
    assert.doesNotMatch(uniqueB, /Forwarded message/);
    assert.doesNotMatch(uniqueB, /Thank you Paul/);

    assert.match(authoredB, /See below notes from Shawna/);
    assert.match(authoredB, /647-588-7551/);
    assert.match(authoredB, /Paul Gartenburg/);
    assert.doesNotMatch(authoredB, /Forwarded message/);
    assert.doesNotMatch(authoredB, /Thank you Paul/);
  });
});

describe("computeUniqueBodyText", () => {
  it("falls back to HTML when plain strip is empty", () => {
    const html = `
      <div>Board vote is tomorrow.</div>
      <div class="gmail_quote">
        <div>On Mon wrote:</div>
        <blockquote>old stuff</blockquote>
      </div>
    `;
    const result = computeUniqueBodyText("   ", html);
    assert.match(result, /Board vote is tomorrow/);
    assert.doesNotMatch(result, /old stuff/);
  });
});

describe("sanitizeEmailHtml", () => {
  it("removes Outlook font definition comments before markdown", () => {
    const html = `
      <!-- /* Font Definitions */ @font-face {font-family:"Cambria Math";} -->
      <style>.MsoNormal { margin:0; }</style>
      <div>Paul,</div>
      <div>Please find attached the draft.</div>
    `;
    const sanitized = sanitizeEmailHtml(html);
    assert.doesNotMatch(sanitized, /Font Definitions/);
    assert.doesNotMatch(sanitized, /MsoNormal/);
    assert.match(sanitized, /Please find attached/);

    const markdown = emailHtmlToMarkdown(html);
    assert.doesNotMatch(markdown, /Font Definitions/);
    assert.doesNotMatch(markdown, /@font-face/);
    assert.match(markdown, /Please find attached/);
  });
});

describe("MJML CSS leak in plain-text parts", () => {
  const pollutedPlain = [
    "#outlook a { padding:0; }",
    "body { margin:0;padding:0;-webkit-text-size-adjust:100%; }",
    ".mj-column-per-100 { width:100% !important; }",
    "",
    "You’re receiving this email because you are a member.",
  ].join("\n");

  const html = `
    <html><head><style>.mj-column-per-100{width:100%}</style></head>
    <body>
      <div>Dear Residents,</div>
      <div>The Management Office will close early on Friday.</div>
      <div>Haider Mukadam, Condominium Manager</div>
    </body></html>
  `;

  it("detects CSS-polluted plain text", () => {
    assert.equal(looksLikeEmailCssLeak(pollutedPlain), true);
    assert.equal(looksLikeEmailCssLeak("Hi Haider,\n\nThanks."), false);
  });

  it("prefers HTML when plain text is an MJML CSS dump", () => {
    const unique = computeUniqueBodyText(pollutedPlain, html);
    assert.doesNotMatch(unique, /#outlook/);
    assert.doesNotMatch(unique, /mj-column/);
    assert.match(unique, /Dear Residents/);
    assert.match(unique, /Management Office/);
  });

  it("scrubs CSS when no HTML is available", () => {
    const scrubbed = scrubEmailCssLeak(pollutedPlain);
    assert.doesNotMatch(scrubbed, /#outlook/);
    assert.match(scrubbed, /You’re receiving this email/);
  });

  it("collapses MJML indent-only blank lines from HTML strip", () => {
    const unique = computeUniqueBodyText(pollutedPlain, html);
    const blankLines = unique.split("\n").filter((l) => !l.trim()).length;
    assert.ok(blankLines <= 3, `expected few blank lines, got ${blankLines}`);
    assert.doesNotMatch(unique, /\n{3,}/);
  });
});
