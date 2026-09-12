import { describe, it, expect } from "vitest";
import {
  grazingCostLines, grazingBreakdownHtml, grazingLineTotal,
} from "./grazing-builder.js";
import { grazingBreakdown } from "../domain/pricing.js";

const TABLE = { paxRange: "50–100", price: 35000 };
const BOARD = { paxRange: "60–100", price: 58000 };

/**
 * grazing-builder's fmt() joins "PHP" to its number with a non-breaking
 * space, so the currency cannot wrap away from the figure at narrow widths.
 * That is the right call for the screen and invisible in a test failure — an
 * assertion written with an ordinary space fails against output that looks
 * character-for-character identical in the diff.
 *
 * So these normalise rather than hard-code U+00A0: what is being checked is
 * the money, not which space was used to print it.
 */
// Escaped rather than the literal character: an invisible U+00A0 sitting in
// source is the same trap in a test as it is in a diff, and eslint rightly
// refuses it (no-irregular-whitespace).
const money = (s) => String(s).replace(/\u00A0/g, " ");
const text = (lines) => money(lines.join("\n"));

/**
 * What reaches the review screen and GoHighLevel.
 *
 * "service charge 10%" and "Transpo fee depending on location" were grey
 * items in an "Add-ons & Notes" list that added to nothing, so a 50–100
 * Table quoted PHP 35,000 against an invoice of PHP 38,500 plus transport.
 */
describe("what a grazing order says it is paying for", () => {
  it("itemises the Table's spread and its service charge", () => {
    const out = text(grazingCostLines("grazing-table", TABLE));
    expect(out).toContain("PHP 35,000");
    expect(out).toContain("PHP 3,500");
  });

  // The Board is dropped off. No staff, no setup, no charge — inventing
  // lines for it would describe a bill nobody sends.
  it("says nothing extra about the Board", () => {
    const out = text(grazingCostLines("grazing-board", BOARD));
    expect(out).toContain("PHP 58,000");
    expect(out).not.toContain("Service charge");
    expect(out).not.toContain("Transport");
  });

  // The whole point of the note: transport is quoted per location after the
  // booking, so the figure on the order is not the final bill.
  it("flags the Table's transport as still to be quoted, with no price", () => {
    const line = money(
      grazingCostLines("grazing-table", TABLE).find((l) => l.includes("Transport")),
    );
    expect(line).toContain("quoted by location");
    expect(line).toContain("not in the total above");
    expect(line).not.toMatch(/PHP/);
  });

  it("has nothing to say about a tier it could not price", () => {
    expect(grazingCostLines("grazing-table", undefined)).toEqual([]);
    expect(grazingCostLines("grazing-table", { paxRange: "x", price: 0 })).toEqual([]);
  });

  // The lines and the figure the order is billed at come from one function.
  it("shows lines that sum to what the order charges", () => {
    for (const [key, tier] of [["grazing-table", TABLE], ["grazing-board", BOARD]]) {
      const expected = grazingBreakdown([tier], tier.paxRange, key).total;
      const sum = text(grazingCostLines(key, tier))
        .match(/PHP [\d,]+/g)
        .map((m) => Number(m.replace(/[^\d]/g, "")))
        .reduce((a, n) => a + n, 0);
      expect(sum, key).toBe(expected);
    }
  });
});

/**
 * The figure the cart carries, and the one the server independently arrives
 * at. ghl-inquiry.js compares the two exactly and writes the server's to the
 * CRM, so the Table losing its service charge here is not a display bug — it
 * is a 10% shortfall both sides would agree on, with nothing to query it.
 */
describe("what the order line is priced at", () => {
  it("charges the Table its service charge", () => {
    expect(grazingLineTotal("grazing-table", TABLE)).toBe(38500);
  });

  it("leaves the Board at its flat price", () => {
    expect(grazingLineTotal("grazing-board", BOARD)).toBe(58000);
  });

  it("agrees with the server, which prices the same line from the same module", () => {
    for (const [key, tier] of [["grazing-table", TABLE], ["grazing-board", BOARD]]) {
      expect(grazingLineTotal(key, tier), key)
        .toBe(grazingBreakdown([tier], tier.paxRange, key).total);
    }
  });

  it("is zero for a tier that is not there", () => {
    expect(grazingLineTotal("grazing-table", null)).toBe(0);
  });
});

describe("the breakdown panel", () => {
  it("shows the Table's total as being before transport", () => {
    const html = money(grazingBreakdownHtml("grazing-table", TABLE));
    expect(html).toContain("PHP 38,500");
    expect(html).toContain("Total before transport");
    expect(html).toContain("quoted by location");
  });

  // A single flat price broken into one row repeating itself is noise.
  it("draws nothing for the Board", () => {
    expect(grazingBreakdownHtml("grazing-board", BOARD)).toBe("");
  });

  it("draws nothing before a tier is chosen", () => {
    expect(grazingBreakdownHtml("grazing-table", null)).toBe("");
    expect(grazingBreakdownHtml("grazing-table", undefined)).toBe("");
  });

  // Written with innerHTML, and the band label comes from the dashboard, so
  // it is escaped like every other admin-supplied string.
  it("escapes the band label", () => {
    const html = grazingBreakdownHtml("grazing-table", {
      paxRange: '"><script>alert(1)</script>', price: 35000,
    });
    expect(html).not.toContain("<script");
  });
});
