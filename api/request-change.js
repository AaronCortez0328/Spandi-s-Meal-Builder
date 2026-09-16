import { supabaseAdmin } from "./_supabase-admin.js";
import { callerIp } from "./_rate-limit.js";
import {
  ghlGet, GHL_LOC, fetchFieldIds, findContactOpportunities,
  getOpportunity, opportunityFieldValue,
} from "./_ghl-client.js";
import { checkLookupLimit, recordLookup } from "./_order-lookup-limit.js";
import { identifierMatches, searchCandidates, notFound } from "./_order-lookup.js";
import { validateRequest, buildBefore, reasonMessage } from "./_change-request.js";

/**
 * POST /api/request-change
 * Body: { identifier, eventDate, kind, after }
 *
 * A customer asking to change or add to their booking. It writes ONE ROW and
 * touches nothing else.
 *
 * That is the design, not an implementation detail. The dashboard can now
 * write to GoHighLevel opportunities, and so can we at inquiry — a third
 * writer on the same record, with no version to check against, is how an
 * admin's edit and a customer's change silently overwrite each other and
 * nobody finds out until the kitchen cooks the wrong quantity.
 *
 * So a request is a row, not a write. The dashboard stays the only thing
 * applying anything to GoHighLevel, exactly as before this existed.
 *
 * ── Who is allowed to ask ──────────────────────────────────────────────────
 *
 * The same gate as Order Status: the email or mobile they booked with, plus
 * the event date. Deliberately the same, because this endpoint may not be a
 * softer way in than the page that shows the booking — anyone who can look an
 * order up can ask about it, and nobody else.
 */
const MANILA_OFFSET_MIN = 8 * 60;

function manilaToday() {
  return new Date(Date.now() + MANILA_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

/** Postgres' unique-violation code. The partial index is doing its job. */
const UNIQUE_VIOLATION = "23505";

/**
 * The booking this customer is talking about, or null.
 *
 * The same walk Order Status does, deliberately duplicated rather than shared
 * through a helper that would have to serve two different response shapes.
 * Read through by id, because /opportunities/search is eventually consistent
 * and can answer with a booking as it was before it was last amended — here
 * that would snapshot a stale `before` into a row the dashboard later trusts.
 */
async function bookingFor(identifier, eventDate, fieldIds) {
  for (const query of searchCandidates(identifier)) {
    const data = await ghlGet(
      `/contacts/?locationId=${GHL_LOC}&query=${encodeURIComponent(query)}&limit=20`
    );
    const contacts = (data?.contacts ?? []).filter((c) => identifierMatches(c, identifier));
    if (contacts.length === 0) continue;

    for (const contact of contacts) {
      for (const summary of await findContactOpportunities(contact.id)) {
        const opportunity = (await getOpportunity(summary.id)) ?? summary;
        const held = opportunityFieldValue(opportunity, fieldIds.event_date);
        if (String(held ?? "").trim() === eventDate) return opportunity;
      }
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const ip = callerIp(req);
  const { identifier, eventDate, kind, after } = req.body ?? {};
  const typed = String(identifier ?? "").trim();
  const date = String(eventDate ?? "").trim();

  // Shares the lookup's throttle, because this shares its gate. Somebody
  // probing for bookings must not get a fresh budget by probing here instead.
  const limit = await checkLookupLimit(ip);
  if (!limit.allowed) {
    res.status(200).json(notFound());
    return;
  }

  if (!typed || !date) {
    await recordLookup(ip, false);
    res.status(200).json(notFound());
    return;
  }

  // The window is checked BEFORE the booking is looked up. A locked booking
  // and a booking that does not exist then cost the same work and reveal the
  // same thing, which is nothing.
  const check = validateRequest({ kind, after, eventDate: date }, new Date(`${manilaToday()}T00:00:00Z`));
  if (!check.ok) {
    await recordLookup(ip, false);
    res.status(200).json({
      ok: false,
      reason: check.reason,
      message: reasonMessage(check.reason),
    });
    return;
  }

  try {
    const fieldIds = await fetchFieldIds("opportunity");
    const opportunity = await bookingFor(typed, date, fieldIds);

    if (!opportunity) {
      await recordLookup(ip, false);
      res.status(200).json(notFound());
      return;
    }

    const read = (key) => opportunityFieldValue(opportunity, fieldIds[key]) ?? null;

    const { error } = await supabaseAdmin.from("order_change_requests").insert({
      opportunity_id: opportunity.id,
      kind,
      before: buildBefore({
        branch: read("branch"),
        package_name: read("package_name"),
        pax_count: read("pax_count"),
        event_date: read("event_date"),
      }, opportunity.monetaryValue),
      after: check.after,
    });

    if (error) {
      // Not a failure to swallow — it is the partial unique index answering.
      // The dashboard asked for one open request per booking, because two
      // gives an admin two answers to the same question and whichever is
      // approved second silently overwrites the first.
      if (error.code === UNIQUE_VIOLATION) {
        await recordLookup(ip, true);
        res.status(200).json({
          ok: false,
          reason: "already-open",
          message: reasonMessage("already-open"),
        });
        return;
      }
      throw error;
    }

    await recordLookup(ip, true);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Change request failed:", e);
    await recordLookup(ip, false);
    // Never a 5xx to the customer. They cannot act on it, and a red error on
    // a page about their own booking reads as something being wrong with the
    // booking rather than with us.
    res.status(200).json({ ok: false, reason: "unknown", message: reasonMessage("unknown") });
  }
}
