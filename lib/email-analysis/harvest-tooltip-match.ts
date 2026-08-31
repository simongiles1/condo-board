/**
 * Match a harvest highlight span to fingerprint cards / events for rich tooltips.
 */

import type { ContactEntityCard } from "@/lib/email-analysis/contact-highlight-shared";
import {
  findFlexibleQuoteRange,
  type HarvestMarkNode,
  type HarvestSpan,
} from "@/lib/email-analysis/harvest-highlight-spans";
import {
  primaryHarvestGroup,
  type HarvestGroupId,
} from "@/lib/email-analysis/harvest-highlight-theme";
import type { OrgEntityCard } from "@/lib/email-analysis/org-highlight-shared";
import type { ProjectEntityCard } from "@/lib/email-analysis/project-highlight-shared";
import { normalizeProjectNameKey } from "@/lib/projects/project-multi-values";
import {
  normalizeOrgName,
  normalizePersonName,
  normalizePhone,
} from "@/lib/email/entity-dedup";

export type HarvestTooltipEvent = {
  type: string;
  title: string;
  when?: string | null;
  detail?: string | null;
  sourceQuote: string | null;
};

export type HarvestTooltipContent = {
  primaryGroup: HarvestGroupId;
  highlightedText: string;
  contact: {
    card: ContactEntityCard | null;
    layers: HarvestSpan[];
  } | null;
  organization: {
    card: OrgEntityCard | null;
    layers: HarvestSpan[];
  } | null;
  project: {
    card: ProjectEntityCard | null;
    layers: HarvestSpan[];
  } | null;
  events: Array<{
    event: HarvestTooltipEvent | null;
    layer: HarvestSpan;
  }>;
  todos: Array<{
    event: HarvestTooltipEvent | null;
    layer: HarvestSpan;
  }>;
};

function collapseNeedle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/[–—]/g, "-");
}

function containsEither(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function fieldCount(values: Array<string | null | undefined>): number {
  return values.filter((value) => Boolean(value?.trim())).length;
}

function normalizeWebsite(value: string): string {
  let text = collapseNeedle(value);
  const angle = text.match(/https?:\/\/[^\s<>]+/i);
  if (angle) text = angle[0];
  text = text.replace(/^https?:\/\//, "");
  text = text.replace(/^www\./, "");
  text = text.split(/[/?#\s<>]/)[0] ?? text;
  return text.replace(/\/+$/, "");
}

function phonesMatch(a: string, b: string): boolean {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  if (left.length < 7 || right.length < 7) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

export function scoreContactCard(
  card: ContactEntityCard,
  needle: string,
): number {
  const n = collapseNeedle(needle);
  if (!n) return 0;

  let score = 0;
  const fullName = normalizePersonName(
    [card.first_name, card.last_name].filter(Boolean).join(" "),
  );
  if (fullName) {
    const needleName = normalizePersonName(needle);
    if (fullName === needleName) score += 12;
    else if (containsEither(fullName, needleName)) score += 8;
  }
  const first = card.first_name ? collapseNeedle(card.first_name) : "";
  const last = card.last_name ? collapseNeedle(card.last_name) : "";
  if (last && (n === last || n.endsWith(` ${last}`))) score += 5;
  if (first && n === first) score += 3;
  if (card.email && containsEither(collapseNeedle(card.email), n)) score += 10;
  if (card.phone && phonesMatch(card.phone, needle)) score += 10;
  if (card.job_title && containsEither(collapseNeedle(card.job_title), n)) {
    score += 8;
  }
  return score;
}

export function scoreOrgCard(card: OrgEntityCard, needle: string): number {
  const n = collapseNeedle(needle);
  if (!n) return 0;

  let score = 0;
  if (card.name) {
    const cardName = normalizeOrgName(card.name);
    const needleName = normalizeOrgName(needle);
    if (cardName && needleName) {
      if (cardName === needleName) score += 12;
      else if (containsEither(cardName, needleName)) score += 8;
    }
  }
  for (const alias of card.aliases ?? []) {
    const aliasName = normalizeOrgName(alias);
    const needleName = normalizeOrgName(needle);
    if (aliasName && needleName && containsEither(aliasName, needleName)) {
      score += 9;
    }
  }
  if (card.website) {
    const cardWeb = normalizeWebsite(card.website);
    const needleWeb = normalizeWebsite(needle);
    if (cardWeb && needleWeb && containsEither(cardWeb, needleWeb)) score += 10;
  }
  if (card.phone && phonesMatch(card.phone, needle)) score += 10;
  if (
    card.organization_role &&
    containsEither(collapseNeedle(card.organization_role), n)
  ) {
    score += 8;
  }
  if (card.email && containsEither(collapseNeedle(card.email), n)) score += 10;
  return score;
}

function pickBestCard<T>(
  cards: T[],
  scoreFn: (card: T) => number,
  richnessFn: (card: T) => number,
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  let bestRichness = -1;
  for (const card of cards) {
    const score = scoreFn(card);
    if (score <= 0) continue;
    const richness = richnessFn(card);
    if (
      score > bestScore ||
      (score === bestScore && richness > bestRichness)
    ) {
      best = card;
      bestScore = score;
      bestRichness = richness;
    }
  }
  return best;
}

export function pickBestContactCard(
  cards: ContactEntityCard[],
  needle: string,
): ContactEntityCard | null {
  return pickBestCard(
    cards,
    (card) => scoreContactCard(card, needle),
    (card) =>
      fieldCount([
        card.first_name,
        card.last_name,
        card.email,
        card.phone,
        card.job_title,
      ]),
  );
}

export function pickBestOrgCard(
  cards: OrgEntityCard[],
  needle: string,
): OrgEntityCard | null {
  return pickBestCard(
    cards,
    (card) => scoreOrgCard(card, needle),
    (card) =>
      fieldCount([
        card.name,
        card.organization_role,
        card.email,
        card.phone,
        card.website,
      ]),
  );
}

export function scoreProjectCard(
  card: ProjectEntityCard,
  needle: string,
): number {
  const n = collapseNeedle(needle);
  if (!n) return 0;

  let score = 0;
  if (card.name) {
    const cardName = normalizeProjectNameKey(card.name);
    const needleName = normalizeProjectNameKey(needle);
    if (cardName && needleName) {
      if (cardName === needleName) score += 12;
      else if (containsEither(cardName, needleName)) score += 8;
    }
  }
  for (const alias of card.aliases ?? []) {
    const aliasName = normalizeProjectNameKey(alias);
    const needleName = normalizeProjectNameKey(needle);
    if (aliasName && needleName && containsEither(aliasName, needleName)) {
      score += 9;
    }
  }
  // Contractor is a vendor firm, not project identity — same rule as mention resolve.
  if (card.location && containsEither(collapseNeedle(card.location), n)) {
    score += 8;
  }
  if (card.year_hint && containsEither(collapseNeedle(card.year_hint), n)) {
    score += 6;
  }
  if (card.phase && containsEither(collapseNeedle(card.phase), n)) {
    score += 6;
  }
  return score;
}

export function pickBestProjectCard(
  cards: ProjectEntityCard[],
  needle: string,
): ProjectEntityCard | null {
  return pickBestCard(
    cards,
    (card) => scoreProjectCard(card, needle),
    (card) =>
      fieldCount([
        card.name,
        card.year_hint,
        card.phase,
        card.contractor,
        card.location,
        card.equipment_mentions,
      ]),
  );
}

function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

export function matchHarvestGroupItems(
  node: Pick<HarvestMarkNode, "start" | "end" | "layers">,
  items: HarvestTooltipEvent[],
  bodyText: string,
  group: HarvestGroupId,
): Array<{ event: HarvestTooltipEvent | null; layer: HarvestSpan }> {
  const layers = node.layers.filter((layer) => layer.group === group);
  return layers.map((layer) => {
    const matched =
      items.find((event) => {
        if (group !== "todo" && event.type !== layer.type) return false;
        if (event.sourceQuote) {
          const range = findFlexibleQuoteRange(bodyText, event.sourceQuote);
          if (range && rangesOverlap(range, node)) return true;
        }
        return layer.title.toLowerCase().includes(event.title.toLowerCase());
      }) ?? null;
    return { event: matched, layer };
  });
}

export function matchHarvestEvents(
  node: Pick<HarvestMarkNode, "start" | "end" | "layers">,
  events: HarvestTooltipEvent[],
  bodyText: string,
): Array<{ event: HarvestTooltipEvent | null; layer: HarvestSpan }> {
  return matchHarvestGroupItems(node, events, bodyText, "event");
}

export function resolveHarvestTooltipContent(input: {
  node: HarvestMarkNode;
  highlightedText: string;
  bodyText: string;
  contactCards: ContactEntityCard[];
  orgCards: OrgEntityCard[];
  projectCards?: ProjectEntityCard[];
  events: HarvestTooltipEvent[];
  todos?: HarvestTooltipEvent[];
}): HarvestTooltipContent {
  const contactLayers = input.node.layers.filter(
    (layer) => layer.group === "contact",
  );
  const orgLayers = input.node.layers.filter(
    (layer) => layer.group === "organization",
  );
  const projectLayers = input.node.layers.filter(
    (layer) => layer.group === "project",
  );
  const needle = input.highlightedText;

  return {
    primaryGroup: primaryHarvestGroup(
      input.node.layers.map((layer) => layer.group),
    ),
    highlightedText: needle,
    contact:
      contactLayers.length > 0
        ? {
            card: pickBestContactCard(input.contactCards, needle),
            layers: contactLayers,
          }
        : null,
    organization:
      orgLayers.length > 0
        ? {
            card: pickBestOrgCard(input.orgCards, needle),
            layers: orgLayers,
          }
        : null,
    project:
      projectLayers.length > 0
        ? {
            card: pickBestProjectCard(input.projectCards ?? [], needle),
            layers: projectLayers,
          }
        : null,
    events: matchHarvestEvents(input.node, input.events, input.bodyText),
    todos: matchHarvestGroupItems(
      input.node,
      input.todos ?? [],
      input.bodyText,
      "todo",
    ),
  };
}
