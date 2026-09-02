import { describe, it, expect } from "vitest";
import { comboItemLabel, comboItemWireLine, WIRE_SEPARATOR } from "./combo-line.js";

/**
 * The line the kitchen reads.
 *
 * This exists because the quantity went missing from it once. A combo
 * holding 2 XXXL Blue Ternate Rice was sent to GoHighLevel as one tray and
 * the chef made half the rice -- across 104 of the 280 rows in
 * package_items, which is better than a third of every combo content line.
 *
 * The format is a contract with the dashboard's chef-checklist parser
 * (api/_lib/dishes.js, sibling repo), which splits on the FIRST " — " and
 * reads the dish name from the right. These assertions are that contract,
 * written down: they are here to fail loudly if anyone "tidies" the wire
 * line and the display label back into one string.
 */
describe("comboItemWireLine — the line sent to GoHighLevel", () => {
  const rice = {
    quantity: 2,
    traySize: "XXXL",
    selectedName: "Blue Ternate Rice",
    displayName: "Blue Ternate Rice",
  };
  const ribs = {
    quantity: 1,
    traySize: "XXXL",
    selectedName: "Babyback Ribs",
    displayName: "Babyback Ribs",
  };

  it("carries the quantity when there is more than one tray", () => {
    expect(comboItemWireLine(rice)).toBe("2× XXXL — Blue Ternate Rice");
  });

  it("has no prefix at all when there is one", () => {
    expect(comboItemWireLine(ribs)).toBe("XXXL — Babyback Ribs");
  });

  it("puts the quantity at the very start of the line", () => {
    // The parser reads from the left edge. Anything before the count --
    // a bullet, a space, an indent added here rather than by the caller --
    // and the quantity stops being findable.
    expect(comboItemWireLine(rice).startsWith("2× ")).toBe(true);
  });

  it("separates with a space, an em dash and a space", () => {
    // U+2014, spelled out so a stray en dash or hyphen cannot pass.
    expect(WIRE_SEPARATOR).toBe(" — ");
    expect(comboItemWireLine(rice)).toContain(" — ");
  });

  it("keeps the dish name on the RIGHT of the first separator", () => {
    // Exactly what the dashboard does with the string.
    const [left, ...rest] = comboItemWireLine(rice).split(WIRE_SEPARATOR);
    expect(rest.join(WIRE_SEPARATOR)).toBe("Blue Ternate Rice");
    expect(left).toBe("2× XXXL");
  });

  it("never puts the separator inside the quantity or the tray size", () => {
    // Whatever precedes the dish must contain no second separator, or the
    // parser's "first occurrence" split lands in the wrong place.
    const left = comboItemWireLine(rice).split(WIRE_SEPARATOR)[0];
    expect(left).not.toContain("—");
  });

  it("prefers the resolved dish name over the package row's", () => {
    // A swap rewrites selectedName; displayName can still be the dish the
    // customer replaced. The kitchen must be told what was ordered.
    expect(comboItemWireLine({
      quantity: 1, traySize: "Feast",
      selectedName: "Baked Salmon", displayName: "Lemon Fish Fillet",
    })).toBe("Feast — Baked Salmon");
  });

  it("falls back to displayName on a raw package row", () => {
    // Rows straight from getPackageItems have no selectedName until priced.
    expect(comboItemWireLine({
      quantity: 3, traySize: "Family", displayName: "Java Garlic Rice",
    })).toBe("3× Family — Java Garlic Rice");
  });

  it("treats a missing or unreadable quantity as one", () => {
    expect(comboItemWireLine({ traySize: "XXXL", displayName: "Calamares" }))
      .toBe("XXXL — Calamares");
    expect(comboItemWireLine({ quantity: null, traySize: "XXXL", displayName: "Calamares" }))
      .toBe("XXXL — Calamares");
  });

  it("reads a quantity that arrived as a string", () => {
    // Belt and braces on the way out of Supabase/JSON.
    expect(comboItemWireLine({ quantity: "2", traySize: "XXXL", displayName: "Java Rice" }))
      .toBe("2× XXXL — Java Rice");
  });
});

describe("comboItemLabel — the line a customer reads", () => {
  it("uses the same quantity rule", () => {
    expect(comboItemLabel({ quantity: 2, traySize: "XXXL", displayName: "Blue Ternate Rice" }))
      .toBe("2× XXXL Blue Ternate Rice");
    expect(comboItemLabel({ quantity: 1, traySize: "XXXL", displayName: "Babyback Ribs" }))
      .toBe("XXXL Babyback Ribs");
  });

  it("does NOT carry the wire separator", () => {
    // The em dash is there for a parser, not for a person. If this ever
    // starts passing with a dash, the two have been folded together and the
    // customer-facing screen has changed to suit a machine.
    expect(comboItemLabel({ quantity: 2, traySize: "XXXL", displayName: "Blue Ternate Rice" }))
      .not.toContain("—");
  });
});
