import { describe, it, expect } from "vitest";
import { fulfilmentTimeLabel, buildInquiryText } from "./contact-form.js";

describe("fulfilmentTimeLabel", () => {
  it("names the field after the method the customer chose", () => {
    expect(fulfilmentTimeLabel("Delivery")).toBe("Delivery time");
    expect(fulfilmentTimeLabel("Pickup")).toBe("Pickup time");
  });

  // A third method added to the cards without touching this map should still
  // produce something readable rather than "undefined".
  it("falls back to a neutral label for an unknown method", () => {
    expect(fulfilmentTimeLabel("Courier")).toBe("Delivery / pickup time");
    expect(fulfilmentTimeLabel(undefined)).toBe("Delivery / pickup time");
  });
});

describe("buildInquiryText", () => {
  const base = {
    branch: "Cavite",
    firstName: "JJ",
    lastName: "Pena",
    email: "jj@example.com",
    phone: "09171234567",
    eventDate: "2026-08-15",
    eventTime: "",
    fulfilmentTime: "09:00",
    address: "Maple Haven Resort",
    note: "",
    fulfilment: "Delivery",
  };

  it("prints the delivery time even when the event time is blank", () => {
    const text = buildInquiryText("Party Trays", ["1 tray"], base);
    expect(text).toContain("Delivery : 09:00");
    expect(text).toContain("Date     : 2026-08-15");
  });

  it("labels the time as Pickup when that is what was chosen", () => {
    const text = buildInquiryText("Party Trays", ["1 tray"], {
      ...base, fulfilment: "Pickup", address: "",
    });
    expect(text).toContain("Pickup   : 09:00");
  });

  // A Pickup customer never gives one, and an empty row reads as missing
  // data rather than as "not applicable".
  it("omits the address row when there is no address", () => {
    const text = buildInquiryText("Party Trays", ["1 tray"], { ...base, address: "" });
    expect(text).not.toContain("Address");
  });

  it("combines date and time only when both are present", () => {
    const withTime = buildInquiryText("Party Trays", [], { ...base, eventTime: "18:00" });
    expect(withTime).toContain("Date     : 2026-08-15 at 18:00");
  });
});
