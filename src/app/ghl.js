/**
 * Pushes an inquiry to GHL via the server-side proxy (/api/ghl-inquiry).
 * The GHL Private Integration token stays server-side — never shipped to the browser.
 *
 * Three outcomes, not two:
 *
 *   { ok: true }              created, or added to an existing booking
 *   { needsChoice, existing } the customer already has a booking and has to
 *                             say whether this belongs to it
 *   throw                     an actual failure
 *
 * The middle one is why this does not simply resolve or reject. A customer
 * with an existing order is not an error state — it is a question, and
 * answering it on their behalf is how two separate events used to end up
 * merged into one booking.
 */
export async function pushInquiryToGHL({
  contact,
  opportunityName,
  monetaryValue,
  noteBody,
  contactFields = {},
  opportunityFields = {},
  intent = null,
  idempotencyKey = null,
}) {
  // No separate `appointment` object: the server derives the calendar
  // booking from branch, event_date and delivery__pickup_time, which are
  // already in the payload below and which it validates. Sending the time
  // twice meant the server could validate one copy and book from the
  // other.
  const res = await fetch("/api/ghl-inquiry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contact,
      opportunityName,
      monetaryValue,
      noteBody,
      contactFields,
      opportunityFields,
      // Hidden field; anything in it means the submission was automated.
      company: contact?.company ?? "",
      // "add" | "separate" once the customer has answered; absent on the
      // first attempt, which is what makes the server ask.
      ...(intent ? { intent } : {}),
      // Same value for every request belonging to one order, so a
      // double-tapped Send button or a retried connection cannot produce
      // two bookings.
      ...(idempotencyKey ? { idempotencyKey } : {}),
    }),
  });

  const data = await res.json().catch(() => ({}));

  // 409 with needsChoice is the question, not a failure. Nothing has been
  // written at this point — the server returns before touching the booking.
  if (res.status === 409 && data.needsChoice) {
    return { needsChoice: true, existing: data.existing };
  }

  if (!res.ok) {
    const err = new Error(data.error ?? `GHL proxy → HTTP ${res.status}`);

    // 4xx means the caller can do something about it — rate limited, wrong
    // origin, a time outside the kitchen window — and the server writes
    // those messages for a customer to read. 5xx is our problem and its
    // detail is not theirs to decode, so those keep the generic wording.
    //
    // Everything used to surface as "check your connection", which sent
    // people to reset a router over a 403.
    err.userFacing = res.status >= 400 && res.status < 500 && Boolean(data.error);
    err.status = res.status;
    throw err;
  }

  // { attached } is present when this order was folded into a booking the
  // customer already had. Callers show a different confirmation for it —
  // saying "Inquiry sent" would be untrue, since no new booking was created.
  return { attached: data.attached ?? null };
}
