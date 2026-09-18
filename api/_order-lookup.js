/**
 * The decisions behind the Order Status lookup, kept out of the handler.
 *
 * This is the only unauthenticated read of a real booking in the system, so
 * the rules that keep it safe are here as functions with tests rather than as
 * branches inside a request handler nobody can run.
 *
 * The credential is two facts a customer knows and a stranger does not: the
 * email or phone they booked with, and the date of their event. That is
 * deliberately weaker than the payment link, which is a minted secret — so
 * this view shows strictly less. The dashboard team put the argument well
 * when they asked us to drop the money: an email is not a secret, and event
 * dates cluster on weekends, so the guessing space is small. What that would
 * have exposed is not "an order exists" but what someone paid and still owes.
 */

/** How far back a finished event stays lookupable. */
export const LOOKUP_WINDOW_DAYS = 30;

/**
 * Philippine mobile numbers arrive written every way a person can write one:
 * 0917 123 4567, +63 917 123 4567, 63917-123-4567. The last ten digits are
 * the same in all of them, and comparing those is what makes a customer's own
 * number match the one we stored without asking them to guess our format.
 */
export function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

export function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

/**
 * The forms to search GoHighLevel for, in the order worth trying.
 *
 * Its ?query= does not normalise phone numbers. Verified against the live
 * API: a contact stored as +639617178022 is found by "+639617178022" and by
 * nothing else — "09617178022", "0961 717 8022", "639617178022" and
 * "9617178022" all return zero results.
 *
 * Every Filipino writes their own number as 0917..., so searching only what
 * was typed would have failed every phone lookup in production while
 * answering, indistinguishably, that the booking does not exist. That path
 * exists specifically for the customers who have no email on file — the
 * bookings typed in from the Excel book — so it would have failed exactly
 * the people it was added for.
 *
 * E.164 first because that is how GoHighLevel stores what the form sends.
 * The typed form is kept as a fallback for any contact entered by hand in
 * local format, and a leading + for a number from outside the Philippines.
 */
export function searchCandidates(identifier) {
  const typed = String(identifier ?? "").trim();
  if (!typed) return [];
  if (looksLikeEmail(typed)) return [typed];

  const last10 = normalizePhone(typed);
  if (!last10) return [typed];

  const digits = typed.replace(/\D/g, "");
  return [...new Set([`+63${last10}`, typed, `+${digits}`])];
}

/**
 * Does this contact really match what was typed?
 *
 * GoHighLevel's ?query= search is a fuzzy one — it matches across fields and
 * on partial strings — so trusting what it returns would let a fragment of
 * somebody's address find a stranger's booking. The search narrows; this
 * decides.
 */
export function identifierMatches(contact, identifier) {
  const typed = String(identifier ?? "").trim();
  if (!typed) return false;

  if (looksLikeEmail(typed)) {
    return String(contact?.email ?? "").trim().toLowerCase() === typed.toLowerCase();
  }
  const typedPhone = normalizePhone(typed);
  if (!typedPhone) return false;
  return normalizePhone(contact?.phone) === typedPhone;
}

/**
 * Is this event recent enough to look up?
 *
 * Agreed with the dashboard team that this belongs on our side. Their copy of
 * the event date is null on 33 of 37 rows and does not follow a reschedule,
 * so a view filtered on it would return nothing for everybody. We compare
 * against GoHighLevel's date, which is the authoritative one.
 *
 * Both arguments are plain YYYY-MM-DD, compared as strings rather than as
 * Date objects on purpose: `new Date("2026-10-11")` is midnight UTC, which is
 * the previous evening in Manila, and an event would drop out of the window a
 * day early for every customer.
 */
export function withinLookupWindow(eventDate, today, days = LOOKUP_WINDOW_DAYS) {
  const date = String(eventDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;

  const floor = new Date(`${today}T00:00:00Z`);
  floor.setUTCDate(floor.getUTCDate() - days);
  return date >= floor.toISOString().slice(0, 10);
}

/**
 * What a booking is worth, what has arrived, and what is still owed.
 *
 * Money is shown here on the client's decision, against the dashboard
 * team's advice and ours — the gate is two facts a determined stranger
 * could obtain, and what it guards is what somebody paid. The judgement
 * that it is worth it is theirs to make; it is their business and their
 * customers. What is NOT negotiable is that the same gate must not also
 * reach a name, a phone number or a home address, which is why the payment
 * page stops drawing those in the same change.
 *
 * Number(null) is 0 rather than NaN, which is why amount_paid is checked
 * for emptiness before it is coerced: an unset field would otherwise read
 * as a confident zero, and 'Paid so far: PHP 0' on a booking somebody has
 * already settled is the single worst thing this page could say.
 */
export function orderMoney({ monetaryValue, amountPaid } = {}) {
  const total = Number(monetaryValue);
  if (!Number.isFinite(total) || total <= 0) return null;

  const rawPaid = String(amountPaid ?? "").replace(/[^0-9.-]/g, "");
  const paid = rawPaid === "" ? null : Number(rawPaid);
  const known = Number.isFinite(paid) && paid >= 0;

  return {
    total,
    // Half, rounded the same way every other percentage in this codebase
    // is — see the note in src/domain/pricing.js on float dust.
    reserve: Math.round(total / 2),
    paid: known ? paid : null,
    // Unknown stays unknown. Assuming nothing has been paid would tell a
    // customer who has already reserved that they owe the full amount.
    balance: known ? Math.max(0, total - paid) : null,
  };
}

/**
 * What actually leaves the server.
 *
 * One function, so "what does a stranger who guessed a date get to see" has a
 * single answer with a test on it, rather than being whatever the handler
 * happened to spread into a response.
 *
 * Money is absent by construction. So are the name, address, phone and email
 * the customer already knows — echoing those back proves nothing and leaks on
 * a wrong guess. The event date is not echoed either: the customer supplied
 * it, so returning it would confirm a guess rather than tell them anything.
 */
export function publicOrderView({
  step, timeline, offTimeline, fields = {}, groups = null, money = null, payUrl = null,
  windows = null, request = null, packageId = null,
}) {
  return {
    found: true,
    step: step?.id ?? null,
    stepLabel: step?.label ?? null,
    offTimeline: offTimeline ? { id: offTimeline.id, label: offTimeline.label } : null,
    timeline: (timeline ?? []).map((s) => ({
      id: s.id, label: s.label, done: Boolean(s.done), current: Boolean(s.current),
    })),
    branch: fields.branch || null,
    eventTime: fields.event_time || null,
    receiveMethod: fields.receive_method || null,
    fulfilmentTime: fields.delivery__pickup_time || null,
    // The order itself. groups is null for anything placed before the column
    // existed, and the screen falls back to the flat description then.
    groups: Array.isArray(groups) && groups.length > 0 ? groups : null,
    packageName: fields.package_name || fields.service_type || null,
    // Null when the booking has no figure worth showing, so the screen
    // drops the panel rather than drawing an empty one.
    money: money ?? null,
    // Only ever the customer's OWN payment link, and only when one exists.
    payUrl: payUrl || null,
    paymentStatus: fields.payment_status || null,
    // Whether each kind of request is open, evaluated now. Sent as the
    // closing DATE rather than a countdown: the screen says "until 30
    // September", which is checkable, instead of a number ticking down.
    canChange: Boolean(windows?.change?.allowed),
    canAdd:    Boolean(windows?.add?.allowed),
    changeClosesOn: windows?.change?.closesOn ?? null,
    addClosesOn:    windows?.add?.closesOn ?? null,
    // Their own request, so they are never left wondering whether it went
    // through. Only the fields they need to read it back — decided_by and
    // the rest belong to the dashboard and are nobody else's business.
    // The catalogue row this booking is for, so the builder can start the
    // customer from what they already have rather than an empty cart.
    packageId: packageId || null,
    request: request
      ? {
          kind: request.kind ?? null,
          status: request.status ?? null,
          after: request.after ?? null,
          note: request.decided_note || null,
        }
      : null,
    paxCount: fields.pax_count || null,
    dishes: fields.dishes_selected || null,
  };
}

/**
 * The one answer given whenever a lookup does not produce an order.
 *
 * Identical for a wrong date, an unknown email, an event outside the window
 * and a booking that does not exist. Anything that distinguishes them tells
 * someone probing which half they got right, and an HTTP status does that as
 * loudly as a message — so this is a 200 as well.
 */
export function notFound() {
  return {
    found: false,
    message:
      "We couldn't find an order with those details. Check that the email or " +
      "number is the one you booked with, and that the event date is right. " +
      "If it still doesn't show, message us and we'll look it up for you.",
  };
}
