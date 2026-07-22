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
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `GHL proxy → HTTP ${res.status}`);
  }
}
