import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What a payment link records about the order behind it.
 *
 * order_groups is the only place an order that spans several services
 * survives as groups. GoHighLevel flattens a booking into one service_type,
 * one pax_count and one block of dish text — see the two DECISION NEEDED
 * notes in src/app/order-shell.js — so if this column is wrong, the Order
 * Status screen has nothing to rebuild the order from.
 *
 * The other half of what is guarded here is what must NOT happen: the groups
 * must never reach order_summary, because api/../payment-upload.js renders
 * every key of that object as a labelled row on the live payment page.
 */

// Records what the code asked the database to do, and answers like PostgREST.
let INSERTED, UPDATED, EXISTING;

vi.mock("./_supabase-admin.js", () => ({
  supabaseAdmin: {
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        or: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: EXISTING, error: null }),
        insert: async (row) => { INSERTED = row; return { error: null }; },
        update: (patch) => { UPDATED = patch; return { eq: async () => ({ error: null }) }; },
      };
      return q;
    },
  },
}));

vi.mock("./_ghl-client.js", () => ({
  setOpportunityField: async () => ({ ok: true }),
}));

// _payment-link.js reads SITE_URL at module load and returns early without
// it, so this has to be set before the import, not in beforeEach.
process.env.SITE_URL = "https://example.test";
const { ensurePaymentLink, buildOrderSummary } = await import("./_payment-link.js");

const GROUPS = [
  { service: "grazing-board", kind: "Grazing", title: "Grazing Board", units: "60–100 pax", total: 58000 },
  { service: "party-trays", kind: "Party Trays", title: "Bilao", units: "2 trays", total: 3600 },
];

beforeEach(() => {
  INSERTED = null; UPDATED = null; EXISTING = null;
});

describe("a new booking", () => {
  it("records the groups it was given", async () => {
    await ensurePaymentLink({ opportunityId: "o1", contactId: "c1", orderSummary: {}, orderGroups: GROUPS });
    expect(INSERTED.order_groups).toEqual(GROUPS);
  });

  it("records null rather than an empty array when there are none", async () => {
    await ensurePaymentLink({ opportunityId: "o1", contactId: "c1", orderSummary: {}, orderGroups: [] });
    expect(INSERTED.order_groups).toBeNull();
  });

  it("still works for a caller that knows nothing about groups", async () => {
    await ensurePaymentLink({ opportunityId: "o1", contactId: "c1", orderSummary: { Total: "₱1" } });
    expect(INSERTED.order_groups).toBeNull();
    expect(INSERTED.order_summary).toEqual({ Total: "₱1" });
  });
});

describe("a customer adding to an existing booking", () => {
  beforeEach(() => { EXISTING = { token: "t1", order_groups: [GROUPS[0]] }; });

  it("keeps what was already ordered and appends the new items", async () => {
    await ensurePaymentLink({
      opportunityId: "o1", contactId: "c1", orderSummary: {},
      orderGroups: [GROUPS[1]], appendGroups: true,
    });
    expect(UPDATED.order_groups).toEqual([GROUPS[0], GROUPS[1]]);
  });

  it("replaces rather than appends when not an addition", async () => {
    await ensurePaymentLink({
      opportunityId: "o1", contactId: "c1", orderSummary: {}, orderGroups: [GROUPS[1]],
    });
    expect(UPDATED.order_groups).toEqual([GROUPS[1]]);
  });

  it("leaves a recorded structure alone when this submission carried none", async () => {
    await ensurePaymentLink({ opportunityId: "o1", contactId: "c1", orderSummary: {} });
    expect(UPDATED).not.toHaveProperty("order_groups");
  });

  it("survives a prior row that predates the column", async () => {
    EXISTING = { token: "t1", order_groups: null };
    await ensurePaymentLink({
      opportunityId: "o1", contactId: "c1", orderSummary: {},
      orderGroups: [GROUPS[1]], appendGroups: true,
    });
    expect(UPDATED.order_groups).toEqual([GROUPS[1]]);
  });
});

describe("the payment page's display contract", () => {
  it("keeps the groups out of order_summary, which renders every key as a row", async () => {
    await ensurePaymentLink({ opportunityId: "o1", contactId: "c1", orderSummary: {}, orderGroups: GROUPS });
    expect(INSERTED.order_summary).not.toHaveProperty("order_groups");
    expect(INSERTED.order_summary).not.toHaveProperty("groups");
  });

  it("builds a summary of display values only — nothing an object would render as [object Object]", () => {
    const summary = buildOrderSummary({
      contact: { firstName: "A", lastName: "B", email: "a@b.c", phone: "09", address: "x" },
      fields: { branch: "Cavite", package_name: "Basic", pax_count: "50 pax", event_date: "2026-10-11", dishes_selected: "• x" },
      monetaryValue: 64250,
    });
    for (const [key, value] of Object.entries(summary)) {
      // null is fine and typeof null is "object" — renderForm drops null
      // rows before rendering. What must not appear is a real object.
      if (value === null || value === undefined) continue;
      expect(typeof value, `${key} must render as text`).not.toBe("object");
    }
  });
});
