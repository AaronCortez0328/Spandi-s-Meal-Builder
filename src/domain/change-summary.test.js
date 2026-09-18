import { describe, it, expect } from "vitest";
import { changeSummary } from "./change-summary.js";

/**
 * The sums behind the last screen a customer sees before asking us to change
 * their party. Two things are being guarded here and neither is arithmetic:
 *
 *   that a change REPLACES and an add ADDS, and the two never swap
 *   that "we do not know" never becomes "zero"
 */
describe("changeSummary", () => {
  describe("a change replaces the booking", () => {
    const base = { kind: "change", wasTotal: 35000, paid: 17500 };

    it("proposes the cart, not the cart plus the booking", () => {
      expect(changeSummary({ ...base, cartTotal: 20000 }).proposed).toBe(20000);
    });

    it("signs the difference against what they already have", () => {
      expect(changeSummary({ ...base, cartTotal: 50000 }).difference).toBe(15000);
      expect(changeSummary({ ...base, cartTotal: 20000 }).difference).toBe(-15000);
      expect(changeSummary({ ...base, cartTotal: 35000 }).difference).toBe(0);
    });

    it("names the direction so the screen never has to compare", () => {
      expect(changeSummary({ ...base, cartTotal: 50000 }).direction).toBe("more");
      expect(changeSummary({ ...base, cartTotal: 20000 }).direction).toBe("less");
      expect(changeSummary({ ...base, cartTotal: 35000 }).direction).toBe("same");
    });

    it("settles the balance against the new order, not the old one", () => {
      // Paid 17,500 against a booking of 35,000; the new order is 20,000.
      expect(changeSummary({ ...base, cartTotal: 20000 }).balance).toBe(2500);
    });

    it("reports being ahead rather than a negative balance", () => {
      const s = changeSummary({ ...base, cartTotal: 10000 });
      expect(s.balance).toBe(0);
      expect(s.refund).toBe(7500);
    });
  });

  describe("an add sits on top of the booking", () => {
    const base = { kind: "add", wasTotal: 35000, paid: 17500 };

    it("proposes the booking PLUS the cart", () => {
      expect(changeSummary({ ...base, cartTotal: 5000 }).proposed).toBe(40000);
    });

    it("reports what is being added, which a change never has", () => {
      expect(changeSummary({ ...base, cartTotal: 5000 }).adding).toBe(5000);
      expect(changeSummary({ kind: "change", wasTotal: 1, cartTotal: 5000 }).adding).toBeNull();
    });

    it("is never negative — you cannot add less than nothing", () => {
      expect(changeSummary({ ...base, cartTotal: 5000 }).direction).toBe("more");
    });

    it("owes against the bigger total", () => {
      expect(changeSummary({ ...base, cartTotal: 5000 }).balance).toBe(22500);
    });

    /**
     * The one that matters most. The same inputs through the wrong branch
     * would say this customer's booking is about to become PHP 5,000.
     */
    it("does not replace the booking with what is being added", () => {
      const add    = changeSummary({ ...base, cartTotal: 5000 });
      const change = changeSummary({ ...base, kind: "change", cartTotal: 5000 });
      expect(add.proposed).toBe(40000);
      expect(change.proposed).toBe(5000);
    });
  });

  describe("unknown stays unknown", () => {
    it("does not read a missing payment as nothing paid", () => {
      const s = changeSummary({ kind: "change", wasTotal: 35000, cartTotal: 20000, paid: null });
      expect(s.paid).toBeNull();
      expect(s.balance).toBeNull();
      expect(s.refund).toBeNull();
    });

    it("treats an empty amount_paid string as unknown, not as zero", () => {
      expect(changeSummary({ kind: "change", wasTotal: 1, cartTotal: 1, paid: "" }).paid).toBeNull();
    });

    it("reads a recorded zero as a real zero", () => {
      const s = changeSummary({ kind: "change", wasTotal: 35000, cartTotal: 20000, paid: 0 });
      expect(s.paid).toBe(0);
      expect(s.balance).toBe(20000);
    });

    it("refuses a boolean, which Number() would happily call 1", () => {
      expect(changeSummary({ kind: "change", wasTotal: true, cartTotal: 100 }).was).toBeNull();
    });

    it("refuses a negative, which is not a figure anybody recorded", () => {
      expect(changeSummary({ kind: "change", wasTotal: -50, cartTotal: 100 }).was).toBeNull();
    });

    it("cannot compare against a booking with no total", () => {
      const s = changeSummary({ kind: "change", wasTotal: null, cartTotal: 20000, paid: 5000 });
      expect(s.difference).toBeNull();
      expect(s.direction).toBeNull();
      // But the new order's own figure is known, so the balance still is.
      expect(s.proposed).toBe(20000);
      expect(s.balance).toBe(15000);
    });

    it("still says what an add is worth when the booking's total is missing", () => {
      const s = changeSummary({ kind: "add", wasTotal: null, cartTotal: 5000 });
      expect(s.difference).toBe(5000);
      expect(s.proposed).toBeNull();
    });
  });

  it("treats anything that is not an add as a change", () => {
    expect(changeSummary({ kind: undefined, wasTotal: 10, cartTotal: 20 }).kind).toBe("change");
  });
});
