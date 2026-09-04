/**
 * Floor-plan edit ribbon session (localStorage vs SSR).
 * Run: npx tsx --test scripts/test-floor-plan-edit-session.ts
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  defaultFloorPlanEditRibbonSession,
  followOffsetGet,
  followOffsetSet,
  followSkipAdd,
  followSkipClear,
  followSkipHas,
  hydrateFloorPlanEditRibbonFromStorage,
  readFloorPlanEditRibbonSession,
  resetFloorPlanEditSessionForTests,
  writeFloorPlanEditRibbonSession,
} from "@/lib/building/floor-plan-edit-session";

const RIBBON_STORAGE_KEY = "floor-plan-edit-ribbon";

function installLocalStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
  Object.defineProperty(globalThis, "window", {
    value: { localStorage },
    configurable: true,
    writable: true,
  });
}

function uninstallWindow() {
  Reflect.deleteProperty(globalThis, "window");
}

describe("floor-plan edit ribbon session", () => {
  beforeEach(() => {
    installLocalStorage();
    resetFloorPlanEditSessionForTests();
  });

  afterEach(() => {
    resetFloorPlanEditSessionForTests();
    uninstallWindow();
  });

  it("read() keeps SSR defaults even when localStorage has a saved color", () => {
    const saved = {
      ...defaultFloorPlanEditRibbonSession(),
      strokeColor: "#55f785",
    };
    globalThis.window.localStorage.setItem(
      RIBBON_STORAGE_KEY,
      JSON.stringify(saved),
    );

    const ribbon = readFloorPlanEditRibbonSession();
    assert.equal(ribbon.strokeColor, defaultFloorPlanEditRibbonSession().strokeColor);
    assert.notEqual(ribbon.strokeColor, "#55f785");
  });

  it("hydrateFloorPlanEditRibbonFromStorage() loads the saved ribbon", () => {
    const saved = {
      ...defaultFloorPlanEditRibbonSession(),
      strokeColor: "#55f785",
    };
    globalThis.window.localStorage.setItem(
      RIBBON_STORAGE_KEY,
      JSON.stringify(saved),
    );

    const ribbon = hydrateFloorPlanEditRibbonFromStorage();
    assert.equal(ribbon.strokeColor, "#55f785");
    assert.equal(readFloorPlanEditRibbonSession().strokeColor, "#55f785");
  });

  it("read() stays on Pass 1 until hydrate restores Pass 2", () => {
    const saved = {
      ...defaultFloorPlanEditRibbonSession(),
      markupSet: 2,
    };
    globalThis.window.localStorage.setItem(
      RIBBON_STORAGE_KEY,
      JSON.stringify(saved),
    );

    assert.equal(readFloorPlanEditRibbonSession().markupSet, 1);
    assert.equal(hydrateFloorPlanEditRibbonFromStorage().markupSet, 2);
  });

  it("write() updates memory so a later remount read() sees the color", () => {
    writeFloorPlanEditRibbonSession({
      ...defaultFloorPlanEditRibbonSession(),
      strokeColor: "#55f785",
    });
    assert.equal(readFloorPlanEditRibbonSession().strokeColor, "#55f785");
  });

  it("persists followed risers across remounts", () => {
    writeFloorPlanEditRibbonSession({
      ...defaultFloorPlanEditRibbonSession(),
      followedRiserIds: ["r1"],
      followedRiserSkipped: [{ planId: "f12", riserId: "r1" }],
    });
    assert.deepEqual(readFloorPlanEditRibbonSession().followedRiserIds, ["r1"]);
    assert.equal(
      followSkipHas(readFloorPlanEditRibbonSession().followedRiserSkipped, "f12", "r1"),
      true,
    );
  });

  it("migrates legacy followedRiserId to followedRiserIds", () => {
    globalThis.window.localStorage.setItem(
      RIBBON_STORAGE_KEY,
      JSON.stringify({
        ...defaultFloorPlanEditRibbonSession(),
        followedRiserId: "legacy-r1",
      }),
    );

    const ribbon = hydrateFloorPlanEditRibbonFromStorage();
    assert.deepEqual(ribbon.followedRiserIds, ["legacy-r1"]);
  });

  it("persists the riser inventory panel open state", () => {
    writeFloorPlanEditRibbonSession({
      ...defaultFloorPlanEditRibbonSession(),
      riserInventoryOpen: true,
    });
    assert.equal(readFloorPlanEditRibbonSession().riserInventoryOpen, true);
  });

  it("persists riser label visibility", () => {
    writeFloorPlanEditRibbonSession({
      ...defaultFloorPlanEditRibbonSession(),
      showRiserLabels: false,
    });
    assert.equal(readFloorPlanEditRibbonSession().showRiserLabels, false);
  });
});

describe("follow skip helpers", () => {
  it("adds, detects, and clears a plan+riser skip", () => {
    const added = followSkipAdd([], "f12", "r1");
    assert.equal(followSkipHas(added, "f12", "r1"), true);
    assert.equal(followSkipHas(added, "f13", "r1"), false);
    const cleared = followSkipClear(added, "f12", "r1");
    assert.equal(followSkipHas(cleared, "f12", "r1"), false);
  });
});

describe("follow offset helpers", () => {
  it("sets, replaces, and clears a plan+riser nudge", () => {
    const added = followOffsetSet([], "f12", "r1", 2, -3);
    assert.deepEqual(followOffsetGet(added, "f12", "r1"), {
      planId: "f12",
      riserId: "r1",
      dx: 2,
      dy: -3,
    });
    const replaced = followOffsetSet(added, "f12", "r1", 4, 0);
    assert.equal(followOffsetGet(replaced, "f12", "r1")?.dx, 4);
    const cleared = followOffsetSet(replaced, "f12", "r1", 0, 0);
    assert.equal(followOffsetGet(cleared, "f12", "r1"), undefined);
  });

  it("persists offsets across remounts", () => {
    writeFloorPlanEditRibbonSession({
      ...defaultFloorPlanEditRibbonSession(),
      followedRiserOffsets: [{ planId: "f12", riserId: "r1", dx: 1.5, dy: 0 }],
    });
    assert.deepEqual(readFloorPlanEditRibbonSession().followedRiserOffsets, [
      { planId: "f12", riserId: "r1", dx: 1.5, dy: 0 },
    ]);
  });
});
