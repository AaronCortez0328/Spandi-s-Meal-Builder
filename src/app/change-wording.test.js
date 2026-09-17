import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderCartInto } from "./order-cart.js";
import { startChange } from "../domain/change-session.js";
import { makeLine } from "../domain/cart.js";

/**
 * The builder's own order bar, during a change.
 *
 * Three builders hard-coded "Review order →" and three inherited it, so a
 * customer amending a booking was told to review an ORDER by the screen
 * they were standing on and to review a CHANGE by the very next one. Same
 * person, same minute, two different stories about what they were doing.
 *
 * The bar now words itself, which is the only way the two cannot drift:
 * there is one place that draws it.
 */
const store = new Map();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});

afterEach(() => vi.unstubAllGlobals());

const begin = (kind) => startChange({
  kind, identifier: "a@b.co", eventDate: "2026-12-19",
});

/** Enough of an element for the bar to render into. */
const slot = () => ({ innerHTML: "", querySelector: () => null });

const line = () => makeLine({
  service: "combo-trays", serviceLabel: "Combo Trays", title: "Family Combo 1",
  unitPrice: 10000, qty: 2,
});

const bar = (lines = [line()]) => {
  const el = slot();
  renderCartInto(el, lines);
  return el.innerHTML;
};

describe("the builder's order bar", () => {
  it("talks about an order when that is what it is", () => {
    expect(bar()).toContain("Review order");
    expect(bar()).toContain("Running total");
  });

  it("talks about a change when a booking is being changed", () => {
    begin("change");
    expect(bar()).toContain("Review this change");
    expect(bar()).not.toContain("Review order");
  });

  it("talks about an addition when something is being added", () => {
    begin("add");
    expect(bar()).toContain("Review this addition");
    expect(bar()).not.toContain("Review order");
  });

  /**
   * "Running total" is an ordering word. It is not wrong during a change,
   * it is beside the point — what a customer is weighing up then is what
   * their booking would become.
   */
  it("says what the booking would come to, not what is running", () => {
    begin("change");
    const html = bar();
    expect(html).toContain("This would come to");
    expect(html).not.toContain("Running total");
  });

  it("uses the same words on the empty bar as on the full one", () => {
    // The empty bar draws a disabled forward button with the same label.
    // It had the hard-coded string too, so it disagreed with itself.
    begin("change");
    expect(bar([])).toContain("Review this change");
  });

  it("still lets a screen pass its own words when it genuinely needs to", () => {
    begin("change");
    const el = slot();
    renderCartInto(el, [line()], { forwardLabel: "Somewhere else" });
    expect(el.innerHTML).toContain("Somewhere else");
  });
});

/**
 * Where the order bar's left button goes.
 *
 * It used to be the service chooser, always. That was right when a builder
 * had no steps inside it, and wrong once one did: the way back to the step
 * behind you lived only in the breadcrumb at the top of the page, and on the
 * combo grid that is several screens above somebody who has just scrolled a
 * list of cards.
 *
 * The first reading was "they go back once, at the end". The client
 * corrected it — most customers EXPLORE: fifteen guests, back, thirty, back,
 * fifty. Going back is the loop of browsing, not the exit from it, so it has
 * to be where they already are rather than where they started.
 */
describe("the order bar's way back", () => {
  it("offers the service chooser when there is no step behind you", () => {
    const html = bar();
    expect(html).toContain("All services");
    expect(html).toContain("data-service-back");
  });

  it("offers the step behind you when there is one", () => {
    const el = slot();
    renderCartInto(el, [line()], {
      backLabel: "&larr; Guests", backAttr: 'data-cat-substep="0"',
    });
    expect(el.innerHTML).toContain("Guests");
    expect(el.innerHTML).toContain('data-cat-substep="0"');
  });

  /**
   * Two back-arrows side by side pointing at different places is worse than
   * the scroll it would have fixed.
   */
  it("never shows two ways back at once", () => {
    const el = slot();
    renderCartInto(el, [line()], {
      backLabel: "&larr; Guests", backAttr: 'data-cat-substep="0"',
    });
    expect(el.innerHTML).not.toContain("All services");
    expect(el.innerHTML).not.toContain("data-service-back");
  });

  it("says the same thing on the empty bar as on the full one", () => {
    // The empty bar is its own branch and had its own hard-coded label.
    const el = slot();
    renderCartInto(el, [], {
      backLabel: "&larr; Guests", backAttr: 'data-cat-substep="0"',
    });
    expect(el.innerHTML).toContain("Guests");
    expect(el.innerHTML).not.toContain("All services");
  });
});
