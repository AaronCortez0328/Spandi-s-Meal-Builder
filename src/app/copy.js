/**
 * Customer-facing copy that appears in more than one builder.
 *
 * These strings make commitments to the customer (what a price covers,
 * how soon we reply), so they live in one place — five builders drifting
 * apart on a promise is how you end up telling different customers
 * different things.
 */

/**
 * Delivery is arranged separately via courier and settled directly with
 * the rider, so it is genuinely not part of any quoted figure. Every
 * headline price has to say so, or the number reads as the final bill.
 */
export const DELIVERY_NOTE = "Delivery quoted separately";

/**
 * Admin confirms bookings within roughly a day, and office hours are
 * 08:00-17:00 — so an evening inquiry cannot be answered "in a few
 * hours". "Business day" stays true whatever time it is submitted.
 */
export const CONFIRM_WINDOW = "within 1 business day";
