import { supabaseAdmin } from "./_supabase-admin.js";
import { callerIp } from "./_rate-limit.js";
import {
  ghlGet, GHL_LOC, fetchFieldIds, findContactOpportunities,
  getOpportunity, opportunityFieldValue, fetchStageNames,
} from "./_ghl-client.js";
import { orderStep, orderTimeline } from "../src/domain/order-stages.js";
import { checkLookupLimit, recordLookup } from "./_order-lookup-limit.js";
import {
  identifierMatches, withinLookupWindow, publicOrderView, notFound, searchCandidates, orderMoney,
} from "./_order-lookup.js";
import { requestWindow } from "../src/domain/availability.js";

const SITE_URL = process.env.SITE_URL;

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

/**
 * The sizes this booking could move to, read from the catalogue.
 *
 * Matched on NAME, never derived from the id. special-50 is "Mary Rose
 * Package, 50 pax", sitting between mary-rose-25 and mary-rose-100, so any
 * ${base}-${pax} scheme produces an id that does not exist. The dashboard
 * raised this and they are right to match the same way when they apply it.
 *
 * Sent from here rather than fetched by the screen so the browser never has
 * to know how the catalogue is shaped — it receives a list and draws it.
 */
async function sizeOptions(groups) {
  // The id the customer actually chose, kept on the order line. Working
  // backwards from package_name does not work: live data reads "Jeanette
  // 100PAX" and "Maryrose Package 100Pax" against a catalogue saying
  // "Jeanette Package" and "Mary Rose Package", and eighteen of thirty
  // orders leave the field blank. Matching that loosely enough to work would
  // be matching it loosely enough to offer somebody a different package.
  const id = (groups ?? []).map((g) => g?.packageId).find(Boolean);
  if (!id) return [];

  try {
    const { data: mine, error: e1 } = await supabaseAdmin
      .from("packages").select("name").eq("id", id).maybeSingle();
    if (e1) throw e1;
    if (!mine?.name) return [];

    // Siblings share a name and differ by pax_label. Matched on name and
    // never derived from the id: special-50 is "Mary Rose Package, 50 pax",
    // sitting between mary-rose-25 and mary-rose-100.
    const { data, error } = await supabaseAdmin
      .from("packages")
      .select("id, name, pax_label, base_price")
      .eq("name", mine.name)
      .eq("active", true)
      .order("base_price", { ascending: true });
    if (error) throw error;

    return (data ?? []).map((r) => ({
      packageId: r.id, name: r.name, paxLabel: r.pax_label,
      price: r.base_price, isCurrent: r.id === id,
    }));
  } catch (e) {
    // No options is a screen that does not offer a change — wrong, but safe.
    // A half-read catalogue offering a size that does not exist is not.
    console.warn("Size options unavailable:", e.message ?? e);
    return [];
  }
}

/**
 * The customer's own open or recently decided request.
 *
 * Shown so they are never left wondering whether it went through — which is
 * the thing that makes somebody ask twice, or phone.
 */
async function requestFor(opportunityId) {
  try {
    const { data } = await supabaseAdmin
      .from("order_change_requests")
      .select("kind, status, after, decided_note, created_at")
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ?? null;
  } catch {
    return null;
  }
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

/** The order as groups, and the customer's own payment link. */
async function linkRowFor(opportunityId) {
  try {
    const { data } = await supabaseAdmin
      .from("payment_links")
      .select("order_groups, token, used")
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      groups: Array.isArray(data?.order_groups) ? data.order_groups : null,
      // A finished link answers with a calm "nothing more to send" screen
      // rather than an error, so it is still worth offering — the customer
      // who has paid in full is exactly who might tap it to check.
      token: data?.token ?? null,
    };
  } catch {
    return { groups: null, token: null };
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
      event_date:            read("event_date"),
      payment_status:        read("payment_status"),
    };

    // An opportunity carries only pipelineStageId — there is no stage name
    // on it. Resolving the id is what makes the mapping mean anything;
    // reading a name that does not exist would report every order as being
    // at the first stage, with nothing on screen to say it was wrong.
    const [kitchenStage, linkRow, stageNames, request] = await Promise.all([
      kitchenStageFor(opportunity.id),
      linkRowFor(opportunity.id),
      fetchStageNames(),
      requestFor(opportunity.id),
    ]);

    const input = { pipelineStage: stageNames[opportunity.pipelineStageId] ?? null, kitchenStage };
    const { step, offTimeline } = orderStep(input);

    // After linkRow, because the catalogue id lives in its groups — asking
    // for the row twice to parallelise this would cost more than it saves.
    const sizes = await sizeOptions(linkRow.groups);

    const money = orderMoney({
      monetaryValue: opportunity.monetaryValue,
      amountPaid: read("amount_paid"),
    });

    // Built here rather than read from the opportunity's payment_link
    // field: that field is written best-effort and can be stale or absent,
    // while the token in our own table is what the payment page actually
    // validates against.
    const payUrl = linkRow.token ? `${SITE_URL}/?pay=${linkRow.token}` : null;

    await recordLookup(ip, true);
    res.status(200).json(publicOrderView({
      step, offTimeline, timeline: orderTimeline(input), fields,
      groups: linkRow.groups, money, payUrl,
      // Evaluated now, not when anything was asked. Same function the
      // dashboard mirrors on its Approve button.
      windows: {
        change: requestWindow(fields.event_date, "change"),
        add:    requestWindow(fields.event_date, "add"),
      },
      request, sizes,
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
