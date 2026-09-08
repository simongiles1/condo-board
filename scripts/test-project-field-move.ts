/**
 * Move one project alias / contractor / location / equipment mention between cards.
 * Run: npx tsx --test scripts/test-project-field-move.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProjectEntityCard } from "../lib/email-analysis/project-highlight-shared";
import { applyProjectFieldMoveToCards } from "../lib/projects/field-attachments";

function card(
  partial: Partial<ProjectEntityCard> & { name: string },
): ProjectEntityCard {
  return {
    name: partial.name,
    year_hint: partial.year_hint ?? null,
    phase: partial.phase ?? null,
    contractor: partial.contractor ?? null,
    location: partial.location ?? null,
    equipment_mentions: partial.equipment_mentions ?? null,
    aliases: [...(partial.aliases ?? [])],
  };
}

const garageDoor = card({
  name: "Emergency Repair Work at Public Parking Garage Door",
  year_hint: "2024–2025",
  aliases: [
    "Commercial Parking Overhead Door",
    "West Side Loading Bay Door – Scheduled Repairs",
    "TNR garage door replacement",
  ],
});

const loadingBay = card({
  name: "West Side Loading Bay Door Repairs",
  year_hint: "2024",
  aliases: ["Loading bay overhead door"],
});

describe("applyProjectFieldMoveToCards", () => {
  it("moves an alias from one project card onto another without merging cards", () => {
    const next = applyProjectFieldMoveToCards({
      cards: [garageDoor, loadingBay],
      field: "name_alias",
      value: "West Side Loading Bay Door – Scheduled Repairs",
      sourceProjectKey: "name:emergency repair work at public parking garage door|year:2024–2025",
      sourceNameKey: "emergency repair work at public parking garage door",
      targetProjectKey: "name:west side loading bay door repairs|year:2024",
      targetNameKey: "west side loading bay door repairs",
    });

    const movedGarage = next.find(
      (row) => row.name === "Emergency Repair Work at Public Parking Garage Door",
    );
    const movedBay = next.find(
      (row) => row.name === "West Side Loading Bay Door Repairs",
    );

    assert.ok(movedGarage);
    assert.ok(movedBay);
    assert.equal(next.length, 2);
    assert.deepEqual(movedGarage!.aliases, [
      "Commercial Parking Overhead Door",
      "TNR garage door replacement",
    ]);
    assert.deepEqual(movedBay!.aliases, [
      "Loading bay overhead door",
      "West Side Loading Bay Door – Scheduled Repairs",
    ]);
  });

  it("moves a contractor onto another project and leaves the other fields", () => {
    const next = applyProjectFieldMoveToCards({
      cards: [garageDoor, loadingBay],
      field: "contractor",
      value: "TNR Door Systems",
      sourceProjectKey: "name:emergency repair work at public parking garage door|year:2024–2025",
      sourceNameKey: "emergency repair work at public parking garage door",
      targetProjectKey: "name:west side loading bay door repairs|year:2024",
      targetNameKey: "west side loading bay door repairs",
      mergeMap: new Map(),
    });

    const withContractor = {
      ...garageDoor,
      contractor: "TNR Door Systems\nABC Maintenance",
    };
    const moved = applyProjectFieldMoveToCards({
      cards: [withContractor, loadingBay],
      field: "contractor",
      value: "TNR Door Systems",
      sourceProjectKey: "name:emergency repair work at public parking garage door|year:2024–2025",
      sourceNameKey: "emergency repair work at public parking garage door",
      targetProjectKey: "name:west side loading bay door repairs|year:2024",
      targetNameKey: "west side loading bay door repairs",
    });

    const movedGarage = moved.find(
      (row) => row.name === "Emergency Repair Work at Public Parking Garage Door",
    );
    const movedBay = moved.find(
      (row) => row.name === "West Side Loading Bay Door Repairs",
    );

    assert.equal(movedGarage!.contractor, "ABC Maintenance");
    assert.equal(movedBay!.contractor, "TNR Door Systems");
    assert.equal(next.length, 2);
  });
});
