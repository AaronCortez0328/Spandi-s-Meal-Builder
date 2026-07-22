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
  const appointment =
    contactFields.branch && contactFields.event_date && opportunityFields.event_time
      ? {
          branch:    contactFields.branch,
          eventDate: contactFields.event_date,
          eventTime: opportunityFields.event_time,
        }
      : undefined;

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
      appointment,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `GHL proxy → HTTP ${res.status}`);
  }
}
