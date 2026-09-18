import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Stubbed so this test does not reach for the catalogue's data layer. What
// is under test is which package goes into the cart, not where it came from.
vi.mock("../data/catering.js", () => ({
  cateringCatalogue: () => ({
    packages: [
      { id: "mary-rose-100", name: "Mary Rose Package", price: 35000, paxLabel: "100 pax" },
    ],
    itemsFor: () => [{ dishId: "ribs", traySize: "XXXL", quantity: 1, displayName: "Ribs" }],
    dishNameFor: () => "Babyback Ribs",
  }),
}));

const { prepareChangeCart } = await import("./change-prefill.js");
const { getOrderLines, setOrderLines } = await import("./order-shell.js");
const { startChange, readChange } = await import("../domain/change-session.js");

/**
 * Change starts full. Add starts empty.
 *
 * That one rule is the difference between the two flows made physical, and
 * getting it backwards means a customer who wanted one more tray sends a
 * request replacing their hundred-pax package with it.
 */
const store = new Map();

beforeEach(() => {
  store.clear();
  setOrderLines([]);
  vi.stubGlobal("sessionStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});

afterEach(() => vi.unstubAllGlobals());

const begin = (over) => startChange({
  kind: "change", identifier: "a@b.co", eventDate: "2026-12-19",
  packageId: "mary-rose-100", ...over,
});

const junk = () => setOrderLines([{
  id: "old", service: "party-trays", serviceLabel: "Party Trays",
  title: "Leftover from another visit", unitPrice: 2500, qty: 1, contents: [], payload: {},
}]);

describe("preparing the cart for a change", () => {
  it("does nothing at all when no change is in progress", () => {
    junk();
    expect(prepareChangeCart()).toBeNull();
    expect(getOrderLines()).toHaveLength(1);
  });

  it("starts a change from the package the customer already booked", () => {
    begin();
    prepareChangeCart();
    const [line] = getOrderLines();
    expect(line.title).toBe("Mary Rose Package");
    expect(line.payload.comboId).toBe("mary-rose-100");
    // Priced from the catalogue now, not from what the booking cost then.
    expect(line.unitPrice).toBe(35000);
  });

  it("starts an ADD empty, so nothing of the booking is replaced", () => {
    begin({ kind: "add" });
    prepareChangeCart();
    expect(getOrderLines()).toHaveLength(0);
  });

  it("throws away a basket left over from a different, unsent order", () => {
    junk();
    begin({ kind: "add" });
    prepareChangeCart();
    expect(getOrderLines()).toHaveLength(0);
  });

  it("leaves the cart empty when the package has been withdrawn", () => {
    junk();
    begin({ packageId: "gone-forever" });
    prepareChangeCart();
    // Empty, never the old basket and never an unsellable package.
    expect(getOrderLines()).toHaveLength(0);
  });

  it("leaves the cart empty when the booking's package could not be resolved", () => {
    begin({ packageId: null });
    prepareChangeCart();
    expect(getOrderLines()).toHaveLength(0);
  });

  /**
   * The reload case. The GoHighLevel navbar moves between PAGES, so a
   * customer who taps the cart and comes back has reloaded this app — and
   * preparing again would throw away everything they had chosen.
   */
  it("runs once, and leaves the customer's own work alone after that", () => {
    begin();
    prepareChangeCart();
    expect(readChange().prepared).toBe(true);

    // They then swap the package for two combos of their own.
    setOrderLines([{
      id: "theirs", service: "combo-trays", serviceLabel: "Combo Trays",
      title: "Family Combo 1", unitPrice: 10000, qty: 2, contents: [], payload: {},
    }]);

    expect(prepareChangeCart()).toBeNull();
    expect(getOrderLines()).toHaveLength(1);
    expect(getOrderLines()[0].title).toBe("Family Combo 1");
  });
});
