import { describe, it, expect } from "vitest";
import { originAllowed, callerIp } from "./_rate-limit.js";

const req = (headers) => ({ headers });

describe("originAllowed", () => {
  it("accepts the production site", () => {
    expect(originAllowed(req({
      origin: "https://spandis-meal-builder.vercel.app",
      host:   "spandis-meal-builder.vercel.app",
    }))).toBe(true);
  });

  // The first version of this compared against SITE_URL, which is the
  // production hostname — so every preview deployment was rejected, and the
  // only environment safe to test in was the one the check refused. This is
  // the case that broke.
  it("accepts a preview deployment", () => {
    const host = "spandis-meal-builder-git-development-aaron.vercel.app";
    expect(originAllowed(req({ origin: `https://${host}`, host }))).toBe(true);
  });

  it("accepts localhost during development", () => {
    expect(originAllowed(req({
      origin: "http://localhost:5173",
      host:   "localhost:5173",
    }))).toBe(true);
  });

  it("accepts a custom domain via x-forwarded-host", () => {
    expect(originAllowed(req({
      origin: "https://order.spandis.com",
      "x-forwarded-host": "order.spandis.com",
      host: "internal-vercel-host.vercel.app",
    }))).toBe(true);
  });

  it("rejects another site posting to us", () => {
    expect(originAllowed(req({
      origin: "https://not-spandis.example.com",
      host:   "spandis-meal-builder.vercel.app",
    }))).toBe(false);
  });

  it("allows a request that sends no origin at all", () => {
    expect(originAllowed(req({ host: "spandis-meal-builder.vercel.app" }))).toBe(true);
  });

  it("rejects an unparseable origin", () => {
    expect(originAllowed(req({ origin: "not a url", host: "x.vercel.app" }))).toBe(false);
  });
});

describe("callerIp", () => {
  // x-forwarded-for is "client, proxy1, proxy2" — the leftmost entry is the
  // original caller, and counting against a proxy's address would rate-limit
  // everyone behind it together.
  it("takes the leftmost address from the forwarded chain", () => {
    expect(callerIp(req({ "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" })))
      .toBe("203.0.113.9");
  });

  it("falls back to x-real-ip", () => {
    expect(callerIp(req({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("never returns undefined", () => {
    expect(callerIp(req({}))).toBe("unknown");
  });
});
