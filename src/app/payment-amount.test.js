import { describe, it, expect } from "vitest";
import { amountDueState } from "./payment-upload.js";

/**
 * What the payment page tells a customer they owe.
 *
 * This is the page where people give us money, and it was telling customers
 * who had already paid in full that they owed the whole amount — directly
 * beneath a receipts list reading "Confirmed".
 *
 * The rule under all of these: understating is the dangerous direction. A
 * customer told she owes nothing does not pay and finds out at her event.
 * Every uncertainty lands on the full total instead of a guess.
 */
const money = (paid, total = 10000) => ({
  total,
  reserve: Math.round(total / 2),
  paid,
  balance: paid === null ? null : Math.max(0, total - paid),
});

const verified = [{ submittedAt: "x", fileCount: 1, state: "verified" }];
const pending  = [{ submittedAt: "x", fileCount: 1, state: null }];

describe("a booking that is paid in full", () => {
  it("says so rather than billing them again", () => {
    expect(amountDueState("PHP 10,000", money(10000), verified)).toBe("settled");
  });

  it("says so even if no receipt was ever logged against it", () => {
    expect(amountDueState("PHP 10,000", money(10000), [])).toBe("settled");
  });
});

describe("a booking with something still owed", () => {
  it("states the remainder, not the order total", () => {
    expect(amountDueState("PHP 10,000", money(5000), verified)).toBe("due");
  });

  it("states the full amount when nothing has been paid", () => {
    expect(amountDueState("PHP 10,000", money(0), [])).toBe("due");
  });
});

describe("a payment we have but have not counted", () => {
  it("acknowledges the receipt instead of claiming a figure", () => {
    // amount_paid blank while a receipt reads verified. Real: one live
    // booking is FULLY PAID with the field empty.
    expect(amountDueState("PHP 10,000", money(null), verified)).toBe("received");
  });

  it("does not count a receipt nobody has reviewed yet", () => {
    // Unreviewed is not proof. Claiming "payment received" on a screenshot
    // nobody has looked at is a promise we cannot keep.
    expect(amountDueState("PHP 10,000", money(null), pending)).toBe("total");
  });
});

describe("when we know nothing at all", () => {
  it("falls back to the order total, which is this page's old behaviour", () => {
    expect(amountDueState("PHP 10,000", null, [])).toBe("total");
    expect(amountDueState("PHP 10,000", money(null), [])).toBe("total");
  });

  it("never errs towards owing less", () => {
    // Every uncertain input must land on 'total' or 'received' — never on
    // 'settled', which is the only state that tells a customer to stop.
    for (const m of [null, undefined, money(null)]) {
      for (const subs of [[], pending, null, undefined]) {
        expect(amountDueState("PHP 10,000", m, subs)).not.toBe("settled");
      }
    }
  });

  it("shows nothing at all when there is not even a total", () => {
    expect(amountDueState(null, null, [])).toBe("none");
  });
});
