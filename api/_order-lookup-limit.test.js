import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The brake on the only unauthenticated read in the system.
 *
 * Two things are guarded: that a run of failures actually stops, and that a
 * database problem never does. Those pull in opposite directions, which is
 * why they are asserted together.
 */
let ROWS, INSERTED, THROW;

vi.mock("./_supabase-admin.js", () => ({
  supabaseAdmin: {
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        gte: async () => {
          if (THROW) throw new Error("connection reset");
          return { data: ROWS, error: THROW === "error" ? { message: "x" } : null };
        },
        insert: async (row) => { INSERTED = row; return { error: null }; },
      };
      return q;
    },
  },
}));

const { checkLookupLimit, recordLookup, FAILED_PER_HOUR, FAILED_PER_DAY, TOTAL_PER_HOUR } =
  await import("./_order-lookup-limit.js");

const now = Date.now();
const ago = (mins) => new Date(now - mins * 60000).toISOString();
const rows = (n, found, mins = 5) => Array.from({ length: n }, () => ({ created_at: ago(mins), found }));

beforeEach(() => { ROWS = []; INSERTED = null; THROW = false; });

describe("guessing is what gets stopped", () => {
  it("allows a customer who finds their order", async () => {
    ROWS = rows(3, false);
    expect((await checkLookupLimit("1.2.3.4")).allowed).toBe(true);
  });

  it("stops a run of failures within the hour", async () => {
    ROWS = rows(FAILED_PER_HOUR, false);
    expect((await checkLookupLimit("1.2.3.4")).allowed).toBe(false);
  });

  it("stops a slower run spread across the day", async () => {
    ROWS = rows(FAILED_PER_DAY, false, 600);
    expect((await checkLookupLimit("1.2.3.4")).allowed).toBe(false);
  });

  it("does not punish a customer refreshing their own order", async () => {
    // Successes are counted far more loosely than misses on purpose.
    ROWS = rows(FAILED_PER_HOUR + 5, true);
    expect((await checkLookupLimit("1.2.3.4")).allowed).toBe(true);
  });

  it("still caps sheer volume, however successful", async () => {
    ROWS = rows(TOTAL_PER_HOUR, true);
    expect((await checkLookupLimit("1.2.3.4")).allowed).toBe(false);
  });

  it("ignores failures that have aged out of the hour", async () => {
    ROWS = rows(FAILED_PER_HOUR, false, 90);
    expect((await checkLookupLimit("1.2.3.4")).allowed).toBe(true);
  });

  it("counts misses far more tightly than successes", () => {
    expect(FAILED_PER_HOUR).toBeLessThan(TOTAL_PER_HOUR);
  });
});

describe("a database problem never refuses a customer", () => {
  it("allows the lookup when the count query errors", async () => {
    THROW = "error";
    expect((await checkLookupLimit("1.2.3.4")).allowed).toBe(true);
  });

  it("allows the lookup when the query throws outright", async () => {
    THROW = true;
    expect((await checkLookupLimit("1.2.3.4")).allowed).toBe(true);
  });

  it("never blocks a decided lookup when recording fails", async () => {
    THROW = true;
    await expect(recordLookup("1.2.3.4", true)).resolves.toBeUndefined();
  });
});

describe("what is recorded", () => {
  it("marks whether the lookup found an order, which is what gets throttled", async () => {
    await recordLookup("1.2.3.4", false);
    expect(INSERTED).toEqual({ ip: "1.2.3.4", found: false });
    await recordLookup("1.2.3.4", true);
    expect(INSERTED.found).toBe(true);
  });

  it("coerces a missing verdict to a miss rather than writing null", async () => {
    await recordLookup("1.2.3.4", undefined);
    expect(INSERTED.found).toBe(false);
  });

  it("does nothing without an address to count against", async () => {
    await recordLookup("", true);
    expect(INSERTED).toBeNull();
    expect((await checkLookupLimit("")).allowed).toBe(true);
  });
});
