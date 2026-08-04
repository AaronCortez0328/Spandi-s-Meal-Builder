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
