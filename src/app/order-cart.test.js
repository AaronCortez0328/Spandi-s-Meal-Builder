import { describe, it, expect } from "vitest";
import { adjustHint, cartAction } from "./order-cart.js";

/**
 * The cart draws different controls for different services, so the copy
 * around it cannot be fixed text. These pin the two places that has to hold:
 * what the hint promises, and what a click is understood to mean.
 */

const tray = { qtyEditable: true, variant: { options: [{ id: "a" }, { id: "b" }] } };
const pack = { qtyEditable: false, variant: null };
const tier = { qtyEditable: false, variant: null };

describe("adjustHint", () => {
  it("offers a size swap only where there are sizes", () => {
    expect(adjustHint([tray])).toContain("swap a size");
    expect(adjustHint([pack])).not.toContain("swap a size");
  });

  it("offers a quantity change only where the quantity can change", () => {
    expect(adjustHint([tray])).toContain("change quantity");
    // Packed Meals sets its quantity before adding, because the price sits on
    // a volume tier. Promising a control that is not on screen sends someone
    // hunting for it.
    expect(adjustHint([pack])).not.toContain("change quantity");
  });

  it("always offers removal, and reads as a sentence on its own", () => {
    expect(adjustHint([pack])).toBe("Need to adjust? Remove items below.");
    expect(adjustHint([tier])).toBe("Need to adjust? Remove items below.");
  });

  it("names everything available across a mixed order", () => {
    const hint = adjustHint([tray, pack]);
    expect(hint).toBe("Need to adjust? change quantity, swap a size or remove items below.");
  });
});

describe("cartAction", () => {
  const fakeEvent = (attrs) => ({
    target: {
      closest(sel) {
        const key = sel.replace(/[[\]]/g, "");
        return attrs[key] ? { dataset: attrs[key] } : null;
      },
    },
  });

  it("reads a quantity step with its direction", () => {
    expect(cartAction(fakeEvent({ "data-cart-qty": { cartQty: "ln-1", delta: "-1" } })))
      .toEqual({ type: "qty", id: "ln-1", delta: -1 });
  });

  it("reads a removal", () => {
    expect(cartAction(fakeEvent({ "data-cart-remove": { cartRemove: "ln-2" } })))
      .toEqual({ type: "remove", id: "ln-2" });
  });

  it("reads a variant swap with the option chosen", () => {
    expect(cartAction(fakeEvent({ "data-cart-variant": { cartVariant: "ln-3", option: "xxxl" } })))
      .toEqual({ type: "variant", id: "ln-3", option: "xxxl" });
  });

  it("reads a contents disclosure", () => {
    expect(cartAction(fakeEvent({ "data-cart-expand": { cartExpand: "ln-4" } })))
      .toEqual({ type: "expand", id: "ln-4" });
  });

  it("returns null for a click that is not the cart's", () => {
    // Builders share one container-level handler, so a click on anything else
    // must fall through rather than being swallowed here.
    expect(cartAction(fakeEvent({}))).toBeNull();
    expect(cartAction(null)).toBeNull();
    expect(cartAction({ target: {} })).toBeNull();
  });
});
