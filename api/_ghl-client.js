// Shared GHL (LeadConnector) API helpers for serverless functions.
// Holds the GHL Private Integration token server-side — never import from src/.

export const GHL_BASE = "https://services.leadconnectorhq.com";
export const GHL_KEY = process.env.GHL_KEY;
export const GHL_LOC = process.env.GHL_LOCATION_ID;

export function ghlHeaders() {
  return {
    "Authorization": `Bearer ${GHL_KEY}`,
    "Version": "2021-07-28",
    "Content-Type": "application/json",
  };
}

export function ghlFetch(path, body) {
  return fetch(`${GHL_BASE}${path}`, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify(body),
  });
}

export async function ghlGet(path) {
  const res = await fetch(`${GHL_BASE}${path}`, { method: "GET", headers: ghlHeaders() });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`GHL GET ${path} → HTTP ${res.status}: ${msg}`);
  }
  return res.json();
}

export async function ghlPost(path, body) {
  const res = await ghlFetch(path, body);
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`GHL ${path} → HTTP ${res.status}: ${msg}`);
  }
  return res.json();
}

export async function ghlPut(path, body) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method: "PUT",
    headers: ghlHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`GHL PUT ${path} → HTTP ${res.status}: ${msg}`);
  }
  return res.json();
}

// No cross-invocation caching here on purpose — with Fluid Compute reusing
// warm instances aggressively, an in-memory cache can quietly serve a
// stale field list (e.g. missing a field created after the instance's
// first fetch) with nothing visibly wrong. This app's traffic is low
// enough that fetching fresh every call is cheap and removes that whole
// class of bug.
async function fetchAllFields() {
  try {
    // model=all is required — GHL defaults to contact-only fields without
    // it, which silently made every opportunity-model lookup come back
    // empty (confirmed directly against the live API: 13 contact fields
    // with no query param at all vs. the real opportunity fields only
    // showing up with ?model=opportunity or ?model=all).
    const res = await fetch(
      `${GHL_BASE}/locations/${GHL_LOC}/customFields?model=all`,
      { method: "GET", headers: ghlHeaders() }
    );
    return res.ok ? (await res.json()).customFields ?? [] : [];
  } catch {
    return [];
  }
}

// { shortKey/fieldKey → id } for a given model ("opportunity" | "contact").
export async function fetchFieldIds(model) {
  const fields = await fetchAllFields();
  const ids = {};
  for (const f of fields) {
    if (f.model !== model || !f.fieldKey) continue;
    const shortKey = f.fieldKey.split(".").pop();
    ids[shortKey]   = f.id;
    ids[f.fieldKey] = f.id;
  }
  return ids;
}

// { id → readable field name } for a given model — used to turn a customFields
// array back into a human-readable summary (e.g. for the payment page).
export async function fetchFieldNamesById(model) {
  const fields = await fetchAllFields();
  const names = {};
  for (const f of fields) {
    if (f.model !== model) continue;
    names[f.id] = f.name ?? f.fieldKey?.split(".").pop() ?? f.id;
  }
  return names;
}

// The opportunities a contact already has, newest first.
//
// Used to spot an addition to an existing booking before creating anything.
// GHL rejects a second opportunity on the same contact, and the old code
// caught that error, swallowed it and returned success — the customer was
// told "Inquiry sent" while nothing was created. Looking first turns that
// from an error to recover from into a case to handle deliberately.
/**
 * Spandi's Referral Leads — a pipeline that holds enquiries, not bookings.
 *
 * The client's word: "pure leads". One record in it today, and that is the
 * point — it is somebody who might book, and an opportunity there can still
 * carry an event date, because custom fields in GoHighLevel belong to the
 * location rather than to a pipeline. So a lookup could match a lead and
 * show a stranger a "booking" that nobody has ordered or paid for.
 *
 * Read from the live pipeline list on 17 September 2026.
 */
const REFERRAL_PIPELINE_ID = "Gu5seL4YnWoMoW3twuyB";

/**
 * Whether an opportunity is a booking somebody actually placed.
 *
 * ── Why this is a denylist and not an allowlist ───────────────────────────
 *
 * The obvious reading of "only read the ordering pipeline" is to keep
 * nothing but Spandi's Basic Package Ordering System. The live counts say
 * otherwise:
 *
 *     545  Spandi's Basic Package Ordering System
 *   1,061  Old Bookings (For Reconciliation)
 *       1  Spandi's Referral Leads
 *       0  Kitchen Pipeline
 *
 * Old Bookings holds nearly twice as many real customers as the live
 * pipeline — the bookings typed in from the Excel book — and order-stages.js
 * already maps its stages so those customers get the same answer as anybody
 * else. An allowlist would tell 1,061 people their order does not exist.
 *
 * So one pipeline is excluded, the one that is genuinely not bookings, and
 * anything new is included by default. That is the right direction to fail:
 * a pipeline nobody told us about holding real orders is a worse outcome
 * than one holding leads.
 *
 * Fails open on a renamed or rebuilt pipeline: an id that no longer matches
 * excludes nothing, which is exactly today's behaviour.
 */
export function isBooking(opportunity) {
  return opportunity?.pipelineId !== REFERRAL_PIPELINE_ID;
}

export async function findContactOpportunities(contactId) {
  if (!contactId) return [];
  try {
    const data = await ghlGet(
      `/opportunities/search?location_id=${GHL_LOC}&contact_id=${contactId}`
    );
    const list = (data?.opportunities ?? []).filter(isBooking);
    return [...list].sort(
      (a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0)
    );
  } catch (e) {
    // Non-fatal: falling back to the create path is the old behaviour, which
    // is wrong for additions but never worse than refusing the order.
    console.warn("Opportunity lookup failed (non-fatal):", e.message);
    return [];
  }
}

// One opportunity by id. Unlike the search endpoint this reads straight
// through, so it answers correctly for an opportunity created seconds ago.
export async function getOpportunity(opportunityId) {
  if (!opportunityId) return null;
  try {
    const data = await ghlGet(`/opportunities/${opportunityId}`);
    return data?.opportunity ?? data ?? null;
  } catch (e) {
    console.warn("Opportunity fetch failed:", e.message);
    return null;
  }
}

// The id GHL names when it refuses a duplicate.
//
// ghlPost throws with the response body stringified into the message, so
// the structured meta.existingId has to be read back out of the text. Ugly,
// but it is the only authoritative pointer to the booking already there —
// and unlike the search index it is correct immediately.
export function duplicateExistingId(error) {
  const msg = String(error?.message ?? "");
  if (!msg.includes("OPPORTUNITY_NO_DUPLICATE")) return null;
  const m = msg.match(/"existingId"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

// Reads one custom field off an opportunity returned by the search endpoint.
// GHL is inconsistent about the value key depending on field type, hence the
// chain rather than a single property.
export function opportunityFieldValue(opportunity, fieldId) {
  const f = (opportunity?.customFields ?? []).find((x) => x.id === fieldId);
  if (!f) return null;
  return f.fieldValueString ?? f.fieldValue ?? f.value ?? null;
}

// Applies an addition to an existing booking: a new total, plus whichever
// custom fields changed. Kept as one PUT so the opportunity never sits in a
// half-updated state where the dishes include the addition but the total
// does not.
export async function updateOpportunity(opportunityId, { monetaryValue, customFields }) {
  const body = {};
  if (monetaryValue !== undefined && monetaryValue !== null) body.monetaryValue = monetaryValue;
  if (customFields?.length) body.customFields = customFields;
  if (Object.keys(body).length === 0) return { ok: true, skipped: true };

  await ghlPut(`/opportunities/${opportunityId}`, body);
  return { ok: true };
}

// Writes a value straight into an opportunity's custom field — used for
// opportunity.payment_link so nothing depends on a GHL Workflow's "map
// webhook response to field" step. Returns a diagnostic object instead of
// throwing, so callers can surface exactly what happened without it
// breaking whatever else they're doing.
//
// Pass `fieldIds` if the caller already fetched it (e.g. api/ghl-inquiry.js
// fetches it once for the opportunity-create step) — avoids a second,
// independent GHL API call for the same data in the same request.
export async function setOpportunityField(opportunityId, fieldKey, value, fieldIds = null) {
  if (!opportunityId) return { ok: false, reason: "no opportunityId" };
  try {
    const ids = fieldIds ?? await fetchFieldIds("opportunity");
    const fieldId = ids[fieldKey];
    if (!fieldId) {
      return { ok: false, reason: `${fieldKey} field not found`, availableKeys: Object.keys(ids) };
    }
    await ghlPut(`/opportunities/${opportunityId}`, {
      customFields: [{ id: fieldId, field_value: value }],
    });
    return { ok: true, fieldId };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Adds tags to a contact. Never throws.
 *
 * The point of a tag rather than a field write is what GHL will do about it:
 * "Contact Tag Added" is a first-class workflow trigger, so the whole
 * notification -- who gets told, by email or SMS or a task -- is editable in
 * GHL without touching this repo.
 *
 * Two consequences of that worth holding on to:
 *
 *   The workflow MUST remove the tag as its last action. GHL fires on the
 *   tag going from absent to present, so a tag left in place means the
 *   second payment on the same booking notifies nobody.
 *
 *   A tag carries no payload. It says "something happened for this contact"
 *   and nothing else -- and one contact can now hold several opportunities,
 *   so a workflow that needs to name the booking has to look it up rather
 *   than read it from here.
 *
 * Returns a result object instead of throwing because every caller so far is
 * doing this alongside work that already succeeded. Failing a customer's
 * upload because a notification did not go out would be the wrong trade.
 */
/**
 * The name fields worth writing, from what the customer typed.
 *
 * Only non-empty values come back. An order that arrives without a name must
 * never blank out a name already on the record: this can improve what is
 * stored, never erase it.
 */
export function contactNameUpdate(contact) {
  const out = {};
  const first = String(contact?.firstName ?? "").trim();
  const last  = String(contact?.lastName  ?? "").trim();
  if (first) out.firstName = first;
  if (last)  out.lastName  = last;
  return out;
}

/**
 * Writes the customer's name onto an existing contact.
 *
 * POST /contacts/ sets a name only when it CREATES the contact. A returning
 * customer matches an existing one, GHL answers 400 with meta.contactId, the
 * caller takes that id — and the name on the order is discarded. So a
 * contact first created by something else with no name of its own keeps
 * GoHighLevel's placeholder ("Guest Visitor Hwlsm") on every order that
 * person ever places. That is what the Facebook/Instagram integration and
 * the chat widget produce, and it is what the internal notification renders.
 *
 * Deliberately its own request rather than merged into the caller's custom
 * field write. The two are independent, and if GHL were to reject this body
 * a merged version would take the branch, event date and every other custom
 * field down with it — breaking what works today to fix what does not.
 *
 * Returns a result instead of throwing, like addContactTags below: the order
 * is already going through by this point, and the typed name also reaches
 * GHL in the note either way.
 */
export async function updateContactName(contactId, contact) {
  if (!contactId) return { ok: false, reason: "no contactId" };

  const body = contactNameUpdate(contact);
  if (Object.keys(body).length === 0) return { ok: false, reason: "no name" };

  try {
    await ghlPut(`/contacts/${contactId}`, body);
    return { ok: true, ...body };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * The email worth writing, from what the customer typed.
 *
 * Lowercased as well as trimmed. Every provider our customers use treats the
 * local part case-insensitively, GoHighLevel's own duplicate matching does
 * too, and storing "Maria.Santos@yahoo.com" beside "maria.santos@yahoo.com"
 * is how one person becomes two contacts and one of them stops getting mail.
 *
 * An empty result means "send nothing", never "send an empty string". GHL
 * refuses "" outright with 422 "email must be an email" — verified live
 * against this location, see the create call in ghl-inquiry.js.
 *
 * No shape check here on purpose. The form already validates, and a regex
 * stricter than GoHighLevel's would silently discard an address GHL would
 * have accepted — failing quietly in exactly the way this whole fix exists
 * to stop. If it is malformed, let GHL say so and let the caller log it.
 */
export function contactEmailUpdate(contact) {
  const email = String(contact?.email ?? "").trim().toLowerCase();
  return email ? { email } : {};
}

/**
 * Writes the customer's email onto an existing contact.
 *
 * The same hole as updateContactName above, with a bigger drop underneath.
 * POST /contacts/ carries the email only when it CREATES the contact. A
 * returning customer matches one GHL already holds, GHL answers 400 with
 * meta.contactId, the caller takes that id — and the address she just typed
 * into a REQUIRED field is discarded. Nothing downstream ever wrote it, so
 * the contact keeps whatever it had, which for anyone who first arrived by
 * Facebook, Instagram, the chat widget or the Excel import is nothing at all.
 *
 * That is not a cosmetic loss like the name. Email is how the payment link
 * reaches her; a contact without one silently drops out of every GoHighLevel
 * workflow that sends mail. It was made a required field precisely because
 * four orders in five were arriving without it — and then the value went in
 * the bin anyway for every customer who had ordered before.
 *
 * Its own request, not merged into the name PUT beside it, for the reason
 * that comment already gives — and email is the field most likely to be
 * refused, because GHL rejects an address that belongs to another contact.
 * Merged, one duplicate email would quietly take the name fix down with it.
 *
 * Returns a result instead of throwing. The order is already going through
 * by this point, and the typed address also reaches GHL in the note, so the
 * team can still read it off the card. Callers should log a failure loudly:
 * it means that customer will not receive her payment link.
 */
export async function updateContactEmail(contactId, contact) {
  if (!contactId) return { ok: false, reason: "no contactId" };

  const body = contactEmailUpdate(contact);
  if (Object.keys(body).length === 0) return { ok: false, reason: "no email" };

  try {
    await ghlPut(`/contacts/${contactId}`, body);
    return { ok: true, ...body };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export async function addContactTags(contactId, tags) {
  if (!contactId) return { ok: false, reason: "no contactId" };
  const list = (Array.isArray(tags) ? tags : [tags]).filter(Boolean);
  if (list.length === 0) return { ok: false, reason: "no tags" };
  try {
    await ghlPost(`/contacts/${contactId}/tags`, { tags: list });
    return { ok: true, tags: list };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * { pipelineStageId → stage name }, across every pipeline in the location.
 *
 * An opportunity carries a pipelineStageId and nothing else — confirmed
 * against the live API: /opportunities/{id} returns pipelineId and
 * pipelineStageId, and no name for either. So anything that wants to reason
 * about where an order sits has to resolve the id first, and reading a
 * `pipelineStageName` that does not exist would silently report every order
 * as being at the first stage.
 *
 * Flattened across pipelines rather than keyed by one, because stage ids are
 * unique location-wide and this location has three: the live ordering
 * pipeline, the kitchen's own, and "Old Bookings (For Reconciliation)", which
 * is where the bookings typed in from the Excel book live.
 *
 * Cached for the life of the warm function instance. Stages change about as
 * often as custom fields do — which is to say when somebody edits them by
 * hand — and a stale name costs one wrong label until the instance recycles,
 * against a network round trip on every single lookup.
 */
let stageNameCache = null;

export async function fetchStageNames() {
  if (stageNameCache) return stageNameCache;
  try {
    const data = await ghlGet(`/opportunities/pipelines?locationId=${GHL_LOC}`);
    const names = {};
    for (const pipeline of data?.pipelines ?? []) {
      for (const stage of pipeline?.stages ?? []) {
        if (stage?.id && stage?.name) names[stage.id] = stage.name;
      }
    }
    // Only cache a real answer. Caching {} would make a single blip during a
    // cold start mean every order reads as the first stage until the instance
    // recycles, with nothing on screen to say why.
    if (Object.keys(names).length > 0) stageNameCache = names;
    return names;
  } catch (e) {
    console.warn("Pipeline stage lookup failed:", e.message);
    return {};
  }
}
