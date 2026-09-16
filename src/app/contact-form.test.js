import { describe, it, expect } from "vitest";
import {
  fulfilmentTimeLabel, buildInquiryText, applyLeadTime, buildContactPanel,
  requiredFields,
  orderLocation, applyChangeLockNote,
} from "./contact-form.js";
import { earliestBookableDate, STANDARD_LEAD_DAYS, todayInManila } from "../domain/availability.js";

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

/**
 * Where the order is going.
 *
 * The pickup address was drawn on the form once and then discarded — it
 * reached neither the confirmation screen nor the email, so customers
 * collecting their order had nothing to navigate by. Delivery orders had the
 * mirror of the same problem: the address sat in GoHighLevel and was never
 * printed. One field answers both, and the branch is already chosen by the
 * time this runs, so the right address is picked here rather than by a
 * template full of per-branch conditions.
 *
 * The addresses are the caterer's own kitchen-locations list of 13 September
 * 2026. Two of them are asserted in full because the values that shipped
 * before that list were wrong, and nothing caught it.
 */
describe("orderLocation", () => {
  it("sends the branch's own address when collecting", () => {
    expect(orderLocation({ fulfilment: "Pickup", branch: "Cavite" }).location)
      .toBe("Block 20, Lot 27 & 28, Swallow Street, Amaris Homes Molino 4, Bacoor, Cavite");
    expect(orderLocation({ fulfilment: "Pickup", branch: "Batangas" }).location)
      .toBe("Cuenca, Ibabao (near lubog na Simbahan)");
    expect(orderLocation({ fulfilment: "Pickup", branch: "Montalban" }).location)
      .toBe("#47 San Lorenzo St, Cortijos de San Rafael Subdivision, San Rafael, Rodriguez, Rizal");
  });

  // Montalban shipped without its house number, so the street was right and
  // the building was anyone's guess.
  it("gives Montalban its house number", () => {
    expect(orderLocation({ fulfilment: "Pickup", branch: "Montalban" }).location)
      .toContain("#47");
  });

  // Cavite shipped as "Ph 3". The subdivision is Molino 4 — a different place.
  it("names Cavite's real subdivision", () => {
    const { location } = orderLocation({ fulfilment: "Pickup", branch: "Cavite" });
    expect(location).toContain("Molino 4");
    expect(location).not.toContain("Ph 3");
  });

  /**
   * The map link is separate data, not a search built from the address.
   *
   * For two of three branches the street line is the worse way to find the
   * place: Cavite is registered on Maps under the business name, Montalban
   * has an exact Plus Code. Deriving the link from the address would land
   * someone near the kitchen rather than at it.
   */
  it("points at the pin each branch is actually findable by", () => {
    const cavite = orderLocation({ fulfilment: "Pickup", branch: "Cavite" }).locationMap;
    expect(decodeURIComponent(cavite)).toContain("Spandi's Events and Catering Ventures");

    const montalban = orderLocation({ fulfilment: "Pickup", branch: "Montalban" }).locationMap;
    expect(decodeURIComponent(montalban)).toContain("P5J6+XFX");
  });

  it("gives every branch a link that opens", () => {
    for (const branch of ["Cavite", "Batangas", "Montalban"]) {
      const { locationMap } = orderLocation({ fulfilment: "Pickup", branch });
      expect(locationMap, branch).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
      // The Plus Code's "+" and the apostrophe in the business name both have
      // to survive the URL, or the link searches for something else.
      expect(locationMap, branch).not.toContain(" ");
    }
  });

  /**
   * Opening hours answer "when can I reach this kitchen", which a customer
   * expecting a delivery asks just as often as one collecting. So they ride
   * on both, and they are the branch's either way.
   */
  it("carries each branch's opening hours", () => {
    expect(orderLocation({ fulfilment: "Pickup", branch: "Batangas" }).locationHours)
      .toBe("10AM – 4PM");
    expect(orderLocation({ fulfilment: "Pickup", branch: "Cavite" }).locationHours)
      .toBe("8AM – 5PM");
  });

  it("carries the branch's hours on a delivery too", () => {
    expect(orderLocation({
      fulfilment: "Delivery", branch: "Cavite", address: "12 Rizal Ave",
    }).locationHours).toBe("8AM – 5PM");
  });

  // Montalban's hours have not been given to us. Empty rather than invented:
  // someone turning up at a closed kitchen because we guessed plausible hours
  // is worse off than someone who has to ring and ask.
  it("says nothing about hours it has not been told", () => {
    expect(orderLocation({ fulfilment: "Pickup", branch: "Montalban" }).locationHours).toBe("");
    expect(orderLocation({ fulfilment: "Pickup", branch: "Cebu" }).locationHours).toBe("");
  });

  /**
   * The branch either way — this is the whole point of the field.
   *
   * The first version sent the customer's own typed address on a delivery,
   * so the email printed what they had just entered back at them under a
   * heading reading "Where to go", with a map link to their own house. A
   * live test showed a Montalban delivery whose location read "test".
   */
  it("sends the branch on a delivery, not the customer's address", () => {
    const { location } = orderLocation({
      fulfilment: "Delivery", branch: "Cavite", address: "12 Rizal Ave, Lipa City",
    });
    expect(location).toContain("Swallow Street");
    expect(location).not.toContain("Rizal Ave");
  });

  it("gives a delivery the same answer as a collection", () => {
    for (const branch of ["Cavite", "Batangas", "Montalban"]) {
      const pickup = orderLocation({ fulfilment: "Pickup", branch });
      const delivery = orderLocation({
        fulfilment: "Delivery", branch, address: "12 Rizal Ave, Lipa City",
      });
      expect(delivery, branch).toEqual(pickup);
    }
  });

  /**
   * Empty rather than wrong. ghl-inquiry.js drops empty values before
   * writing, so nothing blank is ever sent — but a half-built answer would
   * be, and an order that says "Pickup" with a delivery address on it is
   * worse than one that says nothing.
   */
  it("says nothing when it has nothing to say", () => {
    for (const args of [
      { fulfilment: "Pickup", branch: "Cebu" },
      { fulfilment: "Pickup", branch: "" },
      { fulfilment: "Pickup" },
      { fulfilment: "Delivery", address: "   " },
      { fulfilment: "Delivery" },
      {},
      undefined,
    ]) {
      const out = orderLocation(args);
      expect(out.location, JSON.stringify(args)).toBe("");
      expect(out.locationMap, JSON.stringify(args)).toBe("");
    }
  });
});

/**
 * The line that tells a customer, while they can still pick a different day,
 * that booking this close means the order is final.
 *
 * Against a stand-in document, same as applyLeadTime above — this repository
 * has no DOM environment on purpose.
 *
 * What it must not do is speak when there is nothing to say. Warning about a
 * door that is not closing trains people to ignore the one that is.
 */
describe("applyChangeLockNote", () => {
  function setupDom(date) {
    const note = { textContent: "", hidden: true };
    globalThis.document = {
      getElementById: (id) => ({ "cf-date": { value: date }, "cf-change-lock": note }[id] ?? null),
    };
    return note;
  }

  const inDays = (n) => {
    const d = new Date(`${todayInManila()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  it("says nothing when both windows are open", () => {
    const note = setupDom(inDays(30));
    applyChangeLockNote();
    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe("");
  });

  it("says nothing at all without a date", () => {
    const note = setupDom("");
    applyChangeLockNote();
    expect(note.hidden).toBe(true);
  });

  it("warns once changing is closed but adding is not", () => {
    // Inside seven days, outside three.
    const note = setupDom(inDays(5));
    applyChangeLockNote();
    expect(note.hidden).toBe(false);
    expect(note.textContent).toMatch(/cannot change/i);
    expect(note.textContent).toMatch(/still add/i);
  });

  it("says the order is final once neither is open", () => {
    const note = setupDom(inDays(2));
    applyChangeLockNote();
    expect(note.hidden).toBe(false);
    expect(note.textContent).toMatch(/final/i);
    expect(note.textContent).not.toMatch(/still add/i);
  });

  it("clears itself when the customer moves to a date that is fine", () => {
    // The note is re-run on every date change; a stale warning about a date
    // they have already abandoned is worse than none.
    const note = setupDom(inDays(2));
    applyChangeLockNote();
    expect(note.hidden).toBe(false);

    globalThis.document = {
      getElementById: (id) => ({ "cf-date": { value: inDays(30) }, "cf-change-lock": note }[id] ?? null),
    };
    applyChangeLockNote();
    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe("");
  });

  it("tells them where to go instead of only what they cannot do", () => {
    const note = setupDom(inDays(2));
    applyChangeLockNote();
    expect(note.textContent).toMatch(/message us/i);
  });
});
