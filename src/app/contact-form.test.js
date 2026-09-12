import { describe, it, expect } from "vitest";
import {
  fulfilmentTimeLabel, buildInquiryText, applyLeadTime, buildContactPanel,
  requiredFields,
} from "./contact-form.js";
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

/**
 * Occasion, Celebrant and Theme colour.
 *
 * Only a catering package promises colour-themed table napkins, table
 * topping and chair ribbons — they are printed inclusions, so the colour is
 * something the kitchen needs rather than something nice to know. Every
 * other service would be asking a party-tray customer who is celebrating
 * their office lunch, on the last screen before they commit.
 */
describe("the event-detail fields", () => {
  const panel = (opts = {}) => buildContactPanel({
    backAttr: "data-back", copyAttr: "data-submit", statusId: "s", ...opts,
  });

  it("draws all three for a catering basket", () => {
    const html = panel({ showEventDetails: true });
    expect(html).toContain('id="cf-occasion"');
    expect(html).toContain('id="cf-celebrant"');
    expect(html).toContain('id="cf-theme-color"');
  });

  it("draws none of them otherwise", () => {
    const html = panel({ showEventDetails: false });
    expect(html).not.toContain('id="cf-occasion"');
    expect(html).not.toContain('id="cf-celebrant"');
    expect(html).not.toContain('id="cf-theme-color"');
  });

  // Defaulting to shown would put them on every party-tray order the moment
  // a caller forgot the flag.
  it("is off unless asked for", () => {
    expect(panel()).not.toContain('id="cf-occasion"');
  });

  /**
   * All three required, and marked as such.
   *
   * The `required` attribute alone does not stop a submission here — nothing
   * calls checkValidity(), and validateAndRead() decides. So the attribute
   * and the asterisk are the promise, and the entry in validateAndRead's
   * field list is what keeps it. A field marked with a star that submits
   * empty is worse than one that was never marked.
   */
  it("marks all three required, and none of them optional", () => {
    const html = panel({ showEventDetails: true });
    const block = html.slice(html.indexOf('id="cf-event-details"'), html.indexOf('for="cf-note"'));
    expect((block.match(/\brequired\b/g) ?? []).length).toBe(3);
    expect((block.match(/form-field__req/g) ?? []).length).toBe(3);
    expect(block).not.toContain("form-field__optional");
  });

  // Free text, not a dropdown: any list would be missing something real —
  // house blessing, fiesta, pamanhikan, despedida — and a customer whose
  // occasion is not on it would have to pick the wrong one.
  it("takes the occasion as free text", () => {
    const html = panel({ showEventDetails: true });
    const field = html.slice(html.indexOf('id="cf-occasion"'));
    expect(field.slice(0, 200)).not.toContain("<select");
  });

  // The customer is told why the colour is being asked for.
  it("says what the theme colour is for", () => {
    const html = panel({ showEventDetails: true });
    expect(html).toContain("chair ribbons");
  });
});

/**
 * What the form will actually refuse to submit without.
 *
 * The `required` attribute in the markup decides nothing here — no code
 * calls checkValidity(). This list is the rule, so a field carrying an
 * asterisk and missing from it would submit empty, which is worse than never
 * having marked it.
 */
describe("requiredFields", () => {
  const ids = (fulfilment) => requiredFields(fulfilment).map((f) => f.id);

  it("requires the three catering fields", () => {
    for (const id of ["cf-occasion", "cf-celebrant", "cf-theme-color"]) {
      expect(ids("Delivery"), id).toContain(id);
    }
  });

  // They are drawn only for a catering basket, and the validation loop skips
  // any id that is not on the page — so listing them unconditionally is what
  // makes them required there and absent everywhere else.
  it("requires them on a pickup order too, since the loop skips what is absent", () => {
    expect(ids("Pickup")).toContain("cf-occasion");
  });

  it("asks for an address on delivery and not on pickup", () => {
    expect(ids("Delivery")).toContain("cf-address");
    expect(ids("Pickup")).not.toContain("cf-address");
  });

  // The event time is optional; the delivery/pickup time is what we schedule
  // against and has to be there.
  it("leaves the event time optional and keeps the fulfilment time required", () => {
    expect(ids("Delivery")).not.toContain("cf-time");
    expect(ids("Delivery")).toContain("cf-fulfilment-time");
  });

  it("still requires everything it required before", () => {
    for (const id of [
      "cf-first-name", "cf-last-name", "cf-email", "cf-phone",
      "cf-date", "cf-fulfilment-time",
    ]) {
      expect(ids("Delivery"), id).toContain(id);
    }
  });
});
