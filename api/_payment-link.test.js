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
const { ensurePaymentLink, buildOrderSummary, boundOrderGroups } = await import("./_payment-link.js");

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

  /**
   * Bookings made before the rename still hold "Pickup" and "Delivery" in
   * GoHighLevel, and this page reads them back. An old pickup labelled
   * "Ready for the driver" tells the customer a driver is coming who is not.
   */
  it("labels the ready time by method, for old bookings and new", () => {
    const label = (receive_method) => Object.keys(buildOrderSummary({
      fields: { receive_method, delivery__pickup_time: "16:00" },
    })).find((k) => k.startsWith("Ready"));

    expect(label("Client pickup")).toBe("Ready for collection");
    expect(label("Pickup")).toBe("Ready for collection");
    expect(label("Assisted delivery")).toBe("Ready for the driver");
    expect(label("Delivery")).toBe("Ready for the driver");
  });
});

/**
 * What the browser is allowed to put in the database.
 *
 * ── Why this is a guard and not a formality ───────────────────────────────
 *
 * order_groups arrives in the body of /api/ghl-inquiry, and that endpoint
 * cannot be authenticated — the customer placing an order is anonymous, so
 * there is nobody to authenticate. Origin and the per-IP counter are the
 * only things in front of it, and neither inspects a payload.
 *
 * It was harmless right up until it worked. src/app/ghl.js never forwarded
 * the field, so NULL was written every time for three weeks and nothing
 * unvalidated ever reached the column. Fixing the drop is what makes this
 * reachable, so the bound ships in the same change.
 *
 * The numbers are imported from _change-request.js rather than retyped:
 * they are a promise made to the dashboard in writing, and two copies is
 * how one of them quietly stops being true.
 */
describe("bounding what reaches order_groups", () => {
  const group = (over = {}) => ({
    service: "combo-trays", packageId: "mary-rose-100", kind: "Combo Trays",
    title: "Mary Rose Package", subtitle: "100 pax", units: "100 pax",
    qty: 1, contents: ["2× XXXL — Java Rice"], total: 35000, priceNote: null, ...over,
  });

  it("keeps a real group exactly as the builder wrote it", () => {
    expect(boundOrderGroups([group()])[0]).toEqual({
      service: "combo-trays", packageId: "mary-rose-100", kind: "Combo Trays",
      title: "Mary Rose Package", subtitle: "100 pax", units: "100 pax",
      qty: 1, contents: ["2× XXXL — Java Rice"], total: 35000,
    });
  });

  /**
   * The difference from cleanGroups() in _change-request.js, which drops
   * money on purpose. Order Status renders both of these straight out of
   * the snapshot (src/app/order-status.js:38-41), so dropping them here
   * would show a customer their own order with no prices on it.
   */
  it("keeps the money, because the customer's own order screen reads it", () => {
    expect(boundOrderGroups([group()])[0].total).toBe(35000);
    expect(boundOrderGroups([group({ total: null, priceNote: "From PHP 8,000" })])[0].priceNote)
      .toBe("From PHP 8,000");
  });

  it("reads a note in preference to a figure, as the screen does", () => {
    const g = boundOrderGroups([group({ total: 999, priceNote: "Quoted separately" })])[0];
    expect(g.priceNote).toBe("Quoted separately");
    expect(g).not.toHaveProperty("total");
  });

  it("refuses a total that is not money", () => {
    for (const bad of [-1, Number.NaN, Infinity, 1e12, "lots", {}, []]) {
      expect(boundOrderGroups([group({ total: bad })])[0], String(bad)).not.toHaveProperty("total");
    }
  });

  it("caps the number of groups", () => {
    expect(boundOrderGroups(Array.from({ length: 500 }, () => group()))).toHaveLength(12);
  });

  it("caps the content lines on one group", () => {
    const contents = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    expect(boundOrderGroups([group({ contents })])[0].contents).toHaveLength(40);
  });

  it("caps the length of every string it keeps", () => {
    const long = "x".repeat(10_000);
    const g = boundOrderGroups([group({ title: long, subtitle: long, kind: long, units: long, contents: [long] })])[0];
    expect(g.title).toHaveLength(200);
    expect(g.subtitle).toHaveLength(200);
    expect(g.kind).toHaveLength(60);
    expect(g.units).toHaveLength(60);
    expect(g.contents[0]).toHaveLength(200);
  });

  it("drops an id that is not one", () => {
    for (const bad of ["../../etc", "DROP TABLE", "Mary Rose", 42, null, { id: "x" }]) {
      const g = boundOrderGroups([group({ service: bad, packageId: bad })])[0];
      expect(g, String(bad)).not.toHaveProperty("service");
      expect(g, String(bad)).not.toHaveProperty("packageId");
    }
  });

  it("drops a quantity that is not a whole count in range", () => {
    for (const bad of [0, -5, 1.5, 10_000, "2", Number.NaN, null]) {
      expect(boundOrderGroups([group({ qty: bad })])[0], String(bad)).not.toHaveProperty("qty");
    }
    expect(boundOrderGroups([group({ qty: 9999 })])[0].qty).toBe(9999);
  });

  /** A group naming nothing renders as an empty row on the customer's screen. */
  it("drops a group with no title", () => {
    expect(boundOrderGroups([group({ title: "" }), group({ title: null }), group()])).toHaveLength(1);
  });

  it("keeps nothing it was not given", () => {
    const g = boundOrderGroups([{ title: "X", evil: "payload", __proto__: { bad: 1 }, nested: { a: 1 } }])[0];
    expect(g).toEqual({ title: "X" });
  });

  it("answers with an array whatever it is handed", () => {
    for (const junk of [null, undefined, "groups", 42, {}, [null], [undefined], [[]]]) {
      expect(Array.isArray(boundOrderGroups(junk)), String(junk)).toBe(true);
    }
  });
});

/**
 * An addition appends to the snapshot rather than replacing it, so the cap
 * has to hold over the JOIN. Each half can be inside the limit on its own
 * while the two together are not — and a booking can be added to repeatedly.
 */
describe("appending to a booking that already has a snapshot", () => {
  const g = (title) => ({ service: "party-trays", title, qty: 1, total: 100 });

  it("caps the combined snapshot, not just each half", async () => {
    EXISTING = { token: "t1", order_groups: Array.from({ length: 10 }, (_, i) => g(`old ${i}`)) };
    await ensurePaymentLink({
      opportunityId: "o1", contactId: "c1", orderSummary: {},
      orderGroups: Array.from({ length: 10 }, (_, i) => g(`new ${i}`)),
      appendGroups: true,
    });
    expect(UPDATED.order_groups).toHaveLength(12);
    // The older half is kept — the kitchen is already working from it.
    expect(UPDATED.order_groups[0].title).toBe("old 0");
  });

  it("replaces rather than appends when it is not an addition", async () => {
    EXISTING = { token: "t1", order_groups: [g("old")] };
    await ensurePaymentLink({
      opportunityId: "o1", contactId: "c1", orderSummary: {},
      orderGroups: [g("new")], appendGroups: false,
    });
    expect(UPDATED.order_groups.map((x) => x.title)).toEqual(["new"]);
  });

  /** A resend carrying nothing must not blank a snapshot already recorded. */
  it("leaves an existing snapshot alone when this submission carried none", async () => {
    EXISTING = { token: "t1", order_groups: [g("old")] };
    await ensurePaymentLink({ opportunityId: "o1", contactId: "c1", orderSummary: {}, orderGroups: null });
    expect(UPDATED).not.toHaveProperty("order_groups");
  });
});

/**
 * The bound has to be APPLIED, not merely to exist.
 *
 * Found by breaking it: removing boundOrderGroups from the insert and
 * writing req.body straight to the column failed no test at all, because
 * every other fixture here is already clean enough to survive bounding
 * unchanged. A guard nothing exercises is a guard nobody will miss.
 */
describe("the bound is applied on the way into the database", () => {
  const nasty = () => Array.from({ length: 400 }, (_, i) => ({
    service: "../../etc/passwd",
    packageId: "DROP TABLE packages",
    title: `${"x".repeat(5000)} ${i}`,
    qty: "9999999",
    total: [],
    contents: Array.from({ length: 900 }, () => "y".repeat(5000)),
  }));

  it("stores a bounded snapshot on a new booking", async () => {
    await ensurePaymentLink({
      opportunityId: "o1", contactId: "c1", orderSummary: {}, orderGroups: nasty(),
    });
    const rows = INSERTED.order_groups;
    expect(rows).toHaveLength(12);
    for (const r of rows) {
      expect(r.title.length).toBeLessThanOrEqual(200);
      expect(r.contents.length).toBeLessThanOrEqual(40);
      expect(r.contents[0].length).toBeLessThanOrEqual(200);
      expect(r).not.toHaveProperty("service");
      expect(r).not.toHaveProperty("packageId");
      expect(r).not.toHaveProperty("qty");
      expect(r).not.toHaveProperty("total");
    }
  });

  it("stores a bounded snapshot when it updates one instead", async () => {
    EXISTING = { token: "t1", order_groups: [] };
    await ensurePaymentLink({
      opportunityId: "o1", contactId: "c1", orderSummary: {}, orderGroups: nasty(),
    });
    expect(UPDATED.order_groups).toHaveLength(12);
    expect(UPDATED.order_groups[0].title.length).toBeLessThanOrEqual(200);
  });
});
