import { describe, it, expect } from "vitest";
import { bannerHtml, bannerDate } from "./change-banner.js";

/**
 * The strip is the one thing standing between "changing my order" and
 * "accidentally placing a second one", because the builder a customer is
 * looking at IS the ordering screen.
 */
describe("the change banner", () => {
  const change = { kind: "change", eventDate: "2026-12-19", identifier: "a@b.co" };
  const add    = { ...change, kind: "add" };

  it("names the booking by the day they would recognise", () => {
    expect(bannerHtml(change)).toContain("19 December");
  });

  it("says changing and adding differently, because they are different", () => {
    expect(bannerHtml(change)).toMatch(/changing your/i);
    expect(bannerHtml(add)).toMatch(/adding to your/i);
  });

  it("repeats the promise the confirmation made", () => {
    // Said on Order Status before they left, and again here, because ten
    // minutes of choosing dishes is long enough to stop believing it.
    expect(bannerHtml(change)).toMatch(/nothing changes until we confirm/i);
    expect(bannerHtml(add)).toMatch(/nothing changes until we confirm/i);
  });

  it("offers a way out that is not the browser back button", () => {
    expect(bannerHtml(change)).toContain("Cancel");
  });

  it("still reads sensibly when the date is unusable", () => {
    const html = bannerHtml({ kind: "change", eventDate: "nonsense" });
    expect(html).toMatch(/changing your booking/i);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });

  it("is announced, so it is not only a visual cue", () => {
    expect(bannerHtml(change)).toContain('role="status"');
  });
});

describe("the date it shows", () => {
  it("reads as a day and a month", () => {
    expect(bannerDate("2026-12-19")).toBe("19 December");
    expect(bannerDate("2026-01-01")).toBe("1 January");
  });

  it("says nothing rather than something wrong", () => {
    for (const bad of ["", "19/12/2026", "2026-12-19T00:00:00Z", null, undefined]) {
      expect(bannerDate(bad), String(bad)).toBe("");
    }
  });
});
