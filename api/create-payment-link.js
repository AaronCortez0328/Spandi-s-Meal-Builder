import { ghlGet, fetchFieldNamesById, setOpportunityField } from "./_ghl-client.js";
import { supabaseAdmin } from "./_supabase-admin.js";

const SITE_URL = process.env.SITE_URL;
const WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET;

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
 * Header: X-Webhook-Secret — must match GHL_WEBHOOK_SECRET
 *
 * The primary flow now mints this at inquiry submission time (see
 * api/ghl-inquiry.js) — this endpoint exists as a standalone "mint or
 * reuse a payment link for this opportunity" utility, e.g. for a future
 * dashboard "resend payment link" action, or manual/GHL-workflow use.
 * The 15-minute expiry doesn't start until the customer first opens the
 * link (set by api/payment-link-info.js), not at creation time here.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!WEBHOOK_SECRET || req.headers["x-webhook-secret"] !== WEBHOOK_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body ?? {};
  console.log("create-payment-link raw body:", JSON.stringify(body));

  // GHL's webhook "Custom Data" doesn't always land as flat top-level keys —
  // check the shapes we've seen before falling back to an error.
  const contactId =
    body.contactId ?? body.contact_id ?? body.customData?.contactId ?? body.contact?.id;
  const opportunityId =
    body.opportunityId ?? body.opportunity_id ?? body.customData?.opportunityId ?? body.opportunity?.id;

  if (!contactId) {
    res.status(400).json({ error: "contactId is required", receivedBody: body });
    return;
  }

  try {
    // Idempotency: if this opportunity already has a live link — either
    // never opened yet (expires_at still null) or opened but not yet
    // expired — reuse it instead of minting a new one.
    if (opportunityId) {
      const nowIso = new Date().toISOString();
      const { data: existing } = await supabaseAdmin
        .from("payment_links")
        .select("token")
        .eq("opportunity_id", opportunityId)
        .eq("used", false)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        const existingUrl = `${SITE_URL}/?pay=${existing.token}`;
        const ghlWrite = await setOpportunityField(opportunityId, "payment_link", existingUrl);
        res.status(200).json({ paymentUrl: existingUrl, ghlWrite });
        return;
      }
    }

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

    // first_opened_at / expires_at stay null until the customer actually
    // opens the link — see api/payment-link-info.js.
    const { error } = await supabaseAdmin.from("payment_links").insert({
      token,
      contact_id: contactId,
      opportunity_id: opportunityId ?? null,
      order_summary: orderSummary,
    });
    if (error) throw error;

    const paymentUrl = `${SITE_URL}/?pay=${token}`;
    const ghlWrite = await setOpportunityField(opportunityId, "payment_link", paymentUrl);

    res.status(200).json({ paymentUrl, ghlWrite });
  } catch (e) {
    console.error("create-payment-link failed:", e);
    res.status(502).json({ error: e.message });
  }
}
