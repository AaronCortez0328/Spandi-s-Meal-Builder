import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { bannerHtml, bannerDate, mountChangeBanner } from "./change-banner.js";
import { startChange } from "../domain/change-session.js";

/**
 * The strip is the one thing standing between "changing my order" and
 * "accidentally placing a second one", because the builder a customer is
 * looking at IS the ordering screen.
 */
describe("the change banner", () => {
  const change = { kind: "change", eventDate: "2026-12-19", identifier: "a@b.co" };
  const add    = { ...change, kind: "add" };

  it("names the booking by the day they would recognise", () => {
    expect(bannerHtml(change)).toContain("19 December");
  });

  it("says changing and adding differently, because they are different", () => {
    expect(bannerHtml(change)).toMatch(/changing your/i);
    expect(bannerHtml(add)).toMatch(/adding to your/i);
  });

  it("repeats the promise the confirmation made", () => {
    // Said on Order Status before they left, and again here, because ten
    // minutes of choosing dishes is long enough to stop believing it.
    expect(bannerHtml(change)).toMatch(/nothing changes until we confirm/i);
    expect(bannerHtml(add)).toMatch(/nothing changes until we confirm/i);
  });

  it("offers a way out that is not the browser back button", () => {
    expect(bannerHtml(change)).toContain("Cancel");
  });

  it("still reads sensibly when the date is unusable", () => {
    const html = bannerHtml({ kind: "change", eventDate: "nonsense" });
    expect(html).toMatch(/changing your booking/i);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });

  it("is announced, so it is not only a visual cue", () => {
    expect(bannerHtml(change)).toContain('role="status"');
  });
});

describe("the date it shows", () => {
  it("reads as a day and a month", () => {
    expect(bannerDate("2026-12-19")).toBe("19 December");
    expect(bannerDate("2026-01-01")).toBe("1 January");
  });

  it("says nothing rather than something wrong", () => {
    for (const bad of ["", "19/12/2026", "2026-12-19T00:00:00Z", null, undefined]) {
      expect(bannerDate(bad), String(bad)).toBe("");
    }
  });
});

/**
 * The trust bar and the banner cannot both be on this page.
 *
 * They sit one on top of the other and are both dark, so they ran together
 * into a single slab — but the collision is not the real argument. "4.9
 * stars · 500+ events catered" is a sales line, and this customer bought
 * already. Selling to somebody in the middle of amending their own booking
 * is noise at best; at worst it makes the banner look like more marketing
 * rather than the one thing on the page they have to believe.
 */
describe("the trust bar during a change", () => {
  const store = new Map();

  const page = () => {
    const trust = { removed: false, remove() { this.removed = true; } };
    const container = { insertAdjacentHTML() {}, querySelector: () => null };
    vi.stubGlobal("document", { querySelector: (sel) => (sel === ".trust-bar" ? trust : null) });
    return { trust, container };
  };

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("is taken off the page while a booking is being changed", () => {
    startChange({ kind: "change", identifier: "a@b.co", eventDate: "2026-12-19" });
    const { trust, container } = page();
    mountChangeBanner(container, () => {});
    expect(trust.removed).toBe(true);
  });

  it("is left alone when nobody is changing anything", () => {
    const { trust, container } = page();
    expect(mountChangeBanner(container, () => {})).toBeNull();
    expect(trust.removed).toBe(false);
  });

  it("does not fall over on a page that has no trust bar", () => {
    startChange({ kind: "add", identifier: "a@b.co", eventDate: "2026-12-19" });
    vi.stubGlobal("document", { querySelector: () => null });
    expect(() => mountChangeBanner({ insertAdjacentHTML() {}, querySelector: () => null }, () => {}))
      .not.toThrow();
  });
});
