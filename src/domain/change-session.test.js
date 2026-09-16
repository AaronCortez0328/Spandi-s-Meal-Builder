import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  startChange, readChange, endChange, inChangeMode, SESSION_MS, KINDS,
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
