import { describe, it, expect } from "vitest";
import { groupsFromDishText, readsAsAnOrder } from "./dishes-text.js";

/**
 * Reading an order back out of GoHighLevel.
 *
 * Order Status used to render from payment_links.order_groups, a snapshot
 * written once when the link was minted. The dashboard applies approved
 * changes to the OPPORTUNITY and never touches that row — so the page showed
 * live money beside a frozen order. The fixture below is a real booking:
 * Natashia Lusadio, whose two packages sum to the PHP 54,000 GoHighLevel
 * holds against her name.
 */
const LIVE = [
  "• Mary Rose Package (100 pax) — PHP 35,000",
  "    2× XXXL — Roast Beef Pink Mash with French Beans",
  "    2× XXXL — Lemon Fish Fillet",
  "    XXXL — Blue Rice",
  "• Mary Rose Package (50 pax) — PHP 19,000",
  "    XXXL — Chicken Parmigiana",
].join("\n");

describe("reading the order out of dishes_selected", () => {
  it("finds every package", () => {
    const g = groupsFromDishText(LIVE);
    expect(g).toHaveLength(2);
    expect(g.map((x) => x.title)).toEqual(["Mary Rose Package", "Mary Rose Package"]);
  });

  /**
   * The whole point. If these do not sum to what GoHighLevel holds, the page
   * is contradicting itself again — which is the bug this replaces.
   */
  it("sums to the figure on the opportunity", () => {
    expect(groupsFromDishText(LIVE).reduce((s, g) => s + g.total, 0)).toBe(54000);
  });

  it("takes the size out of the brackets", () => {
    expect(groupsFromDishText(LIVE).map((g) => g.subtitle))
      .toEqual(["100 pax", "50 pax"]);
  });

  it("puts each dish under the package it followed", () => {
    const [first, second] = groupsFromDishText(LIVE);
    expect(first.contents).toHaveLength(3);
    expect(second.contents).toEqual(["XXXL — Chicken Parmigiana"]);
  });

  it("keeps the per-tray quantity, which the kitchen cooks from", () => {
    expect(groupsFromDishText(LIVE)[0].contents[0]).toContain("2×");
  });
});

describe("the shapes it has to survive", () => {
  it("reads a line the menu cannot price as a note, not as zero", () => {
    // An admin-created service carries "From PHP 8,000" where the money
    // goes. Reporting 0 there would render as free on the one screen a
    // customer checks what they owe.
    const [g] = groupsFromDishText("• Bespoke Platter — From PHP 8,000");
    expect(g.total).toBeNull();
    expect(g.priceNote).toBe("From PHP 8,000");
  });

  it("keeps a quantity prefix on the package itself", () => {
    const [g] = groupsFromDishText("• 2× Family Combo 1 (15 pax) — PHP 20,000");
    expect(g.title).toBe("2× Family Combo 1");
  });

  it("copes with a package that has no bracket", () => {
    const [g] = groupsFromDishText("• Party Tray — PHP 2,500");
    expect(g.title).toBe("Party Tray");
    expect(g.subtitle).toBe("");
    expect(g.total).toBe(2500);
  });

  it("splits on the LAST separator, not the first", () => {
    // The em dash is only promised absent from DISH names. A title is free
    // to contain one, and the price is always at the end.
    const [g] = groupsFromDishText("• Surf — Turf Platter (20 pax) — PHP 9,000");
    expect(g.title).toBe("Surf — Turf Platter");
    expect(g.total).toBe(9000);
  });

  it("reads a non-breaking space in the figure", () => {
    // formatPeso writes PHP\u00A035,000.
    expect(groupsFromDishText("• A — PHP\u00A035,000")[0].total).toBe(35000);
  });

  it("handles Windows line endings", () => {
    expect(groupsFromDishText("• A — PHP 1,000\r\n    XXXL — Rice")[0].contents)
      .toEqual(["XXXL — Rice"]);
  });

  it("drops anything before the first bullet", () => {
    const g = groupsFromDishText("notes from a phone call\n• A — PHP 1,000");
    expect(g).toHaveLength(1);
    expect(g[0].contents).toEqual([]);
  });
});

/**
 * Eleven hundred bookings were typed in from the Excel book, and nothing
 * says their dish text was ever written by cart.js. Guessing at freeform
 * prose would put invented structure on a real customer's order.
 */
describe("knowing when not to guess", () => {
  it("reads nothing out of freeform text", () => {
    expect(groupsFromDishText("Jeanette 100pax, paid half, deliver 3pm")).toEqual([]);
  });

  it("reads nothing out of nothing", () => {
    for (const bad of ["", null, undefined, "   \n  \n"]) {
      expect(groupsFromDishText(bad), String(bad)).toEqual([]);
    }
  });

  it("refuses a bullet that is only a line of prose", () => {
    // A dot in front of a sentence is not an order, and showing it as one
    // would replace a readable note with an empty grouped card.
    expect(readsAsAnOrder(groupsFromDishText("• please call before delivery"))).toBe(false);
  });

  it("accepts a bullet with a price, or with dishes under it", () => {
    expect(readsAsAnOrder(groupsFromDishText("• A — PHP 1,000"))).toBe(true);
    expect(readsAsAnOrder(groupsFromDishText("• A\n    XXXL — Rice"))).toBe(true);
  });

  it("says no to an empty parse rather than throwing", () => {
    expect(readsAsAnOrder([])).toBe(false);
    expect(readsAsAnOrder(null)).toBe(false);
  });
});
