import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The server's own pricing, end to end.
 *
 * This file had no tests because _supabase-admin.js builds its client at
 * module load and throws without credentials. vi.mock intercepts it before
 * the real module is ever reached, which is the same trick
 * custom-service.render.test.js uses on the browser side — so the gap was
 * never really about the database.
 *
 * What is being guarded is the one thing this module exists for:
 * ghl-inquiry.js prices every order twice, compares the two figures exactly
 * with no tolerance, and writes the SERVER's answer to the opportunity as
 * the booking's value. A disagreement is a 409 the customer reads as a
 * failure on an order that was correct. An agreement on a wrong number is
 * wrong money in the financial reports with nothing to notice it.
 *
 * So these assert the server's figure against the same functions the
 * browser builds its cart from.
 */

// Stands in for PostgREST: .from().select().eq().maybeSingle(), and awaiting
// the builder itself yields { data, error } like a list query does.
let TABLES = {};
function query(table) {
  let rows = [...(TABLES[table] ?? [])];
  const q = {
    select: () => q,
    eq: (col, val) => { rows = rows.filter((r) => r[col] === val); return q; },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
  };
  return q;
}

vi.mock("./_supabase-admin.js", () => ({
  supabaseAdmin: { from: (table) => query(table) },
}));

const { serverTotal } = await import("./_price-tables.js");
const {
  grazingBreakdown, cateringBreakdown, RUSH_FEE,
} = await import("../src/domain/pricing.js");

beforeEach(() => {
  TABLES = {
    // Stored with the " pax" suffix the app strips on the way in. A mismatch
    // of one character here would find no tier and price the order at zero.
    grazing_tiers: [
      { service_id: "grazing-table", size_label: "50–100 pax",  price: 35000 },
      { service_id: "grazing-table", size_label: "100–150 pax", price: 65000 },
      { service_id: "grazing-table", size_label: "150–200 pax", price: 120000 },
      { service_id: "grazing-board", size_label: "60–100 pax",  price: 58000 },
    ],
    catering_services: [
      { id: "basic-catering",   rate_per_head: 950 },
      { id: "classic-catering", rate_per_head: 1250 },
    ],
    dish_prices: [
      { dish_id: "beef-salpicao", tray_size: "XXXL", price: 10500 },
    ],
    packages: [{ id: "family-combo-1", base_price: 10000 }],
  };
});

/**
 * The Table carries a 10% service charge and the Board does not, so the
 * total depends on which product it is. The server reads serviceKey to find
 * the tiers; if it does not also hand that key to grazingTotal, every Table
 * order prices 10% under the browser.
 */
describe("grazing, priced by the server", () => {
  it("charges the Table its service charge", async () => {
    const total = await serverTotal({
      service: "grazing", serviceKey: "grazing-table", paxRange: "50–100",
    });
    expect(total).toBe(50500);
  });

  it("leaves the Board at its flat price", async () => {
    const total = await serverTotal({
      service: "grazing", serviceKey: "grazing-board", paxRange: "60–100",
    });
    expect(total).toBe(58000);
  });

  // The 409 itself: the server's figure against the browser's, on the same
  // tiers, for every band of both products.
  it("agrees with the browser on every band", async () => {
    const cases = [
      ["grazing-table", "50–100",  35000],
      ["grazing-table", "100–150", 65000],
      ["grazing-table", "150–200", 120000],
      ["grazing-board", "60–100",  58000],
    ];
    for (const [serviceKey, paxRange, price] of cases) {
      const server  = await serverTotal({ service: "grazing", serviceKey, paxRange });
      const browser = grazingBreakdown([{ paxRange, price }], paxRange, serviceKey).total;
      expect(server, `${serviceKey} ${paxRange}`).toBe(browser);
    }
  });

  it("cannot price a band that is not in the table", async () => {
    const total = await serverTotal({
      service: "grazing", serviceKey: "grazing-table", paxRange: "200–250",
    });
    expect(total).toBe(0);
  });
});

describe("catering, priced by the server", () => {
  it("charges food, service charge and logistics", async () => {
    const total = await serverTotal({
      service: "catering-package", serviceKey: "basic-catering", pax: 50,
    });
    expect(total).toBe(64250);
  });

  it("prices the add-on the browser ticked", async () => {
    const total = await serverTotal({
      service: "catering-package", serviceKey: "basic-catering", pax: 50,
      addons: { lechonChopping: true },
    });
    expect(total).toBe(66750);
  });

  // A payload from before add-ons existed — a draft left open across the
  // deploy — still has to price, or it submits and is refused.
  it("prices a payload with no addons key at all", async () => {
    const total = await serverTotal({
      service: "catering-package", serviceKey: "basic-catering", pax: 50,
    });
    expect(total).toBe(64250);
  });

  it("agrees with the browser across packages and head counts", async () => {
    for (const [serviceKey, rate] of [["basic-catering", 950], ["classic-catering", 1250]]) {
      for (const pax of [50, 100, 120, 150, 200]) {
        for (const addons of [undefined, { lechonChopping: true }]) {
          const server  = await serverTotal({ service: "catering-package", serviceKey, pax, addons });
          const browser = cateringBreakdown(rate, pax, addons).total;
          expect(server, `${serviceKey} ${pax}pax`).toBe(browser);
        }
      }
    }
  });
});

/**
 * A basket spanning services is split back into the per-service shapes and
 * summed, so every group is priced by exactly the code that prices it alone.
 * The risk here is the group losing a field on the way through — which is
 * how a Table would lose its service charge only when ordered alongside
 * something else.
 */
describe("a mixed basket", () => {
  it("keeps each group's own extras", async () => {
    const total = await serverTotal({
      service: "mixed",
      groups: [
        { service: "grazing", serviceKey: "grazing-table", paxRange: "50–100" },
        { service: "catering-package", serviceKey: "basic-catering", pax: 50 },
      ],
    });
    expect(total).toBe(50500 + 64250);
  });

  // rush is per order, not per group. Charging it once per service is how a
  // three-service basket would quietly bill three rush fees.
  it("adds the rush fee once, not once per group", async () => {
    const total = await serverTotal({
      service: "mixed",
      rush: true,
      groups: [
        { service: "grazing", serviceKey: "grazing-table", paxRange: "50–100" },
        { service: "catering-package", serviceKey: "basic-catering", pax: 50 },
      ],
    });
    expect(total).toBe(50500 + 64250 + RUSH_FEE);
  });

  /**
   * "Cannot price" must stay null rather than becoming a number.
   *
   * ghl-inquiry.js treats null as "could not verify" and lets the order
   * through unchecked; it treats a number as authoritative and writes it to
   * the opportunity. A basket with one unpriceable group turning into a
   * smaller total would be a confident wrong answer.
   */
  it("refuses the whole basket rather than under-pricing it", async () => {
    const total = await serverTotal({
      service: "mixed",
      groups: [
        { service: "grazing", serviceKey: "grazing-table", paxRange: "50–100" },
        { service: "catering-package", serviceKey: "basic-catering" },
      ],
    });
    expect(total).toBeNull();
  });
});

describe("what it cannot price", () => {
  it("is null for an order with no service", async () => {
    expect(await serverTotal({})).toBeNull();
  });

  it("is null for a grazing order missing its band", async () => {
    expect(await serverTotal({ service: "grazing", serviceKey: "grazing-table" })).toBeNull();
  });

  // Not zero: a service nobody recognises has not been priced at nothing,
  // it has failed to be priced, and those must not collapse into one answer.
  it("is null for a service nobody has heard of", async () => {
    TABLES.meal_builder_services = [];
    expect(await serverTotal({ service: "not-a-service" })).toBeNull();
  });

  // The rush fee only ever applies on top of a real total. Adding it to a
  // null would turn "could not price" into a priced order of PHP 2,000.
  it("does not turn an unpriceable order into a rush fee", async () => {
    expect(await serverTotal({ service: "grazing", serviceKey: "x", rush: true })).toBeNull();
  });
});
