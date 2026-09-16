import { describe, it, expect } from "vitest";
import {
  groupHtml, orderHtml, timelineHtml, resultHtml,
  outcomeHtml, NOT_BOTH, UNREACHABLE, confirmHtml, bookingSnapshot,
} from "./order-status.js";
import { orderTimeline, orderStep } from "../domain/order-stages.js";

/**
 * The screen renders a booking to somebody who proved very little about
 * themselves, so two things are asserted throughout: that nothing about money
 * reaches the markup, and that an order with no recorded structure still gets
 * a real rendering rather than an empty panel.
 *
 * The fallback is not a tidy-up-later case. Every booking placed before
 * order_groups existed will read that way for as long as it exists.
 */

const GROUPS = [
  {
    service: "grazing-board", kind: "Grazing", title: "Grazing Board",
    subtitle: "", units: "60–100 pax", qty: 1,
    contents: ["Spread: 60–100 pax — PHP 58,000"], total: 58000, priceNote: null,
  },
  {
    service: "party-trays", kind: "Party Trays", title: "Bilao",
    subtitle: "Pancit Malabon · Large", units: "2 trays", qty: 2,
    contents: [], total: 3600, priceNote: null,
  },
];

describe("a group keeps its own units and its own costing", () => {
  const html = groupHtml(GROUPS[0]);

  it("names the kind of thing it is", () => {
    expect(html).toContain("Grazing");
    expect(html).toContain("Grazing Board");
  });

  it("shows the units that group counts, not a shared figure", () => {
    expect(html).toContain("60–100 pax");
  });

  it("carries the costing wording the builder wrote", () => {
    expect(html).toContain("Spread: 60–100 pax — PHP 58,000");
  });

  it("says the note instead of a figure when the menu cannot price it", () => {
    const out = groupHtml({ title: "Lechon", total: null, priceNote: "Priced on enquiry" });
    expect(out).toContain("Priced on enquiry");
    expect(out).not.toContain("PHP");
  });

  it("prints no money at all when there is none and no note", () => {
    expect(groupHtml({ title: "X", total: null, priceNote: null })).not.toContain("PHP");
  });
});

describe("an order that spans services", () => {
  const html = orderHtml({ groups: GROUPS });

  it("draws every group, never a single merged block", () => {
    expect(html).toContain("Grazing Board");
    expect(html).toContain("Bilao");
  });

  it("keeps each group's units apart", () => {
    expect(html).toContain("60–100 pax");
    expect(html).toContain("2 trays");
  });

  it("never invents a combined guest count", () => {
    // Adding trays to pax produces a number that means nothing and that a
    // customer would reasonably believe.
    expect(html).not.toMatch(/\b62\b/);
  });
});

describe("an order booked before the structure was recorded", () => {
  const data = {
    groups: null, packageName: "Basic Catering Package",
    paxCount: "50 pax", dishes: "• Chicken\n• Pancit",
  };

  it("still shows what was ordered", () => {
    const html = orderHtml(data);
    expect(html).toContain("Basic Catering Package");
    expect(html).toContain("50 pax");
  });

  it("still shows the dishes", () => {
    expect(orderHtml(data)).toContain("Chicken");
  });

  it("does not render an empty shell when even that is missing", () => {
    const html = orderHtml({ groups: null, packageName: null, paxCount: null, dishes: null });
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });
});

describe("the timeline", () => {
  const rows = orderTimeline({ pipelineStage: "Confirmed", kitchenStage: "procured" });
  const html = timelineHtml(rows);

  it("shows all six, so a customer sees what is still to come", () => {
    for (const label of ["Order received", "Confirmed", "Preparing", "Cooking", "Ready", "Completed"]) {
      expect(html, label).toContain(label);
    }
  });

  it("marks exactly one step current", () => {
    expect(html.match(/is-current/g)).toHaveLength(1);
  });

  it("carries no times of any kind — the kitchen's ticks are batched by hand", () => {
    expect(html).not.toMatch(/\d{1,2}:\d{2}/);
    expect(html).not.toMatch(/ago|updated/i);
  });
});

describe("what the rendered page can leak", () => {
  const data = () => {
    const input = { pipelineStage: "Confirmed", kitchenStage: "procured" };
    const r = orderStep(input);
    return {
      found: true, step: r.step.id, stepLabel: r.step.label, offTimeline: null,
      timeline: orderTimeline(input), branch: "Cavite",
      receiveMethod: "Delivery", fulfilmentTime: "10:00",
      groups: GROUPS, packageName: null, paxCount: null, dishes: null,
    };
  };

  it("points at the booking email when there is no figure to show", () => {
    expect(resultHtml(data())).toMatch(/booking email/i);
  });

  it("still never names an address, however much else it shows", () => {
    const html = resultHtml({ ...data(), money: MONEY, payUrl: "https://x/?pay=t" });
    expect(html).not.toMatch(/somewhere|street|barangay/i);
  });

  it("says how they are receiving it without naming an address", () => {
    const html = resultHtml(data());
    expect(html).toContain("Delivery");
    expect(html).not.toMatch(/street|st\.|barangay/i);
  });
});

describe("a booking that left the timeline", () => {
  const off = {
    offTimeline: { id: "rescheduled", label: "Rescheduled" },
    groups: GROUPS, timeline: [],
  };

  it("says so in plain words rather than showing a stalled progress bar", () => {
    const html = resultHtml(off);
    expect(html).toContain("rescheduled");
    expect(html).not.toContain("os-steps");
  });

  it("still shows what was ordered", () => {
    expect(resultHtml(off)).toContain("Grazing Board");
  });
});

describe("text from the order cannot become markup", () => {
  it("escapes a dish name carrying a tag", () => {
    const html = groupHtml({
      title: "<img src=x onerror=alert(1)>", contents: ["<script>bad()</script>"], total: 1,
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
  });

  it("escapes the flat fallback too", () => {
    const html = orderHtml({ groups: null, packageName: "<b>x</b>", paxCount: null, dishes: null });
    expect(html).not.toContain("<b>x</b>");
  });
});

describe("what the page says when there is no order to draw", () => {
  it("does not tell a customer their booking is missing when the network dropped", () => {
    // Different wording from a miss on purpose. "We couldn't find an order"
    // after a dropped connection sends someone to ring the kitchen about an
    // order that is perfectly fine.
    const html = outcomeHtml("unreachable");
    expect(html).toMatch(/connection/i);
    expect(html).not.toMatch(/couldn.t find an order/i);
  });

  it("asks for the missing field rather than guessing", () => {
    expect(outcomeHtml("incomplete")).toContain(NOT_BOTH);
  });

  it("shows the server's own wording for a miss, so all misses read alike", () => {
    // The apostrophe arrives escaped, which is the point of escaping it.
    const html = outcomeHtml("result", { found: false, message: "We couldn't find it." });
    expect(html).toContain("We couldn&#39;t find it.");
  });

  it("still says something when the server sends no message at all", () => {
    const html = outcomeHtml("result", { found: false });
    expect(html).toMatch(/find an order/i);
  });

  it("escapes whatever the server sent rather than trusting it as markup", () => {
    const html = outcomeHtml("result", { found: false, message: "<img src=x>" });
    expect(html).not.toContain("<img");
  });

  it("keeps the three messages distinct", () => {
    expect(NOT_BOTH).not.toBe(UNREACHABLE);
  });
});

const MONEY = { total: 64250, reserve: 32125, paid: 0, balance: 64250 };

describe("what is owed, and the way to settle it", () => {
  const withMoney = (over) => resultHtml({
    timeline: [], groups: GROUPS, money: MONEY,
    payUrl: "https://example.test/?pay=tok", paymentStatus: "Unpaid", ...over,
  });
  it("anchors on the order total, so the other figures mean something", () => {
    expect(withMoney()).toContain("Order total");
    expect(withMoney()).toContain("64,250");
  });

  it("says total paid, not paid so far", () => {
    expect(withMoney()).toContain("Total paid");
    expect(withMoney()).not.toContain("Paid so far");
  });

  it("offers the customer their own link to settle it", () => {
    expect(withMoney()).toContain("Pay now");
    expect(withMoney()).toContain("https://example.test/?pay=tok");
  });

  it("puts Pay now above the panels, where Change will join it", () => {
    // It used to sit inside the payment panel, beside the figure it refers
    // to — the better argument on its own. It moved because the second
    // action cannot follow it there: "Change this order" belongs to the
    // booking rather than to its money, and a dark payment block is where a
    // feature gets built and never found.
    const html = withMoney();
    expect(html).toContain("os-actions");
    expect(html.indexOf("os-actions")).toBeLessThan(html.indexOf("os-result"));
    expect(html).not.toContain("os-pay__btn");
  });

  it("opens the payment page in a new tab, not inside the iframe", () => {
    // This screen runs in an iframe on the GoHighLevel page. Without target
    // the payment page loads INSIDE the status frame: the navigation still
    // reads Order Status and there is no way back to the order.
    const html = withMoney();
    expect(html).toContain('target="_blank"');
    expect(html).toContain("noopener");
  });

  it("drops the button rather than offering a dead one", () => {
    const html = withMoney({ payUrl: null });
    expect(html).toContain("Balance due");
    expect(html).not.toContain("Pay now");
  });
});

describe("a booking that is already settled", () => {
  const DONE = { total: 10000, reserve: 5000, paid: 10000, balance: 0 };
  const settled = (over) => resultHtml({
    timeline: [], groups: GROUPS, money: DONE,
    payUrl: "https://example.test/?pay=tok", paymentStatus: "Fully Paid", ...over,
  });

  it("never offers Pay now, which would invite a second payment", () => {
    expect(settled()).not.toContain("Pay now");
  });

  it("says so plainly instead of leaving them to read a zero", () => {
    expect(settled()).toMatch(/nothing more to send/i);
    expect(settled()).toContain("Paid in full");
  });

  it("drops the reserve line, which is only useful before paying", () => {
    expect(settled()).not.toContain("reserve with 50%");
  });

  it("labels the remainder Balance, not Balance due", () => {
    expect(settled()).toContain("Balance<");
    expect(settled()).not.toContain("Balance due");
  });
});

describe("the badge can never contradict the figures", () => {
  const show = (money, status) => resultHtml({
    timeline: [], groups: GROUPS, money, paymentStatus: status, payUrl: null,
  });

  it("ignores a stale Fully Paid on an order that still owes", () => {
    // payment_status is typed by hand in GoHighLevel and drifts. A chip
    // reading "Fully Paid" above a balance of 32,125 is worse than none.
    const html = show({ total: 64250, reserve: 32125, paid: 32125, balance: 32125 }, "Fully Paid");
    expect(html).toContain("Partly paid");
    expect(html).not.toContain("Fully Paid");
  });

  it("reads nothing paid as unpaid", () => {
    expect(show({ total: 100, reserve: 50, paid: 0, balance: 100 }, "")).toContain("Unpaid");
  });

  it("falls back to the typed value only when there is nothing to work out", () => {
    const html = show({ total: 100, reserve: 50, paid: null, balance: null }, "Half Paid");
    expect(html).toContain("Half Paid");
    expect(html).toContain("Not recorded yet");
  });
});

describe("a booking with no figure at all", () => {
  it("shows no panel and points at the email", () => {
    const html = resultHtml({ timeline: [], groups: GROUPS, money: null, payUrl: null });
    // Checked on content, not a class prefix — "os-payhint" begins with
    // "os-pay", so a prefix match passes whatever the code does.
    expect(html).not.toContain("Order total");
    expect(html).not.toContain("Pay now");
    expect(html).toMatch(/booking email/i);
  });
});

const SIZES = [
  { packageId: "jeanette-50",  name: "Jeanette Package", paxLabel: "50 pax",  price: 19000 },
  { packageId: "jeanette-100", name: "Jeanette Package", paxLabel: "100 pax", price: 35000 },
];

describe("offering a change", () => {
  const base = {
    timeline: [], groups: GROUPS, money: null, payUrl: null,
    sizes: SIZES, paxCount: "50 pax", canChange: true, canAdd: true,
    changeClosesOn: "2026-09-30", request: null,
  };

  it("offers it when the window is open and there is somewhere to move to", () => {
    expect(resultHtml(base)).toContain("Change this order");
  });

  it("does not offer it once the window has shut", () => {
    expect(resultHtml({ ...base, canChange: false })).not.toContain("Change this order");
  });

      it("does not offer it while a request is already waiting", () => {
    const html = resultHtml({ ...base, request: { kind: "change", status: "pending" } });
    expect(html).not.toContain("Change this order");
  });

  it("says why instead of silently dropping the button", () => {
    // A control that quietly is not there raises a question nobody is around
    // to answer.
    const html = resultHtml({ ...base, canChange: false, canAdd: false });
    expect(html).toMatch(/too close to the event/i);
    expect(html).toMatch(/message us/i);
  });

  it("says nothing about locks while the booking can still be changed", () => {
    expect(resultHtml(base)).not.toMatch(/too close to the event/i);
  });
});

describe("a request the customer has already made", () => {
  const withReq = (request) => resultHtml({
    timeline: [], groups: GROUPS, money: null, payUrl: null, sizes: SIZES, request,
  });

  it("says nothing has changed yet, which is the line that matters", () => {
    const html = withReq({ kind: "change", status: "pending" });
    expect(html).toMatch(/nothing has changed yet/i);
  });

  it("names what they asked for, so they can check it was heard right", () => {
    expect(withReq({ kind: "change", status: "pending" })).toMatch(/different size/i);
    expect(withReq({ kind: "add", status: "pending" })).toMatch(/more items/i);
  });

  it("confirms an approved one without making them work it out", () => {
    expect(withReq({ kind: "change", status: "approved" })).toMatch(/updated one/i);
  });

  it("gives the reason when one was declined", () => {
    const html = withReq({ kind: "change", status: "declined", note: "Kitchen is full that day." });
    expect(html).toContain("Kitchen is full that day.");
    expect(html).toMatch(/unchanged/i);
  });

  it("still says something useful when a decline carried no reason", () => {
    const html = withReq({ kind: "change", status: "declined", note: null });
    expect(html).toMatch(/another way/i);
  });

  it("escapes a note rather than trusting what an admin typed", () => {
    const html = withReq({ kind: "change", status: "declined", note: "<script>bad()</script>" });
    expect(html).not.toContain("<script>");
  });
});

describe("the step before leaving for the builder", () => {
  const data = { packageName: "Mary Rose Package", paxCount: "25 pax" };

  it("says what will happen, because the builder looks like ordering", () => {
    const html = confirmHtml("change", data);
    expect(html).toMatch(/build your new order/i);
    expect(html).toMatch(/confirm it with you before anything changes/i);
  });

  it("promises the current booking stays put, and names it", () => {
    const html = confirmHtml("change", data);
    expect(html).toMatch(/stays exactly as it is/i);
    expect(html).toContain("Mary Rose Package");
    expect(html).toContain("25 pax");
  });

  it("words adding differently from changing, because they are different", () => {
    expect(confirmHtml("add", data)).toMatch(/choose what to add/i);
    expect(confirmHtml("add", data)).not.toMatch(/build your new order/i);
  });

  it("offers a way out that is not the browser back button", () => {
    expect(confirmHtml("change", data)).toMatch(/never mind/i);
  });

  it("starts hidden when asked to", () => {
    expect(confirmHtml("change", data, true)).toContain("hidden");
  });

  it("survives a booking we cannot name", () => {
    const html = confirmHtml("change", { packageName: null, paxCount: null });
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });
});

describe("offering the two journeys", () => {
  const base = {
    timeline: [], groups: GROUPS, money: null, payUrl: null,
    canChange: true, canAdd: true, request: null,
  };

  it("offers both when both windows are open", () => {
    const html = resultHtml(base);
    expect(html).toContain("Change this order");
    expect(html).toContain("Add to this order");
  });

  it("no longer depends on a size list, because the builder handles everything", () => {
    // The old picker only worked for packages with siblings. Sending them to
    // the builder means party trays and packed meals can be changed too.
    const html = resultHtml({ ...base, sizes: [], addable: [] });
    expect(html).toContain("Change this order");
    expect(html).toContain("Add to this order");
  });

  it("offers neither while a request is waiting", () => {
    const html = resultHtml({ ...base, request: { kind: "change", status: "pending" } });
    expect(html).not.toContain("Change this order");
    expect(html).not.toContain("Add to this order");
  });
});

/**
 * What travels to the builder when a customer presses "Build my new order".
 *
 * Taken here because this screen is holding the looked-up booking at that
 * exact moment. Fetching it again from the builder would be a second round
 * trip, a second failure mode, and a race against a cart the customer may
 * already be filling.
 */
describe("the snapshot carried into a change", () => {
  const found = {
    found: true,
    packageId: "mary-rose-100",
    packageName: "Maryrose Package 100Pax",
    paxCount: "100 pax",
    money: { total: 35000, paid: 17500, balance: 17500, reserve: 17500 },
    groups: [
      { title: "Mary Rose Package", units: "100 pax", qty: 1, total: 35000,
        contents: ["XXXL — Babyback Ribs", "2× XXXL — Blue Ternate Rice"] },
      { title: "Party Tray", units: "2 trays", qty: 2, total: 5000, contents: [] },
    ],
  };

  it("carries the catalogue id, which is the only thing the cart is rebuilt from", () => {
    expect(bookingSnapshot(found).packageId).toBe("mary-rose-100");
  });

  it("carries the money the review screen puts the new order against", () => {
    expect(bookingSnapshot(found).was).toMatchObject({ total: 35000, paid: 17500 });
  });

  it("keeps a missing payment missing, rather than calling it zero", () => {
    const snap = bookingSnapshot({ ...found, money: { total: 35000, paid: null, balance: null } });
    expect(snap.was.paid).toBeNull();
  });

  it("lists each group with the quantity on it", () => {
    const [first, second] = bookingSnapshot(found).was.lines;
    expect(first).toEqual({ title: "Mary Rose Package", units: "100 pax", total: 35000 });
    expect(second.title).toBe("2× Party Tray");
  });

  it("drops the dish lists, which would not fit and are not shown", () => {
    // Every tray of every combo, into a storage quota, to render a title.
    expect(JSON.stringify(bookingSnapshot(found))).not.toContain("Babyback");
  });

  /**
   * Most bookings in the system predate order_groups entirely. One row built
   * from the flat fields still gives the customer something to recognise.
   */
  it("falls back to the flat fields when the booking has no groups", () => {
    const snap = bookingSnapshot({ ...found, groups: null });
    expect(snap.was.lines).toEqual([
      { title: "Maryrose Package 100Pax", units: "100 pax", total: 35000 },
    ]);
  });

  it("lists nothing rather than a blank row when there is nothing to name", () => {
    const snap = bookingSnapshot({ found: true, groups: null, packageName: null, money: null });
    expect(snap.was.lines).toEqual([]);
    expect(snap.was.total).toBeNull();
  });

  it("does not fall over on a response that found nothing", () => {
    expect(() => bookingSnapshot(undefined)).not.toThrow();
    expect(bookingSnapshot(undefined).packageId).toBeNull();
  });
});
