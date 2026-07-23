import { GHL_LOC, ghlFetch, ghlPost, ghlPut, fetchFieldIds, setOpportunityField } from "./_ghl-client.js";
import { supabaseAdmin } from "./_supabase-admin.js";

const PIPELINE_ID = process.env.PIPELINE_ID;
const STAGE_ID = process.env.STAGE_ID;
const SITE_URL = process.env.SITE_URL;

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

    let opportunityId;
    try {
      const oppResult = await ghlPost("/opportunities/", {
        locationId:      GHL_LOC,
        pipelineId:      PIPELINE_ID,
        pipelineStageId: STAGE_ID,
        contactId,
        name:            opportunityName,
        monetaryValue,
        status:          "open",
        ...(oppCustomFields.length > 0 ? { customFields: oppCustomFields } : {}),
      });
      opportunityId = oppResult?.opportunity?.id ?? oppResult?.id;
    } catch (e) {
      // GHL blocks duplicate opportunities per contact — not fatal, but we
      // don't have an ID to mint a payment link against in this case.
      if (!e.message.includes("duplicate")) throw e;
      console.warn("Duplicate opportunity — skipping payment link:", e.message);
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

    // ── 5. Mint a proof-of-payment link for this opportunity (best-effort) ──
    // Generated now (not on stage-change) so opportunity.payment_link is
    // already set by the time the team's "Booking Confirmed" email fires —
    // no GHL Workflow/webhook needed to populate it. The 15-minute window
    // doesn't start until the customer actually opens the link (see
    // api/payment-link-info.js), so it staying dormant for days until the
    // booking is confirmed is fine.
    // Diagnostic only — not used by the frontend, just so we can see what
    // happened via the browser's Network tab without needing Vercel logs.
    let paymentLinkDebug = { attempted: false };

    if (opportunityId && SITE_URL) {
      paymentLinkDebug = { attempted: true };
      try {
        const token = crypto.randomUUID();
        // Curated, human-readable summary for the payment page — not a raw
        // dump of every field, this is customer-facing.
        const orderSummary = {
          Contact: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null,
          Branch: opportunityFields.branch || null,
          Package: opportunityFields.package_name || opportunityFields.service_type || null,
          Serves: opportunityFields.pax_count || null,
          "Event Date": opportunityFields.event_date
            ? (opportunityFields.event_time
                ? `${opportunityFields.event_date} at ${opportunityFields.event_time}`
                : opportunityFields.event_date)
            : null,
          Total: monetaryValue != null ? `₱${Number(monetaryValue).toLocaleString()}` : null,
        };

        const { error: linkError } = await supabaseAdmin.from("payment_links").insert({
          token,
          contact_id: contactId,
          opportunity_id: opportunityId,
          order_summary: orderSummary,
        });
        if (linkError) throw linkError;

        const ghlWrite = await setOpportunityField(opportunityId, "payment_link", `${SITE_URL}/?pay=${token}`, fieldIds);
        paymentLinkDebug = { attempted: true, ok: ghlWrite.ok, ghlWrite };
      } catch (e) {
        console.warn("Payment link creation failed (non-fatal):", e.message);
        paymentLinkDebug = { attempted: true, ok: false, error: e.message };
      }
    } else {
      paymentLinkDebug = { attempted: false, opportunityId: opportunityId ?? null, siteUrlSet: Boolean(SITE_URL) };
    }

    res.status(200).json({ ok: true, paymentLinkDebug });
  } catch (e) {
    console.error("GHL inquiry submission failed:", e);
    res.status(502).json({ error: e.message });
  }
}
