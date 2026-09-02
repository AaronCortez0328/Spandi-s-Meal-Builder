import { describe, it, expect } from "vitest";
import {
  blockFor, isBlocked, blockMessage, todayInManila, upcomingBlocks, shortDate, nextOpenDate,
  earliestBookableDate, STANDARD_LEAD_DAYS, RUSH_LEAD_DAYS,
} from "./availability.js";

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

describe("upcomingBlocks", () => {
  const TODAY = "2026-08-08";

  it("drops dates already past", () => {
    const rows = [
      { blocked_date: "2026-08-01", branch: null, reason: "Holiday" },
      { blocked_date: "2026-08-09", branch: null, reason: "Holiday" },
    ];
    expect(upcomingBlocks(rows, { today: TODAY }).map((r) => r.blocked_date))
      .toEqual(["2026-08-09"]);
  });

  it("keeps today itself — it is still bookable until it is not", () => {
    const rows = [{ blocked_date: TODAY, branch: null, reason: "Fully booked" }];
    expect(upcomingBlocks(rows, { today: TODAY })).toHaveLength(1);
  });

  it("stops at the horizon", () => {
    const rows = [
      { blocked_date: "2026-09-01", branch: null, reason: "Holiday" },
      { blocked_date: "2027-08-08", branch: null, reason: "Holiday" },
    ];
    expect(upcomingBlocks(rows, { today: TODAY, withinDays: 90 })).toHaveLength(1);
  });

  it("with a branch chosen, shows that branch's and every-branch closures", () => {
    const got = upcomingBlocks(ROWS, { today: TODAY, branch: "Cavite" });
    expect(got.map((r) => `${r.blocked_date}/${r.branch ?? "*"}`))
      .toEqual(["2026-08-08/Cavite", "2026-08-09/*", "2026-08-10/*"]);
  });

  it("with no branch chosen, shows only every-branch closures", () => {
    const got = upcomingBlocks(ROWS, { today: TODAY, branch: null });
    expect(got.every((r) => r.branch == null)).toBe(true);
  });

  it("sorts soonest first", () => {
    const rows = [
      { blocked_date: "2026-08-20", branch: null, reason: "Holiday" },
      { blocked_date: "2026-08-11", branch: null, reason: "Holiday" },
    ];
    expect(upcomingBlocks(rows, { today: TODAY })[0].blocked_date).toBe("2026-08-11");
  });

  it("survives junk", () => {
    expect(upcomingBlocks(null, { today: TODAY })).toEqual([]);
    expect(upcomingBlocks(ROWS, {})).toEqual([]);
  });
});

describe("shortDate", () => {
  it("formats without shifting the calendar day", () => {
    expect(shortDate("2026-08-14")).toBe("14 Aug");
    expect(shortDate("2026-01-01")).toBe("1 Jan");
    expect(shortDate("2026-12-31")).toBe("31 Dec");
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

describe("nextOpenDate", () => {
  const rows = [
    { blocked_date: "2026-08-28", branch: null, reason: "Maintenance" },
    { blocked_date: "2026-08-29", branch: null, reason: "Maintenance" },
    { blocked_date: "2026-08-30", branch: "Cavite", reason: "Fully booked" },
  ];

  it("names the first day the kitchen is open", () => {
    expect(nextOpenDate(rows, "2026-08-28")).toBe("2026-08-30");
  });

  it("gives back the day asked for when it is already open", () => {
    expect(nextOpenDate(rows, "2026-09-05")).toBe("2026-09-05");
  });

  // Same rule as blockFor: with a branch chosen, that branch's own closures
  // count as well as the all-branch ones.
  it("skips a closure that only affects the chosen branch", () => {
    expect(nextOpenDate(rows, "2026-08-28", "Cavite")).toBe("2026-08-31");
    expect(nextOpenDate(rows, "2026-08-28", "Batangas")).toBe("2026-08-30");
  });

  // The list fails open, so an empty one means every date is bookable.
  it("suggests the same day when nothing is blocked at all", () => {
    expect(nextOpenDate([], "2026-08-28")).toBe("2026-08-28");
  });

  // Better to say nothing than to point at a date three months out as
  // though it were the answer.
  it("gives up rather than suggesting a date beyond the window", () => {
    const shutAllWeek = ["2026-09-01", "2026-09-02", "2026-09-03"]
      .map((d) => ({ blocked_date: d, branch: null, reason: "Closed" }));

    // Only looks two days ahead, and all three are shut.
    expect(nextOpenDate(shutAllWeek, "2026-09-01", null, 2)).toBe(null);
    // One more day of looking reaches the first open one.
    expect(nextOpenDate(shutAllWeek, "2026-09-01", null, 3)).toBe("2026-09-04");
  });

  it("has nothing to say without a starting date", () => {
    expect(nextOpenDate(rows, null)).toBe(null);
  });
});

describe("earliestBookableDate", () => {
  // Fixed instant, mid-UTC-day, so the answer does not depend on when the
  // suite happens to run.
  const at0300Utc = new Date("2026-08-08T03:00:00Z"); // 2026-08-08 in Manila

  it("gives the kitchen three days on a standard order", () => {
    expect(earliestBookableDate(false, at0300Utc)).toBe("2026-08-11");
  });

  it("gives two on a rush order", () => {
    expect(earliestBookableDate(true, at0300Utc)).toBe("2026-08-10");
  });

  it("treats a missing argument as standard, not rush", () => {
    expect(earliestBookableDate(undefined, at0300Utc)).toBe(earliestBookableDate(false, at0300Utc));
  });

  // Rush buys exactly one day. If these two ever drift apart, the note under
  // the date field and the rush card both start lying about the same rule.
  it("is exactly one day earlier for rush", () => {
    expect(STANDARD_LEAD_DAYS - RUSH_LEAD_DAYS).toBe(1);
  });

  // The whole reason it counts from Manila: at 16:00 UTC the kitchen is
  // already on the next day, and a UTC floor would offer a date it cannot
  // actually serve.
  it("counts from today in Manila, not UTC", () => {
    const at1600Utc = new Date("2026-08-08T16:00:00Z"); // 2026-08-09 in Manila
    expect(earliestBookableDate(false, at1600Utc)).toBe("2026-08-12");
  });

  it("crosses a month boundary without landing on the 31st of a 30-day month", () => {
    const endOfSept = new Date("2026-09-29T03:00:00Z");
    expect(earliestBookableDate(false, endOfSept)).toBe("2026-10-02");
  });
});
