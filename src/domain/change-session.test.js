import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  startChange, readChange, endChange, inChangeMode, markPrepared, touchChange,
  changeExpired, clearExpiry, SESSION_MS, KINDS,
} from "./change-session.js";

/**
 * The handoff between Order Status and the builder.
 *
 * What matters is that it fails to NOTHING. A customer who cannot be
 * recognised must be told changing is unavailable, never dropped into a
 * builder that looks like a new order — because an order built in that state
 * and submitted would be a second booking, not a change.
 */
const store = new Map();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});

afterEach(() => vi.unstubAllGlobals());

const session = (over) => ({
  kind: "change", identifier: "a@b.co", eventDate: "2026-12-19",
  opportunityId: "opp1", ...over,
});

describe("carrying a change to the builder", () => {
  it("remembers who is changing what", () => {
    expect(startChange(session())).toBe(true);
    const out = readChange();
    expect(out.identifier).toBe("a@b.co");
    expect(out.eventDate).toBe("2026-12-19");
    expect(out.kind).toBe("change");
  });

  it("carries adding as well as changing", () => {
    startChange(session({ kind: "add" }));
    expect(readChange().kind).toBe("add");
    expect(KINDS).toEqual(["change", "add"]);
  });

  it("says nothing is in progress when nothing is", () => {
    expect(readChange()).toBeNull();
    expect(inChangeMode()).toBe(false);
  });

  it("ends when told to", () => {
    startChange(session());
    endChange();
    expect(readChange()).toBeNull();
  });
});

describe("what it refuses to start", () => {
  it("refuses a kind it does not know", () => {
    // Defaulting on a typo would put the builder in the wrong mode, and an
    // order built as an "add" but meant as a change adds instead of replacing.
    expect(startChange(session({ kind: "resize" }))).toBe(false);
    expect(startChange(session({ kind: undefined }))).toBe(false);
    expect(readChange()).toBeNull();
  });

  it("refuses nothing at all", () => {
    expect(startChange(null)).toBe(false);
    expect(startChange(undefined)).toBe(false);
  });
});

describe("what it refuses to read back", () => {
  it("ignores a session missing who it belongs to", () => {
    store.set("sp_change", JSON.stringify({ kind: "change", startedAt: Date.now() }));
    expect(readChange()).toBeNull();
  });

  it("ignores a session missing the booking", () => {
    store.set("sp_change", JSON.stringify({ kind: "change", identifier: "a@b.co", startedAt: Date.now() }));
    expect(readChange()).toBeNull();
  });

  it("ignores anything that is not a session at all", () => {
    store.set("sp_change", "not json");
    expect(readChange()).toBeNull();
  });
});

describe("going stale", () => {
  it("expires after half an hour", () => {
    const t = 1_000_000;
    startChange(session());
    store.set("sp_change", JSON.stringify({ ...session(), startedAt: t }));
    expect(readChange(t + SESSION_MS - 1)).not.toBeNull();
    expect(readChange(t + SESSION_MS + 1)).toBeNull();
  });

  it("clears a stale session as it finds it, so the next read is honest too", () => {
    const t = 1_000_000;
    store.set("sp_change", JSON.stringify({ ...session(), startedAt: t }));
    readChange(t + SESSION_MS + 1);
    expect(store.has("sp_change")).toBe(false);
  });

  it("treats a session with no timestamp as stale, not as eternally fresh", () => {
    // Number(undefined) is NaN and every NaN comparison is false, so an
    // unchecked age test would let this one live forever.
    store.set("sp_change", JSON.stringify(session()));
    expect(readChange()).toBeNull();
  });
});

describe("when storage is unavailable", () => {
  it("answers false rather than throwing, so the screen can say so", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    });
    expect(startChange(session())).toBe(false);
    expect(readChange()).toBeNull();
    expect(inChangeMode()).toBe(false);
    expect(() => endChange()).not.toThrow();
  });
});

/**
 * Whether the builder has already emptied the cart and filled it from the
 * booking. The flag exists because doing that on EVERY load of the builder
 * page destroys the customer's work — and the page does reload, because the
 * cart button on the GoHighLevel navbar navigates between pages.
 */
describe("remembering that the cart has been prepared", () => {
  it("starts unprepared", () => {
    startChange(session());
    expect(readChange().prepared).toBeFalsy();
  });

  it("stays prepared across reads", () => {
    startChange(session());
    expect(markPrepared()).toBe(true);
    expect(readChange().prepared).toBe(true);
  });

  it("keeps everything else the session was carrying", () => {
    startChange(session({ packageId: "mary-rose-100", was: { total: 35000 } }));
    markPrepared();
    const out = readChange();
    expect(out.packageId).toBe("mary-rose-100");
    expect(out.was.total).toBe(35000);
    expect(out.identifier).toBe("a@b.co");
  });

  /**
   * Re-stamping startedAt here would hand out a fresh half hour on every
   * page load, which is an expiry that never expires.
   */
  it("does not push the expiry out", () => {
    const t0 = Date.parse("2026-09-16T10:00:00Z");
    vi.setSystemTime?.(t0);
    startChange(session());
    const started = readChange().startedAt;
    markPrepared(started + 60_000);
    expect(readChange(started + 60_000).startedAt).toBe(started);
    // Still gone at the half hour, counted from the original start.
    expect(readChange(started + SESSION_MS + 1)).toBeNull();
  });

  it("does nothing, and says so, when there is no change in progress", () => {
    expect(markPrepared()).toBe(false);
  });

  it("answers false rather than throwing when storage refuses to write", () => {
    startChange(session());
    vi.stubGlobal("sessionStorage", {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: (k) => store.delete(k),
    });
    expect(markPrepared()).toBe(false);
  });
});

/**
 * Running out of time, and what must not happen when you do.
 *
 * The builder IS the ordering screen. Without a session the checkout draws a
 * contact form and Send places a booking — so a customer whose half hour ran
 * out while they chose dishes would have filled that form with the change
 * banner still above it, and made a SECOND booking believing they were
 * amending the one they had. That is the exact failure this whole flow
 * exists to prevent, arriving through the back door.
 */
describe("when a change runs out of time", () => {
  const start = Date.parse("2026-09-16T10:00:00Z");
  const stale = start + SESSION_MS + 1;

  it("leaves a mark, so the screens know not to sell them something", () => {
    startChange(session());
    expect(changeExpired()).toBe(false);
    expect(readChange(stale)).toBeNull();
    expect(changeExpired()).toBe(true);
  });

  it("leaves no mark when the change was sent or cancelled", () => {
    // In both of those the customer knows what happened and is free to
    // place an ordinary order.
    startChange(session());
    endChange();
    expect(changeExpired()).toBe(false);
  });

  it("forgets an old expiry when a new change begins", () => {
    startChange(session());
    readChange(stale);
    expect(changeExpired()).toBe(true);
    startChange(session());
    expect(changeExpired()).toBe(false);
  });

  it("can be cleared once the customer has been told", () => {
    startChange(session());
    readChange(stale);
    clearExpiry();
    expect(changeExpired()).toBe(false);
  });

  it("says no rather than throwing where storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
      removeItem: () => { throw new Error("SecurityError"); },
    });
    expect(changeExpired()).toBe(false);
    expect(() => clearExpiry()).not.toThrow();
  });
});

/**
 * SESSION_MS is an IDLE timeout, not a deadline. Choosing dishes for a
 * hundred-pax package takes longer than half an hour.
 */
describe("staying alive while the customer is still working", () => {
  const start = Date.parse("2026-09-16T10:00:00Z");

  it("pushes the half hour out from now", () => {
    startChange(session());
    const at = readChange().startedAt;
    const later = at + SESSION_MS - 1000;
    expect(touchChange(later)).toBe(true);
    // Would have been dead a second later without the touch.
    expect(readChange(later + SESSION_MS - 1)).not.toBeNull();
  });

  it("keeps everything the session was carrying", () => {
    startChange(session({ packageId: "fam-c1", prepared: true }));
    touchChange(readChange().startedAt + 1000);
    const out = readChange();
    expect(out.packageId).toBe("fam-c1");
    expect(out.prepared).toBe(true);
    expect(out.identifier).toBe("a@b.co");
  });

  it("cannot revive one that has already gone", () => {
    startChange(session());
    const at = readChange().startedAt;
    expect(touchChange(at + SESSION_MS + 1)).toBe(false);
    expect(readChange(at + SESSION_MS + 2)).toBeNull();
  });

  it("does nothing when nobody is changing anything", () => {
    expect(touchChange(start)).toBe(false);
  });
});
