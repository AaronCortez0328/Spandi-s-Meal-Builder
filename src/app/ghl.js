const GHL_BASE    = "https://services.leadconnectorhq.com";
const GHL_KEY     = import.meta.env.VITE_GHL_KEY;
const GHL_LOC     = import.meta.env.VITE_GHL_LOCATION_ID;

const PIPELINE_ID = import.meta.env.VITE_PIPELINE_ID;
const STAGE_ID    = import.meta.env.VITE_STAGE_ID;

function ghlFetch(path, body) {
  return fetch(`${GHL_BASE}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GHL_KEY}`,
      "Version": "2021-07-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function ghlPost(path, body) {
  const res = await ghlFetch(path, body);
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`GHL ${path} → HTTP ${res.status}: ${msg}`);
  }
  return res.json();
}

/**
 * Pushes an inquiry to GHL:
 *   1. Creates or finds existing contact (handles duplicate-blocked locations)
 *   2. Creates an opportunity in Awaiting Confirmation
 *   3. Attaches a note with the full order breakdown
 */
export async function pushInquiryToGHL({ contact, opportunityName, monetaryValue, noteBody }) {
  // 1. Create contact — if location blocks duplicates, GHL returns 400 with the
  //    existing contactId in meta. Extract it and continue instead of failing.
  let contactId;
  const contactRes = await ghlFetch("/contacts/", {
    locationId: GHL_LOC,
    firstName:  contact.firstName,
    lastName:   contact.lastName,
    email:      contact.email,
    phone:      contact.phone,
    ...(contact.address ? { address1: contact.address } : {}),
  });

  if (contactRes.ok) {
    const data = await contactRes.json();
    contactId = data.contact?.id;
  } else if (contactRes.status === 400) {
    const data = await contactRes.json().catch(() => ({}));
    if (data?.meta?.contactId) {
      contactId = data.meta.contactId; // existing contact — reuse
    } else {
      throw new Error(`GHL /contacts/ → HTTP 400: ${data?.message ?? "unknown error"}`);
    }
  } else {
    const msg = await contactRes.text().catch(() => contactRes.status);
    throw new Error(`GHL /contacts/ → HTTP ${contactRes.status}: ${msg}`);
  }

  if (!contactId) throw new Error("GHL did not return a contact ID");

  // 2. Create opportunity
  await ghlPost("/opportunities/", {
    locationId:      GHL_LOC,
    pipelineId:      PIPELINE_ID,
    pipelineStageId: STAGE_ID,
    contactId,
    name:            opportunityName,
    monetaryValue,
    status:          "open",
  });

  // 3. Add note — best-effort, won't fail the whole submission
  try {
    await ghlPost(`/contacts/${contactId}/notes`, { body: noteBody });
  } catch (e) {
    console.warn("GHL note creation failed (non-fatal):", e.message);
  }
}
