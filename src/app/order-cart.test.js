import { describe, it, expect } from "vitest";
import { cartAction } from "./order-cart.js";

/**
 * What a click inside the cart is understood to mean.
 */

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

  // Only on lines whose quantity is locked -- a packed-meals pack, a
  // grazing tier, a catering package. Those go back to their builder to be
  // changed, because the price is decided there.
  it("reads an edit", () => {
    expect(cartAction(fakeEvent({ "data-cart-edit": { cartEdit: "ln-3" } })))
      .toEqual({ type: "edit", id: "ln-3" });
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
