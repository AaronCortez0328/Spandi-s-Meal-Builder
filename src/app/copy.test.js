import { describe, it, expect } from "vitest";
import { wayOutHtml, CONTACT_URL } from "./copy.js";

describe("the way out", () => {
  it("always names somewhere to go", () => {
    expect(wayOutHtml()).toContain(CONTACT_URL);
  });

  it("points at a real destination, not a placeholder", () => {
    expect(CONTACT_URL).toMatch(/^https:\/\/\S+\.\S+/);
  });

  // A link out of an iframe that replaces the parent page would take the
  // half-finished order with it.
  it("opens away from the order", () => {
    expect(wayOutHtml()).toContain('target="_blank"');
    expect(wayOutHtml()).toContain('rel="noopener"');
  });

  it("uses the caller's words for what went wrong", () => {
    expect(wayOutHtml("Tried twice?")).toContain("Tried twice?");
  });
});
