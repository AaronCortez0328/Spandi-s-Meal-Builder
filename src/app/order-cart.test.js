import { describe, it, expect } from "vitest";
import { cartAction, renderCartInto } from "./order-cart.js";
import { makeLine } from "../domain/cart.js";

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

/**
 * Every button the cart draws must say what it does.
 *
 * The disabled "Review order" shipped with no label at all -- an empty
 * pill, which renders as a bare circle and announces itself to a screen
 * reader as "button" and nothing more. Lint cannot see it, and neither can
 * a build: an empty template expression is valid markup.
 */
describe("what the cart renders", () => {
  // renderCartInto only ever sets innerHTML and looks for the fold, so a
  // container this small is enough to capture the markup without a DOM.
  const render = (lines) => {
    let html = "";
    renderCartInto({
      set innerHTML(v) { html = v; },
      get innerHTML() { return html; },
      querySelector: () => null,
    }, lines, { forwardLabel: "Review order &rarr;" });
    return html;
  };

  const line = makeLine({
    service: "party-trays", serviceLabel: "Party Trays",
    title: "Beef", unitPrice: 1500, qty: 2,
  });

  const buttonsIn = (html) => html.match(/<button[\s\S]*?<\/button>/g) ?? [];
  // Either visible text between the tags, or an aria-label standing in for
  // it. Inner tags are stripped, so an icon-only button carrying a label
  // passes and an empty one does not.
  const named = (btn) =>
    /aria-label="[^"]+"/.test(btn)
    || btn.replace(/<[^>]+>/g, "").trim().length > 0;

  it("gives every button a label when the order is empty", () => {
    const html = render([]);
    expect(buttonsIn(html).length).toBeGreaterThan(0);
    for (const btn of buttonsIn(html)) expect(named(btn), btn).toBe(true);
  });

  it("gives every button a label when the order has something in it", () => {
    const html = render([line]);
    expect(buttonsIn(html).length).toBeGreaterThan(0);
    for (const btn of buttonsIn(html)) expect(named(btn), btn).toBe(true);
  });
});
