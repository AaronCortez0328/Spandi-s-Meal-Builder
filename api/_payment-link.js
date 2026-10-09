import { supabaseAdmin } from "./_supabase-admin.js";
import { setOpportunityField } from "./_ghl-client.js";
import { MAX_GROUPS, MAX_LINES, MAX_TEXT, MAX_QTY, looksLikeId } from "./_change-request.js";

const SITE_URL = process.env.SITE_URL;

/** The largest per-line figure worth storing. Above this it is not money. */
const MAX_MONEY = 100_000_000;

/**
 * The order snapshot, bounded before it is allowed into the database.
 *
 * ── Why this has to exist ─────────────────────────────────────────────────
 *
 * order_groups arrives from the browser, and ghl-inquiry.js cannot be
 * authenticated — the customer placing the order is anonymous, so there is
 * nobody to authenticate. Until the drop at src/app/ghl.js was fixed the
 * value never arrived at all and NULL was written every time, which is why
 * this was never needed. Making it arrive is what makes it reachable, so
 * the guard ships in the same change as the fix.
 *
 * Bounds are the ones _change-request.js already enforces on the other
 * browser-fed path, imported rather than retyped: 12 groups, 40 content
 * lines, 200 characters, quantities 1–9999, ids that look like ids.
 *
 * ── Where it differs, and why ─────────────────────────────────────────────
 *
 * cleanGroups() over there drops `total` and `priceNote` deliberately —
 * money on a change request would sit beside the figure OUR server computed
 * and nobody approving could tell which they were reading.
 *
 * This snapshot is the opposite case. Order Status renders both fields
 * straight out of it (src/app/order-status.js:38-41), so stripping them
 * would show the customer their own order with no prices on it. They are
 * kept, bounded as money, and the authoritative total remains monetaryValue
 * on the opportunity — this is a display record, never a pricing one.
 *
 * Applied to the COMBINED array on an addition, so a booking added to many
 * times cannot grow without limit.
 */
export function boundOrderGroups(src) {
  const bounded = (value, max = MAX_TEXT) => {
    const s = typeof value === "string" ? value.trim() : "";
    return s ? s.slice(0, max) : null;
  };
  // A number, not something that merely coerces to one — the same stance
  // looksLikeId takes on ids, and for the same reason. Number([]) is 0, so
  // an empty array arriving as `total` would be stored as a line costing
  // nothing, which on the customer's own order screen reads as free.
  // orderGroupsPayload only ever emits real numbers here.
  const money = (value) =>
    (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_MONEY
      ? value
      : null);

  const out = [];
  for (const row of Array.isArray(src) ? src.slice(0, MAX_GROUPS) : []) {
    // A group with no title names nothing and renders as an empty row.
    const title = bounded(row?.title);
    if (!title) continue;

    const group = { title };

    if (looksLikeId(row?.service))   group.service = row.service.trim();
    if (looksLikeId(row?.packageId)) group.packageId = row.packageId.trim();

    for (const [key, max] of [["kind", 60], ["subtitle", MAX_TEXT], ["units", 60]]) {
      const value = bounded(row?.[key], max);
      if (value) group[key] = value;
    }

    // Also a number rather than anything numeric-looking. The builder sends
    // one; a string arriving here means something else produced this.
    const qty = row?.qty;
    if (typeof qty === "number" && Number.isInteger(qty) && qty >= 1 && qty <= MAX_QTY) {
      group.qty = qty;
    }

    if (Array.isArray(row?.contents)) {
      const contents = row.contents.slice(0, MAX_LINES).map((l) => bounded(l)).filter(Boolean);
      if (contents.length > 0) group.contents = contents;
    }

    // One or the other, never both — a line the menu cannot price carries a
    // note instead of a figure, and orderGroupsPayload() nulls whichever
    // does not apply. Order Status reads priceNote first, so the same
    // precedence is kept here.
    const note = bounded(row?.priceNote);
    if (note) {
      group.priceNote = note;
    } else {
      const total = money(row?.total);
      if (total !== null) group.total = total;
    }

    out.push(group);
  }
  return out;
}

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
export async function ensurePaymentLink({ opportunityId, contactId, orderSummary, fieldIds, orderGroups = null, appendGroups = false }) {
  if (!opportunityId || !SITE_URL) {
    return { attempted: false, opportunityId: opportunityId ?? null, siteUrlSet: Boolean(SITE_URL) };
  }

  // Bounded once, here, so neither write below can reach the database with
  // whatever the browser happened to send.
  const groups = boundOrderGroups(orderGroups);

  try {
    const nowIso = new Date().toISOString();

    const { data: existing } = await supabaseAdmin
      .from("payment_links")
      .select("token, order_groups")
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
      // Groups are left alone when this submission carried none, so a
      // retry or a resend never blanks a structure already recorded.
      const patch = { order_summary: orderSummary };
      if (groups.length > 0) {
        const prior = Array.isArray(existing.order_groups) ? existing.order_groups : [];
        // Bounded again over the join: each half is within the cap on its
        // own, and a booking added to five times would otherwise not be.
        patch.order_groups = appendGroups ? boundOrderGroups([...prior, ...groups]) : groups;
      }
      const { error: updateError } = await supabaseAdmin
        .from("payment_links")
        .update(patch)
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
      order_groups: groups.length > 0 ? groups : null,
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
