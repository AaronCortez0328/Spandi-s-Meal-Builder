import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderReview, setOrderLines } from "./order-shell.js";
import { makeLine } from "../domain/cart.js";

/**
 * This is an order for a party, not a basket of groceries.
 *
 * The client's words, on seeing "Keep shopping" at the foot of the review:
 * "we are not shopping, this system made for ordering." Retail vocabulary
 * makes a booking somebody has saved for sound like a trolley — and it is
 * wrong twice over here, because nothing on that screen is bought. The last
 * step files an enquiry and a person rings them back.
 */
const store = new Map();

beforeEach(() => {
  store.clear();
  setOrderLines([]);
  vi.stubGlobal("sessionStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});

afterEach(() => vi.unstubAllGlobals());

const slot = () => ({ innerHTML: "", querySelector: () => null });

const review = (lines) => {
  setOrderLines(lines);
  const el = slot();
  renderReview(el);
  return el.innerHTML;
};

const line = () => makeLine({
  service: "combo-trays", serviceLabel: "Combo Trays",
  title: "Family Combo 1", unitPrice: 10000, qty: 1,
});

describe("the words on the order screens", () => {
  it("does not tell anybody they are shopping", () => {
    for (const html of [review([line()]), review([])]) {
      expect(html).not.toMatch(/shopping/i);
      expect(html).not.toMatch(/browse/i);
      expect(html).not.toMatch(/basket/i);
    }
  });

  /**
   * The same control at the foot of every builder goes to the same place.
   * Two names for one button is how two screens come to feel like two
   * different products.
   */
  it("calls the way back what every builder calls it", () => {
    expect(review([line()])).toContain("All services");
  });

  it("asks an empty order to choose rather than to browse", () => {
    expect(review([])).toMatch(/choose a service/i);
  });
});
