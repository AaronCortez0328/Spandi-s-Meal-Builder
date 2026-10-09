import { describe, it, expect } from "vitest";
import {
  readyTimeFor, gapFor, gapInWords, isPickup, minutesOfDay,
  ASSISTED_DELIVERY, CLIENT_PICKUP, KITCHEN_HOURS, kitchenHoursFor, MIN_SENSIBLE_GAP,
  isWithinKitchenHours,
} from "./ready-time.js";

/**
 * The arithmetic behind the only time question left on the form.
 *
 * Two in three customers used to put the event start into the delivery-time
 * field. The field is gone; this works the answer out instead. Which means
 * every number it produces is now a promise the kitchen has to keep, made
 * without anyone checking it — so the clamp against kitchen hours, and what
 * is said when that clamp bites, are the whole of the risk.
 */
describe("the ready time, for an ordinary evening event", () => {
  it("lands two hours before an assisted delivery", () => {
    const r = readyTimeFor("18:00", ASSISTED_DELIVERY);
    expect(r.time).toBe("16:00");
    expect(r.gapMinutes).toBe(120);
    expect(r.clamped).toBeNull();
    expect(r.tooLate).toBe(false);
  });

  it("lands an hour and a half before a pickup", () => {
    const r = readyTimeFor("18:00", CLIENT_PICKUP);
    expect(r.time).toBe("16:30");
    expect(r.gapMinutes).toBe(90);
  });

  /** A rider has a road to drive; a customer collecting judges their own. */
  it("allows longer for the rider than for the customer", () => {
    expect(gapFor(ASSISTED_DELIVERY)).toBeGreaterThan(gapFor(CLIENT_PICKUP));
  });

  it("treats an unknown method as the delivery case, never the shorter one", () => {
    expect(gapFor("something else")).toBe(gapFor(ASSISTED_DELIVERY));
    expect(gapFor(undefined)).toBe(gapFor(ASSISTED_DELIVERY));
  });
});

/**
 * The kitchen window, which is the part that can produce a lie.
 *
 * 06:00 to 17:00. Subtracting two hours from an early event gives a time the
 * kitchen is shut, and from a late one gives a time it has closed. Both have
 * to come back inside the window, and the caller has to be told, or it will
 * print "two hours before your event" over a figure that is nothing of the
 * kind.
 */
describe("when the kitchen window bites", () => {
  it("never promises a time before Cavite opens", () => {
    const r = readyTimeFor("07:00", ASSISTED_DELIVERY, "Cavite");
    expect(r.time).toBe("06:00");
    expect(r.clamped).toBe("open");
    expect(r.gapMinutes).toBe(60);          // an hour, not the two asked for
    expect(r.requestedGap).toBe(120);
  });

  /**
   * Batangas and Montalban open at eight, so the same event gets a different
   * answer. Quoting Cavite's six on either of them would be a promise that
   * kitchen cannot keep — made by us, not asked for by the customer.
   */
  it("holds each branch to its own opening time", () => {
    expect(readyTimeFor("09:00", ASSISTED_DELIVERY, "Cavite").time).toBe("07:00");
    expect(readyTimeFor("09:00", ASSISTED_DELIVERY, "Batangas").time).toBe("08:00");
    expect(readyTimeFor("09:00", ASSISTED_DELIVERY, "Montalban").time).toBe("08:00");
  });

  it("never promises a time after it closes", () => {
    const r = readyTimeFor("21:00", ASSISTED_DELIVERY, "Cavite");
    expect(r.time).toBe("17:00");
    expect(r.clamped).toBe("close");
    expect(r.gapMinutes).toBe(240);
  });

  /**
   * The case the design could not answer on its own. A six o'clock event in
   * Cavite, where the kitchen opens at six: there is no before. Saying
   * "ready two hours before" here would be the exact failure this whole
   * change exists to stop, just produced by us instead of by the customer.
   */
  it("says so when there is no before to be ready in", () => {
    const r = readyTimeFor("06:00", ASSISTED_DELIVERY, "Cavite");
    expect(r.time).toBe("06:00");
    expect(r.gapMinutes).toBe(0);
    expect(r.tooLate).toBe(true);
  });

  it("reaches that point two hours earlier at a branch that opens at eight", () => {
    expect(readyTimeFor("08:00", ASSISTED_DELIVERY, "Batangas").tooLate).toBe(true);
    expect(readyTimeFor("08:00", ASSISTED_DELIVERY, "Cavite").tooLate).toBe(false);
  });

  it("says so when the event starts before the kitchen opens at all", () => {
    const r = readyTimeFor("05:00", ASSISTED_DELIVERY, "Cavite");
    expect(r.time).toBe("06:00");
    expect(r.gapMinutes).toBe(-60);
    expect(r.tooLate).toBe(true);
  });

  it("holds for a midnight event rather than wrapping the clock", () => {
    const r = readyTimeFor("00:30", ASSISTED_DELIVERY, "Cavite");
    expect(r.time).toBe("06:00");
    expect(r.tooLate).toBe(true);
    expect(r.gapMinutes).toBeLessThan(0);
  });

  it("keeps every answer inside its own branch's window, all day, both methods", () => {
    for (const branch of Object.keys(KITCHEN_HOURS)) {
      const { opens, closes } = kitchenHoursFor(branch);
      for (let t = 0; t < 24 * 60; t += 30) {
        const at = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
        for (const method of [ASSISTED_DELIVERY, CLIENT_PICKUP]) {
          const mins = minutesOfDay(readyTimeFor(at, method, branch).time);
          expect(mins, `${branch} ${at} ${method}`).toBeGreaterThanOrEqual(minutesOfDay(opens));
          expect(mins, `${branch} ${at} ${method}`).toBeLessThanOrEqual(minutesOfDay(closes));
        }
      }
    }
  });

  /**
   * A branch nobody named yet gets the NARROWEST window. The branch cards
   * sit above this on the form, so showing a time only Cavite can manage
   * would move the answer under the customer once they chose.
   */
  it("assumes the narrowest window until a branch is named", () => {
    expect(kitchenHoursFor(null).opens).toBe("08:00");
    expect(kitchenHoursFor("").opens).toBe("08:00");
    expect(kitchenHoursFor("Somewhere Else").opens).toBe("08:00");
    expect(readyTimeFor("09:00", ASSISTED_DELIVERY, null).time).toBe("08:00");
  });

  it("carries the window it used, so the caller can word itself", () => {
    expect(readyTimeFor("18:00", ASSISTED_DELIVERY, "Cavite").hours.opens).toBe("06:00");
    expect(readyTimeFor("18:00", ASSISTED_DELIVERY, "Batangas").hours.opens).toBe("08:00");
  });

  /** The gap reported must always be the real one, clamp included. */
  it("reports the gap it actually achieved, not the one it wanted", () => {
    for (const branch of Object.keys(KITCHEN_HOURS)) {
      for (const at of ["05:00", "06:30", "09:00", "12:00", "18:00", "21:00", "23:30"]) {
        const r = readyTimeFor(at, ASSISTED_DELIVERY, branch);
        expect(minutesOfDay(at) - minutesOfDay(r.time), `${branch} ${at}`).toBe(r.gapMinutes);
      }
    }
  });
});

describe("a gap worth remarking on", () => {
  it("flags one under the hour without calling it too late", () => {
    const r = readyTimeFor("06:45", ASSISTED_DELIVERY, "Cavite");
    expect(r.gapMinutes).toBe(45);
    expect(r.short).toBe(true);
    expect(r.tooLate).toBe(false);
  });

  it("stops flagging at the hour", () => {
    const r = readyTimeFor("07:00", ASSISTED_DELIVERY, "Cavite");
    expect(r.gapMinutes).toBe(MIN_SENSIBLE_GAP);
    expect(r.short).toBe(false);
  });

  it("never calls the same gap both short and too late", () => {
    for (const branch of Object.keys(KITCHEN_HOURS)) {
      for (let t = 0; t < 24 * 60; t += 15) {
        const at = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
        const r = readyTimeFor(at, ASSISTED_DELIVERY, branch);
        expect(r.short && r.tooLate, `${branch} ${at}`).toBe(false);
      }
    }
  });
});

describe("before the customer has answered", () => {
  it("offers no time rather than a guess", () => {
    for (const bad of ["", null, undefined, "evening", "25:00", "12:60", "6pm", "6:00 PM"]) {
      const r = readyTimeFor(bad, ASSISTED_DELIVERY);
      expect(r.time, String(bad)).toBeNull();
      expect(r.tooLate, String(bad)).toBe(false);
    }
  });

  it("still reports which gap it would have used", () => {
    expect(readyTimeFor("", CLIENT_PICKUP).requestedGap).toBe(90);
  });
});

/**
 * Eight places compared against the literal "Pickup". Renaming the methods
 * meant touching all eight, and a ninth written later would have gone on
 * comparing against a value that no longer exists.
 */
describe("telling the two methods apart", () => {
  it("knows a collection from a delivery", () => {
    expect(isPickup(CLIENT_PICKUP)).toBe(true);
    expect(isPickup(ASSISTED_DELIVERY)).toBe(false);
  });

  /**
   * GoHighLevel still holds "Pickup" on every booking made before the
   * rename, and the payment page reads those back. Treating it as a
   * delivery would label each one "Ready for the rider".
   */
  it("still knows a pickup booked before the rename", () => {
    expect(isPickup("Pickup")).toBe(true);
    expect(isPickup("Delivery")).toBe(false);
    expect(isPickup("Courier")).toBe(false);
  });

  it("treats anything unreadable as not a collection, so the address is still asked for", () => {
    for (const junk of [null, undefined, "", 0, {}, []]) expect(isPickup(junk), String(junk)).toBe(false);
  });
});

describe("the gap, in words a customer reads", () => {
  it("says hours and minutes the way a person would", () => {
    expect(gapInWords(120)).toBe("2 hours");
    expect(gapInWords(90)).toBe("1 hour 30 minutes");
    expect(gapInWords(60)).toBe("1 hour");
    expect(gapInWords(45)).toBe("45 minutes");
    expect(gapInWords(1)).toBe("1 minute");
  });

  it("never prints a bare minute count for something over an hour", () => {
    expect(gapInWords(240)).not.toContain("240");
  });

  it("says something rather than nothing at zero", () => {
    expect(gapInWords(0)).toBe("no time");
    expect(gapInWords(-30)).toBe("no time");
    expect(gapInWords(Number.NaN)).toBe("no time");
  });
});

/**
 * The one rule both sides apply.
 *
 * The server used to hold its own pair of bounds. When the window became per
 * branch those constants went undefined, and every comparison against
 * undefined is false — so the check passed everything, rejected nothing, and
 * said nothing about it. No test failed, because no test existed.
 *
 * This is that test.
 */
describe("whether a branch can honour a time at all", () => {
  it("accepts the edges of each branch's own window", () => {
    for (const [branch, hours] of Object.entries(KITCHEN_HOURS)) {
      expect(isWithinKitchenHours(hours.opens, branch), `${branch} open`).toBe(true);
      expect(isWithinKitchenHours(hours.closes, branch), `${branch} close`).toBe(true);
    }
  });

  it("refuses a time one branch can manage and another cannot", () => {
    expect(isWithinKitchenHours("06:00", "Cavite")).toBe(true);
    expect(isWithinKitchenHours("06:00", "Batangas")).toBe(false);
    expect(isWithinKitchenHours("06:00", "Montalban")).toBe(false);
  });

  it("refuses times outside every window", () => {
    for (const branch of [...Object.keys(KITCHEN_HOURS), null]) {
      expect(isWithinKitchenHours("05:59", branch), `${branch} 05:59`).toBe(false);
      expect(isWithinKitchenHours("17:30", branch), `${branch} 17:30`).toBe(false);
      expect(isWithinKitchenHours("23:00", branch), `${branch} 23:00`).toBe(false);
    }
  });

  /**
   * The failure mode that started this: a value that is not a time must be
   * REFUSED, not compared. `"anything" < undefined` is false, which reads as
   * "in range" to a check written the other way round.
   */
  it("refuses anything that is not a time, rather than comparing it", () => {
    for (const junk of ["", null, undefined, "6:00", "6am", "noon", 600, {}, [], "0600"]) {
      expect(isWithinKitchenHours(junk, "Cavite"), String(junk)).toBe(false);
    }
  });

  it("holds an unknown branch to the narrowest window", () => {
    expect(isWithinKitchenHours("06:00", "Somewhere Else")).toBe(false);
    expect(isWithinKitchenHours("08:00", "Somewhere Else")).toBe(true);
  });

  /**
   * Every time the form will ever derive must pass this, or the server would
   * reject an order the browser just built — the two rules disagreeing is
   * the thing sharing one definition is meant to make impossible.
   */
  it("accepts every time the derivation can produce, for every branch", () => {
    for (const branch of [...Object.keys(KITCHEN_HOURS), null]) {
      for (let t = 0; t < 24 * 60; t += 30) {
        const at = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
        for (const method of [ASSISTED_DELIVERY, CLIENT_PICKUP]) {
          const { time } = readyTimeFor(at, method, branch);
          expect(isWithinKitchenHours(time, branch), `${branch} ${at} ${method} -> ${time}`).toBe(true);
        }
      }
    }
  });
});
