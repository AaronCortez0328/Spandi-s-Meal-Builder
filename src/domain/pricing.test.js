import { describe, it, expect } from "vitest";
import {
  partyTrayLineTotal, partyTrayTotal,
  packedMealUnitPrice, packedMealsTotal,
  grazingTotal, cateringPackageTotal, comboTotal,
  applyRushFee, RUSH_FEE,
  customServiceTotal, customServiceQty, CUSTOM_QTY_MAX,
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

  /**
   * The invariant, not the number: what the configurator quotes and what the
   * server verifies must be the same figure.
   *
   * They were not. The builder quoted unitPrice x the typed quantity while
   * the cart clamped the line to 99, and the server then re-derived the tier
   * from that 99 — three numbers, one order. Because every pack type's top
   * tier starts at exactly 100 and the cart stopped at 99, the volume rate
   * was advertised in the configurator and could never be bought.
   *
   * Real prices, read from the live table on 9 September 2026, so a failure
   * here is a disagreement about money rather than about fixtures.
   */
  describe("what the configurator quotes and the server verifies", () => {
    const RICE = [
      { minQty: 100, price: 250 },
      { minQty: 50,  price: 275 },
      { minQty: 25,  price: 300 },
      { minQty: 10,  price: 325 },
    ];

    /** What the builder shows, and what it stores on the cart line. */
    const quoted = (qty) => packedMealUnitPrice(RICE, qty) * qty;
    /** What api/_price-tables.js computes from the line it is sent. */
    const verified = (qty) =>
      packedMealsTotal({ "rice-meals": RICE }, [{ packTypeId: "rice-meals", qty }]);

    it("agrees at every tier boundary", () => {
      for (const qty of [10, 24, 25, 49, 50, 99, 100, 101, 120, 500]) {
        expect(quoted(qty), `${qty} packs`).toBe(verified(qty));
      }
    });

    it("reaches the 100+ rate the configurator advertises", () => {
      expect(packedMealUnitPrice(RICE, 120)).toBe(250);
      expect(quoted(120)).toBe(30000);
      expect(verified(120)).toBe(30000);
    });

    // What the clamp used to do, kept as numbers rather than a comment.
    // The customer was quoted 30,000, the cart held 99 at the 250 rate it
    // had already captured, and the server re-priced 99 at 275 — so a 409
    // fired saying the price had changed, offering a HIGHER unit rate for
    // FEWER packs than were asked for.
    it("would have quoted 30,000, held 24,750 and verified 27,225 at 99", () => {
      expect(quoted(120)).toBe(30000);
      expect(250 * 99).toBe(24750);
      expect(verified(99)).toBe(27225);
      expect(verified(99)).not.toBe(quoted(120));
    });
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

describe("rush fee", () => {
  it("adds the flat fee on top of the total when requested", () => {
    expect(applyRushFee(10000, true)).toBe(10000 + RUSH_FEE);
  });

  it("leaves the total unchanged when not requested", () => {
    expect(applyRushFee(10000, false)).toBe(10000);
    expect(applyRushFee(10000, undefined)).toBe(10000);
  });

  it("treats a missing or invalid total as zero, same as every other total here", () => {
    expect(applyRushFee(undefined, true)).toBe(RUSH_FEE);
    expect(applyRushFee(NaN, false)).toBe(0);
  });
});

/**
 * Custom services — the ones an admin creates in the dashboard.
 *
 * These carry more risk than anything else in this file. api/ghl-inquiry.js
 * compares the browser's total to the server's exactly and then writes the
 * SERVER'S figure to the opportunity as the order's value, which is the
 * number every revenue report in the dashboard sums.
 *
 * So the two failures are not symmetrical. Disagreeing gives the customer a
 * 409 and the real price — annoying and safe. Agreeing on a wrong number
 * puts wrong money in the accounts with nothing anywhere to notice. That is
 * why this multiplication exists once, and why the last block below asserts
 * the browser's cart arithmetic and the server's verification land on the
 * same peso.
 */
describe("custom services", () => {
  const enquiry  = { pricing_mode: "enquiry",  unit_price: null };
  const fixed    = { pricing_mode: "fixed",    unit_price: 1500 };
  const perUnit  = { pricing_mode: "per_unit", unit_price: 450 };

  it("prices an enquiry card at nothing, whatever the quantity", () => {
    expect(customServiceTotal(enquiry, 1)).toBe(0);
    expect(customServiceTotal(enquiry, 500)).toBe(0);
  });

  it("prices a fixed card at its flat total, whatever the quantity", () => {
    expect(customServiceTotal(fixed, 1)).toBe(1500);
    expect(customServiceTotal(fixed, 3)).toBe(1500);
  });

  it("multiplies a per-unit card by the quantity", () => {
    expect(customServiceTotal(perUnit, 5)).toBe(2250);
    expect(customServiceTotal(perUnit, 1)).toBe(450);
  });

  // The database constrains pricing_mode to the three. Reaching this means
  // the schema moved ahead of this file, and quoting by hand is a better
  // failure than inventing a number.
  it("prices an unrecognised mode as an enquiry rather than guessing", () => {
    expect(customServiceTotal({ pricing_mode: "auction", unit_price: 900 }, 4)).toBe(0);
    expect(customServiceTotal({}, 4)).toBe(0);
    expect(customServiceTotal(null, 4)).toBe(0);
  });

  it("never returns NaN from a missing or unparseable price", () => {
    expect(customServiceTotal({ pricing_mode: "per_unit" }, 5)).toBe(0);
    expect(customServiceTotal({ pricing_mode: "fixed", unit_price: "oops" }, 1)).toBe(0);
  });

  it("reads a price the database handed back as a string", () => {
    // numeric columns arrive as strings over PostgREST often enough to matter.
    expect(customServiceTotal({ pricing_mode: "per_unit", unit_price: "450" }, 5)).toBe(2250);
  });

  describe("customServiceQty", () => {
    it("takes whole units only", () => {
      expect(customServiceQty(5)).toBe(5);
      expect(customServiceQty("5")).toBe(5);
      expect(customServiceQty(5.4)).toBe(5);
      expect(customServiceQty(5.6)).toBe(6);
    });

    // Number("") and Number(null) are both 0, so an empty field would price
    // a per-unit service at nothing at all rather than being refused.
    it("never falls below one", () => {
      expect(customServiceQty("")).toBe(1);
      expect(customServiceQty(null)).toBe(1);
      expect(customServiceQty(undefined)).toBe(1);
      expect(customServiceQty(0)).toBe(1);
      expect(customServiceQty(-40)).toBe(1);
    });

    // A quantity the customer typed reaches a multiplication whose result is
    // written to GoHighLevel as revenue.
    it("bounds an absurd quantity", () => {
      expect(customServiceQty(1e12)).toBe(CUSTOM_QTY_MAX);
      expect(customServiceQty(Infinity)).toBe(1);
      expect(customServiceQty("banana")).toBe(1);
    });

    // NOT the cart's QTY_MAX of 99. That number bounds "how many trays",
    // and 150 kg clamped to 99 is a figure both sides would still agree on
    // — a silently short order, which is the exact failure this closes.
    it("does not stop at the cart's tray limit", () => {
      expect(customServiceQty(150)).toBe(150);
      expect(customServiceQty(500)).toBe(500);
    });
  });
});
