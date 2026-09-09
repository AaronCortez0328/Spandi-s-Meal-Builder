import { describe, it, expect } from "vitest";
import { fulfilmentTimeLabel, buildInquiryText, applyLeadTime } from "./contact-form.js";
import { earliestBookableDate, STANDARD_LEAD_DAYS } from "../domain/availability.js";

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

/**
 * applyLeadTime, against a stand-in document.
 *
 * The behaviour under test is what it does NOT do. It runs more than once
 * per render, and restoring a saved draft clicks the rush card — which lands
 * here, moves the date and explains why. The first-render call that follows
 * immediately after used to wipe that explanation before anyone could read
 * it, so a customer saw their date silently change and no reason given.
 *
 * Clearing the message belongs to the customer choosing a date of their own,
 * which the change handler on #cf-date does.
 */
describe("applyLeadTime", () => {
  const rushFloor = earliestBookableDate(true);
  const standardFloor = earliestBookableDate(false);

  function setupDom({ date = "", rush = "no" } = {}) {
    const removed = [];
    const input = {
      value: date,
      min: "",
      classList: { remove: (c) => removed.push(c), add: () => {} },
      removeAttribute: (name) => { removed.push(name); },
    };
    const bumped = { textContent: "", hidden: true };
    const rushEl = { value: rush };

    globalThis.document = {
      getElementById: (id) => ({
        "cf-date": input,
        "cf-date-bumped": bumped,
        "cf-rush": rushEl,
      }[id] ?? null),
    };
    return { input, bumped, rushEl };
  }

  it("sets the earliest bookable date as the field's minimum", () => {
    const { input } = setupDom({ rush: "no" });
    applyLeadTime();
    expect(input.min).toBe(standardFloor);

    const { input: rushInput } = setupDom({ rush: "yes" });
    applyLeadTime();
    expect(rushInput.min).toBe(rushFloor);
  });

  // Reachable by narrowing the window: pick Rush, choose a date only Rush
  // allows, then switch back to Standard.
  it("moves a date that is now too soon, and says why", () => {
    const { input, bumped } = setupDom({ date: rushFloor, rush: "no" });
    applyLeadTime();

    expect(input.value).toBe(standardFloor);
    expect(bumped.hidden).toBe(false);
    expect(bumped.textContent).toContain(`${STANDARD_LEAD_DAYS} days`);
  });

  // The fix. Restoring a draft calls this twice in a row, and the second
  // call must leave the first one's explanation standing.
  it("leaves the explanation alone when called again", () => {
    const { input, bumped } = setupDom({ date: rushFloor, rush: "no" });

    applyLeadTime();
    const shown = bumped.textContent;
    expect(bumped.hidden).toBe(false);

    // The date has already been moved, so this pass takes the other branch —
    // the one that used to end in hideBump().
    applyLeadTime();
    expect(bumped.hidden).toBe(false);
    expect(bumped.textContent).toBe(shown);
    expect(input.value).toBe(standardFloor);
  });

  it("leaves a date that is already far enough out exactly as it is", () => {
    const { input, bumped } = setupDom({ date: "2030-01-01", rush: "no" });
    applyLeadTime();

    expect(input.value).toBe("2030-01-01");
    expect(bumped.hidden).toBe(true);
  });

  it("does nothing when no date has been chosen yet", () => {
    const { input, bumped } = setupDom({ date: "", rush: "no" });
    applyLeadTime();

    expect(input.value).toBe("");
    expect(bumped.hidden).toBe(true);
  });

  it("is a no-op when the date field is not on the page", () => {
    globalThis.document = { getElementById: () => null };
    expect(() => applyLeadTime()).not.toThrow();
  });
});
