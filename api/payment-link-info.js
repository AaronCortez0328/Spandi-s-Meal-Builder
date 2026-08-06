import { supabaseAdmin } from "./_supabase-admin.js";
import { getOpportunity, opportunityFieldValue, fetchFieldIds } from "./_ghl-client.js";
import { buildOrderSummary } from "./_payment-link.js";

const OPEN_WINDOW_MS = 15 * 60 * 1000;
const SITE_URL = process.env.SITE_URL;

/**
 * Rebuilds the summary from the opportunity as it stands right now.
 *
 * Read by id rather than through the search endpoint, which is eventually
 * consistent and would miss a booking amended moments ago — the exact case
 * this exists to catch.
 *
 * Returns null on any failure so the caller can fall back to the stored
 * snapshot. A customer with a payment page open is trying to give you money;
 * a GoHighLevel outage should not stop them.
 */
async function liveOrderSummary(link) {
  if (!link?.opportunity_id) return null;

  try {
    const [opportunity, fieldIds] = await Promise.all([
      getOpportunity(link.opportunity_id),
      fetchFieldIds("opportunity"),
    ]);
    if (!opportunity || Object.keys(fieldIds).length === 0) return null;

    const read = (key) => opportunityFieldValue(opportunity, fieldIds[key]) ?? null;

    // Name, email, phone and address are not on the opportunity — they
    // belong to the contact, and they do not change when a booking is
    // amended. Carried across from the snapshot rather than fetched again.
    const snapshot = link.order_summary ?? {};

    return buildOrderSummary({
      contact: {
        firstName: snapshot.Name ?? null,
        lastName: "",
        email: snapshot.Email ?? null,
        phone: snapshot.Phone ?? null,
        address: snapshot.Address ?? null,
      },
      fields: {
        branch: read("branch"),
        package_name: read("package_name"),
        service_type: read("service_type"),
        pax_count: read("pax_count"),
        event_date: read("event_date"),
        event_time: read("event_time"),
        receive_method: read("receive_method"),
        delivery__pickup_time: read("delivery__pickup_time"),
        dishes_selected: read("dishes_selected"),
      },
      monetaryValue: opportunity.monetaryValue,
    });
  } catch (e) {
    console.warn("Live order summary failed, using snapshot:", e.message);
    return null;
  }
}

/**
 * GET /api/payment-link-info?token=...
 *
 * Validates a proof-of-payment link and returns the booking summary
 * snapshotted when the link was created. Never trust this alone for the
 * actual upload — api/submit-payment-proof.js re-validates server-side.
 *
 * A booking often takes more than one payment — a deposit now, a balance
 * later, sometimes weeks apart — so this link is not single-use. It allows
 * up to MAX_SUBMISSIONS proofs (enforced in api/submit-payment-proof.js,
 * which is the only place that can actually record one). What lives here
 * is the visiting window: opening the page is free and unlimited, and each
 * open grants a fresh 15 minutes to act on, rather than one clock ticking
 * from the very first time she ever opened it. The old version's single
 * window meant a customer who paid a deposit today and came back next week
 * for the balance found the link already dead — the fix a week later would
 * have been to mint her a new one by hand.
 *
 * `used` now means "finished" — MAX_SUBMISSIONS reached — not "opened
 * once." Reaching it is rare enough in practice that it is fine for it to
 * be final.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { token } = req.query ?? {};
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("payment_links")
    .select("order_summary, opportunity_id, contact_id, first_opened_at, expires_at, used")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    res.status(502).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Link not found" });
    return;
  }

  if (data.used) {
    // Not an error — she has completed everything this link allows. Shown
    // as a distinct calm state rather than the red "link invalid" screen,
    // and still worth her seeing what booking it was for.
    const orderSummary = (await liveOrderSummary(data)) ?? data.order_summary;
    res.status(200).json({ finished: true, orderSummary });
    return;
  }

  // Every open resets the window rather than checking against one set at
  // first-open. Opening the page costs nothing — no file is touched — so
  // there is no reason a visit three weeks after the first should inherit
  // a clock that expired long ago. The 15 minutes is a "finish what you are
  // doing right now" window, re-granted each time she arrives, not a
  // budget spent across her whole relationship with the booking.
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OPEN_WINDOW_MS);

  const { error: updateError } = await supabaseAdmin
    .from("payment_links")
    .update({
      expires_at: expiresAt.toISOString(),
      ...(data.first_opened_at ? {} : { first_opened_at: now.toISOString() }),
    })
    .eq("token", token);
  if (updateError) {
    res.status(502).json({ error: updateError.message });
    return;
  }

  // Always the full window immediately after this update, so this is
  // informational for the countdown display rather than a real
  // computation — but kept as seconds, not a timestamp, so the UI is
  // immune to a wrong device clock. Display only; both upload endpoints
  // re-check expires_at server-side regardless.
  const secondsRemaining = Math.round(OPEN_WINDOW_MS / 1000);

  // The booking as it stands, not as it was when the link was issued.
  //
  // order_summary is written once at creation. A customer who later adds to
  // their booking would otherwise still see the original figure — and the
  // "reserve with 50%" line is derived from that same number, so both the
  // amount due and the deposit were wrong. Someone could pay ₱5,000 against
  // a ₱40,600 order with nothing in either system contradicting it.
  //
  // Falls back to the stored snapshot when GoHighLevel cannot be reached:
  // slightly stale beats a payment page that will not load.
  const orderSummary = (await liveOrderSummary(data)) ?? data.order_summary;

  let paymentInfo = null;
  const branch = orderSummary?.Branch;
  if (branch) {
    const { data: branchInfo } = await supabaseAdmin
      .from("branch_payment_info")
      .select("gcash_number, gcash_name, bank_name, bank_account_name, bank_account_number, qr_storage_path")
      .eq("branch", branch)
      .maybeSingle();

    if (branchInfo) {
      const { qr_storage_path, ...rest } = branchInfo;
      // Proxied through our own domain (api/qr-image.js) rather than
      // Supabase's public storage URL, so customers never see the raw
      // Supabase project/bucket layout.
      paymentInfo = {
        ...rest,
        qrUrl: qr_storage_path
          ? `${SITE_URL}/api/qr-image?path=${encodeURIComponent(qr_storage_path)}`
          : null,
      };
    }
  }

  res.status(200).json({ orderSummary, paymentInfo, secondsRemaining });
}
