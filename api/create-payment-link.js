import { ghlGet, ghlPut, fetchFieldIds, fetchFieldNamesById } from "./_ghl-client.js";
import { supabaseAdmin } from "./_supabase-admin.js";

const LINK_TTL_MS = 15 * 60 * 1000;
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

// Writes the generated link straight into GHL's opportunity.payment_link field —
// don't rely on the Workflow's "map webhook response to field" step at all.
// Returns a diagnostic object instead of swallowing failures, so the caller
// can surface exactly what happened in the response body.
async function setOpportunityPaymentLink(opportunityId, paymentUrl) {
  if (!opportunityId) return { ok: false, reason: "no opportunityId" };
  try {
    const fieldIds = await fetchFieldIds("opportunity");
    const fieldId = fieldIds.payment_link;
    if (!fieldId) {
      return { ok: false, reason: "payment_link field not found", availableKeys: Object.keys(fieldIds) };
    }
    await ghlPut(`/opportunities/${opportunityId}`, {
      customFields: [{ id: fieldId, field_value: paymentUrl }],
    });
    return { ok: true, fieldId };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * POST /api/create-payment-link
 * Body: { contactId, opportunityId }
 * Header: X-Webhook-Secret — must match GHL_WEBHOOK_SECRET
 *
 * Called by a GHL Workflow webhook action when an opportunity reaches the
 * "Confirmed" stage. Returns { paymentUrl } for the workflow to drop into
 * an opportunity field / email merge tag.
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
    // Idempotency: if this opportunity already has a live (unused, unexpired)
    // link, reuse it instead of minting a new one — protects against the
    // workflow re-firing for the same stage change.
    if (opportunityId) {
      const { data: existing } = await supabaseAdmin
        .from("payment_links")
        .select("token")
        .eq("opportunity_id", opportunityId)
        .eq("used", false)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        const existingUrl = `${SITE_URL}/?pay=${existing.token}`;
        const ghlWrite = await setOpportunityPaymentLink(opportunityId, existingUrl);
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
    const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();

    const { error } = await supabaseAdmin.from("payment_links").insert({
      token,
      contact_id: contactId,
      opportunity_id: opportunityId ?? null,
      order_summary: orderSummary,
      expires_at: expiresAt,
    });
    if (error) throw error;

    const paymentUrl = `${SITE_URL}/?pay=${token}`;
    const ghlWrite = await setOpportunityPaymentLink(opportunityId, paymentUrl);

    res.status(200).json({ paymentUrl, ghlWrite });
  } catch (e) {
    console.error("create-payment-link failed:", e);
    res.status(502).json({ error: e.message });
  }
}
