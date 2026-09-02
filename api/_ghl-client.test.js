import { describe, it, expect, vi, afterEach } from "vitest";
import { addContactTags } from "./_ghl-client.js";

/**
 * The contract that matters here is "never throws". This runs inside
 * submit-payment-proof.js after the receipt is already stored, so an
 * exception escaping would turn a successful upload into a 502 and tell the
 * customer to try again — losing the thing that matters to protect the thing
 * that does not.
 */
afterEach(() => { vi.unstubAllGlobals(); });

const stubFetch = (impl) => {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
};

describe("addContactTags", () => {
  it("posts the tags to the contact", async () => {
    const spy = stubFetch(async () => ({ ok: true, json: async () => ({ tags: ["payment:proof-submitted"] }) }));
    const out = await addContactTags("abc123", ["payment:proof-submitted"]);

    expect(out.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toContain("/contacts/abc123/tags");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ tags: ["payment:proof-submitted"] });
  });

  it("accepts a bare string as one tag", async () => {
    const spy = stubFetch(async () => ({ ok: true, json: async () => ({}) }));
    await addContactTags("abc123", "one-tag");
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ tags: ["one-tag"] });
  });

  it("reports a GHL error instead of throwing", async () => {
    stubFetch(async () => ({ ok: false, status: 400, text: async () => "Contact not found" }));
    const out = await addContactTags("nope", ["t"]);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain("Contact not found");
  });

  // The case that would actually take the endpoint down: GHL unreachable
  // rather than merely refusing.
  it("survives fetch rejecting outright", async () => {
    stubFetch(async () => { throw new Error("ECONNRESET"); });
    const out = await addContactTags("abc123", ["t"]);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("ECONNRESET");
  });

  it("does not call GHL at all without a contact id", async () => {
    const spy = stubFetch(async () => ({ ok: true, json: async () => ({}) }));
    const out = await addContactTags(null, ["t"]);
    expect(out).toEqual({ ok: false, reason: "no contactId" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not call GHL for an empty tag list", async () => {
    const spy = stubFetch(async () => ({ ok: true, json: async () => ({}) }));
    expect((await addContactTags("abc123", [])).ok).toBe(false);
    expect((await addContactTags("abc123", [null, "", undefined])).ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
