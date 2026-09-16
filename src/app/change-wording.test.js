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
