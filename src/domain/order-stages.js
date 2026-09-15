/**
 * Nineteen stages across two systems, collapsed to six a customer can read.
 *
 * An order's progress is split. GoHighLevel's pipeline owns the commercial
 * side — confirmed, paid, delivered — and the kitchen board owns the cooking.
 * Neither knows the other's stages, and a customer must never be shown
 * nineteen states, most of which describe our own paperwork.
 *
 * Nothing here touches the network. It takes two strings and returns a step,
 * so every rule below is a test rather than something you have to run a
 * booking through to find out.
 *
 * ── Agreed with the dashboard team, 15 September 2026 ──────────────────────
 *
 *  1. READY NEVER COMES FROM THE KITCHEN. Their `confirm` stage means the
 *     chef finished the checklist, not that food is waiting for a customer.
 *     Reading it as "Ready" would tell someone to come and collect an order
 *     nobody has released. Ready comes from the order pipeline alone.
 *
 *  2. NO KITCHEN ROW IS THE NORMAL CASE, NOT AN ERROR. A row appears only
 *     when the kitchen first touches an order: on their numbers that is 37
 *     rows against 1,592 opportunities. So a missing stage is silence, not
 *     failure — the pipeline alone decides, and the customer sees a real
 *     step rather than "unknown" or a blank page.
 *
 *  3. COARSE AND BEHIND BEATS PRECISE AND WRONG. Kitchen ticks are batched by
 *     hand — 23 of their 37 rows sit at the last stage — so progress can lag
 *     the food. Six wide steps absorb that. Timestamps would not, which is
 *     why none are shown anywhere on the screen and why the view we read
 *     does not carry updated_at.
 */

/**
 * The six, in order. `id` is what the code compares; `label` is the wording,
 * and the wording is the caterer's call rather than a technical one — these
 * are the words someone reads while waiting on a six-figure booking. Kept in
 * one place so changing them is one edit and no logic moves.
 */
export const STEPS = [
  { id: "received",  label: "Order received" },
  { id: "confirmed", label: "Confirmed" },
  { id: "preparing", label: "Preparing" },
  { id: "cooking",   label: "Cooking" },
  { id: "ready",     label: "Ready" },
  { id: "completed", label: "Completed" },
];

/** Neither a step nor a failure — a state the timeline cannot express. */
export const OFF_TIMELINE = {
  cancelled:   { id: "cancelled",   label: "Cancelled" },
  rescheduled: { id: "rescheduled", label: "Rescheduled" },
};

const INDEX = Object.fromEntries(STEPS.map((s, i) => [s.id, i]));

/**
 * GoHighLevel's order pipeline. The payment stages land on `confirmed`
 * deliberately: paying is not a stage of cooking, and an order at "Half Paid"
 * is a confirmed booking that has paid half. The payment panel says the rest.
 */
const PIPELINE = {
  "awaiting confirmation": "received",
  "confirmed":             "confirmed",
  "upcoming event":        "confirmed",
  "3 days before event":   "confirmed",
  "tomorrows event":       "confirmed",
  "half paid":             "confirmed",
  "fully paid":            "confirmed",
  "awaiting balance":      "confirmed",
  "ready for pickup":      "ready",
  "clear to delivered":    "ready",
  "delivered":             "completed",
  "completed":             "completed",
};

const PIPELINE_OFF = {
  "cancelled":   OFF_TIMELINE.cancelled,
  "rescheduled": OFF_TIMELINE.rescheduled,
};

/**
 * The kitchen board, mirrored from STAGE_IDS in the dashboard's
 * api/_lib/kitchenChecklist.js — their single source of truth, confirmed by
 * them on 15 September 2026. Kept as a copy rather than an import because the
 * two repositories deploy separately; if they rename one, this is the file
 * that has to change, and they have agreed to tell us before they do.
 *
 * `upcoming-orders` advances nothing on purpose: it means the order has
 * reached the board, not that anyone has started. `confirm` stops at cooking
 * — see rule 1 above.
 */
const KITCHEN = {
  "upcoming-orders": null,
  "white-board":     "preparing",
  "procured":        "preparing",
  "cooking":         "cooking",
  "confirm":         "cooking",
};

function norm(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Where an order is, from whatever each system happens to know.
 *
 * Returns { step, index, offTimeline } — offTimeline is null on a normal
 * order and carries the reason otherwise, so a caller renders the timeline or
 * replaces it rather than having to test for a seventh step that isn't one.
 *
 * The two systems are combined by taking whichever is further along, not by
 * preferring one. An order can be marked Delivered in the pipeline while the
 * kitchen board still reads 'cooking' — its ticks are batched, so it lags —
 * and walking a customer backwards would be worse than either answer. The
 * kitchen can never reach beyond 'cooking', so this can never promote a chef's
 * tick into "Ready".
 *
 * An unrecognised pipeline stage contributes 'received' rather than nothing.
 * A stage we have not seen still means the booking exists; claiming the first
 * step is the least we can say, and the kitchen may still carry it further.
 */
export function orderStep({ pipelineStage, kitchenStage } = {}) {
  const off = PIPELINE_OFF[norm(pipelineStage)];
  if (off) return { step: off, index: -1, offTimeline: off };

  const fromPipeline = PIPELINE[norm(pipelineStage)] ?? "received";
  // Absent, unknown, or 'upcoming-orders' — all of them mean the kitchen has
  // nothing to add, which is the commonest case rather than a problem.
  const fromKitchen = KITCHEN[norm(kitchenStage)] ?? null;

  const index = Math.max(INDEX[fromPipeline], fromKitchen ? INDEX[fromKitchen] : -1);
  return { step: STEPS[index], index, offTimeline: null };
}

/**
 * The six steps with each one's state, for a timeline to draw directly.
 *
 * Every step is returned on every order — a customer reading "Cooking" needs
 * to see what is still to come, and a list that grows as the order progresses
 * hides how much is left.
 */
export function orderTimeline(input) {
  const { index, offTimeline } = orderStep(input);
  return STEPS.map((step, i) => ({
    ...step,
    done:    !offTimeline && i < index,
    current: !offTimeline && i === index,
  }));
}
