import { describe, it, expect, vi, afterEach } from "vitest";
import { jumpTo } from "./ui-fx.js";

/**
 * A step change has to move the page, and embedded it cannot move it alone.
 *
 * The frame is `scrolling="no"` and grown to its content, so it has no scroll
 * box; the GoHighLevel page around it is what scrolls, and that is
 * cross-origin. scrollIntoView therefore works in dev — where the frame IS
 * the viewport — and is silently inert in production. Every builder called
 * it, all five looked right locally, and on a phone a customer who scrolled
 * down to tap "25 pax" landed halfway down a combo screen they had never seen
 * the top of.
 *
 * So jumpTo now does both: scrolls what it can, and asks the parent for what
 * it cannot.
 */

afterEach(() => { vi.unstubAllGlobals(); });

/** A stand-in element. No DOM in this suite — see the note in cart.test.js. */
const elementAt = (top, height = 400) => ({
  scrolled: null,
  scrollIntoView(opts) { this.scrolled = opts; },
  getBoundingClientRect: () => ({ top, height }),
});

/** A window whose parent is somebody else — i.e. embedded. */
function embedded({ scrollY = 0, throws = false } = {}) {
  const posted = [];
  const parent = {
    postMessage: (msg) => {
      if (throws) throw new Error("cross-origin");
      posted.push(msg);
    },
  };
  vi.stubGlobal("window", { parent, scrollY });
  return posted;
}

describe("jumpTo", () => {
  it("still scrolls what it can reach", () => {
    embedded();
    const el = elementAt(1200);
    jumpTo(el);
    expect(el.scrolled).toEqual({ behavior: "instant", block: "start" });
  });

  /**
   * "instant", not "auto". `auto` defers to the CSS scroll-behavior, which is
   * smooth on <html> — so the obvious spelling would have changed nothing,
   * and a step change would still fly two thousand pixels past a phone.
   */
  it("never animates the journey", () => {
    embedded();
    const el = elementAt(1200);
    jumpTo(el);
    expect(el.scrolled.behavior).toBe("instant");
  });

  it("asks the parent to scroll as well", () => {
    const posted = embedded();
    jumpTo(elementAt(1200));

    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe("spandis-scroll");
  });

  /**
   * An offset down OUR document, not a viewport coordinate. The parent knows
   * where the frame sits on its page and what its navbar covers; it needs
   * only the distance, and adds the rest. Sending a viewport figure would
   * repeat the mistake spandis-view exists to fix.
   */
  it("sends a distance down the builder, not a viewport position", () => {
    const posted = embedded({ scrollY: 0 });
    jumpTo(elementAt(1200));
    expect(posted[0].top).toBe(1200);
  });

  it("counts our own scroll too, so the figure holds when run standalone", () => {
    const posted = embedded({ scrollY: 500 });
    jumpTo(elementAt(300));
    expect(posted[0].top).toBe(800);
  });

  /** A negative offset is not a place; it would scroll the page upward. */
  it("never sends a negative offset", () => {
    const posted = embedded({ scrollY: 0 });
    jumpTo(elementAt(-90));
    expect(posted[0].top).toBe(0);
  });

  /**
   * block travels with it, so the parent can honour "center" and "nearest"
   * instead of flattening every jump to the top of the element.
   */
  it("passes the block through so the parent can honour it", () => {
    let posted = embedded();
    jumpTo(elementAt(100), "center");
    expect(posted[0].block).toBe("center");

    vi.unstubAllGlobals();
    posted = embedded();
    jumpTo(elementAt(100), "nearest");
    expect(posted[0].block).toBe("nearest");
  });

  /** "nearest" needs the height to know whether it is already on screen. */
  it("sends the height, so nearest can mean only-if-off-screen", () => {
    const posted = embedded();
    jumpTo(elementAt(100, 640));
    expect(posted[0].height).toBe(640);
  });

  /**
   * Standalone, there is no parent to ask and window.parent === window.
   * Posting to ourselves would have the app answering its own message.
   */
  it("says nothing when it is not embedded", () => {
    const posted = [];
    const self = { postMessage: (m) => posted.push(m), scrollY: 0 };
    self.parent = self;
    vi.stubGlobal("window", self);

    const el = elementAt(1200);
    jumpTo(el);

    expect(posted).toHaveLength(0);
    // The local scroll still happens — that is the standalone case working.
    expect(el.scrolled).toBeTruthy();
  });

  /**
   * Fails open. A parent that refuses the message leaves the page where it
   * was, which is exactly today's behaviour — so this can make nothing worse.
   */
  it("survives a parent that refuses to be spoken to", () => {
    embedded({ throws: true });
    expect(() => jumpTo(elementAt(1200))).not.toThrow();
  });

  it("does nothing at all without an element", () => {
    const posted = embedded();
    expect(() => jumpTo(null)).not.toThrow();
    expect(posted).toHaveLength(0);
  });
});
