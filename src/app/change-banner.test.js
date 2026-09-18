import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  bannerHtml, bannerFootHtml, bannerDate, mountChangeBanner, removeChangeBanner,
} from "./change-banner.js";
import { startChange, readChange } from "../domain/change-session.js";

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

/**
 * The way out, repeated at the foot.
 *
 * On a phone the head strip is gone after one swipe and it CANNOT be pinned:
 * this app renders inside an iframe sized to its own content, so nothing in
 * it ever scrolls and both `sticky` and `fixed` are no-ops. The exit is
 * therefore repeated rather than followed, at the place somebody who has
 * changed their mind actually ends up.
 */
describe("the way out at the foot", () => {
  const change = { kind: "change", eventDate: "2026-12-19", identifier: "a@b.co" };
  const add    = { ...change, kind: "add" };

  it("offers a cancel of its own", () => {
    expect(bannerFootHtml(change)).toMatch(/cancel/i);
  });

  /**
   * "Cancel" alone is fine beside a heading that says what is being
   * cancelled. Down here there is no heading above it, so the button has to
   * carry its own object or it reads as cancelling the last thing touched.
   */
  it("says what it cancels, having no heading above it to lean on", () => {
    expect(bannerFootHtml(change)).toMatch(/cancel this change/i);
    expect(bannerFootHtml(add)).toMatch(/cancel this addition/i);
  });

  it("still says nothing is saved yet", () => {
    expect(bannerFootHtml(change)).toMatch(/nothing is saved/i);
    expect(bannerFootHtml(add)).toMatch(/nothing is saved/i);
  });

  /**
   * Not a second role="status". One live region per change is the point;
   * two announce the same state twice to a screen reader.
   */
  it("does not announce itself a second time", () => {
    expect(bannerFootHtml(change)).not.toContain('role="status"');
  });

  it("carries its own id, so both strips can be taken away together", () => {
    expect(bannerFootHtml(change)).toContain('id="sp-change-foot"');
    expect(bannerFootHtml(change)).toContain('id="sp-change-stop-foot"');
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

/**
 * Both exits have to work, and both have to arm.
 *
 * A foot strip that renders and does nothing is worse than no foot strip:
 * somebody who scrolled to the end looking for a way out found one, pressed
 * it, and is still in the change with no reason to believe pressing it again
 * will help.
 */
describe("mounting both exits", () => {
  const store = new Map();

  /**
   * Stand-in for the container. Records where each strip was inserted and
   * hands back a fake button per id, so the listeners can be fired without a
   * DOM — same approach the rest of this suite uses.
   */
  const page = () => {
    const inserted = [];
    const buttons = {};
    const container = {
      insertAdjacentHTML: (where, html) => inserted.push({ where, html }),
      querySelector: (sel) => {
        const id = sel.replace("#", "");
        buttons[id] ??= { id, handlers: [], addEventListener: (_e, fn) => buttons[id].handlers.push(fn) };
        return buttons[id];
      },
    };
    vi.stubGlobal("document", { querySelector: () => null, getElementById: () => null });
    return { container, inserted, buttons };
  };

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    });
    startChange({ kind: "change", identifier: "a@b.co", eventDate: "2026-12-19" });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("puts one strip at the top and one at the bottom", () => {
    const { container, inserted } = page();
    mountChangeBanner(container, () => {});

    expect(inserted).toHaveLength(2);
    expect(inserted[0].where).toBe("afterbegin");
    expect(inserted[0].html).toContain('id="sp-change-banner"');
    expect(inserted[1].where).toBe("beforeend");
    expect(inserted[1].html).toContain('id="sp-change-foot"');
  });

  /**
   * The foot strip goes INSIDE #main-content, unlike the head strip.
   *
   * The iframe tells the GoHighLevel page how tall to be, and the measure
   * that wins is index.html's inline one: #main-content.offsetHeight + 48,
   * re-broadcast every 250ms. Anything outside that element is not counted —
   * so a foot strip appended to <body> sits below the height the parent was
   * told about and is simply cut off. An exit nobody can reach is worse than
   * the one that scrolled away.
   */
  it("puts the foot strip inside the element the iframe height is measured from", () => {
    const shell = { inserted: [], insertAdjacentHTML: (where, html) => shell.inserted.push({ where, html }) };
    const { container, inserted } = page();
    vi.stubGlobal("document", {
      querySelector: () => null,
      getElementById: (id) => (id === "main-content" ? shell : null),
    });

    mountChangeBanner(container, () => {});

    // Head strip on the container, foot strip on the measured shell.
    expect(inserted).toHaveLength(1);
    expect(inserted[0].html).toContain('id="sp-change-banner"');
    expect(shell.inserted).toHaveLength(1);
    expect(shell.inserted[0].where).toBe("beforeend");
    expect(shell.inserted[0].html).toContain('id="sp-change-foot"');
  });

  it("arms both buttons, not just the first one found", () => {
    const { container, buttons } = page();
    mountChangeBanner(container, () => {});

    expect(buttons["sp-change-stop"].handlers).toHaveLength(1);
    expect(buttons["sp-change-stop-foot"].handlers).toHaveLength(1);
  });

  /**
   * Both strips go together when the change ends.
   *
   * The head strip's own comment already spells out why: "We have your
   * change" drawn under a strip still offering to cancel it leaves the
   * customer unable to tell which of the two is true. A forgotten foot
   * strip is the same contradiction, just further down the page — and
   * nothing caught it until this test existed.
   */
  it("takes both strips away when the change is over", () => {
    const removed = [];
    const el = (id) => ({ id, remove: () => removed.push(id) });
    vi.stubGlobal("document", {
      querySelector: () => null,
      getElementById: (id) => (["sp-change-banner", "sp-change-foot"].includes(id) ? el(id) : null),
    });

    removeChangeBanner();

    expect(removed).toContain("sp-change-banner");
    expect(removed).toContain("sp-change-foot");
  });

  it("does not fall over when neither strip is on the page", () => {
    vi.stubGlobal("document", { querySelector: () => null, getElementById: () => null });
    expect(() => removeChangeBanner()).not.toThrow();
  });

  it("cancels the same way from either end", () => {
    for (const id of ["sp-change-stop", "sp-change-stop-foot"]) {
      store.clear();
      startChange({ kind: "change", identifier: "a@b.co", eventDate: "2026-12-19" });
      const { container, buttons } = page();
      let cancelled = 0;
      mountChangeBanner(container, () => { cancelled += 1; });

      buttons[id].handlers[0]();

      expect(cancelled, id).toBe(1);
      // The session is gone too — a cart left behind from an abandoned
      // change would greet them next visit as an order they never placed.
      expect(readChange(), id).toBeNull();
    }
  });
});
