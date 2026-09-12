import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * renderCustomServiceCards against a stand-in document.
 *
 * The reason this exists is the 30-second refresh. This function runs on
 * every one of them, and rewriting innerHTML replaces every card with a new
 * element — which drops keyboard focus to <body>. A customer reading the
 * chooser would lose their place twice a minute on a page where nothing had
 * changed, and nothing about that failure is visible in a code review: the
 * first guard written for it compared against grid.innerHTML, which reads
 * back the browser's own re-serialisation and would never have matched.
 *
 * So the assertion here is about writes, not about markup.
 */

// Mutable so each test can decide what the table currently holds.
let rows = [];
vi.mock("../data/services.js", () => ({
  getCustomServices: () => rows,
}));

const { renderCustomServiceCards } = await import("./custom-service.js");

/** Counts assignments to innerHTML rather than comparing its value. */
function makeGrid() {
  const grid = { writes: 0, _html: "" };
  Object.defineProperty(grid, "innerHTML", {
    get() { return this._html; },
    set(value) { this._html = value; this.writes += 1; },
  });
  return grid;
}

let grid, group;

beforeEach(() => {
  grid = makeGrid();
  group = { hidden: false };
  globalThis.document = {
    getElementById: (id) => ({
      "service-cards-custom": grid,
      "service-group-custom": group,
    }[id] ?? null),
  };
  rows = [];
  // The module remembers the last markup it wrote, so each test starts by
  // settling it on "nothing" — otherwise the first render of one test would
  // be judged against the last render of the one before.
  renderCustomServiceCards();
  grid.writes = 0;
});

const row = (over = {}) => ({
  slug: "lechon-belly", label: "Lechon Belly",
  description: "Slow-roasted.", price_from: 8500, facts_label: "20–40 pax",
  ...over,
});

describe("renderCustomServiceCards", () => {
  it("draws a card for each row it is given", () => {
    rows = [row(), row({ slug: "paella", label: "Paella" })];
    const slugs = renderCustomServiceCards();

    expect(slugs).toEqual(["lechon-belly", "paella"]);
    expect(grid.innerHTML).toContain('data-service="lechon-belly"');
    expect(grid.innerHTML).toContain('data-service="paella"');
  });

  // The chooser must not grow an empty "More Services" heading on the days
  // when there are none, which is most of them.
  it("hides the group while there is nothing in it", () => {
    rows = [];
    renderCustomServiceCards();
    expect(group.hidden).toBe(true);

    rows = [row()];
    renderCustomServiceCards();
    expect(group.hidden).toBe(false);
  });

  // The one that matters. Two identical refreshes must touch the DOM once.
  it("does not touch the DOM when nothing has changed", () => {
    rows = [row()];
    renderCustomServiceCards();
    expect(grid.writes).toBe(1);

    renderCustomServiceCards();
    renderCustomServiceCards();
    expect(grid.writes).toBe(1);
  });

  it("redraws when a card is switched on", () => {
    rows = [row()];
    renderCustomServiceCards();
    expect(grid.writes).toBe(1);

    rows = [row(), row({ slug: "paella", label: "Paella" })];
    renderCustomServiceCards();
    expect(grid.writes).toBe(2);
  });

  it("redraws when a card is switched off", () => {
    rows = [row(), row({ slug: "paella", label: "Paella" })];
    renderCustomServiceCards();

    rows = [row()];
    renderCustomServiceCards();
    expect(grid.innerHTML).not.toContain("paella");
    expect(grid.writes).toBe(2);
  });

  // An edit in the dashboard is not a new card, but the customer still has
  // to see it — so the guard cannot key on the slug list alone.
  it("redraws when a card's own details are edited", () => {
    rows = [row()];
    renderCustomServiceCards();

    rows = [row({ price_from: 9500 })];
    renderCustomServiceCards();
    expect(grid.writes).toBe(2);
    expect(grid.innerHTML).toContain("PHP 9,500");
  });

  it("does nothing at all when the chooser is not on the page", () => {
    globalThis.document = { getElementById: () => null };
    rows = [row()];
    expect(renderCustomServiceCards()).toEqual([]);
  });
});
