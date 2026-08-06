import { supabaseAdmin } from "./_supabase-admin.js";
import { setOpportunityField } from "./_ghl-client.js";

const SITE_URL = process.env.SITE_URL;

/**
 * The customer-facing summary shown on the payment page.
 *
 * Curated rather than a dump of every field — this is read by a customer
 * deciding whether the amount in front of them is right. Keys become row
 * labels in order, so the order here is the order on screen.
 *
 * A null value drops the row entirely. An empty row reads as missing data
 * rather than as "not applicable", which matters most for Address: a Pickup
 * customer never gave one.
 */
export function buildOrderSummary({ contact = {}, fields = {}, monetaryValue }) {
  const fulfilmentTime = fields.delivery__pickup_time;

  return {
    Name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null,
    Branch: fields.branch || null,
    Package: fields.package_name || fields.service_type || null,
    Pax: fields.pax_count || null,
    "Event Date": fields.event_date
      ? (fields.event_time ? `${fields.event_date} at ${fields.event_time}` : fields.event_date)
      : null,
    Total: monetaryValue != null ? `₱${Number(monetaryValue).toLocaleString()}` : null,
    Receive: fields.receive_method || null,
    // Labelled by method so the customer reads back the thing they chose.
    // Built dynamically so it drops out rather than showing an empty row.
    ...(fulfilmentTime
      ? { [fields.receive_method === "Pickup" ? "Pickup Time" : "Delivery Time"]: fulfilmentTime }
      : {}),
    Email: contact.email || null,
    Phone: contact.phone || null,
    Address: contact.address || null,
    // Rendered as its own section on the payment page — multi-line text,
    // not a key/value row like the rest.
    Dishes: fields.dishes_selected || null,
  };
}

/**
 * Gives an opportunity a live payment link, creating or refreshing as needed.
 *
 * Both paths through the booking flow call this. It used to be inline in the
 * create path only, which meant a customer adding to an existing booking got
 * no link minted *and* no refresh of the one they had — so the page kept
 * showing the original amount. They would have paid ₱10,000 against a
 * ₱40,600 booking, and the 50% reserve figure is derived from that same
 * number, so it was wrong too.
 *
 * Reuses an unused, unexpired link rather than minting a second one: a
 * customer who already has the URL should not find it silently replaced.
 *
 * Best-effort throughout. A booking is worth more than its payment link, and
 * the link can be reissued later from the dashboard.
 *
 * @returns diagnostic object — surfaced in the response so the Network tab
 *   shows what happened without needing Vercel logs.
 */
export async function ensurePaymentLink({ opportunityId, contactId, orderSummary, fieldIds }) {
  if (!opportunityId || !SITE_URL) {
    return { attempted: false, opportunityId: opportunityId ?? null, siteUrlSet: Boolean(SITE_URL) };
  }

  try {
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

    if (existing?.token) {
      // Refresh the snapshot in place. The page reads live figures anyway,
      // but this keeps the stored copy correct for the fallback path and as
      // a record of what the customer was last shown.
      const { error: updateError } = await supabaseAdmin
        .from("payment_links")
        .update({ order_summary: orderSummary })
        .eq("token", existing.token);
      if (updateError) throw updateError;

      const ghlWrite = await setOpportunityField(
        opportunityId, "payment_link", `${SITE_URL}/?pay=${existing.token}`, fieldIds
      );
      return { attempted: true, ok: ghlWrite.ok, reused: true, ghlWrite };
    }

    const token = crypto.randomUUID();
    const { error: linkError } = await supabaseAdmin.from("payment_links").insert({
      token,
      contact_id: contactId,
      opportunity_id: opportunityId,
      order_summary: orderSummary,
    });
    if (linkError) throw linkError;

    const ghlWrite = await setOpportunityField(
      opportunityId, "payment_link", `${SITE_URL}/?pay=${token}`, fieldIds
    );
    return { attempted: true, ok: ghlWrite.ok, reused: false, ghlWrite };
  } catch (e) {
    console.error("Payment link creation failed:", e.message);
    return { attempted: true, ok: false, error: e.message };
  }
}
