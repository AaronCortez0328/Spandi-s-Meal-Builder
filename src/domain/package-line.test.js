import { describe, it, expect } from "vitest";
import { packageCartLine } from "./package-line.js";

/**
 * The one function that turns a catalogue package into a line in the order.
 *
 * It matters twice over: the Combo Trays builder uses it when a customer
 * picks a package, and the change flow uses it to put the package a customer
 * ALREADY booked back into the cart so they can edit it. If those two
 * produced different lines, a prefilled order would submit differently from
 * an identical one built by hand.
 */
const catalogue = {
  packages: [
    { id: "mary-rose-100", name: "Mary Rose Package", price: 35000, paxLabel: "100 pax" },
    { id: "fam-c1", name: "Family Combo 1", price: 10000, paxLabel: "15 pax" },
  ],
  itemsFor: (id) => (id === "mary-rose-100" ? [
    { dishId: "ribs", traySize: "XXXL", quantity: 1, displayName: "Ribs (old name)" },
    { dishId: "rice", traySize: "XXXL", quantity: 2, displayName: "Rice" },
  ] : []),
  dishNameFor: (id) => ({ ribs: "Babyback Ribs", rice: "Blue Ternate Rice" }[id]),
};

describe("packageCartLine", () => {
  it("builds the line the Combo Trays builder would have built", () => {
    const line = packageCartLine("mary-rose-100", catalogue);
    expect(line).toMatchObject({
      service: "combo-trays",
      serviceLabel: "Combo Trays",
      title: "Mary Rose Package",
      subtitle: "100 pax",
      unitPrice: 35000,
      qty: 1,
      payload: { comboId: "mary-rose-100", paxLabel: "100 pax" },
    });
  });

  it("writes the kitchen's wire line, with the per-tray quantity on it", () => {
    // The separator and the "2× " prefix are both parsed downstream — see
    // combo-line.js for the combo that reached the kitchen at half the rice.
    expect(packageCartLine("mary-rose-100", catalogue).contents).toEqual([
      "XXXL — Babyback Ribs",
      "2× XXXL — Blue Ternate Rice",
    ]);
  });

  it("names dishes from the dish table, not the package row's stale copy", () => {
    expect(packageCartLine("mary-rose-100", catalogue).contents[0])
      .not.toContain("old name");
  });

  it("falls back to the package row's name when the dish table has none", () => {
    const thin = { ...catalogue, dishNameFor: () => undefined };
    expect(packageCartLine("mary-rose-100", thin).contents[0])
      .toContain("Ribs (old name)");
  });

  it("carries the quantity the customer chose", () => {
    expect(packageCartLine("fam-c1", catalogue, 3).qty).toBe(3);
  });

  /**
   * The failure the change flow depends on. A package withdrawn since the
   * booking must leave the cart empty rather than put something unsellable
   * in it — "No invalid options" applies to a line we place as much as to
   * one the customer picks.
   */
  it("returns null for a package that is not in the catalogue", () => {
    expect(packageCartLine("withdrawn-99", catalogue)).toBeNull();
  });

  it("returns null rather than guessing at a non-string id", () => {
    // A server response can hand back a number, and "42" would look like an
    // id while matching nothing.
    expect(packageCartLine(42, catalogue)).toBeNull();
    expect(packageCartLine(null, catalogue)).toBeNull();
    expect(packageCartLine("   ", catalogue)).toBeNull();
  });

  it("survives a catalogue that has not loaded", () => {
    expect(packageCartLine("fam-c1", {})).toBeNull();
    expect(packageCartLine("fam-c1", undefined)).toBeNull();
  });

  it("copes with a package that has no items listed against it", () => {
    expect(packageCartLine("fam-c1", catalogue).contents).toEqual([]);
  });
});
