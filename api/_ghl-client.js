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
export async function findContactOpportunities(contactId) {
  if (!contactId) return [];
  try {
    const data = await ghlGet(
      `/opportunities/search?location_id=${GHL_LOC}&contact_id=${contactId}`
    );
    const list = data?.opportunities ?? [];
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
