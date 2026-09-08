/**
 * Pure equipment resolution engine: canonical register lookup, alias matching,
 * component-to-parent mapping, bid-alternative suppression, and provisional quarantine.
 *
 * No database imports — 100% testable in isolation.
 */

export type EquipmentRegistryDocument = {
  id: string;
  canonicalName: string;
  category: string | null;
  floor: number | null;
  location: string | null;
  aliases: string[];
  componentKeywords: string[];
  status: "active" | "provisional" | "decommissioned";
  parentEquipmentId?: string | null;
};

export type EquipmentMentionQuery = {
  rawName: string;
  extractedRole?: "installed_system" | "bid_alternative" | "component" | null;
  parentSystemHint?: string | null;
  location?: string | null;
  floor?: number | null;
  category?: string | null;
  contextSnippet?: string | null;
};

export type EquipmentResolutionStatus = "confirmed" | "provisional" | "unresolved";

export type EquipmentResolveDecision = {
  status: EquipmentResolutionStatus;
  resolvedEquipmentId: string | null;
  reason: string;
  isComponentPart?: boolean;
  isBidAlternative?: boolean;
};

const ACTION_PREFIXES = [
  "emergency repair work at",
  "emergency repair work on",
  "emergency repair work to",
  "emergency repair of",
  "emergency repair to",
  "emergency repair at",
  "emergency repair on",
  "repair work at",
  "repair work on",
  "repair work to",
  "repair of",
  "repair to",
  "repair at",
  "repair on",
  "repairs to",
  "repairs on",
  "repairs at",
  "replace broken",
  "replace faulty",
  "replace of",
  "replace",
  "service call for",
  "service call on",
  "service to",
  "service for",
  "replacement of",
  "replacement for",
  "replacing",
  "install of",
  "installation of",
  "installing",
  "install",
  "quote for",
  "tender for",
  "investigation of",
  "inspection of",
  "annual inspection of",
  "annual testing of",
  "testing and inspection of",
  "maintenance for",
  "maintenance of",
  "maintenance on",
  "work on",
  "work at",
  "rectification of",
  "upgrade of",
  "preventative maintenance on",
];

const GENERIC_HARDWARE_PARTS = new Set([
  "screw",
  "screws",
  "bolt",
  "bolts",
  "nut",
  "nuts",
  "washer",
  "washers",
  "nail",
  "nails",
  "pipe",
  "pipes",
  "caulking",
  "sealant",
  "tape",
  "glue",
  "wiring",
  "wire",
  "wires",
  "cable",
  "cables",
  "conduit",
  "rags",
  "grease",
  "oil",
  "filter",
  "filters",
  "fuse",
  "fuses",
  "bulb",
  "bulbs",
  "light bulb",
  "paint",
  "drywall",
  "tile",
  "tiles",
  "carpet",
  "carpets",
  "wood",
  "wood panel",
  "wood panels",
  "mats",
  "winter mats",
]);

/** Normalize text for fuzzy matching: lowercase, strip punctuation, normalize spaces. */
export function normalizeEquipmentKey(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Check if phrase looks like an operational or maintenance action rather than an asset noun. */
export function isActionPhrase(phrase: string): boolean {
  const norm = phrase.toLowerCase().trim();
  for (const prefix of ACTION_PREFIXES) {
    if (norm.startsWith(prefix) || norm.includes(` ${prefix} `)) {
      return true;
    }
  }
  return /\b(repair|repairs|replace|replacing|replacement|install|installing|installation|testing|inspecting|inspection|service|servicing|maintenance|rectification|preventative|upgrade|upgrading|broken|faulty|leak|emergency)\b/i.test(
    norm,
  );
}

/** Strip operational action prefixes to get the core asset phrase. */
export function stripActionPrefix(phrase: string): string {
  let cleaned = phrase.trim();
  let changed = true;
  while (changed) {
    changed = false;
    const lower = cleaned.toLowerCase();
    for (const prefix of ACTION_PREFIXES) {
      if (lower.startsWith(prefix + " ")) {
        cleaned = cleaned.slice(prefix.length + 1).trim();
        changed = true;
        break;
      }
    }
  }
  return cleaned;
}

/** Validate whether a string is eligible to be a canonical alias (reject action sentences). */
export function validateCanonicalAlias(alias: string): {
  valid: boolean;
  reason?: string;
} {
  const trimmed = alias.trim();
  if (trimmed.length < 3) {
    return { valid: false, reason: "Too short to be an asset alias" };
  }
  if (trimmed.length > 70) {
    return { valid: false, reason: "Too long; likely a sentence or scope description" };
  }
  if (isActionPhrase(trimmed)) {
    return { valid: false, reason: "Contains operational action phrase, not an asset name" };
  }
  if (GENERIC_HARDWARE_PARTS.has(trimmed.toLowerCase())) {
    return { valid: false, reason: "Generic consumable or hardware part, not an asset alias" };
  }
  return { valid: true };
}

/** Check if a term represents generic consumable or hardware that should never be minted. */
export function isGenericConsumableOrHardware(term: string): boolean {
  const norm = normalizeEquipmentKey(term);
  return GENERIC_HARDWARE_PARTS.has(norm);
}

/** Check if location or context indicates P1 vs P2 level. */
function contextMatchesFloor(
  floor: number | null,
  location: string | null | undefined,
  context: string | null | undefined,
): boolean {
  if (floor == null) return true;
  const combined = `${location ?? ""} ${context ?? ""}`.toLowerCase();
  if (floor === -1) {
    if (/\b(p1|parking 1|public parking|visitor|commercial)\b/.test(combined)) return true;
    if (/\b(p2|residential parking)\b/.test(combined)) return false;
  }
  if (floor === -2) {
    if (/\b(p2|parking 2|residential parking)\b/.test(combined)) return true;
    if (/\b(p1|public parking)\b/.test(combined)) return false;
  }
  return true;
}

/**
 * Resolve an equipment mention against the canonical register.
 */
export function decideEquipmentMentionResolution(
  query: EquipmentMentionQuery,
  registry: EquipmentRegistryDocument[],
): EquipmentResolveDecision {
  const rawClean = (query.rawName || "").trim();
  if (!rawClean) {
    return {
      status: "unresolved",
      resolvedEquipmentId: null,
      reason: "empty_mention_name",
    };
  }

  // 1. Filter out generic consumables / small hardware parts completely
  if (isGenericConsumableOrHardware(rawClean)) {
    return {
      status: "unresolved",
      resolvedEquipmentId: null,
      reason: "generic_consumable_ignored",
      isComponentPart: true,
    };
  }

  // 2. Strip any action prefixes from search name
  const strippedName = stripActionPrefix(rawClean);
  const normalizedRaw = normalizeEquipmentKey(rawClean);
  const normalizedStripped = normalizeEquipmentKey(strippedName);
  const combinedContext = `${query.location ?? ""} ${query.contextSnippet ?? ""}`.toLowerCase();

  // 3. Bid-alternative handling: NEVER mint an asset!
  const isBidAlt =
    query.extractedRole === "bid_alternative" ||
    /\b(bid alternative|quote alternative|option [1-9]|alternate make)\b/i.test(
      combinedContext,
    );

  if (isBidAlt) {
    // If there is a parent system hint, resolve to parent system
    if (query.parentSystemHint?.trim()) {
      const parentQuery: EquipmentMentionQuery = {
        rawName: query.parentSystemHint,
        location: query.location,
        floor: query.floor,
        contextSnippet: query.contextSnippet,
      };
      const parentDecision = decideEquipmentMentionResolution(
        parentQuery,
        registry,
      );
      if (parentDecision.status === "confirmed" && parentDecision.resolvedEquipmentId) {
        return {
          status: "confirmed",
          resolvedEquipmentId: parentDecision.resolvedEquipmentId,
          reason: "bid_alternative_mapped_to_parent",
          isBidAlternative: true,
        };
      }
    }
    // Standalone bid alternative without parent system match remains unresolved and un-minted
    return {
      status: "unresolved",
      resolvedEquipmentId: null,
      reason: "bid_alternative_unattached",
      isBidAlternative: true,
    };
  }

  // 4. Exact ID Match (e.g. "DOOR-PUBLIC-P1")
  const exactIdMatch = registry.find(
    (item) => item.id.toUpperCase() === rawClean.toUpperCase(),
  );
  if (exactIdMatch) {
    return {
      status: "confirmed",
      resolvedEquipmentId: exactIdMatch.id,
      reason: "exact_id_match",
    };
  }

  // 5. Canonical Name or Alias Exact Match
  const nameMatches: EquipmentRegistryDocument[] = [];
  for (const doc of registry) {
    const docNormName = normalizeEquipmentKey(doc.canonicalName);
    if (docNormName === normalizedRaw || docNormName === normalizedStripped) {
      nameMatches.push(doc);
      continue;
    }
    for (const alias of doc.aliases) {
      const aliasNorm = normalizeEquipmentKey(alias);
      if (aliasNorm === normalizedRaw || aliasNorm === normalizedStripped) {
        nameMatches.push(doc);
        break;
      }
    }
  }

  if (nameMatches.length === 1) {
    return {
      status: "confirmed",
      resolvedEquipmentId: nameMatches[0].id,
      reason: "alias_or_name_match",
    };
  }

  if (nameMatches.length > 1) {
    // Try disambiguating with floor/location context (e.g. P1 vs P2)
    const contextFiltered = nameMatches.filter((doc) =>
      contextMatchesFloor(doc.floor, query.location, query.contextSnippet),
    );
    if (contextFiltered.length === 1) {
      return {
        status: "confirmed",
        resolvedEquipmentId: contextFiltered[0].id,
        reason: "alias_match_disambiguated_by_location",
      };
    }
    return {
      status: "unresolved",
      resolvedEquipmentId: null,
      reason: "ambiguous_name_multiple_candidates",
    };
  }

  // 6. Component-to-Parent Keyword Matching
  // (e.g. "photo-eye", "torsion spring", "motor bearing", "impeller", "safety edge")
  const componentCandidates: EquipmentRegistryDocument[] = [];
  for (const doc of registry) {
    for (const comp of doc.componentKeywords) {
      const compNorm = normalizeEquipmentKey(comp);
      if (
        compNorm === normalizedRaw ||
        compNorm === normalizedStripped ||
        normalizedRaw.includes(compNorm)
      ) {
        componentCandidates.push(doc);
        break;
      }
    }
  }

  if (componentCandidates.length > 0) {
    // If parent hint matches one candidate directly
    if (query.parentSystemHint?.trim()) {
      const parentNorm = normalizeEquipmentKey(query.parentSystemHint);
      const parentMatched = componentCandidates.find((doc) => {
        if (normalizeEquipmentKey(doc.canonicalName).includes(parentNorm)) return true;
        return doc.aliases.some((a) => normalizeEquipmentKey(a).includes(parentNorm));
      });
      if (parentMatched) {
        return {
          status: "confirmed",
          resolvedEquipmentId: parentMatched.id,
          reason: "component_mapped_to_hinted_parent",
          isComponentPart: true,
        };
      }
    }

    // Disambiguate component by floor / location context
    const floorFiltered = componentCandidates.filter((doc) =>
      contextMatchesFloor(doc.floor, query.location, query.contextSnippet),
    );

    if (floorFiltered.length === 1) {
      return {
        status: "confirmed",
        resolvedEquipmentId: floorFiltered[0].id,
        reason: "component_mapped_to_parent",
        isComponentPart: true,
      };
    }

    if (componentCandidates.length === 1) {
      return {
        status: "confirmed",
        resolvedEquipmentId: componentCandidates[0].id,
        reason: "component_mapped_to_parent",
        isComponentPart: true,
      };
    }

    return {
      status: "unresolved",
      resolvedEquipmentId: null,
      reason: "ambiguous_component_multiple_parents",
      isComponentPart: true,
    };
  }

  // 7. Generic System Mention with Location Disambiguation (e.g. "garage door", "overhead door")
  if (
    normalizedRaw === "garage door" ||
    normalizedRaw === "overhead door" ||
    normalizedStripped === "garage door" ||
    normalizedStripped === "overhead door"
  ) {
    const doorCandidates = registry.filter((d) => d.category === "door");
    const matched = doorCandidates.filter((d) =>
      contextMatchesFloor(d.floor, query.location, query.contextSnippet),
    );
    if (matched.length === 1) {
      return {
        status: "confirmed",
        resolvedEquipmentId: matched[0].id,
        reason: "generic_door_disambiguated_by_location",
      };
    }
    return {
      status: "unresolved",
      resolvedEquipmentId: null,
      reason: "ambiguous_door_location_missing",
    };
  }

  // 8. Check for genuine uncataloged major kit (e.g. "EV charger", "solar inverter")
  // If it is major equipment and not an action phrase or consumable, queue as provisional.
  const isMajorRole = query.extractedRole === "installed_system" || !query.extractedRole;
  const isCleanNoun = !isActionPhrase(rawClean) && rawClean.split(" ").length <= 5;

  if (isMajorRole && isCleanNoun && !isGenericConsumableOrHardware(rawClean)) {
    return {
      status: "provisional",
      resolvedEquipmentId: null,
      reason: "uncataloged_provisional",
    };
  }

  return {
    status: "unresolved",
    resolvedEquipmentId: null,
    reason: "no_registry_match",
  };
}
