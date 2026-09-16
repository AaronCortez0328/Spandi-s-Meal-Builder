import { describe, it, expect } from "vitest";
import {
  cleanAfter, buildBefore, validateRequest, reasonMessage, KINDS, packageFromDishText,
  singlePackageId,
} from "./_change-request.js";
import { todayInManila } from "../src/domain/availability.js";

/** A date that many days from today in Manila, which is what the rule uses. */
const inDays = (n) => {
  const d = new Date(`${todayInManila()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * What a request may contain before it earns a row.
 *
 * The shape changed when the change flow moved into the builder. A customer
 * no longer picks a package from a short list — they rebuild their order, and
 * what comes back is a basket that may span several services. So `after`
 * carries two things: the order in the shape OUR pricing understands, and the
 * order in the shape a person reads.
 *
 * What did NOT change, and is the point of most of what follows: no price
 * ever arrives from the browser.
 */
const order = (over = {}) => ({
  lineItems: { service: "combo-trays", lines: [{ packageId: "fam-c1", qty: 2 }], rush: false },
  groups: [{
    service: "combo-trays", packageId: "fam-c1", kind: "Combo Trays",
    title: "Family Combo 1", subtitle: "15 pax", units: "15 pax", qty: 2,
    contents: ["XXXL — Babyback Ribs", "2× XXXL — Blue Ternate Rice"],
  }],
  ...over,
});

describe("cleaning a rebuilt order", () => {
  it("keeps the pricing shape the server switches on", () => {
    expect(cleanAfter("change", order()).lineItems).toEqual({
      service: "combo-trays", lines: [{ packageId: "fam-c1", qty: 2 }], rush: false,
    });
  });

  it("keeps the same order for an add — the kinds differ in meaning, not shape", () => {
    expect(cleanAfter("add", order()).lineItems)
      .toEqual(cleanAfter("change", order()).lineItems);
  });

  it("keeps the readable description for the queue", () => {
    const [group] = cleanAfter("change", order()).groups;
    expect(group.title).toBe("Family Combo 1");
    expect(group.units).toBe("15 pax");
    expect(group.contents).toHaveLength(2);
  });

  describe("no price ever arrives from the browser", () => {
    it("drops a total sitting on a group", () => {
      const out = cleanAfter("change", order({
        groups: [{ title: "Family Combo 1", total: 20000, priceNote: "From PHP 8,000" }],
      }));
      const json = JSON.stringify(out);
      expect(json).not.toContain("20000");
      expect(json).not.toContain("8,000");
    });

    it("drops anything invented on a line item", () => {
      const out = cleanAfter("change", order({
        lineItems: {
          service: "combo-trays", price: 1, unitPrice: 1, total: 1, base_price: 1,
          lines: [{ packageId: "fam-c1", qty: 1, price: 1 }],
        },
      }));
      expect(JSON.stringify(out.lineItems)).not.toContain('"price"');
      expect(out.lineItems.lines[0]).toEqual({ packageId: "fam-c1", qty: 1 });
    });

    /**
     * The rush fee is a price, and it is an ordering decision rather than a
     * change one. A request arriving with rush:true would be priced 1,500
     * higher than the change the customer was shown.
     */
    it("never lets a change carry the rush fee", () => {
      expect(cleanAfter("change", order({
        lineItems: { service: "combo-trays", lines: [{ packageId: "fam-c1", qty: 1 }], rush: true },
      })).lineItems.rush).toBe(false);
    });
  });

  describe("an order spanning several services", () => {
    const mixed = {
      lineItems: {
        service: "mixed",
        groups: [
          { service: "party-trays", lines: [{ dishId: "ribs", traySize: "XXXL", qty: 1 }] },
          { service: "grazing", serviceKey: "grazing-table", paxRange: "100–150" },
          { service: "catering-package", serviceKey: "basic-catering", pax: 80, addons: { rice: true, drinks: false } },
        ],
      },
      groups: [{ title: "Party Tray" }, { title: "Grazing Table" }, { title: "Basic Catering" }],
    };

    it("keeps every service, in the shape each is priced from", () => {
      const out = cleanAfter("change", mixed).lineItems;
      expect(out.service).toBe("mixed");
      expect(out.groups).toHaveLength(3);
      expect(out.groups[1]).toEqual({ service: "grazing", serviceKey: "grazing-table", paxRange: "100–150" });
    });

    it("keeps which add-ons were ticked, as booleans", () => {
      const [, , catering] = cleanAfter("change", mixed).lineItems.groups;
      expect(catering.addons).toEqual({ rice: true, drinks: false });
      expect(catering.pax).toBe(80);
    });

    it("refuses a group inside a group inside a group", () => {
      expect(cleanAfter("change", {
        lineItems: { service: "mixed", groups: [{ service: "mixed", groups: [] }] },
        groups: [{ title: "x" }],
      })).toBeNull();
    });

    it("refuses the whole basket when one service in it is unusable", () => {
      // Half an order priced as a whole one is worse than no order.
      expect(cleanAfter("change", {
        lineItems: { service: "mixed", groups: [
          { service: "party-trays", lines: [{ dishId: "ribs", qty: 1 }] },
          { service: "", lines: [] },
        ] },
        groups: [{ title: "x" }],
      })).toBeNull();
    });
  });

  describe("what it refuses", () => {
    it("refuses a kind it does not know", () => {
      expect(cleanAfter("resize", order())).toBeNull();
    });

    it("refuses an order with nothing priceable in it", () => {
      expect(cleanAfter("change", { lineItems: { service: "combo-trays" }, groups: [{ title: "x" }] }))
        .toBeNull();
      expect(cleanAfter("change", order({ lineItems: {} }))).toBeNull();
      expect(cleanAfter("change", order({ lineItems: null }))).toBeNull();
      expect(cleanAfter("change", undefined)).toBeNull();
    });

    it("refuses an order nobody in the queue could describe", () => {
      expect(cleanAfter("change", order({ groups: [] }))).toBeNull();
      expect(cleanAfter("change", order({ groups: [{ title: "  " }] }))).toBeNull();
      expect(cleanAfter("change", order({ groups: "lots" }))).toBeNull();
    });

    it("refuses a line that names nothing", () => {
      expect(cleanAfter("change", order({
        lineItems: { service: "combo-trays", lines: [{ qty: 2 }] },
      }))).toBeNull();
    });

    it("refuses a line with no quantity, rather than pricing it as one", () => {
      for (const bad of [undefined, null, 0, -1, 1.5, "two", true, [2], "1e3"]) {
        expect(cleanAfter("change", order({
          lineItems: { service: "combo-trays", lines: [{ packageId: "fam-c1", qty: bad }] },
        })), String(bad)).toBeNull();
      }
    });

    it("takes a quantity typed into a number field, which arrives as a string", () => {
      expect(cleanAfter("change", order({
        lineItems: { service: "combo-trays", lines: [{ packageId: "fam-c1", qty: "2" }] },
      })).lineItems.lines[0].qty).toBe(2);
    });

    /**
     * Not the cart's 99. Packed meals counts pieces and its volume tier does
     * not start until 100, so a tighter cap here would refuse ordinary
     * orders.
     */
    it("allows a piece count well past a tray count", () => {
      expect(cleanAfter("change", order({
        lineItems: { service: "packed-meals", lines: [{ packTypeId: "t1", qty: 250 }] },
      })).lineItems.lines[0].qty).toBe(250);
    });

    it("refuses an id that is not a string, which would read as one", () => {
      // A number 42 becomes the id "42", which matches no catalogue row.
      expect(cleanAfter("change", order({
        lineItems: { service: "combo-trays", lines: [{ packageId: 42, qty: 1 }] },
      }))).toBeNull();
    });

    it("refuses a service name that is not an id", () => {
      for (const bad of ["Combo Trays", "../etc", 7, null, ""]) {
        expect(cleanAfter("change", order({
          lineItems: { service: bad, lines: [{ packageId: "fam-c1", qty: 1 }] },
        })), String(bad)).toBeNull();
      }
    });
  });

  describe("bounding what reaches the row", () => {
    it("caps how many services one basket may hold", () => {
      const many = Array.from({ length: 40 }, () => ({
        service: "combo-trays", lines: [{ packageId: "fam-c1", qty: 1 }],
      }));
      expect(cleanAfter("change", {
        lineItems: { service: "mixed", groups: many },
        groups: [{ title: "x" }],
      }).lineItems.groups.length).toBeLessThanOrEqual(12);
    });

    it("caps how many lines one service may hold", () => {
      const many = Array.from({ length: 200 }, () => ({ packageId: "fam-c1", qty: 1 }));
      expect(cleanAfter("change", order({
        lineItems: { service: "combo-trays", lines: many },
      })).lineItems.lines.length).toBeLessThanOrEqual(40);
    });

    it("trims text nobody would have typed", () => {
      const out = cleanAfter("change", order({
        groups: [{ title: "x".repeat(5000), contents: ["y".repeat(5000)] }],
      }));
      expect(out.groups[0].title.length).toBeLessThanOrEqual(200);
      expect(out.groups[0].contents[0].length).toBeLessThanOrEqual(200);
    });

    it("caps how many rows the queue description may hold", () => {
      const many = Array.from({ length: 50 }, (_, i) => ({ title: `Line ${i}` }));
      expect(cleanAfter("change", order({ groups: many })).groups.length)
        .toBeLessThanOrEqual(12);
    });
  });
});

describe("the snapshot the dashboard compares against", () => {
  const fields = {
    branch: "Cavite", package_name: "Jeanette Package",
    pax_count: "50 pax", event_date: "2026-10-11",
  };

  it("carries branch, because their queue is branch-scoped", () => {
    expect(buildBefore(fields, 19000).branch).toBe("Cavite");
  });

  it("carries only the fields a change touches", () => {
    expect(Object.keys(buildBefore(fields, 19000)).sort())
      .toEqual(["branch", "event_date", "package_name", "pax_count", "total"]);
  });

  it("keeps the total as a display snapshot", () => {
    expect(buildBefore(fields, 19000).total).toBe(19000);
  });

  it("reports no total rather than zero when there is none", () => {
    // Number(null) is 0. A snapshot reading PHP 0 would tell an admin the
    // booking was worth nothing when they compare it.
    for (const bad of [null, undefined, "", 0, -5, "abc"]) {
      expect(buildBefore(fields, bad).total, String(bad)).toBeNull();
    }
  });
});

describe("whether the request may be made at all", () => {
  const good = { kind: "change", after: order() };

  it("allows one well outside the window", () => {
    expect(validateRequest({ ...good, eventDate: inDays(30) }).ok).toBe(true);
  });

  it("refuses a change inside seven days", () => {
    const r = validateRequest({ ...good, eventDate: inDays(5) });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("closed");
  });

  it("still allows an add inside seven days but outside three", () => {
    expect(validateRequest({ kind: "add", eventDate: inDays(5), after: order() }).ok).toBe(true);
  });

  it("refuses an add inside three days", () => {
    expect(validateRequest({ kind: "add", eventDate: inDays(1), after: order() }).reason)
      .toBe("closed");
  });

  it("checks the window before the contents, so a locked booking leaks nothing", () => {
    const r = validateRequest({ kind: "change", after: {}, eventDate: inDays(1) });
    expect(r.reason).toBe("closed");
  });

  it("refuses a kind it does not know", () => {
    expect(validateRequest({ kind: "resize", after: order(), eventDate: inDays(30) }).reason)
      .toBe("unknown-kind");
    expect(KINDS).toEqual(["change", "add"]);
  });

  it("refuses contents it cannot apply", () => {
    const r = validateRequest({ kind: "change", after: { groups: [] }, eventDate: inDays(30) });
    expect(r.reason).toBe("unusable");
  });

  it("hands back the cleaned order, never the one that arrived", () => {
    const dirty = order({
      lineItems: { service: "combo-trays", lines: [{ packageId: "fam-c1", qty: 1 }], rush: true },
    });
    const r = validateRequest({ kind: "change", after: dirty, eventDate: inDays(30) });
    expect(r.after.lineItems.rush).toBe(false);
    expect(r.after).not.toBe(dirty);
  });
});

describe("what the customer is told", () => {
  it("explains a closed window and points at a person", () => {
    expect(reasonMessage("closed")).toMatch(/message us/i);
  });

  it("says plainly when one is already open", () => {
    expect(reasonMessage("already-open")).toMatch(/already have a request/i);
  });

  it("falls back to something useful rather than an empty string", () => {
    expect(reasonMessage("something-new")).toBe(reasonMessage("unknown"));
    expect(reasonMessage(undefined).length).toBeGreaterThan(20);
  });
});

describe("recovering the package from an order's dish text", () => {
  const NL = String.fromCharCode(10);
  const PACKAGES = [
    { id: "jeanette-50",     name: "Jeanette Package",     pax_label: "50 pax" },
    { id: "jeanette-100",    name: "Jeanette Package",     pax_label: "100 pax" },
    { id: "mary-rose-25",    name: "Mary Rose Package",    pax_label: "25 pax" },
    { id: "mary-rose-100",   name: "Mary Rose Package",    pax_label: "100 pax" },
    { id: "fam-c1",          name: "Family Combo 1",       pax_label: "15 pax" },
  ];
  const find = (text) => packageFromDishText(text, PACKAGES);

  /**
   * order_groups carries the id, but only on bookings placed since it
   * existed — which is none of them. dishes_selected is written by the cart,
   * so its name and size are the catalogue's own rather than typed by hand.
   */
  it("reads the package off a real line", () => {
    expect(find("• Jeanette Package (50 pax) — PHP 19,000")).toBe("jeanette-50");
    expect(find("• Mary Rose Package (100 pax) — PHP 35,000")).toBe("mary-rose-100");
    expect(find("• Family Combo 1 (15 pax) — PHP 10,000")).toBe("fam-c1");
  });

  it("ignores the indented dish lines beneath it", () => {
    const text = ["• Jeanette Package (50 pax) — PHP 19,000",
      "    Babyback Ribs", "    Java Rice"].join(NL);
    expect(find(text)).toBe("jeanette-50");
  });

  it("finds the package even when a tray comes first", () => {
    const text = ["• 2× Bilao (Large) — PHP 3,600",
      "• Mary Rose Package (100 pax) — PHP 35,000"].join(NL);
    expect(find(text)).toBe("mary-rose-100");
  });

  it("needs the size as well as the name", () => {
    // "Mary Rose Package" alone spans three prices. Matching on the name
    // would pick one of them, and a 25-pax booking would become a 100-pax.
    expect(find("• Mary Rose Package (60 pax) — PHP 20,000")).toBeNull();
  });

  it("does not match a single dish, which has nothing to change to", () => {
    expect(find("• Roast Beef Pink Mash (Beef · Family) — PHP 2,500")).toBeNull();
  });

  it("is not thrown by case or spacing", () => {
    expect(find("•   jeanette package   ( 50 PAX )  — PHP 19,000")).toBe("jeanette-50");
  });

  it("returns nothing rather than guessing when it has nothing to match against", () => {
    expect(packageFromDishText("• Jeanette Package (50 pax) — PHP 19,000", [])).toBeNull();
    expect(packageFromDishText("", PACKAGES)).toBeNull();
    expect(packageFromDishText(null, null)).toBeNull();
  });

  it("never matches a package that is not in the catalogue it was given", () => {
    expect(find("• Sabrina Package (50 pax) — PHP 27,000")).toBeNull();
  });
});

/**
 * Which requests the dashboard's v1 Approve can apply on its own.
 *
 * Their question, and the right one: `lines` is an array with quantities on
 * it, while their Change Package applies one package. Both live requests so
 * far happen to be a single line at quantity one — applicable today, but by
 * luck rather than by contract.
 *
 * It cannot be made a contract by restricting the request, because the
 * builder genuinely produces baskets. So the row states which it is, in a
 * field, rather than making anyone infer it from the array.
 */
describe("saying whether a request is one package", () => {
  const one = (over = {}) => ({
    service: "combo-trays", lines: [{ packageId: "fam-c1", qty: 1 }], ...over,
  });

  it("names the package when that is all there is", () => {
    expect(singlePackageId(one())).toBe("fam-c1");
  });

  it("says no to two packages", () => {
    expect(singlePackageId(one({
      lines: [{ packageId: "fam-c1", qty: 1 }, { packageId: "fam-c3", qty: 1 }],
    }))).toBeNull();
  });

  /**
   * Two of the same package is as far outside "apply one package" as two
   * different ones. Reading only the id here would hand v1 a request it
   * would apply at half the quantity, silently.
   */
  it("says no to two of the same package", () => {
    expect(singlePackageId(one({ lines: [{ packageId: "fam-c1", qty: 2 }] }))).toBeNull();
  });

  it("says no to an order spanning services", () => {
    expect(singlePackageId({ service: "mixed", groups: [one()] })).toBeNull();
  });

  it("says no to a service that is not combo trays", () => {
    expect(singlePackageId({
      service: "party-trays", lines: [{ dishId: "ribs", traySize: "XXXL", qty: 1 }],
    })).toBeNull();
  });

  it("says no rather than throwing on nothing at all", () => {
    for (const bad of [null, undefined, {}, { service: "combo-trays" }]) {
      expect(singlePackageId(bad), String(bad)).toBeNull();
    }
  });

  it("rides on every cleaned request, so the queue never has to infer it", () => {
    const after = {
      lineItems: { service: "combo-trays", lines: [{ packageId: "fam-c1", qty: 1 }] },
      groups: [{ title: "Family Combo 1" }],
    };
    expect(cleanAfter("change", after).singlePackageId).toBe("fam-c1");

    const basket = {
      lineItems: {
        service: "mixed",
        groups: [
          { service: "combo-trays", lines: [{ packageId: "fam-c1", qty: 1 }] },
          { service: "party-trays", lines: [{ dishId: "ribs", traySize: "XXXL", qty: 1 }] },
        ],
      },
      groups: [{ title: "Family Combo 1" }, { title: "Party Tray" }],
    };
    // Present and null, not absent — the queue branches on the field either
    // way, and a missing key is a different question from a false one.
    expect(cleanAfter("change", basket)).toHaveProperty("singlePackageId", null);
  });
});
