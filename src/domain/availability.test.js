import { describe, it, expect } from "vitest";
import { blockFor, isBlocked, blockMessage, todayInManila } from "./availability.js";

/**
 * These assert the semantics the dashboard team wrote down, in their words,
 * so a later change to this file has to disagree with the agreement out loud
 * rather than quietly.
 */

const ROWS = [
  { blocked_date: "2026-08-08", branch: "Cavite",   reason: "Fully booked" },
  { blocked_date: "2026-08-09", branch: null,       reason: "Holiday" },
  { blocked_date: "2026-08-10", branch: "Batangas", reason: "Private event" },
  { blocked_date: "2026-08-10", branch: null,       reason: "Holiday" },
];

describe("blockFor", () => {
  it("treats absence as availability", () => {
    expect(blockFor([], "2026-08-08", "Cavite")).toBeNull();
    expect(blockFor(ROWS, "2026-08-07", "Cavite")).toBeNull();
  });

  it("blocks only the named branch", () => {
    expect(blockFor(ROWS, "2026-08-08", "Cavite")?.reason).toBe("Fully booked");
    expect(blockFor(ROWS, "2026-08-08", "Batangas")).toBeNull();
    expect(blockFor(ROWS, "2026-08-08", "Montalban")).toBeNull();
  });

  it("blocks every branch when branch is null", () => {
    for (const b of ["Cavite", "Batangas", "Montalban"]) {
      expect(blockFor(ROWS, "2026-08-09", b)?.reason).toBe("Holiday");
    }
  });

  // "If the date comes first, treat a date as unavailable only when it's
  // blocked for all branches."
  it("with no branch chosen, only an all-branch block counts", () => {
    expect(blockFor(ROWS, "2026-08-08", null)).toBeNull();      // Cavite only
    expect(blockFor(ROWS, "2026-08-09", null)?.reason).toBe("Holiday");
  });

  it("prefers the all-branch row when both exist for a date", () => {
    expect(blockFor(ROWS, "2026-08-10", "Batangas")?.branch).toBeNull();
  });

  it("survives junk without throwing", () => {
    expect(blockFor(null, "2026-08-08", "Cavite")).toBeNull();
    expect(blockFor(ROWS, "", "Cavite")).toBeNull();
    expect(blockFor(ROWS, null, "Cavite")).toBeNull();
    expect(isBlocked(undefined, "2026-08-09")).toBe(false);
  });
});

describe("blockMessage", () => {
  it("leads with the reason", () => {
    expect(blockMessage(ROWS[0])).toBe("Fully booked at Cavite — please choose another date.");
  });

  it("omits the branch for an all-branch block", () => {
    expect(blockMessage(ROWS[1])).toBe("Holiday — please choose another date.");
  });

  it("still says something when the reason is missing", () => {
    const m = blockMessage({ blocked_date: "2026-08-08", branch: "Cavite", reason: null });
    expect(m).toBe("Not available at Cavite — please choose another date.");
    expect(blockMessage({ blocked_date: "x", branch: null, reason: "   " }))
      .toBe("Not available — please choose another date.");
  });

  it("is empty for no block", () => {
    expect(blockMessage(null)).toBe("");
  });
});

describe("todayInManila", () => {
  it("returns an ISO calendar date", () => {
    expect(todayInManila()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // The reason the function exists: at 16:00 UTC it is already tomorrow in
  // Manila, so a UTC-based "today" would call a date past that the kitchen
  // still has ahead of it.
  it("is a day ahead of UTC late in the UTC day", () => {
    const at1600Utc = new Date("2026-08-08T16:00:00Z");
    expect(todayInManila(at1600Utc)).toBe("2026-08-09");
  });

  it("agrees with UTC in the middle of the UTC day", () => {
    const at0300Utc = new Date("2026-08-08T03:00:00Z");
    expect(todayInManila(at0300Utc)).toBe("2026-08-08");
  });
});
