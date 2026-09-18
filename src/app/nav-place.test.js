import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { lastPlace, forgetPlace } from "./nav-history.js";

/**
 * Where the customer was, kept across a reload.
 *
 * history.state does not survive a reload and neither does the module's own
 * `current`, so a reload dropped everybody back on the service chooser no
 * matter how deep they were. The cart came back and the builder's draft came
 * back; the only thing lost was their PLACE — which is the one thing they
 * notice, because it looks as though the app forgot them.
 *
 * And it reloads more than you would think: the GoHighLevel navbar moves
 * between PAGES, so tapping the cart and coming back is a reload.
 */
const store = new Map();
const KEY = "spandis:nav:place";

beforeEach(() => {
  store.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});

afterEach(() => vi.unstubAllGlobals());

const saved = (v) => store.set(KEY, JSON.stringify(v));

describe("remembering the screen", () => {
  it("gives back the service, step and view that were saved", () => {
    saved({ service: "combo-trays", step: 2, view: "customize" });
    expect(lastPlace()).toEqual({ service: "combo-trays", step: 2, view: "customize" });
  });

  it("answers nothing when this tab has not been anywhere", () => {
    expect(lastPlace()).toBeNull();
  });

  /**
   * The chooser is not a place. Someone who backed out to it should get the
   * chooser on reload, which is what happens when there is nothing saved —
   * so it must not be restored as though it were a screen.
   */
  it("treats the chooser as no place at all", () => {
    saved({ service: null, step: null, view: null });
    expect(lastPlace()).toBeNull();
  });

  it("drops a step that is not a whole number rather than passing it on", () => {
    // setStep would be handed NaN and the builder would render nothing.
    saved({ service: "party-trays", step: "2", view: null });
    expect(lastPlace().step).toBeNull();
    saved({ service: "party-trays", step: 1.5, view: null });
    expect(lastPlace().step).toBeNull();
  });

  it("drops a view that is not a string", () => {
    saved({ service: "combo-trays", step: 1, view: 7 });
    expect(lastPlace().view).toBeNull();
  });

  it("survives a corrupted entry rather than throwing on boot", () => {
    // This runs during mount. Throwing here takes the whole app down.
    store.set(KEY, "{not json");
    expect(lastPlace()).toBeNull();
    store.set(KEY, '"a string"');
    expect(lastPlace()).toBeNull();
  });

  it("survives storage being unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => { throw new Error("SecurityError"); },
      removeItem: () => { throw new Error("SecurityError"); },
    });
    expect(lastPlace()).toBeNull();
    expect(() => forgetPlace()).not.toThrow();
  });

  it("is forgotten once there is nothing to come back to", () => {
    saved({ service: "combo-trays", step: 2, view: null });
    forgetPlace();
    expect(lastPlace()).toBeNull();
  });
});
