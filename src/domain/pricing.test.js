import { describe, it, expect } from "vitest";
import {
  partyTrayLineTotal, partyTrayTotal,
  packedMealUnitPrice, packedMealsTotal,
  grazingTotal, cateringPackageTotal, comboTotal,
} from "./pricing.js";

// Real values, read from the live tables on 4 August 2026. Using the actual
// prices means a test failure is a genuine disagreement about money rather
// than a disagreement with invented fixtures.
const PRICES = {
  "beef-bicol-express": { family: 2500, feast: 5000, xxxl: 10500 },
  "beef-salpicao":      { family: 2500, feast: 5000, xxxl: 10500 },
  "baked-salmon":       { family: 2000, feast: 4000, xxxl: 8000 },
  "steamed-rice":       { family: 350,  feast: 700,  xxxl: 1500 },
};

describe("party trays", () => {
  it("prices a line by dish and size, times quantity", () => {
    expect(partyTrayLineTotal(PRICES, { dishId: "beef-salpicao", traySize: "xxxl", qty: 2 }))
      .toBe(21000);
  });

  it("sums a cart", () => {
    expect(partyTrayTotal(PRICES, [
      { dishId: "beef-bicol-express", traySize: "xxxl",   qty: 1 },  // 10,500
      { dishId: "baked-salmon",       traySize: "family", qty: 2 },  //  4,000
      { dishId: "steamed-rice",       traySize: "feast",  qty: 3 },  //  2,100
    ])).toBe(16600);
  });

  // The reason this module exists. The old code held one price per category
  // and overwrote it once per dish while loading, so the last row won and
  // every other dish in that category was priced as that one. It only ever
  // worked because all 71 dishes happen to share their category's price.
  it("prices two dishes in one category independently", () => {
    const table = {
      "beef-a": { xxxl: 10500 },
      "beef-b": { xxxl: 12000 },
    };
    expect(partyTrayLineTotal(table, { dishId: "beef-a", traySize: "xxxl", qty: 1 })).toBe(10500);
    expect(partyTrayLineTotal(table, { dishId: "beef-b", traySize: "xxxl", qty: 1 })).toBe(12000);
  });

  it("treats an unknown dish or size as zero rather than NaN", () => {
    expect(partyTrayLineTotal(PRICES, { dishId: "nope", traySize: "xxxl", qty: 2 })).toBe(0);
    expect(partyTrayLineTotal(PRICES, { dishId: "baked-salmon", traySize: "huge", qty: 2 })).toBe(0);
    expect(partyTrayTotal(PRICES, [{ dishId: "nope", traySize: "x", qty: 1 }])).toBe(0);
  });

  it("is zero for an empty cart", () => {
    expect(partyTrayTotal(PRICES, [])).toBe(0);
    expect(partyTrayTotal(PRICES)).toBe(0);
  });
});

describe("packed meals", () => {
  // Sorted highest minQty first, which is how the loader stores them.
  const TIERS = [
    { minQty: 100, price: 320 },
    { minQty: 50,  price: 350 },
    { minQty: 20,  price: 380 },
  ];

  it("takes the first tier the quantity reaches", () => {
    expect(packedMealUnitPrice(TIERS, 150)).toBe(320);
    expect(packedMealUnitPrice(TIERS, 100)).toBe(320);
    expect(packedMealUnitPrice(TIERS, 99)).toBe(350);
    expect(packedMealUnitPrice(TIERS, 50)).toBe(350);
    expect(packedMealUnitPrice(TIERS, 20)).toBe(380);
  });

  // Below every minimum the form should not have allowed it. Charging the
  // lowest-volume rate is wrong; charging nothing is worse.
  it("falls back to the smallest tier below every minimum", () => {
    expect(packedMealUnitPrice(TIERS, 5)).toBe(380);
  });

  it("multiplies the tier price by the quantity, per line", () => {
    expect(packedMealsTotal({ breakfast: TIERS }, [{ packTypeId: "breakfast", qty: 50 }]))
      .toBe(17500);
  });

  it("prices each line against its own quantity, not the cart's", () => {
    // 50 @ 350 = 17,500 and 20 @ 380 = 7,600. If the 70 total set the tier
    // both would price at 350 and the second line would be undercharged.
    expect(packedMealsTotal({ a: TIERS, b: TIERS }, [
      { packTypeId: "a", qty: 50 },
      { packTypeId: "b", qty: 20 },
    ])).toBe(25100);
  });

  it("is zero for an unknown pack type", () => {
    expect(packedMealsTotal({}, [{ packTypeId: "ghost", qty: 50 }])).toBe(0);
  });
});

describe("grazing", () => {
  const TIERS = [
    { paxRange: "50–100",  price: 35000 },
    { paxRange: "100–150", price: 65000 },
    { paxRange: "150–200", price: 120000 },
  ];

  it("is a flat price for the band", () => {
    expect(grazingTotal(TIERS, "100–150")).toBe(65000);
  });

  // Matched on the label, not an index — a tier inserted in the dashboard
  // would otherwise shift every index and reprice existing selections.
  it("is zero for a band that no longer exists", () => {
    expect(grazingTotal(TIERS, "200–250")).toBe(0);
    expect(grazingTotal(TIERS, undefined)).toBe(0);
  });
});

describe("catering package", () => {
  it("is rate per head times heads", () => {
    expect(cateringPackageTotal(950, 80)).toBe(76000);
    expect(cateringPackageTotal(1250, 120)).toBe(150000);
  });

  it("is zero when either side is missing", () => {
    expect(cateringPackageTotal(undefined, 80)).toBe(0);
    expect(cateringPackageTotal(950, null)).toBe(0);
  });
});

describe("combo trays", () => {
  const COMBOS = { "family-combo-1": 10000, "xxxl-premium": 54000 };

  it("is the package's own fixed price", () => {
    expect(comboTotal(COMBOS, "family-combo-1")).toBe(10000);
  });

  it("is zero for an unknown package", () => {
    expect(comboTotal(COMBOS, "made-up")).toBe(0);
  });
});
