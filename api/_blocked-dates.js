import { supabaseAdmin } from "./_supabase-admin.js";
import { blockFor, blockMessage } from "../src/domain/availability.js";

/**
 * The server's half of the blocked-date agreement.
 *
 * The browser disables nothing — a native date input cannot grey out scattered
 * days — so it checks on change and refuses to submit. That is a courtesy, not
 * a control: it is the customer's own browser, it holds a list fetched up to
 * thirty seconds ago, and a page opened at two o'clock can be submitted at
 * four. This is the check that decides.
 *
 * Same shape as the price verification a few lines below it in ghl-inquiry:
 * the browser's answer is a convenience, the server's is the one that counts.
 * It reads the same view the browser reads and runs the same pure function on
 * the rows, so the two cannot disagree about what a block means — only about
 * how fresh their copy is, which is the entire point of checking twice.
 */

/**
 * @returns {Promise<{blocked: true, message: string, reason: string|null} | {blocked: false}>}
 */
export async function checkDateBlocked(eventDate, branch) {
  if (!eventDate) return { blocked: false };

  const { data, error } = await supabaseAdmin
    .from("active_blocked_dates")
    .select("blocked_date, branch, reason")
    .eq("blocked_date", eventDate);

  // Fails open, deliberately, and for the same reason price verification does:
  // refusing a real booking because our own lookup broke turns our outage into
  // the customer's problem, and a kitchen can turn away one over-booked order
  // far more cheaply than we can win back someone who was told "no" by a bug.
  // Logged loudly so it is visible rather than silent.
  if (error) {
    console.error("Blocked-date check failed, accepting the booking:", error.message ?? error);
    return { blocked: false };
  }

  // branch ?? null so an absent branch is treated as "not chosen" rather than
  // as the string "undefined", which would match nothing and quietly pass.
  const block = blockFor(data ?? [], eventDate, branch ?? null);
  if (!block) return { blocked: false };

  return {
    blocked: true,
    message: blockMessage(block),
    reason: block.reason ?? null,
  };
}
