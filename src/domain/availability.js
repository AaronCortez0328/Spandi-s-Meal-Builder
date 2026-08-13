/**
 * Whether a date can still take a booking. Pure functions, no I/O.
 *
 * Written like domain/pricing.js and for the same reason: the browser decides
 * whether to let someone submit, and the server decides whether to accept the
 * submission, and the two must agree. Both call these; each fetches the rows
 * its own way — the browser through the anon key, the serverless function
 * through the service role — and neither needs to know how the other did it.
 *
 * The rows come from the `active_blocked_dates` view, which the dashboard
 * maintains. Every row in it is currently blocking; the underlying table keeps
 * unblocked history that we never see. Shape:
 *
 *   { blocked_date: "2026-08-08", branch: "Cavite" | null, reason: "Fully booked" }
 *
 * Absence is availability. An empty list means every date is open, which is
 * what makes it safe for this to fail soft — see the note on failing open at
 * the bottom of this file.
 */

/**
 * Every date in this system is a plain calendar day: `blocked_date` is a
 * Postgres `date`, and <input type="date"> yields "YYYY-MM-DD". Neither
 * carries a timezone, so as long as both sides compare strings there is
 * nothing to convert and nothing to get wrong.
 *
 * Where it does matter is "what is today", which only todayInManila() below
 * answers, and which is deliberately not UTC — a serverless function running
 * at 01:00 UTC is already the next day in Manila, and would otherwise
 * consider a date past that the kitchen still has ahead of it.
 */
export const BOOKING_TZ = "Asia/Manila";

/**
 * Today's calendar date where the kitchen is, as "YYYY-MM-DD".
 *
 * en-CA is not an affectation — it is the locale whose short date format is
 * already ISO, so this needs no manual padding or reassembly.
 */
export function todayInManila(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BOOKING_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * The row blocking this date for this branch, or null if it is available.
 *
 * Returning the row rather than a boolean is what lets the caller show the
 * reason. "Fully booked" and "Holiday" send a customer in different
 * directions — one waits, the other phones — and the difference costs nothing
 * to carry.
 *
 * @param {Array}  rows    from the active_blocked_dates view
 * @param {string} date    "YYYY-MM-DD"
 * @param {string|null} branch  the chosen branch, or null when none is chosen yet
 */
export function blockFor(rows, date, branch = null) {
  if (!date || !Array.isArray(rows) || rows.length === 0) return null;

  const onDate = rows.filter((r) => r.blocked_date === date);
  if (onDate.length === 0) return null;

  const allBranches = onDate.find((r) => r.branch == null) ?? null;

  // No branch chosen yet. Only an every-branch block is certain at this point:
  // a Cavite block says nothing about someone who goes on to pick Batangas,
  // and refusing the date now would be refusing a booking we would have taken.
  // The branch-specific case gets caught when a branch is chosen, and again at
  // submit, by which time the branch is always known.
  if (branch == null) return allBranches;

  // An every-branch block outranks a branch one — it is the broader statement,
  // and if both exist for a date they are saying the same thing anyway.
  return allBranches ?? onDate.find((r) => r.branch === branch) ?? null;
}

/** Convenience for callers that only need yes or no. */
export function isBlocked(rows, date, branch = null) {
  return blockFor(rows, date, branch) !== null;
}

/**
 * What to tell the customer. Kept here so the picker and the server rejection
 * cannot drift into saying different things about the same date.
 */
export function blockMessage(block) {
  if (!block) return "";

  // Reason first. It was buried mid-sentence behind "We can't take bookings
  // for this date", which is the part the customer has already worked out from
  // the red border — while "Fully booked" and "Holiday" are what actually
  // decide whether they wait, pick another day, or telephone.
  //
  // Falls back rather than omitting: the dashboard allows free text and the
  // column is nullable, so a row with no reason still has to say something.
  const reason = block.reason?.trim() || "Not available";
  const where  = block.branch ? ` at ${block.branch}` : "";
  return `${reason}${where} — please choose another date.`;
}

/**
 * On failing open.
 *
 * If the view cannot be read — Supabase down, the anon grant missing, a
 * network fault — every caller here receives an empty list and every date
 * looks available. That is deliberate, and it is the lesser of the two
 * failures: the alternative is an outage in which no customer can book any
 * date at all, which costs real orders to prevent a kitchen from being
 * over-booked on one of them.
 *
 * It is worth being clear that this means a block is not a guarantee. It stops
 * the ordinary case. It cannot survive the database being unreachable, and the
 * kitchen should not plan as though it can.
 */
