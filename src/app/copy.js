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

/**
 * The number a customer is told to ring when the form cannot resolve
 * something for them — a second booking while one is already open, most
 * of all.
 *
 * Deliberately empty rather than a placeholder: an invented number is
 * worse than none, because the screen still reads as helpful while sending
 * someone nowhere. While this is blank the copy says "call us" without
 * quoting digits. Fill it in and the number appears everywhere it is used.
 */
export const CONTACT_NUMBER = "";

/**
 * Where a customer goes when the app cannot help them.
 *
 * There was nothing. A failed submit said "check your connection and try
 * again", and if the second try failed too the screen had no number, no
 * link, and no next move -- on the one customer who had already decided to
 * buy. Most of them arrive from Facebook, where the business answers in
 * minutes, and we were the ones who had taken away the way back.
 *
 * The site's own contact page, because it exists and is public today. When
 * a Messenger link or a phone number arrives, change it here: this is the
 * only place that names a destination, and every screen below reads it.
 */
export const CONTACT_URL = "https://spandisfoodandcatering.com/contact";
export const CONTACT_LABEL = "Message us";

/**
 * The way out, as one line of HTML.
 *
 * Every failure surface says the same thing in the same words, because a
 * customer who has just hit a wall should not also have to work out which
 * kind of wall it was.
 *
 * @param {string} lead  what happened, in the caller's own words
 */
export function wayOutHtml(lead = "Still stuck?") {
  const call = CONTACT_NUMBER
    ? ` or call <strong>${CONTACT_NUMBER}</strong>`
    : "";
  return `<p class="way-out">${lead}
    <a class="way-out__link" href="${CONTACT_URL}" target="_blank" rel="noopener">${CONTACT_LABEL}</a>${call}
    &mdash; we answer fast.</p>`;
}
