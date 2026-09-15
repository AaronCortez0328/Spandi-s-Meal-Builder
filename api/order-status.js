import { supabaseAdmin } from "./_supabase-admin.js";
import { callerIp } from "./_rate-limit.js";
import {
  ghlGet, GHL_LOC, fetchFieldIds, findContactOpportunities,
  getOpportunity, opportunityFieldValue, fetchStageNames,
} from "./_ghl-client.js";
import { orderStep, orderTimeline } from "../src/domain/order-stages.js";
import { checkLookupLimit, recordLookup } from "./_order-lookup-limit.js";
import {
  identifierMatches, withinLookupWindow, publicOrderView, notFound, searchCandidates,
} from "./_order-lookup.js";

const MANILA_OFFSET_MIN = 8 * 60;

/** Today in Manila, as YYYY-MM-DD. The window is a business day, not UTC. */
function manilaToday() {
  return new Date(Date.now() + MANILA_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

/**
 * Contacts whose email or phone is exactly what was typed.
 *
 * GoHighLevel has no lookup-by-email endpoint — /contacts/lookup is parsed as
 * a contact id and answers 400. The search below is the one that exists, and
 * it is fuzzy: it matches fragments across fields, so it can return people
 * who merely resemble the input. It narrows the set; identifierMatches
 * decides, and nothing that fails it is ever read further.
 */
async function matchingContacts(identifier) {
  for (const query of searchCandidates(identifier)) {
    const data = await ghlGet(
      `/contacts/?locationId=${GHL_LOC}&query=${encodeURIComponent(query)}&limit=20`
    );
    const hits = (data?.contacts ?? []).filter((c) => identifierMatches(c, identifier));
    // Stop at the first form that finds them. An email needs one request;
    // a phone almost always matches on the first candidate too.
    if (hits.length) return hits;
  }
  return [];
}

/**
 * The booking for this event date, if there is one.
 *
 * Read through by id rather than trusting the search result: /opportunities/
 * search is eventually consistent and can answer with a stale copy of a
 * booking amended moments ago — the same reason payment-link-info.js reads
 * by id. Here that would mean showing a customer the event date they had
 * before it moved, which is the one field they are matching on.
 *
 * Requiring event_date to match is also what keeps this to actual orders.
 * The location has a third pipeline, Spandi's Referral Leads, whose entries
 * are prospects rather than bookings and carry no event date — so they can
 * never match here. That is load-bearing rather than incidental: without it,
 * a sales lead could surface to a customer as an order.
 */
async function bookingFor(contacts, eventDate, fieldIds) {
  for (const contact of contacts) {
    const list = await findContactOpportunities(contact.id);
    for (const summary of list) {
      const opportunity = (await getOpportunity(summary.id)) ?? summary;
      const held = opportunityFieldValue(opportunity, fieldIds.event_date);
      if (String(held ?? "").trim() === eventDate) return opportunity;
    }
  }
  return null;
}

/** The kitchen's progress, or silence. Silence is the commonest answer. */
async function kitchenStageFor(opportunityId) {
  try {
    const { data, error } = await supabaseAdmin
      .from("order_progress_public")
      .select("stage")
      .eq("ghl_opportunity_id", opportunityId)
      .maybeSingle();
    if (error) throw error;
    return data?.stage ?? null;
  } catch (e) {
    // A row appears only once the kitchen first touches an order — on the
    // dashboard's numbers, 37 rows against 1,592 opportunities — so absence
    // is normal and an outage must read the same as absence. The pipeline
    // alone then decides, and the customer still sees a real step.
    console.warn("Kitchen progress unavailable, showing pipeline only:", e.message ?? e);
    return null;
  }
}

/** The order as groups. Null for anything booked before that column existed. */
async function groupsFor(opportunityId) {
  try {
    const { data } = await supabaseAdmin
      .from("payment_links")
      .select("order_groups")
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return Array.isArray(data?.order_groups) ? data.order_groups : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/order-status
 * Body: { identifier, eventDate }   identifier = the email or mobile booked with
 *
 * POST rather than GET so an email address never lands in a URL, a browser
 * history, or a server access log.
 *
 * Every refusal answers with the same body and the same 200. A 404 for "no
 * such booking" and a 200 for "wrong date" would tell somebody probing which
 * half they had right, and an HTTP status says that as loudly as a message.
 *
 * Reads only. Nothing here writes to GoHighLevel, to the kitchen, or to any
 * table except the throttle's own row.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const ip = callerIp(req);
  const { identifier, eventDate } = req.body ?? {};
  const typed = String(identifier ?? "").trim();
  const date  = String(eventDate ?? "").trim();

  const limit = await checkLookupLimit(ip);
  if (!limit.allowed) {
    // Deliberately the same body as a miss. Saying "too many attempts" would
    // confirm to somebody guessing that they are guessing in the right place.
    res.status(200).json(notFound());
    return;
  }

  if (!typed || !withinLookupWindow(date, manilaToday())) {
    await recordLookup(ip, false);
    res.status(200).json(notFound());
    return;
  }

  try {
    const fieldIds = await fetchFieldIds("opportunity");
    const contacts = await matchingContacts(typed);
    const opportunity = contacts.length ? await bookingFor(contacts, date, fieldIds) : null;

    if (!opportunity) {
      await recordLookup(ip, false);
      res.status(200).json(notFound());
      return;
    }

    const read = (key) => opportunityFieldValue(opportunity, fieldIds[key]) ?? null;
    const fields = {
      branch:                read("branch"),
      package_name:          read("package_name"),
      service_type:          read("service_type"),
      pax_count:             read("pax_count"),
      event_time:            read("event_time"),
      receive_method:        read("receive_method"),
      delivery__pickup_time: read("delivery__pickup_time"),
      dishes_selected:       read("dishes_selected"),
    };

    // An opportunity carries only pipelineStageId — there is no stage name
    // on it. Resolving the id is what makes the mapping mean anything;
    // reading a name that does not exist would report every order as being
    // at the first stage, with nothing on screen to say it was wrong.
    const [kitchenStage, groups, stageNames] = await Promise.all([
      kitchenStageFor(opportunity.id),
      groupsFor(opportunity.id),
      fetchStageNames(),
    ]);

    const input = { pipelineStage: stageNames[opportunity.pipelineStageId] ?? null, kitchenStage };
    const { step, offTimeline } = orderStep(input);

    await recordLookup(ip, true);
    res.status(200).json(publicOrderView({
      step, offTimeline, timeline: orderTimeline(input), fields, groups,
    }));
  } catch (e) {
    console.error("Order status lookup failed:", e);
    // Still the same body: a 502 here would separate "our GoHighLevel call
    // broke" from "no such booking", and only one of those is the customer's
    // business. They are told to message us either way.
    await recordLookup(ip, false);
    res.status(200).json(notFound());
  }
}
