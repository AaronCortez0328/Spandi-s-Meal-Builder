import { describe, it, expect, beforeEach } from "vitest";
import {
  setOrderLines, orderLineItems, orderTotal, orderServiceType, orderSummaryRows,
} from "./order-shell.js";
import { applyRushFee, RUSH_FEE } from "../domain/pricing.js";
import { makeLine } from "../domain/cart.js";

/**
 * The client and the server have to agree on what a service is called.
 *
 * The browser works in the names the builders use -- "grazing-table",
 * "basic-catering" -- and the server prices by a shorter set: "grazing",
 * "catering-package". orderLineItems() translates between them, and if that
 * table ever falls behind a new service the server answers "cannot price"
 * for the whole order rather than "wrong price". That reads as a network
 * problem to the customer, and it fails quietly.
 *
 * These are the exact case labels in api/_price-tables.js. If one side
 * changes, this goes red.
 */
const SERVER_KNOWS = [
  "party-trays", "packed-meals", "grazing", "catering-package",
  "combo-trays", "mixed",
];

const line = (service, payload, extra = {}) => makeLine({
  service,
  serviceLabel: service,
  title: service,
  unitPrice: 1000,
  payload,
  ...extra,
});

describe("what the browser asks the server to price", () => {
  beforeEach(() => setOrderLines([]));

  it("names every service in a word the server switches on", () => {
    const cases = [
      line("party-trays", { dishId: "d1" }),
      line("packed-meals", { packTypeId: "t1" }),
      line("combo-trays", { comboId: "c1" }),
      line("grazing-table", { serviceKey: "grazing-table", paxRange: "50-100" }),
      line("grazing-board", { serviceKey: "grazing-board", paxRange: "15-25" }),
      line("basic-catering", { serviceKey: "basic-catering", pax: 50 }),
      line("classic-catering", { serviceKey: "classic-catering", pax: 50 }),
    ];

    for (const l of cases) {
      setOrderLines([l]);
      const sent = orderLineItems(false);
      expect(SERVER_KNOWS, `${l.service} -> ${sent.service}`).toContain(sent.service);
    }
  });

  it("sends a single service in that service's own shape, not wrapped", () => {
    setOrderLines([line("grazing-table", { serviceKey: "grazing-table", paxRange: "50-100" })]);
    const sent = orderLineItems(false);
    expect(sent.service).toBe("grazing");
    expect(sent.paxRange).toBe("50-100");
    expect(sent.groups).toBeUndefined();
  });

  it("wraps two services as mixed, with each group still named for the server", () => {
    setOrderLines([
      line("party-trays", { dishId: "d1" }),
      line("basic-catering", { serviceKey: "basic-catering", pax: 50 }),
    ]);
    const sent = orderLineItems(false);
    expect(sent.service).toBe("mixed");
    expect(sent.groups.map((g) => g.service)).toEqual(["party-trays", "catering-package"]);
    for (const g of sent.groups) expect(SERVER_KNOWS).toContain(g.service);
  });

  // rush is per order. Charging it once per group would bill a mixed order
  // the fee twice, which is real money.
  it("carries the rush flag once, on the order", () => {
    setOrderLines([
      line("party-trays", { dishId: "d1" }),
      line("packed-meals", { packTypeId: "t1" }),
    ]);
    const sent = orderLineItems(true);
    expect(sent.rush).toBe(true);
    for (const g of sent.groups) expect(g.rush).toBeUndefined();
  });
});

/**
 * The fields the GHL payload is built from.
 *
 * submitOrder() reads the form and cannot run without a DOM, but everything
 * it puts in the payload comes from these, and they are what would go wrong
 * quietly: a total that is right on screen and wrong in the CRM is money.
 */
describe("what goes to GoHighLevel", () => {
  beforeEach(() => setOrderLines([]));

  it("reports a total the server can arrive at independently", () => {
    setOrderLines([
      line("party-trays", { dishId: "d1" }, { unitPrice: 1500, qty: 2 }),
      line("packed-meals", { packTypeId: "t1" }, { unitPrice: 180, qty: 50 }),
    ]);
    expect(orderTotal()).toBe(1500 * 2 + 180 * 50);
  });

  it("adds the rush fee once, not once per service", () => {
    setOrderLines([
      line("party-trays", { dishId: "d1" }, { unitPrice: 1000, qty: 1 }),
      line("packed-meals", { packTypeId: "t1" }, { unitPrice: 1000, qty: 1 }),
    ]);
    expect(applyRushFee(orderTotal(), true)).toBe(2000 + RUSH_FEE);
  });

  // GHL holds one service_type. A mixed order has to say something the
  // field already accepts, and it reports whichever service holds the most.
  it("names a single service_type for a mixed order", () => {
    setOrderLines([
      line("party-trays", { dishId: "d1" }, { serviceLabel: "Party Trays", unitPrice: 500, qty: 1 }),
      line("grazing-table", { serviceKey: "grazing-table", paxRange: "50-100" },
        { serviceLabel: "Grazing Table", unitPrice: 35000, qty: 1 }),
    ]);
    expect(orderServiceType()).toBe("Grazing Table");
  });

  it("prices every line in the summary the CRM note is built from", () => {
    setOrderLines([line("party-trays", { dishId: "d1" }, { unitPrice: 1500, qty: 2 })]);
    const rows = orderSummaryRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("PHP 3,000");
    expect(rows[0].label).toContain("2×");
  });

  // An empty order must not produce a payload at all -- a zero-value
  // opportunity in the CRM is worse than no opportunity.
  it("has nothing to send when the order is empty", () => {
    expect(orderTotal()).toBe(0);
    expect(orderSummaryRows()).toEqual([]);
  });
});

describe("the summary on the last screen", () => {
  beforeEach(() => setOrderLines([]));

  // The cart offered "Show 6 items" and the checkout dropped them, so the
  // screen where the customer commits money showed less than the one before.
  it("carries what is inside each line, not just its price", () => {
    setOrderLines([line("combo-trays", { comboId: "c1" }, {
      title: "Feast Combo 2",
      subtitle: "25 pax",
      unitPrice: 12000,
      contents: ["Beef Caldereta", "Chicken Curry", "Pancit"],
    })]);
    const [row] = orderSummaryRows();
    expect(row.contents).toHaveLength(3);
    expect(row.contents).toContain("Beef Caldereta");
    expect(row.subtitle).toBe("25 pax");
  });

  it("gives a line with nothing inside it an empty list, never undefined", () => {
    setOrderLines([line("party-trays", { dishId: "d1" }, { unitPrice: 1500 })]);
    expect(orderSummaryRows()[0].contents).toEqual([]);
  });
});
