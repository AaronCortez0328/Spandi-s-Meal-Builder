import { describe, it, expect, vi, afterEach } from "vitest";
import { addContactTags, contactNameUpdate, updateContactName , isBooking } from "./_ghl-client.js";

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

/**
 * Writing the customer's name onto a contact that already existed.
 *
 * POST /contacts/ only names a contact it actually creates. A returning
 * customer matches an existing one, GHL answers 400 with meta.contactId, the
 * caller takes that id — and the name on the order is thrown away. A contact
 * first created by the Facebook/Instagram integration or the chat widget has
 * no name of its own, so it keeps GoHighLevel's placeholder ("Guest Visitor
 * Hwlsm") on every order that person ever places.
 *
 * The rule that makes this safe to run on every inquiry is that it can only
 * ever add a name, never remove one.
 */
describe("contactNameUpdate", () => {
  it("takes the name the customer typed", () => {
    expect(contactNameUpdate({ firstName: "Jenet", lastName: "Macatangay" }))
      .toEqual({ firstName: "Jenet", lastName: "Macatangay" });
  });

  it("trims what it takes", () => {
    expect(contactNameUpdate({ firstName: "  Jenet  ", lastName: "\tMacatangay\n" }))
      .toEqual({ firstName: "Jenet", lastName: "Macatangay" });
  });

  // The safety property. An order arriving without a name must never blank
  // out a name already on the record — this can improve what is stored,
  // never erase it. A blank string sent to GHL would overwrite.
  it("never offers to write an empty name over a real one", () => {
    for (const contact of [
      {}, null, undefined,
      { firstName: "", lastName: "" },
      { firstName: "   ", lastName: "\t\n" },
      { firstName: null, lastName: null },
      { firstName: undefined, lastName: undefined },
    ]) {
      expect(contactNameUpdate(contact), JSON.stringify(contact)).toEqual({});
    }
  });

  it("writes the half it has when only one is given", () => {
    expect(contactNameUpdate({ firstName: "Jenet", lastName: "  " }))
      .toEqual({ firstName: "Jenet" });
    expect(contactNameUpdate({ lastName: "Macatangay" }))
      .toEqual({ lastName: "Macatangay" });
  });
});

describe("updateContactName", () => {
  it("puts the name to the contact", async () => {
    const spy = stubFetch(async () => ({ ok: true, json: async () => ({}) }));
    const out = await updateContactName("abc123", { firstName: "Jenet", lastName: "Macatangay" });

    expect(out.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toContain("/contacts/abc123");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ firstName: "Jenet", lastName: "Macatangay" });
  });

  // The custom-field write is a separate request on purpose. Sending a body
  // with nothing in it would be a pointless call that could still fail and
  // be logged as though something were wrong.
  it("sends nothing at all when there is no name to write", async () => {
    const spy = stubFetch(async () => ({ ok: true, json: async () => ({}) }));
    const out = await updateContactName("abc123", { firstName: "  " });

    expect(out).toEqual({ ok: false, reason: "no name" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("does nothing without a contact id", async () => {
    const spy = stubFetch(async () => ({ ok: true, json: async () => ({}) }));
    expect(await updateContactName(null, { firstName: "Jenet" }))
      .toEqual({ ok: false, reason: "no contactId" });
    expect(spy).not.toHaveBeenCalled();
  });

  /**
   * Never throws. This runs after the contact is already resolved and the
   * order is going through; an exception escaping here would turn a booking
   * that succeeded into an error the customer is told to retry — losing the
   * order to protect a cosmetic field. The typed name also reaches GHL in
   * the note regardless.
   */
  it("reports a refusal instead of throwing it", async () => {
    stubFetch(async () => ({ ok: false, status: 422, text: async () => "bad", json: async () => ({}) }));
    const out = await updateContactName("abc123", { firstName: "Jenet" });
    expect(out.ok).toBe(false);
    expect(out.reason).toBeTruthy();
  });

  it("survives the network being gone", async () => {
    stubFetch(async () => { throw new Error("ECONNRESET"); });
    const out = await updateContactName("abc123", { firstName: "Jenet" });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain("ECONNRESET");
  });
});

/**
 * A lead is not a booking.
 *
 * findContactOpportunities returns every opportunity a contact has, across
 * every pipeline — and custom fields in GoHighLevel belong to the LOCATION
 * rather than to a pipeline, so a referral lead can carry an event date.
 * Without this filter a lookup could match one and show a stranger a
 * "booking" that nobody ordered or paid for.
 */
describe("which opportunities count as bookings", () => {
  const REFERRAL = "Gu5seL4YnWoMoW3twuyB";
  const ORDERING = "4iSqMujoKIFti0FaoTBU";
  const OLD      = "S9WI8ZHHnI1kZm3oQcrI";

  it("keeps the live ordering pipeline", () => {
    expect(isBooking({ pipelineId: ORDERING })).toBe(true);
  });

  /**
   * 1,061 of them against 545 in the live pipeline — the bookings typed in
   * from the Excel book. An allowlist of "just the ordering pipeline" would
   * have told every one of those customers their order does not exist.
   */
  it("keeps Old Bookings, which holds more real customers than the live one", () => {
    expect(isBooking({ pipelineId: OLD })).toBe(true);
  });

  it("drops a referral lead", () => {
    expect(isBooking({ pipelineId: REFERRAL })).toBe(false);
  });

  /**
   * A denylist, so anything new is a booking until somebody says otherwise.
   * A pipeline nobody told us about holding real orders is a worse outcome
   * than one holding leads.
   */
  it("keeps a pipeline it has never heard of", () => {
    expect(isBooking({ pipelineId: "something-new" })).toBe(true);
  });

  it("keeps one with no pipeline on it at all, rather than dropping it", () => {
    expect(isBooking({})).toBe(true);
    expect(isBooking(null)).toBe(true);
  });
});
