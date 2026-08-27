import { describe, it, expect } from "vitest";
import {
  makeLine, addLine, removeLine, setQty, stepQty, setVariant,
  lineTotal, cartTotal, itemCount, servicesInCart, dishesSelectedText,
} from "./cart.js";

/**
 * The cart has to hold five services that model an order differently, so
 * most of these assert the distinctions rather than the arithmetic: what is
 * a line and what is merely inside one, where a quantity means something,
 * and what happens when someone presses "−" on the last one.
 */

const tray = (over = {}) => makeLine({
  service: "party-trays", serviceLabel: "Party Trays",
  title: "Baby Back Ribs", subtitle: "Beef · Feast (2kg)",
  unitPrice: 2500, qty: 2,
  variant: {
    label: "Tray size",
    selected: "feast",
    options: [
      { id: "family", label: "Family", price: 1500 },
      { id: "feast",  label: "Feast",  price: 2500 },
      { id: "xxxl",   label: "XXXL",   price: 5000 },
    ],
  },
  ...over,
});

const combo = (over = {}) => makeLine({
  service: "combo-trays", serviceLabel: "Combo Trays",
  title: "Family Combo 1", subtitle: "15 pax",
  unitPrice: 10000, qty: 1,
  contents: ["Feast — Baby Back Ribs", "Feast — Roast Beef Pink Mash"],
  ...over,
});

const grazing = (over = {}) => makeLine({
  service: "grazing-table", serviceLabel: "Grazing Table",
  title: "50–100 pax", subtitle: "Grazing Table",
  unitPrice: 20000, qtyEditable: false,
  contents: ["Savory bites", "Fresh fruit"],
  ...over,
});

describe("makeLine", () => {
  it("gives every line an id of its own", () => {
    expect(makeLine({}).id).not.toBe(makeLine({}).id);
  });

  it("pins quantity to 1 where a quantity is meaningless", () => {
    // A grazing tier is one spread. "2× 50–100 pax" is not a thing anyone
    // orders, and offering the control invites a choice we would reject.
    expect(grazing({ qty: 5 }).qty).toBe(1);
    expect(grazing().qtyEditable).toBe(false);
  });

  it("keeps contents out of the price", () => {
    // Six trays inside one combo is still one PHP 10,000 purchase.
    expect(lineTotal(combo())).toBe(10000);
  });
});

describe("addLine", () => {
  it("never merges, even for the same dish", () => {
    // Someone adding "2× Baby Back Ribs" twice meant four, and folding them
    // together hides a choice they made on purpose.
    const lines = addLine(addLine([], tray()), tray());
    expect(lines).toHaveLength(2);
    expect(itemCount(lines)).toBe(4);
  });

  it("keeps services separable", () => {
    const lines = [tray(), combo(), grazing()].reduce(addLine, []);
    expect(servicesInCart(lines)).toEqual(["party-trays", "combo-trays", "grazing-table"]);
  });
});

describe("removeLine", () => {
  it("takes out only the line asked for", () => {
    const a = tray(), b = combo();
    const left = removeLine([a, b], a.id);
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(b.id);
  });

  it("leaves the cart alone for an id that is not there", () => {
    expect(removeLine([tray()], "nope")).toHaveLength(1);
  });
});

describe("setQty", () => {
  it("clamps to the 1–99 range", () => {
    const line = tray();
    expect(setQty([line], line.id, 150)[0].qty).toBe(99);
    expect(setQty([line], line.id, 3)[0].qty).toBe(3);
  });

  it("treats a negative as a removal, not a clamp to one", () => {
    const line = tray();
    expect(setQty([line], line.id, -4)).toHaveLength(0);
  });

  it("removes the line at zero rather than sitting at one", () => {
    // The old per-builder carts stopped at 1, so people pressed "−" twice
    // and then hunted for the remove button.
    const line = tray({ qty: 1 });
    expect(setQty([line], line.id, 0)).toHaveLength(0);
    expect(stepQty([line], line.id, -1)).toHaveLength(0);
  });

  it("leaves a fixed-quantity line alone", () => {
    const line = grazing();
    expect(stepQty([line], line.id, 3)[0].qty).toBe(1);
  });

  it("ignores an id that is not there", () => {
    expect(stepQty([tray()], "nope", 1)).toHaveLength(1);
  });
});

describe("setVariant", () => {
  it("re-prices from the option, so the cart needs no pricing rules", () => {
    const line = tray({ qty: 2 });
    const [swapped] = setVariant([line], line.id, "xxxl");
    expect(swapped.unitPrice).toBe(5000);
    expect(swapped.variant.selected).toBe("xxxl");
    expect(lineTotal(swapped)).toBe(10000);
  });

  it("ignores an option that does not exist", () => {
    const line = tray();
    expect(setVariant([line], line.id, "bucket")[0].unitPrice).toBe(2500);
  });

  it("ignores a line with no variant", () => {
    const line = combo();
    expect(setVariant([line], line.id, "family")[0].unitPrice).toBe(10000);
  });
});

describe("totals", () => {
  it("sums across services", () => {
    const lines = [tray(), combo(), grazing()].reduce(addLine, []);
    expect(cartTotal(lines)).toBe(2500 * 2 + 10000 + 20000);
  });

  it("counts things, not lines", () => {
    expect(itemCount([tray({ qty: 3 }), combo()])).toBe(4);
  });

  it("treats an empty cart as zero rather than throwing", () => {
    expect(cartTotal([])).toBe(0);
    expect(cartTotal(undefined)).toBe(0);
    expect(itemCount(undefined)).toBe(0);
  });
});

describe("dishesSelectedText", () => {
  const money = (n) => `PHP ${n.toLocaleString()}`;

  it("indents contents under their line", () => {
    const text = dishesSelectedText([combo()], money);
    expect(text).toBe([
      "• Family Combo 1 (15 pax) — PHP 10,000",
      "    Feast — Baby Back Ribs",
      "    Feast — Roast Beef Pink Mash",
    ].join("\n"));
  });

  it("shows a quantity only when there is one worth showing", () => {
    expect(dishesSelectedText([tray({ qty: 1 })], money)).toContain("• Baby Back Ribs");
    expect(dishesSelectedText([tray({ qty: 2 })], money)).toContain("• 2× Baby Back Ribs");
    expect(dishesSelectedText([grazing()], money)).not.toContain("1×");
  });

  it("carries every service in one block", () => {
    const text = dishesSelectedText([tray(), combo(), grazing()].reduce(addLine, []), money);
    expect(text.split("\n").filter((l) => l.startsWith("•"))).toHaveLength(3);
  });
});
