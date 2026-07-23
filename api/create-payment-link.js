import { ghlGet, fetchFieldNamesById } from "./_ghl-client.js";
import { supabaseAdmin } from "./_supabase-admin.js";

const LINK_TTL_MS = 15 * 60 * 1000;
const SITE_URL = process.env.SITE_URL;

// Turns a GHL customFields array ([{ id, fieldValue }]) into { "Readable Name": value }.
function readableCustomFields(customFields, namesById) {
  const out = {};
  for (const f of customFields ?? []) {
    const value = f.fieldValue ?? f.value;
    if (value === undefined || value === null || String(value).trim() === "") continue;
    out[namesById[f.id] ?? f.id] = value;
  }
  return out;
}

/**
 * POST /api/create-payment-link
 * Body: { contactId, opportunityId }
 *
 * Called by a GHL Workflow webhook action when an opportunity reaches the
 * "Upcoming Event" stage. Returns { paymentUrl } for the workflow to drop
 * into a contact field / email merge tag.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { contactId, opportunityId } = req.body ?? {};
  if (!contactId) {
    res.status(400).json({ error: "contactId is required" });
    return;
  }

  try {
    const [oppNames, contactNames] = await Promise.all([
      fetchFieldNamesById("opportunity"),
      fetchFieldNamesById("contact"),
    ]);

    const [oppData, contactData] = await Promise.all([
      opportunityId ? ghlGet(`/opportunities/${opportunityId}`) : Promise.resolve(null),
      ghlGet(`/contacts/${contactId}`),
    ]);

    const opportunity = oppData?.opportunity ?? oppData;
    const contact = contactData?.contact ?? contactData;

    const orderSummary = {
      contactName: [contact?.firstName, contact?.lastName].filter(Boolean).join(" "),
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
      opportunityName: opportunity?.name ?? null,
      monetaryValue: opportunity?.monetaryValue ?? null,
      ...(opportunity ? readableCustomFields(opportunity.customFields, oppNames) : {}),
      ...readableCustomFields(contact?.customField ?? contact?.customFields, contactNames),
    };

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();

    const { error } = await supabaseAdmin.from("payment_links").insert({
      token,
      contact_id: contactId,
      opportunity_id: opportunityId ?? null,
      order_summary: orderSummary,
      expires_at: expiresAt,
    });
    if (error) throw error;

    res.status(200).json({ paymentUrl: `${SITE_URL}/?pay=${token}` });
  } catch (e) {
    console.error("create-payment-link failed:", e);
    res.status(502).json({ error: e.message });
  }
}
