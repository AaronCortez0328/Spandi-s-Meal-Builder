import { describe, it, expect } from "vitest";
import {
  cateringCostLines, cateringPayload, cateringStateFromPayload,
} from "./catering-package-builder.js";
import { cateringBreakdown } from "../domain/pricing.js";

const CONFIG = { pricePerHead: 950, minPax: 50 };

const stateOf = (over = {}) => ({
  pax: 50,
  addons: { lechonChopping: false },
  venueStairs: false,
  venueFloors: null,
  ...over,
});

/**
 * The line a saved order carries, and reading it back.
 *
 * The venue answer used to live in `contents` alone, with the radio's state
 * held by sessionStorage. draft.js no-ops where storage is unavailable —
 * Safari private mode, some embedded webviews — and this app runs inside a
 * cross-origin iframe, which is exactly where that happens. There, returning
 * to change the guest count reset the radio to "Ground floor" while the
 * order still said STAIRS, and continuing through rewrote the line without
 * the warning: silently, on the one answer the caterer cannot learn any
 * other way.
 */
describe("the order line round-trip", () => {
  it("carries the guest count, the add-ons and the venue answer", () => {
    const payload = cateringPayload("basic-catering", stateOf({
      pax: 80,
      addons: { lechonChopping: true },
      venueStairs: true,
      venueFloors: 3,
    }));

    expect(payload).toEqual({
      serviceKey: "basic-catering",
      pax: 80,
      addons: { lechonChopping: true },
      venue: { stairs: true, floors: 3 },
    });
  });

  // The regression itself. Anything the builder can put in an order has to
  // come back out of it, because the line is the only thing that survives.
  it("reads back everything it wrote, with no storage involved", () => {
    for (const state of [
      stateOf(),
      stateOf({ pax: 120, addons: { lechonChopping: true } }),
      stateOf({ venueStairs: true, venueFloors: 3 }),
      stateOf({ pax: 200, addons: { lechonChopping: true }, venueStairs: true, venueFloors: 1 }),
    ]) {
      const back = cateringStateFromPayload(
        cateringPayload("basic-catering", state), stateOf(),
      );
      expect(back, JSON.stringify(state)).toEqual(state);
    }
  });

  it("keeps the default state when there is no line yet", () => {
    expect(cateringStateFromPayload(undefined, stateOf())).toEqual(stateOf());
    expect(cateringStateFromPayload(null, stateOf())).toEqual(stateOf());
  });

  // Lines written before either field existed still have to open.
  it("opens a line saved before add-ons and the venue question existed", () => {
    const back = cateringStateFromPayload({ serviceKey: "basic-catering", pax: 70 }, stateOf());
    expect(back.pax).toBe(70);
    expect(back.addons).toEqual({ lechonChopping: false });
    expect(back.venueStairs).toBe(false);
  });

  // A floor count on an order that does not say stairs is contradictory, and
  // it is the contradiction the caterer would act on.
  it("drops a floor count that came back without stairs", () => {
    const back = cateringStateFromPayload(
      { pax: 50, venue: { stairs: false, floors: 4 } }, stateOf(),
    );
    expect(back.venueStairs).toBe(false);
    expect(back.venueFloors).toBe(null);
  });

  it("does not treat a truthy-ish stairs value as stairs", () => {
    for (const stairs of ["false", 0, null, undefined, ""]) {
      const back = cateringStateFromPayload({ pax: 50, venue: { stairs, floors: 2 } }, stateOf());
      expect(back.venueStairs, String(stairs)).toBe(false);
    }
  });
});

/**
 * The text that reaches the review screen and GoHighLevel.
 *
 * The review screen shows one figure against a package the customer chose
 * for its per-head rate, and it is the screen they commit on. These lines
 * are what explains ₱64,250 on a ₱950 package.
 */
describe("what the order says it is paying for", () => {
  it("itemises the three things every booking is charged", () => {
    const lines = cateringCostLines(CONFIG, stateOf()).join("\n");
    expect(lines).toContain("PHP 47,500");
    expect(lines).toContain("PHP 4,750");
    expect(lines).toContain("PHP 12,000");
  });

  // The figures on the order and the figure it is billed at come from one
  // function, so a breakdown that does not add up is not reachable.
  it("shows lines that sum to what the order charges", () => {
    for (const state of [stateOf(), stateOf({ pax: 150, addons: { lechonChopping: true } })]) {
      const b = cateringBreakdown(CONFIG.pricePerHead, state.pax, state.addons);
      const shown = cateringCostLines(CONFIG, state)
        .join("\n").match(/PHP [\d,]+/g)
        .map((m) => Number(m.replace(/[^\d]/g, "")));

      // The food line names the per-head rate as well as the food total.
      const sum = shown.filter((n) => n !== CONFIG.pricePerHead)
        .reduce((a, n) => a + n, 0);
      expect(sum, `${state.pax} pax`).toBe(b.total);
    }
  });

  it("names the add-on only when it was taken", () => {
    expect(cateringCostLines(CONFIG, stateOf()).join("\n")).not.toContain("Lechon");
    expect(
      cateringCostLines(CONFIG, stateOf({ addons: { lechonChopping: true } })).join("\n"),
    ).toContain("Lechon chopping");
  });

  // The whole reason the question is on the screen: the caterer has to read
  // this to know a hauling fee applies.
  it("flags stairs, with the floor count, and puts no price on it", () => {
    const line = cateringCostLines(CONFIG, stateOf({ venueStairs: true, venueFloors: 3 }))
      .find((l) => l.includes("Venue access"));

    expect(line).toContain("STAIRS");
    expect(line).toContain("3 floor(s) up");
    expect(line).toContain("to be quoted");
  });

  it("still flags stairs when no floor count was given", () => {
    const line = cateringCostLines(CONFIG, stateOf({ venueStairs: true }))
      .find((l) => l.includes("Venue access"));
    expect(line).toContain("STAIRS");
    expect(line).not.toContain("floor(s)");
  });

  it("says nothing about access when there are no stairs", () => {
    expect(cateringCostLines(CONFIG, stateOf()).join("\n")).not.toContain("Venue access");
  });
});
