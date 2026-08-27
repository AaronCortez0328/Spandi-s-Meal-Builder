import { supabase } from "./supabase-client.js";

/**
 * Dates the kitchen has closed, read from the dashboard's
 * `active_blocked_dates` view.
 *
 * Read-only by agreement: the dashboard writes the underlying table, we never
 * touch it. The view exists so the table can keep unblocked rows as history —
 * "why was 8 August closed" is answerable a year later — without us having to
 * know that a row can be inactive. Every row we see is currently blocking.
 *
 * The list is deliberately small and whole. There is no point querying per
 * date: a kitchen blocks a handful of days, the customer may try several, and
 * one request that answers every question beats a round trip per keystroke.
 */

let blockedDates = [];

/** The rows currently held. Empty until the first load, and after a failure. */
export function getBlockedDates() {
  return blockedDates;
}

/**
 * Fetches the view. Resolves either way — a failure leaves the previous rows
 * in place rather than emptying them, so a single dropped request during the
 * 30-second poll does not briefly reopen a date the kitchen has closed.
 *
 * The very first load is the exception: there is nothing to keep, so a failure
 * there does mean everything looks available. See the note on failing open in
 * domain/availability.js — that is the intended direction.
 */
export async function loadBlockedDates() {
  const { data, error } = await supabase
    .from("active_blocked_dates")
    .select("blocked_date, branch, reason");

  if (error) {
    console.error("Could not load blocked dates:", error.message ?? error);
    return blockedDates;
  }

  blockedDates = Array.isArray(data) ? data : [];
  return blockedDates;
}
