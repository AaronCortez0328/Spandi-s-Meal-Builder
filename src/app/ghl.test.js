import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pushInquiryToGHL } from "./ghl.js";

/**
 * What actually leaves the browser.
 *
 * ── The bug this exists to stop coming back ───────────────────────────────
 *
 * order-shell.js built `orderGroups` — one entry per cart line, each
 * carrying the catalogue id the line came from — and handed it to
 * submitInquiry, which spread it into the object passed here. And then this
 * file dropped it: the parameter was never destructured and the key was
 * never in the fetch body.
 *
 * Nothing failed. No error, no log, no warning. The server simply defaulted
 * `orderGroups` to null and _payment-link.js stored the default, so every
 * one of the 365 payment_links rows written since 15 September 2026 holds
 * `order_groups: NULL`. The feature was dead from the day it shipped and
 * stayed dead for three weeks, because the only thing that would have
 * noticed was a row nobody reads.
 *
 * It cost the dashboard its only reliable way to identify a package. They
 * resolve by NAME without it, against a `package_name` field GoHighLevel
 * does not hold consistently, and 37% of package lines in the last 30 days
 * came back "package not in the menu database".
 *
 * ── Why this asserts the BODY and not the arguments ───────────────────────
 *
 * Because the bug lived exactly in the gap between the two. Every caller
 * was correct; the parameter list and the body were not. A test that
 * checked what this function was given would have passed throughout.
 */
describe("the inquiry that reaches the server", () => {
  let sent;

  const body = () => JSON.parse(sent.at(-1).body);

  const order = {
    contact: { firstName: "Weng", lastName: "Nunez", email: "a@b.co" },
    opportunityName: "Weng Nunez · Cavite · Combo Trays",
    monetaryValue: 37000,
    noteBody: "…",
    opportunityFields: { service_type: "Combo Trays" },
    lineItems: [{ service: "combo-trays" }],
    orderGroups: [
      { service: "combo-trays", packageId: "special-100", title: "100 Pax XXXL Trays Package", qty: 1 },
      { service: "party-trays", packageId: null, title: "Baked Salmon", qty: 1 },
    ],
  };

  beforeEach(() => {
    sent = [];
    vi.stubGlobal("fetch", (url, init) => {
      sent.push({ url, ...init });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("carries the order groups, which is where the catalogue id lives", async () => {
    await pushInquiryToGHL(order);
    expect(body().orderGroups).toHaveLength(2);
  });

  /**
   * The id is the entire point. A group that reached the dashboard without
   * it would restore the row and change nothing: they would still be
   * resolving by a name that GoHighLevel does not hold reliably.
   */
  it("keeps the catalogue id on the group", async () => {
    await pushInquiryToGHL(order);
    expect(body().orderGroups[0].packageId).toBe("special-100");
  });

  it("sends one group per cart line, never a merged one", async () => {
    await pushInquiryToGHL(order);
    expect(body().orderGroups.map((g) => g.title))
      .toEqual(["100 Pax XXXL Trays Package", "Baked Salmon"]);
  });

  /**
   * The answer to the duplicate question is a second request carrying the
   * same order. Dropping the groups on that one would leave exactly the
   * bug above for every returning customer — the half most likely to be
   * adding to a booking the kitchen is already working from.
   */
  it("still carries them when the customer answers the duplicate question", async () => {
    await pushInquiryToGHL({ ...order, intent: "add" });
    expect(body().intent).toBe("add");
    expect(body().orderGroups).toHaveLength(2);
  });

  it("sends null rather than nothing when there are no groups", async () => {
    await pushInquiryToGHL({ ...order, orderGroups: undefined });
    expect(body().orderGroups).toBeNull();
  });

  /** The rest of the payload, so a future edit here cannot quietly shed one. */
  it("still carries everything it carried before", async () => {
    await pushInquiryToGHL(order);
    const b = body();
    for (const key of [
      "contact", "opportunityName", "monetaryValue", "noteBody",
      "contactFields", "opportunityFields", "lineItems", "company",
    ]) {
      expect(b, `${key} is missing from the request body`).toHaveProperty(key);
    }
  });
});
