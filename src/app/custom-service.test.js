import { describe, it, expect } from "vitest";
import { cardHtml } from "./custom-service.js";

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
