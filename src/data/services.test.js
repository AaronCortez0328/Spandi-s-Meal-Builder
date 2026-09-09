import { describe, it, expect } from "vitest";
import { selectCustomServices } from "./services.js";

/**
 * The rule that decides whether an admin-created card reaches the chooser.
 *
 * It fails CLOSED, unlike isServiceActive beside it. A built-in card is in
 * index.html whether this table loads or not, so failing open there keeps a
 * live card orderable through a dropped request. A custom card exists only
 * because a row said so — render one whose row cannot be trusted and the
 * customer has chosen it before anything can say no.
 */
describe("selectCustomServices", () => {
  const custom = (over = {}) => ({
    slug: "lechon-belly", label: "Lechon Belly",
    is_builtin: false, active: true, sort_order: 1, ...over,
  });

  it("returns an active custom row", () => {
    expect(selectCustomServices([custom()])).toHaveLength(1);
  });

  it("has nothing to show for nothing", () => {
    expect(selectCustomServices([])).toEqual([]);
    expect(selectCustomServices(null)).toEqual([]);
    expect(selectCustomServices(undefined)).toEqual([]);
  });

  // The seven have their own markup and their own builders. Rendering one
  // here would put a second, generic copy of it on the chooser.
  it("never returns a built-in", () => {
    expect(selectCustomServices([custom({ is_builtin: true })])).toEqual([]);
  });

  it("drops a custom card that is switched off", () => {
    expect(selectCustomServices([custom({ active: false })])).toEqual([]);
  });

  // Everything below is a row we cannot be sure about. A built-in in this
  // position would stay open; a custom one must not, because there is no
  // service behind it.
  it("drops a row whose flags are missing or unclear", () => {
    expect(selectCustomServices([custom({ active: null })])).toEqual([]);
    expect(selectCustomServices([custom({ active: undefined })])).toEqual([]);
    expect(selectCustomServices([{ slug: "x", label: "X" }])).toEqual([]);
    expect(selectCustomServices([custom({ is_builtin: null })])).toEqual([]);
    expect(selectCustomServices([null, undefined])).toEqual([]);
  });

  // A loose check would let these through. active: "false" is truthy as a
  // string, and is_builtin: 0 == false is only true under coercion.
  it("is not fooled by values that merely look right", () => {
    expect(selectCustomServices([custom({ active: "true" })])).toEqual([]);
    expect(selectCustomServices([custom({ active: 1 })])).toEqual([]);
    expect(selectCustomServices([custom({ is_builtin: 0 })])).toEqual([]);
  });

  // data-service is keyed on the slug and the section is routed by it. A
  // card without one is a button that goes nowhere.
  it("drops a row with no slug", () => {
    expect(selectCustomServices([custom({ slug: "" })])).toEqual([]);
    expect(selectCustomServices([custom({ slug: null })])).toEqual([]);
  });

  it("orders by sort_order, so the dashboard decides the sequence", () => {
    const rows = [
      custom({ slug: "c", sort_order: 30 }),
      custom({ slug: "a", sort_order: 10 }),
      custom({ slug: "b", sort_order: 20 }),
    ];
    expect(selectCustomServices(rows).map((r) => r.slug)).toEqual(["a", "b", "c"]);
  });

  it("puts a row with no sort_order first rather than dropping it", () => {
    const rows = [custom({ slug: "a", sort_order: 5 }), custom({ slug: "b", sort_order: null })];
    expect(selectCustomServices(rows).map((r) => r.slug)).toEqual(["b", "a"]);
  });

  it("keeps only the custom ones out of a realistic mixed table", () => {
    const rows = [
      { slug: "catering", is_builtin: true, active: true, sort_order: 1 },
      { slug: "party-trays", is_builtin: true, active: false, sort_order: 2 },
      custom({ slug: "lechon-belly", sort_order: 8 }),
      custom({ slug: "paella", active: false, sort_order: 9 }),
    ];
    expect(selectCustomServices(rows).map((r) => r.slug)).toEqual(["lechon-belly"]);
  });
});
