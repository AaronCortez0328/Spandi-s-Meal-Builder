import { describe, it, expect } from "vitest";
import {
  groupHtml, orderHtml, timelineHtml, resultHtml,
  outcomeHtml, NOT_BOTH, UNREACHABLE,
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

  it("shows the half, what has arrived, and what is left", () => {
    const html = withMoney();
    expect(html).toContain("Reserve with 50%");
    expect(html).toContain("32,125");
    expect(html).toContain("Balance due");
    expect(html).toContain("64,250");
  });

  it("offers the customer their own link to settle it", () => {
    expect(withMoney()).toContain("Pay now");
    expect(withMoney()).toContain("https://example.test/?pay=tok");
  });

  it("drops the button rather than offering a dead one", () => {
    const html = withMoney({ payUrl: null });
    expect(html).toContain("Balance due");
    expect(html).not.toContain("Pay now");
  });

  it("says a missing payment is unrecorded, never that nothing was paid", () => {
    // The figure is typed by hand in GoHighLevel. Empty means nobody wrote it
    // down, not that a customer who has already reserved still owes it all.
    const html = withMoney({ money: { total: 64250, reserve: 32125, paid: null, balance: null } });
    expect(html).toContain("Not recorded yet");
    expect(html).toContain("Order total");
    expect(html).not.toContain("Balance due");
  });

  it("shows no panel at all for a booking with no figure", () => {
    const html = withMoney({ money: null, payUrl: null });
    // Matched on the exact class — "os-payhint" contains "os-pay", so a
    // substring check here passes whatever the code does.
    expect(html).not.toContain('class="os-pay"');
    expect(html).not.toContain("Reserve with 50%");
    expect(html).toMatch(/booking email/i);
  });

  it("drops the pointer to the email once the figures are on screen", () => {
    expect(withMoney()).not.toMatch(/booking email/i);
  });

  it("escapes a payment link rather than trusting it into an href", () => {
    const html = withMoney({ payUrl: 'https://x/?pay=t"><script>bad()</script>' });
    expect(html).not.toContain("<script>");
  });
});
