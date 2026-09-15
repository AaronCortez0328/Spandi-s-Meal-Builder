import { describe, it, expect } from "vitest";
import { groupHtml, orderHtml, timelineHtml, resultHtml } from "./order-status.js";
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

  it("shows no total, no balance, and no reserve figure", () => {
    const html = resultHtml(data());
    for (const word of ["Balance", "Total", "Reserve", "Paid so far"]) {
      expect(html, word).not.toContain(word);
    }
  });

  it("sends the customer to the stronger credential for money", () => {
    expect(resultHtml(data())).toMatch(/booking email/i);
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
