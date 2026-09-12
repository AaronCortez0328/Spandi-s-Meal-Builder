import { describe, it, expect } from "vitest";
import {
  makeLine, addLine, removeLine, replaceLine, setQty, stepQty, setVariant,
  lineTotal, cartTotal, itemCount, servicesInCart, dishesSelectedText,
} from "./cart.js";
import { customServiceTotal, customServiceQty } from "./pricing.js";

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

  it("keeps a quantity the customer may not edit", () => {
    // Packed Meals is "50 packs", priced per piece on a volume tier, and the
    // quantity is fixed at the point of adding because changing it later
    // would have to re-price the tier. Locking the control must not flatten
    // the number: 50 packs is not 1 pack.
    const packs = makeLine({ title: "Spag w/ Chicken", qty: 50, qtyEditable: false, unitPrice: 120 });
    expect(packs.qty).toBe(50);
    expect(lineTotal(packs)).toBe(6000);
    expect(packs.qtyEditable).toBe(false);
  });

  it("defaults a fixed line with no quantity to one", () => {
    expect(grazing().qty).toBe(1);
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

  it("keeps the quantity on a line the customer may not edit", () => {
    // The kitchen reads this text. A packed-meals line is 50 packs and its
    // quantity is locked; keying the prefix off editability dropped the 50.
    const packs = makeLine({
      title: "Spag w/ Chicken", subtitle: "Snack Pack",
      qty: 50, qtyEditable: false, unitPrice: 120,
    });
    expect(dishesSelectedText([packs], money)).toContain("• 50× Spag w/ Chicken");
  });

  it("names the chosen variant, and follows a swap", () => {
    // The subtitle cannot carry the size: the size is swappable from inside
    // the cart, so a copy there would be wrong the moment anyone swaps.
    const line = tray({ qty: 1 });
    expect(dishesSelectedText([line], money)).toContain("(Beef · Feast (2kg) · Feast)");
    const [swapped] = setVariant([line], line.id, "xxxl");
    expect(dishesSelectedText([swapped], money)).toContain("· XXXL)");
    expect(dishesSelectedText([swapped], money)).not.toContain("· Feast)");
  });

  it("carries every service in one block", () => {
    const text = dishesSelectedText([tray(), combo(), grazing()].reduce(addLine, []), money);
    expect(text.split("\n").filter((l) => l.startsWith("•"))).toHaveLength(3);
  });
});

/**
 * Admin-created services have a "from" figure for the chooser and nothing to
 * calculate with, so their line is genuinely unpriced rather than free.
 * priceNote is what every screen shows in place of the money.
 *
 * The property that matters most here is the one about the seven: they carry
 * no priceNote, so `priceNote ?? money(...)` has to be exactly what those
 * screens did before this existed.
 */
describe("priceNote", () => {
  const money = (n) => `PHP ${n.toLocaleString()}`;

  const enquiry = (over = {}) => makeLine({
    service: "lechon-belly", serviceLabel: "Lechon Belly",
    title: "50 pax", subtitle: "Lechon Belly",
    unitPrice: 0, qty: 1, qtyEditable: false,
    priceNote: "Quoted separately", ...over,
  });

  it("is null on every line that does not ask for one", () => {
    expect(tray().priceNote).toBeNull();
    expect(combo().priceNote).toBeNull();
    expect(grazing().priceNote).toBeNull();
  });

  // makeLine builds a fresh object from known keys, so a field it does not
  // name is dropped. That is what this guards: the note has to survive the
  // trip into the cart or every screen falls back to PHP 0.
  it("survives makeLine", () => {
    expect(enquiry().priceNote).toBe("Quoted separately");
  });

  // The document the kitchen actually works from. "PHP 0" against a line
  // here does not read as unpriced, it reads as free.
  it("replaces the money in dishes_selected", () => {
    const text = dishesSelectedText([enquiry()], money);
    expect(text).toContain("• 50 pax (Lechon Belly) — Quoted separately");
    expect(text).not.toContain("PHP 0");
  });

  it("leaves the seven's dishes_selected exactly as it was", () => {
    expect(dishesSelectedText([tray({ qty: 1 })], money))
      .toBe("• Baby Back Ribs (Beef · Feast (2kg) · Feast) — PHP 2,500");
  });

  it("carries the customer's note as contents under the line", () => {
    const text = dishesSelectedText([enquiry({ contents: ["Birthday, 6pm start"] })], money);
    expect(text).toContain("    Birthday, 6pm start");
  });

  // The order total is the total of what could be priced. An unpriced line
  // contributes nothing rather than poisoning the sum -- the screens say
  // "Priced items" instead of "Order total" when one is present.
  it("adds nothing to the order total", () => {
    const lines = [tray({ qty: 1 }), enquiry()].reduce(addLine, []);
    expect(cartTotal(lines)).toBe(2500);
  });

  it("still counts as an item in the basket", () => {
    expect(itemCount([enquiry()])).toBe(1);
    expect(servicesInCart([tray(), enquiry()])).toContain("lechon-belly");
  });
});

/**
 * Custom service lines, and the reason their quantity is not the cart's.
 *
 * api/ghl-inquiry.js compares the browser's total to the server's exactly,
 * then writes the server's figure to the opportunity as the order's value —
 * the number every revenue report sums. Disagreeing is safe: the customer
 * gets a 409 and the real price. Agreeing on a WRONG number is not, because
 * nothing anywhere asks a question.
 */
/**
 * A line's own quantity ceiling.
 *
 * QTY_MAX is 99 because it answers "how many of this tray", and for a tray
 * that is right. Packed meals are counted in pieces and their volume tier
 * starts at 100, so clamping to 99 sold a 120-pack order as 99 — at the
 * dearer rate, while the configurator went on quoting the price for 120.
 */
describe("a line's own quantity ceiling", () => {
  it("still clamps at 99 when a line does not ask for anything else", () => {
    expect(makeLine({ qty: 500 }).qty).toBe(99);
    expect(makeLine({ qty: 500 }).qtyMax).toBeNull();
  });

  it("lets a line that declares a ceiling keep its quantity", () => {
    expect(makeLine({ qty: 120, qtyMax: 9999 }).qty).toBe(120);
    expect(makeLine({ qty: 20000, qtyMax: 9999 }).qty).toBe(9999);
  });

  it("honours the line's own ceiling from the basket too", () => {
    const [big] = setQty([makeLine({ qty: 120, qtyMax: 9999, qtyEditable: true })],
      makeLine({ qty: 1 }).id, 1); // no-op guard: ids differ
    expect(big.qty).toBe(120);

    const line = makeLine({ qty: 120, qtyMax: 9999, qtyEditable: true });
    const [raised] = setQty([line], line.id, 400);
    expect(raised.qty).toBe(400);

    const tray = makeLine({ qty: 5, qtyEditable: true });
    const [clamped] = setQty([tray], tray.id, 400);
    expect(clamped.qty).toBe(99);
  });

  // Number(null) is 0, not NaN. Coercing before checking gave a line with no
  // ceiling a ceiling of zero, which clamped every quantity in the cart to 1.
  // Caught by the existing suite the moment it was written.
  it("does not read a missing ceiling as a ceiling of zero", () => {
    expect(makeLine({ qty: 40 }).qty).toBe(40);
    expect(makeLine({ qty: 40, qtyMax: null }).qty).toBe(40);
    expect(makeLine({ qty: 40, qtyMax: undefined }).qty).toBe(40);
    expect(makeLine({ qty: 40, qtyMax: "nonsense" }).qty).toBe(40);
  });
});

describe("custom service lines", () => {
  const perUnit = { pricing_mode: "per_unit", unit_price: 450 };

  /** What src/app/custom-service.js builds: total in unitPrice, qty left at 1. */
  const enquiryLine = (row, typed) => {
    const quantity = customServiceQty(typed);
    return makeLine({
      service: "lechon-belly", serviceLabel: "Lechon Belly",
      title: `${quantity} kg`, qtyEditable: false,
      unitPrice: customServiceTotal(row, quantity),
      payload: { slug: "lechon-belly", quantity, unit: "kg" },
    });
  };

  it("shows the same total the server will verify", () => {
    const line = enquiryLine(perUnit, 5);
    expect(lineTotal(line)).toBe(customServiceTotal(perUnit, 5));
    expect(lineTotal(line)).toBe(2250);
  });

  // The trap this shape exists to avoid. QTY_MAX is 99 because it bounds
  // "how many trays" — the right question for a tray, and the wrong one for
  // kilos.
  it("is not clamped by the cart's tray limit", () => {
    const line = enquiryLine(perUnit, 150);

    expect(line.qty).toBe(1);                    // so clampQty never applies
    expect(line.payload.quantity).toBe(150);     // the server gets the real figure
    expect(lineTotal(line)).toBe(67500);         // and the customer sees it
  });

  // What the obvious implementation would have done. Kept as a test rather
  // than a comment because it is the failure mode, stated in numbers: both
  // sides agree on 44,550, no mismatch is raised, and a PHP 67,500 order is
  // booked 22,950 short.
  it("would have been short by 22,950 had the quantity gone in qty", () => {
    const wrong = makeLine({ unitPrice: 450, qty: 150 });
    expect(wrong.qty).toBe(99);
    expect(lineTotal(wrong)).toBe(44550);
    expect(lineTotal(wrong)).toBeLessThan(customServiceTotal(perUnit, 150));
  });

  it("still books an enquiry card at zero, and says so", () => {
    const row = { pricing_mode: "enquiry", unit_price: null };
    const line = makeLine({
      service: "tasting", unitPrice: customServiceTotal(row, 2),
      priceNote: "Quoted separately", qtyEditable: false,
      payload: { slug: "tasting", quantity: 2 },
    });
    expect(lineTotal(line)).toBe(0);
    expect(line.priceNote).toBe("Quoted separately");
  });

  it("gives a priced card no price note, so its money shows", () => {
    expect(enquiryLine(perUnit, 5).priceNote).toBeNull();
  });
});

describe("replaceLine", () => {
  const lines = [
    makeLine({ service: "packed-meals", title: "Adobo", unitPrice: 180, qty: 50, qtyEditable: false }),
    makeLine({ service: "party-trays", title: "Beef", unitPrice: 1500, qty: 1 }),
    makeLine({ service: "packed-meals", title: "Curry", unitPrice: 200, qty: 25, qtyEditable: false }),
  ];

  it("puts the rebuilt line back where it was", () => {
    const next = replaceLine(lines, lines[0].id, {
      service: "packed-meals", title: "Adobo", unitPrice: 170, qty: 60, qtyEditable: false,
    });
    expect(next[0].title).toBe("Adobo");
    expect(next[0].qty).toBe(60);
    // The tier moved because the quantity did -- the whole reason a line
    // goes back to its builder instead of being edited in the cart.
    expect(next[0].unitPrice).toBe(170);
    expect(next.map((l) => l.title)).toEqual(["Adobo", "Beef", "Curry"]);
  });

  it("keeps the line's id, so anything pointing at it still does", () => {
    const id = lines[0].id;
    const next = replaceLine(lines, id, { service: "packed-meals", title: "Adobo", qty: 60 });
    expect(next[0].id).toBe(id);
  });

  it("leaves every other line alone", () => {
    const next = replaceLine(lines, lines[0].id, { service: "packed-meals", title: "X", qty: 1 });
    expect(next[1]).toEqual(lines[1]);
    expect(next[2]).toEqual(lines[2]);
  });

  it("changes nothing when the id is not in the order", () => {
    expect(replaceLine(lines, "nope", { title: "X" })).toEqual(lines);
  });
});
