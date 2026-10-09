/**
 * When the food has to be ready, worked out from when the event starts.
 *
 * ── Why the customer stopped being asked ──────────────────────────────────
 *
 * There used to be two time fields: "Event Time", optional, and "Delivery
 * time", required. Two in three customers put the same answer in both, and
 * another 6% named a time after the event had already started — measured
 * across the orders that filled in both, not guessed.
 *
 * Three attempts at explaining it had already shipped: the label renames
 * itself per method, a paragraph underneath says it is not the event start,
 * and a live warning fires under an hour. All three were in place for the
 * 66%, so a fourth sentence was not going to do it.
 *
 * The mistake was never really a reading mistake. Nobody ordering a party
 * knows how long before it catering should be ready — that is the caterer's
 * trade, not the customer's. So the question is no longer asked. They answer
 * what they know, we state what we know, and the second field only appears
 * for the people who have a reason to argue with it.
 *
 * ── The kitchen window is not negotiable ──────────────────────────────────
 *
 * 06:00 to 17:00, and the derived time is clamped into it. That clamp is why
 * this returns a shape rather than a string: an event at eight in the
 * morning cannot have food ready two hours before it, and a sentence saying
 * so would be a lie the kitchen has to live with. The caller is told what
 * the gap ACTUALLY came out as, and whether the clamp bit, so it can say
 * something true instead.
 */

/**
 * When each kitchen is open. Not one window — they differ.
 *
 * Cavite starts two hours earlier than the other two, which matters because
 * the ready time is derived and then clamped into this: quoting 6 AM on a
 * Batangas booking would be a promise that branch cannot keep, made by us
 * rather than asked for by the customer.
 *
 * The default is the NARROWEST window, not the widest. A customer who has
 * not named a branch yet should never be shown a time only one kitchen can
 * manage, because the branch cards sit above this on the form and the
 * answer would move under them.
 */
export const KITCHEN_HOURS = {
  Cavite:    { opens: "06:00", closes: "17:00" },
  Batangas:  { opens: "08:00", closes: "17:00" },
  Montalban: { opens: "08:00", closes: "17:00" },
};

const DEFAULT_HOURS = { opens: "08:00", closes: "17:00" };

/** The widest any branch runs, for the controls that must cover them all. */
export const EARLIEST_OPEN = "06:00";
export const LATEST_CLOSE  = "17:00";

/** A branch's hours, or the narrowest window when we do not know it yet. */
export function kitchenHoursFor(branch) {
  return KITCHEN_HOURS[String(branch ?? "").trim()] ?? DEFAULT_HOURS;
}

/**
 * The two ways an order leaves the kitchen.
 *
 * Spandi's runs no delivery fleet. "Assisted delivery" is a driver — booked
 * for the customer — collecting from the branch, which is why the kitchen's
 * promise is a READY time and never an arrival: the road is not ours to
 * promise. The old value said "Delivery", which claimed otherwise on every
 * screen in the CRM.
 */
export const ASSISTED_DELIVERY = "Assisted delivery";
export const CLIENT_PICKUP     = "Client pickup";

/**
 * How long before the event the food should be ready, by method.
 *
 * Longer for assisted delivery because a rider has to collect and drive it;
 * shorter for a pickup, where the only journey is the customer's own and
 * they are the ones judging it.
 *
 * Both are the caterer's numbers to set and nothing reads them but this
 * file. Changing one changes every screen that quotes it.
 */
const DEFAULT_GAP_MIN = {
  [ASSISTED_DELIVERY]: 120,
  [CLIENT_PICKUP]: 90,
};

/**
 * Below this, the gap is worth saying something about.
 *
 * Same figure the old two-field warning used, kept because the evidence
 * behind it has not changed: everyone who left any gap at all left an hour
 * or more, so an hour separates "meant it" from "did not realise".
 */
export const MIN_SENSIBLE_GAP = 60;

/**
 * Whether this order is collected by the customer themselves.
 *
 * Exported because eight places used to compare against the literal string
 * "Pickup" — the address requirement, the label swap, the warning's verb,
 * the summary row, delivery_address on the opportunity, the payment page.
 * Renaming the methods meant touching all eight, and a ninth written later
 * would have gone on comparing against a value that no longer exists.
 *
 * The old "Pickup" still counts. The form never writes it again, but
 * GoHighLevel holds it on every booking made before the rename, and the
 * payment page reads those back — without this, each of them would be
 * labelled "Ready for the driver". Exact matches rather than /pickup/i, so a
 * blank or garbled value still reads as a delivery and the address is
 * still asked for.
 */
const LEGACY_PICKUP = "Pickup";

export function isPickup(method) {
  const value = String(method ?? "");
  return value === CLIENT_PICKUP || value === LEGACY_PICKUP;
}

/**
 * Whether a branch can honour this time at all.
 *
 * Shared by the browser and the server. The server's copy used to be its own
 * pair of constants, and when the window became per-branch those constants
 * quietly became undefined — every comparison against undefined is false, so
 * the check passed everything and said nothing. One definition, imported by
 * both, is the only way that stays fixed.
 *
 * Zero-padded 24-hour strings compare correctly as strings, which also
 * catches a malformed value rather than coercing it into range.
 */
export function isWithinKitchenHours(value, branch) {
  const { opens, closes } = kitchenHoursFor(branch);
  const time = String(value ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(time)) return false;
  return time >= opens && time <= closes;
}

/** The gap this method asks for, in minutes, before any clamping. */
export function gapFor(method) {
  return DEFAULT_GAP_MIN[method] ?? DEFAULT_GAP_MIN[ASSISTED_DELIVERY];
}

/** "14:30" -> 870. Null for anything that is not a time of day. */
export function minutesOfDay(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const mins  = Number(m[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/** 870 -> "14:30", zero-padded, which is what GoHighLevel's fields hold. */
function hhmm(total) {
  const hours = Math.floor(total / 60);
  return `${String(hours).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The gap in words, for a sentence a customer reads.
 *
 * "2 hours", "1 hour 30 minutes", "45 minutes". Never "120 minutes", which
 * is the same fact in a form nobody converts in their head.
 */
export function gapInWords(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const mins  = total % 60;
  const parts = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (mins)  parts.push(`${mins} minute${mins === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" ") : "no time";
}

/**
 * When the kitchen will have it ready, given when the event starts.
 *
 * @param {string} eventTime  "HH:MM", the customer's only time answer
 * @param {string} method     ASSISTED_DELIVERY or CLIENT_PICKUP
 * @returns {{
 *   time: string|null,      the ready time, "HH:MM", clamped into kitchen hours
 *   requestedGap: number,   what the method asked for, in minutes
 *   gapMinutes: number|null the gap actually achieved — negative if the clamp
 *                           pushed it past the event start
 *   clamped: "open"|"close"|null
 *   tooLate: boolean        ready at or after the event begins
 *   short: boolean          a real gap, but under the hour
 * }}
 *
 * Null time when the event time cannot be read, so a caller rendering before
 * the customer has answered shows nothing rather than a guess.
 */
export function readyTimeFor(eventTime, method, branch) {
  const requestedGap = gapFor(method);
  const start = minutesOfDay(eventTime);
  const hours = kitchenHoursFor(branch);

  if (start === null) {
    return { time: null, requestedGap, gapMinutes: null, clamped: null, tooLate: false, short: false, hours };
  }

  const opens  = minutesOfDay(hours.opens);
  const closes = minutesOfDay(hours.closes);

  let ready = start - requestedGap;
  let clamped = null;

  // Order matters only in that both cannot apply: opens < closes, so a value
  // below the floor is never also above the ceiling.
  if (ready < opens) {
    ready = opens;
    clamped = "open";
  } else if (ready > closes) {
    ready = closes;
    clamped = "close";
  }

  const gapMinutes = start - ready;

  return {
    time: hhmm(ready),
    requestedGap,
    gapMinutes,
    clamped,
    // An early event: the kitchen opens at six and the party starts at seven,
    // so there is no "before" to be ready in. Said plainly rather than
    // dressed up, because the customer may want to move the event or call us.
    tooLate: gapMinutes <= 0,
    short: gapMinutes > 0 && gapMinutes < MIN_SENSIBLE_GAP,
    hours,
  };
}
