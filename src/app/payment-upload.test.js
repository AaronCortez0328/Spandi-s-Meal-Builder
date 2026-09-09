import { describe, it, expect } from "vitest";
import { whenReceived, renderHistory } from "./payment-upload.js";

describe("whenReceived", () => {
  it("reads a stored timestamp back as a date and time", () => {
    const text = whenReceived("2026-09-08T06:14:00.000Z");
    expect(text).toContain("8");
    expect(text).toContain("September");
  });

  // Fixed to Manila, not the device. 18:00 UTC is already the next morning
  // there, and a customer must be shown the same moment the kitchen and the
  // dashboard see — not one shifted by wherever her phone thinks it is.
  it("reports the Manila day, not the UTC one", () => {
    expect(whenReceived("2026-09-08T18:00:00.000Z")).toContain("9");
  });

  it("returns null for anything that is not a date", () => {
    expect(whenReceived("not a date")).toBeNull();
    expect(whenReceived("")).toBeNull();
    expect(whenReceived(null)).toBeNull();
    expect(whenReceived(undefined)).toBeNull();
  });
});

describe("renderHistory", () => {
  const at = "2026-09-08T06:14:00.000Z";

  // No history means the page reads exactly as it did before this existed —
  // a first-time visitor is not shown an empty "receipts we've received" box.
  it("renders nothing when there is nothing to report", () => {
    expect(renderHistory([])).toBe("");
    expect(renderHistory(null)).toBe("");
    expect(renderHistory(undefined)).toBe("");
    expect(renderHistory("not an array")).toBe("");
  });

  it("shows when a receipt arrived", () => {
    const html = renderHistory([{ submittedAt: at, fileCount: 1, state: null }]);
    expect(html).toContain("Receipts we&rsquo;ve received");
    expect(html).toContain("September");
  });

  // The whole point: a customer who came back to check gets an answer
  // instead of an empty form. "We're checking it" is true whether a human
  // has looked yet or not, which is why an unreviewed receipt says this
  // rather than nothing.
  it("says a receipt is being checked when nobody has reviewed it", () => {
    const html = renderHistory([{ submittedAt: at, fileCount: 1, state: null }]);
    expect(html).toContain("We&rsquo;re checking it");
  });

  it("says so once a receipt has been confirmed", () => {
    const html = renderHistory([{ submittedAt: at, fileCount: 1, state: "verified" }]);
    expect(html).toContain("Confirmed");
    expect(html).not.toContain("checking it");
  });

  it("asks for another when one was rejected", () => {
    const html = renderHistory([{ submittedAt: at, fileCount: 1, state: "rejected" }]);
    expect(html).toContain("Please send another");
  });

  it("lists every submission", () => {
    const html = renderHistory([
      { submittedAt: "2026-09-08T06:14:00.000Z", fileCount: 1, state: "verified" },
      { submittedAt: "2026-09-20T02:00:00.000Z", fileCount: 2, state: null },
    ]);
    expect(html.match(/success-summary__row/g)).toHaveLength(2);
    expect(html).toContain("Confirmed");
    expect(html).toContain("We&rsquo;re checking it");
  });

  // An unreadable timestamp still produces a row rather than the word
  // "null" — the fact that a receipt arrived is worth more than the date.
  it("still reports a receipt whose timestamp cannot be read", () => {
    const html = renderHistory([{ submittedAt: "corrupt", fileCount: 1, state: null }]);
    expect(html).toContain("Received");
    expect(html).not.toContain("null");
  });

  it("escapes what it puts on the page", () => {
    const html = renderHistory([{ submittedAt: "<img src=x onerror=alert(1)>", state: null }]);
    expect(html).not.toContain("<img");
  });
});
