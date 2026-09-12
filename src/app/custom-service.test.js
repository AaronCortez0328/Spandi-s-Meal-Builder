import { describe, it, expect } from "vitest";
import { cardHtml, priceChipHtml } from "./custom-service.js";

/**
 * The card is built from text an admin typed into the dashboard and inserted
 * with innerHTML, so escaping is not a nicety here — and the badge slots have
 * to be present or the two functions that walk [data-service] skip the card
 * silently, which is how the "Currently Not Available" badge went missing
 * from three built-ins once already.
 */
describe("cardHtml", () => {
  const row = (over = {}) => ({
    slug: "lechon-belly",
    label: "Lechon Belly",
    description: "Slow-roasted, crackling skin, carved on site.",
    price_from: 8500,
    facts_label: "20–40 pax",
    ...over,
  });

  it("keys the card on the slug, which is what routes it", () => {
    expect(cardHtml(row())).toContain('data-service="lechon-belly"');
  });

  it("shows what the dashboard was given", () => {
    const html = cardHtml(row());
    expect(html).toContain("Lechon Belly");
    expect(html).toContain("Slow-roasted, crackling skin, carved on site.");
    expect(html).toContain("PHP 8,500");
    expect(html).toContain("20–40 pax");
  });

  // updateServiceAvailability() and applyServiceBadges() both walk every
  // [data-service] and reach inside for these. A card without them is a card
  // they quietly do nothing to.
  it("carries both badge slots, hidden", () => {
    const html = cardHtml(row());
    expect(html).toContain('data-badge="unavailable"');
    expect(html).toContain('data-badge="pick"');
  });

  it("escapes everything an admin can type", () => {
    const html = cardHtml(row({
      label: '<img src=x onerror=alert(1)>',
      description: '"><script>alert(1)</script>',
      facts_label: "<b>bold</b>",
    }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>bold</b>");
  });

  // A row is allowed to carry only a name. The card has to hold together
  // without a description, a price or a facts line rather than printing
  // "null" or an empty definition list.
  it("holds together on a row with nothing but a slug and a label", () => {
    const html = cardHtml({ slug: "paella", label: "Paella" });
    expect(html).toContain('data-service="paella"');
    expect(html).toContain("Paella");
    expect(html).not.toContain("null");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("service-card__facts");
  });

  it("falls back to the slug when a row somehow has no label", () => {
    expect(cardHtml({ slug: "paella" })).toContain(">paella<");
  });

  // price_from is numeric in the table, so a bad value must not reach the
  // card as "PHP NaN".
  it("omits the price rather than printing NaN", () => {
    const html = cardHtml(row({ price_from: "not a number" }));
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("From");
  });

  // price_from is optional in the table, so an unset one is ordinary rather
  // than corrupt. Number(null) is 0, not NaN, so coercing before checking
  // would put "From PHP 0" on the card — which reads as free, not as unpriced.
  it("omits the price when there isn't one, rather than showing zero", () => {
    for (const price_from of [null, undefined, "", 0, -1]) {
      const html = cardHtml(row({ price_from }));
      expect(html, `price_from: ${String(price_from)}`).not.toContain("From");
      expect(html, `price_from: ${String(price_from)}`).not.toContain("PHP 0");
    }
  });
});

/**
 * The figure on the card must come from the column the customer will be
 * charged from.
 *
 * price_from and unit_price are two independent fields on the dashboard form
 * with nothing holding them together. Reading price_from regardless of mode
 * let one card advertise "From PHP 350" on the chooser and then charge
 * PHP 250 inside — and, in the direction that matters, advertise 250 and
 * charge 350. Nobody would have meant that, and it still reads as bait and
 * switch to whoever paid it.
 */
describe("cardHtml pricing", () => {
  const base = { slug: "test", label: "test", facts_label: "2pax" };

  it("shows the From figure on a card with no price yet", () => {
    const html = cardHtml({ ...base, pricing_mode: "enquiry", price_from: 350, unit_price: null });
    expect(html).toContain("From");
    expect(html).toContain("PHP 350");
  });

  // The case that was live: From 350, Price 250, one service.
  it("shows what a fixed card charges, not what it advertised", () => {
    const html = cardHtml({ ...base, pricing_mode: "fixed", price_from: 350, unit_price: 250 });
    expect(html).toContain("PHP 250");
    expect(html).not.toContain("PHP 350");
    // No range to be at the bottom of once there is one price.
    expect(html).not.toContain("From");
  });

  // The direction that would have cost a customer money.
  it("never advertises less than it will charge", () => {
    const html = cardHtml({ ...base, pricing_mode: "fixed", price_from: 250, unit_price: 350 });
    expect(html).toContain("PHP 350");
    expect(html).not.toContain("PHP 250");
  });

  it("names the unit on a per-unit card", () => {
    const html = cardHtml({
      ...base, pricing_mode: "per_unit", price_from: 999,
      unit_price: 450, quantity_unit: "kg",
    });
    expect(html).toContain("PHP 450 per kg");
    expect(html).not.toContain("999");
  });

  it("falls back to From when a priced card somehow has no price", () => {
    const html = cardHtml({ ...base, pricing_mode: "fixed", price_from: 350, unit_price: null });
    expect(html).toContain("From");
    expect(html).toContain("PHP 350");
  });
});

/**
 * The money beside the button that commits to it. It used to be a line of
 * form-field__note under the description — the smallest, greyest style the
 * system has, flush against the quantity label so it read as part of it.
 */
describe("priceChipHtml", () => {
  it("states a fixed total", () => {
    const html = priceChipHtml({ pricing_mode: "fixed", unit_price: 250 }, "");
    expect(html).toContain("Total");
    expect(html).toContain("PHP 250");
  });

  it("shows the rate on a per-unit card until there is something to multiply", () => {
    const html = priceChipHtml({ pricing_mode: "per_unit", unit_price: 450, quantity_unit: "kg" }, "");
    expect(html).toContain("Per kg");
    expect(html).toContain("PHP 450");
  });

  it("shows the running total once a quantity is typed", () => {
    const html = priceChipHtml({ pricing_mode: "per_unit", unit_price: 450, quantity_unit: "kg" }, "5");
    expect(html).toContain("PHP 2,250");
    expect(html).toContain("5 &times; PHP 450");
  });

  // Zero is not a price. An unpriced card says so rather than showing money
  // that would be wrong.
  it("says an enquiry card will be quoted, rather than showing nothing", () => {
    const html = priceChipHtml({ pricing_mode: "enquiry", unit_price: null }, "3");
    expect(html).toContain("To be quoted");
    expect(html).not.toContain("PHP 0");
  });

  it("falls back to quoting when a priced card has no usable price", () => {
    expect(priceChipHtml({ pricing_mode: "fixed", unit_price: 0 }, "")).toContain("To be quoted");
    expect(priceChipHtml({ pricing_mode: "per_unit", unit_price: null }, "5")).toContain("To be quoted");
    expect(priceChipHtml(null, "5")).toContain("To be quoted");
  });
});

/**
 * meal_builder_services.icon is free text an admin fills in, so the value is
 * mapped rather than trusted. Anything unrecognised falls back to cutlery —
 * a card with no icon at all would sit in the grid missing the one element
 * every other card has.
 */
describe("card icons", () => {
  const row = (icon) => cardHtml({ slug: "s", label: "S", icon });

  it("uses the named icon when it is one we have", () => {
    for (const name of ["cutlery", "flame", "box", "leaf", "cake", "cup"]) {
      expect(row(name), name).toContain("<svg");
    }
    // Distinct markup, not the same icon under six names.
    const drawn = new Set(["cutlery", "flame", "box", "leaf", "cake", "cup"].map(row));
    expect(drawn.size).toBe(6);
  });

  it("is forgiving about how the value was typed", () => {
    expect(row("FLAME")).toBe(row("flame"));
    expect(row("  flame  ")).toBe(row("flame"));
  });

  it("falls back to cutlery rather than drawing nothing", () => {
    expect(row(null)).toBe(row("cutlery"));
    expect(row("")).toBe(row("cutlery"));
    expect(row("rocket")).toBe(row("cutlery"));
    expect(cardHtml({ slug: "s", label: "S" })).toBe(row("cutlery"));
  });

  // The value reaches innerHTML, so a typed value must never become markup.
  it("cannot be used to inject markup", () => {
    const html = row('"><script>alert(1)</script>');
    expect(html).not.toContain("<script");
  });
});
