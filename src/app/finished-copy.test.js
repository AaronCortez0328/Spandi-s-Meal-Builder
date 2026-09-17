import { describe, it, expect } from "vitest";
import { finishedCopy } from "./payment-upload.js";

/**
 * What a link with no submissions left tells the customer.
 *
 * This shipped with a comment describing the right behaviour above code that
 * did not do it, and nothing failed — because there was no test. The real
 * case: Aiza Marie Paran, a PHP 35,000 booking with PHP 17,500 paid, shown
 * "fully settled on our side" because the balance could not be read and an
 * absence was treated as a zero.
 *
 * Three states. The third is the one that cost money.
 */
describe("the finished link", () => {
  const money = (balance) => ({ total: 35000, reserve: 17500, paid: null, balance });

  it("says settled only when the balance is actually zero", () => {
    const { heading, body } = finishedCopy(money(0), "₱35,000");
    expect(heading).toBe("All payments received");
    expect(body).toMatch(/fully settled/i);
  });

  it("names what is still owed", () => {
    const { heading, body } = finishedCopy(money(17500), "₱35,000");
    expect(heading).toBe("Receipts received");
    expect(body).toMatch(/17,500/);
    expect(body).not.toMatch(/fully settled/i);
  });

  /**
   * The bug. Every one of these reached the settled branch before, and each
   * is a customer being told they owe nothing when nobody knows whether they
   * do.
   */
  it("never claims settlement it cannot see", () => {
    const unknown = [
      null,                                   // the live read failed
      undefined,                              // the field was absent
      { total: 35000, balance: null },        // amount_paid not recorded
      { total: 35000 },                       // balance missing entirely
    ];
    for (const m of unknown) {
      const { heading, body } = finishedCopy(m, "₱35,000");
      expect(body, JSON.stringify(m)).not.toMatch(/fully settled/i);
      expect(heading, JSON.stringify(m)).toBe("Receipts received");
    }
  });

  it("points an unknown balance at a person", () => {
    // It cannot name a figure, so the one useful thing left is a way to ask.
    expect(finishedCopy(null, "₱35,000").body).toMatch(/contact us/i);
  });

  it("does not print PHP 0 for a balance of nothing", () => {
    expect(finishedCopy(money(0), "₱35,000").body).not.toMatch(/PHP\s*0\b/);
  });

  it("still reads without a total to name", () => {
    expect(finishedCopy(money(0), null).body).toMatch(/this booking is/i);
  });
});
