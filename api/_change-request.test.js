import { describe, it, expect } from "vitest";
import {
  cleanAfter, buildBefore, validateRequest, reasonMessage, KINDS, nameAddOptions,
} from "./_change-request.js";
import { todayInManila } from "../src/domain/availability.js";

/**
 * What a request may contain before it earns a row.
 *
 * The shape here was the dashboard's correction and it mattered: "100 pax" is
 * not a figure anyone can apply, because jeanette-50 and jeanette-100 are
 * different catalogue rows at PHP 19,000 and PHP 35,000 with different tray
 * quantities. A number would have left them guessing which row.
 */
const inDays = (n) => {
  const d = new Date(`${todayInManila()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe("a change names a catalogue row", () => {
  it("keeps the package id and nothing else", () => {
    expect(cleanAfter("change", { package_id: "jeanette-100" }))
      .toEqual({ package_id: "jeanette-100" });
  });

  it("drops anything else the browser sent", () => {
    const out = cleanAfter("change", {
      package_id: "jeanette-100", price: 35000, pax: 100, total: 999,
    });
    expect(out).toEqual({ package_id: "jeanette-100" });
  });

  it("carries no price, which is the thing server-side validation exists for", () => {
    const json = JSON.stringify(cleanAfter("change", { package_id: "x-1", base_price: 35000 }));
    expect(json).not.toContain("35000");
    expect(json).not.toContain("price");
  });

  it("accepts an id that cannot be derived from a name", () => {
    // special-50 is "Mary Rose Package, 50 pax", between mary-rose-25 and
    // mary-rose-100. Any ${base}-${pax} scheme breaks on it.
    expect(cleanAfter("change", { package_id: "special-50" })).toEqual({ package_id: "special-50" });
  });

  it("refuses an id that is not one", () => {
    for (const bad of ["", "   ", "Jeanette 100", "../etc", "a".repeat(80), null, undefined]) {
      expect(cleanAfter("change", { package_id: bad }), String(bad)).toBeNull();
    }
  });

  it("refuses a number that merely coerces to an id", () => {
    // Number 42 becomes the id "42", which looks valid and is not. Real ids
    // read jeanette-100 and fam-c1.
    for (const bad of [42, true, ["jeanette-100"], { toString: () => "x-1" }]) {
      expect(cleanAfter("change", { package_id: bad }), String(bad)).toBeNull();
    }
  });
});

describe("an add names dishes the way package_items does", () => {
  const one = { dish_id: "garlic-beef-tips", tray_size: "Family", quantity: 1 };

  it("keeps dish, tray and quantity", () => {
    expect(cleanAfter("add", { items: [one] })).toEqual({ items: [one] });
  });

  it("refuses a tray size the catalogue does not have", () => {
    expect(cleanAfter("add", { items: [{ ...one, tray_size: "Enormous" }] })).toBeNull();
  });

  it("refuses a quantity that is not a whole number in range", () => {
    for (const qty of [0, -1, 1.5, 100, null, undefined, NaN, true, [2], {}]) {
      expect(cleanAfter("add", { items: [{ ...one, quantity: qty }] }), String(qty)).toBeNull();
    }
  });

  it("accepts a quantity a number input actually sends", () => {
    // <input type="number">.value is a string. Refusing "2" would refuse
    // every real request while looking strict.
    expect(cleanAfter("add", { items: [{ ...one, quantity: "2" }] }))
      .toEqual({ items: [{ ...one, quantity: 2 }] });
  });

  it("refuses an empty list rather than filing a request for nothing", () => {
    expect(cleanAfter("add", { items: [] })).toBeNull();
    expect(cleanAfter("add", {})).toBeNull();
  });

  it("refuses a list long enough to be a mistake", () => {
    const many = Array.from({ length: 21 }, () => one);
    expect(cleanAfter("add", { items: many })).toBeNull();
  });

  it("refuses the whole request when one row is bad, never a partial one", () => {
    // A half-applied add is worse than a refused one: somebody approves it
    // believing they can see everything the customer asked for.
    expect(cleanAfter("add", { items: [one, { ...one, dish_id: "" }] })).toBeNull();
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
  const good = { kind: "change", after: { package_id: "jeanette-100" } };

  it("allows one well outside the window", () => {
    expect(validateRequest({ ...good, eventDate: inDays(30) }).ok).toBe(true);
  });

  it("refuses a change inside seven days", () => {
    const r = validateRequest({ ...good, eventDate: inDays(5) });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("closed");
  });

  it("still allows an add inside seven days but outside three", () => {
    const r = validateRequest({
      kind: "add", eventDate: inDays(5),
      after: { items: [{ dish_id: "x", tray_size: "Family", quantity: 1 }] },
    });
    expect(r.ok).toBe(true);
  });

  it("refuses an add inside three days", () => {
    const r = validateRequest({
      kind: "add", eventDate: inDays(1),
      after: { items: [{ dish_id: "x", tray_size: "Family", quantity: 1 }] },
    });
    expect(r.reason).toBe("closed");
  });

  it("checks the window before the contents, so a locked booking leaks nothing", () => {
    const r = validateRequest({ kind: "change", after: {}, eventDate: inDays(1) });
    expect(r.reason).toBe("closed");
  });

  it("refuses a kind it does not know", () => {
    expect(validateRequest({ kind: "resize", after: {}, eventDate: inDays(30) }).reason)
      .toBe("unknown-kind");
    expect(KINDS).toEqual(["change", "add"]);
  });

  it("refuses contents it cannot apply", () => {
    const r = validateRequest({ kind: "change", after: { package_id: "" }, eventDate: inDays(30) });
    expect(r.reason).toBe("unusable");
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

describe("naming the dishes a customer can add to", () => {
  const items = [
    { dish_id: "babyback-ribs", tray_size: "XXXL", display_name: "" },
    { dish_id: "java-rice",     tray_size: "XXXL", display_name: "" },
  ];
  const dishes = [
    { id: "babyback-ribs", name: "Babyback Ribs" },
    { id: "java-rice",     name: "Java Rice" },
  ];

  it("names them from the dish table when package_items does not", () => {
    // display_name is blank on most rows in the live data.
    expect(nameAddOptions(items, dishes).map((i) => i.name))
      .toEqual(["Babyback Ribs", "Java Rice"]);
  });

  it("prefers a display name when the package carries one", () => {
    const out = nameAddOptions(
      [{ dish_id: "java-rice", tray_size: "XXXL", display_name: "Java Rice (extra garlic)" }],
      dishes,
    );
    expect(out[0].name).toBe("Java Rice (extra garlic)");
  });

  it("DROPS a dish nobody can name rather than showing its id", () => {
    // "Add another roast-beef-pink-mash" is not something to put in front of
    // a customer, and a row they cannot read is one they cannot choose.
    const out = nameAddOptions(items, [dishes[0]]);
    expect(out).toHaveLength(1);
    expect(out[0].dishId).toBe("babyback-ribs");
  });

  it("drops a row with no tray size, which cannot be ordered", () => {
    expect(nameAddOptions([{ dish_id: "java-rice", tray_size: null }], dishes)).toEqual([]);
  });

  it("keeps the tray size from the package rather than inventing one", () => {
    expect(nameAddOptions(items, dishes)[0].traySize).toBe("XXXL");
  });

  it("returns nothing rather than throwing on nothing", () => {
    expect(nameAddOptions(null, null)).toEqual([]);
    expect(nameAddOptions([], [])).toEqual([]);
  });
});
