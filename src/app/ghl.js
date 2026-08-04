/**
 * Pushes an inquiry to GHL via the server-side proxy (/api/ghl-inquiry).
 * The GHL Private Integration token stays server-side — never shipped to the browser.
 */
export async function pushInquiryToGHL({
  contact,
  opportunityName,
  monetaryValue,
  noteBody,
  contactFields = {},
  opportunityFields = {},
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
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `GHL proxy → HTTP ${res.status}`);
  }

  // { attached } is present when this order was folded into a booking the
  // customer already had for the same date. Callers show a different
  // confirmation for it — saying "Inquiry sent" would be untrue, since no
  // new booking was created.
  const data = await res.json().catch(() => ({}));
  return { attached: data.attached ?? null };
}
