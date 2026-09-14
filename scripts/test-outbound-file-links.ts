/**
 * Unit checks for outbound file-link detection (no network / no DB).
 * Run: npx tsx --test scripts/test-outbound-file-links.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyOutboundFileUrl,
  extractOutboundFileLinks,
} from "../lib/email/outbound-file-links";

describe("classifyOutboundFileUrl", () => {
  it("flags zip URLs and common cloud hosts", () => {
    assert.equal(
      classifyOutboundFileUrl(
        "https://files.iccproperty.com/board/June30.zip",
      ),
      "zip",
    );
    assert.equal(
      classifyOutboundFileUrl("https://www.dropbox.com/s/abc/package.zip?dl=0"),
      "zip",
    );
    assert.equal(
      classifyOutboundFileUrl("https://drive.google.com/file/d/abc/view"),
      "cloud",
    );
    assert.equal(classifyOutboundFileUrl("https://we.tl/t-abc"), "cloud");
    assert.equal(classifyOutboundFileUrl("https://example.com/minutes"), null);
  });
});

describe("extractOutboundFileLinks", () => {
  it("reads zip and cloud hrefs from HTML and skips social links", () => {
    const links = extractOutboundFileLinks({
      html: `<p>Package is here:
        <a href="https://files.iccproperty.com/Jun30-BoardPackage.zip">June 30 package</a>
        and <a href="https://www.facebook.com/icc">facebook</a></p>`,
      text: "Also https://dropbox.com/scl/fi/abc/board",
    });
    assert.equal(links.length, 2);
    assert.equal(links[0]?.kind, "zip");
    assert.equal(links[0]?.label, "June 30 package");
    assert.equal(links[1]?.kind, "cloud");
  });
});
