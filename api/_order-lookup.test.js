import { describe, it, expect } from "vitest";
import {
  normalizePhone, looksLikeEmail, identifierMatches,
  withinLookupWindow, publicOrderView, notFound, LOOKUP_WINDOW_DAYS,
} from "./_order-lookup.js";
import { orderStep, orderTimeline } from "../src/domain/order-stages.js";

/**
 * This is the only unauthenticated read of a real booking in the system.
 * Most of what follows is about what a stranger who guessed a date does NOT
 * get, which is the half that has no visible symptom when it goes wrong.
 */

describe("matching the customer, not something like them", () => {
  it("accepts the same number written any of the ways people write it", () => {
    const stored = { phone: "+63 917 123 4567" };
    for (const typed of ["09171234567", "+639171234567", "0917 123 4567", "917-123-4567"]) {
      expect(identifierMatches(stored, typed), typed).toBe(true);
    }
  });

  it("refuses a number that merely ends similarly", () => {
    expect(identifierMatches({ phone: "09171234567" }, "09171234568")).toBe(false);
  });

  it("refuses a fragment of the real number", () => {
    expect(identifierMatches({ phone: "09171234567" }, "1234567")).toBe(false);
  });

  it("matches an email whatever case it was typed in", () => {
    expect(identifierMatches({ email: "Maria@Example.com" }, "maria@example.COM")).toBe(true);
  });

  it("refuses a partial email, which the fuzzy search WILL return", () => {
    // GoHighLevel's ?query= matches on fragments across fields. The search
    // narrows; this is what decides.
    expect(identifierMatches({ email: "maria@example.com" }, "maria")).toBe(false);
  });

  it("refuses an email that is merely a substring of the real one", () => {
    // This is the case a `.includes()` comparison would wrongly accept, and
    // the one above does NOT cover it: "maria" is not email-shaped, so it
    // falls to the phone branch and returns false for the wrong reason.
    // "aria@example.com" IS email-shaped and IS a substring.
    expect(identifierMatches({ email: "maria@example.com" }, "aria@example.com")).toBe(false);
  });

  it("refuses an email the real one is a substring of", () => {
    expect(identifierMatches({ email: "aria@example.com" }, "maria@example.com")).toBe(false);
  });

  it("never matches a contact missing the field that was typed", () => {
    expect(identifierMatches({ phone: "09171234567" }, "a@b.co")).toBe(false);
    expect(identifierMatches({ email: "a@b.co" }, "09171234567")).toBe(false);
    expect(identifierMatches({}, "a@b.co")).toBe(false);
  });

  it("never matches on nothing", () => {
    for (const typed of ["", "   ", null, undefined]) {
      expect(identifierMatches({ email: "a@b.co", phone: "09171234567" }, typed)).toBe(false);
    }
  });

  it("does not treat a contact with no phone as matching an unparseable input", () => {
    expect(identifierMatches({ phone: null }, "----")).toBe(false);
  });

  it("knows an email from a phone number", () => {
    expect(looksLikeEmail("a@b.co")).toBe(true);
    expect(looksLikeEmail("09171234567")).toBe(false);
    expect(normalizePhone("0917 123 4567")).toBe("9171234567");
    expect(normalizePhone("123")).toBe("");
  });
});

describe("how far back an event stays lookupable", () => {
  const today = "2026-09-15";

  it("allows a future event", () => {
    expect(withinLookupWindow("2026-10-11", today)).toBe(true);
  });

  it("allows today", () => {
    expect(withinLookupWindow(today, today)).toBe(true);
  });

  it("allows an event just inside the window", () => {
    expect(withinLookupWindow("2026-08-16", today)).toBe(true);
  });

  it("refuses one just outside it", () => {
    expect(withinLookupWindow("2026-08-15", today)).toBe(false);
  });

  it("compares dates as written, so an event does not drop a day early in Manila", () => {
    // new Date("2026-08-16") is midnight UTC, which is the evening of the
    // 15th in Manila — enough to expire an event a day early for everyone.
    expect(withinLookupWindow("2026-08-16", "2026-09-15", 30)).toBe(true);
  });

  it("refuses anything that is not a plain date", () => {
    for (const bad of ["", "tomorrow", "11/10/2026", "2026-10-11T00:00:00Z", null, undefined]) {
      expect(withinLookupWindow(bad, today), String(bad)).toBe(false);
    }
  });

  it("keeps the window at thirty days", () => {
    expect(LOOKUP_WINDOW_DAYS).toBe(30);
  });
});

describe("what leaves the server", () => {
  const FIELDS = {
    branch: "Cavite", package_name: "Basic Catering", pax_count: "50 pax",
    event_date: "2026-10-11", event_time: "10:00", receive_method: "Delivery",
    delivery__pickup_time: "10:00", dishes_selected: "• x",
    // Everything below is on the opportunity and must not come back out.
    delivery_address: "24 Somewhere St", payment_link: "https://x/?pay=tok",
    amount_paid: "32125", payment_status: "Half Paid",
  };
  const built = () => {
    const r = orderStep({ pipelineStage: "Confirmed", kitchenStage: "procured" });
    return publicOrderView({
      step: r.step, offTimeline: r.offTimeline,
      timeline: orderTimeline({ pipelineStage: "Confirmed", kitchenStage: "procured" }),
      fields: FIELDS,
      groups: [{ kind: "Catering", title: "Basic", total: 64250 }],
    });
  };

  it("carries no money of any kind", () => {
    const json = JSON.stringify(built());
    for (const leak of ["amount_paid", "32125", "payment_status", "Half Paid"]) {
      expect(json, leak).not.toContain(leak);
    }
  });

  it("carries no payment link — that token is a stronger credential than this page", () => {
    expect(JSON.stringify(built())).not.toContain("payment_link");
    expect(JSON.stringify(built())).not.toContain("?pay=");
  });

  it("carries no address, name, phone or email", () => {
    const json = JSON.stringify(built());
    for (const leak of ["delivery_address", "Somewhere St", "firstName", "email", "phone"]) {
      expect(json, leak).not.toContain(leak);
    }
  });

  it("does not echo the event date back, which would only confirm a guess", () => {
    expect(JSON.stringify(built())).not.toContain("2026-10-11");
  });

  it("returns the whole timeline, so a customer sees what is still to come", () => {
    expect(built().timeline).toHaveLength(6);
    expect(built().timeline.filter((s) => s.current)).toHaveLength(1);
  });

  it("says which step, in the caterer's words", () => {
    expect(built().step).toBe("preparing");
    expect(built().stepLabel).toBe("Preparing");
  });

  it("reports no groups rather than an empty list for an order placed before the column existed", () => {
    const r = orderStep({ pipelineStage: "Confirmed" });
    expect(publicOrderView({ step: r.step, timeline: [], fields: FIELDS, groups: [] }).groups).toBeNull();
    expect(publicOrderView({ step: r.step, timeline: [], fields: FIELDS, groups: null }).groups).toBeNull();
  });

  it("carries the flat description too, so that fallback has something to show", () => {
    expect(built().packageName).toBe("Basic Catering");
    expect(built().paxCount).toBe("50 pax");
    expect(built().dishes).toBe("• x");
  });
});

describe("the one answer for everything that is not an order", () => {
  it("says the same thing however the lookup failed", () => {
    const a = notFound(), b = notFound();
    expect(a).toEqual(b);
    expect(a.found).toBe(false);
  });

  it("names neither the email nor the date, so nothing says which half was wrong", () => {
    const json = JSON.stringify(notFound()).toLowerCase();
    expect(json).not.toContain("wrong date");
    expect(json).not.toContain("no such");
    expect(json).not.toContain("expired");
  });

  it("tells the customer what to do next rather than only that it failed", () => {
    expect(notFound().message).toMatch(/message us/i);
  });
});
