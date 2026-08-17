/**
 * Harvest tooltip card matching tests.
 * Run: npx tsx --test scripts/test-harvest-tooltip-match.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  pickBestContactCard,
  pickBestOrgCard,
  resolveHarvestTooltipContent,
  scoreContactCard,
  scoreOrgCard,
} from "../lib/email-analysis/harvest-tooltip-match";
import type { HarvestMarkNode } from "../lib/email-analysis/harvest-highlight-spans";

describe("scoreContactCard", () => {
  const haider = {
    first_name: "Haider",
    last_name: "Mukadam",
    email: "haider@iccpropertymanagement.com",
    phone: "905-946-1818",
    job_title: "Condominium Manager",
  };

  it("scores a full name match highest", () => {
    assert.ok(scoreContactCard(haider, "Haider Mukadam") > 10);
  });

  it("scores a job title span", () => {
    assert.ok(scoreContactCard(haider, "Condominium Manager") >= 8);
  });

  it("does not match an unrelated org name", () => {
    assert.equal(scoreContactCard(haider, "ICC Property Management Ltd."), 0);
  });
});

describe("pickBestContactCard", () => {
  it("prefers the richer card when two names match", () => {
    const stub = {
      first_name: "Haider",
      last_name: "Mukadam",
      email: null,
      phone: null,
      job_title: null,
    };
    const rich = {
      first_name: "Haider",
      last_name: "Mukadam",
      email: "haider@icc.com",
      phone: "905-946-1818",
      job_title: "Condominium Manager",
    };
    const picked = pickBestContactCard([stub, rich], "Haider Mukadam");
    assert.equal(picked?.email, rich.email);
    assert.equal(picked?.job_title, rich.job_title);
  });
});

describe("scoreOrgCard", () => {
  const icc = {
    name: "ICC Property Management Ltd.",
    organization_role: "Property Manager",
    email: null,
    phone: "905-946-1818",
    website: "http://www.iccpropertymanagement.com/",
    aliases: ["ICC"],
  };

  it("matches an org name ignoring Ltd suffix", () => {
    assert.ok(scoreOrgCard(icc, "ICC Property Management Ltd.") >= 12);
  });

  it("matches a website span inside angle-bracket markdown", () => {
    assert.ok(
      scoreOrgCard(
        icc,
        "www.iccpropertymanagement.com <http://www.iccpropertymanagement.com/>",
      ) >= 10,
    );
  });

  it("matches an organization role", () => {
    assert.ok(scoreOrgCard(icc, "Property Manager") >= 8);
  });
});

describe("pickBestOrgCard", () => {
  it("picks the named org over a weaker alias-only hit", () => {
    const studio = {
      name: "Studio on Richmond – TSCC 2517",
      organization_role: null,
      email: null,
      phone: null,
      website: null,
    };
    const icc = {
      name: "ICC Property Management Ltd.",
      organization_role: "Property Manager",
      email: null,
      phone: null,
      website: "www.iccpropertymanagement.com",
    };
    const picked = pickBestOrgCard([studio, icc], "ICC Property Management Ltd.");
    assert.equal(picked?.name, icc.name);
  });
});

describe("resolveHarvestTooltipContent", () => {
  const nameNode: HarvestMarkNode = {
    start: 0,
    end: 14,
    layers: [
      {
        group: "contact",
        type: "contact_name",
        start: 0,
        end: 14,
        title: "Contact name: Haider Mukadam",
      },
    ],
    children: [],
  };

  it("attaches a contact fingerprint to a name span", () => {
    const content = resolveHarvestTooltipContent({
      node: nameNode,
      highlightedText: "Haider Mukadam",
      bodyText: "Haider Mukadam",
      contactCards: [
        {
          first_name: "Haider",
          last_name: "Mukadam",
          email: "haider@icc.com",
          phone: null,
          job_title: "Condominium Manager",
        },
      ],
      orgCards: [],
      events: [],
    });
    assert.equal(content.primaryGroup, "contact");
    assert.equal(content.contact?.card?.email, "haider@icc.com");
    assert.equal(content.organization, null);
    assert.equal(content.events.length, 0);
  });

  it("stacks contact and org cards on a shared company/org span", () => {
    const node: HarvestMarkNode = {
      start: 0,
      end: 30,
      layers: [
        {
          group: "contact",
          type: "company_name",
          start: 0,
          end: 30,
          title: "Company: ICC Property Management Ltd.",
        },
        {
          group: "organization",
          type: "organization_name",
          start: 0,
          end: 30,
          title: "Organization: ICC Property Management Ltd.",
        },
      ],
      children: [],
    };
    const content = resolveHarvestTooltipContent({
      node,
      highlightedText: "ICC Property Management Ltd.",
      bodyText: "ICC Property Management Ltd.",
      contactCards: [
        {
          first_name: "Haider",
          last_name: "Mukadam",
          email: null,
          phone: null,
          job_title: null,
        },
      ],
      orgCards: [
        {
          name: "ICC Property Management Ltd.",
          organization_role: "Property Manager",
          email: null,
          phone: null,
          website: "www.iccpropertymanagement.com",
        },
      ],
      events: [],
    });
    assert.equal(content.contact?.card, null);
    assert.equal(content.organization?.card?.organization_role, "Property Manager");
  });

  it("matches an event by overlapping source quote", () => {
    const text = "Please join the AGM on Tuesday in the lobby.";
    const node: HarvestMarkNode = {
      start: 0,
      end: text.length,
      layers: [
        {
          group: "event",
          type: "meeting",
          start: 0,
          end: text.length,
          title: "Meeting: Annual general meeting",
        },
      ],
      children: [],
    };
    const content = resolveHarvestTooltipContent({
      node,
      highlightedText: text,
      bodyText: text,
      contactCards: [],
      orgCards: [],
      events: [
        {
          type: "meeting",
          title: "Annual general meeting",
          when: "Apr 15, 2026 · 7:00 PM",
          detail: "Lobby",
          sourceQuote: "Please join the AGM on Tuesday in the lobby.",
        },
      ],
    });
    assert.equal(content.events.length, 1);
    assert.equal(content.events[0]?.event?.when, "Apr 15, 2026 · 7:00 PM");
    assert.equal(content.events[0]?.event?.detail, "Lobby");
  });

  it("matches a to-do by overlapping source quote", () => {
    const text = "Please send the AGM package to owners this week.";
    const node: HarvestMarkNode = {
      start: 0,
      end: text.length,
      layers: [
        {
          group: "todo",
          type: "action_item",
          start: 0,
          end: text.length,
          title: "To-do: Send the AGM package to owners",
        },
      ],
      children: [],
    };
    const content = resolveHarvestTooltipContent({
      node,
      highlightedText: text,
      bodyText: text,
      contactCards: [],
      orgCards: [],
      events: [],
      todos: [
        {
          type: "action_item",
          title: "Send the AGM package to owners",
          detail: "Management",
          sourceQuote: "Please send the AGM package to owners this week.",
        },
      ],
    });
    assert.equal(content.todos.length, 1);
    assert.equal(
      content.todos[0]?.event?.title,
      "Send the AGM package to owners",
    );
    assert.equal(content.todos[0]?.event?.detail, "Management");
  });
});
