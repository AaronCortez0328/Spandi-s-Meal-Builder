import { describe, it, expect, beforeEach } from "vitest";
import { setOrderLines, orderLineItems } from "./order-shell.js";
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
