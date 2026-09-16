import { describe, it, expect, beforeEach } from "vitest";
import { setOrderLines, orderLineItems } from "./order-shell.js";
import { orderGroupsPayload } from "../domain/cart.js";
import { getOrderLines } from "./order-shell.js";
import { makeLine } from "../domain/cart.js";
import { cleanAfter } from "../../api/_change-request.js";

/**
 * The two ends of the change request, against each other.
 *
 * This exists because they were silently apart. The browser was rewritten to
 * send a whole rebuilt order — `{ lineItems, groups }` — while the server was
 * still expecting `{ package_id }` from the version before the flow moved
 * into the builder. Everything on both sides passed its own tests. Every
 * change a customer sent would have come back "we could not send that", and
 * nothing would have said why.
 *
 * So this builds the payload the way submitAsChange builds it, out of real
 * cart lines, and puts it through the validator the endpoint actually calls.
 * If either side moves again, this goes red rather than production.
 */
const after = () => ({
  lineItems: orderLineItems(false),
  groups: orderGroupsPayload(getOrderLines()),
});

const combo = (over = {}) => makeLine({
  service: "combo-trays", serviceLabel: "Combo Trays", title: "Family Combo 1",
  subtitle: "15 pax", unitPrice: 10000, qty: 2,
  contents: ["XXXL — Babyback Ribs", "2× XXXL — Blue Ternate Rice"],
  payload: { comboId: "fam-c1", paxLabel: "15 pax" }, ...over,
});

const tray = () => makeLine({
  service: "party-trays", serviceLabel: "Party Trays", title: "Babyback Ribs",
  unitPrice: 2500, qty: 1,
  // The tray size is the line's VARIANT, not something in the payload —
  // orderLineItems reads it with selectedVariantId. Built the way the party
  // tray builder builds it, because a fixture that skipped the variant would
  // be testing a line the app cannot produce.
  variant: { selected: "XXXL", options: [{ id: "XXXL", label: "XXXL" }] },
  payload: { dishId: "babyback-ribs" },
});

const packed = () => makeLine({
  service: "packed-meals", serviceLabel: "Packed Meals", title: "Pack A",
  unitPrice: 180, qty: 120, qtyMax: 500,
  payload: { packTypeId: "pack-a" },
});

const grazing = () => makeLine({
  service: "grazing-table", serviceLabel: "Grazing Table", title: "Grazing Table",
  unitPrice: 120000, qty: 1,
  payload: { serviceKey: "grazing-table", paxRange: "100–150" },
});

const catering = () => makeLine({
  service: "basic-catering", serviceLabel: "Basic Catering", title: "Basic Catering",
  unitPrice: 40000, qty: 1,
  payload: { serviceKey: "basic-catering", pax: 80, addons: { lechon: true } },
});

describe("what the builder sends, against what the endpoint accepts", () => {
  beforeEach(() => setOrderLines([]));

  for (const kind of ["change", "add"]) {
    it(`accepts a one-service ${kind} built in the builder`, () => {
      setOrderLines([combo()]);
      const out = cleanAfter(kind, after());
      expect(out).not.toBeNull();
      expect(out.lineItems).toMatchObject({
        service: "combo-trays", lines: [{ packageId: "fam-c1", qty: 2 }],
      });
      expect(out.groups[0].title).toBe("Family Combo 1");
    });
  }

  it("accepts party trays, with the dish and the tray size on them", () => {
    setOrderLines([tray()]);
    const out = cleanAfter("add", after());
    expect(out.lineItems.lines[0])
      .toMatchObject({ dishId: "babyback-ribs", traySize: "XXXL", qty: 1 });
  });

  it("accepts a packed-meals quantity past the cart's tray ceiling", () => {
    setOrderLines([packed()]);
    expect(cleanAfter("add", after()).lineItems.lines[0].qty).toBe(120);
  });

  it("accepts grazing, whose tier label carries an en dash", () => {
    setOrderLines([grazing()]);
    expect(cleanAfter("change", after()).lineItems)
      .toMatchObject({ service: "grazing", serviceKey: "grazing-table", paxRange: "100–150" });
  });

  it("accepts a catering package with its add-ons ticked", () => {
    setOrderLines([catering()]);
    const out = cleanAfter("change", after()).lineItems;
    expect(out).toMatchObject({ service: "catering-package", pax: 80 });
    expect(out.addons).toEqual({ lechon: true });
  });

  it("accepts a basket spanning every service at once", () => {
    setOrderLines([combo(), tray(), packed(), grazing(), catering()]);
    const out = cleanAfter("change", after());
    expect(out).not.toBeNull();
    expect(out.lineItems.service).toBe("mixed");
    expect(out.lineItems.groups).toHaveLength(5);
    expect(out.groups).toHaveLength(5);
  });

  it("carries the catalogue id through, so the queue knows which package", () => {
    setOrderLines([combo()]);
    expect(cleanAfter("change", after()).groups[0].packageId).toBe("fam-c1");
  });

  /**
   * The invariant the dashboard's agreement rests on. The cart knows every
   * price on this screen and none of them may leave the browser.
   */
  it("lets no price out of the browser, from any service", () => {
    setOrderLines([combo(), tray(), packed(), grazing(), catering()]);
    const json = JSON.stringify(cleanAfter("change", after()));
    for (const price of ["10000", "2500", "180", "120000", "40000"]) {
      expect(json, price).not.toContain(price);
    }
  });

  it("refuses an empty cart rather than filing an empty change", () => {
    setOrderLines([]);
    expect(cleanAfter("change", after())).toBeNull();
  });
});
