import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * What the page is allowed to cost while it sits open.
 *
 * ── The bug ───────────────────────────────────────────────────────────────
 *
 * One setInterval at 30 seconds re-downloaded ELEVEN tables, every row, in
 * every open tab, whether or not anyone was looking at it. Measured against
 * the live database that is 93 KB raw and about 15 KB on the wire, so a
 * single forgotten tab cost roughly 43 MB a day. Seven of them put the
 * project over its 5 GB egress allowance.
 *
 * ── What must stay true ───────────────────────────────────────────────────
 *
 * Two promises pull against each other here, and this file exists so neither
 * can be quietly dropped while someone is honouring the other.
 *
 *   The dashboard team was promised that a date the kitchen closes, and a
 *   service the dashboard switches off, reach customers within half a
 *   minute. Those two are 1.3 KB together. They stay on 30 seconds.
 *
 *   The menu — prices, packages, dishes, tiers — is the other 92 KB, changes
 *   a few times a month, and is re-priced by the server at submit anyway. It
 *   does not belong on the same cycle.
 *
 * And nothing polls at all while the tab is hidden, because a tab nobody is
 * looking at cannot be shown a closed date.
 *
 * ── Why this reads the source ─────────────────────────────────────────────
 *
 * Same reason as way-back.test.js: createApp needs a DOM, a live catalogue
 * and a mounted container before it will do anything, and a test that needed
 * all three to assert "the menu is not on the 30-second timer" is a test
 * nobody would keep working. What matters is which loader sits on which
 * timer, and the source answers that exactly.
 */
const source = fs.readFileSync(
  path.join(process.cwd(), "src", "app", "app.js"),
  "utf8",
);

/** The body of a named const array, e.g. LIVE_SOURCES = [ ... ] */
function arrayBody(name) {
  const m = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(source);
  expect(m, `${name} has been renamed or is no longer an array literal`).toBeTruthy();
  return m[1];
}

describe("what the 30-second poll is allowed to fetch", () => {
  /**
   * The promise to the dashboard team. If this moves, a date the kitchen
   * closes stops reaching customers in the half minute they were told about.
   */
  it("keeps closed dates and open services on thirty seconds", () => {
    expect(source).toMatch(/LIVE_POLL_MS\s*=\s*30_?000/);

    const live = arrayBody("LIVE_SOURCES");
    expect(live).toContain("loadBlockedDates");
    expect(live).toContain("loadServices");
  });

  /**
   * 92 KB of the old 93. Putting any of these back on the fast timer undoes
   * the whole fix, and would do it silently — nothing would look wrong.
   */
  it("keeps the menu off that timer", () => {
    const live = arrayBody("LIVE_SOURCES");
    for (const heavy of [
      "loadPartyTrayData",
      "loadCateringData",
      "loadPackedMealsData",
      "loadGrazingData",
      "loadFullServiceCateringData",
    ]) {
      expect(live, `${heavy} must not be on the 30-second poll`).not.toContain(heavy);
    }
  });

  it("does fetch the menu, on a slower timer of its own", () => {
    const menu = arrayBody("MENU_SOURCES");
    for (const heavy of [
      "loadPartyTrayData",
      "loadCateringData",
      "loadPackedMealsData",
      "loadGrazingData",
      "loadFullServiceCateringData",
    ]) {
      expect(menu).toContain(heavy);
    }
  });

  /**
   * Slower is the entire point. Equal intervals would pass every other test
   * here while costing exactly what the old code cost.
   */
  it("polls the menu far less often than the live pair", () => {
    const live = /LIVE_POLL_MS\s*=\s*([^;]+);/.exec(source)?.[1] ?? "";
    const menu = /MENU_POLL_MS\s*=\s*([^;]+);/.exec(source)?.[1] ?? "";

    const ms = (expr) => Function(`"use strict";return (${expr.replace(/_/g, "")})`)();

    expect(ms(live)).toBe(30000);
    expect(ms(menu)).toBeGreaterThanOrEqual(5 * 60000);
  });
});

describe("polling while nobody is looking", () => {
  /**
   * The forgotten tab was the whole bug. Busy pages were never the problem.
   */
  it("stops when the tab is hidden", () => {
    expect(source).toContain("visibilitychange");
    expect(source).toMatch(/visibilityState\s*===\s*["']hidden["']/);
    expect(source).toMatch(/stopPolling\(\)/);
  });

  it("clears both timers, not just one", () => {
    const m = /function stopPolling\(\)\s*\{([\s\S]*?)\n {2}\}/.exec(source);
    expect(m, "stopPolling has been renamed").toBeTruthy();

    // The CLEARS, not the names. Checking for "menuTimer" alone passed with
    // clearInterval(menuTimer) deleted, because `menuTimer = null` still
    // mentions it — found by breaking this on purpose.
    expect(m[1]).toContain("clearInterval(liveTimer)");
    expect(m[1]).toContain("clearInterval(menuTimer)");
  });

  /**
   * Pausing without this would make staleness WORSE than the bug it fixes:
   * away for an hour, back to an hour-old page, then up to ten more minutes
   * before it corrected itself. Returning is exactly when someone starts
   * reading again.
   */
  it("refreshes everything the moment the customer comes back", () => {
    const m = /function onVisibilityChange\(\)\s*\{([\s\S]*?)\n {2}\}/.exec(source);
    expect(m, "onVisibilityChange has been renamed").toBeTruthy();

    // The full refresh, not just the cheap half.
    expect(m[1]).toContain("refreshPrices()");
    expect(m[1]).toContain("startPolling()");
  });

  /**
   * startPolling clears before it sets. Called twice — on load and again on
   * every return to the tab — a version that only set would leave the old
   * pair running, and a tab switched away from and back ten times would end
   * up polling eleven times as often as intended.
   */
  it("cannot stack timers when it starts twice", () => {
    const m = /function startPolling\(\)\s*\{([\s\S]*?)\n {2}\}/.exec(source);
    expect(m, "startPolling has been renamed").toBeTruthy();
    expect(m[1]).toContain("stopPolling()");
  });

  /**
   * A page can LOAD hidden — opened in a background tab, or restored when
   * the browser starts. visibilitychange only fires on a CHANGE, so such a
   * tab never gets one and would poll all day on the strength of the timers
   * started at boot. The same bug, entered by the other door.
   */
  it("does not start polling in a tab that loaded hidden", () => {
    const m = /function startPolling\(\)\s*\{([\s\S]*?)\n {2}\}/.exec(source);
    expect(m, "startPolling has been renamed").toBeTruthy();
    expect(m[1]).toMatch(/visibilityState\s*===\s*["']hidden["'][\s\S]*?return/);
  });

  /** One place creates timers. Two would be one to forget to pause. */
  it("creates its timers in one place", () => {
    expect(source.match(/setInterval\(/g) ?? []).toHaveLength(2);
  });
});
