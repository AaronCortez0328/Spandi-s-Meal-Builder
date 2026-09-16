import { describe, it, expect } from "vitest";
import {
  normalizePhone, looksLikeEmail, identifierMatches,
  withinLookupWindow, publicOrderView, notFound, LOOKUP_WINDOW_DAYS, searchCandidates,
  orderMoney,
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

  it("carries money only through the shape built for it", () => {
    // Money is shown by the client's decision, taken against our advice and
    // the dashboard team's. What is not negotiable is HOW: through `money`,
    // built by orderMoney, never by spreading the opportunity's own fields
    // into the response where the next one added would ride along unnoticed.
    const json = JSON.stringify(built());
    for (const raw of ["amount_paid", "payment_link", "monetaryValue"]) {
      expect(json, raw).not.toContain(raw);
    }
  });

  it("carries no money when none was worked out", () => {
    expect(built().money).toBeNull();
    expect(built().payUrl).toBeNull();
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

describe("searching GoHighLevel for a phone number", () => {
  /**
   * Verified against the live API: a contact stored as +639617178022 is found
   * by "+639617178022" and by NOTHING else. "09617178022", "0961 717 8022",
   * "639617178022" and "9617178022" all return zero results.
   *
   * Every Filipino writes their own number as 0917..., so without this the
   * phone path would have failed every real lookup while reporting,
   * indistinguishably, that the booking does not exist.
   */
  it("tries the form GoHighLevel actually stores, first", () => {
    expect(searchCandidates("09617178022")[0]).toBe("+639617178022");
  });

  it("does the same for a number typed with spaces", () => {
    expect(searchCandidates("0961 717 8022")[0]).toBe("+639617178022");
  });

  it("does the same for one already typed in international form", () => {
    expect(searchCandidates("+63 961 717 8022")[0]).toBe("+639617178022");
  });

  it("keeps the typed form as a fallback, for a contact entered by hand", () => {
    expect(searchCandidates("09617178022")).toContain("09617178022");
  });

  it("does not waste a request on a duplicate form", () => {
    const out = searchCandidates("+639617178022");
    expect(new Set(out).size).toBe(out.length);
  });

  it("searches an email exactly once, and as typed", () => {
    expect(searchCandidates("maria@example.com")).toEqual(["maria@example.com"]);
  });

  it("gives up rather than guessing at something unparseable", () => {
    expect(searchCandidates("")).toEqual([]);
    expect(searchCandidates("   ")).toEqual([]);
    expect(searchCandidates("hello")).toEqual(["hello"]);
  });
});

describe("what a booking is worth, and what is still owed", () => {
  it("works out the half and the remainder", () => {
    const m = orderMoney({ monetaryValue: 64250, amountPaid: "32125" });
    expect(m.total).toBe(64250);
    expect(m.reserve).toBe(32125);
    expect(m.paid).toBe(32125);
    expect(m.balance).toBe(32125);
  });

  it("rounds the reserve to whole pesos on an odd total", () => {
    // Same reasoning as every percentage in src/domain/pricing.js: a figure
    // a customer is asked to transfer cannot carry float dust.
    const m = orderMoney({ monetaryValue: 64251, amountPaid: "0" });
    expect(Number.isInteger(m.reserve)).toBe(true);
    expect(m.reserve).toBe(32126);
  });

  it("reads nothing paid as nothing paid, when that is what was recorded", () => {
    const m = orderMoney({ monetaryValue: 64250, amountPaid: "0" });
    expect(m.paid).toBe(0);
    expect(m.balance).toBe(64250);
  });

  it("reports an unrecorded payment as unknown, NOT as zero", () => {
    // Number(null) is 0 rather than NaN. Coercing an unset field would tell
    // a customer who has already reserved that they owe the whole amount.
    for (const empty of [null, undefined, "", "   "]) {
      const m = orderMoney({ monetaryValue: 64250, amountPaid: empty });
      expect(m.paid, String(empty)).toBeNull();
      expect(m.balance, String(empty)).toBeNull();
    }
  });

  it("reads a figure typed with a peso sign and commas", () => {
    expect(orderMoney({ monetaryValue: 64250, amountPaid: "PHP 32,125" }).paid).toBe(32125);
  });

  it("never reports a negative balance when somebody overpaid", () => {
    expect(orderMoney({ monetaryValue: 1000, amountPaid: "1500" }).balance).toBe(0);
  });

  it("shows no panel at all for a booking with no figure", () => {
    for (const bad of [null, undefined, 0, -5, "abc"]) {
      expect(orderMoney({ monetaryValue: bad, amountPaid: "0" }), String(bad)).toBeNull();
    }
  });
});

describe("the payment link the page hands out", () => {
  const build = (over) => publicOrderView({
    step: { id: "confirmed", label: "Confirmed" }, timeline: [], fields: {},
    money: { total: 64250, reserve: 32125, paid: 0, balance: 64250 },
    ...over,
  });

  it("carries the customer's own link when there is one", () => {
    expect(build({ payUrl: "https://x/?pay=tok" }).payUrl).toBe("https://x/?pay=tok");
  });

  it("reports none rather than an empty string when there is not", () => {
    expect(build({ payUrl: "" }).payUrl).toBeNull();
    expect(build({}).payUrl).toBeNull();
  });

  it("still refuses to carry the address, phone or email alongside it", () => {
    const json = JSON.stringify(publicOrderView({
      step: { id: "confirmed", label: "Confirmed" }, timeline: [],
      fields: { delivery_address: "24 Somewhere St", branch: "Cavite" },
      money: { total: 1, reserve: 1, paid: 0, balance: 1 },
      payUrl: "https://x/?pay=tok",
    }));
    expect(json).not.toContain("Somewhere St");
    expect(json).not.toContain("delivery_address");
  });
});

describe("what a customer is told about changing the booking", () => {
  const view = (over) => publicOrderView({
    step: { id: "confirmed", label: "Confirmed" }, timeline: [],
    fields: { event_date: "2026-10-11", branch: "Cavite" },
    ...over,
  });

  it("says whether each kind is open, worked out now", () => {
    const out = view({
      windows: {
        change: { allowed: true, closesOn: "2026-10-04" },
        add:    { allowed: false, closesOn: "2026-10-08" },
      },
    });
    expect(out.canChange).toBe(true);
    expect(out.canAdd).toBe(false);
    expect(out.changeClosesOn).toBe("2026-10-04");
  });

  it("says closed when it knows nothing, never open", () => {
    // Absent windows must not read as permission. The safe default on a
    // question about whether something may still be changed is no.
    const out = view({});
    expect(out.canChange).toBe(false);
    expect(out.canAdd).toBe(false);
  });

  it("carries their own request back so they are not left wondering", () => {
    const out = view({
      request: { kind: "change", status: "pending", after: { package_id: "jeanette-100" }, decided_note: null },
    });
    expect(out.request.kind).toBe("change");
    expect(out.request.status).toBe("pending");
  });

  it("carries a decline note, because a reason is the point of declining", () => {
    const out = view({
      request: { kind: "change", status: "declined", after: {}, decided_note: "Kitchen is full that day." },
    });
    expect(out.request.note).toBe("Kitchen is full that day.");
  });

  it("never carries who decided it — that is the dashboard's business", () => {
    const json = JSON.stringify(view({
      request: {
        kind: "change", status: "approved", after: {},
        decided_by: "uuid-here", decided_by_name: "Faithy", decided_at: "2026-09-16",
      },
    }));
    expect(json).not.toContain("uuid-here");
    expect(json).not.toContain("Faithy");
    expect(json).not.toContain("decided_by");
  });

  it("reports no sizes rather than a broken list when the catalogue failed", () => {
    // Empty means the screen says changing is unavailable. A half-read
    // catalogue offering a size that does not exist is far worse.
    expect(view({ sizes: null }).sizes).toEqual([]);
    expect(view({}).sizes).toEqual([]);
  });

  it("still does not echo the event date back, however much else it carries", () => {
    const json = JSON.stringify(view({
      windows: { change: { allowed: true, closesOn: "2026-10-04" } },
      sizes: [{ packageId: "jeanette-100", paxLabel: "100 pax", price: 35000 }],
    }));
    expect(json).not.toContain("2026-10-11");
  });
});
