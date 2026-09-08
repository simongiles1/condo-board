/**
 * Equipment registry resolution engine test suite.
 * Run: npx tsx --test scripts/test-equipment-registry-and-resolve.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideEquipmentMentionResolution,
  isActionPhrase,
  isGenericConsumableOrHardware,
  normalizeEquipmentKey,
  stripActionPrefix,
  validateCanonicalAlias,
  type EquipmentMentionQuery,
  type EquipmentRegistryDocument,
} from "../lib/equipment/mention-resolve-shared";

const TEST_REGISTRY: EquipmentRegistryDocument[] = [
  {
    id: "DOOR-PUBLIC-P1",
    canonicalName: "Public Parking Garage Overhead Door (P1)",
    category: "door",
    floor: -1,
    location: "P1 Parking / Commercial Entrance",
    aliases: [
      "public parking garage door",
      "public garage door",
      "P1 garage door",
      "P1 overhead door",
      "TNR rubber speed door",
      "commercial overhead door",
      "visitor parking garage door",
      "visitor gate",
    ],
    componentKeywords: [
      "photo-eye",
      "photo eye",
      "motion sensor",
      "counterweight",
      "rubber curtain",
      "breakaway bottom bar",
      "safety edge",
    ],
    status: "active",
  },
  {
    id: "DOOR-RES-P2",
    canonicalName: "Residential Parking Garage Overhead Door (P2)",
    category: "door",
    floor: -2,
    location: "P2 Parking Entrance",
    aliases: [
      "residential garage door",
      "residential overhead door",
      "P2 garage door",
      "P2 overhead door",
      "sectional residential garage door",
      "P2 residential door",
    ],
    componentKeywords: [
      "torsion spring",
      "counterweight system",
      "door track",
      "rollers",
      "door hinges",
      "sectional panel",
    ],
    status: "active",
  },
  {
    id: "PUMP-DOM-BOOST-DUP",
    canonicalName: "Domestic Cold Water Booster Pump Duplex System",
    category: "pump",
    floor: -1,
    location: "P1 Domestic Water Pump Room",
    aliases: [
      "domestic booster pump duplex system",
      "domestic cold water booster pump",
      "DCW booster pump",
      "Bell & Gossett duplex booster pump system",
      "domestic booster pump",
    ],
    componentKeywords: [
      "booster pump 1",
      "booster pump 2",
      "pump motor",
      "mechanical seal",
      "pump impeller",
      "motor bearing",
      "triple-duty valve",
      "check valve",
    ],
    status: "active",
  },
  {
    id: "ELEV-HIGH-01",
    canonicalName: "High-Rise Passenger Elevator #1",
    category: "elevator",
    floor: 1,
    location: "High-Rise Elevator Bank",
    aliases: [
      "high-rise elevator 1",
      "high-rise elevator #1",
      "elevator 1",
      "car 1",
    ],
    componentKeywords: [
      "hoist ropes",
      "governor ropes",
      "traction motor",
      "cab door rollers",
    ],
    status: "active",
  },
];

describe("Equipment Register Resolution Engine", () => {
  describe("Rule 1: Two doors stay two separate assets", () => {
    it("resolves P1 door aliases strictly to DOOR-PUBLIC-P1", () => {
      const q1: EquipmentMentionQuery = {
        rawName: "public parking garage door",
      };
      const res1 = decideEquipmentMentionResolution(q1, TEST_REGISTRY);
      assert.equal(res1.status, "confirmed");
      assert.equal(res1.resolvedEquipmentId, "DOOR-PUBLIC-P1");

      const q2: EquipmentMentionQuery = {
        rawName: "TNR rubber speed door",
      };
      const res2 = decideEquipmentMentionResolution(q2, TEST_REGISTRY);
      assert.equal(res2.status, "confirmed");
      assert.equal(res2.resolvedEquipmentId, "DOOR-PUBLIC-P1");

      const q3: EquipmentMentionQuery = {
        rawName: "visitor gate",
      };
      const res3 = decideEquipmentMentionResolution(q3, TEST_REGISTRY);
      assert.equal(res3.status, "confirmed");
      assert.equal(res3.resolvedEquipmentId, "DOOR-PUBLIC-P1");
    });

    it("resolves P2 door aliases strictly to DOOR-RES-P2", () => {
      const q1: EquipmentMentionQuery = {
        rawName: "residential garage door",
      };
      const res1 = decideEquipmentMentionResolution(q1, TEST_REGISTRY);
      assert.equal(res1.status, "confirmed");
      assert.equal(res1.resolvedEquipmentId, "DOOR-RES-P2");

      const q2: EquipmentMentionQuery = {
        rawName: "sectional residential garage door",
      };
      const res2 = decideEquipmentMentionResolution(q2, TEST_REGISTRY);
      assert.equal(res2.status, "confirmed");
      assert.equal(res2.resolvedEquipmentId, "DOOR-RES-P2");

      const q3: EquipmentMentionQuery = {
        rawName: "P2 overhead door",
      };
      const res3 = decideEquipmentMentionResolution(q3, TEST_REGISTRY);
      assert.equal(res3.status, "confirmed");
      assert.equal(res3.resolvedEquipmentId, "DOOR-RES-P2");
    });

    it("disambiguates generic 'garage door' with location context", () => {
      const p1Door = decideEquipmentMentionResolution(
        { rawName: "garage door", location: "P1 commercial level" },
        TEST_REGISTRY,
      );
      assert.equal(p1Door.status, "confirmed");
      assert.equal(p1Door.resolvedEquipmentId, "DOOR-PUBLIC-P1");

      const p2Door = decideEquipmentMentionResolution(
        { rawName: "garage door", location: "P2 resident entry" },
        TEST_REGISTRY,
      );
      assert.equal(p2Door.status, "confirmed");
      assert.equal(p2Door.resolvedEquipmentId, "DOOR-RES-P2");
    });

    it("leaves generic 'garage door' without location unresolved rather than guessing", () => {
      const ambiguous = decideEquipmentMentionResolution(
        { rawName: "garage door" },
        TEST_REGISTRY,
      );
      assert.equal(ambiguous.status, "unresolved");
      assert.equal(ambiguous.resolvedEquipmentId, null);
      assert.equal(ambiguous.reason, "ambiguous_door_location_missing");
    });
  });

  describe("Rule 2: Components map to parent asset without creating new rows", () => {
    it("maps 'photo-eye' to DOOR-PUBLIC-P1 via component keywords", () => {
      const res = decideEquipmentMentionResolution(
        {
          rawName: "photo-eye",
          extractedRole: "component",
          location: "P1",
        },
        TEST_REGISTRY,
      );
      assert.equal(res.status, "confirmed");
      assert.equal(res.resolvedEquipmentId, "DOOR-PUBLIC-P1");
      assert.equal(res.isComponentPart, true);
    });

    it("maps 'torsion spring' to DOOR-RES-P2 via component keywords", () => {
      const res = decideEquipmentMentionResolution(
        {
          rawName: "torsion spring",
          extractedRole: "component",
          location: "P2",
        },
        TEST_REGISTRY,
      );
      assert.equal(res.status, "confirmed");
      assert.equal(res.resolvedEquipmentId, "DOOR-RES-P2");
      assert.equal(res.isComponentPart, true);
    });

    it("maps component to parent via parentSystemHint", () => {
      const res = decideEquipmentMentionResolution(
        {
          rawName: "pump impeller",
          extractedRole: "component",
          parentSystemHint: "Domestic booster pump",
        },
        TEST_REGISTRY,
      );
      assert.equal(res.status, "confirmed");
      assert.equal(res.resolvedEquipmentId, "PUMP-DOM-BOOST-DUP");
      assert.equal(res.isComponentPart, true);
    });
  });

  describe("Rule 3: Bid-alternative equipment is not minted", () => {
    it("maps quote alternative to parent system and marks isBidAlternative", () => {
      const res = decideEquipmentMentionResolution(
        {
          rawName: "WILO CO2-Helix V110-07/1, 20 HP",
          extractedRole: "bid_alternative",
          parentSystemHint: "Domestic booster pump duplex system",
        },
        TEST_REGISTRY,
      );
      assert.equal(res.status, "confirmed");
      assert.equal(res.resolvedEquipmentId, "PUMP-DOM-BOOST-DUP");
      assert.equal(res.isBidAlternative, true);
      assert.equal(res.reason, "bid_alternative_mapped_to_parent");
    });

    it("keeps standalone bid alternative unresolved and prevents asset minting", () => {
      const res = decideEquipmentMentionResolution(
        {
          rawName: "GRUNDFOS 60HYDRO MPC EC 2CR20-10",
          extractedRole: "bid_alternative",
        },
        TEST_REGISTRY,
      );
      assert.equal(res.status, "unresolved");
      assert.equal(res.resolvedEquipmentId, null);
      assert.equal(res.isBidAlternative, true);
      assert.equal(res.reason, "bid_alternative_unattached");
    });
  });

  describe("Rule 4: Alias bag does not snowball", () => {
    it("rejects operational action phrases from aliases", () => {
      const check1 = validateCanonicalAlias(
        "Emergency Repair Work at Public Parking Garage Door",
      );
      assert.equal(check1.valid, false);

      const check2 = validateCanonicalAlias("Replace broken photo-eye on P1");
      assert.equal(check2.valid, false);

      const check3 = validateCanonicalAlias("Annual inspection of boilers");
      assert.equal(check3.valid, false);
    });

    it("rejects generic consumables from aliases", () => {
      const checkScrew = validateCanonicalAlias("screws");
      assert.equal(checkScrew.valid, false);

      const checkDrywall = validateCanonicalAlias("drywall");
      assert.equal(checkDrywall.valid, false);
    });

    it("accepts concise true name variants as aliases", () => {
      const checkTnr = validateCanonicalAlias("TNR rubber speed door");
      assert.equal(checkTnr.valid, true);

      const checkVisitorGate = validateCanonicalAlias("visitor gate");
      assert.equal(checkVisitorGate.valid, true);

      const checkP1Door = validateCanonicalAlias("P1 overhead door");
      assert.equal(checkP1Door.valid, true);
    });

    it("strips action prefixes when matching mention to registry", () => {
      const raw = "Emergency repair of public parking garage door";
      const stripped = stripActionPrefix(raw);
      assert.equal(stripped, "public parking garage door");

      const res = decideEquipmentMentionResolution(
        { rawName: raw },
        TEST_REGISTRY,
      );
      assert.equal(res.status, "confirmed");
      assert.equal(res.resolvedEquipmentId, "DOOR-PUBLIC-P1");
    });
  });

  describe("Rule 5: Uncataloged major kit is quarantined as provisional", () => {
    it("queues novel major equipment as provisional without corrupting existing assets", () => {
      const res = decideEquipmentMentionResolution(
        {
          rawName: "Level 2 EV Charging Station",
          extractedRole: "installed_system",
        },
        TEST_REGISTRY,
      );
      assert.equal(res.status, "provisional");
      assert.equal(res.resolvedEquipmentId, null);
      assert.equal(res.reason, "uncataloged_provisional");
    });

    it("ignores generic consumables rather than queueing them as provisional", () => {
      const res = decideEquipmentMentionResolution(
        { rawName: "screws", extractedRole: "component" },
        TEST_REGISTRY,
      );
      assert.equal(res.status, "unresolved");
      assert.equal(res.resolvedEquipmentId, null);
      assert.equal(res.reason, "generic_consumable_ignored");
    });
  });
});
