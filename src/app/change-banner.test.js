import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  bannerHtml, bannerDate, mountChangeBanner, removeChangeBanner,
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
 * Mounting: the strip in here, and the notice out there.
 *
 * The in-app strip cannot follow a scroll and cannot leave this app, so the
 * thing that does both is drawn by the GoHighLevel page and driven by the
 * messages below. If those stop, a customer wanders off mid-change with
 * nothing telling her she is in one.
 */
describe("mounting the change notice", () => {
  const store = new Map();

  /**
   * Stand-ins for the container and the window. Records where the strip was
   * inserted, what was posted outward, and what the app listened for — so
   * both halves can be fired without a DOM, same approach as the rest of
   * this suite.
   */
  const page = () => {
    const inserted = [];
    const buttons = {};
    const posted = [];
    const listeners = { message: [] };

    const container = {
      insertAdjacentHTML: (where, html) => inserted.push({ where, html }),
      querySelector: (sel) => {
        const id = sel.replace("#", "");
        buttons[id] ??= { id, handlers: [], addEventListener: (_e, fn) => buttons[id].handlers.push(fn) };
        return buttons[id];
      },
    };

    const win = {
      parent: { postMessage: (m) => posted.push(m) },
      addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    };

    vi.stubGlobal("window", win);
    vi.stubGlobal("document", { querySelector: () => null, getElementById: () => null });
    return { container, inserted, buttons, posted, listeners };
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

  it("puts the strip above the app", () => {
    const { container, inserted } = page();
    mountChangeBanner(container, () => {});

    expect(inserted).toHaveLength(1);
    expect(inserted[0].where).toBe("afterbegin");
    expect(inserted[0].html).toContain('id="sp-change-banner"');
  });

  it("arms the cancel button", () => {
    const { container, buttons } = page();
    mountChangeBanner(container, () => {});
    expect(buttons["sp-change-stop"].handlers).toHaveLength(1);
  });

  /**
   * The page outside pins the notice that follows the customer.
   *
   * Nothing in here can: the frame is sized to its own content and never
   * scrolls, so `fixed` and `sticky` both mean "stay where you were put".
   * And a customer who taps Gallery mid-change leaves this app entirely,
   * while the navbar is on every page. This used to be a second strip at the
   * foot of the builder, which solved neither.
   */
  it("tells the page a change is open", () => {
    const { container, posted } = page();
    mountChangeBanner(container, () => {});

    const msg = posted.find((m) => m.type === "spandis-change");
    expect(msg).toBeTruthy();
    expect(msg.active).toBe(true);
    expect(msg.kind).toBe("change");
  });

  /**
   * startedAt travels so the page can expire its own copy on the same half
   * hour we do, rather than trusting a flag it can never re-check.
   */
  it("sends when the change started, so the page can expire it too", () => {
    const { container, posted } = page();
    mountChangeBanner(container, () => {});

    const msg = posted.find((m) => m.type === "spandis-change");
    expect(Number.isFinite(msg.startedAt)).toBe(true);
  });

  /**
   * Taken back as deliberately as it is given. The page remembers what it was
   * last told, so a change that ended while the tab sat idle — or expired on
   * the half hour — leaves a notice standing over nothing.
   */
  it("tells the page when there is no change, not just when there is", () => {
    store.clear();                      /* no session at all */
    const { container, posted } = page();

    expect(mountChangeBanner(container, () => {})).toBeNull();
    const msg = posted.find((m) => m.type === "spandis-change");
    expect(msg).toBeTruthy();
    expect(msg.active).toBe(false);
  });

  /**
   * Standalone there is no page to tell, and window.parent === window — so
   * posting would have the app delivering the message to itself, which its
   * own cancel listener would then be free to act on.
   */
  it("says nothing when it is not embedded", () => {
    const posted = [];
    const self = {
      postMessage: (m) => posted.push(m),
      addEventListener: () => {},
    };
    self.parent = self;
    vi.stubGlobal("window", self);
    vi.stubGlobal("document", { querySelector: () => null, getElementById: () => null });

    const container = { insertAdjacentHTML: () => {}, querySelector: () => null };
    mountChangeBanner(container, () => {});

    expect(posted).toHaveLength(0);
  });

  it("takes the notice back when the change is sent", () => {
    const posted = [];
    vi.stubGlobal("window", { parent: { postMessage: (m) => posted.push(m) } });
    vi.stubGlobal("document", { querySelector: () => null, getElementById: () => null });

    removeChangeBanner();

    expect(posted.find((m) => m.type === "spandis-change").active).toBe(false);
  });

  /**
   * Cancel pressed out on the page. It cannot end the session itself — that
   * lives in this origin — so it asks, and the answer has to be the same
   * ending the in-app button produces.
   */
  it("cancels when the page asks it to", () => {
    const { container, listeners } = page();
    let cancelled = 0;
    mountChangeBanner(container, () => { cancelled += 1; });

    listeners.message.forEach((fn) => fn({ data: { type: "spandis-cancel-change" } }));

    expect(cancelled).toBe(1);
    expect(readChange()).toBeNull();
  });

  it("ignores anything else the page says", () => {
    const { container, listeners } = page();
    let cancelled = 0;
    mountChangeBanner(container, () => { cancelled += 1; });

    for (const data of [{ type: "spandis-open-cart" }, { type: "" }, null, "cancel"]) {
      listeners.message.forEach((fn) => fn({ data }));
    }

    expect(cancelled).toBe(0);
    expect(readChange()).toBeTruthy();
  });

  it("takes the strip away when the change is over", () => {
    const removed = [];
    vi.stubGlobal("window", { parent: { postMessage: () => {} } });
    vi.stubGlobal("document", {
      querySelector: () => null,
      getElementById: (id) => (id === "sp-change-banner"
        ? { id, remove: () => removed.push(id) } : null),
    });

    removeChangeBanner();
    expect(removed).toContain("sp-change-banner");
  });


  it("does not fall over when neither strip is on the page", () => {
    vi.stubGlobal("document", { querySelector: () => null, getElementById: () => null });
    expect(() => removeChangeBanner()).not.toThrow();
  });

  it("cancelling ends the session, not just the strip", () => {
    const { container, buttons } = page();
    let cancelled = 0;
    mountChangeBanner(container, () => { cancelled += 1; });

    buttons["sp-change-stop"].handlers[0]();

    expect(cancelled).toBe(1);
    // The session is gone too — a cart left behind from an abandoned change
    // would greet them next visit as an order they never placed.
    expect(readChange()).toBeNull();
  });

  /**
   * And the page is told, or its pinned notice stands over a change that no
   * longer exists — still offering to cancel something already cancelled.
   */
  it("takes the notice back when cancelled from in here", () => {
    const { container, buttons, posted } = page();
    mountChangeBanner(container, () => {});

    buttons["sp-change-stop"].handlers[0]();

    const last = posted.filter((m) => m.type === "spandis-change").pop();
    expect(last.active).toBe(false);
  });
});
