import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  fulfilmentTimeLabel, fulfilmentTimeQuestion, buildInquiryText, applyLeadTime, buildContactPanel,
  readyPromise, timeLabel, syncReadyTime, checkDeliveryBuffer, fulfilmentTimeOptions,
  applyBranchHours,
  requiredFields,
  orderLocation, applyChangeLockNote,
  OCCASIONS, THEME_COLOURS, missingAnswersMessage,
  blockedDateHtml,
} from "./contact-form.js";
import { earliestBookableDate, STANDARD_LEAD_DAYS, todayInManila } from "../domain/availability.js";
import { ASSISTED_DELIVERY, CLIENT_PICKUP, KITCHEN_HOURS, kitchenHoursFor } from "../domain/ready-time.js";

describe("fulfilmentTimeLabel", () => {
  /**
   * Both labels now say READY, because that is the only thing the kitchen
   * can promise. Spandi's runs no delivery fleet — a rider collects from the
   * branch — so "Delivery time" claimed a thing we do not do, on every
   * screen that quoted it.
   */
  it("names the field after the method the customer chose", () => {
    expect(fulfilmentTimeLabel(ASSISTED_DELIVERY)).toBe("Ready for the driver");
    expect(fulfilmentTimeLabel(CLIENT_PICKUP)).toBe("Ready for collection");
  });

  // A third method added to the cards without touching this map should still
  // produce something readable rather than "undefined".
  it("falls back to a neutral label for an unknown method", () => {
    expect(fulfilmentTimeLabel("Courier")).toBe("Ready time");
    expect(fulfilmentTimeLabel(undefined)).toBe("Ready time");
  });

  /** The old values are gone, not renamed around. */
  it("does not answer to the values it used to hold", () => {
    expect(fulfilmentTimeLabel("Delivery")).toBe("Ready time");
    expect(fulfilmentTimeLabel("Pickup")).toBe("Ready time");
  });
});

/**
 * On the form the field is asked, not labelled: it sits under "What time
 * does your event start?", and a bare "Ready for the driver" beneath that
 * read as a heading. The short labels stay for summary rows and the
 * kitchen sheet.
 */
describe("fulfilmentTimeQuestion", () => {
  it("asks who collects it, in the same shape as the event question", () => {
    expect(fulfilmentTimeQuestion(ASSISTED_DELIVERY)).toBe("What time should the driver collect it?");
    expect(fulfilmentTimeQuestion(CLIENT_PICKUP)).toBe("What time will you collect it?");
  });

  it("falls back to the delivery question rather than nothing", () => {
    expect(fulfilmentTimeQuestion(undefined)).toBe("What time should the driver collect it?");
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
    expect(text).toContain("Ready    : 09:00");
    expect(text).toContain("Date     : 2026-08-15");
  });

  it("labels the time as a collection when that is what was chosen", () => {
    const text = buildInquiryText("Party Trays", ["1 tray"], {
      ...base, fulfilment: CLIENT_PICKUP, address: "",
    });
    expect(text).toContain("Collect  : 09:00");
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
    // The ATTRIBUTE, not the word — the comments around these fields now
    // talk about what stays required, and counting prose made this fail
    // for a reason that had nothing to do with the form.
    expect((block.match(/^\s*required$/gm) ?? []).length).toBe(3);
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
    expect(ids(ASSISTED_DELIVERY)).toContain("cf-address");
    expect(ids(CLIENT_PICKUP)).not.toContain("cf-address");
  });

  // The event time is optional; the delivery/pickup time is what we schedule
  // against and has to be there.
  it("requires the event time now that the ready time is derived from it", () => {
    expect(ids(ASSISTED_DELIVERY)).toContain("cf-time");
    expect(ids(ASSISTED_DELIVERY)).toContain("cf-fulfilment-time");
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

/**
 * The three catering fields stay required — that is the client's rule and it
 * is not in question here. What changed is what they COST to answer, because
 * the cheapest way to lose an order is to ask ten questions at the end of a
 * long form and make every one of them a sentence typed with a thumb.
 */
describe("making the required answers cheap", () => {
  // Its own copy — the helper above lives inside another describe.
  const build = (opts = {}) => buildContactPanel({
    backAttr: "data-back", copyAttr: "data-submit", statusId: "s", ...opts,
  });

  const block = () => {
    const html = build({ showEventDetails: true });
    return html.slice(html.indexOf('id="cf-event-details"'), html.indexOf('for="cf-note"'));
  };

  it("suggests occasions without ever closing the list", () => {
    // The old objection stands: any list we wrote would be missing a
    // pamanhikan or a despedida, and a customer whose occasion is not on it
    // would have to pick the wrong one. A datalist has no such failure mode.
    const b = block();
    expect(b).toContain('list="cf-occasion-options"');
    expect(b).toContain("<datalist");
    expect(b).not.toContain("<select");
  });

  it("offers enough occasions to cover the common bookings", () => {
    expect(OCCASIONS.length).toBeGreaterThanOrEqual(6);
    expect(OCCASIONS).toContain("Birthday");
    expect(OCCASIONS).toContain("Corporate event");
  });

  /**
   * "Celebrant's name" has no honest answer for an office lunch. The file
   * already recorded that being raised and decided the other way — the field
   * stays, and stays required. The QUESTION is what changed, and it now has
   * an answer for everybody: "The team", "Q4 launch", "Lola's 80th".
   */
  it("asks something an office lunch can answer truthfully", () => {
    const b = block();
    expect(b).toMatch(/who are we celebrating/i);
    expect(b).not.toMatch(/celebrant&rsquo;s name/i);
    // Same field, same destination — only the wording moved.
    expect(b).toContain('name="celebrantName"');
  });

  it("puts colour swatches over the field rather than instead of it", () => {
    const b = block();
    expect(b).toContain("data-swatch");
    // The text input survives, so "burgundy and gold" still goes through.
    expect(b).toContain('id="cf-theme-color"');
    expect(b).toMatch(/placeholder="Or type it/);
  });

  it("sends the colour's NAME, never a hex", () => {
    // What reaches the kitchen is what a customer could always have typed.
    // Nothing downstream should have to learn what #9CAE8F means.
    const b = block();
    for (const c of THEME_COLOURS) expect(b).toContain(`data-swatch="${c.name}"`);
    expect(b).not.toMatch(/data-swatch="#/);
  });

  it("does not turn the swatches into a second field", () => {
    // One answer, one input. A second name= here would reach the server as a
    // competing value with no rule for which of them wins.
    const b = block();
    const named = (b.match(/name="themeColor"/g) ?? []).length;
    expect(named).toBe(1);
  });

  it("leaves every one of the three still required", () => {
    // The point of all of the above is that nothing was removed.
    const b = block();
    expect((b.match(/^\s*required$/gm) ?? []).length).toBe(3);
  });
});

/**
 * The sentence for somebody whose Send appeared to do nothing.
 *
 * Focus moves to the first unanswered field, which is right and is not
 * enough: on a phone that field can be well above the fold, so all the
 * customer sees is a button that did not work — and pressing it again is
 * then the only reasonable thing left to do.
 */
describe("telling someone what is still missing", () => {
  it("counts, so they know when they are finished", () => {
    expect(missingAnswersMessage(3)).toContain("3");
    expect(missingAnswersMessage(7)).toContain("7");
  });

  it("does not say '1 answers'", () => {
    const one = missingAnswersMessage(1);
    expect(one).toMatch(/one more answer/i);
    expect(one).not.toContain("1 answers");
  });

  it("says where they have been taken", () => {
    // The form scrolled under them. Saying so is the difference between
    // "it moved" and "something is broken".
    expect(missingAnswersMessage(2)).toMatch(/taken you to the first one/i);
    expect(missingAnswersMessage(1)).toMatch(/taken you to it/i);
  });

  it("says nothing at all when nothing is missing", () => {
    // Number(null) is 0 and Number(undefined) is NaN; neither may produce a
    // sentence, or a customer whose form is fine gets told it is not.
    for (const n of [0, null, undefined, -1, "", "abc", NaN]) {
      expect(missingAnswersMessage(n), String(n)).toBe("");
    }
  });
});

/**
 * What a customer sees on a date we cannot cook.
 *
 * This was three squeezed columns. The error element is flex with
 * align-items: center — built for one short sentence beside a warning dot —
 * and the refusal, the next open date and the way out were APPENDED to it,
 * so all three became flex items. Each ended up a third of a phone wide and
 * wrapped after two or three words, at the exact moment somebody is already
 * stuck.
 */
describe("a date that cannot be booked", () => {
  const html = () => blockedDateHtml(
    "Fully booked &mdash; please choose another date.",
    '<p class="date-next-open">Our next open date is <button data-pick-date="2027-01-04">4 Jan</button></p>',
    '<p class="way-out">Set on that date? <a>Message us</a></p>',
  );

  it("says what is wrong, what to do, then who to ask — in that order", () => {
    const h = html();
    expect(h.indexOf("Fully booked")).toBeLessThan(h.indexOf("next open date"));
    expect(h.indexOf("next open date")).toBeLessThan(h.indexOf("Set on that date"));
  });

  it("wraps the message so the panel can lay it out as a row of its own", () => {
    // A bare text node cannot be placed in the grid, which is what left it
    // sharing a line with the dot and the chip.
    expect(html()).toContain('class="form-field__error-msg"');
  });

  it("still offers the next open date as something to tap", () => {
    expect(html()).toContain("data-pick-date=");
  });

  it("holds together when there is no date to suggest", () => {
    // Nothing open in the window, or the suggestion would be the date they
    // already picked. The refusal and the way out still have to read.
    const h = blockedDateHtml("Fully booked.", "", '<p class="way-out">Message us</p>');
    expect(h).toContain("Fully booked.");
    expect(h).toContain("way-out");
    expect(h).not.toContain("undefined");
    expect(h).not.toContain("null");
  });

  it("holds together with nothing but the refusal", () => {
    expect(blockedDateHtml("Fully booked.")).toBe(
      '<span class="form-field__error-msg">Fully booked.</span>',
    );
  });
});

/**
 * The kitchen's promise, in the words a customer reads.
 *
 * This sentence replaced a required dropdown that two in three customers
 * filled in with their event start. It is the product now, not decoration:
 * if it says "two hours before your event" over a time that is nothing of
 * the kind, we have reproduced the exact failure the change existed to end,
 * only from our side of the form.
 */
describe("the ready-time promise", () => {
  it("states a clock time and the gap, for an ordinary evening", () => {
    const p = readyPromise("18:00", ASSISTED_DELIVERY);
    expect(p.headline).toContain("4:00 PM");
    expect(p.detail).toContain("2 hours");
    expect(p.tone).toBe("ok");
  });

  it("says collect for a pickup and driver for a delivery", () => {
    expect(readyPromise("18:00", CLIENT_PICKUP).headline).toMatch(/collect/i);
    expect(readyPromise("18:00", ASSISTED_DELIVERY).headline).toMatch(/driver/i);
  });

  it("says who collects it, for either method", () => {
    expect(readyPromise("18:00", ASSISTED_DELIVERY).headline)
      .toBe("We'll have it ready for the driver to collect by 4:00 PM.");
    expect(readyPromise("18:00", CLIENT_PICKUP).headline)
      .toBe("We'll have it ready for you to collect by 4:30 PM.");
    expect(readyPromise("08:00", ASSISTED_DELIVERY, "Batangas").headline)
      .toBe("We can have it ready for the driver to collect by 8:00 AM.");
  });

  it("allows the rider longer than the customer", () => {
    expect(readyPromise("18:00", ASSISTED_DELIVERY).time).toBe("16:00");
    expect(readyPromise("18:00", CLIENT_PICKUP).time).toBe("16:30");
  });

  /**
   * The case the design could not answer on its own: a six o'clock event and
   * a kitchen that opens at six. There is no "before" to be ready in, so the
   * sentence must not claim one.
   */
  it("claims no gap when the kitchen cannot be ready before the event", () => {
    const p = readyPromise("06:00", ASSISTED_DELIVERY);
    expect(p.tone).toBe("warn");
    expect(p.headline).not.toMatch(/before/i);
    expect(p.detail).toMatch(/as early as/i);
  });

  it("explains itself when the kitchen closes before the usual gap", () => {
    const p = readyPromise("21:00", ASSISTED_DELIVERY);
    expect(p.time).toBe("17:00");
    expect(p.detail).toMatch(/closes at 5 PM/i);
    expect(p.detail).toContain("4 hours");
  });

  it("warns rather than reassures when the gap is under an hour", () => {
    expect(readyPromise("06:45", ASSISTED_DELIVERY).tone).toBe("warn");
  });

  /**
   * The opening-hour clamp, the twin of the closing one above. It used to
   * fall through to the ordinary sentence, so a 6:30 AM event at Cavite was
   * told "30 minutes before your event, so there is time for the rider".
   */
  it("explains itself when the kitchen opens too late for the usual gap", () => {
    const short = readyPromise("06:30", ASSISTED_DELIVERY, "Cavite");
    expect(short.time).toBe("06:00");
    expect(short.detail).toBe(
      "This kitchen opens at 6 AM, so that is 30 minutes before your event rather than the usual gap.");
    expect(short.detail).not.toMatch(/so there is time/i);
    expect(short.tone).toBe("warn");

    const fine = readyPromise("09:00", CLIENT_PICKUP, "Batangas");
    expect(fine.time).toBe("08:00");
    expect(fine.detail).toMatch(/opens at 8 AM/);
    expect(fine.detail).toContain("1 hour before your event");
    expect(fine.tone).toBe("ok");
  });

  it("keeps the ordinary sentence when nothing was clamped", () => {
    expect(readyPromise("18:00", CLIENT_PICKUP, "Cavite").detail).toBe(
      "1 hour 30 minutes before your event, so there is time for your journey and for setting up.");
  });

  it("promises nothing before the customer has named a time", () => {
    for (const blank of ["", null, undefined, "nonsense"]) {
      expect(readyPromise(blank, ASSISTED_DELIVERY), String(blank)).toBeNull();
    }
  });

  it("never prints a bare 24-hour clock at a customer", () => {
    for (const at of ["06:00", "09:30", "13:00", "18:00", "21:00"]) {
      const p = readyPromise(at, ASSISTED_DELIVERY);
      expect(p.headline, at).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
    }
  });

  it("reads a clock the way a person says it", () => {
    expect(timeLabel("16:00")).toBe("4:00 PM");
    expect(timeLabel("00:30")).toBe("12:30 AM");
    expect(timeLabel("12:00")).toBe("12:00 PM");
    expect(timeLabel("nonsense")).toBe("");
  });
});

/**
 * The contract between the derived time and the field that carries it.
 *
 * syncReadyTime() writes the derived time straight into #cf-fulfilment-time.
 * A value with no matching <option> does not throw — the browser silently
 * blanks the select, and the customer sends an order with no ready time on
 * it and no indication anything went wrong.
 *
 * So this walks every event time the form offers, both methods, and checks
 * the answer against the options actually rendered. It is the one assertion
 * standing between a changed kitchen window and silent data loss.
 */
describe("every derived time has an option to land on", () => {
  const html = buildContactPanel({
    backAttr: "data-back", copyAttr: "data-copy", statusId: "s",
    summaryRows: [], orderTotal: 1000,
  });

  const valuesIn = (markup) =>
    [...markup.matchAll(/value="(\d{2}:\d{2})"/g)].map((m) => m[1]);

  const eventTimes = () => {
    // Sliced by index rather than matched by one regex: `[\s\S]` inside a
    // template literal is read by JS as the escape `\s` first and collapses
    // to the character class [sS], which quietly matched almost nothing.
    const at = html.indexOf('id="cf-time"');
    expect(at, 'no id="cf-time" in the rendered panel').toBeGreaterThan(-1);
    const end = html.indexOf("</select>", at);
    return valuesIn(html.slice(at, end));
  };

  it("offers every half hour of the day as an event time", () => {
    expect(eventTimes()).toHaveLength(48);
  });

  it("renders the panel with the narrowest window, before a branch is named", () => {
    const at = html.indexOf('id="cf-fulfilment-time"');
    const end = html.indexOf("</select>", at);
    const shown = valuesIn(html.slice(at, end));
    expect(shown[0]).toBe(kitchenHoursFor(null).opens);
    expect(shown.at(-1)).toBe(kitchenHoursFor(null).closes);
    // Nothing only Cavite could honour, because the answer would move under
    // a customer who picked a branch afterwards.
    expect(shown).not.toContain("06:00");
  });

  it("offers exactly what each branch can honour, and nothing it cannot", () => {
    for (const [branch, hours] of Object.entries(KITCHEN_HOURS)) {
      const shown = valuesIn(fulfilmentTimeOptions(branch));
      expect(shown[0], branch).toBe(hours.opens);
      expect(shown.at(-1), branch).toBe(hours.closes);
    }
    expect(valuesIn(fulfilmentTimeOptions("Cavite"))).toContain("06:00");
    expect(valuesIn(fulfilmentTimeOptions("Batangas"))).not.toContain("06:00");
  });

  /**
   * The one assertion standing between a changed kitchen window and silent
   * data loss. syncReadyTime() writes the derived time straight into the
   * select; a value with no matching <option> does not throw — the browser
   * blanks the field, and the order goes out with no ready time on it.
   */
  it("lands on a real option for every event time, branch and method", () => {
    for (const branch of Object.keys(KITCHEN_HOURS)) {
      const ready = new Set(valuesIn(fulfilmentTimeOptions(branch)));
      for (const at of eventTimes()) {
        for (const method of [ASSISTED_DELIVERY, CLIENT_PICKUP]) {
          const p = readyPromise(at, method, branch);
          expect(p, `${branch} ${at} ${method}`).toBeTruthy();
          expect(ready.has(p.time),
            `${branch} ${at} ${method} -> ${p.time} is not an option`).toBe(true);
        }
      }
    }
  });

  it("does the same for a customer who has not named a branch", () => {
    const ready = new Set(valuesIn(fulfilmentTimeOptions(null)));
    for (const at of eventTimes()) {
      const p = readyPromise(at, ASSISTED_DELIVERY, null);
      expect(ready.has(p.time), `${at} -> ${p.time} is not an option`).toBe(true);
    }
  });
});

describe("the form the customer actually sees", () => {
  const html = buildContactPanel({
    backAttr: "data-back", copyAttr: "data-copy", statusId: "s",
    summaryRows: [], orderTotal: 1000,
  });

  it("asks one time question, as a question", () => {
    expect(html).toContain("What time does your event start?");
  });

  it("keeps the kitchen's answer away until there is one to give", () => {
    expect(html).toMatch(/<div class="ready-panel" id="cf-ready-panel"[^>]*hidden/);
  });

  it("keeps the override behind a tap", () => {
    expect(html).toMatch(/id="cf-fulfilment-time-field"[^>]*hidden/);
    expect(html).toContain("Change this time");
  });

  it("names the two ways an order leaves the kitchen", () => {
    expect(html).toContain("Assisted delivery");
    expect(html).toContain("Client pickup");
    // The old name claimed a fleet that does not exist.
    expect(html).not.toContain('data-fulfilment-value="Delivery"');
    expect(html).not.toContain('data-fulfilment-value="Pickup"');
  });

  it("no longer offers 'no specific time', because the kitchen needs one", () => {
    expect(html).not.toContain("No specific time");
  });
});

/**
 * syncReadyTime, against a stand-in DOM.
 *
 * It is the only thing that writes the submitted ready time, so every way it
 * can be reached matters: the customer answering, the method changing under
 * them, the override opening, and — the one that bit — a restored draft,
 * where no change event ever fires.
 */
describe("keeping the promise in step with the answer", () => {
  const page = (eventTime, method = ASSISTED_DELIVERY, overriding = false, chosen = null) => {
    const el = {
      "cf-time":                    { value: eventTime },
      "cf-fulfilment":              { value: method },
      "cf-fulfilment-time":         { value: chosen ?? "" },
      "cf-fulfilment-time-field":   { hidden: !overriding },
      "cf-fulfilment-time-warning": { textContent: "", hidden: true },
      "cf-ready-panel":  { hidden: true, classes: new Set(),
        classList: { toggle(name, on) { on ? el["cf-ready-panel"].classes.add(name)
                                          : el["cf-ready-panel"].classes.delete(name); } } },
      "cf-ready-line":    { textContent: "" },
      "cf-ready-note":    { textContent: "" },
      "cf-ready-restore": { hidden: true, textContent: "", dataset: {} },
    };
    vi.stubGlobal("document", { getElementById: (id) => el[id] ?? null });
    return el;
  };

  afterEach(() => vi.unstubAllGlobals());

  it("writes the derived time into the field that gets submitted", () => {
    const el = page("18:00");
    syncReadyTime();
    expect(el["cf-fulfilment-time"].value).toBe("16:00");
  });

  it("shows the promise, in the words the customer reads", () => {
    const el = page("18:00");
    syncReadyTime();
    expect(el["cf-ready-panel"].hidden).toBe(false);
    expect(el["cf-ready-line"].textContent).toContain("4:00 PM");
    expect(el["cf-ready-note"].textContent).toContain("2 hours");
  });

  it("moves the time when the method changes under it", () => {
    const el = page("18:00", CLIENT_PICKUP);
    syncReadyTime();
    expect(el["cf-fulfilment-time"].value).toBe("16:30");
  });

  it("marks the panel when the kitchen has something awkward to say", () => {
    const el = page("06:00");
    syncReadyTime();
    expect(el["cf-ready-panel"].classes.has("ready-panel--warn")).toBe(true);
  });

  /**
   * A customer who picks a time and then clears it would otherwise submit a
   * ready time derived from an answer no longer on the form.
   */
  it("clears the submitted time when the event time goes away", () => {
    const el = page("", ASSISTED_DELIVERY, false, "16:00");
    syncReadyTime();
    expect(el["cf-fulfilment-time"].value).toBe("");
    expect(el["cf-ready-panel"].hidden).toBe(true);
  });

  it("stands aside once the customer opens the override", () => {
    const el = page("18:00", ASSISTED_DELIVERY, true, "17:00");
    syncReadyTime();
    expect(el["cf-ready-panel"].hidden).toBe(true);
    // Their choice is left alone — that is the point of an override.
    expect(el["cf-fulfilment-time"].value).toBe("17:00");
  });

  /**
   * A warning that only diagnoses leaves somebody stuck with a problem they
   * did not understand. The way back is a button, not a sentence.
   */
  it("offers our own answer back when theirs differs", () => {
    const el = page("18:00", ASSISTED_DELIVERY, true, "17:00");
    syncReadyTime();
    expect(el["cf-ready-restore"].hidden).toBe(false);
    expect(el["cf-ready-restore"].textContent).toBe("Use 4:00 PM instead");
    expect(el["cf-ready-restore"].dataset.readyTime).toBe("16:00");
  });

  /**
   * The warning the override exists to make reachable. It used to print the
   * raw "16:00", say "arrives" over a field that is a ready time, and give no
   * figure for how late an after-the-start time was.
   */
  describe("the warning under an overridden time", () => {
    const warn = (eventTime, chosen, method = ASSISTED_DELIVERY, branch = "") => {
      const el = page(eventTime, method, true, chosen);
      el["cf-branch"] = { value: branch };
      el["cf-fulfilment-time-warning"].innerHTML = "";
      syncReadyTime();
      return el["cf-fulfilment-time-warning"];
    };
    // What a customer reads, without the tags.
    const text = (w) => w.innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    /**
     * The case in the screenshot that prompted this: an event picked as
     * 12:30 AM when 12:30 PM was meant. "15 hours after" alone hid it; the
     * two clocks side by side show it.
     */
    it("names the problem first, then both clocks, then our own gap", () => {
      const w = warn("00:30", "15:30");
      expect(w.hidden).toBe(false);
      expect(w.innerHTML).toBe(
        "<strong>Ready 15 hours after your event starts.</strong>" +
        "<span>Your event starts at 12:30 AM and this order is ready at 3:30 PM. " +
        "Allow time for delivery and setting up. We recommend having it ready 2 hours before.</span>" +
        "<span>You can still continue.</span>");
    });

    it("says pickup, and the pickup gap, for a collection", () => {
      expect(text(warn("16:00", "16:30", CLIENT_PICKUP))).toContain(
        "Allow time for pickup and setting up. We recommend having it ready 1 hour 30 minutes before.");
    });

    it("names a time on the start itself", () => {
      expect(warn("16:00", "16:00").innerHTML)
        .toContain("<strong>Ready exactly as your event starts.</strong>");
    });

    it("says how short a gap under the hour is", () => {
      expect(warn("16:00", "15:15").innerHTML)
        .toContain("<strong>Ready only 45 minutes before your event.</strong>");
    });

    it("says ready, never arrives, and never a 24-hour clock", () => {
      for (const method of [ASSISTED_DELIVERY, CLIENT_PICKUP]) {
        const said = text(warn("16:00", "16:30", method));
        expect(said, method).not.toMatch(/arrives/i);
        expect(said, method).not.toMatch(/\b16:(00|30)\b/);
      }
    });

    it("is red when an earlier time was there to choose", () => {
      expect(warn("16:00", "16:30").className).toBe("form-field__warn");
    });

    /**
     * The screenshot that prompted this: an 8 AM event at a kitchen that
     * opens at 8. "We recommend 2 hours before" was advice nobody could act
     * on, so it says what the kitchen can do and offers the way forward.
     */
    it("does not recommend the impossible when it is already the opening hour", () => {
      const w = warn("08:00", "08:00", ASSISTED_DELIVERY, "Batangas");
      expect(w.className).toBe("form-field__warn form-field__warn--notice");
      expect(w.innerHTML).toBe(
        "<strong>Ready exactly as your event starts.</strong>" +
        "<span>This kitchen opens at 8 AM, so 8:00 AM is the earliest we can have it ready. " +
        "If you need it sooner, message us and we’ll see what we can do.</span>" +
        "<span>You can still continue.</span>");
      expect(text(w)).not.toMatch(/recommend/i);
    });

    it("knows Cavite opens earlier, so 8 AM there is a choice, not a limit", () => {
      const w = warn("08:00", "08:00", ASSISTED_DELIVERY, "Cavite");
      expect(w.className).toBe("form-field__warn");
      expect(text(w)).toMatch(/We recommend having it ready 2 hours before/);
    });

    it("stays quiet, and empty, at an hour or more", () => {
      const w = warn("16:00", "15:00");
      expect(w.hidden).toBe(true);
      expect(w.innerHTML).toBe("");
    });
  });

  it("stops offering it once they are back on our answer", () => {
    const el = page("18:00", ASSISTED_DELIVERY, true, "16:00");
    syncReadyTime();
    expect(el["cf-ready-restore"].hidden).toBe(true);
  });

  it("does not fall over on a page that has none of these", () => {
    vi.stubGlobal("document", { getElementById: () => null });
    expect(() => syncReadyTime()).not.toThrow();
  });
});

/**
 * The call at the end of attachFormPickers, read off the source.
 *
 * Found by breaking it: removing that one line failed no test at all. It is
 * the only thing that runs the derivation for a RESTORED DRAFT, where the
 * saved event time is put back without a change event. Without it the
 * customer returns to a half-filled form, sees no promise, and presses Send
 * on an order with no ready time — which fails validation against a field
 * that is hidden behind the override, so nothing on screen says why.
 *
 * Asserted against the text because the alternative is standing up the whole
 * form, its pickers and its draft restore, and a test nobody can maintain is
 * a test that stops being true.
 */
describe("the derivation runs on load, not only on change", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "contact-form.js"), "utf8");

  it("ends attachFormPickers by running the whole derivation", () => {
    const m = /export function attachFormPickers\([\s\S]*?\n\}/.exec(source);
    expect(m, "attachFormPickers has been renamed").toBeTruthy();
    const tail = m[0].slice(-400);
    expect(tail, "the init call is gone — a restored draft would submit no ready time")
      .toContain("syncReadyTime()");
  });

  it("runs it after the draft has been put back, not before", () => {
    const m = /export function attachFormPickers\([\s\S]*?\n\}/.exec(source);
    expect(m[0].indexOf("persistContactForm")).toBeLessThan(m[0].lastIndexOf("syncReadyTime()"));
  });
});

/**
 * The control, rebuilt for the branch that is now chosen.
 *
 * Cavite opens at six and the other two at eight, so a time one kitchen can
 * honour is a time another cannot. The options are rebuilt rather than left
 * in place and refused on submit: a choice the app will reject should not be
 * on the control at all.
 */
describe("the ready-time options when the branch changes", () => {
  const page = (branch, chosen = "") => {
    const el = {
      "cf-branch":                 { value: branch },
      "cf-fulfilment-time":        { value: chosen, innerHTML: "" },
      "cf-fulfilment-time-hours":  { textContent: "" },
    };
    vi.stubGlobal("document", { getElementById: (id) => el[id] ?? null });
    return el;
  };

  afterEach(() => vi.unstubAllGlobals());

  it("offers Cavite the six o'clock slot", () => {
    const el = page("Cavite");
    applyBranchHours();
    expect(el["cf-fulfilment-time"].innerHTML).toContain('value="06:00"');
  });

  it("does not offer it to a branch that opens at eight", () => {
    for (const branch of ["Batangas", "Montalban"]) {
      const el = page(branch);
      applyBranchHours();
      expect(el["cf-fulfilment-time"].innerHTML, branch).not.toContain('value="06:00"');
      expect(el["cf-fulfilment-time"].innerHTML, branch).toContain('value="08:00"');
    }
  });

  it("says which hours this kitchen keeps", () => {
    const cavite = page("Cavite");
    applyBranchHours();
    expect(cavite["cf-fulfilment-time-hours"].textContent).toBe("6 AM – 5 PM");

    const batangas = page("Batangas");
    applyBranchHours();
    expect(batangas["cf-fulfilment-time-hours"].textContent).toBe("8 AM – 5 PM");
  });

  it("keeps a chosen time the new branch can still honour", () => {
    const el = page("Batangas", "10:00");
    applyBranchHours();
    expect(el["cf-fulfilment-time"].value).toBe("10:00");
  });

  /**
   * Switching Cavite to Batangas with 6 AM chosen: that time no longer
   * exists on the control, so it is dropped rather than carried as a value
   * with no option behind it. syncReadyTime() puts the derived answer back.
   */
  it("drops one it cannot, rather than carrying a value with no option", () => {
    const el = page("Batangas", "06:00");
    applyBranchHours();
    expect(el["cf-fulfilment-time"].value).toBe("");
  });

  it("falls back to the narrowest window before a branch is named", () => {
    const el = page("");
    applyBranchHours();
    expect(el["cf-fulfilment-time"].innerHTML).not.toContain('value="06:00"');
    expect(el["cf-fulfilment-time-hours"].textContent).toBe("8 AM – 5 PM");
  });

  it("does not fall over on a page that has none of these", () => {
    vi.stubGlobal("document", { getElementById: () => null });
    expect(() => applyBranchHours()).not.toThrow();
  });
});

/**
 * Two wirings that no behavioural test reaches, both found by breaking them.
 *
 * Deleting either failed nothing: the branch picker's handler and the
 * server's window check are each one call inside a function that would need
 * the whole form, or the whole request pipeline, standing up to exercise.
 * Asserted against the source, which is the difference between a guard that
 * is there and a guard nobody notices leaving.
 */
describe("the wiring that holds it together", () => {
  const form = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "contact-form.js"), "utf8");
  const server = fs.readFileSync(
    path.join(process.cwd(), "api", "ghl-inquiry.js"), "utf8");

  it("rebuilds the options AND rederives the answer when the branch changes", () => {
    const m = /groupId: "cf-branch-group"[\s\S]*?\n {2}\}\);/.exec(form);
    expect(m, "the branch picker has been renamed").toBeTruthy();
    expect(m[0], "options would keep a slot this branch cannot honour")
      .toContain("applyBranchHours()");
    expect(m[0], "the answer would stay on the previous branch's window")
      .toContain("syncReadyTime()");
  });

  it("still checks the time against the branch on the server", () => {
    // This is where it started: the server held its own copy of the bounds,
    // and when the window became per branch that copy went undefined.
    expect(server).toContain("isWithinKitchenHours(fulfilmentTime, opportunityFields.branch)");
    expect(server, "a second copy of the bounds is how this broke the first time")
      .not.toMatch(/FULFILMENT_TIME_(MIN|MAX)\s*=/);
  });
});
