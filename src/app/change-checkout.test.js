import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderCheckout, renderReview, setOrderLines, submitOrder } from "./order-shell.js";
import { startChange, readChange, SESSION_MS } from "../domain/change-session.js";
import { makeLine } from "../domain/cart.js";

/**
 * The seam where a change stops looking like an order.
 *
 * In change mode the checkout must NOT be the contact form. There is nothing
 * on it to ask — the booking already carries the name, the number and the
 * address, and the customer proved who they are on Order Status minutes ago.
 * Worse than redundant: a contact form at the end of a change reads as
 * placing a second booking, which is the single failure this whole flow is
 * built to prevent.
 */
const store = new Map();

beforeEach(() => {
  store.clear();
  setOrderLines([]);
  // The ordinary checkout reaches for the page after it renders — the date
  // picker and the inline validation both do. Change mode touches neither,
  // which is part of what is under test here; this is only enough of a
  // document for the ordinary path to reach its end.
  vi.stubGlobal("document", {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});

afterEach(() => vi.unstubAllGlobals());

/**
 * A stand-in for the element, so this needs no DOM.
 *
 * The ordinary checkout wires listeners and looks for fields after it
 * renders; in change mode it does neither, which is itself part of what is
 * being asserted. These no-ops let both paths run to the end.
 */
const slot = () => ({
  innerHTML: "",
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
});

const begin = (over) => startChange({
  kind: "change", identifier: "a@b.co", eventDate: "2026-12-19",
  packageId: "mary-rose-100",
  was: {
    lines: [{ title: "Mary Rose Package", units: "100 pax", total: 35000 }],
    total: 35000, paid: 17500, balance: 17500,
  },
  ...over,
});

const combos = () => setOrderLines([makeLine({
  service: "combo-trays", serviceLabel: "Combo Trays", title: "Family Combo 1",
  subtitle: "15 pax", unitPrice: 10000, qty: 2,
  payload: { comboId: "fam-c1", paxLabel: "15 pax" },
})]);

describe("the checkout, in change mode", () => {
  it("asks for contact details on an ordinary order", () => {
    combos();
    const el = slot();
    renderCheckout(el);
    expect(el.innerHTML).toContain("data-order-submit");
    expect(el.innerHTML).toMatch(/name|email/i);
  });

  it("shows the change review instead of the contact form", () => {
    begin();
    combos();
    const el = slot();
    renderCheckout(el);
    expect(el.innerHTML).toContain("chg-review");
    expect(el.innerHTML).toContain("Send this change");
    // The contact form's own fields, gone.
    expect(el.innerHTML).not.toContain('id="contact-email"');
  });

  it("puts the booking's total against the order replacing it", () => {
    begin();
    combos();
    const el = slot();
    renderCheckout(el);
    expect(el.innerHTML).toContain("35,000");   // was
    expect(el.innerHTML).toContain("20,000");   // now: 2 × 10,000
    expect(el.innerHTML).toMatch(/15,000 less/);
  });

  it("counts an addition on top of the booking rather than over it", () => {
    begin({ kind: "add" });
    combos();
    const el = slot();
    renderCheckout(el);
    expect(el.innerHTML).toContain("New total");
    expect(el.innerHTML).toContain("55,000");   // 35,000 + 20,000
    expect(el.innerHTML).toContain("Send this addition");
  });

  it("names the cart lines with their quantity, as the order bar does", () => {
    begin();
    combos();
    const el = slot();
    renderCheckout(el);
    expect(el.innerHTML).toContain("2× Family Combo 1");
  });

  /**
   * Reachable by emptying the cart from the review and coming forward again.
   * "Your order is empty" would read as the BOOKING being empty, which is
   * alarming and untrue — nothing has been touched.
   */
  it("does not suggest the booking is empty when the cart is", () => {
    begin();
    setOrderLines([]);
    const el = slot();
    renderCheckout(el);
    expect(el.innerHTML).toMatch(/booking is untouched/i);
    expect(el.innerHTML).not.toMatch(/your order is empty/i);
  });

  it("still says the ordinary thing when nobody is changing anything", () => {
    setOrderLines([]);
    const el = slot();
    renderCheckout(el);
    expect(el.innerHTML).toMatch(/your order is empty/i);
  });
});

/**
 * The screen before the review. Every word on it that says "order" and
 * "checkout" is one more reason for a customer to believe they are buying
 * again rather than changing something they already have.
 */
describe("the order review, in change mode", () => {
  it("does not call the next screen a checkout", () => {
    begin();
    combos();
    const el = slot();
    renderReview(el);
    expect(el.innerHTML).toContain("Review this change");
    expect(el.innerHTML).not.toContain("Checkout");
  });

  it("says adding rather than changing when that is what it is", () => {
    begin({ kind: "add" });
    combos();
    const el = slot();
    renderReview(el);
    expect(el.innerHTML).toContain("Review this addition");
    expect(el.innerHTML).toContain("What you&rsquo;re adding");
  });

  it("does not number a change as a step of placing an order", () => {
    begin();
    combos();
    const el = slot();
    renderReview(el);
    expect(el.innerHTML).not.toContain("Step 3 of 4");
  });

  it("still says the ordinary thing for an ordinary order", () => {
    combos();
    const el = slot();
    renderReview(el);
    expect(el.innerHTML).toContain("Checkout");
    expect(el.innerHTML).toContain("Step 3 of 4");
  });

  it("does not suggest the booking is empty when the cart is", () => {
    begin();
    setOrderLines([]);
    const el = slot();
    renderReview(el);
    expect(el.innerHTML).toContain("Nothing chosen yet");
    expect(el.innerHTML).not.toMatch(/your order is empty/i);
  });
});

/**
 * The back door into a second booking.
 *
 * Before this guard, a change whose half hour ran out fell straight back to
 * the ordinary checkout — a contact form, under a banner still saying
 * "Changing your booking", with a Send that places a NEW order. Everything
 * else in this flow exists to stop exactly that.
 */
describe("a change that ran out of time", () => {
  /** Ages the session past its window, the way an afternoon would. */
  const expire = () => {
    begin();
    const at = readChange().startedAt;
    // readChange does the expiring, and leaves the mark as it goes.
    expect(readChange(at + SESSION_MS + 1)).toBeNull();
  };

  it("never draws the contact form", () => {
    expire();
    combos();
    const el = slot();
    renderCheckout(el);
    expect(el.innerHTML).not.toContain('id="contact-email"');
    expect(el.innerHTML).not.toContain("data-order-submit");
  });

  it("says what happened, and that the booking is untouched", () => {
    expire();
    combos();
    const el = slot();
    renderCheckout(el);
    expect(el.innerHTML).toMatch(/lost track of your booking/i);
    expect(el.innerHTML).toMatch(/nothing has changed/i);
  });

  it("offers a way back rather than a dead end", () => {
    expire();
    combos();
    const el = slot();
    renderCheckout(el);
    expect(el.innerHTML).toContain("data-change-restart");
  });

  /**
   * The screens above can be got around — a stale tab, a back button, a
   * second window. This is the same refusal at the only point where it costs
   * real money, and it is why it is checked twice.
   */
  it("refuses to place it as a new order, whatever screen they reached", async () => {
    expire();
    combos();
    let posted = false;
    vi.stubGlobal("fetch", async () => { posted = true; return { json: async () => ({}) }; });

    await expect(submitOrder(null)).resolves.toBe(false);
    expect(posted).toBe(false);
  });

  it("goes back to the ordinary checkout once the customer has moved on", () => {
    // clearExpiry runs when they press "Find my booking".
    expire();
    combos();
    store.delete("sp_change_expired");
    const el = slot();
    renderCheckout(el);
    expect(el.innerHTML).toContain("data-order-submit");
  });
});

/**
 * A kicker and a title that said the same thing printed "YOUR CHANGE"
 * directly above "Your new order" — two headings, one message, and the
 * screen looked like a rendering mistake.
 */
describe("the review's heading", () => {
  const headings = (kind) => {
    begin({ kind });
    combos();
    const el = slot();
    renderReview(el);
    return el.innerHTML;
  };

  it("does not print the kicker and the title as the same words", () => {
    for (const kind of ["change", "add"]) {
      const html = headings(kind);
      const kicker = /class="section-kicker">([^<]+)</.exec(html)?.[1]?.trim();
      const title  = /class="order-review__title">([\s\S]*?)</.exec(html)?.[1]?.trim();
      expect(kicker, kind).toBeTruthy();
      expect(title, kind).toBeTruthy();
      expect(kicker.toLowerCase(), kind).not.toBe(title.toLowerCase());
    }
  });

  it("still names which of the two a customer is doing", () => {
    expect(headings("change")).toContain("Your change");
    expect(headings("add")).toContain("Your addition");
  });
});
