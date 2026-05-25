const GHL_BASE   = "https://services.leadconnectorhq.com";
const GHL_KEY    = "pit-2a8bf6cf-8bae-4938-ae3d-9e17f179d393";
const GHL_LOC    = "6p09fNNJCMy6ZUIa7hqj";

const PIPELINE_ID = "4iSqMujoKIFti0FaoTBU";
const STAGE_ID    = "e8115d39-cd67-43bb-8818-dcd36bbc8647"; // Awaiting Confirmation

async function ghlPost(path, body) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GHL_KEY}`,
      "Version": "2021-07-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`GHL ${path} → HTTP ${res.status}: ${msg}`);
  }
  return res.json();
}

/**
 * Pushes an inquiry to GHL:
 *   1. Creates (or upserts) a contact
 *   2. Creates an opportunity in Awaiting Confirmation
 *   3. Attaches a note with the full order breakdown
 */
export async function pushInquiryToGHL({ contact, opportunityName, monetaryValue, noteBody }) {
  // 1. Create contact
  const { contact: created } = await ghlPost("/contacts/", {
    locationId: GHL_LOC,
    firstName:  contact.firstName,
    lastName:   contact.lastName,
    email:      contact.email,
    phone:      contact.phone,
    ...(contact.address ? { address1: contact.address } : {}),
  });

  const contactId = created?.id;
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
