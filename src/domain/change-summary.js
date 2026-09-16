/**
 * What a proposed change is worth against the booking that already exists.
 *
 * Pure arithmetic, kept away from the screen, because the two kinds of
 * request do genuinely different sums and the screen must not be the place
 * that decides which:
 *
 *   change  the new order REPLACES the booking.  proposed = cart
 *   add     the new order is ON TOP of it.       proposed = booking + cart
 *
 * One screen pretending to be both is how somebody replaces an order they
 * meant to add to. Getting that wrong is not a display bug — it is a
 * customer's party.
 *
 * ── Unknown is not zero ────────────────────────────────────────────────────
 *
 * Every figure here can be null and every one of them stays null. A booking
 * with no amount_paid on it has NOT been paid nothing; we simply do not know.
 * Number(null) is 0, and null <= 0 is true, so both of the obvious ways of
 * writing these checks tell a customer who has already paid half that they
 * owe the lot. They are checked with Number.isFinite and nothing else.
 *
 * ── What this deliberately does not decide ─────────────────────────────────
 *
 * `refund` is the money a customer would be ahead by if their new order came
 * to less than they have already handed over. It is reported because the
 * screen has to say SOMETHING honest about it, and it is not called a refund
 * anywhere a customer can read: whether that money comes back, sits as credit
 * or is simply kept is the business's decision and it has not been made. The
 * copy says we will sort it out with them, which is true.
 */

/** A money figure we are willing to do sums with, or null. */
function money(v) {
  const n = Number(v);
  // Not `v ?? 0` and not `n >= 0` alone: Number(null) is 0 and Number(true)
  // is 1, and neither of those is a peso figure anybody recorded.
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (String(v).trim() === "") return null;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * @param {object}  input
 * @param {"change"|"add"} input.kind
 * @param {number|null} input.wasTotal   the booking's total as it stands
 * @param {number|null} input.cartTotal  what is in the builder right now
 * @param {number|null} input.paid       what has reached us, null if unknown
 */
export function changeSummary({ kind, wasTotal, cartTotal, paid } = {}) {
  const was  = money(wasTotal);
  const cart = money(cartTotal);
  const got  = money(paid);

  const adding   = kind === "add" ? cart : null;
  const proposed = kind === "add"
    ? (was === null || cart === null ? null : was + cart)
    : cart;

  // For a change, the difference needs both sides. For an add, the cart IS
  // the difference — which is why an add can still say something useful
  // about a booking whose total we never learned.
  const difference = kind === "add"
    ? cart
    : (was === null || cart === null ? null : cart - was);

  const direction = difference === null
    ? null
    : difference > 0 ? "more" : difference < 0 ? "less" : "same";

  const settled = proposed !== null && got !== null;

  return {
    kind: kind === "add" ? "add" : "change",
    was,
    adding,
    proposed,
    difference,
    direction,
    paid: got,
    // Both floored at zero and both reported, because "you still owe 5,000"
    // and "you are 5,000 ahead" are different sentences and only one of them
    // is ever true.
    balance: settled ? Math.max(0, proposed - got) : null,
    refund:  settled ? Math.max(0, got - proposed) : null,
  };
}
