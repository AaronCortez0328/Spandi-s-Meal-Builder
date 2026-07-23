import { GHL_LOC, ghlFetch, ghlPost, ghlPut, fetchFieldIds } from "./_ghl-client.js";

const PIPELINE_ID = process.env.PIPELINE_ID;
const STAGE_ID = process.env.STAGE_ID;

// Branch → GHL Personal calendar. Appointment booking is skipped for any
// other branch value (or if the calendar env vars aren't set).
const CALENDAR_IDS = {
  Cavite:   process.env.GHL_CALENDAR_CAVITE,
  Batangas: process.env.GHL_CALENDAR_BATANGAS,
};

const APPOINTMENT_DURATION_MIN = 30;
const MANILA_OFFSET = "+08:00";

// Formats a UTC instant as its +08:00 (Manila) wall-clock time.
function toManilaISOString(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}${MANILA_OFFSET}`
  );
}

/**
 * POST /api/ghl-inquiry
 * Body: { contact, opportunityName, monetaryValue, noteBody, contactFields, opportunityFields }
 *
 * Holds the GHL Private Integration token server-side — the browser never sees it.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const {
    contact,
    opportunityName,
    monetaryValue,
    noteBody,
    contactFields = {},
    opportunityFields = {},
    appointment,
  } = req.body ?? {};

  if (!contact?.email && !contact?.phone) {
    res.status(400).json({ error: "contact.email or contact.phone is required" });
    return;
  }

  try {
    const fieldIds = await fetchFieldIds("opportunity");

    // ── 1. Create or find contact ─────────────────────────────────────────
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
        contactId = data.meta.contactId;
      } else {
        throw new Error(`GHL /contacts/ → HTTP 400: ${data?.message ?? "unknown error"}`);
      }
    } else {
      const msg = await contactRes.text().catch(() => contactRes.status);
      throw new Error(`GHL /contacts/ → HTTP ${contactRes.status}: ${msg}`);
    }

    if (!contactId) throw new Error("GHL did not return a contact ID");

    if (Object.keys(contactFields).length > 0) {
      try {
        await ghlPut(`/contacts/${contactId}`, { customField: contactFields });
      } catch (e) {
        console.warn("Contact custom field update failed (non-fatal):", e.message);
      }
    }

    // ── 2. Create opportunity with real field IDs ─────────────────────────
    const oppCustomFields = Object.entries(opportunityFields)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
      .map(([key, value]) => ({
        id:          fieldIds[key] ?? key,
        field_value: String(value),
      }));

    try {
      await ghlPost("/opportunities/", {
        locationId:      GHL_LOC,
        pipelineId:      PIPELINE_ID,
        pipelineStageId: STAGE_ID,
        contactId,
        name:            opportunityName,
        monetaryValue,
        status:          "open",
        ...(oppCustomFields.length > 0 ? { customFields: oppCustomFields } : {}),
      });
    } catch (e) {
      // GHL blocks duplicate opportunities per contact — not fatal.
      if (!e.message.includes("duplicate")) throw e;
    }

    // ── 3. Add note (best-effort) ───────────────────────────────────────────
    try {
      await ghlPost(`/contacts/${contactId}/notes`, { body: noteBody });
    } catch (e) {
      console.warn("GHL note creation failed (non-fatal):", e.message);
    }

    // ── 4. Book a tentative calendar appointment (best-effort) ─────────────
    const calendarId = CALENDAR_IDS[appointment?.branch];
    if (calendarId && appointment?.eventDate && appointment?.eventTime) {
      try {
        const startTime = `${appointment.eventDate}T${appointment.eventTime}:00${MANILA_OFFSET}`;
        const endTime = toManilaISOString(
          new Date(new Date(startTime).getTime() + APPOINTMENT_DURATION_MIN * 60000)
        );

        await ghlPost("/calendars/events/appointments", {
          calendarId,
          locationId:       GHL_LOC,
          contactId,
          title:            opportunityName,
          startTime,
          endTime,
          appointmentStatus: "new",
          toNotify:          false,
        });
      } catch (e) {
        console.warn("GHL calendar appointment failed (non-fatal):", e.message);
      }
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("GHL inquiry submission failed:", e);
    res.status(502).json({ error: e.message });
  }
}
