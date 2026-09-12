import { describe, it, expect, beforeEach } from "vitest";
import {
  setOrderLines, orderLineItems, orderTotal, orderServiceType, orderSummaryRows,
  orderWantsEventDetails,
} from "./order-shell.js";
import {
  applyRushFee, RUSH_FEE, cateringBreakdown, cateringPackageTotal, grazingTotal,
} from "../domain/pricing.js";
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

  /**
   * Who gets asked about the celebration.
   *
   * The catering packages promise colour-themed table napkins, table topping
   * and chair ribbons as printed inclusions, so the colour is something the
   * kitchen needs. Nothing else on the menu does — a party-tray order for an
   * office lunch has no celebrant, and asking would be noise on the one
   * screen standing between a customer and a confirmed booking.
   */
  describe("who is asked about the occasion", () => {
    it("asks a catering basket", () => {
      for (const service of ["basic-catering", "classic-catering"]) {
        setOrderLines([line(service, { serviceKey: service, pax: 50 })]);
        expect(orderWantsEventDetails(), service).toBe(true);
      }
    });

    it("does not ask anyone else", () => {
      for (const service of [
        "party-trays", "packed-meals", "combo-trays", "grazing-table", "grazing-board",
      ]) {
        setOrderLines([line(service, { dishId: "d1" })]);
        expect(orderWantsEventDetails(), service).toBe(false);
      }
    });

    // One event, one opportunity, one set of answers. Hiding the fields
    // because trays share the basket would lose the answer for the catering
    // that needed it.
    it("asks a mixed basket that contains catering", () => {
      setOrderLines([
        line("party-trays", { dishId: "d1" }),
        line("basic-catering", { serviceKey: "basic-catering", pax: 50 }),
      ]);
      expect(orderWantsEventDetails()).toBe(true);
    });

    it("does not ask an empty order", () => {
      setOrderLines([]);
      expect(orderWantsEventDetails()).toBe(false);
      expect(orderWantsEventDetails([])).toBe(false);
      expect(orderWantsEventDetails(null)).toBe(false);
    });
  });

  /**
   * Grazing sends its service key twice, and the second one is not for the
   * lookup.
   *
   * The Table carries a 10% service charge and the Board does not, so the
   * total depends on which product it is. The server reads serviceKey to
   * find the tiers; if it does not also hand that key to grazingTotal, every
   * Table order prices 10% under the browser — and ghl-inquiry.js compares
   * the two exactly, so the customer gets a 409 on an order that was right.
   */
  describe("grazing", () => {
    const TIERS = [{ paxRange: "50–100", price: 35000 }];

    const grazingLine = (service) => line(
      service,
      { serviceKey: service, paxRange: "50–100" },
      { unitPrice: grazingTotal(TIERS, "50–100", service), qtyEditable: false },
    );

    it("tells the server which grazing product this is", () => {
      for (const service of ["grazing-table", "grazing-board"]) {
        setOrderLines([grazingLine(service)]);
        const sent = orderLineItems(false);
        expect(sent.service).toBe("grazing");
        expect(sent.serviceKey, service).toBe(service);
      }
    });

    it("prices to the same figure on both sides, table and board", () => {
      for (const service of ["grazing-table", "grazing-board"]) {
        const l = grazingLine(service);
        setOrderLines([l]);
        const sent = orderLineItems(false);
        expect(grazingTotal(TIERS, sent.paxRange, sent.serviceKey), service).toBe(l.unitPrice);
      }
    });

    // The figures that separate the two, so a silent collapse into one
    // product is caught rather than merely agreed upon.
    it("charges the table and not the board", () => {
      expect(grazingTotal(TIERS, "50–100", "grazing-table")).toBe(50500);
      expect(grazingTotal(TIERS, "50–100", "grazing-board")).toBe(35000);
    });
  });

  /**
   * Catering add-ons have to reach the server, because the server prices
   * them.
   *
   * ghl-inquiry.js compares the two totals exactly, with no tolerance, and
   * then writes the server's figure to the opportunity. A payload that
   * dropped `addons` on the way out would have the server price ₱64,250
   * against a browser quoting ₱66,750 — so every catering order with a tick
   * on it would come back a 409 the customer reads as "something went
   * wrong", on an order that was never wrong.
   */
  describe("catering add-ons", () => {
    const cateringLine = (addons) => line(
      "basic-catering",
      { serviceKey: "basic-catering", pax: 50, addons },
      { unitPrice: cateringBreakdown(950, 50, addons).total, qtyEditable: false },
    );

    it("carries the ticked add-ons to the server", () => {
      setOrderLines([cateringLine({ lechonChopping: true })]);
      expect(orderLineItems(false).addons).toEqual({ lechonChopping: true });
    });

    it("carries them inside a mixed basket too", () => {
      setOrderLines([
        line("party-trays", { dishId: "d1" }),
        cateringLine({ lechonChopping: true }),
      ]);
      const group = orderLineItems(false).groups.find((g) => g.service === "catering-package");
      expect(group.addons).toEqual({ lechonChopping: true });
    });

    // The 409 itself: price the wire payload the way the server does and
    // check it lands on the same number the cart is showing.
    it("prices to the same figure on both sides, ticked or not", () => {
      for (const addons of [{ lechonChopping: false }, { lechonChopping: true }]) {
        const l = cateringLine(addons);
        setOrderLines([l]);
        const sent = orderLineItems(false);

        const serverSays = cateringPackageTotal(950, sent.pax, sent.addons);
        expect(serverSays, JSON.stringify(addons)).toBe(l.unitPrice);
      }
    });

    // A line saved before add-ons existed still has to price, or a draft
    // left open across the deploy submits and is refused.
    it("prices a line from before add-ons existed", () => {
      setOrderLines([line(
        "basic-catering",
        { serviceKey: "basic-catering", pax: 50 },
        { unitPrice: cateringBreakdown(950, 50).total, qtyEditable: false },
      )]);
      const sent = orderLineItems(false);
      expect(cateringPackageTotal(950, sent.pax, sent.addons)).toBe(64250);
    });
  });

  /**
   * A custom service reaches the server under its own slug, carrying the
   * quantity from its payload rather than the cart's qty.
   *
   * makeLine clamps qty through QTY_MAX (99), which bounds "how many trays".
   * Sending that clamped figure would have the server verify a 150 kg order
   * as 99 kg — agreeing with a browser total that is equally short, so no
   * 409 is raised and the wrong number is written to the opportunity as
   * revenue.
   */
  it("sends a custom service's real quantity, not the cart's clamped one", () => {
    setOrderLines([
      line("lechon-belly", { slug: "lechon-belly", quantity: 150, unit: "kg" },
        { qtyEditable: false }),
    ]);
    const sent = orderLineItems(false);

    expect(sent.service).toBe("lechon-belly");
    expect(sent.quantity).toBe(150);
  });

  // The regression the dashboard team asked us to guard hardest. One
  // unpriceable group used to turn a whole basket unverified, taking the
  // price check off the trays sitting beside it.
  it("keeps the trays' own shape when a custom service shares the basket", () => {
    setOrderLines([
      line("party-trays", { dishId: "d1" }),
      line("lechon-belly", { slug: "lechon-belly", quantity: 5, unit: "kg" },
        { qtyEditable: false }),
    ]);
    const sent = orderLineItems(false);

    expect(sent.service).toBe("mixed");

    const trays = sent.groups.find((g) => g.service === "party-trays");
    expect(trays.lines).toHaveLength(1);
    expect(trays.lines[0].dishId).toBe("d1");

    const custom = sent.groups.find((g) => g.service === "lechon-belly");
    expect(custom.quantity).toBe(5);
  });

  it("sends a no-quantity custom service without inventing one", () => {
    setOrderLines([
      line("food-tab", { slug: "food-tab", quantity: null, unit: "pax" },
        { qtyEditable: false }),
    ]);
    expect(orderLineItems(false).quantity).toBeNull();
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
